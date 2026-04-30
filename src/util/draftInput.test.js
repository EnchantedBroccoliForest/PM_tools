import { describe, expect, it } from 'vitest';
import {
  normalizeUtcDateTime,
  toDateTimeLocalValue,
  validateDatePair,
  validateDraftInputs,
} from './draftInput.js';

describe('draft input datetime helpers', () => {
  it('normalizes datetime-local values as UTC timestamps', () => {
    expect(normalizeUtcDateTime('2026-06-01T09:30')).toBe('2026-06-01T09:30:00Z');
  });

  it('keeps imported UTC timestamps displayable in datetime-local inputs', () => {
    expect(toDateTimeLocalValue('2026-06-01T09:30:00Z')).toBe('2026-06-01T09:30');
  });

  it('preserves backward-compatible date-only values with fallback times', () => {
    expect(normalizeUtcDateTime('2026-06-01', '23:59:59')).toBe('2026-06-01T23:59:59Z');
  });
});

describe('validateDraftInputs', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');

  it('requires the question and both timestamps', () => {
    const result = validateDraftInputs({ question: '', startDate: '', endDate: '' }, now);

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual({
      question: 'Market question is required.',
      startDate: 'Start date and time is required.',
      endDate: 'End date and time is required.',
    });
  });

  it('rejects an end timestamp before the start timestamp', () => {
    const result = validateDraftInputs({
      question: 'Will BTC exceed 100k?',
      startDate: '2026-06-01T10:00',
      endDate: '2026-06-01T09:59',
    }, now);

    expect(result.isValid).toBe(false);
    expect(result.errors.endDate).toBe('End date and time must be later than Start.');
  });

  it('rejects a start timestamp in the past', () => {
    const result = validateDraftInputs({
      question: 'Will BTC exceed 100k?',
      startDate: '2025-06-01T10:00',
      endDate: '2026-06-30T23:30',
    }, now);

    expect(result.isValid).toBe(false);
    expect(result.errors.startDate).toBe('Start date and time must be in the future.');
  });

  it('returns normalized UTC timestamps for valid input', () => {
    const result = validateDraftInputs({
      question: 'Will BTC exceed 100k?',
      startDate: '2026-06-01T10:00',
      endDate: '2026-06-30T23:30',
    }, now);

    expect(result.isValid).toBe(true);
    expect(result.startDateUTC).toBe('2026-06-01T10:00:00Z');
    expect(result.endDateUTC).toBe('2026-06-30T23:30:00Z');
  });
});

describe('validateDatePair', () => {
  it('returns null when both dates are blank', () => {
    expect(validateDatePair('', '', Date.parse('2026-01-01T00:00:00Z'))).toBeNull();
  });
});
