export type Scheme = "visa" | "mastercard";

export type Action = "represent" | "accept_liability" | "request_more_evidence";

export type RequirementStatus = "satisfied" | "partial" | "missing" | "n/a";
export type RemediationStatus = "requestable" | "not_requestable" | "not_needed";

export interface RawCase {
  case_id: string;
  scheme: Scheme;
  reason_code: string;
  reason_code_label: string;
  chargeback_date: string;
  chargeback_amount: { value: number; currency: string };
  transaction: {
    transaction_id: string;
    merchant_name: string;
    merchant_mcc: string;
    transaction_date: string;
    amount: { value: number; currency: string };
    card_bin_country: string;
    avs_result: string | null;
    cvv_result: string | null;
    three_ds_status: string;
    ip_address: string | null;
    device_fingerprint: string | null;
    billing_address_postcode: string;
    shipping_address_postcode: string | null;
  };
  issuer_narrative: string;
  merchant_evidence_documents: string[];
}

// ---- Reason-code catalog (hand-coded from docs/reason_codes.md) ----

export type MatchRule =
  | { type: "all" }
  | { type: "any"; n: number }
  | { type: "exception" }; // e.g. Visa 10.5, MC 4870 — not representable unless proven otherwise

export interface RequirementDef {
  id: string;
  label: string;
}

export interface ReasonCodeDef {
  code: string;
  scheme: Scheme;
  label: string;
  issuerClaim: string;
  match: MatchRule;
  exceptionNote?: string;
  requirements: RequirementDef[];
}

// ---- Evidence parsing ----

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ParsedRegion {
  id: string;
  kind: "line" | "paragraph" | "table_row" | "table_cell";
  text: string;
  rect: Rect;
  parentId?: string;
}

export interface ParsedPage {
  pageNumber: number;
  width: number; // PDF points (or image pixel width for images)
  height: number;
  text: string; // full page text/markdown, used as LLM context
  regions: ParsedRegion[]; // canonical LiteParse text + geometry used for citations
}

export type ParseSource = "liteparse" | "none";

export interface ParsedDoc {
  file: string; // basename
  kind: "pdf" | "image";
  imageMode?: "text" | "visual" | "mixed";
  source: ParseSource;
  pages: ParsedPage[];
  error?: string;
}

// ---- Workup (post-resolve, what the UI reads) ----

export interface Citation {
  file: string;
  page: number | null; // null for images with no resolvable page
  quote: string;
  regionIds: string[];
  rects: Rect[];
  textVerified: boolean;
  locationResolved: boolean;
  evidenceKind: "text_quote" | "visual_observation";
  highlightUnit: "line" | "paragraph" | "table_row" | "visual_only" | "unresolved";
  sourceWidth?: number;
  sourceHeight?: number;
}

export interface RequirementResult {
  id: string;
  label: string;
  status: RequirementStatus;
  citations: Citation[];
  gap: string | null;
  remediation: RemediationStatus;
  request: string | null;
}

export interface Workup {
  requirements: RequirementResult[];
  rationale: string;
  ruleAction: Action;
  askMerchant: string[];
  analystAction?: Action;
  analystRationale?: string;
  reviewedAt?: string;
}

// ---- Claude structured output (pre-resolve) ----

export interface WorkupDraftCitation {
  file: string;
  page: number | null;
  quote: string;
  regionIds: string[];
  evidenceKind: "text_quote" | "visual_observation";
}

export interface WorkupDraftRequirement {
  id: string;
  status: RequirementStatus;
  citations: WorkupDraftCitation[];
  gap: string | null;
  remediation: RemediationStatus;
  request: string | null;
}

export interface WorkupDraft {
  requirements: WorkupDraftRequirement[];
  rationale: string;
}

// ---- Case / batch orchestration ----

export type CaseStatus =
  | "mapping"
  | "parsing"
  | "analysing"
  | "ready"
  | "error"
  | "reviewed";

export interface CaseRecord {
  caseId: string;
  raw: RawCase;
  files: string[]; // matched evidence file basenames
  missing: string[]; // expected but not found on disk
  status: CaseStatus;
  error?: string;
  workup?: Workup;
}

export interface Batch {
  id: string;
  createdAt: string;
  filesDir: string; // absolute path to the directory holding evidence files
  cases: CaseRecord[];
}
