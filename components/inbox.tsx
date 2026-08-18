"use client";

import type { CaseRecord } from "@/lib/types";

const STATUS_LABEL: Record<CaseRecord["status"], string> = {
  mapping: "Mapping",
  parsing: "Parsing…",
  analysing: "Analysing…",
  ready: "Ready",
  error: "Error",
  reviewed: "Reviewed",
};

const ACTION_STYLE: Record<string, string> = {
  represent: "bg-emerald-100 text-emerald-800",
  accept_liability: "bg-rose-100 text-rose-800",
  request_more_evidence: "bg-amber-100 text-amber-800",
};

export function Inbox({
  cases,
  selectedCaseId,
  onSelect,
}: {
  cases: CaseRecord[];
  selectedCaseId: string | null;
  onSelect: (caseId: string) => void;
}) {
  const reviewedCount = cases.filter((c) => c.status === "reviewed").length;

  return (
    <div className="flex h-full flex-col overflow-y-auto border-r border-slate-200 bg-white">
      <div className="sticky top-0 border-b border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Inbox · {reviewedCount}/{cases.length} reviewed
      </div>
      {cases.map((c) => {
        const action = c.workup?.analystAction ?? c.workup?.ruleAction;
        return (
          <button
            key={c.caseId}
            onClick={() => onSelect(c.caseId)}
            className={`flex flex-col gap-1 border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
              c.caseId === selectedCaseId ? "bg-slate-100" : ""
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-800">{c.caseId}</span>
              {c.status === "reviewed" && (
                <span className="text-emerald-600" aria-label="Reviewed">
                  ✓
                </span>
              )}
            </div>
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                {c.raw.scheme.toUpperCase()} {c.raw.reason_code}
              </span>
              <span>{STATUS_LABEL[c.status]}</span>
            </div>
            {action && (
              <span
                className={`inline-block w-fit rounded px-1.5 py-0.5 text-[11px] font-medium ${ACTION_STYLE[action]}`}
              >
                {action.replace(/_/g, " ")}
              </span>
            )}
            {c.status === "error" && (
              <span className="text-xs text-rose-600">{c.error}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
