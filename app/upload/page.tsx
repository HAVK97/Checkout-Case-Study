"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Batch } from "@/lib/types";

export default function UploadPage() {
  const router = useRouter();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLoadSample = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/batches", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to load sample batch");
      }
      const data: Batch = await res.json();
      setBatch(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900">Representment Workup</h1>
      <p className="mt-2 text-sm text-slate-600">
        Load the sample dataset — 10 chargeback cases and their merchant
        evidence documents — and start reviewing. Parsing and the Claude
        workup run in the background once you start; the queue polls for
        progress.
      </p>

      {!batch && (
        <button
          onClick={handleLoadSample}
          disabled={loading}
          className="mt-6 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "Mapping evidence…" : "Load sample"}
        </button>
      )}

      {error && (
        <p className="mt-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      {batch && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-slate-700">
            Mapped {batch.cases.length} cases against{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
              data/Merchant Evidence Files/
            </code>
          </h2>

          <table className="mt-3 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <th className="py-1.5">Case</th>
                <th className="py-1.5">Reason code</th>
                <th className="py-1.5">Matched</th>
                <th className="py-1.5">Missing</th>
              </tr>
            </thead>
            <tbody>
              {batch.cases.map((c) => (
                <tr key={c.caseId} className="border-b border-slate-100">
                  <td className="py-1.5 font-medium text-slate-800">{c.caseId}</td>
                  <td className="py-1.5 text-slate-600">
                    {c.raw.scheme.toUpperCase()} {c.raw.reason_code}
                  </td>
                  <td className="py-1.5 text-slate-600">
                    {c.files.length}/{c.files.length + c.missing.length}
                  </td>
                  <td className="py-1.5">
                    {c.missing.length > 0 ? (
                      <span className="text-rose-600">{c.missing.join(", ")}</span>
                    ) : (
                      <span className="text-emerald-600">none</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button
            onClick={() => router.push(`/queue?batch=${batch.id}`)}
            className="mt-6 rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Start reviewing →
          </button>
        </div>
      )}
    </main>
  );
}
