# PM_tools — AI-Assisted Prediction Market Creator

A web application that uses multiple LLMs via the OpenRouter API to help users design well-defined prediction market questions through a multi-stage drafting, review, and refinement process.

## How It Works

PM_tools guides users through a four-stage workflow to produce unambiguous, objective prediction markets:

### Stage 1: Draft

The user provides a prediction market question, start/end dates, and selects a drafting model. The LLM generates a comprehensive market draft that includes:

- A refined, unambiguous question
- Detailed resolution criteria
- A complete set of mutually exclusive outcomes
- Edge case handling
- Potential sources for resolution

### Stage 2: Multi-Model Review & Deliberation

Inspired by the ["Structure D" deliberation pattern](https://github.com/karpathy/llm-council) from `karpathy/llm-council`, multiple reviewer models critique the draft:

1. **Independent Review** — Up to 4 different models independently review the draft in parallel.
2. **Deliberation** — If 2+ reviews succeed, the first reviewer acts as "chairman" and synthesizes a consolidated deliberated review incorporating insights from all reviewers.
3. **Human Feedback** — The user can optionally add their own critiques before proceeding.

### Stage 3: Update

The original drafting model incorporates the deliberated review and any human feedback to produce an improved draft that addresses the identified issues.

### Stage 4: Finalize

The final draft is converted into structured JSON containing:

- Array of outcomes, each with resolution criteria
- Market start/end times in UTC
- Short description
- Full resolution rules
- Edge cases documentation

All sections are copyable to clipboard.

## Architecture

```
src/
├── App.jsx                    # Main UI component and workflow orchestration (~600 lines)
├── main.jsx                   # React entry point
├── api/
│   └── openrouter.js          # OpenRouter API client with exponential backoff retries
├── hooks/
│   └── useMarketReducer.js    # Central state management via useReducer
├── components/
│   └── ModelSelect.jsx        # Reusable model selection dropdown
└── constants/
    ├── models.js              # LLM model definitions and defaults
    └── prompts.js             # System prompts and prompt builders for each stage
```

### Key Design Decisions

- **State management** uses React's `useReducer` (via the `useMarketReducer` custom hook) rather than an external state library, keeping the dependency footprint minimal.
- **Prompt engineering** is centralized in `src/constants/prompts.js` with distinct system prompts for the drafter, reviewer, and finalizer roles, plus builder functions for each stage's user prompt.
- **API resilience** — The OpenRouter client (`src/api/openrouter.js`) implements automatic retries with exponential backoff (3 retries at 1s/2s/4s intervals).
- **Model flexibility** — 20+ models are available across 6 providers (OpenAI, Anthropic, Google, DeepSeek, Meta, Mistral). The default drafting and review models are declared in `src/constants/models.js` as `DEFAULT_DRAFT_MODEL` and `DEFAULT_REVIEW_MODEL`; these are revised in lock-step with OpenRouter model availability, so this README intentionally does not pin specific ids.

## Tech Stack

- **React 19** with **Vite** for development and bundling
- **OpenRouter API** for LLM inference
- No additional runtime dependencies beyond React and React-DOM

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

### Linting

```bash
npm run lint
```

### Regression eval harness

The Phase 6 eval harness runs the full PM_tools pipeline (draft → extract
claims → verify → gather evidence → review → aggregate → update → risk →
finalize) against 30+ fixtures without the UI, using a deterministic mock
LLM and mock URL fetcher so the run is reproducible and requires no API
key.

```bash
# Run the full suite against the default ablation
npm run eval

# Run with specific ablation flags (the four knobs from the work order)
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
buckets mirroring the work order: `ambiguity`, `adversarial-factual`,
`rag-trap`, and `numerical-date`. Each fixture carries its own
`expectedProperties` block that the harness checks against the
resulting Run artifact.

A GitHub Actions workflow at `.github/workflows/eval.yml` runs the eval
on every PR that touches `src/pipeline/**`, `src/constants/prompts.js`,
`src/api/openrouter.js`, `eval/**`, or the workflow itself. A PR that
weakens a verifier gate (or otherwise regresses accuracy, citation
coverage, or verifier pass rate by more than 10%) fails CI.

## Attribution

PM_tools' multi-reviewer deliberation stage is **inspired by** the "Structure D" pattern from [`karpathy/llm-council`](https://github.com/karpathy/llm-council) and has been re-implemented from scratch here. Because `karpathy/llm-council` ships without a licence, no code has been copied from that repository — only the high-level pattern (independent parallel reviews followed by a synthesis pass) has been borrowed. Any resemblance beyond that is coincidental.

## Licence

PM_tools is released under the [MIT License](LICENSE).
