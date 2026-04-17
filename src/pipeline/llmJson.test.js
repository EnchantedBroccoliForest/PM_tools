import { describe, it, expect } from 'vitest';
import { tryParseJsonArray, tryParseJsonObject, createUsageAggregator } from './llmJson.js';

describe('tryParseJsonObject', () => {
  it('parses a bare JSON object', () => {
    expect(tryParseJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips ```json fences', () => {
    expect(tryParseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('salvages leading prose before the object', () => {
    expect(tryParseJsonObject('here you go: {"a":1}')).toEqual({ a: 1 });
  });

  it('returns null on non-string input', () => {
    expect(tryParseJsonObject(null)).toBeNull();
    expect(tryParseJsonObject(undefined)).toBeNull();
    expect(tryParseJsonObject(42)).toBeNull();
  });

  it('returns null on unparseable content', () => {
    expect(tryParseJsonObject('no braces here')).toBeNull();
  });
});

describe('tryParseJsonArray', () => {
  it('parses a bare JSON array', () => {
    expect(tryParseJsonArray('[1,2,3]')).toEqual({ data: [1, 2, 3], recovered: false });
  });

  it('recovers a prefix of a truncated array', () => {
    const truncated = '[{"id":"a","text":"ok"},{"id":"b","text":"also ok"},{"id":"c","text":"tru';
    const result = tryParseJsonArray(truncated);
    expect(result).not.toBeNull();
    expect(result.recovered).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].id).toBe('a');
  });

  it('returns null when even a prefix cannot be recovered', () => {
    expect(tryParseJsonArray('[garbage')).toBeNull();
  });

  it('ignores `}` inside string values when scanning for element boundaries', () => {
    const input = '[{"id":"a","text":"contains } brace"},{"id":"b"';
    const result = tryParseJsonArray(input);
    expect(result).not.toBeNull();
    expect(result.recovered).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].text).toContain('}');
  });
});

describe('createUsageAggregator', () => {
  it('sums usage counters and wall clock across calls', () => {
    const { aggregate, accumulate } = createUsageAggregator();
    accumulate({ usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }, wallClockMs: 100 });
    accumulate({ usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 }, wallClockMs: 50 });
    expect(aggregate.usage).toEqual({ promptTokens: 13, completionTokens: 7, totalTokens: 20 });
    expect(aggregate.wallClockMs).toBe(150);
  });

  it('tolerates a null/missing result', () => {
    const { aggregate, accumulate } = createUsageAggregator();
    accumulate(null);
    accumulate({});
    expect(aggregate.usage.totalTokens).toBe(0);
    expect(aggregate.wallClockMs).toBe(0);
  });
});
