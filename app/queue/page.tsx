"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Action, Batch, CaseRecord, Citation, Rect } from "@/lib/types";
import { Inbox } from "@/components/inbox";
import { WorkupPane } from "@/components/workup-pane";
import { SourceViewer, type SelectedCitation } from "@/components/source-viewer";

export default function QueuePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading…</div>}>
      <QueueInner />
    </Suspense>
  );
}

function QueueInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const batchId = searchParams.get("batch");

  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedCitation, setSelectedCitation] = useState<SelectedCitation | null>(null);

  useEffect(() => {
    if (!batchId) router.replace("/upload");
  }, [batchId, router]);

  // Poll for pipeline progress. See docs/PDR.md §8 — the UI never holds a
  // request open; it just re-fetches the batch snapshot every ~1.5s.
  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`/api/batches/${batchId}`, { cache: "no-store" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Batch not found");
        }
        const data: Batch = await res.json();
        if (!cancelled) {
          setBatch(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };

    load();
    const interval = setInterval(load, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [batchId]);

  // Default selection: first unreviewed case, once cases exist.
  useEffect(() => {
    if (!batch || selectedCaseId) return;
    const firstUnreviewed = batch.cases.find((c) => c.status !== "reviewed") ?? batch.cases[0];
    if (firstUnreviewed) setSelectedCaseId(firstUnreviewed.caseId);
  }, [batch, selectedCaseId]);

  const selectedCase: CaseRecord | undefined = batch?.cases.find((c) => c.caseId === selectedCaseId);

  const handleSelectCase = (caseId: string) => {
    setSelectedCaseId(caseId);
    const next = batch?.cases.find((c) => c.caseId === caseId);
    setSelectedFile(next?.files[0] ?? null);
    setSelectedCitation(null);
  };

  const handleSelectCitation = (
    file: string,
    page: number | null,
    rects: Rect[],
    sourceWidth?: number,
    evidenceKind?: Citation["evidenceKind"],
    quote?: string,
    textVerified?: boolean,
    locationResolved?: boolean,
    highlightUnit?: Citation["highlightUnit"]
  ) => {
    setSelectedFile(file);
    setSelectedCitation({
      file,
      page,
      rects,
      sourceWidth,
      evidenceKind,
      quote,
      textVerified,
      locationResolved,
      highlightUnit,
    });
  };

  const handleConfirm = async (analystAction: Action, analystRationale: string) => {
    if (!batchId || !selectedCase || !batch) return;

    const res = await fetch(`/api/cases/${selectedCase.caseId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchId, analystAction, analystRationale }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Failed to save review");
    }
    const updatedCase: CaseRecord = await res.json();

    const cases = batch.cases.map((c) => (c.caseId === updatedCase.caseId ? updatedCase : c));
    // Update the inbox from the confirmed server response immediately. Its
    // action badge prefers workup.analystAction, so analyst overrides replace
    // the recommendation tag as soon as the review is saved.
    setBatch((current) =>
      current
        ? {
            ...current,
            cases: current.cases.map((c) =>
              c.caseId === updatedCase.caseId ? updatedCase : c
            ),
          }
        : current
    );

    const nextUnreviewed = cases.find((c) => c.status !== "reviewed" && c.caseId !== updatedCase.caseId);
    if (nextUnreviewed) handleSelectCase(nextUnreviewed.caseId);
  };

  if (!batchId) return null;

  if (error && !batch) {
    return (
      <div className="p-6 text-sm text-rose-600">
        {error}.{" "}
        <button className="underline" onClick={() => router.push("/upload")}>
          Back to upload
        </button>
      </div>
    );
  }

  if (!batch) {
    return <div className="p-6 text-sm text-slate-500">Loading batch…</div>;
  }

  return (
    <div className="grid h-dvh min-h-0 grid-cols-[240px_500px_minmax(0,1fr)] overflow-hidden">
      <Inbox cases={batch.cases} selectedCaseId={selectedCaseId} onSelect={handleSelectCase} />

      {selectedCase ? (
        <WorkupPane
          key={selectedCase.caseId}
          caseRecord={selectedCase}
          onSelectCitation={handleSelectCitation}
          onConfirm={handleConfirm}
        />
      ) : (
        <div className="min-h-0 overflow-auto border-r border-slate-200 bg-white p-4 text-sm text-slate-400">
          Select a case from the inbox.
        </div>
      )}

      <SourceViewer
        batchId={batch.id}
        files={selectedCase?.files ?? []}
        missing={selectedCase?.missing ?? []}
        selectedFile={selectedFile}
        onSelectFile={(file) => {
          setSelectedFile(file);
          setSelectedCitation(null);
        }}
        citation={selectedCitation}
      />
    </div>
  );
}
