import fs from "node:fs";
import { NextResponse } from "next/server";
import { getBatch, resolveEvidenceFile } from "@/lib/store";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

// Raw file serving for the source viewer (PDF.js / <img>). `resolveEvidenceFile`
// basenames the requested name before joining it to the batch's evidence
// directory, so a malicious `name` can't escape it via `../`.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const batchId = new URL(req.url).searchParams.get("batch");
  if (!batchId) {
    return NextResponse.json({ error: "Missing ?batch=<batchId>" }, { status: 400 });
  }

  const batch = getBatch(batchId);
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const filePath = resolveEvidenceFile(batch, name);
  if (!filePath) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const data = fs.readFileSync(filePath);

  return new NextResponse(data, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
