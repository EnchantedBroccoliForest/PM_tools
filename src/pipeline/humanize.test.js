import { describe, it, expect, vi } from 'vitest';
import { humanizeFinalJson, mergeHumanized } from './humanize.js';

const SAMPLE_FINAL = {
  refinedQuestion: 'Will Team A win the 2026 finals?',
  outcomes: [
    { name: 'Team A', winCondition: 'Team A serves as the champion.', resolutionCriteria: 'Actually, the official box score indicates Team A.' },
    { name: 'Team B', winCondition: 'Team B serves as the champion.', resolutionCriteria: 'Per the official box score.' },
    { name: 'Other / None', winCondition: 'Neither listed team wins.', resolutionCriteria: 'Official box score shows no listed team.' },
  ],
  marketStartTimeUTC: '2026-05-01T00:00:00Z',
  marketEndTimeUTC: '2026-06-15T23:59:59Z',
  shortDescription: 'It is important to note this market tracks the finals — a testament to fandom.',
  fullResolutionRules: '1. Read https://example.com/boxscore. 2. Map winner to the named outcome.',
  edgeCases: '1. Series postponed past end date → Other / None',
};

describe('mergeHumanized', () => {
  it('preserves outcome names even if the model changes them', () => {
    const humanized = {
      ...SAMPLE_FINAL,
      outcomes: [
        { name: 'TEAM A (GOATS)', winCondition: 'Team A is the champion.', resolutionCriteria: 'Official box score names Team A.' },
        { name: 'Team B', winCondition: 'Team B is the champion.', resolutionCriteria: 'Official box score names Team B.' },
        { name: 'Other', winCondition: 'Neither listed team wins.', resolutionCriteria: 'Official box score shows no listed team.' },
      ],
    };
    const merged = mergeHumanized(SAMPLE_FINAL, humanized);
    expect(merged.outcomes.map((o) => o.name)).toEqual(['Team A', 'Team B', 'Other / None']);
    expect(merged.outcomes[0].winCondition).toBe('Team A is the champion.');
    expect(merged.outcomes[0].resolutionCriteria).toBe('Official box score names Team A.');
  });

  it('preserves marketStartTimeUTC and marketEndTimeUTC byte-for-byte', () => {
    const humanized = {
      ...SAMPLE_FINAL,
      marketStartTimeUTC: '2026-05-01T00:00:01Z',
      marketEndTimeUTC: '2026-06-16T00:00:00Z',
    };
    const merged = mergeHumanized(SAMPLE_FINAL, humanized);
    expect(merged.marketStartTimeUTC).toBe(SAMPLE_FINAL.marketStartTimeUTC);
    expect(merged.marketEndTimeUTC).toBe(SAMPLE_FINAL.marketEndTimeUTC);
  });

  it('adopts humanized refinedQuestion / shortDescription / rules / edgeCases when non-empty', () => {
    const humanized = {
      refinedQuestion: 'Does Team A win the 2026 finals?',
      shortDescription: 'Tracks the 2026 finals winner.',
      fullResolutionRules: '1. Read https://example.com/boxscore. 2. Map winner.',
      edgeCases: '1. Series postponed past end date → Other / None',
      outcomes: SAMPLE_FINAL.outcomes,
    };
    const merged = mergeHumanized(SAMPLE_FINAL, humanized);
    expect(merged.refinedQuestion).toBe('Does Team A win the 2026 finals?');
    expect(merged.shortDescription).toBe('Tracks the 2026 finals winner.');
  });

  it('falls back to the original string when humanized field is empty or wrong type', () => {
    const humanized = {
      refinedQuestion: '',
      shortDescription: 42,
      outcomes: [
        { name: 'ignored', winCondition: '', resolutionCriteria: null },
        {},
        { name: 'ignored', winCondition: 'Neither listed team wins.', resolutionCriteria: 'Official box score shows no listed team.' },
      ],
    };
    const merged = mergeHumanized(SAMPLE_FINAL, humanized);
    expect(merged.refinedQuestion).toBe(SAMPLE_FINAL.refinedQuestion);
    expect(merged.shortDescription).toBe(SAMPLE_FINAL.shortDescription);
    expect(merged.outcomes[0].winCondition).toBe(SAMPLE_FINAL.outcomes[0].winCondition);
    expect(merged.outcomes[0].resolutionCriteria).toBe(SAMPLE_FINAL.outcomes[0].resolutionCriteria);
  });

  it('returns the original when humanized input is not a plain object', () => {
    expect(mergeHumanized(SAMPLE_FINAL, null)).toBe(SAMPLE_FINAL);
    expect(mergeHumanized(SAMPLE_FINAL, 'string')).toBe(SAMPLE_FINAL);
    expect(mergeHumanized(SAMPLE_FINAL, [])).toBe(SAMPLE_FINAL);
  });
});

