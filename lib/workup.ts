import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import fs from "node:fs";
import path from "node:path";
import type {
  ParsedDoc,
  RawCase,
  RemediationStatus,
  RequirementStatus,
  WorkupDraft,
} from "./types";
import { getReasonCode } from "./rules";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const STATUSES: RequirementStatus[] = ["satisfied", "partial", "missing", "n/a"];

const SUBMIT_WORKUP_SCHEMA = {
  type: "object" as const,
  properties: {
    requirements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", description: "Requirement id, copied exactly from the list provided." },
          status: { type: "string", enum: STATUSES },
          citations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                file: { type: "string", description: "Exact evidence file name, copied from the '### filename' headers below." },
                page: { type: ["integer", "null"], description: "Page number the quote is on, or null if not paginated (e.g. an image)." },
                evidenceKind: {
                  type: "string",
                  enum: ["text_quote", "visual_observation"],
                  description:
                    "Use text_quote for verbatim OCR/document text. Use visual_observation only for a fact directly visible in an attached image.",
                },
                quote: {
                  type: "string",
                  description:
                    "For text_quote: a short VERBATIM quote copied from the parsed evidence. For visual_observation: a concise literal description of what is visible, including limitations.",
                },
                regionIds: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "For text_quote: the exact [region-id] labels containing the quote. For visual_observation: an empty array.",
                },
              },
              required: ["file", "page", "evidenceKind", "quote", "regionIds"],
            },
          },
          gap: {
            type: ["string", "null"],
            description: "If not satisfied, what specifically is missing or weak. Null if satisfied.",
          },
          remediation: {
            type: "string",
            enum: ["requestable", "not_requestable", "not_needed"],
            description:
              "Use requestable only when the merchant could realistically provide evidence that closes this gap; not_requestable when more evidence cannot cure it; not_needed when satisfied or n/a.",
          },
          request: {
            type: ["string", "null"],
            description:
              "Exact document or fact to request when remediation is requestable; otherwise null.",
          },
        },
        required: ["id", "status", "citations", "gap", "remediation", "request"],
      },
    },
    rationale: {
      type: "string",
      description:
        "3-5 short factual points explaining the evidence assessment, one per line, each prefixed with '- ' (dash and space). Each point must state one material fact, requirement gap, or direct consequence. No introductions, repetition, generic commentary, or filler.",
    },
  },
  required: ["requirements", "rationale"],
};

const SYSTEM_PROMPT = `You are a chargeback representment analyst assistant for a payments company that acquires card-not-present (CNP) transactions.

You are given ONE chargeback case: the scheme reason code, the issuer's narrative, transaction metadata, parsed document text, and the original pixels for image evidence. Your job is to check the merchant's evidence against the scheme's compelling-evidence requirements for this reason code and produce a structured workup. You do NOT choose the final action — code computes that from your requirement statuses. A human analyst reviews and can override every field.

Rules you must follow exactly:
1. For every requirement listed, decide "satisfied", "partial", or "missing" based ONLY on the evidence text given below. Never invent facts, dates, names, or numbers that are not present in the evidence.
2. For claims supported by words, use evidenceKind "text_quote". Its quote MUST be copied character-for-character from the text after a [region-id], and regionIds MUST contain the corresponding id(s). Do not include the [region-id] label in the quote. Do not repair OCR inside the quote. If no exact region supports the claim, omit that text citation.
3. Cite the smallest complete semantic region. For tables, cite a table-row region, never an individual cell. For prose spanning wrapped lines, include every consecutive line region containing the quote.
4. For non-text facts directly visible in an attached image, use evidenceKind "visual_observation", set page to null, set regionIds to [], and describe only what is literally visible. State material limitations (for example, "front view only; structural damage cannot be assessed"). Never use visual_observation for text that is available in the parsed OCR.
5. Use the exact file name from the evidence header/image label. A visual observation may support a requirement, but it must never infer hidden condition, identity, ownership, dates, or events that the pixels do not establish.
6. "rationale" is 3-5 short factual points, one per line, each prefixed with "- " (dash and space). Every point must add a material fact, requirement gap, or direct consequence. Omit introductions, repetition, generic statements, and filler. Use concrete names, dates, amounts, and mismatches where relevant.
7. For every requirement, set "remediation". Use "not_needed" for satisfied or n/a requirements. For partial or missing requirements, use "requestable" only when the case or submitted evidence gives a concrete reason to believe the merchant can provide a specific document or fact that would close the gap; set "request" to that exact item. Do not request hypothetical evidence merely because it would be useful. Use "not_requestable" with request null when additional evidence cannot cure the requirement, the known facts contradict it, the requirement is inherently unavailable, or there is no case-specific indication that the evidence exists.
8. Do not decide the final action. Code applies the reason-code ALL, ANY-N, and exception rules after citations are verified.`;

