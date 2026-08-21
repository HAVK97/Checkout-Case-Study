import { NextResponse } from "next/server";
import { createSampleBatch, createUploadedBatch } from "@/lib/store";
import { startBatchProcessing } from "@/lib/pipeline";
import type { RawCase } from "@/lib/types";

export const runtime = "nodejs";

function parseCasesJson(text: string): RawCase[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error("cases.json must be a JSON array");
  }
  for (const c of parsed) {
    if (typeof c !== "object" || c === null) {
      throw new Error("Invalid case: expected an object");
    }
    const row = c as Record<string, unknown>;
    if (typeof row.case_id !== "string" || typeof row.scheme !== "string" || typeof row.reason_code !== "string") {
      throw new Error("Invalid case: missing case_id, scheme, or reason_code");
    }
    if (!Array.isArray(row.merchant_evidence_documents)) {
      throw new Error(`Case ${row.case_id}: merchant_evidence_documents must be an array`);
    }
  }
  return parsed as RawCase[];
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";

  try {
    let batch;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();

      const casesEntry = form.get("cases");
      if (!(casesEntry instanceof File)) {
        return NextResponse.json({ error: "Missing cases.json file (field: cases)" }, { status: 400 });
      }

      const casesRaw = parseCasesJson(await casesEntry.text());

      const evidenceFiles: { name: string; data: Buffer }[] = [];
      for (const entry of form.getAll("evidence")) {
        if (entry instanceof File && entry.size > 0) {
          evidenceFiles.push({
            name: entry.name,
            data: Buffer.from(await entry.arrayBuffer()),
          });
        }
      }

      if (evidenceFiles.length === 0) {
        return NextResponse.json(
          { error: "Upload at least one evidence file (field: evidence)" },
          { status: 400 }
        );
      }

      batch = createUploadedBatch(casesRaw, evidenceFiles);
    } else {
      batch = createSampleBatch();
    }

    startBatchProcessing(batch.id);
    return NextResponse.json(batch);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
