import { computeRuleAction } from "./rule-action";
import type {
  Citation,
  ParsedDoc,
  ParsedPage,
  ParsedRegion,
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
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_#`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

interface QuoteMatch {
  page: number | null;
  regionIds: string[];
  rects: Rect[];
  highlightUnit: Citation["highlightUnit"];
}

function matchesQuote(needle: string, text: string): boolean {
  const candidate = normalize(text);
  return candidate.length > 0 && (candidate.includes(needle) || needle.includes(candidate));
}

function uniqueRegions(regions: ParsedRegion[]): ParsedRegion[] {
  return [...new Map(regions.map((region) => [region.id, region])).values()];
}

function promoteTableCells(regions: ParsedRegion[], page: ParsedPage): ParsedRegion[] {
  const byId = new Map(page.regions.map((region) => [region.id, region]));
  return uniqueRegions(
    regions.map((region) =>
      region.kind === "table_cell" && region.parentId ? (byId.get(region.parentId) ?? region) : region
    )
  );
}

function resolveRegionIds(
  needle: string,
  regionIds: string[],
  doc: ParsedDoc,
  preferredPage: number | null
): QuoteMatch | null {
  if (regionIds.length === 0) return null;

  for (const page of doc.pages) {
    if (preferredPage != null && page.pageNumber !== preferredPage) continue;
    const byId = new Map(page.regions.map((region) => [region.id, region]));
    const selected = regionIds.map((id) => byId.get(id)).filter((region): region is ParsedRegion => !!region);
    if (selected.length !== regionIds.length) continue;

    const promoted = promoteTableCells(selected, page);
    if (!matchesQuote(needle, selected.map((region) => region.text).join(" "))) continue;

    const isTableRow = promoted.some((region) => region.kind === "table_row");
    return {
      page: page.pageNumber,
      regionIds: promoted.map((region) => region.id),
      rects: promoted.map((region) => region.rect),
      highlightUnit: isTableRow ? "table_row" : promoted.length > 1 ? "paragraph" : "line",
    };
  }
  return null;
}

function matchRegions(needle: string, page: ParsedPage): QuoteMatch | null {
  // A table row is the semantic evidence unit. Check it before cells so a
  // matching value highlights its complete row and surrounding context.
  for (const row of page.regions.filter((region) => region.kind === "table_row")) {
    if (matchesQuote(needle, row.text)) {
      return {
        page: page.pageNumber,
        regionIds: [row.id],
        rects: [row.rect],
        highlightUnit: "table_row",
      };
    }
  }

  // Wrapped prose often spans several visual lines. Find the smallest
  // contiguous window that contains the quote.
  const prose = page.regions.filter(
    (region) => region.kind === "line" || region.kind === "paragraph"
  );
  for (let size = 1; size <= Math.min(5, prose.length); size += 1) {
    for (let start = 0; start + size <= prose.length; start += 1) {
      const window = prose.slice(start, start + size);
      if (!matchesQuote(needle, window.map((region) => region.text).join(" "))) continue;
      return {
        page: page.pageNumber,
        regionIds: window.map((region) => region.id),
        rects: window.map((region) => region.rect),
        highlightUnit: size > 1 ? "paragraph" : "line",
      };
    }
  }

  return null;
}

function findQuoteOnPage(needle: string, page: ParsedPage): QuoteMatch | null {
  if (!needle) return null;

  // Tier 1: canonical LiteParse regions with exact geometry.
  const regionMatch = matchRegions(needle, page);
  if (regionMatch) return regionMatch;

  // Tier 2: full page text with HTML stripped to spaces
  const haystack = normalize(page.text);
  if (!haystack.includes(needle)) return null;

  return {
    page: page.pageNumber,
    regionIds: [],
    rects: [],
    highlightUnit: "unresolved",
  };
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
  regionIds: string[],
  evidenceKind: Citation["evidenceKind"],
  docsByFile: Map<string, ParsedDoc>
): Citation {
  const doc = docsByFile.get(file);

  if (!doc) {
    return {
      file,
      page,
      quote,
      regionIds,
      rects: [],
      textVerified: false,
      locationResolved: false,
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
      regionIds: [],
      rects: [],
      textVerified: isGroundedImage,
      locationResolved: false,
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
      regionIds,
      rects: [],
      textVerified: false,
      locationResolved: false,
      evidenceKind,
      highlightUnit: "visual_only",
    };
  }

  const needle = normalize(quote);
  const match =
    resolveRegionIds(needle, regionIds, doc, page) ??
    findQuoteInDoc(quote, doc, page);
  if (!match) {
    return {
      file,
      page,
      quote,
      regionIds,
      rects: [],
      textVerified: false,
      locationResolved: false,
      evidenceKind,
      highlightUnit: "unresolved",
    };
  }

  const sourcePage = doc.pages.find((candidate) => candidate.pageNumber === match.page);
  return {
    file,
    page: match.page,
    quote,
    regionIds: match.regionIds,
    rects: match.rects,
    textVerified: true,
    locationResolved: match.rects.length > 0,
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
        remediation: "not_requestable",
        request: null,
      };
    }

    const citations = draftReq.citations.map((c) =>
      resolveCitation(c.file, c.page, c.quote, c.regionIds, c.evidenceKind, docsByFile)
    );
    const hasVerifiedCitation = citations.some((c) => c.textVerified);

    // Unverified citations cannot carry a "satisfied" status — this is what
    // keeps a hallucinated quote from silently becoming a green checkmark.
    const status = draftReq.status === "satisfied" && !hasVerifiedCitation ? "partial" : draftReq.status;
    const verificationFailed = status === "partial" && draftReq.status === "satisfied";
    const remediation = verificationFailed ? "requestable" : draftReq.remediation;
    const request = verificationFailed
      ? `Verifiable evidence for: ${reqDef.label}`
      : draftReq.request;

    return {
      id: reqDef.id,
      label: reqDef.label,
      status,
      citations,
      gap: verificationFailed
        ? (draftReq.gap ?? "The cited evidence could not be independently verified.")
        : draftReq.gap,
      remediation,
      request,
    };
  });

  const ruleAction = computeRuleAction(reasonCode.match, requirements);
  const askMerchant =
    ruleAction === "request_more_evidence"
      ? [
          ...new Set(
            requirements
              .filter((req) => req.remediation === "requestable")
              .map((req) => req.request)
              .filter((request): request is string => !!request)
          ),
        ]
      : [];

  return {
    requirements,
    rationale: draft.rationale,
    ruleAction,
    askMerchant,
  };
}
