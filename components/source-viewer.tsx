"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Citation, Rect } from "@/lib/types";

export interface SelectedCitation {
  file: string;
  page: number | null;
  rects: Rect[];
  sourceWidth?: number;
  evidenceKind?: Citation["evidenceKind"];
  quote?: string;
  textVerified?: boolean;
  locationResolved?: boolean;
  highlightUnit?: Citation["highlightUnit"];
}

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|bmp|webp)$/i;

function fileUrl(batchId: string, file: string): string {
  return `/api/files/${encodeURIComponent(file)}?batch=${encodeURIComponent(batchId)}`;
}

function HighlightOverlay({ rects, scale }: { rects: Rect[]; scale: number }) {
  const padding = 3;
  return (
    <>
      {rects.map((r, i) => (
        <div
          key={i}
          className="highlight-rect"
          style={{
            left: Math.max(0, r.x * scale - padding),
            top: Math.max(0, r.y * scale - padding),
            width: r.w * scale + padding * 2,
            height: r.h * scale + padding * 2,
          }}
        />
      ))}
    </>
  );
}

function ImageViewer({
  batchId,
  file,
  citation,
}: {
  batchId: string;
  file: string;
  citation: SelectedCitation | null;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [scale, setScale] = useState(1);

  const updateScale = () => {
    const img = imgRef.current;
    if (img && img.naturalWidth) {
      setScale(img.clientWidth / (citation?.sourceWidth ?? img.naturalWidth));
    }
  };

  useEffect(() => {
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [file, citation?.sourceWidth]);

  const rects = citation?.rects ?? [];
  const showFallbackRing = citation != null && rects.length === 0;

  return (
    <div className="relative inline-block max-w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={fileUrl(batchId, file)}
        alt={file}
        onLoad={updateScale}
        className="max-w-full rounded border border-slate-200 bg-white"
      />
      <HighlightOverlay rects={rects} scale={scale} />
      {showFallbackRing && (
        <div className="pointer-events-none absolute inset-0 rounded ring-2 ring-amber-400 ring-offset-2" />
      )}
    </div>
  );
}

function PdfViewer({
  batchId,
  file,
  citation,
}: {
  batchId: string;
  file: string;
  citation: SelectedCitation | null;
}) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load the document whenever the selected file changes.
  useEffect(() => {
    let cancelled = false;
    setPdfDoc(null);
    setNumPages(0);
    setPageNum(1);
    setLoadError(null);

    (async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();
        const doc = await pdfjsLib.getDocument({ url: fileUrl(batchId, file) }).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [batchId, file]);

  // Jump to the cited page once the doc for this file is loaded.
  useEffect(() => {
    if (citation?.page && citation.file === file) {
      setPageNum(citation.page);
    }
  }, [citation, file]);

  // Render the current page to the canvas.
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;
    let renderTask: { promise: Promise<void>; cancel: () => void } | null = null;

    (async () => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        const baseViewport = page.getViewport({ scale: 1 });
        const containerWidth = containerRef.current?.clientWidth ?? 800;
        const renderScale = Math.max(
          0.5,
          Math.min(1.8, (containerWidth - 8) / baseViewport.width)
        );
        const viewport = page.getViewport({ scale: renderScale });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        renderTask = page.render({ canvas, canvasContext: ctx, viewport });
        await renderTask.promise;
        if (cancelled) return;
        setScale(renderScale);
        setCanvasSize({ width: viewport.width, height: viewport.height });
      } catch (err) {
        if (!cancelled && (err as { name?: string }).name !== "RenderingCancelledException") {
          setLoadError((err as Error).message);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdfDoc, pageNum]);

  if (loadError) {
    return <div className="text-sm text-rose-600">Failed to load PDF: {loadError}</div>;
  }

  const rects = citation && citation.file === file && citation.page === pageNum ? citation.rects : [];

  return (
    <div ref={containerRef}>
      <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
        <button
          onClick={() => setPageNum((p) => Math.max(1, p - 1))}
          disabled={pageNum <= 1}
          className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
        >
          ‹ Prev
        </button>
        <span>
          Page {pageNum} / {numPages || "…"}
        </span>
        <button
          onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
          disabled={pageNum >= numPages}
          className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
        >
          Next ›
        </button>
      </div>
      <div
        className="relative inline-block"
        style={{ width: canvasSize.width || undefined, height: canvasSize.height || undefined }}
      >
        <canvas ref={canvasRef} className="rounded border border-slate-200 bg-white shadow-sm" />
        <HighlightOverlay rects={rects} scale={scale} />
      </div>
    </div>
  );
}

export function SourceViewer({
  batchId,
  files,
  missing,
  selectedFile,
  onSelectFile,
  citation,
}: {
  batchId: string;
  files: string[];
  missing: string[];
  selectedFile: string | null;
  onSelectFile: (file: string) => void;
  citation: SelectedCitation | null;
}) {
  const isImage = selectedFile ? IMAGE_EXTENSION.test(selectedFile) : false;
  const selectedSource = citation?.file === selectedFile ? citation : null;
  const locationResolved = selectedSource
    ? (selectedSource.locationResolved ?? selectedSource.rects.length > 0)
    : false;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-50">
      <div className="shrink-0 flex flex-wrap gap-1 border-b border-slate-200 bg-white px-2 py-1.5">
        {files.map((f) => (
          <button
            key={f}
            onClick={() => onSelectFile(f)}
            className={`rounded px-2 py-1 text-xs ${
              f === selectedFile ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {f}
          </button>
        ))}
        {missing.map((f) => (
          <span
            key={f}
            title="Referenced by the case but not found on disk"
            className="rounded bg-rose-50 px-2 py-1 text-xs text-rose-400 line-through"
          >
            {f}
          </span>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-4">
        {!selectedFile && <div className="text-sm text-slate-400">No evidence file selected.</div>}
        {selectedSource && !locationResolved && selectedSource.evidenceKind !== "visual_observation" && (
          <div
            className={`mb-3 rounded border px-3 py-2 text-xs ${
              selectedSource.textVerified
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : "border-slate-200 bg-white text-slate-600"
            }`}
          >
            <span className="font-semibold">
              {selectedSource.textVerified ? "Source verified on this page." : "Exact source not verified."}
            </span>{" "}
            {selectedSource.textVerified
              ? "The parser could not recover a precise location."
              : "Check the document manually before relying on this citation."}
            {selectedSource.quote && (
              <div className="mt-1 border-l-2 border-current pl-2 opacity-80">
                &ldquo;{selectedSource.quote}&rdquo;
              </div>
            )}
          </div>
        )}
        {selectedFile && isImage && (
          <>
            {selectedSource?.evidenceKind === "visual_observation" && (
                <div className="mb-3 rounded border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
                  <span className="font-semibold">AI visual observation:</span>{" "}
                  {selectedSource.rects.length === 0
                    ? "The whole image is the source; verify the visible fact directly."
                    : "Verify the highlighted region directly."}
                </div>
              )}
            <ImageViewer
              batchId={batchId}
              file={selectedFile}
              citation={selectedSource}
            />
          </>
        )}
        {selectedFile && !isImage && (
          <PdfViewer
            batchId={batchId}
            file={selectedFile}
            citation={selectedSource}
          />
        )}
      </div>
    </div>
  );
}
