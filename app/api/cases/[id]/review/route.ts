import { NextResponse } from "next/server";
import { getCase, updateCase } from "@/lib/store";
import type { Action } from "@/lib/types";

const VALID_ACTIONS: Action[] = ["represent", "accept_liability", "request_more_evidence"];

interface ReviewBody {
  batchId?: unknown;
  analystAction?: unknown;
  analystRationale?: unknown;
}

// Analyst override: writes analyst_action/analyst_rationale/reviewed_at
// alongside (never over) the model's own proposedAction — see docs/PDR.md
// §6.4 (governance). The queue UI selects the next unreviewed case after
// this succeeds.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as ReviewBody | null;

  if (!body || typeof body.batchId !== "string") {
    return NextResponse.json({ error: "batchId is required" }, { status: 400 });
  }
  if (typeof body.analystAction !== "string" || !VALID_ACTIONS.includes(body.analystAction as Action)) {
    return NextResponse.json(
      { error: `analystAction must be one of: ${VALID_ACTIONS.join(", ")}` },
      { status: 400 }
    );
  }

  const batchId = body.batchId;
  const caseRecord = getCase(batchId, id);
  if (!caseRecord || !caseRecord.workup) {
    return NextResponse.json({ error: "Case not found or not ready for review" }, { status: 404 });
  }

  const analystRationale =
    typeof body.analystRationale === "string" ? body.analystRationale : caseRecord.workup.rationale;

  const updated = updateCase(batchId, id, {
    status: "reviewed",
    workup: {
      ...caseRecord.workup,
      analystAction: body.analystAction as Action,
      analystRationale,
      reviewedAt: new Date().toISOString(),
    },
  });

  return NextResponse.json(updated);
}
