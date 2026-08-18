# PDR ù Representment Workup Tool

**Status:** Proposed  
**Project:** Checkout.com take-home ù AI & Process Automation Specialist  
**Timebox:** 4ù6 hours  
**Last updated:** 2026-08-18

---

## Developer / coding agent context

This project is built with Cursor. The **coding agent has access to the `llama_index_docs` MCP server**, which indexes official LlamaIndex / LlamaParse documentation.

**Use it when implementing:**

- LlamaParse job creation (`tier`, `output_options`, `granular_bboxes`)
- Retrieving parse results and the grounded-items JSONL sidecar (`result_content_metadata.grounded_items`)
- Line / cell / row bbox shapes and coordinate scaling for the PDF.js highlight layer
- TypeScript or Python SDK usage (`llama-cloud`, `llama-parse-ts`)

**Do not confuse with runtime:** the MCP is for **development-time** API reference only. The shipped Next.js app calls LlamaCloud via `LLAMA_CLOUD_API_KEY` and the SDK/REST API directly ù analysts do not use MCP.

**If MCP is unavailable:** fall back to `docs/PDR.md` ù9, pymupdf text extract, and the public docs at `https://developers.llamaindex.ai/llamaparse/`.

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
| Runnable demo | Clone ? run in <10 min via README + `.env.example` + Load sample |

## 3. Non-goals

- Production auth, multi-tenant deployment, or durable database
- Real Visa VCR / Mastercard Chargeback Guide (use `docs/reason_codes.md` only)
- Custom-trained models
- Coverage beyond the 10 provided cases
- Word-level bounding boxes on v1 (line/row/cell sufficient)
- RAG, agent loops, or bulk ùrepresent allù actions

## 4. Users

**Primary:** Disputes analyst processing a queue of chargeback cases (metaphor: 80/day; dataset: 10 cases).

**Secondary:** Assignment reviewer running the demo via **Load sample** without uploading files.

## 5. Product overview

### 5.1 Screens

**Upload** (`/upload`)

- Drop `cases.json` + evidence files, or a single zip
- Map `merchant_evidence_documents[]` ? files by **basename**
- Show expected / matched / missing per case (missing does not block analysis)
- **Load sample** ? `data/cases.json` + `data/Merchant Evidence Files/`
- Start analysis ? navigate to queue

**Queue** (`/queue`) ù the main product

Three-column layout:

| Inbox (left) | Validate (centre) | Source (right) |
|--------------|-------------------|----------------|
| Case list, status, recommended action | Action, exception banner, fact chips, requirement checklist, editable rationale, ask-merchant list | Tabbed PDF.js / image viewer; cite click ? jump + highlight |

**Keyboard shortcuts (should-have):**

- `j` / `k` ù next / previous case
- `Enter` ù confirm review ? next unreviewed case

### 5.2 Required workup output (per brief)

1. **Reason code summary** ù plain-English allegation + compelling evidence requirements
2. **Evidence assessment** ù per requirement: `satisfied | partial | missing | n/a`, with document + location pointer
3. **Representment rationale** ù 3ù5 sentences, editable
4. **Recommended action** ù `represent | accept_liability | request_more_evidence` + one-line justification
5. **Ask merchant** ù if `request_more_evidence`: specific list of missing items

## 6. Governance model

The recommendation is **downstream** of a cited checklist. The analyst validates evidence, not model confidence.

```
rules in code  ?  LLM fills checklist with quotes  ?  code verifies quotes
                 ?  code computes rule_action       ?  analyst confirms
```

### 6.1 Separation of concerns

| Concern | Owner | Notes |
|---------|-------|-------|
| Checklist items, ALL vs ANY-N, exception codes | Parsed from `reason_codes.md` in code | 10.5 / 4870 must not be ùvibesù |
| Transaction facts (AVS, 3DS, postcodes, dates) | `cases.json` | Rendered as chips; not re-extracted by LLM |
| Requirement satisfaction + quotes | Claude (structured output) | Model cites text only |
| Quote ? page highlight | Resolver in backend | Model never emits coordinates |
| Recommended action | `rule_action` computed in code | Model `proposed_action` shown alongside |
| Final filed decision | Analyst confirm | Override persisted with timestamp |

