import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { LiteParse } from "@llamaindex/liteparse";
import type {
  TextItem as LiteTextItem,
  ParsedPage as LiteParsedPage,
  Rect as LiteRect,
} from "@llamaindex/liteparse";
import type { ParsedDoc, ParsedPage, ParsedRegion, Rect } from "./types";

// Citation/highlight resolution always goes through LiteParse: it runs
// locally (no API key), and its typed `blocks` (table cells with real text +
// bbox) and `textItems` (grouped into visual lines below) give reliable,
// testable grounding for both PDFs and images (LiteParse OCRs images
// natively — see docs/PDR.md §9).

const PARSE_CACHE_DIR = path.join(process.cwd(), ".cache", "parse");
const PARSE_CACHE_VERSION = "v4-canonical-regions";

function ensureCacheDir(): void {
  fs.mkdirSync(PARSE_CACHE_DIR, { recursive: true });
}

function hashFile(absPath: string): string {
  const buf = fs.readFileSync(absPath);
  return crypto
    .createHash("sha256")
    .update(buf)
    .update(PARSE_CACHE_VERSION)
    .digest("hex");
}

function cachePath(hash: string): string {
  return path.join(PARSE_CACHE_DIR, `${hash}.json`);
}

function readCache(hash: string): ParsedDoc | null {
  const file = cachePath(hash);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as ParsedDoc;
  } catch {
    return null;
  }
}

function writeCache(hash: string, doc: ParsedDoc): void {
  fs.writeFileSync(cachePath(hash), JSON.stringify(doc, null, 2));
}

function isImage(basename: string): boolean {
  return /\.(png|jpe?g|gif|bmp|tiff?|webp)$/i.test(basename);
}

export async function parseDocument(
  absPath: string,
  basename: string
): Promise<ParsedDoc> {
  ensureCacheDir();
  const hash = hashFile(absPath);
  const cached = readCache(hash);
  if (cached) return cached;

  const kind: "pdf" | "image" = isImage(basename) ? "image" : "pdf";
  const doc = await parseWithLiteParse(absPath, basename, kind);

  writeCache(hash, doc);
  return doc;
}

// ---- LiteParse: text + grounding ----

async function parseWithLiteParse(
  absPath: string,
  basename: string,
  kind: "pdf" | "image"
): Promise<ParsedDoc> {
  const parser = new LiteParse({
    outputFormat: "markdown",
    ocrEnabled: true,
    extractBlocks: true,
    continueOnPageError: true,
    ocrFailureFatal: false,
  });

  try {
    const result = await parser.parse(absPath);
    const pages: ParsedPage[] = result.pages.map((page) => ({
      pageNumber: page.pageNum,
      width: page.width,
      height: page.height,
      text: page.markdown || page.text,
      regions: buildRegionsForPage(page),
    }));
    return {
      file: basename,
      kind,
      imageMode: kind === "image" ? classifyImageMode(pages) : undefined,
      source: "liteparse",
      pages,
    };
  } catch (err) {
    return {
      file: basename,
      kind,
      source: "none",
      pages: [],
      error: (err as Error).message,
    };
  }
}

function classifyImageMode(pages: ParsedPage[]): "text" | "visual" | "mixed" {
  const lines = pages
    .flatMap((page) => page.regions)
    .filter((region) => region.kind === "line" && /[\p{L}\p{N}]/u.test(region.text));
  const characterCount = lines.reduce(
    (total, line) => total + line.text.replace(/\s+/g, "").length,
    0
  );

  if (lines.length >= 6 && characterCount >= 120) return "text";
  if (lines.length <= 4 && characterCount < 160) return "visual";
  return "mixed";
}

function toRect(r: LiteRect): Rect {
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

function unionRect(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: right - x, h: bottom - y };
}

// Table rows/cells: real structured text + bbox from `extractBlocks`. This is
// the grounding used for CB-2025-0007 (delivery row on page 8 of a 10-page
// manifest) and similar tabular evidence (tracking events, 3DS/AVS records).
function buildRegionsForPage(page: LiteParsedPage): ParsedRegion[] {
  const regions: ParsedRegion[] = [];
  let tableIndex = 0;

  for (const block of page.blocks ?? []) {
    if (block.kind !== "table") continue;

    const allRows = [...(block.header ? [block.header] : []), ...(block.rows ?? [])];
    for (const [rowIndex, row] of allRows.entries()) {
      const cellRects: Rect[] = [];
      const rowId = `p${page.pageNum}-table${tableIndex}-row${rowIndex}`;
      const cells: ParsedRegion[] = [];
      for (const [cellIndex, cell] of row.entries()) {
        if (cell?.bbox && cell.text.trim()) {
          const rect = toRect(cell.bbox);
          cells.push({
            id: `${rowId}-cell${cellIndex}`,
            kind: "table_cell",
            text: cell.text,
            rect,
            parentId: rowId,
          });
          cellRects.push(rect);
        }
      }
      // Row-level line too, so a quote spanning multiple cells (e.g. a whole
      // tracking-event row) still resolves to a single highlight region.
      const rowText = row
        .map((cell) => cell?.text ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (rowText && cellRects.length > 0) {
        // Put the semantic row before its cells so quote fallback prefers the
        // complete row rather than highlighting one isolated cell.
        regions.push({
          id: rowId,
          kind: "table_row",
          text: rowText,
          rect: unionRect(cellRects),
        });
        regions.push(...cells);
      }
    }
    tableIndex += 1;
  }

  // Everything else (KV letters, paragraphs, headings): group raw text items
  // into visual lines by y-coordinate. LiteParse also emits textItems for
  // table content; exclude those duplicates so the table row remains the
  // only semantic citation target for that content.
  const tableRows = regions.filter((region) => region.kind === "table_row");
  const proseLines = groupTextItemsIntoLines(page.textItems ?? [], page.pageNum).filter(
    (line) => !tableRows.some((row) => rectContainsCenter(row.rect, line.rect))
  );
  regions.push(...proseLines);

  return regions;
}

const LINE_Y_TOLERANCE = 3;

function rectContainsCenter(container: Rect, candidate: Rect): boolean {
  const centerX = candidate.x + candidate.w / 2;
  const centerY = candidate.y + candidate.h / 2;
  return (
    centerX >= container.x &&
    centerX <= container.x + container.w &&
    centerY >= container.y &&
    centerY <= container.y + container.h
  );
}

function groupTextItemsIntoLines(items: LiteTextItem[], pageNumber: number): ParsedRegion[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: ParsedRegion[] = [];

  for (const item of sorted) {
    if (!item.text.trim()) continue;
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.rect.y - item.y) <= LINE_Y_TOLERANCE) {
      last.text = `${last.text} ${item.text}`.trim();
      const right = Math.max(last.rect.x + last.rect.w, item.x + item.width);
      const bottom = Math.max(last.rect.y + last.rect.h, item.y + item.height);
      last.rect.x = Math.min(last.rect.x, item.x);
      last.rect.w = right - last.rect.x;
      last.rect.h = Math.max(last.rect.h, bottom - last.rect.y);
    } else {
      lines.push({
        id: `p${pageNumber}-line${lines.length}`,
        kind: "line",
        text: item.text,
        rect: { x: item.x, y: item.y, w: item.width, h: item.height },
      });
    }
  }
  return lines;
}
