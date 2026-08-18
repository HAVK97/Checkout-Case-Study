import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { LiteParse } from "@llamaindex/liteparse";
import type {
  TextItem as LiteTextItem,
  ParsedPage as LiteParsedPage,
  Rect as LiteRect,
} from "@llamaindex/liteparse";
import type { ParsedDoc, ParsedLine, ParsedPage, Rect } from "./types";

// Citation/highlight resolution always goes through LiteParse: it runs
// locally (no API key), and its typed `blocks` (table cells with real text +
// bbox) and `textItems` (grouped into visual lines below) give reliable,
// testable grounding for both PDFs and images (LiteParse OCRs images
// natively — see docs/PDR.md §9). When LLAMA_CLOUD_API_KEY is set, LlamaParse
// is additionally used to upgrade each page's *text* (better structure on
// complex layouts) — but never for bounding boxes, so the highlight path
// works identically with or without a LlamaCloud key.

const PARSE_CACHE_DIR = path.join(process.cwd(), ".cache", "parse");
const PARSE_CACHE_VERSION = "v3-image-mode";

function ensureCacheDir(): void {
  fs.mkdirSync(PARSE_CACHE_DIR, { recursive: true });
}

function hashFile(absPath: string): string {
  const buf = fs.readFileSync(absPath);
  const parserMode = process.env.LLAMA_CLOUD_API_KEY ? "llamaparse" : "liteparse";
  return crypto
    .createHash("sha256")
    .update(buf)
    .update(`${PARSE_CACHE_VERSION}:${parserMode}`)
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

  if (process.env.LLAMA_CLOUD_API_KEY) {
    try {
      await enrichWithLlamaParseText(absPath, doc);
    } catch (err) {
      console.warn(
        `[parse] LlamaParse text enrichment failed for ${basename}, keeping LiteParse text:`,
        (err as Error).message
      );
    }
  }

  writeCache(hash, doc);
  return doc;
}

// ---- LiteParse: text + grounding (always runs) ----

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
      lines: buildLinesForPage(page),
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
  const lines = pages.flatMap((page) => page.lines).filter((line) => /[\p{L}\p{N}]/u.test(line.text));
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
function buildLinesForPage(page: LiteParsedPage): ParsedLine[] {
  const lines: ParsedLine[] = [];

  for (const block of page.blocks ?? []) {
    if (block.kind !== "table") continue;

    const allRows = [...(block.header ? [block.header] : []), ...(block.rows ?? [])];
    for (const row of allRows) {
      const cellRects: Rect[] = [];
      for (const cell of row) {
        if (cell?.bbox && cell.text.trim()) {
          const rect = toRect(cell.bbox);
          lines.push({ text: cell.text, rect });
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
        lines.push({ text: rowText, rect: unionRect(cellRects) });
      }
    }
  }

  // Everything else (KV letters, paragraphs, headings): group raw text items
  // into visual lines by y-coordinate for line-level highlight granularity.
  lines.push(...groupTextItemsIntoLines(page.textItems ?? []));

  return lines;
}

const LINE_Y_TOLERANCE = 3;

function groupTextItemsIntoLines(items: LiteTextItem[]): ParsedLine[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: ParsedLine[] = [];

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
        text: item.text,
        rect: { x: item.x, y: item.y, w: item.width, h: item.height },
      });
    }
  }
  return lines;
}

// ---- LlamaParse: optional text-quality upgrade (never used for bboxes) ----

async function enrichWithLlamaParseText(
  absPath: string,
  doc: ParsedDoc
): Promise<void> {
  const { default: LlamaCloud } = await import("@llamaindex/llama-cloud");
  const client = new LlamaCloud();

  const result = await client.parsing.parse({
    tier: "cost_effective",
    version: "latest",
    upload_file: fs.createReadStream(absPath),
    expand: ["markdown"],
  });

  const pages = result.markdown?.pages;
  if (!pages || pages.length === 0) return;

  for (const page of pages) {
    if (!("markdown" in page) || !page.success) continue;
    const target = doc.pages.find((p) => p.pageNumber === page.page_number);
    if (target && page.markdown.trim()) {
      target.text = page.markdown;
    }
  }
  doc.source = "llamaparse";
}
