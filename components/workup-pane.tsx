"use client";

import { useState } from "react";
import { getReasonCode } from "@/lib/rules";
import type { Action, CaseRecord, Citation, Rect, RequirementResult } from "@/lib/types";

const STATUS_STYLE: Record<string, string> = {
  satisfied: "border-emerald-200 bg-emerald-50",
  partial: "border-amber-200 bg-amber-50",
  missing: "border-rose-200 bg-rose-50",
  "n/a": "border-slate-200 bg-slate-50",
};

const STATUS_BADGE: Record<string, string> = {
  satisfied: "bg-emerald-600 text-white",
  partial: "bg-amber-500 text-white",
  missing: "bg-rose-600 text-white",
  "n/a": "bg-slate-400 text-white",
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

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function ActionBadge({ action }: { action: Action }) {
  return <span className={`font-semibold ${ACTION_TEXT_STYLE[action]}`}>{action.replace(/_/g, " ")}</span>;
}

function Chip({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <span
      className={`rounded border px-2 py-1 ${
        warn ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      <span className="font-medium">{label}:</span> {value}
    </span>
  );
}

function RequirementRow({
  req,
  onSelectCitation,
}: {
  req: RequirementResult;
  onSelectCitation: (
    file: string,
    page: number | null,
    rects: Rect[],
    sourceWidth?: number,
    evidenceKind?: Citation["evidenceKind"]
  ) => void;
}) {
  return (
    <div className={`rounded border px-3 py-2 ${STATUS_STYLE[req.status]}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-slate-800">{req.label}</span>
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE[req.status]}`}
        >
          {req.status}
        </span>
      </div>
      {req.gap && <p className="mt-1 text-xs text-slate-600">{req.gap}</p>}
      {req.citations.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {req.citations.map((c, i) => (
            <button
              key={i}
              onClick={() =>
                onSelectCitation(c.file, c.page, c.rects, c.sourceWidth, c.evidenceKind)
              }
              title={c.quote}
              className={`rounded border px-2 py-1 text-left text-[11px] transition ${
                c.evidenceKind === "visual_observation"
                  ? "border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100"
                  : c.verified
                  ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  : "border-dashed border-slate-300 bg-white/60 text-slate-400 hover:bg-white"
              }`}
            >
              {c.evidenceKind === "visual_observation"
                ? "◉ AI vision"
                : c.verified
                  ? "✓ OCR"
                  : "⚠ Unverified"}{" "}
              · {c.file}
              {c.page != null ? ` p.${c.page}` : ""} — &ldquo;{truncate(c.quote, 40)}&rdquo;
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkupPane({
  caseRecord,
  onSelectCitation,
  onConfirm,
}: {
  caseRecord: CaseRecord;
  onSelectCitation: (
    file: string,
    page: number | null,
    rects: Rect[],
    sourceWidth?: number,
    evidenceKind?: Citation["evidenceKind"]
  ) => void;
  onConfirm: (action: Action, rationale: string) => Promise<void>;
}) {
  const { raw, workup } = caseRecord;

  const [analystAction, setAnalystAction] = useState<Action>(
    workup?.analystAction ?? workup?.ruleAction ?? "request_more_evidence"
  );
  const [rationale, setRationale] = useState(workup?.analystRationale ?? workup?.rationale ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
  const disagreement = workup.proposedAction !== workup.ruleAction;

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
    <div className="flex h-full flex-col overflow-y-auto bg-white">
      <div className="border-b border-slate-200 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {raw.scheme.toUpperCase()} {raw.reason_code} · {reasonCode.label}
        </div>
        <p className="mt-1 text-sm text-slate-700">{workup.reasonSummary}</p>
      </div>

      {reasonCode.match.type === "exception" && (
        <div className="mx-4 mt-3 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <strong>Exception reason code.</strong> {reasonCode.exceptionNote}
        </div>
      )}

      <div className="flex flex-wrap gap-2 px-4 py-3 text-xs">
        <Chip label="AVS" value={raw.transaction.avs_result ?? "n/a"} />
        <Chip label="CVV" value={raw.transaction.cvv_result ?? "n/a"} />
        <Chip label="3DS" value={raw.transaction.three_ds_status} />
        <Chip
          label="Billing vs shipping"
          value={
            billingShippingMismatch
              ? `${raw.transaction.billing_address_postcode} ≠ ${raw.transaction.shipping_address_postcode}`
              : "match"
          }
          warn={billingShippingMismatch}
        />
      </div>

      <div className="px-4 py-2">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Compelling evidence checklist
        </div>
        <div className="space-y-2">
          {workup.requirements.map((req) => (
            <RequirementRow key={req.id} req={req} onSelectCitation={onSelectCitation} />
          ))}
        </div>
      </div>

      <div className="mt-auto space-y-3 border-t border-slate-200 px-4 py-3">
        <p className="text-sm text-slate-700">{workup.rationale}</p>

        <div className="text-sm">
          <span className="font-medium text-slate-600">Rule-checked action: </span>
          <ActionBadge action={workup.ruleAction} />
          {disagreement && (
            <span className="ml-2 text-xs text-amber-700">
              (model proposed <ActionBadge action={workup.proposedAction} />)
            </span>
          )}
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
            className="mt-1 block w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
            rows={3}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
        </label>

        {workup.askMerchant.length > 0 && (
          <div className="text-xs">
            <div className="font-medium text-slate-600">Ask merchant for:</div>
            <ul className="ml-4 list-disc text-slate-600">
              {workup.askMerchant.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {saveError && <div className="text-xs text-rose-600">{saveError}</div>}

        <button
          onClick={handleConfirmClick}
          disabled={saving}
          className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : caseRecord.status === "reviewed" ? "Update review" : "Confirm"}
        </button>
      </div>
    </div>
  );
}