describe('humanizeFinalJson', () => {
  it('skips work when finalJson is the `{ raw: ... }` fallback', async () => {
    const query = vi.fn();
    const result = await humanizeFinalJson('m', { raw: 'not-json' }, { queryModel: query });
    expect(query).not.toHaveBeenCalled();
    expect(result.humanizedJson).toEqual({ raw: 'not-json' });
    expect(result.logEntry.level).toBe('info');
    expect(result.logEntry.message).toMatch(/not structured JSON/);
  });

  it('returns the original JSON when the model throws', async () => {
    const query = vi.fn().mockRejectedValue(new Error('rate limited'));
    const result = await humanizeFinalJson('m', SAMPLE_FINAL, { queryModel: query });
    expect(result.humanizedJson).toBe(SAMPLE_FINAL);
    expect(result.logEntry.level).toBe('warn');
    expect(result.logEntry.message).toMatch(/rate limited/);
  });

  it('returns the original JSON when the model output is not valid JSON', async () => {
    const query = vi.fn().mockResolvedValue({
      content: 'sorry, I cannot do that',
      usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
      wallClockMs: 50,
    });
    const result = await humanizeFinalJson('m', SAMPLE_FINAL, { queryModel: query });
    expect(result.humanizedJson).toBe(SAMPLE_FINAL);
    expect(result.logEntry.level).toBe('warn');
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 2, totalTokens: 12 });
  });

  it('applies humanized strings and enforces structural invariants on success', async () => {
    const humanized = {
      ...SAMPLE_FINAL,
      refinedQuestion: 'Does Team A win the 2026 finals?',
      outcomes: [
        // Model drifted on a name — must be restored from the original.
        { name: 'TEAM A (GOATS)', winCondition: 'Team A is the champion.', resolutionCriteria: 'Official box score names Team A.' },
        { name: 'Team B', winCondition: 'Team B is the champion.', resolutionCriteria: 'Official box score names Team B.' },
        { name: 'Other / None', winCondition: 'Neither listed team wins.', resolutionCriteria: 'Official box score shows no listed team.' },
      ],
      // Model drifted on a timestamp — must also be restored.
      marketStartTimeUTC: '1999-01-01T00:00:00Z',
      shortDescription: 'Tracks the 2026 finals winner.',
    };
    const query = vi.fn().mockResolvedValue({
      content: '```json\n' + JSON.stringify(humanized) + '\n```',
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
      wallClockMs: 120,
    });

    const result = await humanizeFinalJson('m', SAMPLE_FINAL, { queryModel: query });

    expect(result.logEntry.level).toBe('info');
    expect(result.humanizedJson.refinedQuestion).toBe('Does Team A win the 2026 finals?');
    expect(result.humanizedJson.outcomes[0].name).toBe('Team A');
    expect(result.humanizedJson.outcomes[0].winCondition).toBe('Team A is the champion.');
    expect(result.humanizedJson.marketStartTimeUTC).toBe(SAMPLE_FINAL.marketStartTimeUTC);
    expect(result.humanizedJson.marketEndTimeUTC).toBe(SAMPLE_FINAL.marketEndTimeUTC);
  });
});
