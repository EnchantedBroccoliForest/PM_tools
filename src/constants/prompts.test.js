/**
 * Phase 4 prompt-fork tests.
 *
 * Two independent guarantees:
 *
 *   1. Machine-mode prompts are byte-identical to today (snapshot check),
 *      so the eval baseline cannot drift behind a "harmless" wording tweak.
 *
 *   2. Human-mode prompts diverge from Machine where Phase 3 forked them,
 *      and still carry the load-bearing tokens (PROTOCOL_CONTEXT, the
 *      JSON-output instruction, the structured-review schema keys). A
 *      Human variant that silently drops one of those is the
 *      single-biggest risk called out in §Risk of the plan.
 *
 *   3. No call site reads `SYSTEM_PROMPTS.<role>` directly — the only
 *      accepted paths are `SYSTEM_PROMPTS.machine[role]`,
 *      `SYSTEM_PROMPTS.human[role]`, and `getSystemPrompt(role, rigor)`.
 *      The flat form is deliberately disallowed so a new call site
 *      can't quietly skip the rigor accessor.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SYSTEM_PROMPTS,
  PROTOCOL_CONTEXT,
  getSystemPrompt,
  buildDraftPrompt,
  buildReviewPrompt,
  buildDeliberationPrompt,
  buildStructuredReviewPrompt,
  buildStrictStructuredReviewRetryPrompt,
  buildUpdatePrompt,
  buildFinalizePrompt,
  buildMarketQuestionTitleRepairPrompt,
  buildEarlyResolutionPrompt,
  buildIdeatePrompt,
  buildJudgeAggregatorPrompt,
} from './prompts.js';
import { RIGOR_RUBRIC } from './rubric.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const SRC_DIR = join(REPO_ROOT, 'src');

// Stable example inputs for builder snapshots / comparison. Values are
// chosen so any rigor-driven branching in the body is visible in the
// rendered string (e.g. when humanReviewInput is non-empty, the update
// prompt switches on it; we want both branches exercised across the
// suite).
const SAMPLE = {
  question: 'Which artist tops the 2026 Hot 100?',
  startDate: '2026-01-01',
  endDate: '2026-12-31',
  references: 'https://example.com/source',
  numberOfOutcomes: '4',
  draftContent: 'DRAFT_PLACEHOLDER',
  reviews: [{ modelName: 'rev-1', content: 'critique-1' }, { modelName: 'rev-2', content: 'critique-2' }],
  reviewContent: 'review-text',
  humanReviewInput: 'human-feedback',
  focusBlock: '  - BLOCKING claim.outcome.0.win: example [reason]',
  checklist: [
    { id: 'mece', votes: [{ reviewerModel: 'rv-1', verdict: 'yes', rationale: 'ok' }] },
  ],
  direction: 'esports markets in Q4',
};

// ------------------------------- 1. SYSTEM_PROMPTS shape and forks ---------

describe('SYSTEM_PROMPTS structure', () => {
  it('exposes a machine bucket and a human bucket', () => {
    expect(SYSTEM_PROMPTS).toHaveProperty('machine');
    expect(SYSTEM_PROMPTS).toHaveProperty('human');
  });

  it('has the same role keys in both buckets', () => {
    expect(Object.keys(SYSTEM_PROMPTS.human).sort()).toEqual(
      Object.keys(SYSTEM_PROMPTS.machine).sort(),
    );
  });

  it('inherits rigor-invariant roles from machine into human (drafter / finalizer / earlyResolutionAnalyst / ideator / claimExtractor / entailmentVerifier / humanizer)', () => {
    for (const role of [
      'drafter',
      'finalizer',
      'earlyResolutionAnalyst',
      'ideator',
      'claimExtractor',
      'entailmentVerifier',
      'humanizer',
    ]) {
      expect(SYSTEM_PROMPTS.human[role]).toBe(SYSTEM_PROMPTS.machine[role]);
    }
  });

  it('forks reviewer / structuredReviewer / aggregationJudge in human mode', () => {
    for (const role of ['reviewer', 'structuredReviewer', 'aggregationJudge']) {
      expect(SYSTEM_PROMPTS.human[role]).not.toBe(SYSTEM_PROMPTS.machine[role]);
      expect(SYSTEM_PROMPTS.human[role]).not.toEqual(SYSTEM_PROMPTS.machine[role]);
    }
  });

  it('every reviewer / structuredReviewer / aggregationJudge variant carries PROTOCOL_CONTEXT (load-bearing)', () => {
    for (const role of ['reviewer', 'structuredReviewer', 'aggregationJudge']) {
      expect(SYSTEM_PROMPTS.machine[role]).toContain(PROTOCOL_CONTEXT);
      expect(SYSTEM_PROMPTS.human[role]).toContain(PROTOCOL_CONTEXT);
    }
  });

  it('structuredReviewer variants both demand strictly valid JSON output', () => {
    expect(SYSTEM_PROMPTS.machine.structuredReviewer).toMatch(/strictly valid JSON/i);
    expect(SYSTEM_PROMPTS.human.structuredReviewer).toMatch(/strictly valid JSON/i);
  });
});

describe('getSystemPrompt(role, rigor)', () => {
  it('returns the machine variant by default', () => {
    expect(getSystemPrompt('reviewer')).toBe(SYSTEM_PROMPTS.machine.reviewer);
  });

  it('returns the human variant when rigor=human', () => {
    expect(getSystemPrompt('reviewer', 'human')).toBe(SYSTEM_PROMPTS.human.reviewer);
  });

  it('falls back to the machine variant for an unknown rigor', () => {
    expect(getSystemPrompt('reviewer', 'yolo')).toBe(SYSTEM_PROMPTS.machine.reviewer);
  });

  it('falls back to the machine variant if a role is missing from the requested bucket', () => {
    // Defensive: simulate what would happen if a future Phase added a role
    // to machine but forgot to add it to human. Because human starts as a
    // spread copy of machine, every role is normally present in both
    // buckets — to actually exercise the fallback we have to delete the
    // role from human for the duration of the assertion. (Without this
    // mutation the test would pass even if the resolver stopped falling
    // back, which defeats the point.)
    const original = SYSTEM_PROMPTS.human.claimExtractor;
    delete SYSTEM_PROMPTS.human.claimExtractor;
    try {
      expect('claimExtractor' in SYSTEM_PROMPTS.human).toBe(false);
      expect(getSystemPrompt('claimExtractor', 'human')).toBe(SYSTEM_PROMPTS.machine.claimExtractor);
    } finally {
      SYSTEM_PROMPTS.human.claimExtractor = original;
    }
  });
});

// ----------------------------- 2. Per-builder Machine snapshots ------------
//
// Inline snapshots lock today's Machine output at byte-equality. Any
// drift here is a regression — the eval baseline depends on these
// strings staying stable.

describe('Machine-mode prompt builders are byte-stable', () => {
  it('buildDraftPrompt machine snapshot', () => {
    const out = buildDraftPrompt(
      SAMPLE.question, SAMPLE.startDate, SAMPLE.endDate,
      SAMPLE.references, SAMPLE.numberOfOutcomes,
    );
    expect(out).toMatchSnapshot();
  });

  it('buildReviewPrompt machine snapshot', () => {
    expect(buildReviewPrompt(SAMPLE.draftContent)).toMatchSnapshot();
  });

  it('buildDeliberationPrompt machine snapshot', () => {
    expect(
      buildDeliberationPrompt(SAMPLE.draftContent, SAMPLE.reviews, SAMPLE.numberOfOutcomes),
    ).toMatchSnapshot();
  });

  it('buildStructuredReviewPrompt machine snapshot', () => {
    expect(
      buildStructuredReviewPrompt(SAMPLE.draftContent, RIGOR_RUBRIC, SAMPLE.numberOfOutcomes),
    ).toMatchSnapshot();
  });

  it('buildUpdatePrompt machine snapshot', () => {
    expect(
      buildUpdatePrompt(
        SAMPLE.draftContent, SAMPLE.reviewContent, SAMPLE.humanReviewInput,
        SAMPLE.focusBlock, SAMPLE.numberOfOutcomes, SAMPLE.references,
      ),
    ).toMatchSnapshot();
  });

  it('buildFinalizePrompt machine snapshot', () => {
    expect(
      buildFinalizePrompt(SAMPLE.draftContent, SAMPLE.startDate, SAMPLE.endDate, SAMPLE.numberOfOutcomes),
    ).toMatchSnapshot();
  });

  it('buildEarlyResolutionPrompt machine snapshot', () => {
    expect(
      buildEarlyResolutionPrompt(SAMPLE.draftContent, SAMPLE.startDate, SAMPLE.endDate),
    ).toMatchSnapshot();
  });

  it('buildIdeatePrompt machine snapshot', () => {
    expect(buildIdeatePrompt(SAMPLE.direction)).toMatchSnapshot();
  });

  it('buildJudgeAggregatorPrompt machine snapshot', () => {
    expect(buildJudgeAggregatorPrompt(RIGOR_RUBRIC, SAMPLE.checklist)).toMatchSnapshot();
  });
});

// ---------------- 3. Human-mode bodies diverge where they should -----------
//
// For each builder where Phase 3 documented a Human-mode change, assert
// that Human output is not byte-identical to Machine. This is the
// "softening actually landed" sanity check.

describe('Human-mode prompt builders diverge from Machine', () => {
  // buildEarlyResolutionPrompt is intentionally rigor-equivalent per
  // §3.2; it is NOT in this divergence list.
  it.each([
    ['buildDraftPrompt', () => [
      buildDraftPrompt(SAMPLE.question, SAMPLE.startDate, SAMPLE.endDate, SAMPLE.references, SAMPLE.numberOfOutcomes, 'machine'),
      buildDraftPrompt(SAMPLE.question, SAMPLE.startDate, SAMPLE.endDate, SAMPLE.references, SAMPLE.numberOfOutcomes, 'human'),
    ]],
    ['buildReviewPrompt', () => [
      buildReviewPrompt(SAMPLE.draftContent, 'machine'),
      buildReviewPrompt(SAMPLE.draftContent, 'human'),
    ]],
    ['buildDeliberationPrompt', () => [
      buildDeliberationPrompt(SAMPLE.draftContent, SAMPLE.reviews, SAMPLE.numberOfOutcomes, 'machine'),
      buildDeliberationPrompt(SAMPLE.draftContent, SAMPLE.reviews, SAMPLE.numberOfOutcomes, 'human'),
    ]],
    ['buildStructuredReviewPrompt', () => [
      buildStructuredReviewPrompt(SAMPLE.draftContent, RIGOR_RUBRIC, SAMPLE.numberOfOutcomes, 'machine'),
      buildStructuredReviewPrompt(SAMPLE.draftContent, RIGOR_RUBRIC, SAMPLE.numberOfOutcomes, 'human'),
    ]],
    ['buildUpdatePrompt', () => [
      buildUpdatePrompt(SAMPLE.draftContent, SAMPLE.reviewContent, SAMPLE.humanReviewInput, SAMPLE.focusBlock, SAMPLE.numberOfOutcomes, SAMPLE.references, 'machine'),
      buildUpdatePrompt(SAMPLE.draftContent, SAMPLE.reviewContent, SAMPLE.humanReviewInput, SAMPLE.focusBlock, SAMPLE.numberOfOutcomes, SAMPLE.references, 'human'),
    ]],
    ['buildFinalizePrompt', () => [
      buildFinalizePrompt(SAMPLE.draftContent, SAMPLE.startDate, SAMPLE.endDate, SAMPLE.numberOfOutcomes, 'machine'),
      buildFinalizePrompt(SAMPLE.draftContent, SAMPLE.startDate, SAMPLE.endDate, SAMPLE.numberOfOutcomes, 'human'),
    ]],
    ['buildIdeatePrompt', () => [
      buildIdeatePrompt(SAMPLE.direction, 'machine'),
      buildIdeatePrompt(SAMPLE.direction, 'human'),
    ]],
    ['buildJudgeAggregatorPrompt', () => [
      buildJudgeAggregatorPrompt(RIGOR_RUBRIC, SAMPLE.checklist, 'machine'),
      buildJudgeAggregatorPrompt(RIGOR_RUBRIC, SAMPLE.checklist, 'human'),
    ]],
  ])('%s human variant differs from machine', (_name, render) => {
    const [machine, human] = render();
    expect(human).not.toBe(machine);
    expect(human).not.toEqual(machine);
  });

  it('buildEarlyResolutionPrompt is rigor-equivalent (intentionally not forked)', () => {
    const machine = buildEarlyResolutionPrompt(SAMPLE.draftContent, SAMPLE.startDate, SAMPLE.endDate, 'machine');
    const human = buildEarlyResolutionPrompt(SAMPLE.draftContent, SAMPLE.startDate, SAMPLE.endDate, 'human');
    expect(human).toBe(machine);
  });
});

// ----------------------- 4. Load-bearing tokens preserved ------------------

describe('Human-mode bodies still carry load-bearing tokens', () => {
  it('buildStructuredReviewPrompt human variant contains the rubric ids', () => {
    const human = buildStructuredReviewPrompt(SAMPLE.draftContent, RIGOR_RUBRIC, SAMPLE.numberOfOutcomes, 'human');
    for (const item of RIGOR_RUBRIC) {
      expect(human).toContain(item.id);
    }
  });

  it('buildStructuredReviewPrompt human variant retains all schema keys (load-bearing for aggregation)', () => {
    const human = buildStructuredReviewPrompt(SAMPLE.draftContent, RIGOR_RUBRIC, SAMPLE.numberOfOutcomes, 'human');
    // These keys are consumed by StructuredReviewResponseSchema in
    // src/types/run.js; if any goes missing, the structured reviewer
    // pipeline fails the strict-retry round.
    for (const key of [
      'reviewProse',
      'rubricVotes',
      'criticisms',
      'ruleId',
      'verdict',
      'rationale',
      'claimId',
      'severity',
      'category',
    ]) {
      expect(human).toContain(key);
    }
  });

  it('buildStructuredReviewPrompt machine and human variants both demand JSON-only output', () => {
    const machine = buildStructuredReviewPrompt(SAMPLE.draftContent, RIGOR_RUBRIC, SAMPLE.numberOfOutcomes, 'machine');
    const human = buildStructuredReviewPrompt(SAMPLE.draftContent, RIGOR_RUBRIC, SAMPLE.numberOfOutcomes, 'human');
    expect(machine).toMatch(/Output only the JSON object/);
    expect(human).toMatch(/Output only the JSON object/);
  });

  it('buildStrictStructuredReviewRetryPrompt threads rigor through to the base builder', () => {
    const machine = buildStrictStructuredReviewRetryPrompt(SAMPLE.draftContent, RIGOR_RUBRIC, SAMPLE.numberOfOutcomes, 'machine');
    const human = buildStrictStructuredReviewRetryPrompt(SAMPLE.draftContent, RIGOR_RUBRIC, SAMPLE.numberOfOutcomes, 'human');
    expect(machine).toContain(buildStructuredReviewPrompt(SAMPLE.draftContent, RIGOR_RUBRIC, SAMPLE.numberOfOutcomes, 'machine'));
    expect(human).toContain(buildStructuredReviewPrompt(SAMPLE.draftContent, RIGOR_RUBRIC, SAMPLE.numberOfOutcomes, 'human'));
    expect(human).not.toBe(machine);
  });

  it('buildUpdatePrompt human variant keeps the protocol-pushback rule (load-bearing for market correctness)', () => {
    const human = buildUpdatePrompt(
      SAMPLE.draftContent, SAMPLE.reviewContent, SAMPLE.humanReviewInput,
      SAMPLE.focusBlock, SAMPLE.numberOfOutcomes, SAMPLE.references, 'human',
    );
    // The exact wording can differ between rigors but the directive
    // — push back when a reviewer suggestion would violate a protocol
    // rule — must survive in both. This is what stops Human mode from
    // silently accepting an unsafe edit.
    expect(human).toMatch(/protocol rule/i);
    expect(human).toMatch(/push back/i);
  });

  it('buildFinalizePrompt human variant retains the conciseness rules', () => {
    const human = buildFinalizePrompt(SAMPLE.draftContent, SAMPLE.startDate, SAMPLE.endDate, SAMPLE.numberOfOutcomes, 'human');
    expect(human).toContain('CONCISENESS RULES');
  });

  it('buildFinalizePrompt gives refinedQuestion a concrete title budget', () => {
    const machine = buildFinalizePrompt(SAMPLE.draftContent, SAMPLE.startDate, SAMPLE.endDate, SAMPLE.numberOfOutcomes, 'machine');
    const human = buildFinalizePrompt(SAMPLE.draftContent, SAMPLE.startDate, SAMPLE.endDate, SAMPLE.numberOfOutcomes, 'human');

    expect(machine).toContain('refinedQuestion: trader-facing market title, max 90 chars');
    expect(human).toContain('refinedQuestion: trader-facing market title, max 70 chars');
    expect(human).toMatch(/Keep resolver detail, sources, exact timestamps, edge cases, and protocol mechanics out of the title/);
  });

  it('buildMarketQuestionTitleRepairPrompt is title-only and preserves resolver fields', () => {
    const prompt = buildMarketQuestionTitleRepairPrompt({
      refinedQuestion: 'Will the official result resolve according to the source by 2026-06-15T23:59:59Z?',
      outcomes: [],
    }, 'human');

    expect(prompt).toContain('Rewrite only the "refinedQuestion" field');
    expect(prompt).toContain('Max 70 characters');
    expect(prompt).toContain('"refinedQuestion": "short market question"');
    expect(prompt).toContain('Keep all resolver detail in the other fields unchanged');
  });
});

// -------------- 5. Migration completeness: no flat SYSTEM_PROMPTS access ---

function listJsFiles(dir, skip = new Set(['node_modules', 'dist', 'eval/out'])) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...listJsFiles(full, skip));
    else if (name.endsWith('.js') || name.endsWith('.jsx')) out.push(full);
  }
  return out;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('Phase 2 migration completeness', () => {
  it('no source file reads SYSTEM_PROMPTS.<role> — every call must go through .machine, .human, or getSystemPrompt', () => {
    const offenders = [];
    const roots = [SRC_DIR, join(REPO_ROOT, 'eval'), join(REPO_ROOT, 'bin')];
    for (const root of roots) {
      for (const file of listJsFiles(root)) {
        // The definition file itself uses the bracketed forms; skip it.
        if (file.endsWith(join('src', 'constants', 'prompts.js'))) continue;
        // The test file mentions the patterns in strings; skip it too.
        if (file.endsWith('prompts.test.js')) continue;

        const src = stripComments(readFileSync(file, 'utf8'));
        // Match a flat property read like `SYSTEM_PROMPTS.drafter` but
        // exclude `.machine`, `.human`, and bracket access.
        const matches = src.match(/SYSTEM_PROMPTS\.[A-Za-z]+/g) || [];
        for (const m of matches) {
          if (m === 'SYSTEM_PROMPTS.machine' || m === 'SYSTEM_PROMPTS.human') continue;
          offenders.push(`${file}: ${m}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
