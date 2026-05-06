import { describe, expect, it } from 'vitest';
import { validateFinalMarketJson } from './finalMarketJson.js';

describe('validateFinalMarketJson', () => {
  it('rejects outcome names that begin with the reserved OT token prefix', () => {
    const result = validateFinalMarketJson({
      outcomes: [
        { name: 'Below $10B' },
        { name: 'OT Below $10B' },
        { name: 'OT-Above $10B' },
        { name: 'OTBelow $10B' },
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      'outcomes[1].name must not begin with reserved "OT" token prefix',
      'outcomes[2].name must not begin with reserved "OT" token prefix',
      'outcomes[3].name must not begin with reserved "OT" token prefix',
    ]);
  });

  it('allows canonical catch-all and ordinary outcome names', () => {
    const result = validateFinalMarketJson({
      outcomes: [
        { name: 'Other / None' },
        { name: 'Below $10B' },
      ],
    });

    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('skips raw fallback output', () => {
    expect(validateFinalMarketJson({ raw: 'not json' })).toEqual({ valid: true, errors: [] });
  });
});
