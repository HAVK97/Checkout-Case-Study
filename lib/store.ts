import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Batch, CaseRecord, RawCase } from "./types";

// Filesystem + in-memory store. No DB for this take-home (see docs/PDR.md
// §7.1/§10). In-memory Map is the hot path; disk under .cache/ lets a batch
// survive a dev-server restart during a demo.

const CACHE_DIR = path.join(process.cwd(), ".cache");
const BATCHES_DIR = path.join(CACHE_DIR, "batches");
const DATA_DIR = path.join(process.cwd(), "data");
export const EVIDENCE_DIR = path.join(DATA_DIR, "Merchant Evidence Files");

const batches = new Map<string, Batch>();

function ensureDirs() {
  fs.mkdirSync(BATCHES_DIR, { recursive: true });
}

function batchFilePath(id: string): string {
  return path.join(BATCHES_DIR, `${id}.json`);
}

export function saveBatch(batch: Batch): void {
  batches.set(batch.id, batch);
  ensureDirs();
  fs.writeFileSync(batchFilePath(batch.id), JSON.stringify(batch, null, 2));
}

export function getBatch(id: string): Batch | undefined {
  const cached = batches.get(id);
  if (cached) return cached;

  const file = batchFilePath(id);
  if (fs.existsSync(file)) {
    const batch = JSON.parse(fs.readFileSync(file, "utf-8")) as Batch;
    batches.set(id, batch);
    return batch;
  }
  return undefined;
}

export function getCase(batchId: string, caseId: string): CaseRecord | undefined {
  const batch = getBatch(batchId);
  return batch?.cases.find((c) => c.caseId === caseId);
}

export function updateCase(
  batchId: string,
  caseId: string,
  patch: Partial<CaseRecord>
): CaseRecord {
  const batch = getBatch(batchId);
  if (!batch) throw new Error(`Batch not found: ${batchId}`);

  const idx = batch.cases.findIndex((c) => c.caseId === caseId);
  if (idx === -1) throw new Error(`Case not found: ${caseId} in batch ${batchId}`);

  batch.cases[idx] = { ...batch.cases[idx], ...patch };
  saveBatch(batch);
  return batch.cases[idx];
}

// Load sample: map data/cases.json against data/Merchant Evidence Files by
// basename. No copying — the sample batch reads the provided dataset
// directly. Missing files do not block the case; they show up as gaps.
export function createSampleBatch(): Batch {
  const casesRaw: RawCase[] = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, "cases.json"), "utf-8")
  );
  const available = new Set(fs.readdirSync(EVIDENCE_DIR));

  const cases: CaseRecord[] = casesRaw.map((raw) => {
    const files: string[] = [];
    const missing: string[] = [];
    for (const doc of raw.merchant_evidence_documents) {
      if (available.has(doc)) files.push(doc);
      else missing.push(doc);
    }
    return {
      caseId: raw.case_id,
      raw,
      files,
      missing,
      status: "parsing",
    };
  });

  const batch: Batch = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    filesDir: EVIDENCE_DIR,
    cases,
  };
  saveBatch(batch);
  return batch;
}

export function resolveEvidenceFile(batch: Batch, filename: string): string | null {
  const safeName = path.basename(filename);
  const full = path.join(batch.filesDir, safeName);
  if (!fs.existsSync(full)) return null;
  return full;
}
