"use client";

import { useRef, useState, type DragEvent } from "react";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type FileDropZoneProps = {
  accept: string;
  multiple?: boolean;
  files: File[];
  onFilesChange: (files: File[]) => void;
  title: string;
  hint: string;
  emptyLabel: string;
};

export function FileDropZone({
  accept,
  multiple = false,
  files,
  onFilesChange,
  title,
  hint,
  emptyLabel,
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onFilesChange(multiple ? Array.from(list) : [list[0]]);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const onDragLeave = () => setDragging(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const clear = () => {
    onFilesChange([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-800">{title}</span>
        {files.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Clear
          </button>
        )}
      </div>

      <div
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onClick={() => inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={[
          "cursor-pointer rounded-lg border-2 border-dashed px-4 py-5 transition-colors",
          dragging
            ? "border-indigo-400 bg-indigo-50"
            : files.length > 0
              ? "border-indigo-200 bg-indigo-50/40"
              : "border-slate-200 bg-slate-50/50 hover:border-slate-300 hover:bg-slate-50",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {files.length === 0 ? (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
              <svg className="h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">{emptyLabel}</p>
              <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
            </div>
          </div>
        ) : multiple ? (
          <div>
            <p className="text-sm font-medium text-slate-800">
              {files.length} file{files.length !== 1 ? "s" : ""} selected
            </p>
            <ul className="mt-2 max-h-24 space-y-1 overflow-y-auto">
              {files.slice(0, 6).map((f) => (
                <li key={f.name} className="text-xs text-slate-600">
                  {f.name}
                  <span className="text-slate-400"> · {formatBytes(f.size)}</span>
                </li>
              ))}
              {files.length > 6 && (
                <li className="text-xs text-slate-400">+{files.length - 6} more</li>
              )}
            </ul>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-indigo-200">
              <svg className="h-5 w-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">{files[0].name}</p>
              <p className="mt-0.5 text-xs text-slate-500">{formatBytes(files[0].size)}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
