import { computeRuleAction } from "./rule-action";
import type {
  Citation,
  ParsedDoc,
  ParsedPage,
  ReasonCodeDef,
  Rect,
  RequirementResult,
  Workup,
  WorkupDraft,
} from "./types";

// The single governance choke-point: nothing from the model reaches the UI
// as "satisfied" without an independently-verified quote, and every verified
// quote is resolved to a real rect the viewer can highlight. See
// docs/PDR.md §6/§9.

function normalize(text: string): string {
  return text
    .replace(/[*_#`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

interface QuoteMatch {
  page: number | null;
  rects: Rect[];
  highlightUnit: Citation["highlightUnit"];
}

function findQuoteOnPage(needle: string, page: ParsedPage): QuoteMatch | null {
  const haystack = normalize(page.text);
  if (!needle || !haystack.includes(needle)) return null;

  for (const line of page.lines) {
    const lineNorm = normalize(line.text);
    if (lineNorm && (lineNorm.includes(needle) || needle.includes(lineNorm))) {
      return { page: page.pageNumber, rects: [line.rect], highlightUnit: "line" };
    }
  }

  // Quote may span several grouped lines (e.g. a wrapped sentence). Union
  // every line whose text is fully contained in the quote.
  const covering = page.lines.filter((l) => {
    const n = normalize(l.text);
    return n.length > 0 && needle.includes(n);
  });
  if (covering.length > 0) {
    return { page: page.pageNumber, rects: covering.map((l) => l.rect), highlightUnit: "line" };
  }

  return { page: page.pageNumber, rects: [], highlightUnit: "unresolved" };
}

function findQuoteInDoc(quote: string, doc: ParsedDoc, preferredPage: number | null): QuoteMatch | null {
  const needle = normalize(quote);
  if (!needle) return null;

  const ordered =
    preferredPage != null
      ? [...doc.pages].sort((a, b) => {
          if (a.pageNumber === preferredPage) return -1;
          if (b.pageNumber === preferredPage) return 1;
          return 0;
        })
      : doc.pages;

  for (const page of ordered) {
    const match = findQuoteOnPage(needle, page);
    if (match) return match;
  }
  return null;
}

function resolveCitation(
  file: string,
  page: number | null,
  quote: string,
  evidenceKind: Citation["evidenceKind"],
  docsByFile: Map<string, ParsedDoc>
): Citation {
  const doc = docsByFile.get(file);

  if (!doc) {
    return {
      file,
      page,
      quote,
      rects: [],
      verified: false,
      evidenceKind,
      highlightUnit: "unresolved",
    };
  }

  if (evidenceKind === "visual_observation") {
    const sourcePage = doc.pages[0];
    const isGroundedImage =
      doc.kind === "image" && (doc.imageMode === "visual" || doc.imageMode === "mixed");
    return {
      file,
      page: null,
      quote,
      rects: [],
      verified: isGroundedImage,
      evidenceKind,
      highlightUnit: isGroundedImage ? "visual_only" : "unresolved",
      sourceWidth: sourcePage?.width,
      sourceHeight: sourcePage?.height,
    };
  }

  if (doc.pages.length === 0) {
    // No extractable text (unparsed image, OCR failure, etc). Still
    // surfaced — the analyst can open the file and eyeball it — but never
    // auto-verified.
    return {
      file,
      page: null,
      quote,
      rects: [],
      verified: false,
      evidenceKind,
      highlightUnit: "visual_only",
    };
  }

  const match = findQuoteInDoc(quote, doc, page);
  if (!match) {
    return {
      file,
      page,
      quote,
      rects: [],
      verified: false,
      evidenceKind,
      highlightUnit: "unresolved",
    };
  }

  const sourcePage = doc.pages.find((candidate) => candidate.pageNumber === match.page);
  return {
    file,
    page: match.page,
    quote,
    rects: match.rects,
    verified: true,
    evidenceKind,
    highlightUnit: match.highlightUnit,
    sourceWidth: sourcePage?.width,
    sourceHeight: sourcePage?.height,
  };
}

export function resolveWorkup(
  draft: WorkupDraft,
  reasonCode: ReasonCodeDef,
  docsByFile: Map<string, ParsedDoc>
): Workup {
  const requirements: RequirementResult[] = reasonCode.requirements.map((reqDef) => {
    const draftReq = draft.requirements.find((r) => r.id === reqDef.id);
    if (!draftReq) {
      return {
        id: reqDef.id,
        label: reqDef.label,
        status: "missing",
        citations: [],
        gap: "Not addressed in the model's output.",
      };
    }

    const citations = draftReq.citations.map((c) =>
      resolveCitation(c.file, c.page, c.quote, c.evidenceKind, docsByFile)
    );
    const hasVerifiedCitation = citations.some((c) => c.verified);

    // Unverified citations cannot carry a "satisfied" status — this is what
    // keeps a hallucinated quote from silently becoming a green checkmark.
    const status = draftReq.status === "satisfied" && !hasVerifiedCitation ? "partial" : draftReq.status;

    return { id: reqDef.id, label: reqDef.label, status, citations, gap: draftReq.gap };
  });

  const ruleAction = computeRuleAction(reasonCode.match, requirements, draft.askMerchant);

  return {
    reasonSummary: draft.reasonSummary,
    requirements,
    rationale: draft.rationale,
    proposedAction: draft.proposedAction,
    ruleAction,
    askMerchant: draft.askMerchant,
  };
}
