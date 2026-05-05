# 42_creator_tool — Rigor Pipeline for 42.space Market Drafts

`42_creator_tool` (formerly `PM_tools`) is a web app and headless CLI that drafts, verifies, critiques, and finalizes market proposals for [42.space](https://42.space) — an **Events Futures** protocol whose parimutuel-on-bonding-curve settlement is unforgiving of ambiguity. A market with overlapping outcomes, a missing edge case, an interpretive source, or a drifting deadline can permanently strand real collateral, so drafts are not trusted on their first pass. Instead, every draft is decomposed into atomic claims, hit with structural and entailment verifiers, checked against its cited sources, critiqued in parallel by multiple reviewer LLMs against a 42-specific rigor rubric, and only then refined and finalized into the JSON shape that spawns Outcome Tokens.

The repository is both a **product** — a deterministic pipeline that a market creator can run end-to-end from the browser or CI — and a **research harness**: the same orchestrator drives a regression eval over 35+ adversarial fixtures (ambiguity, factual traps, RAG traps, numerical/date edge cases) with a committed baseline, a deterministic mock LLM, and a CI gate that fails any change that weakens accuracy, citation coverage, or verifier pass rate by more than 10%.

## Why This Exists

42.space is **not** a Polymarket / Kalshi / CTF-style binary market. Every outcome gets its own Outcome Token on its own bonding curve, trading halts at a hard UTC deadline, one winner is declared by predefined objective rules, and all losing collateral is pooled and paid pro-rata to the winning holders. That mechanism imposes design constraints that ordinary LLM drafting gets wrong by default: outcomes must be MECE (overlap breaks pro-rata math, gaps strand collateral), sources must be machine-readable and non-interpretive, scalar questions must be discretized into named buckets, and every edge case (postponement, ties, source unavailability) must route to a named fallback outcome rather than "resolver discretion." The pipeline encodes those rules as machine-checkable gates instead of hoping the model remembers them.

## How It Works

The app guides the user through a multi-stage pipeline. Each stage emits structured artifacts into a canonical `Run` record (see `src/types/run.js`) that is zod-validated, replayable, and the basis for both the UI, the CLI output, and the eval harness's regression checks.

### Stage 1: Draft

The user provides a question, start/end dates (UTC), reference URLs, and a drafting model. The drafter — prompted with the full 42.space protocol context block (see `src/constants/prompts.js`) — produces:

- A refined, unambiguous question
- Detailed resolution criteria mapped to an objective, machine-readable data source
- A complete MECE outcome set (with an explicit `Other / None` catch-all unless the outcome space is provably closed)
- Named fallback routing for every edge case (postponement, ties, source unavailability, "no listed outcome occurred")
- Potential resolution sources

An **Ideate** mode is available: given a topic direction, the model brainstorms multiple candidate markets — each constrained by the same protocol rules — and the user picks one to draft.

### Stage 2: Claim Extraction & Verification

The draft is decomposed into atomic **claims** (outcome criteria, timestamps, thresholds, sources, etc.) and run through two verification layers:

1. **Structural checks** — category-specific invariants (e.g. timestamps contain ISO dates, sources contain URLs, thresholds contain numbers).
2. **Draft-entailment check** — an LLM call confirms each claim is actually entailed by the draft text, catching extractor hallucinations.

### Stage 3: Evidence Gathering & Routing

- **Evidence gathering** — URLs from the user's reference block and source-category claims are resolved in the browser to verify accessibility.
- **Uncertainty routing** — each claim is assigned a severity (`ok`, `targeted_review`, or `blocking`) based on verification verdicts, entailment results, evidence resolution, and criticism severity. The routing rollup determines whether the draft can proceed, needs a targeted update, or is blocked.
- **Optional xAPI enrichment (X / Twitter)** — references containing X/Twitter URLs or `@mentions` can be hydrated via the [xAPI](https://action.xapi.to) action API so the drafter and reviewers see real profile / tweet context instead of a bare handle. Enabled by setting `XAPI_KEY` (or `VITE_XAPI_KEY`) in the environment, or dropping an `apiKey` into `~/.xapi/config.json`; the CLI opts in per-run with `--xapi-enrich`. Fetched content is wrapped in an explicit "untrusted" block in the prompt so the model is told not to follow instructions embedded in third-party text. When the key is absent, the feature is a no-op.

### Stage 4: Structured Multi-Model Review

Multiple reviewer models — prompted as adversarial, skeptical red-team auditors rather than graders — critique the draft against a **six-item rigor rubric** (`src/constants/rubric.js`) targeting real failure modes of the Outcome Token mechanism: MECE outcomes, objective/machine-readable sources, unambiguous UTC timing, manipulation resistance, meaningful trade phase, and named edge-case fallbacks.

1. **Parallel structured reviews** — each reviewer returns prose critique, per-rubric-item votes (`yes`/`no`/`unsure` with rationale), and typed criticisms (blocker/major/minor/nit).
2. **Aggregation** — reviewer votes are aggregated via one of three protocols: `majority`, `unanimity`, or `judge` (an additional LLM renders the final verdict and resolves ties / overrides).
3. **Human feedback** — the user can optionally add their own critiques before proceeding.

### Stage 5: Update

The original drafting model incorporates the aggregated review, claim-level routing focus, and any human feedback to produce an improved draft. The claim pipeline (extraction → verification → evidence → routing) re-runs on the updated draft.

### Stage 6: Source Accessibility Check, Early-Resolution Risk & Finalize

- **Pre-finalize source check** — resolution sources named in the draft are probed for accessibility so the user sees a clear per-source pass/fail list before committing.
- **Early-resolution risk analysis** — a lightweight analyst pass (`src/util/riskLevel.js` + prompts) estimates whether the market could collapse to certainty well before the end date, since 42.space's bonding curve depends on a meaningful trade phase.
- **Finalize** — the draft is converted into structured JSON matching the Outcome Token spawn shape: an array of outcomes (each with its own resolution criteria), start/end times in UTC, short description, full resolution rules, and edge cases. All sections are copyable to clipboard.

### Rigor modes: Machine vs Human

Every run is tagged with a `rigor` of `machine` (the default) or `human`. The toggle lives at the top of the Setup panel and is locked once a draft exists, so a single run keeps the rigor it started with. The selection is also stamped onto the Run artifact (`run.input.rigor`) so an exported / re-imported run renders under its original rigor.

- **Machine** — today's pipeline. The reviewer / structured-reviewer / aggregation-judge prompts use the full adversarial framing ("attack harder", "guilty until proven innocent"), the rubric voting discipline pushes toward `no` on borderline calls, and the post-finalize humanizer **does not run**. Use this when you need the strictest possible output discipline. The committed `eval/baseline.json` is generated under Machine — `npm run eval:check` would surface a regression here as drift in the Machine path.

- **Human** — softer reviewer prompts (helpful-but-diligent rather than red-team), shorter `reviewProse` (≤ 4 sentences), `unsure`-leaning rubric votes when the draft is silent, and concise drafter / updater / finalizer riders. After the finalizer produces the final JSON, the **humanizer** pass rewrites the prose fields (`refinedQuestion`, `outcomes[i].winCondition`, `outcomes[i].resolutionCriteria`, `shortDescription`, `fullResolutionRules`, `edgeCases`) to remove AI-writing tells while keeping all structural fields (outcome names, URLs, ISO timestamps, thresholds) byte-for-byte stable. The humanizer runs **only in Human mode and only from the UI** — the headless CLI and eval harness never invoke it, so the eval baseline stays stable.

The `PROTOCOL_CONTEXT` block — 42's hard mechanism rules — is identical in both modes; rigor only changes the *tone of the critique*, not the *rules of the protocol*. Both modes still produce the full claim → verify → route → review → aggregate → update → risk → source-check → finalize pipeline; nothing about the gates or the structured Run artifact differs between rigors.

The CLI accepts `--rigor=machine|human` (default `machine`); `eval/run.js` accepts the same flag for ad-hoc comparison runs but rejects `--rigor=human` together with `--check-regression` / `--baseline` so a Human run cannot quietly overwrite the Machine baseline.

## CLI

The repository ships a headless CLI (`bin/pm-tools.js`, exposed as `pm-tools`) that runs the full pipeline — including claim extraction, verification, evidence, review, aggregation, update, risk analysis, and finalization — without the React UI. It shares its orchestrator (`src/orchestrate.js`) with the eval harness, so CLI runs are byte-identical in behavior to CI runs.

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

Key flags: `--drafter`, `--reviewers`, `--aggregation` (majority/unanimity/judge), `--escalation` (always/selective), `--rigor` (machine/human, default machine), `--feedback`, `--output`, `--format` (json/summary), `--no-finalize`, `--no-review`, `--timeout`.

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
│   ├── checkSources.js        # Pre-finalize resolution source accessibility check
│   ├── llmJson.js             # Shared JSON salvage + token-accumulator helpers
│   └── xapi.js                # xAPI (X / Twitter) lookups + reference enrichment
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
├── constants/
│   ├── models.js              # LLM model definitions, live-fetch, defaults
│   ├── prompts.js             # System prompts and prompt builders for each stage
│   └── rubric.js              # Six-item rigor rubric for 42.space markets
└── util/
    └── riskLevel.js           # Shared early-resolution risk-level parser
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

- **Single protocol context block** — `PROTOCOL_CONTEXT` in `src/constants/prompts.js` is the single source of truth for 42.space's mechanism rules and is injected into every drafter, reviewer, finalizer, ideator, judge, and verifier prompt. Role preambles set identity and output discipline only; they never restate the rules, so updates to the protocol propagate to every stage at once.
- **Claim-level pipeline** — every draft passes through extraction, verification, evidence gathering, and routing before review. This catches structural problems, hallucinated claims, and broken sources **before** expensive reviewer LLM calls.
- **Run artifact** (`src/types/run.js`) is the canonical record of a pipeline run: drafts, claims, criticisms, evidence, verification results, aggregation decisions, routing rollups, final JSON, cost accounting, and a structured event log. Zod-validated at parse time, so any regression in the orchestrator surfaces as a schema error rather than silent data corruption.
- **Rigor rubric** (`src/constants/rubric.js`) — a six-item checklist targeting real failure modes of the Outcome Token mechanism (MECE outcomes, objective sources, unambiguous timing, manipulation resistance, meaningful trade phase, named edge-case fallbacks).
- **Headless orchestrator** (`src/orchestrate.js`) — runs the full pipeline without React, shared by the CLI and eval harness. Supports abort via `AbortSignal`, lifecycle callbacks, concurrency limiting, and cost accounting.
- **State management** uses React's `useReducer` (via the `useMarketReducer` custom hook) rather than an external state library, keeping the dependency footprint minimal (just `react`, `react-dom`, and `zod` at runtime).
- **API resilience** — the OpenRouter client (`src/api/openrouter.js`) implements automatic retries with exponential backoff (3 retries at 1s/2s/4s intervals) and a shared JSON salvage helper (`src/pipeline/llmJson.js`) that recovers from truncated or fenced LLM output without losing the run.
- **Live model list** — the app fetches available models from the OpenRouter API at startup and caches them for one hour; a static fallback list covers offline / failure scenarios. Default models (`DEFAULT_DRAFT_MODEL`, `DEFAULT_REVIEW_MODEL` in `src/constants/models.js`) are revised in lock-step with OpenRouter availability, so this README intentionally does not pin specific IDs.
- **Prompt-injection defense** for third-party content — xAPI-fetched profile / tweet text is wrapped in an explicit `untrusted` block in the prompt with instructions for the model to treat any embedded directives as data, not instructions.

## Tech Stack

- **React 19** with **Vite 7** for development and bundling
- **OpenRouter API** as the single LLM gateway (any model on OpenRouter can be used as drafter, reviewer, or judge)
- **Zod 4** for runtime schema validation of LLM JSON output and Run artifacts
- **Vitest 4** for unit tests; the eval harness for end-to-end regression tests
- **Node.js 20.19+** for the CLI and eval harness

## Getting Started

### Prerequisites

- Node.js 20.19+
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

The eval harness runs the full pipeline (draft → extract claims →
verify → gather evidence → route → review → aggregate → update → risk →
finalize) against 35+ fixtures without the UI, using a deterministic mock
LLM and mock URL fetcher so the run is reproducible and requires no API
key. It is the same orchestrator the CLI uses — there is no eval-only
code path that could drift from production behavior.

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

The multi-reviewer deliberation stage is **inspired by** the "Structure D" pattern from [`karpathy/llm-council`](https://github.com/karpathy/llm-council) and has been re-implemented from scratch here. Because `karpathy/llm-council` ships without a licence, no code has been copied from that repository — only the high-level pattern (independent parallel reviews followed by a synthesis pass) has been borrowed. Any resemblance beyond that is coincidental.

## Licence

Released under the [MIT License](LICENSE).
