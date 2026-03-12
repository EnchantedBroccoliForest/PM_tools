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

Inspired by the [llm-council](https://github.com/llm-council/llm-council) "Structure D" deliberation model, multiple reviewer models critique the draft:

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
- **Model flexibility** — 20+ models are available across 6 providers (OpenAI, Anthropic, Google, DeepSeek, Meta, Mistral). Default drafting model is GPT-5.1; default reviewer is Claude 3.5 Haiku.

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
