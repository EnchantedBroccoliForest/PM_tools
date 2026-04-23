/**
 * Phase 1 — foundation tests for the rigor-level prompt resolver.
 *
 * Verifies the shape and fallback behaviour of `resolvePromptSet`. The
 * human-mode prompt bundle is a stub in Phase 1 (it re-exports the
 * machine-mode builders under `*Human` aliases), so the reference-equality
 * assertions for human mode compare against the machine-mode sources —
 * this is intentional and documents the Phase 1 equivalence. Phase 3
 * replaces the stubs with real human-mode prompts; when that happens, the
 * `human bundle` reference-equality assertions will continue to pass
 * against whatever ships under `prompts.human.js` because they read the
 * same exports `resolvePromptSet` reads.
 */

import { describe, it, expect } from 'vitest';
import {
  resolvePromptSet,
  DEFAULT_RIGOR_LEVEL,
  RIGOR_LEVELS,
} from '../src/constants/promptSet.js';
import * as machine from '../src/constants/prompts.js';
import * as human from '../src/constants/prompts.human.js';

const MACHINE_BUILDER_FIELDS = [
  ['SYSTEM_PROMPTS', 'SYSTEM_PROMPTS'],
  ['buildDraftPrompt', 'buildDraftPrompt'],
  ['buildUpdatePrompt', 'buildUpdatePrompt'],
  ['buildFinalizePrompt', 'buildFinalizePrompt'],
  ['buildEarlyResolutionPrompt', 'buildEarlyResolutionPrompt'],
  ['buildStructuredReviewPrompt', 'buildStructuredReviewPrompt'],
  ['buildStrictStructuredReviewRetryPrompt', 'buildStrictStructuredReviewRetryPrompt'],
  ['buildJudgeAggregatorPrompt', 'buildJudgeAggregatorPrompt'],
  ['buildStrictJudgeAggregatorRetryPrompt', 'buildStrictJudgeAggregatorRetryPrompt'],
  ['buildClaimExtractorPrompt', 'buildClaimExtractorPrompt'],
  ['buildStrictClaimExtractorRetryPrompt', 'buildStrictClaimExtractorRetryPrompt'],
  ['buildBatchEntailmentPrompt', 'buildBatchEntailmentPrompt'],
  ['buildStrictBatchEntailmentRetryPrompt', 'buildStrictBatchEntailmentRetryPrompt'],
  ['buildHumanizerPrompt', 'buildHumanizerPrompt'],
  ['buildDeliberationPrompt', 'buildDeliberationPrompt'],
  ['buildIdeatePrompt', 'buildIdeatePrompt'],
  ['buildReviewPrompt', 'buildReviewPrompt'],
  ['buildRoutingFocusBlock', 'buildRoutingFocusBlock'],
];

// Human-bundle keys map to the `*Human` exports from prompts.human.js.
// `buildRoutingFocusBlock` is deterministic and shared across modes, so
// the human branch deliberately still reads it from the machine module.
const HUMAN_BUILDER_FIELDS = [
  ['SYSTEM_PROMPTS', 'SYSTEM_PROMPTS_HUMAN'],
  ['buildDraftPrompt', 'buildDraftPromptHuman'],
  ['buildUpdatePrompt', 'buildUpdatePromptHuman'],
  ['buildFinalizePrompt', 'buildFinalizePromptHuman'],
  ['buildEarlyResolutionPrompt', 'buildEarlyResolutionPromptHuman'],
  ['buildStructuredReviewPrompt', 'buildStructuredReviewPromptHuman'],
  ['buildStrictStructuredReviewRetryPrompt', 'buildStrictStructuredReviewRetryPromptHuman'],
  ['buildJudgeAggregatorPrompt', 'buildJudgeAggregatorPromptHuman'],
  ['buildStrictJudgeAggregatorRetryPrompt', 'buildStrictJudgeAggregatorRetryPromptHuman'],
  ['buildClaimExtractorPrompt', 'buildClaimExtractorPromptHuman'],
  ['buildStrictClaimExtractorRetryPrompt', 'buildStrictClaimExtractorRetryPromptHuman'],
  ['buildBatchEntailmentPrompt', 'buildBatchEntailmentPromptHuman'],
  ['buildStrictBatchEntailmentRetryPrompt', 'buildStrictBatchEntailmentRetryPromptHuman'],
  ['buildHumanizerPrompt', 'buildHumanizerPromptHuman'],
  ['buildDeliberationPrompt', 'buildDeliberationPromptHuman'],
  ['buildIdeatePrompt', 'buildIdeatePromptHuman'],
  ['buildReviewPrompt', 'buildReviewPromptHuman'],
];

describe('resolvePromptSet — constants', () => {
  it('DEFAULT_RIGOR_LEVEL is "machine"', () => {
    expect(DEFAULT_RIGOR_LEVEL).toBe('machine');
  });

  it('RIGOR_LEVELS lists both modes', () => {
    expect(RIGOR_LEVELS).toEqual(['machine', 'human']);
  });
});

describe("resolvePromptSet('machine')", () => {
  it('returns reference-equal machine builders', () => {
    const set = resolvePromptSet('machine');
    for (const [bundleKey, machineKey] of MACHINE_BUILDER_FIELDS) {
      expect(set[bundleKey]).toBe(machine[machineKey]);
    }
  });

  it("tags rigorLevel: 'machine'", () => {
    expect(resolvePromptSet('machine').rigorLevel).toBe('machine');
  });
});

describe("resolvePromptSet('human')", () => {
  it('returns reference-equal human builders', () => {
    const set = resolvePromptSet('human');
    for (const [bundleKey, humanKey] of HUMAN_BUILDER_FIELDS) {
      expect(set[bundleKey]).toBe(human[humanKey]);
    }
  });

  it('routes buildRoutingFocusBlock to the shared (machine-module) implementation', () => {
    const set = resolvePromptSet('human');
    expect(set.buildRoutingFocusBlock).toBe(machine.buildRoutingFocusBlock);
  });

  it("tags rigorLevel: 'human'", () => {
    expect(resolvePromptSet('human').rigorLevel).toBe('human');
  });
});

describe('resolvePromptSet — fallback behaviour', () => {
  it('unknown values fall back to machine', () => {
    expect(resolvePromptSet('gibberish').rigorLevel).toBe('machine');
    expect(resolvePromptSet('').rigorLevel).toBe('machine');
  });

  it('undefined / null fall back to machine', () => {
    expect(resolvePromptSet(undefined).rigorLevel).toBe('machine');
    expect(resolvePromptSet(null).rigorLevel).toBe('machine');
  });
});

describe('resolvePromptSet — name-drift guard', () => {
  // If a field lands on machine and is missing from human (or vice versa),
  // every downstream handler has to grow a defensive null-check. The two
  // bundles must expose the same keys at all times.
  it('machine and human bundles expose the same keys', () => {
    const machineKeys = Object.keys(resolvePromptSet('machine')).sort();
    const humanKeys = Object.keys(resolvePromptSet('human')).sort();
    expect(humanKeys).toEqual(machineKeys);
  });
});
