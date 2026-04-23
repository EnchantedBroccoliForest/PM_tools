/**
 * Rigor-level prompt resolver.
 *
 * Maps `rigorLevel` ('machine' | 'human') to a bundle of prompt builders and
 * system prompts, so the orchestrator, the React handlers, and the CLI can
 * all pull from a single source of truth without knowing which level is
 * active.
 *
 * Phase 1: this module exists and is exported, but no production call site
 * imports it yet. Later phases wire `orchestrate.js`, `App.jsx`, and
 * `bin/pm-tools.js` through `resolvePromptSet`.
 *
 * Naming note: the existing `buildStrict*RetryPrompt` exports use "Strict"
 * to mark strict-JSON-parsing retry builders. That is unrelated to the
 * rigor level — in the human bundle they simply get a `Human` suffix added
 * after the existing name (buildStrictClaimExtractorRetryPromptHuman).
 */

import * as machine from './prompts.js';
import * as human from './prompts.human.js';

export const DEFAULT_RIGOR_LEVEL = 'machine';
export const RIGOR_LEVELS = ['machine', 'human'];

/**
 * Resolve the prompt bundle for a given rigor level. Unknown or missing
 * values fall back to machine silently — the schema also accepts only
 * 'machine' | 'human', so untrusted inputs still can't produce a surprise
 * bundle. `buildRoutingFocusBlock` is deterministic and shared across modes.
 *
 * @param {string|undefined} rigorLevel
 * @returns {{
 *   SYSTEM_PROMPTS: typeof machine.SYSTEM_PROMPTS,
 *   buildDraftPrompt: typeof machine.buildDraftPrompt,
 *   buildUpdatePrompt: typeof machine.buildUpdatePrompt,
 *   buildFinalizePrompt: typeof machine.buildFinalizePrompt,
 *   buildEarlyResolutionPrompt: typeof machine.buildEarlyResolutionPrompt,
 *   buildStructuredReviewPrompt: typeof machine.buildStructuredReviewPrompt,
 *   buildStrictStructuredReviewRetryPrompt: typeof machine.buildStrictStructuredReviewRetryPrompt,
 *   buildJudgeAggregatorPrompt: typeof machine.buildJudgeAggregatorPrompt,
 *   buildStrictJudgeAggregatorRetryPrompt: typeof machine.buildStrictJudgeAggregatorRetryPrompt,
 *   buildClaimExtractorPrompt: typeof machine.buildClaimExtractorPrompt,
 *   buildStrictClaimExtractorRetryPrompt: typeof machine.buildStrictClaimExtractorRetryPrompt,
 *   buildBatchEntailmentPrompt: typeof machine.buildBatchEntailmentPrompt,
 *   buildStrictBatchEntailmentRetryPrompt: typeof machine.buildStrictBatchEntailmentRetryPrompt,
 *   buildHumanizerPrompt: typeof machine.buildHumanizerPrompt,
 *   buildDeliberationPrompt: typeof machine.buildDeliberationPrompt,
 *   buildIdeatePrompt: typeof machine.buildIdeatePrompt,
 *   buildReviewPrompt: typeof machine.buildReviewPrompt,
 *   buildRoutingFocusBlock: typeof machine.buildRoutingFocusBlock,
 *   rigorLevel: 'machine' | 'human',
 * }}
 */
export function resolvePromptSet(rigorLevel) {
  if (rigorLevel === 'human') {
    return {
      SYSTEM_PROMPTS: human.SYSTEM_PROMPTS_HUMAN,
      buildDraftPrompt: human.buildDraftPromptHuman,
      buildUpdatePrompt: human.buildUpdatePromptHuman,
      buildFinalizePrompt: human.buildFinalizePromptHuman,
      buildEarlyResolutionPrompt: human.buildEarlyResolutionPromptHuman,
      buildStructuredReviewPrompt: human.buildStructuredReviewPromptHuman,
      buildStrictStructuredReviewRetryPrompt: human.buildStrictStructuredReviewRetryPromptHuman,
      buildJudgeAggregatorPrompt: human.buildJudgeAggregatorPromptHuman,
      buildStrictJudgeAggregatorRetryPrompt: human.buildStrictJudgeAggregatorRetryPromptHuman,
      buildClaimExtractorPrompt: human.buildClaimExtractorPromptHuman,
      buildStrictClaimExtractorRetryPrompt: human.buildStrictClaimExtractorRetryPromptHuman,
      buildBatchEntailmentPrompt: human.buildBatchEntailmentPromptHuman,
      buildStrictBatchEntailmentRetryPrompt: human.buildStrictBatchEntailmentRetryPromptHuman,
      buildHumanizerPrompt: human.buildHumanizerPromptHuman,
      buildDeliberationPrompt: human.buildDeliberationPromptHuman,
      buildIdeatePrompt: human.buildIdeatePromptHuman,
      buildReviewPrompt: human.buildReviewPromptHuman,
      buildRoutingFocusBlock: machine.buildRoutingFocusBlock,
      rigorLevel: 'human',
    };
  }
  return {
    SYSTEM_PROMPTS: machine.SYSTEM_PROMPTS,
    buildDraftPrompt: machine.buildDraftPrompt,
    buildUpdatePrompt: machine.buildUpdatePrompt,
    buildFinalizePrompt: machine.buildFinalizePrompt,
    buildEarlyResolutionPrompt: machine.buildEarlyResolutionPrompt,
    buildStructuredReviewPrompt: machine.buildStructuredReviewPrompt,
    buildStrictStructuredReviewRetryPrompt: machine.buildStrictStructuredReviewRetryPrompt,
    buildJudgeAggregatorPrompt: machine.buildJudgeAggregatorPrompt,
    buildStrictJudgeAggregatorRetryPrompt: machine.buildStrictJudgeAggregatorRetryPrompt,
    buildClaimExtractorPrompt: machine.buildClaimExtractorPrompt,
    buildStrictClaimExtractorRetryPrompt: machine.buildStrictClaimExtractorRetryPrompt,
    buildBatchEntailmentPrompt: machine.buildBatchEntailmentPrompt,
    buildStrictBatchEntailmentRetryPrompt: machine.buildStrictBatchEntailmentRetryPrompt,
    buildHumanizerPrompt: machine.buildHumanizerPrompt,
    buildDeliberationPrompt: machine.buildDeliberationPrompt,
    buildIdeatePrompt: machine.buildIdeatePrompt,
    buildReviewPrompt: machine.buildReviewPrompt,
    buildRoutingFocusBlock: machine.buildRoutingFocusBlock,
    rigorLevel: 'machine',
  };
}
