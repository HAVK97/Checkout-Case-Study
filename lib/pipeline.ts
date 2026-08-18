import path from "node:path";
import type { CaseRecord, ParsedDoc } from "./types";
import { parseDocument } from "./parse";
import { generateWorkupDraft } from "./workup";
import { resolveWorkup } from "./resolver";
import { getReasonCode } from "./rules";
import { getBatch, updateCase } from "./store";

const PARSE_CONCURRENCY = 4;

// Fire-and-forget: the UI polls GET /api/batches/[id] for progress rather
// than holding a request open. See docs/PDR.md §8 (pipeline).
export function startBatchProcessing(batchId: string): void {
  void runBatch(batchId).catch((err) => {
    console.error(`[pipeline] batch ${batchId} failed:`, err);
  });
}

async function runBatch(batchId: string): Promise<void> {
  const batch = getBatch(batchId);
  if (!batch) throw new Error(`Batch not found: ${batchId}`);

  // De-duplicate files shared across cases so each is parsed exactly once,
  // then fan the result out to every case that references it.
  const uniqueFiles = Array.from(new Set(batch.cases.flatMap((c) => c.files)));
  const parsedByFile = new Map<string, ParsedDoc>();

  await runWithConcurrency(uniqueFiles, PARSE_CONCURRENCY, async (filename) => {
    const absPath = path.join(batch.filesDir, filename);
    try {
      parsedByFile.set(filename, await parseDocument(absPath, filename));
    } catch (err) {
      parsedByFile.set(filename, {
        file: filename,
        kind: /\.(png|jpe?g|gif|bmp|tiff?|webp)$/i.test(filename) ? "image" : "pdf",
        source: "none",
        pages: [],
        error: (err as Error).message,
      });
    }
    // A case moves to "analysing" as soon as every file IT needs has
    // landed — it never waits on unrelated files (e.g. CB-2025-0001 doesn't
    // wait on CB-2025-0007's 10-page manifest).
    advanceReadyCases(batchId, parsedByFile);
  });

  // Cases with zero matched files (everything missing) never satisfy the
  // "every file has landed" check above — sweep them once parsing is done.
  advanceReadyCases(batchId, parsedByFile, true);
}

// Synchronous by design: reading batch state, deciding which cases are
// ready, and flipping their status to "analysing" all happen with no
// `await` in between, so concurrent parse callbacks can never double-claim
// the same case (Node's single-threaded event loop runs each synchronous
// stretch to completion before another callback can interleave).
function advanceReadyCases(
  batchId: string,
  parsedByFile: Map<string, ParsedDoc>,
  force = false
): void {
  const batch = getBatch(batchId);
  if (!batch) return;

  const ready = batch.cases.filter(
    (c) => c.status === "parsing" && (force || c.files.every((f) => parsedByFile.has(f)))
  );

  for (const caseRecord of ready) {
    updateCase(batchId, caseRecord.caseId, { status: "analysing" });
    void analyseCase(batchId, caseRecord, parsedByFile, batch.filesDir);
  }
}

async function analyseCase(
  batchId: string,
  caseRecord: CaseRecord,
  parsedByFile: Map<string, ParsedDoc>,
  evidenceDir: string
): Promise<void> {
  try {
    const docs = caseRecord.files
      .map((f) => parsedByFile.get(f))
      .filter((d): d is ParsedDoc => Boolean(d));
    const docsByFile = new Map(docs.map((d) => [d.file, d]));

    const draft = await generateWorkupDraft(caseRecord.raw, docs, evidenceDir);
    const reasonCode = getReasonCode(caseRecord.raw.scheme, caseRecord.raw.reason_code);
    const workup = resolveWorkup(draft, reasonCode, docsByFile);

    updateCase(batchId, caseRecord.caseId, { status: "ready", workup });
  } catch (err) {
    console.error(`[pipeline] case ${caseRecord.caseId} failed:`, err);
    updateCase(batchId, caseRecord.caseId, {
      status: "error",
      error: (err as Error).message,
    });
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workerCount = Math.min(concurrency, queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
