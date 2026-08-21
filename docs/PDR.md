# PDR ? Representment Workup Tool

**Status:** Implemented (v1)  
**Project:** Checkout.com take-home ? AI & Process Automation Specialist  
**Timebox:** 4?6 hours (original proposal)  
**Last updated:** 2026-08-21

---

## Developer / coding agent context

Document parsing uses **LiteParse** (`@llamaindex/liteparse`) ? local OCR and geometry, no API key. See `lib/parse.ts` and `lib/resolver.ts` for the citation contract.

The `llama_index_docs` MCP server (LlamaParse docs) is optional background reference only; it is **not** on the runtime path.

---

## 1. Problem

When an issuing bank raises a chargeback, a disputes analyst must decide whether to **represent** (push back with compelling evidence), **accept liability**, or **request more evidence** from the merchant.

The decision itself takes ~90 seconds. The remaining ~18 minutes is spent re-reading scheme rules, opening multiple PDFs to verify a single date, and writing a representment rationale.

The provided dataset includes deliberately tricky cases: confident-but-irrelevant merchant evidence, proof buried in multi-page documents, unrepresentable reason codes, and images that cannot substantiate the claim being made.

## 2. Goals

| Goal | Success signal |
|------|----------------|
| Batch ingest | Accept `cases.json` + evidence files; map by filename |
| Analyst-ready workup | Structured output per case via LLM |
| Explainability | Every evidence claim links to a verified source with jump + highlight |
| Analyst override | Editable rationale/action; confirm and move to next case |
| Runnable demo | Clone ? run in <10 min via README + `.env.example` + upload |

## 3. Non-goals

- Production auth, multi-tenant deployment, or durable database
- Real Visa VCR / Mastercard Chargeback Guide (use `docs/reason_codes.md` only)
- Custom-trained models
- Coverage beyond the 10 provided cases
- Word-level bounding boxes on v1 (line/row/cell sufficient)
- RAG, agent loops, or bulk ?represent all? actions

## 4. Users

**Primary:** Disputes analyst processing a queue of chargeback cases (metaphor: 80/day; dataset: 10 cases).

**Secondary:** Assignment reviewer running the demo by uploading the included dataset (`data/cases.json` + `data/Merchant Evidence Files/`).

## 5. Product overview

### 5.1 Screens

**Upload** (`/upload`)

- Drop `cases.json` + evidence files (multipart upload)
- Map `merchant_evidence_documents[]` ? files by **basename**
- Show expected / matched / missing per case (missing does not block analysis)
- Start reviewing ? navigate to queue

For local testing, upload `data/cases.json` and all files in `data/Merchant Evidence Files/`.

**Queue** (`/queue`) ? the main product

Three-column layout:

| Inbox (left) | Validate (centre) | Source (right) |
|--------------|-------------------|----------------|
| Case list, status, recommended action | Action, exception banner, transaction signals, requirement checklist, editable rationale, ask-merchant list | Tabbed PDF.js / image viewer; cite click ? jump + highlight |

**Not implemented (deferred):**

- ZIP upload (single archive)
- Keyboard shortcuts (`j` / `k`, Enter to confirm)

### 5.2 Required workup output (per brief)

1. **Reason code context** ? allegation + compelling evidence requirements (from `lib/rules.ts` + UI)
2. **Evidence assessment** ? per requirement: `satisfied | partial | missing | n/a`, with document + location pointer
3. **Representment rationale** ? 3?5 sentences, editable
4. **Recommended action** ? `ruleAction` computed in code from verified checklist state
5. **Ask merchant** ? remediation requests surfaced when requirements are partial/missing

## 6. Governance model

The recommendation is **downstream** of a cited checklist. The analyst validates evidence, not model confidence.

```
rules in code  ?  LLM fills checklist with quotes  ?  code verifies quotes
                 ?  code computes ruleAction         ?  analyst confirms
```

### 6.1 Separation of concerns

| Concern | Owner | Notes |
|---------|-------|-------|
| Checklist items, ALL vs ANY-N, exception codes | Hand-coded in `lib/rules.ts` from `reason_codes.md` | 10.5 / 4870 must not be ?vibes? |
| Transaction facts (AVS, 3DS, postcodes, dates) | `cases.json` | Rendered as signal strip; not re-extracted by LLM |
| Requirement satisfaction + quotes | Claude (structured tool output) | Model cites text; images may use vision |
| Quote ? page highlight | `lib/resolver.ts` | Model never emits coordinates |
| Recommended action | `ruleAction` computed in `lib/rule-action.ts` | Not emitted by the model |
| Final filed decision | Analyst confirm | `analystAction`, `analystRationale`, `reviewedAt` persisted |