function buildEvidenceBlock(doc: ParsedDoc): string {
  const mode =
    doc.kind === "image" && doc.imageMode
      ? ` [image mode: ${doc.imageMode}; ${
          doc.imageMode === "text"
            ? "use text_quote only"
            : "original pixels are attached for visual assessment"
        }]`
      : "";
  if (doc.pages.length === 0) {
    return `### ${doc.file}${mode}\n(No text could be extracted from this file — ${
      doc.error ?? "unsupported format or empty OCR result"
    }. Treat any claim about its contents as unverifiable; do not cite it.)`;
  }
  const pages = doc.pages
    .map((p) => {
      const regions = p.regions
        .filter((region) => region.kind === "table_row" || region.kind === "line")
        .map((region) => `[${region.id}] ${region.text}`)
        .join("\n");
      return `--- page ${p.pageNumber} ---\n${regions || "(blank page)"}`;
    })
    .join("\n\n");
  return `### ${doc.file}${mode}\n${pages}`;
}

function buildUserPrompt(raw: RawCase, parsedDocs: ParsedDoc[]): string {
  const reasonCode = getReasonCode(raw.scheme, raw.reason_code);
  const requirementList = reasonCode.requirements.map((r) => `- ${r.id}: ${r.label}`).join("\n");
  const evidenceBlocks = parsedDocs.map(buildEvidenceBlock).join("\n\n");

  return `## Reason code
${raw.scheme.toUpperCase()} ${raw.reason_code} — ${reasonCode.label}
Issuer claim: ${reasonCode.issuerClaim}
${reasonCode.exceptionNote ? `Note: ${reasonCode.exceptionNote}\n` : ""}
Compelling evidence requirements (report a status for every one of these ids):
${requirementList}

## Case
Case ID: ${raw.case_id}
Chargeback amount: ${raw.chargeback_amount.value} ${raw.chargeback_amount.currency}
Chargeback date: ${raw.chargeback_date}
Transaction: ${raw.transaction.transaction_id} on ${raw.transaction.transaction_date}, amount ${raw.transaction.amount.value} ${raw.transaction.amount.currency}
AVS result: ${raw.transaction.avs_result ?? "n/a"} | CVV result: ${raw.transaction.cvv_result ?? "n/a"} | 3DS status: ${raw.transaction.three_ds_status}
Billing postcode: ${raw.transaction.billing_address_postcode} | Shipping postcode: ${raw.transaction.shipping_address_postcode ?? "n/a"}
Card BIN country: ${raw.transaction.card_bin_country}

Issuer narrative:
${raw.issuer_narrative}

## Merchant evidence (parsed)
${evidenceBlocks || "(No evidence documents were provided or matched for this case.)"}`;
}

const IMAGE_MEDIA_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
} as const;

