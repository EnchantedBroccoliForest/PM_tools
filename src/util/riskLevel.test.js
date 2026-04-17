import { describe, it, expect } from 'vitest';
import { parseRiskLevel } from './riskLevel.js';

describe('parseRiskLevel', () => {
  it('extracts low/medium/high from the canonical prompt shape', () => {
    expect(parseRiskLevel('Risk rating: Low\n\nJustification: ...')).toBe('low');
    expect(parseRiskLevel('Risk rating: Medium')).toBe('medium');
    expect(parseRiskLevel('Risk rating: High')).toBe('high');
  });

  it('is case-insensitive and tolerant of punctuation', () => {
    expect(parseRiskLevel('RISK RATING - HIGH')).toBe('high');
    expect(parseRiskLevel('risk rating low')).toBe('low');
  });

  it('returns "unknown" when the phrase is missing', () => {
    expect(parseRiskLevel('No clear signal here.')).toBe('unknown');
    expect(parseRiskLevel('')).toBe('unknown');
    expect(parseRiskLevel(null)).toBe('unknown');
    expect(parseRiskLevel(undefined)).toBe('unknown');
  });
});