### 6.2 Citation contract

LLM emits (via `submit_workup` tool):

```json
{
  "file": "CB-2025-0007_consolidated_manifest.pdf",
  "page": 8,
  "quote": "TF-9051 Stentor Bros LS1 4DT LS9 8AA DELIVERED 22 Apr 17:14",
  "evidenceKind": "text_quote",
  "regionIds": []
}
```

Backend resolves to (`Citation` in `lib/types.ts`):

```json
{
  "file": "...",
  "page": 8,
  "quote": "...",
  "rects": [{ "x": 36, "y": 180, "w": 540, "h": 18 }],
  "textVerified": true,
  "locationResolved": true,
  "highlightUnit": "table_row",
  "evidenceKind": "text_quote"
}
```

**Verification rules:**

- Quote must match parsed page text (normalised whitespace/case)
- If no match ? `textVerified: false`; requirement cannot stay `satisfied`; cite not clickable
- Visual observations on images are labelled separately; OCR citations use `text_quote`

### 6.3 `ruleAction` logic

Implemented in `lib/rule-action.ts`:

```
if reason_code in {10.5, 4870} and no miscoding proof:
    accept_liability

if all required items satisfied (or ANY-N threshold met) AND every cite verified:
    represent

if any requirement partial/missing AND ask_merchant list is non-empty:
    request_more_evidence

else:
    accept_liability
```

The UI shows `ruleAction` as the system recommendation. The analyst may override on confirm.

### 6.4 Highlight units by document layout

| Layout | Example | Highlight unit |
|--------|---------|----------------|
| Key-value letter | NorthernThread order | Line |
| Event table | Royal Mail tracking | Row |
| KV table | 3DS authentication record | Row |
| Wide grid | TerraFreight manifest p.8 | Row (never whole table) |
| Photo + caption | HavenHome delivery photo | Caption line, not product image |

## 7. Technical architecture

### 7.1 Stack (as built)

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Frontend + API** | Next.js 16 (App Router) | Split-pane UI, Route Handlers, TypeScript end-to-end |
| **PDF viewer** | PDF.js (`pdfjs-dist`) | Page jump + highlight overlay |
| **Document parsing** | LiteParse (`@llamaindex/liteparse`) | Local OCR + line/row/cell geometry; no cloud key |
| **LLM** | Claude (Anthropic) | Structured checklist via forced tool call |
| **Persistence** | In-memory Map + `.cache/` JSON | Batches and parse cache on disk; no DB |

### 7.2 Why Next.js (not Streamlit)

- Real split-pane layout with persistent inbox + tabbed viewer
- PDF.js integration is native browser; no iframe/workaround
- Route Handlers replace a separate FastAPI layer for orchestration
- TypeScript shared types between UI and API

### 7.3 Repository layout (as built)

```
/
??? app/
?   ??? upload/page.tsx          # Upload cases + evidence
?   ??? queue/page.tsx           # 3-pane analyst UI
?   ??? api/
?       ??? batches/route.ts     # POST multipart upload
?       ??? batches/[id]/route.ts
?       ??? cases/[id]/route.ts
?       ??? cases/[id]/review/route.ts
?       ??? files/[name]/route.ts
??? components/
?   ??? inbox.tsx
?   ??? workup-pane.tsx
?   ??? source-viewer.tsx
?   ??? file-drop-zone.tsx
??? lib/
?   ??? rules.ts                 # Reason-code checklists
?   ??? workup.ts                # Claude structured call
?   ??? resolver.ts              # Quote ? rects + ruleAction inputs
?   ??? rule-action.ts           # Deterministic action from checklist
?   ??? parse.ts                 # LiteParse ingest
?   ??? pipeline.ts              # Parse + workup orchestration
?   ??? store.ts                 # Batch/case persistence
?   ??? types.ts
??? data/                        # Included test dataset
??? docs/
??? .env.example
??? README.md
```

### 7.4 API routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/batches` | Multipart: `cases` (JSON file) + `evidence` (files). Non-multipart POST still calls `createSampleBatch()` internally but has no UI entry point. |
| `GET` | `/api/batches/[id]` | Batch snapshot + per-case status (polled by queue) |
| `GET` | `/api/cases/[id]?batch=` | Case JSON + workup + verified cites |
| `POST` | `/api/cases/[id]/review` | Analyst override + confirm |
| `GET` | `/api/files/[name]?batch=` | Serve raw PDF/PNG for viewer |

