# Representment Workup Tool

Analyst-ready chargeback representment workups with deterministic scheme
checklists, Claude analysis, verified source citations, and PDF/image
highlighting.

## Run locally

Requirements: Node.js 20+ and an Anthropic API key.

```bash
npm install
cp .env.example .env
```

Add your key to `.env`:

```dotenv
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-6
LLAMA_CLOUD_API_KEY=... # optional; enables LlamaParse
```

Then start the single-process demo:

```bash
npm run dev
```

Open [http://localhost:3000/upload](http://localhost:3000/upload), click
**Load sample**, review the filename mapping, then open the queue. The first
run parses 10 cases in the background; parsed files and batch state are cached
under `.cache/`.

## What to test

- **CB-2025-0001:** rule action is `represent`; citations jump to Royal Mail
  `DELIVERED` / `signed by WHITFORD`.
- **CB-2025-0002:** the tracking screenshot is treated as OCR-dominant;
  citations highlight the exact tracking text.
- **CB-2025-0004:** rule action is `accept_liability`; all four fraud
  requirements are missing.
- **CB-2025-0006:** the chair photo is sent to Claude Vision. Visual
  observations are labeled separately and correctly note that a front view
  cannot prove or disprove the alleged structural defect.
- **CB-2025-0007:** manifest citations jump to page 8 and consignment
  `TF-9051`.
- **CB-2025-0010:** rule action is `accept_liability`; the Visa 10.5 exception
  banner appears above the checklist.

Clicking **Confirm** persists the analyst action/rationale and advances to the
next unreviewed case.

## Governance model

- Reason-code requirements and ALL/ANY/exception rules are hand-coded in
  `lib/rules.ts`.
- Claude returns structured checklist statuses and source references.
- Text citations are verified against parsed source text before they can
  support a satisfied requirement.
- Images are classified as OCR-dominant, visual, or mixed. OCR citations and
  Claude visual observations are visibly distinguished in the UI.
- `lib/rule-action.ts` computes the final rule action; the model's proposed
  action remains visible for comparison and analyst override.

LlamaParse improves document text when `LLAMA_CLOUD_API_KEY` is configured.
LiteParse provides local OCR and source rectangles used by the highlighter.

## Verification

```bash
npm run build
```

The current v1 loads the included sample dataset. User-provided ZIP/file
uploads, authentication, and durable database storage are out of scope. See
[docs/PDR.md](docs/PDR.md) for the full design and trade-offs.
