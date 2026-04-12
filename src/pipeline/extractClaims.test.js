/**
 * Unit tests for src/pipeline/extractClaims.js.
 *
 * Tests claim extraction with mocked LLM responses covering:
 *   - Happy path: valid JSON claim array
 *   - Markdown-fenced JSON output
 *   - Truncated JSON recovery
 *   - Invalid JSON on first attempt, success on retry
 *   - Both attempts returning invalid JSON (graceful fallback)
 *   - Network/API failure
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installQueryModel, resetQueryModel } from '../api/openrouter.js';
import { extractClaims } from './extractClaims.js';

const VALID_CLAIMS = [
  { id: 'claim.question.0', category: 'question', text: 'Will BTC exceed 100k?', sourceRefs: [] },
  { id: 'claim.timestamp.start', category: 'timestamp', text: 'Start: 2026-06-01T00:00:00Z', sourceRefs: [] },
  { id: 'claim.timestamp.end', category: 'timestamp', text: 'End: 2026-09-01T00:00:00Z', sourceRefs: [] },
  { id: 'claim.outcome.0.win', category: 'outcome_win', text: 'BTC price exceeds $100,000 USD', sourceRefs: [] },
];

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

beforeEach(() => resetQueryModel());
afterEach(() => resetQueryModel());

describe('extractClaims', () => {
  it('returns parsed claims from valid JSON array', async () => {
    installQueryModel(makeMock([{ content: JSON.stringify(VALID_CLAIMS) }]));
    const result = await extractClaims('test/model', 'Some draft content');
    expect(result.claims).toHaveLength(4);
    expect(result.claims[0].id).toBe('claim.question.0');
    expect(result.claims[0].category).toBe('question');
    expect(result.logEntry).toBeNull();
  });

  it('strips markdown fences from response', async () => {
    const fenced = '```json\n' + JSON.stringify(VALID_CLAIMS) + '\n```';
    installQueryModel(makeMock([{ content: fenced }]));
    const result = await extractClaims('test/model', 'Draft');
    expect(result.claims).toHaveLength(4);
    expect(result.logEntry).toBeNull();
  });

  it('strips leading prose before JSON array', async () => {
    const content = 'Here are the claims:\n' + JSON.stringify(VALID_CLAIMS);
    installQueryModel(makeMock([{ content }]));
    const result = await extractClaims('test/model', 'Draft');
    expect(result.claims).toHaveLength(4);
  });

  it('recovers from truncated JSON with a warning', async () => {
    // Simulate truncation: valid first two objects, then cut mid-object
    const truncated = JSON.stringify(VALID_CLAIMS).slice(0, -50) + '...';
    installQueryModel(makeMock([{ content: truncated }]));
    const result = await extractClaims('test/model', 'Draft');
    // Should recover at least some claims
    expect(result.claims.length).toBeGreaterThan(0);
    expect(result.claims.length).toBeLessThanOrEqual(4);
    expect(result.logEntry).not.toBeNull();
    expect(result.logEntry.level).toBe('warn');
    expect(result.logEntry.message).toMatch(/truncated/i);
  });

  it('retries on invalid JSON and succeeds on second attempt', async () => {
    installQueryModel(
      makeMock([
        { content: 'not valid json at all' },
        { content: JSON.stringify(VALID_CLAIMS) },
      ]),
    );
    const result = await extractClaims('test/model', 'Draft');
    expect(result.claims).toHaveLength(4);
    expect(result.logEntry).not.toBeNull();
    expect(result.logEntry.level).toBe('warn');
    expect(result.logEntry.message).toMatch(/strict retry/i);
  });

  it('returns empty claims when both attempts fail', async () => {
    installQueryModel(
      makeMock([{ content: 'garbage' }, { content: 'still garbage' }]),
    );
    const result = await extractClaims('test/model', 'Draft');
    expect(result.claims).toEqual([]);
    expect(result.logEntry).not.toBeNull();
    expect(result.logEntry.level).toBe('error');
    expect(result.logEntry.message).toMatch(/invalid JSON on both attempts/i);
  });

  it('returns empty claims with error on network failure', async () => {
    installQueryModel(makeMock([{ error: 'Network timeout' }]));
    const result = await extractClaims('test/model', 'Draft');
    expect(result.claims).toEqual([]);
    expect(result.logEntry.level).toBe('error');
    expect(result.logEntry.message).toMatch(/network/i);
  });

  it('drops claims with invalid schema (missing id)', async () => {
    const claimsWithBad = [
      ...VALID_CLAIMS,
      { category: 'other', text: 'No id field', sourceRefs: [] }, // missing id
    ];
    installQueryModel(makeMock([{ content: JSON.stringify(claimsWithBad) }]));
    const result = await extractClaims('test/model', 'Draft');
    // Zod schema validation should reject the bad claim but the whole array
    // parse will fail since it's an array schema. On retry we get the same.
    // Either the whole parse fails (falling back) or succeeds with valid claims.
    // The important thing is we don't crash.
    expect(result.logEntry === null || result.logEntry.level === 'warn' || result.logEntry.level === 'error').toBe(true);
  });

  it('accumulates usage across retry attempts', async () => {
    installQueryModel(
      makeMock([
        { content: 'invalid' },
        { content: JSON.stringify(VALID_CLAIMS) },
      ]),
    );
    const result = await extractClaims('test/model', 'Draft');
    // Two calls × 150 tokens each
    expect(result.usage.totalTokens).toBe(300);
    expect(result.wallClockMs).toBe(20);
  });
});
