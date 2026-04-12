/**
 * Unit tests for src/pipeline/deliberate.js.
 *
 * Tests the deliberation round logic:
 *   - Unanimous agreement detection
 *   - Peer summary formatting
 *   - Mind-change tracking
 *   - Full deliberation round with mocked LLM
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installQueryModel, resetQueryModel } from '../api/openrouter.js';
import {
  hasUnanimousAgreement,
  formatPeerSummary,
  trackMindChanges,
  runDeliberationRound,
} from './deliberate.js';

const RUBRIC = [
  { id: 'mece', question: 'MECE?', rationale: 'Test' },
  { id: 'objective_source', question: 'Source?', rationale: 'Test' },
];

function makeReview(model, modelName, votes, prose = 'Test review') {
  return {
    model,
    modelName,
    reviewProse: prose,
    rubricVotes: votes.map((v) => ({
      ruleId: v.ruleId,
      reviewerModel: model,
      verdict: v.verdict,
      rationale: v.rationale || 'test',
    })),
    criticisms: [],
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    wallClockMs: 10,
    logEntry: null,
  };
}

beforeEach(() => resetQueryModel());
afterEach(() => resetQueryModel());

describe('hasUnanimousAgreement', () => {
  it('returns true when all reviewers agree on all items', () => {
    const reviews = [
      makeReview('a', 'A', [
        { ruleId: 'mece', verdict: 'yes' },
        { ruleId: 'objective_source', verdict: 'no' },
      ]),
      makeReview('b', 'B', [
        { ruleId: 'mece', verdict: 'yes' },
        { ruleId: 'objective_source', verdict: 'no' },
      ]),
    ];
    expect(hasUnanimousAgreement(reviews)).toBe(true);
  });

  it('returns false when reviewers disagree on any item', () => {
    const reviews = [
      makeReview('a', 'A', [
        { ruleId: 'mece', verdict: 'yes' },
        { ruleId: 'objective_source', verdict: 'yes' },
      ]),
      makeReview('b', 'B', [
        { ruleId: 'mece', verdict: 'no' },
        { ruleId: 'objective_source', verdict: 'yes' },
      ]),
    ];
    expect(hasUnanimousAgreement(reviews)).toBe(false);
  });

  it('returns true for a single reviewer', () => {
    const reviews = [
      makeReview('a', 'A', [{ ruleId: 'mece', verdict: 'yes' }]),
    ];
    expect(hasUnanimousAgreement(reviews)).toBe(true);
  });

  it('returns true when no successful reviews', () => {
    const reviews = [
      { model: 'a', modelName: 'A', reviewProse: null, rubricVotes: [], criticisms: [] },
    ];
    expect(hasUnanimousAgreement(reviews)).toBe(true);
  });

  it('ignores failed reviews (null prose)', () => {
    const reviews = [
      makeReview('a', 'A', [{ ruleId: 'mece', verdict: 'yes' }]),
      { model: 'b', modelName: 'B', reviewProse: null, rubricVotes: [], criticisms: [] },
    ];
    expect(hasUnanimousAgreement(reviews)).toBe(true);
  });
});

describe('formatPeerSummary', () => {
  it('excludes the target reviewer from the summary', () => {
    const reviews = [
      makeReview('model-a', 'Model A', [{ ruleId: 'mece', verdict: 'yes' }]),
      makeReview('model-b', 'Model B', [{ ruleId: 'mece', verdict: 'no' }]),
    ];
    const summary = formatPeerSummary(reviews, 'model-a', RUBRIC);
    expect(summary).toContain('Model B');
    expect(summary).not.toContain('Model A');
  });

  it('returns placeholder for empty peer set', () => {
    const reviews = [
      makeReview('model-a', 'Model A', [{ ruleId: 'mece', verdict: 'yes' }]),
    ];
    const summary = formatPeerSummary(reviews, 'model-a', RUBRIC);
    expect(summary).toMatch(/no peer reviews/i);
  });

  it('includes rubric votes and criticisms', () => {
    const review = makeReview('model-b', 'Model B', [
      { ruleId: 'mece', verdict: 'no', rationale: 'Outcomes overlap' },
    ]);
    review.criticisms = [
      { claimId: 'c1', severity: 'blocker', category: 'mece', rationale: 'MECE violation' },
    ];
    const reviews = [
      makeReview('model-a', 'Model A', [{ ruleId: 'mece', verdict: 'yes' }]),
      review,
    ];
    const summary = formatPeerSummary(reviews, 'model-a', RUBRIC);
    expect(summary).toContain('Outcomes overlap');
    expect(summary).toContain('blocker');
    expect(summary).toContain('MECE violation');
  });
});

describe('trackMindChanges', () => {
  it('detects changed votes', () => {
    const initial = [
      { ruleId: 'mece', reviewerModel: 'a', verdict: 'yes' },
      { ruleId: 'objective_source', reviewerModel: 'a', verdict: 'yes' },
    ];
    const revised = [
      { ruleId: 'mece', reviewerModel: 'a', verdict: 'no' },
      { ruleId: 'objective_source', reviewerModel: 'a', verdict: 'yes' },
    ];
    const changes = trackMindChanges(initial, revised);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ ruleId: 'mece', from: 'yes', to: 'no' });
  });

  it('returns empty array when no votes changed', () => {
    const votes = [
      { ruleId: 'mece', reviewerModel: 'a', verdict: 'yes' },
    ];
    const changes = trackMindChanges(votes, votes);
    expect(changes).toEqual([]);
  });

  it('handles empty inputs', () => {
    expect(trackMindChanges([], [])).toEqual([]);
  });
});

describe('runDeliberationRound', () => {
  function makeMock(response) {
    return async () => ({
      content: typeof response === 'string' ? response : JSON.stringify(response),
      usage: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
      wallClockMs: 20,
    });
  }

  it('returns revised review with mind changes tracked', async () => {
    const initialReviews = [
      makeReview('model-a', 'Model A', [
        { ruleId: 'mece', verdict: 'yes' },
        { ruleId: 'objective_source', verdict: 'yes' },
      ]),
      makeReview('model-b', 'Model B', [
        { ruleId: 'mece', verdict: 'no' },
        { ruleId: 'objective_source', verdict: 'yes' },
      ]),
    ];

    // Model A revises mece from yes to no after seeing Model B's reasoning
    const revisedResponse = {
      reviewProse: 'After seeing peer review, I agree mece fails.',
      rubricVotes: [
        { ruleId: 'mece', verdict: 'no', rationale: 'Peer convinced me' },
        { ruleId: 'objective_source', verdict: 'yes', rationale: 'Unchanged' },
      ],
      criticisms: [],
    };

    installQueryModel(makeMock(revisedResponse));
    const result = await runDeliberationRound(
      { id: 'model-a', name: 'Model A' },
      'Draft content',
      RUBRIC,
      initialReviews,
    );

    expect(result.review.reviewProse).toContain('peer review');
    expect(result.mindChanges).toHaveLength(1);
    expect(result.mindChanges[0]).toEqual({ ruleId: 'mece', from: 'yes', to: 'no' });
    expect(result.logEntry.message).toContain('changed 1 vote');
  });

  it('falls back to original review on invalid JSON', async () => {
    const initialReviews = [
      makeReview('model-a', 'Model A', [{ ruleId: 'mece', verdict: 'yes' }]),
      makeReview('model-b', 'Model B', [{ ruleId: 'mece', verdict: 'no' }]),
    ];

    installQueryModel(makeMock('not valid json'));
    const result = await runDeliberationRound(
      { id: 'model-a', name: 'Model A' },
      'Draft',
      RUBRIC,
      initialReviews,
    );

    expect(result.review.model).toBe('model-a');
    expect(result.review.reviewProse).toBe('Test review'); // original
    expect(result.mindChanges).toEqual([]);
    expect(result.logEntry.level).toBe('warn');
  });

  it('falls back to original review on network error', async () => {
    const initialReviews = [
      makeReview('model-a', 'Model A', [{ ruleId: 'mece', verdict: 'yes' }]),
      makeReview('model-b', 'Model B', [{ ruleId: 'mece', verdict: 'no' }]),
    ];

    installQueryModel(async () => { throw new Error('Timeout'); });
    const result = await runDeliberationRound(
      { id: 'model-a', name: 'Model A' },
      'Draft',
      RUBRIC,
      initialReviews,
    );

    expect(result.review.model).toBe('model-a');
    expect(result.mindChanges).toEqual([]);
    expect(result.logEntry.level).toBe('warn');
  });
});
