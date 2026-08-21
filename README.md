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
```

Then start the single-process demo:

```bash
npm run dev
```

Open [http://localhost:3000/upload](http://localhost:3000/upload), upload a
cases JSON file and the matching merchant evidence files, review the filename
mapping, then start reviewing. The first run parses cases in the background;
parsed files and batch state are cached under `.cache/`.

For local testing, use the included dataset:

- Cases: `data/cases.json`
- Evidence: all files in `data/Merchant Evidence Files/`

## Governance model

- Reason-code requirements and ALL/ANY/exception rules are hand-coded in
  `lib/rules.ts`.
- Claude returns structured checklist statuses and source references.
- Text citations are verified against parsed source text before they can
  support a satisfied requirement.
- Images are classified as OCR-dominant, visual, or mixed. OCR citations and
  Claude visual observations are visibly distinguished in the UI.
- `lib/rule-action.ts` computes the recommended action (`ruleAction`); the
  analyst can override action and rationale on confirm.

LiteParse provides local OCR and source rectangles used by the highlighter.

## Verification

```bash
npm run build
```

The current v1 accepts user-provided cases JSON and evidence file uploads.
Authentication and durable database storage are out of scope. See
[docs/PDR.md](docs/PDR.md) for the full design and trade-offs.

## What's next

- **Model evaluation** — run the same batch across models; score action agreement, citation verification, and rationale edits.
- **Cost tracking** — log tokens and latency per case; roll up cost per batch and per override.
- **Analyst feedback loop** — snapshot system output at generation; record overrides on action, rationale, requirements, and citations; export for eval and prompt tuning.
- **Export and integrations** — push reviewed workups to downstream systems (case management, representment filing, merchant outreach) or export as structured JSON.
- **Citation quality** — finer highlights, per-citation feedback, single-case re-analysis.
- **Production** — auth, durable storage, expanded reason-code coverage.
