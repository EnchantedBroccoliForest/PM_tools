import { describe, expect, it } from 'vitest';
import {
  getMarketQuestionTitleLimit,
  validateMarketQuestionTitle,
} from './marketQuestionTitle.js';

describe('validateMarketQuestionTitle', () => {
  it('accepts short trader-facing market questions', () => {
    const result = validateMarketQuestionTitle('Kraken IPO by December 31, 2026?', 'human');

    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('Kraken IPO by December 31, 2026?');
    expect(result.maxChars).toBe(getMarketQuestionTitleLimit('human'));
  });

  it('normalizes whitespace before validating', () => {
    const result = validateMarketQuestionTitle('  Which   artist tops the 2026 Hot 100?  ', 'machine');

    expect(result.valid).toBe(true);
    expect(result.normalized).toBe('Which artist tops the 2026 Hot 100?');
  });

  it('rejects titles that exceed the rigor budget', () => {
    const result = validateMarketQuestionTitle(
      'Will the official city election office publish final certification according to the source by 2027-01-15?',
      'human',
    );

    expect(result.valid).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/too long/);
  });

  it('rejects resolver mechanics and exact timestamps in the title', () => {
    const result = validateMarketQuestionTitle(
      'Will Team A resolve according to the oracle by 11:59 PM ET?',
      'machine',
    );

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('must not include exact clock times');
    expect(result.reasons).toContain('must keep resolver mechanics out of the title');
  });

  it('rejects non-question strings', () => {
    const result = validateMarketQuestionTitle('Kraken IPO by December 31, 2026', 'human');

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('must be one question ending in ?');
  });
});