### 6.2 Citation contract

LLM emits:

```json
{
  "file": "CB-2025-0007_consolidated_manifest.pdf",
  "page": 8,
  "quote": "TF-9051 Stentor Bros LS1 4DT LS9 8AA DELIVERED 22 Apr 17:14"
}
```

Backend resolves to:

```json
{
  "file": "...",
  "page": 8,
  "quote": "...",
  "rects": [{ "x": 36, "y": 180, "w": 540, "h": 18 }],
  "verified": true,
  "highlight_unit": "row"
}
```

**Verification rules:**

- Quote must match page text (normalised whitespace/case)
- If no match ? `verified: false`, requirement cannot stay `satisfied`, cite not clickable
- Images without resolvable text ? tab switch only; mark `verified: visual_only`

### 6.3 `rule_action` logic

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

If `proposed_action ? rule_action`, UI shows both. Analyst decides on confirm.

### 6.4 Highlight units by document layout

| Layout | Example | Highlight unit |
|--------|---------|----------------|
| Key-value letter | NorthernThread order | Line |
| Event table | Royal Mail tracking | Row |
| KV table | 3DS authentication record | Row |
| Wide grid | TerraFreight manifest p.8 | Row (never whole table) |
| Photo + caption | HavenHome delivery photo | Caption line, not product image |

## 7. Technical architecture

### 7.1 Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Frontend + API** | **Next.js 14+ (App Router)** | Split-pane UI, Route Handlers, TypeScript end-to-end; not Streamlit |
| **PDF viewer** | PDF.js (`pdfjs-dist`) | Page jump + highlight overlay |
| **Document parsing** | LlamaParse (optional) + pymupdf fallback | Layout/grounding vs reliability |
| **LLM** | Claude Sonnet (Anthropic) | Strong structured checklist adherence; OpenAI drop-in via env |
| **Persistence** | Filesystem + in-memory job state | No DB for take-home scope |

### 7.2 Why Next.js (not Streamlit)

- Real split-pane layout with persistent inbox + tabbed viewer
- PDF.js integration is native browser; no iframe/workaround
- Route Handlers replace a separate FastAPI layer for orchestration
- TypeScript shared types between UI and API
- `Load sample` and upload flows are standard React pages

**Python sidecar (optional):** If pymupdf cite resolution is preferred over Node alternatives, a thin FastAPI script on `:8001` can expose `/parse` and `/resolve`. Next.js calls it internally. Default path: LlamaParse TS SDK + pymupdf via subprocess or pre-parse script.

### 7.3 Repository layout (target)

```
/
??? app/
?   ??? upload/page.tsx          # Upload + Load sample
?   ??? queue/page.tsx           # 3-pane analyst UI
?   ??? api/
?       ??? batches/route.ts     # POST upload / sample
?       ??? batches/[id]/route.ts
?       ??? cases/[id]/route.ts
?       ??? cases/[id]/review/route.ts
?       ??? files/[name]/route.ts
??? components/
?   ??? inbox/                   # Case list
?   ??? workup/                  # Checklist, rationale, action
?   ??? viewer/                  # PDF.js + image tabs + highlight layer
??? lib/
?   ??? rules.ts                 # Parse reason_codes.md ? checklists
?   ??? workup.ts                # Claude structured call
?   ??? resolver.ts              # Quote ? rects
?   ??? parse.ts                 # LlamaParse / pymupdf ingest
?   ??? types.ts                 # CaseRecord, Workup, Citation
??? data/                        # Provided dataset (sample source)
??? docs/
?   ??? PDR.md                   # This document
?   ??? case_study.md
?   ??? reason_codes.md
?   ??? README.md
??? .env.example
??? README.md                    # Clone ? run in 10 min
```

### 7.4 API routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/batches` | Upload files or `{ source: "sample" }` |
| `GET` | `/api/batches/[id]` | Mapping table + per-case status |
| `GET` | `/api/cases/[id]` | Case JSON + workup + verified cites |
| `POST` | `/api/cases/[id]/review` | Analyst override + confirm |
| `GET` | `/api/files/[name]` | Serve raw PDF/PNG for viewer |

