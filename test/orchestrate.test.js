/**
 * Phase 2 — orchestrator tests for the rigor-level conditional-write contract.
 *
 * The orchestrator must only persist `rigorLevel` on the Run artifact when
 * the value is non-default ('human'). This keeps the committed machine-mode
 * eval baseline byte-identical (it has no `rigorLevel` key) while still
 * tagging every human-mode run for debuggability.
 *
 * These tests run a minimal pipeline with `skipReview: true`, evidence and
 * verifiers disabled, and a stub LLM that returns an empty claim array, so
 * the orchestrator exits after the claim stage. Just enough to confirm the
 * rigor-level field handling without invoking the full pipeline.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installQueryModel, resetQueryModel } from '../src/api/openrouter.js';
import { orchestrate } from '../src/orchestrate.js';

const STUB_RESULT = {
  content: '[]',
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  wallClockMs: 0,
};

const BASE_CONFIG = {
  input: {
    question: 'Will X happen by Y?',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    references: '',
  },
  // Stop right after the claim stage so we don't drag the full pipeline
  // (review / update / risk / finalize) through the stub LLM. Verifiers
  // and evidence are disabled to keep the run a single-LLM-call affair.
  options: {
    skipReview: true,
    verifiers: 'off',
    evidence: 'none',
  },
};

describe('orchestrate — rigorLevel conditional persistence', () => {
  beforeEach(() => installQueryModel(async () => STUB_RESULT));
  afterEach(() => resetQueryModel());

  it('machine mode (default, no rigorLevel option) does not write rigorLevel onto the Run', async () => {
    const run = await orchestrate(BASE_CONFIG);
    expect('rigorLevel' in run).toBe(false);
  });

  it("explicit rigorLevel: 'machine' still does not write the field", async () => {
    const run = await orchestrate({
      ...BASE_CONFIG,
      options: { ...BASE_CONFIG.options, rigorLevel: 'machine' },
    });
    expect('rigorLevel' in run).toBe(false);
  });

  it("rigorLevel: 'human' writes 'human' onto the Run", async () => {
    const run = await orchestrate({
      ...BASE_CONFIG,
      options: { ...BASE_CONFIG.options, rigorLevel: 'human' },
    });
    expect(run.rigorLevel).toBe('human');
  });

  it('unknown rigor level falls back to machine and does not write the field', async () => {
    const run = await orchestrate({
      ...BASE_CONFIG,
      options: { ...BASE_CONFIG.options, rigorLevel: 'gibberish' },
    });
    expect('rigorLevel' in run).toBe(false);
  });

  it("rigorLevel: 'human' is a liveness path — orchestrator does not crash on the Phase 1 stub bundle", async () => {
    const run = await orchestrate({
      ...BASE_CONFIG,
      options: { ...BASE_CONFIG.options, rigorLevel: 'human' },
    });
    // The minimal pipeline succeeds (drafter returns "[]", which the claim
    // extractor reads as zero claims, exiting via the empty-claims branch
    // and then via the skipReview short-circuit).
    expect(run.status).toBe('partial');
    expect(run.drafts).toHaveLength(1);
  });
});
