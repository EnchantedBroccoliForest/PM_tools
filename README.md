# PM_tools — AI-Assisted Prediction Market Creator

A web application and CLI that uses multiple LLMs via the OpenRouter API to help users design well-defined prediction market questions for [42.space](https://42.space). Markets are produced through a claim-level drafting, verification, review, and refinement pipeline.

## How It Works

PM_tools guides users through a multi-stage pipeline to produce unambiguous, objectively resolvable prediction markets:

### Stage 1: Draft

The user provides a prediction market question, start/end dates, reference URLs, and selects a drafting model. The LLM generates a comprehensive market draft that includes:

- A refined, unambiguous question
- Detailed resolution criteria mapped to an objective data source
- A complete MECE (mutually exclusive, collectively exhaustive) outcome set
- Edge case handling
- Potential resolution sources

An **Ideate** mode is also available: the user provides a topic direction and the model brainstorms market ideas.

### Stage 2: Claim Extraction & Verification

The draft is decomposed into atomic **claims** (outcome criteria, timestamps, thresholds, sources, etc.) and run through two verification layers:

1. **Structural checks** — category-specific invariants (e.g. timestamps contain ISO dates, sources contain URLs, thresholds contain numbers).
2. **Draft-entailment check** — an LLM call confirms each claim is actually entailed by the draft text, catching extractor hallucinations.

### Stage 3: Evidence Gathering & Routing

- **Evidence gathering** — URLs from the user's reference block and source-category claims are resolved in the browser to verify accessibility.
- **Uncertainty routing** — each claim is assigned a severity (`ok`, `targeted_review`, or `blocking`) based on verification verdicts, entailment results, evidence resolution, and criticism severity. The routing rollup determines whether the draft can proceed, needs a targeted update, or is blocked.

### Stage 4: Structured Multi-Model Review

Multiple reviewer models critique the draft against a **six-item rigor rubric** tailored to 42.space's parimutuel-on-bonding-curve mechanism:

1. **Parallel structured reviews** — each reviewer returns prose critique, per-rubric-item votes (`yes`/`no`/`unsure` with rationale), and typed criticisms (blocker/major/minor/nit).
2. **Aggregation** — reviewer votes are aggregated via one of three protocols: `majority`, `unanimity`, or `judge` (an additional LLM renders the final verdict).
3. **Human feedback** — the user can optionally add their own critiques before proceeding.

### Stage 5: Update

The original drafting model incorporates the aggregated review, claim-level routing focus, and any human feedback to produce an improved draft. The claim pipeline (extraction → verification → evidence → routing) re-runs on the updated draft.

### Stage 6: Source Accessibility Check & Finalize

- **Pre-finalize source check** — resolution sources named in the draft are probed for accessibility so the user sees a clear per-source pass/fail list before committing.
- **Finalize** — the final draft is converted into structured JSON containing an array of outcomes (each with resolution criteria), market start/end times in UTC, short description, full resolution rules, and edge cases. All sections are copyable to clipboard.

## CLI

PM_tools ships a headless CLI (`bin/pm-tools.js`) that runs the full pipeline without the React UI:

```bash
# Run the full pipeline
npx pm-tools draft -q "Will BTC exceed 100k?" --start 2026-06-01 --end 2026-09-01

# Verbose output with summary format
npx pm-tools draft -q "..." --start ... --end ... --verbose --format summary

# Brainstorm market ideas
npx pm-tools ideate -d "AI regulation in the EU"

# Re-validate an existing Run artifact
npx pm-tools validate < run.json

# Pipe JSON config via stdin (CLI flags override stdin fields)
echo '{"input":{"question":"...","startDate":"...","endDate":"..."}}' | npx pm-tools draft
```

Key flags: `--drafter`, `--reviewers`, `--aggregation` (majority/unanimity/judge), `--escalation` (always/selective), `--feedback`, `--output`, `--format` (json/summary), `--no-finalize`, `--no-review`, `--timeout`.

## Architecture

```
bin/
└── pm-tools.js                # Headless CLI entry point
src/
├── App.jsx                    # Main UI component and workflow orchestration
├── App.css                    # Application styles
├── ambient-modes.css          # Light/dark theme styles
├── main.jsx                   # React entry point
├── defaults.js                # Shared default config (models, options)
├── orchestrate.js             # Headless pipeline orchestrator (CLI + eval)
├── api/
│   └── openrouter.js          # OpenRouter API client with retries & model listing
├── pipeline/
│   ├── extractClaims.js       # Decompose draft into atomic claims (zod-validated)
│   ├── verify.js              # Structural + draft-entailment verification
│   ├── gatherEvidence.js      # URL resolution and citation accessibility
│   ├── route.js               # Uncertainty-based claim routing
│   ├── structuredReview.js    # Rubric-based structured review per reviewer
│   ├── aggregate.js           # Majority / unanimity / judge vote aggregation
│   └── checkSources.js        # Pre-finalize resolution source accessibility check
├── types/
│   └── run.js                 # Run artifact schema (JSDoc typedefs + zod)
├── hooks/
│   ├── useMarketReducer.js    # Central state management via useReducer
│   ├── useModels.js           # Live model list from OpenRouter API
│   └── useAmbientMode.js      # Light/dark theme hook
├── components/
│   ├── ModelSelect.jsx        # Reusable model selection dropdown
│   ├── LLMLoadingState.jsx    # Animated loading state with phase messages
│   └── AmbientModeToggle.jsx  # Theme toggle component
└── constants/
    ├── models.js              # LLM model definitions, live-fetch, defaults
    ├── prompts.js             # System prompts and prompt builders for each stage
    └── rubric.js              # Six-item rigor rubric for 42.space markets
eval/
├── harness.js                 # Eval harness entry point
├── run.js                     # CLI runner for eval suite
├── metrics.js                 # Metric computation and regression checking
├── mockApi.js                 # Deterministic mock LLM and URL fetcher
├── loadFixtures.js            # Fixture loader
├── baseline.json              # Committed baseline metrics
└── fixtures/                  # Test fixtures (ambiguity, adversarial-factual,
    ├── ambiguity/             #   rag-trap, numerical-date)
    ├── adversarial-factual/
    ├── rag-trap/
    └── numerical-date/
```

### Key Design Decisions

- **State management** uses React's `useReducer` (via the `useMarketReducer` custom hook) rather than an external state library, keeping the dependency footprint minimal.
- **Claim-level pipeline** — every draft passes through extraction, verification, evidence gathering, and routing before review. This catches structural problems, hallucinated claims, and broken sources before expensive reviewer LLM calls.
- **Run artifact** (`src/types/run.js`) is the canonical record of a pipeline run: drafts, claims, criticisms, evidence, verification results, aggregation decisions, final JSON, cost accounting, and a structured event log. Validated with zod at parse time.
- **Prompt engineering** is centralized in `src/constants/prompts.js` with distinct system prompts for the drafter, reviewer, and finalizer roles, plus builder functions for each stage's user prompt. Prompts are tailored to 42.space's parimutuel-on-bonding-curve settlement mechanism.
- **Rigor rubric** (`src/constants/rubric.js`) — a six-item checklist targeting real failure modes of 42.space's Outcome Token mechanism (MECE outcomes, objective sources, unambiguous timing, manipulation resistance, etc.).
- **API resilience** — The OpenRouter client (`src/api/openrouter.js`) implements automatic retries with exponential backoff (3 retries at 1s/2s/4s intervals).
- **Live model list** — the app fetches available models from the OpenRouter API at startup and caches them for one hour; a static fallback list covers offline / failure scenarios. The default drafting and review models are declared in `src/constants/models.js` as `DEFAULT_DRAFT_MODEL` and `DEFAULT_REVIEW_MODEL`; these are revised in lock-step with OpenRouter model availability, so this README intentionally does not pin specific IDs.
- **Headless orchestrator** (`src/orchestrate.js`) — runs the full pipeline without React, shared by the CLI and eval harness. Supports abort via `AbortSignal`, lifecycle callbacks, concurrency limiting, and cost accounting.

## Tech Stack

- **React 19** with **Vite** for development and bundling
- **OpenRouter API** for LLM inference
- **Zod** for runtime schema validation (LLM JSON output, Run artifacts)
- **Vitest** for unit testing

## Getting Started

### Prerequisites

- Node.js 20+
- An [OpenRouter](https://openrouter.ai/) API key

### Setup

```bash
npm install
```

Create a `.env` file (or set the environment variable directly):

```
VITE_OPENROUTER_API_KEY=your_openrouter_api_key
```

For CLI / headless usage, `OPENROUTER_API_KEY` (without the `VITE_` prefix) is also accepted and takes precedence.

### Development

```bash
npm run dev
```

The app runs at `http://localhost:5000`.

### Production Build

```bash
npm run build
npm run preview
```

### Linting & Testing

```bash
npm run lint
npm run test
npm run test:watch   # interactive mode
```

### Regression eval harness

The eval harness runs the full PM_tools pipeline (draft → extract claims →
verify → gather evidence → route → review → aggregate → update → risk →
finalize) against 30+ fixtures without the UI, using a deterministic mock
LLM and mock URL fetcher so the run is reproducible and requires no API
key.

```bash
# Run the full suite against the default ablation
npm run eval

# Run with specific ablation flags
npm run eval -- --aggregation=majority --escalation=selective --evidence=retrieval --verifiers=full

# Only run fixtures matching a substring
npm run eval -- --fixtures=rag

# Overwrite eval/baseline.json with the current metrics (use after a
# deliberate pipeline change)
npm run eval:baseline

# Run and fail (exit 1) if any metric regresses by more than 10% vs the
# committed baseline — this is what CI runs on every PR
npm run eval:check
```

Per-run output (one JSON file per fixture with the full Run artifact,
plus a top-level summary) is written to `eval/out/<timestamp>/`.

Fixtures live in `eval/fixtures/<bucket>/*.json`, split across four
buckets: `ambiguity`, `adversarial-factual`, `rag-trap`, and
`numerical-date`. Each fixture carries its own `expectedProperties`
block that the harness checks against the resulting Run artifact.

A GitHub Actions workflow at `.github/workflows/eval.yml` runs the eval
on every PR that touches `src/pipeline/**`, `src/constants/prompts.js`,
`src/api/openrouter.js`, `eval/**`, or the workflow itself. A PR that
weakens a verifier gate (or otherwise regresses accuracy, citation
coverage, or verifier pass rate by more than 10%) fails CI.

## Attribution

PM_tools' multi-reviewer deliberation stage is **inspired by** the "Structure D" pattern from [`karpathy/llm-council`](https://github.com/karpathy/llm-council) and has been re-implemented from scratch here. Because `karpathy/llm-council` ships without a licence, no code has been copied from that repository — only the high-level pattern (independent parallel reviews followed by a synthesis pass) has been borrowed. Any resemblance beyond that is coincidental.

## Licence

PM_tools is released under the [MIT License](LICENSE).