### 7.5 Data flow

```
1. MAP (sync)
   cases.json ? match merchant_evidence_documents[] by basename
   ? CaseRecord { caseId, files[], missing[] }
   ? evidence copied to .cache/uploads/{batchId}/

2. PARSE (async, per file, sha256 cache)
   file ? LiteParse (markdown + blocks/textItems)
   ? cache: .cache/parse/{hash}.json

3. WORKUP (async, per case, when its files are parsed)
   inputs: reason-code def + transaction JSON + issuer narrative + parsed markdown
   ? Claude tool output (WorkupDraft)
   ? resolver: quotes ? rects, textVerified, locationResolved
   ? ruleAction computed in code
   ? workup embedded in batch JSON: .cache/batches/{batchId}.json

4. SERVE
   GET /api/cases/[id] ? workup + file URLs

5. REVIEW
   POST /api/cases/[id]/review ? analystAction, analystRationale, reviewedAt
```

Parse is **per file** (shared across cases). Workup is **per case**. Case 0001 does not block on case 0007's 10-page manifest.

### 7.6 Case status lifecycle

```
mapping ? parsing ? analysing ? ready ? reviewed
                              ? error
```

Queue polls `GET /api/batches/[id]` every ~1.5s while cases transition. Analyst can open `ready` cases immediately.

### 7.7 Environment

```env
ANTHROPIC_API_KEY=           # required
ANTHROPIC_MODEL=claude-sonnet-4-6   # optional override
```

No parse API key ? LiteParse runs locally.

## 8. LLM integration

**Provider:** Claude (default `claude-sonnet-4-6` via `ANTHROPIC_MODEL`).

**One structured tool call per case.** No agent loop, no streaming into the checklist.

**Prompt inputs:**

- System: fill checklist only; quote from evidence blocks; 10.5 is not representable unless miscoding proven
- Reason code definition from `lib/rules.ts`
- Transaction object + issuer narrative from `cases.json`
- Evidence markdown tagged by file/page
- Original image bytes for visual cases (e.g. CB-2025-0006)

**Model output (`WorkupDraft`):**

```typescript
type WorkupDraft = {
  requirements: {
    id: string;
    status: "satisfied" | "partial" | "missing" | "n/a";
    citations: {
      file: string;
      page: number | null;
      quote: string;
      regionIds: string[];
      evidenceKind: "text_quote" | "visual_observation";
    }[];
    gap: string | null;
    remediation: "requestable" | "not_requestable" | "not_needed";
    request: string | null;
  }[];
  rationale: string;
};
```

Coordinates are never in the schema. `ruleAction` and `askMerchant` are derived in `lib/resolver.ts` / `lib/rule-action.ts`.

## 9. Document ingest

### 9.1 LiteParse (shipped)

- Package: `@llamaindex/liteparse`
- Output: markdown per page + `blocks` (table cells/rows) and `textItems` (grouped into visual lines)
- Images: OCR natively; classified `text` / `visual` / `mixed` for citation routing
- Cache: `.cache/parse/{sha256}.json` (versioned cache key in `lib/parse.ts`)
- Resolver walks canonical `ParsedRegion` entries for highlight geometry

### 9.2 Images

- LiteParse OCR for text citations; Claude vision for direct visual observations
- Viewer switches tab on cite click; visual observations labelled separately in UI
- Do not claim structural proof from product illustration (case 0006)

### 9.3 Abandoned alternatives (design exploration)

- LlamaParse cloud parse + pymupdf fallback ? replaced by LiteParse for local, keyless operation
- Python FastAPI sidecar ? not needed

## 10. Expected outcomes by case

Reference for development and demo walkthrough. Wrong labels matter less than explainability.

