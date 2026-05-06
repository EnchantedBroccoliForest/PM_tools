import { afterEach, describe, expect, it, vi } from 'vitest';
import { installQueryModel, resetQueryModel } from './api/openrouter.js';
import { orchestrate } from './orchestrate.js';
import { getSystemPrompt } from './constants/prompts.js';
import { RIGOR_RUBRIC } from './constants/rubric.js';

const SOURCE_URL = 'https://dead.example/feed';
const BACKUP_SOURCE_URL = 'https://live.example/feed';

function usage(content) {
  return {
    content,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    wallClockMs: 1,
  };
}

function passingReview() {
  return {
    reviewProse: 'No blocking issues found.',
    rubricVotes: RIGOR_RUBRIC.map((rule) => ({
      ruleId: rule.id,
      verdict: 'yes',
      rationale: 'Passes.',
    })),
    criticisms: [],
  };
}

function finalJson() {
  return {
    refinedQuestion: 'Will Team A win?',
    outcomes: [
      { name: 'Yes', winCondition: 'Team A wins.', resolutionCriteria: `Use ${SOURCE_URL}.` },
      { name: 'No', winCondition: 'Team A does not win.', resolutionCriteria: `Use ${SOURCE_URL}.` },
    ],
    marketStartTimeUTC: '2026-01-01T00:00:00Z',
    marketEndTimeUTC: '2026-01-31T23:59:59Z',
    shortDescription: 'Tracks whether Team A wins.',
    fullResolutionRules: `Resolve from ${SOURCE_URL}.`,
    edgeCases: 'If the source is unavailable, No wins.',
  };
}

function makeQuery({ claimsContent, entailmentContent, onEarlyResolution, finalJsonOverride }) {
  const calls = {
    drafter: 0,
    claimExtractor: 0,
    structuredReviewer: 0,
    entailmentVerifier: 0,
    earlyResolutionAnalyst: 0,
    finalizer: 0,
  };

  const query = async (_model, messages) => {
    const system = messages?.[0]?.content;
    if (system === getSystemPrompt('drafter', 'machine')) {
      calls.drafter += 1;
      const draft = `## Question\nWill Team A win?\n\n## Resolution Rules\nResolve from ${SOURCE_URL}.`;
      return usage(calls.drafter === 1 ? draft : `${draft}\n\nUpdated.`);
    }
    if (system === getSystemPrompt('claimExtractor')) {
      calls.claimExtractor += 1;
      return usage(claimsContent);
    }
    if (system === getSystemPrompt('structuredReviewer', 'machine')) {
      calls.structuredReviewer += 1;
      return usage(JSON.stringify(passingReview()));
    }
    if (system === getSystemPrompt('entailmentVerifier')) {
      calls.entailmentVerifier += 1;
      return usage(entailmentContent || JSON.stringify([
        { id: 'claim.source.0', entailment: 'entailed', rationale: 'The URL appears in the draft.' },
      ]));
    }
    if (system === getSystemPrompt('earlyResolutionAnalyst', 'machine')) {
      calls.earlyResolutionAnalyst += 1;
      onEarlyResolution?.();
      return usage('Risk rating: Low\nNo early-resolution issue.');
    }
    if (system === getSystemPrompt('finalizer', 'machine')) {
      calls.finalizer += 1;
      return usage(JSON.stringify(finalJsonOverride || finalJson()));
    }
    return usage('{}');
  };
  query.calls = calls;
  return query;
}

afterEach(() => {
  resetQueryModel();
});

