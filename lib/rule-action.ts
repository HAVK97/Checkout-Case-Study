import type { Action, MatchRule, RequirementResult } from "./types";

// The recommended action is computed here, in code, from verified
// requirement statuses — never taken from the LLM. See docs/PDR.md §6.3.
export function computeRuleAction(
  match: MatchRule,
  requirements: RequirementResult[]
): Action {
  if (match.type === "exception") {
    const proven = requirements.some(
      (r) => r.status === "satisfied" && r.citations.some((c) => c.textVerified)
    );
    return proven ? "represent" : "accept_liability";
  }

  const relevant = requirements.filter((r) => r.status !== "n/a");
  const verifiedSatisfied = relevant.filter(
    (r) => r.status === "satisfied" && r.citations.some((c) => c.textVerified)
  );

  const threshold = match.type === "any" ? match.n : relevant.length;

  if (threshold > 0 && verifiedSatisfied.length >= threshold) {
    return "represent";
  }

  const unmet = relevant.filter(
    (r) => r.status === "missing" || r.status === "partial"
  );
  const requestable = unmet.filter(
    (r) => r.remediation === "requestable" && !!r.request
  );

  const canReachThreshold =
    match.type === "all"
      ? unmet.length > 0 && requestable.length === unmet.length
      : verifiedSatisfied.length + requestable.length >= threshold;

  if (canReachThreshold) {
    return "request_more_evidence";
  }

  return "accept_liability";
}