### 7.5 Data flow

```
1. MAP (sync)
   cases.json ? match merchant_evidence_documents[] by basename
   ? CaseRecord { case, files[], missing[] }

2. PARSE (async, per file, sha256 cache)
   file ? LlamaParse (granular_bboxes: line, cell) OR pymupdf text extract
   ? markdown + optional sidecar JSONL
   ? cache: .cache/parse/{hash}.md

3. WORKUP (async, per case, when its files are parsed)
   inputs: reason-code slice + transaction JSON + issuer narrative + tagged markdown
   ? Claude structured output (WorkupDraft)
   ? resolver: quotes ? rects, verified flag
   ? rule_action computed in code
   ? persist: .cache/workups/{case_id}.json

4. SERVE
   GET /api/cases/[id] ? workup + file URLs

5. REVIEW
   POST /api/cases/[id]/review ? analyst_action, analyst_rationale, reviewed_at
```

Parse is **per file** (shared across cases). Workup is **per case**. Case 0001 must not block on case 0007ùs 10-page manifest.

### 7.6 Case status lifecycle

```
mapping ? parsing ? analysing ? ready ? reviewed
                              ? error
```

Inbox polls `GET /api/batches/[id]` while cases transition. Analyst can open `ready` cases immediately.

### 7.7 Environment

```env
ANTHROPIC_API_KEY=           # required
LLAMA_CLOUD_API_KEY=         # optional; pymupdf fallback if absent
OPENAI_API_KEY=              # optional swap for Claude
```

## 8. LLM integration

**Provider:** Claude Sonnet (default). Same JSON schema if swapped to OpenAI.

**One structured call per case.** No agent loop, no tools, no streaming into the checklist.

**Prompt inputs:**

- System: fill checklist only; quote from evidence blocks; 10.5 is not representable unless miscoding proven
- Reason code slice from `reason_codes.md`
- Transaction object + issuer narrative from `cases.json`
- Evidence markdown tagged `[filename p.N]`

**Model output (`WorkupDraft`):**

```typescript
type WorkupDraft = {
  reason_summary: string;
  requirements: {
    id: string;
    status: "satisfied" | "partial" | "missing" | "n/a";
    citations: { file: string; page: number; quote: string }[];
    gap: string | null;
  }[];
  rationale: string;
  proposed_action: "represent" | "accept_liability" | "request_more_evidence";
  ask_merchant: string[];
};
```

Use Anthropic structured outputs / JSON schema. Coordinates are never in the schema.

## 9. Document ingest

### 9.1 Preferred: LlamaParse

- Tier: `cost_effective` or `agentic` (not `fast`)
- `output_options.granular_bboxes: ["line", "cell"]`
- Cache markdown + grounded-items JSONL sidecar per file hash
- Resolver walks line/cell/row bboxes for highlight
- **Implementation reference:** consult `llama_index_docs` MCP (see Developer / coding agent context above) for current API shapes ù do not guess sidecar fields or bbox schema

### 9.2 Fallback: pymupdf

- Extract page text at ingest
- `page.search_for(quote)` for highlight rects
- Same citation schema; same UI behaviour
- **Do not block E2E on LlamaCloud availability**

### 9.3 Images (2 PNGs)

- Parse via LlamaParse or OCR caption text
- Viewer switches tab; optional Claude vision only if caption extraction fails
- Do not claim structural proof from product illustration (case 0006)

## 10. Expected outcomes by case

Reference for development and demo walkthrough. Wrong labels matter less than explainability.