| Case | Code | Likely `ruleAction` | Key trap |
|------|------|----------------------|----------|
| CB-2025-0001 | Visa 13.1 | represent | Sanity check; signed POD |
| CB-2025-0002 | Visa 13.1 | request_more_evidence | Billing ? shipping; safe-place drop |
| CB-2025-0003 | MC 4837 | represent | ANY TWO (AVS+CVV + 3DS) |
| CB-2025-0004 | MC 4837 | accept_liability | Confident internal report, 0/4 reqs |
| CB-2025-0005 | Visa 12.6.1 | represent | Two ?54 invoices, different orders |
| CB-2025-0006 | Visa 13.3 | request_more_evidence | Front-view photo ? defect proof |
| CB-2025-0007 | MC 4855 | represent | Proof on page 8 of 10 |
| CB-2025-0008 | Visa 13.2 | request_more_evidence | T&Cs ? opt-in / cancel log |
| CB-2025-0009 | MC 4859 | represent | Booking + policy + no-show log |
| CB-2025-0010 | Visa 10.5 | accept_liability | Not representable; ignore strong 3DS/POD |

## 11. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| PDF.js + coord mapping eats timebox | LiteParse regions + line/row grouping in `lib/parse.ts` |
| Cloud parse latency / API keys | LiteParse runs locally; file-hash cache |
| Hallucinated quotes | Verify or demote; `textVerified` gates `satisfied` |
| 4837 AND vs OR confusion | `match: { type: "any", n }` in `lib/rules.ts` |
| Reviewer cannot run demo | README + `.env.example` + upload `data/` |
| Stale design doc vs shipped app | This PDR updated to as-built (2026-08-21) |

## 12. Implementation phases

### Phase 1 ? Shipped

- Next.js app: `/upload` + `/queue`
- Map cases + files; inbox list
- LiteParse text extract + Claude workup
- Requirement checklist + rationale + `ruleAction` in centre pane
- PDF.js viewer with page jump + text highlight
- Cite click ? highlight; verify quotes
- Confirm review + next case
- README + `.env.example`

### Phase 2 ? Partial

| Item | Status |
|------|--------|
| Upload UI (cases + evidence files) | Done |
| Fact / transaction signal strip | Done |
| Case status polling | Done |
| Persist reviews across restart (`.cache/batches/`) | Done |
| ZIP upload | Not done |
| `proposed_action` vs `ruleAction` disagreement UI | Not done (model does not emit action) |
| Keyboard shortcuts | Not done |
| Export reviewed workups as JSON | Not done |

### Phase 3 ? Deferred

- Word-level highlights
- Python sidecar
- LlamaParse cloud parse path

## 13. Success criteria

1. Upload `data/cases.json` + evidence ? 10 cases in inbox
2. Pipeline completes; cases reach `ready` or `error` with polled status
3. Citations jump to source and highlight when verified
4. Exception reason codes show banner (e.g. CB-2025-0010)
5. Confirm case ? `reviewed`; advances to next unreviewed
6. Clone ? configure env ? run ? demo in under 10 minutes

## 14. Open decisions (resolved)

| Decision | Choice |
|----------|--------|
| LLM provider | Claude via Anthropic SDK; model via `ANTHROPIC_MODEL` |
| Document parse | LiteParse local (`@llamaindex/liteparse`) |
| Recommended action | Computed in code (`ruleAction`), not model output |
| Review persistence | In-memory + `.cache/batches/{id}.json` |
| Upload entry point | Multipart upload only (no Load sample UI) |

## 15. What's next

See [README.md](../README.md#whats-next) for the current backlog:

- Model evaluation across providers
- Cost tracking (tokens, latency per case)
- Analyst feedback loop (snapshot system output; record overrides for eval)
- Export and integrations (downstream case management / filing systems)
- Citation quality (finer highlights, per-citation feedback, single-case re-analysis)
- Production hardening (auth, durable storage, expanded reason-code coverage)

---

## Appendix: Core types

Aligned with `lib/types.ts`:

```typescript
type Action = "represent" | "accept_liability" | "request_more_evidence";

type CaseRecord = {
  caseId: string;
  raw: RawCase;
  files: string[];
  missing: string[];
  status: "mapping" | "parsing" | "analysing" | "ready" | "error" | "reviewed";
  error?: string;
  workup?: Workup;
};

type Citation = {
  file: string;
  page: number | null;
  quote: string;
  regionIds: string[];
  rects: Rect[];
  textVerified: boolean;
  locationResolved: boolean;
  evidenceKind: "text_quote" | "visual_observation";
  highlightUnit: "line" | "paragraph" | "table_row" | "visual_only" | "unresolved";
};

type Workup = {
  requirements: RequirementResult[];
  rationale: string;
  ruleAction: Action;
  askMerchant: string[];
  analystAction?: Action;
  analystRationale?: string;
  reviewedAt?: string;
};

type WorkupDraft = {
  requirements: WorkupDraftRequirement[];
  rationale: string;
};
```
