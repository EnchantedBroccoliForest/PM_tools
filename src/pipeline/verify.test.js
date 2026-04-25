/**
 * Unit tests for src/pipeline/verify.js.
 *
 * Tests both the structural verifier (pure, no LLM) and the full
 * verification pipeline (structural + entailment via mocked LLM).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installQueryModel, resetQueryModel } from '../api/openrouter.js';
import { structuralCheck, verifyClaims } from './verify.js';

beforeEach(() => resetQueryModel());
afterEach(() => resetQueryModel());

// ---- Structural verifier (pure, no LLM) ----

describe('structuralCheck', () => {
  it('passes a timestamp claim with an ISO date', () => {
    const claim = { id: 'claim.timestamp.start', category: 'timestamp', text: 'Start: 2026-06-01T00:00:00Z', sourceRefs: [] };
    const result = structuralCheck(claim);
    expect(result.verdict).toBe('pass');
    expect(result.claimId).toBe('claim.timestamp.start');
  });

  it('passes a timestamp claim with HH:MM time', () => {
    const claim = { id: 'claim.timestamp.end', category: 'timestamp', text: 'Cutoff at 23:59 UTC', sourceRefs: [] };
    const result = structuralCheck(claim);
    expect(result.verdict).toBe('pass');
  });

  it('hard_fails a timestamp claim with no date or time', () => {
    const claim = { id: 'claim.timestamp.0', category: 'timestamp', text: 'Sometime in the future', sourceRefs: [] };
    const result = structuralCheck(claim);
    expect(result.verdict).toBe('hard_fail');
    expect(result.toolOutput).toMatch(/no ISO date/i);
  });

  it('passes a source claim with a URL', () => {
    const claim = { id: 'claim.source.0', category: 'source', text: 'https://api.example.com/data', sourceRefs: [] };
    const result = structuralCheck(claim);
    expect(result.verdict).toBe('pass');
  });

  it('hard_fails a source claim with no URL', () => {
    const claim = { id: 'claim.source.0', category: 'source', text: 'The official website', sourceRefs: [] };
    const result = structuralCheck(claim);
    expect(result.verdict).toBe('hard_fail');
    expect(result.citationResolves).toBe(false);
  });

  it('passes a threshold claim with a number', () => {
    const claim = { id: 'claim.threshold.0', category: 'threshold', text: 'Must exceed 100,000 USD', sourceRefs: [] };
    const result = structuralCheck(claim);
    expect(result.verdict).toBe('pass');
  });

  it('soft_fails a threshold claim with no number', () => {
    const claim = { id: 'claim.threshold.0', category: 'threshold', text: 'Must exceed a majority', sourceRefs: [] };
    const result = structuralCheck(claim);
    expect(result.verdict).toBe('soft_fail');
  });

  it('hard_fails an empty question claim', () => {
    const claim = { id: 'claim.question.0', category: 'question', text: '', sourceRefs: [] };
    const result = structuralCheck(claim);
    expect(result.verdict).toBe('hard_fail');
  });

  it('passes a question claim with content', () => {
    const claim = { id: 'claim.question.0', category: 'question', text: 'Will BTC exceed 100k?', sourceRefs: [] };
    const result = structuralCheck(claim);
    expect(result.verdict).toBe('pass');
  });

  it('passes claims with unknown categories', () => {
    const claim = { id: 'claim.other.0', category: 'other', text: 'Something else', sourceRefs: [] };
    const result = structuralCheck(claim);
    expect(result.verdict).toBe('pass');
  });
});

// ---- Full verification pipeline (structural + entailment) ----

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

const TEST_CLAIMS = [
  { id: 'claim.question.0', category: 'question', text: 'Will BTC exceed 100k?', sourceRefs: [] },
  { id: 'claim.timestamp.start', category: 'timestamp', text: 'Start: 2026-06-01', sourceRefs: [] },
  { id: 'claim.source.0', category: 'source', text: 'https://api.coingecko.com/v3/price', sourceRefs: [] },
];

const VALID_ENTAILMENT = [
  { id: 'claim.question.0', entailment: 'entailed', rationale: 'Present in draft' },
  { id: 'claim.timestamp.start', entailment: 'entailed', rationale: 'Date matches' },
  { id: 'claim.source.0', entailment: 'entailed', rationale: 'URL cited' },
];

describe('verifyClaims', () => {
  it('returns empty verifications for empty claims', async () => {
    const result = await verifyClaims([], 'Draft', 'model');
    expect(result.verifications).toEqual([]);
    expect(result.logEntry.level).toBe('info');
  });

  it('merges structural and entailment results', async () => {
    installQueryModel(
      makeMock([{ content: JSON.stringify(VALID_ENTAILMENT) }]),
    );
    const result = await verifyClaims(TEST_CLAIMS, 'Draft with BTC and dates', 'model');
    expect(result.verifications).toHaveLength(3);
    // All entailed + structurally valid → pass
    for (const v of result.verifications) {
      expect(v.verdict).toBe('pass');
      expect(v.entailment).toBe('entailed');
    }
  });

  it('marks contradicted claims as hard_fail', async () => {
    const entailment = [
      { id: 'claim.question.0', entailment: 'contradicted', rationale: 'Draft says ETH, not BTC' },
      { id: 'claim.timestamp.start', entailment: 'entailed', rationale: 'OK' },
      { id: 'claim.source.0', entailment: 'entailed', rationale: 'OK' },
    ];
    installQueryModel(makeMock([{ content: JSON.stringify(entailment) }]));
    const result = await verifyClaims(TEST_CLAIMS, 'Draft', 'model');
    expect(result.verifications[0].verdict).toBe('hard_fail');
    expect(result.verifications[0].entailment).toBe('contradicted');
  });

  it('marks not_covered claims as soft_fail when structurally valid', async () => {
    const entailment = [
      { id: 'claim.question.0', entailment: 'not_covered', rationale: 'Not in draft' },
      { id: 'claim.timestamp.start', entailment: 'entailed', rationale: 'OK' },
      { id: 'claim.source.0', entailment: 'entailed', rationale: 'OK' },
    ];
    installQueryModel(makeMock([{ content: JSON.stringify(entailment) }]));
    const result = await verifyClaims(TEST_CLAIMS, 'Draft', 'model');
    expect(result.verifications[0].verdict).toBe('soft_fail');
    expect(result.verifications[0].entailment).toBe('not_covered');
  });

  it('structural hard_fail is not overridden by entailment', async () => {
    const claims = [
      { id: 'claim.source.0', category: 'source', text: 'no url here', sourceRefs: [] },
    ];
    const entailment = [
      { id: 'claim.source.0', entailment: 'entailed', rationale: 'Present' },
    ];
    installQueryModel(makeMock([{ content: JSON.stringify(entailment) }]));
    const result = await verifyClaims(claims, 'Draft', 'model');
    // Structural hard_fail should survive entailment
    expect(result.verifications[0].verdict).toBe('hard_fail');
  });

  it('falls back to structural-only on network failure', async () => {
    installQueryModel(makeMock([{ error: 'Network error' }]));
    const result = await verifyClaims(TEST_CLAIMS, 'Draft', 'model');
    expect(result.verifications).toHaveLength(3);
    expect(result.logEntry.level).toBe('error');
    // All should have entailment set to not_covered (fallback)
    for (const v of result.verifications) {
      expect(v.entailment).toBe('not_covered');
    }
  });

  it('warns when entailment verifier returns unknown claim ids', async () => {
    const entailment = [
      ...VALID_ENTAILMENT,
      { id: 'claim.invented.99', entailment: 'entailed', rationale: 'Hallucinated' },
    ];
    installQueryModel(makeMock([{ content: JSON.stringify(entailment) }]));
    const result = await verifyClaims(TEST_CLAIMS, 'Draft', 'model');
    expect(result.logEntry).not.toBeNull();
    expect(result.logEntry.level).toBe('warn');
    expect(result.logEntry.message).toMatch(/unknown claim id/i);
  });
});