| Case | Code | Likely `rule_action` | Key trap |
|------|------|----------------------|----------|
| CB-2025-0001 | Visa 13.1 | represent | Sanity check; signed POD |
| CB-2025-0002 | Visa 13.1 | request_more_evidence | Billing ? shipping; safe-place drop |
| CB-2025-0003 | MC 4837 | represent | ANY TWO (AVS+CVV + 3DS) |
| CB-2025-0004 | MC 4837 | accept_liability | Confident internal report, 0/4 reqs |
| CB-2025-0005 | Visa 12.6.1 | represent | Two ù54 invoices, different orders |
| CB-2025-0006 | Visa 13.3 | request_more_evidence | Front-view photo ? defect proof |
| CB-2025-0007 | MC 4855 | represent | Proof on page 8 of 10 |
| CB-2025-0008 | Visa 13.2 | request_more_evidence | T&Cs ? opt-in / cancel log |
| CB-2025-0009 | MC 4859 | represent | Booking + policy + no-show log |
| CB-2025-0010 | Visa 10.5 | accept_liability | Not representable; ignore strong 3DS/POD |

## 11. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| PDF.js + coord mapping eats timebox | pymupdf fallback; page + quote highlight first |
| LlamaParse latency / missing key | File-hash cache; Load sample; skip if absent |
| Hallucinated quotes | Verify or demote to unverified / partial |
| 4837 AND vs OR confusion | Encode `match: any_n` in rules parser |
| Reviewer cannot run demo | Load sample, `.env.example`, 10-min README |
| Next.js + Python split complexity | Start with LlamaParse TS SDK; add Python sidecar only if needed |

## 12. Implementation phases

### Phase 1 ù Must ship (E2E)

1. Next.js app shell: `/upload` (Load sample) + `/queue`
2. Map cases + files; inbox list
3. Text extract (pymupdf or LlamaParse) + Claude workup
4. Requirement checklist + rationale + action in centre pane
5. PDF.js viewer with page jump + text highlight
6. Cite click ? highlight; verify quotes
7. Confirm review + next case
8. README + `.env.example`

**Verify:** 0001 represent with highlight; 0004 accept; 0007 page 8; 0010 accept with exception banner.

### Phase 2 ù Should ship

- Upload UI + zip support
- Fact chips from transaction JSON
- `proposed_action` vs `rule_action` disagreement UI
- Case status polling (parsing ? ready)
- Keyboard shortcuts
- Export reviewed workups as JSON

### Phase 3 ù Wonùt if time runs out

- LlamaParse granular bboxes (if pymupdf fallback works)
- Word-level highlights
- Python FastAPI sidecar
- Persist reviews across server restart (disk JSON sufficient for demo)

## 13. Success criteria

1. `Load sample` ? 10 cases in inbox
2. Case 0001: `represent`; cite highlights Royal Mail DELIVERED / signature row
3. Case 0007: cite opens **page 8**, TF-9051 row highlighted
4. Case 0004: `accept_liability`; checklist empty; fraud report still viewable
5. Case 0010: `accept_liability`; exception banner above 3DS/POD evidence
6. Confirm case ? advances to next unreviewed
7. Clone ? configure env ? run ? demo in under 10 minutes

## 14. Open decisions

| Decision | Current choice |
|----------|----------------|
| LLM provider | Claude Sonnet; OpenAI via env swap |
| LlamaParse on critical path | No ù pymupdf fallback required |
| LlamaParse API reference (dev) | `llama_index_docs` MCP in Cursor |
| Python sidecar | Optional; only if Node parse is insufficient |
| Review persistence | In-memory + optional disk JSON export |

---

## Appendix: Core types

```typescript
type CaseRecord = {
  case_id: string;
  raw: Case; // from cases.json
  files: string[];
  missing: string[];
  status: "mapping" | "parsing" | "analysing" | "ready" | "error" | "reviewed";
};

type Citation = {
  file: string;
  page: number;
  quote: string;
  rects: { x: number; y: number; w: number; h: number }[];
  verified: boolean;
  highlight_unit?: "line" | "row" | "cell" | "visual_only";
};

type Workup = {
  reason_summary: string;
  requirements: {
    id: string;
    label: string;
    status: "satisfied" | "partial" | "missing" | "n/a";
    citations: Citation[];
    gap: string | null;
  }[];
  rationale: string;
  proposed_action: Action;
  rule_action: Action;
  ask_merchant: string[];
  analyst_action?: Action;
  analyst_rationale?: string;
  reviewed_at?: string;
};

type Action = "represent" | "accept_liability" | "request_more_evidence";
```
