/**
 * Unit tests for src/pipeline/aggregate.js.
 *
 * Tests the three aggregation protocols (majority, unanimity, judge) and
 * the dispatcher, covering vote tallying, tie-breaking, and graceful
 * degradation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installQueryModel, resetQueryModel } from '../api/openrouter.js';
import {
  aggregateMajority,
  aggregateUnanimity,
  aggregateJudge,
  aggregate,
} from './aggregate.js';

const RUBRIC = [
  { id: 'mece', question: 'Is the outcome set MECE?', rationale: 'Test' },
  { id: 'objective_source', question: 'Objective source?', rationale: 'Test' },
  { id: 'timing', question: 'Timing clear?', rationale: 'Test' },
];

function vote(ruleId, reviewer, verdict) {
  return { ruleId, reviewerModel: reviewer, verdict, rationale: `${verdict} because test` };
}

beforeEach(() => resetQueryModel());
afterEach(() => resetQueryModel());

// --- Majority protocol ---

describe('aggregateMajority', () => {
  it('passes when majority votes yes', () => {
    const votes = [
      vote('mece', 'a', 'yes'), vote('mece', 'b', 'yes'), vote('mece', 'c', 'no'),
      vote('objective_source', 'a', 'yes'), vote('objective_source', 'b', 'yes'), vote('objective_source', 'c', 'yes'),
      vote('timing', 'a', 'yes'), vote('timing', 'b', 'yes'), vote('timing', 'c', 'unsure'),
    ];
    const result = aggregateMajority(RUBRIC, votes);
    expect(result.protocol).toBe('majority');
    expect(result.overall).toBe('pass');
    expect(result.checklist.every((item) => item.decision === 'pass')).toBe(true);
  });

  it('fails when majority votes no', () => {
    const votes = [
      vote('mece', 'a', 'no'), vote('mece', 'b', 'no'), vote('mece', 'c', 'yes'),
      vote('objective_source', 'a', 'yes'), vote('objective_source', 'b', 'yes'), vote('objective_source', 'c', 'yes'),
      vote('timing', 'a', 'yes'), vote('timing', 'b', 'yes'), vote('timing', 'c', 'yes'),
    ];
    const result = aggregateMajority(RUBRIC, votes);
    expect(result.overall).toBe('fail');
    expect(result.checklist[0].decision).toBe('fail');
  });

  it('escalates on yes/no tie', () => {
    const votes = [
      vote('mece', 'a', 'yes'), vote('mece', 'b', 'no'),
      vote('objective_source', 'a', 'yes'), vote('objective_source', 'b', 'yes'),
      vote('timing', 'a', 'yes'), vote('timing', 'b', 'yes'),
    ];
    const result = aggregateMajority(RUBRIC, votes);
    expect(result.checklist[0].decision).toBe('escalate');
    expect(result.overall).toBe('needs_escalation');
  });

  it('escalates when unsure is involved in tie', () => {
    const votes = [
      vote('mece', 'a', 'yes'), vote('mece', 'b', 'unsure'),
      vote('objective_source', 'a', 'yes'), vote('objective_source', 'b', 'yes'),
      vote('timing', 'a', 'yes'), vote('timing', 'b', 'yes'),
    ];
    const result = aggregateMajority(RUBRIC, votes);
    expect(result.checklist[0].decision).toBe('escalate');
  });

  it('escalates on empty votes', () => {
    const result = aggregateMajority(RUBRIC, []);
    expect(result.overall).toBe('needs_escalation');
    expect(result.checklist.every((item) => item.decision === 'escalate')).toBe(true);
  });

  it('overall is worst of all items (fail > escalate > pass)', () => {
    const votes = [
      vote('mece', 'a', 'no'), vote('mece', 'b', 'no'), vote('mece', 'c', 'no'), // fail
      vote('objective_source', 'a', 'yes'), vote('objective_source', 'b', 'unsure'), // escalate
      vote('timing', 'a', 'yes'), vote('timing', 'b', 'yes'), vote('timing', 'c', 'yes'), // pass
    ];
    const result = aggregateMajority(RUBRIC, votes);
    expect(result.overall).toBe('fail');
  });
});

// --- Unanimity protocol ---

describe('aggregateUnanimity', () => {
  it('passes when all vote yes', () => {
    const votes = [
      vote('mece', 'a', 'yes'), vote('mece', 'b', 'yes'),
      vote('objective_source', 'a', 'yes'), vote('objective_source', 'b', 'yes'),
      vote('timing', 'a', 'yes'), vote('timing', 'b', 'yes'),
    ];
    const result = aggregateUnanimity(RUBRIC, votes);
    expect(result.overall).toBe('pass');
  });

  it('fails when any vote is no', () => {
    const votes = [
      vote('mece', 'a', 'yes'), vote('mece', 'b', 'no'),
      vote('objective_source', 'a', 'yes'), vote('objective_source', 'b', 'yes'),
      vote('timing', 'a', 'yes'), vote('timing', 'b', 'yes'),
    ];
    const result = aggregateUnanimity(RUBRIC, votes);
    expect(result.overall).toBe('fail');
    expect(result.checklist[0].decision).toBe('fail');
  });

  it('escalates when any vote is unsure (without no)', () => {
    const votes = [
      vote('mece', 'a', 'yes'), vote('mece', 'b', 'unsure'),
      vote('objective_source', 'a', 'yes'), vote('objective_source', 'b', 'yes'),
      vote('timing', 'a', 'yes'), vote('timing', 'b', 'yes'),
    ];
    const result = aggregateUnanimity(RUBRIC, votes);
    expect(result.overall).toBe('needs_escalation');
    expect(result.checklist[0].decision).toBe('escalate');
  });

  it('no trumps unsure (fail, not escalate)', () => {
    const votes = [
      vote('mece', 'a', 'no'), vote('mece', 'b', 'unsure'),
      vote('objective_source', 'a', 'yes'), vote('objective_source', 'b', 'yes'),
      vote('timing', 'a', 'yes'), vote('timing', 'b', 'yes'),
    ];
    const result = aggregateUnanimity(RUBRIC, votes);
    expect(result.checklist[0].decision).toBe('fail');
  });
});

// --- Judge protocol ---

describe('aggregateJudge', () => {
  function makeMock(responses) {
    let callCount = 0;
    return async () => {
      const response = responses[callCount] || responses[responses.length - 1];
      callCount++;
      if (response.error) throw new Error(response.error);
      return {
        content: response.content,
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        wallClockMs: 10,
      };
    };
  }

  const ALL_YES_VOTES = [
    vote('mece', 'a', 'yes'), vote('mece', 'b', 'yes'),
    vote('objective_source', 'a', 'yes'), vote('objective_source', 'b', 'yes'),
    vote('timing', 'a', 'yes'), vote('timing', 'b', 'yes'),
  ];

  it('applies judge overrides to majority baseline', async () => {
    const judgeResponse = {
      perItemDecisions: [
        { id: 'mece', decision: 'fail' },
        { id: 'objective_source', decision: 'pass' },
        { id: 'timing', decision: 'pass' },
      ],
      overall: 'fail',
      rationale: 'mece fails because outcomes overlap.',
    };
    installQueryModel(
      makeMock([{ content: JSON.stringify(judgeResponse) }]),
    );
    const result = await aggregateJudge(RUBRIC, ALL_YES_VOTES, 'judge/model');
    expect(result.aggregation.protocol).toBe('judge');
    expect(result.aggregation.overall).toBe('fail');
    expect(result.aggregation.checklist[0].decision).toBe('fail');
    expect(result.aggregation.judgeRationale).toMatch(/mece/i);
  });

  it('falls back to majority on network failure', async () => {
    installQueryModel(makeMock([{ error: 'Network error' }]));
    const result = await aggregateJudge(RUBRIC, ALL_YES_VOTES, 'judge/model');
    expect(result.aggregation.protocol).toBe('judge');
    expect(result.aggregation.overall).toBe('pass'); // majority baseline
    expect(result.logEntry.level).toBe('error');
  });

  it('falls back to majority on invalid JSON', async () => {
    installQueryModel(
      makeMock([{ content: 'not json' }, { content: 'still not json' }]),
    );
    const result = await aggregateJudge(RUBRIC, ALL_YES_VOTES, 'judge/model');
    expect(result.aggregation.overall).toBe('pass'); // majority baseline
    expect(result.logEntry.level).toBe('error');
  });
});

// --- Dispatcher ---

describe('aggregate (dispatcher)', () => {
  it('dispatches to majority by default', async () => {
    const votes = [
      vote('mece', 'a', 'yes'), vote('mece', 'b', 'yes'),
      vote('objective_source', 'a', 'yes'), vote('objective_source', 'b', 'yes'),
      vote('timing', 'a', 'yes'), vote('timing', 'b', 'yes'),
    ];
    const result = await aggregate('majority', RUBRIC, votes);
    expect(result.aggregation.protocol).toBe('majority');
    expect(result.aggregation.overall).toBe('pass');
  });

  it('dispatches to unanimity', async () => {
    const votes = [
      vote('mece', 'a', 'yes'), vote('mece', 'b', 'no'),
      vote('objective_source', 'a', 'yes'), vote('objective_source', 'b', 'yes'),
      vote('timing', 'a', 'yes'), vote('timing', 'b', 'yes'),
    ];
    const result = await aggregate('unanimity', RUBRIC, votes);
    expect(result.aggregation.protocol).toBe('unanimity');
    expect(result.aggregation.overall).toBe('fail');
  });

  it('warns and falls back to majority when judge has no model', async () => {
    const votes = [
      vote('mece', 'a', 'yes'),
      vote('objective_source', 'a', 'yes'),
      vote('timing', 'a', 'yes'),
    ];
    const result = await aggregate('judge', RUBRIC, votes, undefined);
    expect(result.aggregation.protocol).toBe('judge');
    expect(result.logEntry.level).toBe('warn');
  });
});