describe('orchestrate gates', () => {
  it('blocks headless finalize when the pre-finalize source check fails', async () => {
    const query = makeQuery({
      claimsContent: JSON.stringify([
        { id: 'claim.source.0', category: 'source', text: `Resolution source: ${SOURCE_URL}`, sourceRefs: [] },
      ]),
    });
    installQueryModel(query);

    const run = await orchestrate({
      input: {
        question: 'Will Team A win?',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-31T23:59:59Z',
        references: SOURCE_URL,
        rigor: 'machine',
      },
      models: {
        drafter: 'mock/drafter',
        reviewers: [{ id: 'mock/reviewer', name: 'Reviewer' }],
      },
      options: {
        aggregation: 'majority',
        escalation: 'always',
        evidence: 'retrieval',
        verifiers: 'full',
      },
      fetchImpl: async () => {
        throw new TypeError('unreachable');
      },
    });

    expect(run.status).toBe('blocked');
    expect(run.sourceAccessibility.status).toBe('all_unreachable');
    expect(run.gates.sources).toEqual({ status: 'all_unreachable', blocked: true });
    expect(query.calls.finalizer).toBe(0);
  });

  it('keeps the fallback gates source threshold aligned for pre-source-stage exits', async () => {
    const query = makeQuery({
      claimsContent: JSON.stringify([
        { id: 'claim.source.0', category: 'source', text: `Primary source: ${SOURCE_URL}`, sourceRefs: [] },
        { id: 'claim.source.1', category: 'source', text: `Backup source: ${BACKUP_SOURCE_URL}`, sourceRefs: [] },
      ]),
      entailmentContent: JSON.stringify([
        { id: 'claim.source.0', entailment: 'entailed', rationale: 'The URL appears in the draft.' },
        { id: 'claim.source.1', entailment: 'entailed', rationale: 'The URL appears in the draft.' },
      ]),
    });
    installQueryModel(query);

    const run = await orchestrate({
      input: {
        question: 'Will Team A win?',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-31T23:59:59Z',
        references: `${SOURCE_URL}\n${BACKUP_SOURCE_URL}`,
        rigor: 'machine',
      },
      models: {
        drafter: 'mock/drafter',
        reviewers: [{ id: 'mock/reviewer', name: 'Reviewer' }],
      },
      options: {
        aggregation: 'majority',
        escalation: 'always',
        evidence: 'retrieval',
        verifiers: 'full',
        skipReview: true,
      },
      fetchImpl: async (url) => {
        if (url === SOURCE_URL) throw new TypeError('unreachable');
        return { ok: true, status: 200, type: 'opaque' };
      },
    });

    expect(run.status).toBe('partial');
    expect(run.sourceAccessibility).toBeNull();
    expect(run.gates.sources).toEqual({ status: 'some_unreachable', blocked: true });
  });

  it('records source-check infrastructure errors without blocking finalize', async () => {
    const promiseAllSpy = vi.spyOn(Promise, 'all');

    try {
      const query = makeQuery({
        claimsContent: JSON.stringify([
          { id: 'claim.source.0', category: 'source', text: `Resolution source: ${SOURCE_URL}`, sourceRefs: [] },
        ]),
        onEarlyResolution: () => {
          promiseAllSpy.mockImplementationOnce(() => (
            Promise.reject(new Error('source probe infrastructure failed'))
          ));
        },
      });
      installQueryModel(query);

      const run = await orchestrate({
        input: {
          question: 'Will Team A win?',
          startDate: '2026-01-01T00:00:00Z',
          endDate: '2026-01-31T23:59:59Z',
          references: SOURCE_URL,
          rigor: 'machine',
        },
        models: {
          drafter: 'mock/drafter',
          reviewers: [{ id: 'mock/reviewer', name: 'Reviewer' }],
        },
        options: {
          aggregation: 'majority',
          escalation: 'always',
          evidence: 'retrieval',
          verifiers: 'full',
        },
        fetchImpl: async () => ({ ok: true, status: 200, type: 'opaque' }),
      });

      expect(run.status).toBe('complete');
      expect(run.sourceAccessibility).toMatchObject({
        status: 'error',
        error: 'source probe infrastructure failed',
      });
      expect(run.gates.sources).toEqual({ status: 'error', blocked: false });
      expect(query.calls.finalizer).toBe(1);
    } finally {
      promiseAllSpy.mockRestore();
    }
  });

  it('treats failed claim extraction as a blocking routing gate', async () => {
    const query = makeQuery({ claimsContent: 'not json' });
    installQueryModel(query);

    const run = await orchestrate({
      input: {
        question: 'Will Team A win?',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-31T23:59:59Z',
        references: '',
        rigor: 'machine',
      },
      models: {
        drafter: 'mock/drafter',
        reviewers: [{ id: 'mock/reviewer', name: 'Reviewer' }],
      },
      options: {
        aggregation: 'majority',
        escalation: 'always',
        evidence: 'retrieval',
        verifiers: 'full',
      },
      fetchImpl: async () => ({ ok: true, status: 200, type: 'opaque' }),
    });

    expect(run.status).toBe('blocked');
    expect(run.routing).toMatchObject({ overall: 'blocked', hasBlocking: true });
    expect(run.gates.routing).toEqual({ overall: 'blocked', blocked: true });
    expect(query.calls.finalizer).toBe(0);
  });

  it('fails finalize when outcome names use the reserved OT token prefix', async () => {
    const query = makeQuery({
      claimsContent: JSON.stringify([
        { id: 'claim.source.0', category: 'source', text: `Resolution source: ${SOURCE_URL}`, sourceRefs: [] },
      ]),
      finalJsonOverride: {
        ...finalJson(),
        outcomes: [
          { name: 'OT Yes', winCondition: 'Team A wins.', resolutionCriteria: `Use ${SOURCE_URL}.` },
          { name: 'No', winCondition: 'Team A does not win.', resolutionCriteria: `Use ${SOURCE_URL}.` },
        ],
      },
    });
    installQueryModel(query);

    const run = await orchestrate({
      input: {
        question: 'Will Team A win?',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-31T23:59:59Z',
        references: SOURCE_URL,
        rigor: 'machine',
      },
      models: {
        drafter: 'mock/drafter',
        reviewers: [{ id: 'mock/reviewer', name: 'Reviewer' }],
      },
      options: {
        aggregation: 'majority',
        escalation: 'always',
        evidence: 'retrieval',
        verifiers: 'full',
      },
      fetchImpl: async () => ({ ok: true, status: 200, type: 'opaque' }),
    });

    expect(run.status).toBe('error');
    expect(run.finalJson).toBeNull();
    expect(run.log.some((entry) => (
      entry.stage === 'accept'
      && /reserved "OT" token prefix/.test(entry.message)
    ))).toBe(true);
    expect(query.calls.finalizer).toBe(1);
  });
});
