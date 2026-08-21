"use client";

import { useEffect, useState } from "react";
import { getReasonCode, matchRuleIntro } from "@/lib/rules";
import type { Action, CaseRecord, Citation, Rect, RequirementResult } from "@/lib/types";
import type { SelectedCitation } from "@/components/source-viewer";

const STATUS_STYLE: Record<string, string> = {
  satisfied: "text-emerald-700",
  partial: "text-amber-700",
  missing: "text-rose-700",
  "n/a": "text-slate-400",
};

const STATUS_ICON: Record<string, string> = {
  satisfied: "✓",
  partial: "◐",
  missing: "×",
  "n/a": "—",
};

const ACTION_OPTIONS: { value: Action; label: string }[] = [
  { value: "represent", label: "Represent" },
  { value: "accept_liability", label: "Accept liability" },
  { value: "request_more_evidence", label: "Request more evidence" },
];

const ACTION_TEXT_STYLE: Record<Action, string> = {
  represent: "text-emerald-700",
  accept_liability: "text-rose-700",
  request_more_evidence: "text-amber-700",
};

function ActionBadge({ action }: { action: Action }) {
  return <span className={`font-semibold ${ACTION_TEXT_STYLE[action]}`}>{action.replace(/_/g, " ")}</span>;
}

function TransactionSignalsStrip({
  avs,
  cvv,
  threeDs,
  billingPostcode,
  shippingPostcode,
  billingShippingMismatch,
}: {
  avs: string | null;
  cvv: string | null;
  threeDs: string;
  billingPostcode: string;
  shippingPostcode: string | null;
  billingShippingMismatch: boolean;
}) {
  const segments: { key: string; label: string; value: string; warn?: boolean }[] = [
    { key: "avs", label: "AVS", value: avs ?? "n/a" },
    { key: "cvv", label: "CVV", value: cvv ?? "n/a" },
    { key: "3ds", label: "3DS", value: threeDs.replace(/_/g, " ") },
  ];

  if (billingShippingMismatch && shippingPostcode != null) {
    segments.push({
      key: "postcodes",
      label: "Postcodes",
      value: `${billingPostcode} ≠ ${shippingPostcode}`,
      warn: true,
    });
  } else if (shippingPostcode != null) {
    segments.push({ key: "postcodes", label: "Postcodes", value: "match" });
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
      {segments.map((segment, index) => (
        <span key={segment.key} className="flex items-baseline gap-1">
          {index > 0 && <span className="mr-1 text-slate-300">·</span>}
          <span className="font-medium text-slate-500">
            {segment.label}
          </span>
          <span className={segment.warn ? "font-medium text-amber-700" : "text-slate-600"}>
            {segment.value}
          </span>
        </span>
      ))}
    </div>
  );
}

function citationSourceKey(citation: Citation): string {
  const target =
    citation.regionIds?.length > 0
      ? [...citation.regionIds].sort().join(",")
      : citation.quote.trim().toLowerCase();
  return `${citation.file}:${citation.page ?? ""}:${target}`;
}

