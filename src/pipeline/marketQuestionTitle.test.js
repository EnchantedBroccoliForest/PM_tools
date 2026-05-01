import { describe, expect, it, vi } from 'vitest';
import { repairMarketQuestionTitle } from './marketQuestionTitle.js';

const SAMPLE_FINAL = {
  refinedQuestion: 'Will Team A win the 2026 finals?',
  outcomes: [
    { name: 'Team A', winCondition: 'Team A wins.', resolutionCriteria: 'Official scoreboard.' },
    { name: 'Team B', winCondition: 'Team B wins.', resolutionCriteria: 'Official scoreboard.' },
  ],
  marketStartTimeUTC: '2026-05-01T00:00:00Z',
  marketEndTimeUTC: '2026-06-15T23:59:59Z',
  shortDescription: 'Tracks the 2026 finals winner.',
  fullResolutionRules: '1. Use the official scoreboard.',
  edgeCases: '1. Match canceled -> Team B',
};

describe('repairMarketQuestionTitle', () => {
  it('skips unstructured finalizer output', async () => {
    const query = vi.fn();

    const result = await repairMarketQuestionTitle('m', { raw: 'not-json' }, 'human', { queryModel: query });

    expect(query).not.toHaveBeenCalled();
    expect(result.finalJson).toEqual({ raw: 'not-json' });
    expect(result.logEntry.message).toMatch(/not structured JSON/);
  });

  it('does not call the model when the title already passes', async () => {
    const query = vi.fn();

    const result = await repairMarketQuestionTitle('m', SAMPLE_FINAL, 'human', { queryModel: query });

    expect(query).not.toHaveBeenCalled();
    expect(result.finalJson.refinedQuestion).toBe(SAMPLE_FINAL.refinedQuestion);
    expect(result.repaired).toBe(false);
    expect(result.logEntry.message).toMatch(/passed/);
  });

  it('repairs only refinedQuestion when the title fails readability checks', async () => {
    const verbose = {
      ...SAMPLE_FINAL,
      refinedQuestion:
        'Will Team A win the 2026 finals according to the official scoreboard resolution source by 2026-06-15T23:59:59Z?',
    };
    const query = vi.fn().mockResolvedValue({
      content: JSON.stringify({ refinedQuestion: 'Will Team A win the 2026 finals?' }),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      wallClockMs: 25,
    });

    const result = await repairMarketQuestionTitle('m', verbose, 'human', { queryModel: query });

    expect(query).toHaveBeenCalledTimes(1);
    expect(result.finalJson).toEqual({
      ...verbose,
      refinedQuestion: 'Will Team A win the 2026 finals?',
    });
    expect(result.repaired).toBe(true);
    expect(result.usage.totalTokens).toBe(15);
  });

  it('keeps the original title when the repair response still fails', async () => {
    const verbose = {
      ...SAMPLE_FINAL,
      refinedQuestion:
        'Will Team A win the 2026 finals according to the official scoreboard resolution source by 2026-06-15T23:59:59Z?',
    };
    const query = vi.fn().mockResolvedValue({
      content: JSON.stringify({ refinedQuestion: 'Team A wins' }),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      wallClockMs: 25,
    });

    const result = await repairMarketQuestionTitle('m', verbose, 'human', { queryModel: query });

    expect(result.finalJson).toBe(verbose);
    expect(result.repaired).toBe(false);
    expect(result.logEntry.level).toBe('warn');
    expect(result.logEntry.message).toMatch(/rejected/);
  });

  it('returns the original finalJson with a warn log when queryModel throws', async () => {
    const verbose = {
      ...SAMPLE_FINAL,
      refinedQuestion:
        'Will Team A win the 2026 finals according to the official scoreboard resolution source by 2026-06-15T23:59:59Z?',
    };
    const query = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await repairMarketQuestionTitle('m', verbose, 'human', { queryModel: query });

    expect(query).toHaveBeenCalledTimes(1);
    expect(result.finalJson).toBe(verbose);
    expect(result.repaired).toBe(false);
    expect(result.usage).toBeNull();
    expect(result.logEntry.level).toBe('warn');
    expect(result.logEntry.message).toMatch(/network down/);
  });

  it('preserves all non-title fields verbatim when repairing', async () => {
    const verbose = {
      ...SAMPLE_FINAL,
      refinedQuestion:
        'Will Team A win the 2026 finals according to the official scoreboard resolution source by 2026-06-15T23:59:59Z?',
    };
    const query = vi.fn().mockResolvedValue({
      content: JSON.stringify({ refinedQuestion: 'Will Team A win the 2026 finals?' }),
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      wallClockMs: 25,
    });

    const result = await repairMarketQuestionTitle('m', verbose, 'human', { queryModel: query });

    expect(result.repaired).toBe(true);
    expect(result.finalJson.outcomes).toEqual(verbose.outcomes);
    expect(result.finalJson.marketStartTimeUTC).toBe(verbose.marketStartTimeUTC);
    expect(result.finalJson.marketEndTimeUTC).toBe(verbose.marketEndTimeUTC);
    expect(result.finalJson.shortDescription).toBe(verbose.shortDescription);
    expect(result.finalJson.fullResolutionRules).toBe(verbose.fullResolutionRules);
    expect(result.finalJson.edgeCases).toBe(verbose.edgeCases);
  });
});
