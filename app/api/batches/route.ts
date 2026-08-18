import { NextResponse } from "next/server";
import { createSampleBatch } from "@/lib/store";
import { startBatchProcessing } from "@/lib/pipeline";

// Upload/zip is out of scope for v1 (see docs/PDR.md Phase 3) — this always
// creates the sample batch from data/cases.json + data/Merchant Evidence
// Files/, which is the only batch source the UI offers ("Load sample").
export async function POST() {
  const batch = createSampleBatch();
  startBatchProcessing(batch.id);
  return NextResponse.json(batch);
}
