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

  it('rejects strings containing multiple questions', () => {
    const result = validateMarketQuestionTitle('Will A win? Will B win?', 'human');

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('must be one question ending in ?');
  });

  // Bare verbs like "resolve" / "resolved" / "resolves" appear in legitimate
  // trader-facing questions and must not be treated as resolver-mechanics
  // jargon. The regex now requires multi-word resolver phrases.
  it('accepts bare uses of "resolve" in legitimate trader-facing questions', () => {
    const cases = [
      'Will Congress resolve the debt ceiling by July 2026?',
      'Will the EU resolve the gas crisis by Q3 2026?',
      'Will the case be resolved by 2026?',
    ];
    for (const title of cases) {
      const result = validateMarketQuestionTitle(title, 'machine');
      expect(result.valid, `expected "${title}" to pass`).toBe(true);
    }
  });

  it('still rejects multi-word resolver phrases', () => {
    const result = validateMarketQuestionTitle(
      'Will Team A win by 2026 (resolves to Team A)?',
      'machine',
    );

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain('must keep resolver mechanics out of the title');
  });

  it('falls back to the machine limit for unknown rigor names', () => {
    expect(getMarketQuestionTitleLimit('unknown-rigor')).toBe(getMarketQuestionTitleLimit('machine'));
  });
});