function decisionBullets(rationale: string): string[] {
  const lines = rationale
    .split(/\n+/)
    .map((line) => line.replace(/^[\s•*-]+/, "").trim())
    .filter(Boolean);
  if (lines.length > 1) return lines;

  return rationale
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function formatRationaleForEditor(text: string): string {
  if (!text.trim()) return "";
  if (/^\s*[-•*]\s/m.test(text)) return text;
  return decisionBullets(text)
    .map((line) => `- ${line}`)
    .join("\n");
}

function initialRationale(workup: NonNullable<CaseRecord["workup"]>): string {
  if (workup.analystRationale) return workup.analystRationale;
  return formatRationaleForEditor(workup.rationale);
}

function RequirementRow({
  req,
  sourceNumbers,
  sourceRects,
  onSelectCitation,
}: {
  req: RequirementResult;
  sourceNumbers: Map<string, number>;
  sourceRects: Map<string, Rect[]>;
  onSelectCitation: (citation: SelectedCitation) => void;
}) {
  const seen = new Set<number>();
  return (
    <div className="border-b border-slate-100 py-3 last:border-b-0">
      <div className="grid grid-cols-[20px_1fr] items-start gap-2">
        <span className={`text-base font-semibold leading-5 ${STATUS_STYLE[req.status]}`} aria-hidden="true">
          {STATUS_ICON[req.status]}
        </span>
        <div>
          <div className="text-sm font-medium leading-5 text-slate-800">{req.label}</div>
          {req.gap && <p className="mt-1 text-xs leading-5 text-slate-600">{req.gap}</p>}
          {req.citations.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {req.citations.map((citation, index) => {
                const key = citationSourceKey(citation);
                const sourceNumber = sourceNumbers.get(key) ?? index + 1;
                if (seen.has(sourceNumber)) return null;
                seen.add(sourceNumber);
                const mergedRects = sourceRects.get(key) ?? citation.rects;
                const textVerified = citation.textVerified;
                const locationResolved = mergedRects.length > 0;
                return (
                  <button
                    key={`${citation.file}:${citation.page}:${index}`}
                    onClick={() =>
                      onSelectCitation({
                        file: citation.file,
                        page: citation.page,
                        rects: mergedRects,
                        sourceWidth: citation.sourceWidth,
                        evidenceKind: citation.evidenceKind,
                        quote: citation.quote,
                        textVerified,
                        locationResolved,
                        highlightUnit: citation.highlightUnit,
                      })
                    }
                    title={`${citation.file}${citation.page != null ? `, page ${citation.page}` : ""}`}
                    aria-label={`Open source ${sourceNumber}: ${citation.file}`}
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition ${
                      citation.textVerified || citation.evidenceKind === "visual_observation"
                        ? "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        : "border border-dashed border-slate-300 text-slate-400 hover:bg-slate-50"
                    }`}
                  >
                    [{sourceNumber}
                    {!locationResolved ? (textVerified ? " page" : " ?") : ""}]
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function WorkupPane({
  caseRecord,
  onSelectCitation,
  onConfirm,
}: {
  caseRecord: CaseRecord;
  onSelectCitation: (citation: SelectedCitation) => void;
  onConfirm: (action: Action, rationale: string) => Promise<void>;
}) {
  const { raw, workup } = caseRecord;

  const [analystAction, setAnalystAction] = useState<Action>(
    workup?.analystAction ?? workup?.ruleAction ?? "request_more_evidence"
  );
  const [rationale, setRationale] = useState(
    workup ? initialRationale(workup) : ""
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!workup) return;
    setAnalystAction(workup.analystAction ?? workup.ruleAction ?? "request_more_evidence");
    setRationale(initialRationale(workup));
  }, [
    caseRecord.caseId,
    workup?.rationale,
    workup?.analystRationale,
    workup?.analystAction,
    workup?.ruleAction,
  ]);

  if (caseRecord.status === "mapping" || caseRecord.status === "parsing") {
    return <div className="p-4 text-sm text-slate-500">Parsing evidence…</div>;
  }
  if (caseRecord.status === "analysing") {
    return <div className="p-4 text-sm text-slate-500">Generating workup with Claude…</div>;
  }
  if (caseRecord.status === "error" || !workup) {
    return (
      <div className="p-4 text-sm text-rose-600">
        Failed to generate a workup: {caseRecord.error ?? "unknown error"}
      </div>
    );
  }

  const reasonCode = getReasonCode(raw.scheme, raw.reason_code);
  const billingShippingMismatch =
    raw.transaction.shipping_address_postcode != null &&
    raw.transaction.shipping_address_postcode !== raw.transaction.billing_address_postcode;
  const applicableRequirements = workup.requirements.filter((req) => req.status !== "n/a");
  const metRequirements = applicableRequirements.filter((req) => req.status === "satisfied").length;
  const sourceNumbers = new Map<string, number>();
  const sourceRects = new Map<string, Rect[]>();
  const sources: Citation[] = [];

  for (const requirement of workup.requirements) {
    for (const citation of requirement.citations) {
      const key = citationSourceKey(citation);
      if (!sourceNumbers.has(key)) {
        sourceNumbers.set(key, sources.length + 1);
        sourceRects.set(key, [...citation.rects]);
        sources.push(citation);
      } else {
        const existing = sourceRects.get(key)!;
        for (const r of citation.rects) {
          if (!existing.some((e) => e.x === r.x && e.y === r.y && e.w === r.w && e.h === r.h)) {
            existing.push(r);
          }
        }
      }
    }
  }

  const handleConfirmClick = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onConfirm(analystAction, rationale);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain bg-white">
      <header className="border-b border-slate-200 px-5 py-4">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {raw.scheme.toUpperCase()} {raw.reason_code} · {reasonCode.label}
        </div>
        <section className="mt-5">
          <h2 className="text-sm font-semibold text-slate-900">Issuer claim</h2>
          <p className="mt-1.5 text-sm leading-6 text-slate-600">{raw.issuer_narrative}</p>
        </section>
        <div className="mt-3.5">
          <TransactionSignalsStrip
            avs={raw.transaction.avs_result}
            cvv={raw.transaction.cvv_result}
            threeDs={raw.transaction.three_ds_status}
            billingPostcode={raw.transaction.billing_address_postcode}
            shippingPostcode={raw.transaction.shipping_address_postcode}
            billingShippingMismatch={billingShippingMismatch}
          />
        </div>
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-slate-900">To defend</h2>
          <p className="mt-1.5 text-sm leading-6 text-slate-700">
            {matchRuleIntro(reasonCode.match)}
          </p>
          <ul className="mt-2.5 space-y-2.5">
            {reasonCode.requirements.map((req) => (
              <li key={req.id} className="grid grid-cols-[10px_1fr] gap-2 text-sm leading-6 text-slate-600">
                <span className="text-slate-400">•</span>
                <span>{req.label}</span>
              </li>
            ))}
          </ul>
        </section>
      </header>

      {reasonCode.match.type === "exception" && (
        <div className="mx-5 mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Exception reason code.</strong> {reasonCode.exceptionNote}
        </div>
      )}

      <main className="space-y-6 px-5 py-5">
        <section className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Recommendation
          </div>
          <div className="mt-1 flex items-end justify-between gap-3">
            <ActionBadge action={workup.ruleAction} />
            <span className="text-xs text-slate-500">
              {metRequirements}/{applicableRequirements.length} applicable requirements met
            </span>
          </div>
        </section>

        <section>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Requirements
          </h2>
          <div className="mt-2 border-y border-slate-200">
            {workup.requirements.map((req) => (
              <RequirementRow
                key={req.id}
                req={req}
                sourceNumbers={sourceNumbers}
                sourceRects={sourceRects}
                onSelectCitation={onSelectCitation}
              />
            ))}
          </div>
        </section>

        {workup.askMerchant.length > 0 && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">
              Ask merchant for
            </h2>
            <ul className="mt-2 space-y-2 text-sm leading-5 text-slate-700">
              {workup.askMerchant.map((item, index) => (
                <li key={index} className="grid grid-cols-[18px_1fr] gap-1">
                  <span className="text-amber-600">•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

      </main>

      <section className="mt-auto space-y-3 border-t border-slate-200 bg-white px-5 py-4">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Analyst decision
          </h2>
        </div>
        <label className="block text-xs font-medium text-slate-600">
          Analyst action
          <select
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
            value={analystAction}
            onChange={(e) => setAnalystAction(e.target.value as Action)}
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-xs font-medium text-slate-600">
          Rationale
          <textarea
            className="mt-1 block min-h-52 w-full resize-y rounded border border-slate-300 px-3 py-2 text-sm leading-6 text-slate-800"
            rows={14}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        </label>

        {saveError && <div className="text-xs text-rose-600">{saveError}</div>}

        <button
          onClick={handleConfirmClick}
          disabled={saving}
          className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : caseRecord.status === "reviewed" ? "Update review" : "Confirm"}
        </button>
      </section>
    </div>
  );
}
