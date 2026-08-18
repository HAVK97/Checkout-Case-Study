import { NextResponse } from "next/server";
import { getCase } from "@/lib/store";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const batchId = new URL(req.url).searchParams.get("batch");
  if (!batchId) {
    return NextResponse.json({ error: "Missing ?batch=<batchId>" }, { status: 400 });
  }

  const caseRecord = getCase(batchId, id);
  if (!caseRecord) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 });
  }
  return NextResponse.json(caseRecord);
}