function buildMessageContent(
  userPrompt: string,
  parsedDocs: ParsedDoc[],
  evidenceDir: string
): ContentBlockParam[] {
  const content: ContentBlockParam[] = [{ type: "text", text: userPrompt }];

  for (const doc of parsedDocs) {
    if (doc.kind !== "image" || doc.imageMode === "text") continue;

    const safeName = path.basename(doc.file);
    const mediaType = IMAGE_MEDIA_TYPES[path.extname(safeName).toLowerCase() as keyof typeof IMAGE_MEDIA_TYPES];
    if (!mediaType) continue;

    const imagePath = path.join(evidenceDir, safeName);
    if (!fs.existsSync(imagePath)) continue;

    content.push({
      type: "text",
      text: `Original image evidence: ${safeName} (mode: ${doc.imageMode ?? "mixed"}). Inspect its pixels for non-text visual facts relevant to the checklist. Use the parsed OCR above for textual citations.`,
    });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: fs.readFileSync(imagePath).toString("base64"),
      },
    });
  }

  return content;
}

export async function generateWorkupDraft(
  raw: RawCase,
  parsedDocs: ParsedDoc[],
  evidenceDir: string
): Promise<WorkupDraft> {
  const reasonCode = getReasonCode(raw.scheme, raw.reason_code);
  const userPrompt = buildUserPrompt(raw, parsedDocs);
  const content = buildMessageContent(userPrompt, parsedDocs, evidenceDir);

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    tools: [
      {
        name: "submit_workup",
        description: "Submit the structured representment workup for this chargeback case.",
        input_schema: SUBMIT_WORKUP_SCHEMA,
      },
    ],
    tool_choice: { type: "tool", name: "submit_workup" },
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Claude did not return a structured workup (no tool_use block in response)");
  }

  return normalizeDraft(
    toolUse.input as Record<string, unknown>,
    reasonCode.requirements.map((r) => r.id)
  );
}

// Claude usually respects the forced tool schema, but this is the governance
// boundary: nothing downstream trusts model output without validation. Any
// missing/malformed field is coerced to a safe, clearly-flagged default
// rather than silently dropped or allowed to crash the pipeline.
function normalizeDraft(input: Record<string, unknown>, requirementIds: string[]): WorkupDraft {
  const rawRequirements = Array.isArray(input.requirements) ? input.requirements : [];

  const requirements = requirementIds.map((id) => {
    const found = rawRequirements.find(
      (r): r is Record<string, unknown> =>
        typeof r === "object" && r !== null && (r as Record<string, unknown>).id === id
    );
    if (!found) {
      return {
        id,
        status: "missing" as RequirementStatus,
        citations: [],
        gap: "Not addressed in the model's output.",
        remediation: "not_requestable" as RemediationStatus,
        request: null,
      };
    }

    const status: RequirementStatus = STATUSES.includes(found.status as RequirementStatus)
      ? (found.status as RequirementStatus)
      : "missing";

    const citations = Array.isArray(found.citations)
      ? found.citations
          .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
          .map((c) => ({
            file: typeof c.file === "string" ? c.file : "",
            page: typeof c.page === "number" ? c.page : null,
            quote: typeof c.quote === "string" ? c.quote : "",
            regionIds: Array.isArray(c.regionIds)
              ? c.regionIds.filter((id): id is string => typeof id === "string")
              : [],
            evidenceKind:
              c.evidenceKind === "visual_observation"
                ? ("visual_observation" as const)
                : ("text_quote" as const),
          }))
          .filter((c) => c.file && c.quote)
      : [];
    const request =
      typeof found.request === "string" && found.request.trim() ? found.request.trim() : null;
    const remediation: RemediationStatus =
      status === "satisfied" || status === "n/a"
        ? "not_needed"
        : found.remediation === "requestable" && request
          ? "requestable"
          : "not_requestable";

    return {
      id,
      status,
      citations,
      gap: typeof found.gap === "string" ? found.gap : null,
      remediation,
      request: remediation === "requestable" ? request : null,
    };
  });

  return {
    requirements,
    rationale: typeof input.rationale === "string" ? input.rationale : "",
  };
}
