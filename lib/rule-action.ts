import type { Action, MatchRule, RequirementResult } from "./types";

// The recommended action is computed here, in code, from verified
// requirement statuses — never taken as-is from the LLM. See docs/PDR.md
// §6.3. `proposedAction` (the model's own opinion) is kept alongside this
// for the analyst to compare; disagreement is surfaced, not hidden.
export function computeRuleAction(
  match: MatchRule,
  requirements: RequirementResult[],
  askMerchant: string[]
): Action {
  if (match.type === "exception") {
    const proven = requirements.some(
      (r) => r.status === "satisfied" && r.citations.some((c) => c.verified)
    );
    return proven ? "represent" : "accept_liability";
  }

  const relevant = requirements.filter((r) => r.status !== "n/a");
  const verifiedSatisfied = relevant.filter(
    (r) => r.status === "satisfied" && r.citations.some((c) => c.verified)
  );

  const threshold = match.type === "any" ? match.n : relevant.length;

  if (threshold > 0 && verifiedSatisfied.length >= threshold) {
    return "represent";
  }

  const hasFixableGap = relevant.some(
    (r) => r.status === "missing" || r.status === "partial"
  );
  if (hasFixableGap && askMerchant.length > 0) {
    return "request_more_evidence";
  }

  return "accept_liability";
}
