"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileDropZone } from "@/components/file-drop-zone";
import type { Batch } from "@/lib/types";

function evidenceSourceLabel(batch: Batch): string {
  if (batch.filesDir.endsWith("Merchant Evidence Files")) {
    return "data/Merchant Evidence Files/";
  }
  return "uploaded evidence";
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return i >= 0 ? path.slice(i + 1) : path;
}

function casesWithMissing(batch: Batch) {
  return batch.cases.filter((c) => c.missing.length > 0);
}

function CaseEvidenceMapping({ cases }: { cases: Batch["cases"] }) {
  return (
    <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
      {cases.map((c) => {
        const matchedSet = new Set(c.files);
        return (
          <div key={c.caseId} className="px-4 py-3">
            <p className="text-sm font-medium text-slate-800">{c.caseId}</p>
            <ul className="mt-2 space-y-1">
              {c.raw.merchant_evidence_documents.map((doc) => {
                const name = basename(doc);
                const found = matchedSet.has(name);
                return (
                  <li key={doc} className="flex items-start gap-2 text-xs">
                    <span
                      className={found ? "text-emerald-600" : "text-rose-600"}
                      aria-hidden
                    >
                      {found ? "✓" : "✗"}
                    </span>
                    <span className={found ? "text-slate-600" : "font-medium text-rose-700"}>
                      {name}
                      {!found && (
                        <span className="font-normal text-rose-600"> · not found</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default function UploadPage() {
  const router = useRouter();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [casesFile, setCasesFile] = useState<File | null>(null);
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);

  const handleUpload = async () => {
    if (!casesFile) {
      setError("Select a cases file");
      return;
    }
    if (evidenceFiles.length === 0) {
      setError("Select at least one evidence file");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("cases", casesFile);
      for (const f of evidenceFiles) {
        fd.append("evidence", f);
      }

      const res = await fetch("/api/batches", { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Upload failed");
      }
      const data: Batch = await res.json();
      setBatch(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const missingCount = batch
    ? batch.cases.reduce((n, c) => n + c.missing.length, 0)
    : 0;
  const matchedFileCount = batch
    ? batch.cases.reduce((n, c) => n + c.files.length, 0)
    : 0;
  const problemCases = batch ? casesWithMissing(batch) : [];
  const mappingCases =
    batch && missingCount === 0 ? batch.cases : problemCases;

  const resetUpload = () => {
    setBatch(null);
    setError(null);
    setCasesFile(null);
    setEvidenceFiles([]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100/80">
      <header className="border-b border-slate-200/80 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2.5 px-6">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-xs font-bold text-white">
            C
          </div>
          <span className="text-sm font-semibold text-slate-900">Chargeback Review</span>
        </div>
      </header>

      <main className={`mx-auto px-6 py-12 sm:py-16 ${batch ? "max-w-2xl" : "max-w-xl"}`}>
        {!batch ? (
          <>
            <div className="text-center">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                Upload your dispute batch
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Upload your case export and matching merchant evidence. We&apos;ll map files to
                cases automatically.
              </p>
            </div>

            <div className="mt-8 rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm">
              <div className="space-y-5">
                <FileDropZone
                  accept=".json,application/json"
                  files={casesFile ? [casesFile] : []}
                  onFilesChange={(files) => setCasesFile(files[0] ?? null)}
                  title="Cases file"
                  emptyLabel="Drop cases.json here"
                  hint="or click to browse"
                />

                <FileDropZone
                  accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.tif,.tiff"
                  multiple
                  files={evidenceFiles}
                  onFilesChange={setEvidenceFiles}
                  title="Evidence documents"
                  emptyLabel="Drop evidence files here"
                  hint="PDF, PNG, JPG — multiple files OK"
                />
              </div>

              {error && (
                <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </p>
              )}

              <button
                onClick={handleUpload}
                disabled={loading || !casesFile || evidenceFiles.length === 0}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Uploading…
                  </>
                ) : (
                  "Continue"
                )}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-center">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                Batch ready
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Evidence mapped from{" "}
                <span className="font-medium text-slate-700">{evidenceSourceLabel(batch)}</span>
              </p>
            </div>

            <div
              className={[
                "mt-8 rounded-xl border px-4 py-3 text-sm",
                missingCount === 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-amber-200 bg-amber-50 text-amber-800",
              ].join(" ")}
            >
              {batch.cases.length} case{batch.cases.length !== 1 ? "s" : ""}
              {missingCount === 0
                ? ` · ${matchedFileCount} file${matchedFileCount !== 1 ? "s" : ""} matched`
                : ` · ${missingCount} missing file${missingCount !== 1 ? "s" : ""} across ${problemCases.length} case${problemCases.length !== 1 ? "s" : ""}`}
            </div>

            {mappingCases.length > 0 && (
              <div className="mt-4 space-y-3">
                {missingCount > 0 && (
                  <p className="text-sm text-slate-600">
                    Re-upload missing files or fix filenames, then upload again.
                  </p>
                )}
                <div className="max-h-[28rem] overflow-y-auto">
                  <CaseEvidenceMapping cases={mappingCases} />
                </div>
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => router.push(`/queue?batch=${batch.id}`)}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
              >
                {missingCount > 0 ? "Start anyway" : "Start reviewing"}
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </button>
              {missingCount > 0 && (
                <button
                  type="button"
                  onClick={resetUpload}
                  className="flex flex-1 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  Upload again
                </button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
