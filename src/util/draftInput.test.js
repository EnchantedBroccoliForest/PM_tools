import { describe, expect, it } from 'vitest';
import {
  normalizeUtcDateTime,
  toDateInputValue,
  validateDatePair,
  validateDraftInputs,
  VALIDATION_ERRORS,
} from './draftInput.js';

describe('draft input datetime helpers', () => {
  it('normalizes date-only values to midnight UTC', () => {
    expect(normalizeUtcDateTime('2026-06-01')).toBe('2026-06-01T00:00:00Z');
  });

  it('still accepts legacy datetime-local values', () => {
    expect(normalizeUtcDateTime('2026-06-01T09:30')).toBe('2026-06-01T09:30:00Z');
  });

  it('renders imported UTC timestamps as date-only input values', () => {
    expect(toDateInputValue('2026-06-01T09:30:00Z')).toBe('2026-06-01');
  });

  it('honors an explicit fallback time when provided', () => {
    expect(normalizeUtcDateTime('2026-06-01', '23:59:59')).toBe('2026-06-01T23:59:59Z');
  });
});

describe('validateDraftInputs', () => {
  const now = Date.parse('2026-01-01T00:00:00Z');

  it('requires the question and both timestamps', () => {
    const result = validateDraftInputs({ question: '', startDate: '', endDate: '' }, now);

    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual({
      question: VALIDATION_ERRORS.QUESTION_REQUIRED,
      startDate: VALIDATION_ERRORS.START_REQUIRED,
      endDate: VALIDATION_ERRORS.END_REQUIRED,
    });
  });

  it('rejects an end timestamp before the start timestamp', () => {
    const result = validateDraftInputs({
      question: 'Will BTC exceed 100k?',
      startDate: '2026-06-01T10:00',
      endDate: '2026-06-01T09:59',
    }, now);

    expect(result.isValid).toBe(false);
    expect(result.errors.endDate).toBe(VALIDATION_ERRORS.END_BEFORE_START);
  });

  it('rejects a start timestamp in the past', () => {
    const result = validateDraftInputs({
      question: 'Will BTC exceed 100k?',
      startDate: '2025-06-01T10:00',
      endDate: '2026-06-30T23:30',
    }, now);

    expect(result.isValid).toBe(false);
    expect(result.errors.startDate).toBe(VALIDATION_ERRORS.START_PAST);
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
