// TODO phase 3: replace with real human prompts.
//
// Phase 1 stub: re-exports every machine-mode prompt from ./prompts.js under
// `*Human` aliases so `resolvePromptSet('human')` can be imported and wired
// through without crashing. Nothing yet routes human-mode callers here;
// production code paths still use the machine-mode bundle exclusively.
//
// Naming note: the `humanReviewInput` parameter on buildUpdatePromptHuman is
// unrelated to the new `human` rigor level — it names the free-text field a
// (meat-and-bones) human reviewer types in. Kept verbatim to avoid churn.

import {
  PROTOCOL_CONTEXT,
  SYSTEM_PROMPTS,
  buildDraftPrompt,
  buildReviewPrompt,
  buildDeliberationPrompt,
  buildUpdatePrompt,
  buildFinalizePrompt,
  buildHumanizerPrompt,
  buildIdeatePrompt,
  buildClaimExtractorPrompt,
  buildStrictClaimExtractorRetryPrompt,
  buildStructuredReviewPrompt,
  buildStrictStructuredReviewRetryPrompt,
  buildJudgeAggregatorPrompt,
  buildStrictJudgeAggregatorRetryPrompt,
  buildBatchEntailmentPrompt,
  buildStrictBatchEntailmentRetryPrompt,
  buildEarlyResolutionPrompt,
} from './prompts.js';

export const PROTOCOL_CONTEXT_HUMAN = PROTOCOL_CONTEXT;
export const SYSTEM_PROMPTS_HUMAN = SYSTEM_PROMPTS;

export const buildDraftPromptHuman = buildDraftPrompt;
export const buildReviewPromptHuman = buildReviewPrompt;
export const buildDeliberationPromptHuman = buildDeliberationPrompt;
export const buildUpdatePromptHuman = buildUpdatePrompt;
export const buildFinalizePromptHuman = buildFinalizePrompt;
export const buildHumanizerPromptHuman = buildHumanizerPrompt;
export const buildIdeatePromptHuman = buildIdeatePrompt;
export const buildClaimExtractorPromptHuman = buildClaimExtractorPrompt;
export const buildStrictClaimExtractorRetryPromptHuman = buildStrictClaimExtractorRetryPrompt;
export const buildStructuredReviewPromptHuman = buildStructuredReviewPrompt;
export const buildStrictStructuredReviewRetryPromptHuman = buildStrictStructuredReviewRetryPrompt;
export const buildJudgeAggregatorPromptHuman = buildJudgeAggregatorPrompt;
export const buildStrictJudgeAggregatorRetryPromptHuman = buildStrictJudgeAggregatorRetryPrompt;
export const buildBatchEntailmentPromptHuman = buildBatchEntailmentPrompt;
export const buildStrictBatchEntailmentRetryPromptHuman = buildStrictBatchEntailmentRetryPrompt;
export const buildEarlyResolutionPromptHuman = buildEarlyResolutionPrompt;
