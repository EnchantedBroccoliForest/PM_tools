/**
 * Default configuration for the PM_tools pipeline.
 *
 * Shared by the React app (via useMarketReducer) and the CLI/orchestrator
 * so both consumers agree on model IDs, reviewer lists, and option defaults.
 * All values are pulled from the existing constants in models.js and the
 * initial state in the UI reducer.
 */

import { DEFAULT_DRAFT_MODEL, DEFAULT_REVIEW_MODEL } from './constants/models.js';

/** Default OpenRouter model ID for drafting. */
export const DEFAULT_DRAFTER_MODEL = DEFAULT_DRAFT_MODEL;

/**
 * Default reviewer council. The UI starts with a single reviewer; the CLI
 * mirrors that. Users can add up to 4 via flags or config.
 */
export const DEFAULT_REVIEWER_MODELS = [
  { id: DEFAULT_REVIEW_MODEL, name: 'Gemini 3 Pro' },
];

/**
 * Default judge model for aggregation='judge' mode. The UI uses the first
 * review model as the judge, so we mirror that here.
 */
export const DEFAULT_JUDGE_MODEL = DEFAULT_REVIEW_MODEL;

/**
 * Default pipeline options. Mirrors the initial state in useMarketReducer
 * and the eval harness's default ablation settings.
 */
export const DEFAULT_OPTIONS = {
  aggregation: 'majority',
  escalation: 'always',
  evidence: 'retrieval',
  verifiers: 'full',
  deliberation: 'off',
};
