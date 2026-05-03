import { describe, it, expect } from 'vitest';
import { formatFullSpecCopy } from './finalCopy.js';
import { buildMarketCard, formatMarketCardCopy } from './marketCard.js';

const FINAL_MARKET = {
  refinedQuestion: 'Will Example City publish its final certified mayoral result by 2027-01-15?',
  shortDescription:
    'This resolves based on Example City publishing a final certified mayoral result through its election office.',
  marketStartTimeUTC: '2026-12-01T00:00:00Z',
  marketEndTimeUTC: '2027-01-15T23:59:59Z',
  outcomes: [
    {
      name: 'Yes',
      winCondition:
        'The city election office publishes a final certified result on or before the market close timestamp.',
      resolutionCriteria:
        'Use the timestamp and content of the city election office final certification page.',
    },
    {
      name: 'No',
      winCondition: 'No final certified result is published by the market close timestamp.',
      resolutionCriteria:
        'Use the city election office site and any official notice that certification remains pending.',
    },
  ],
  fullResolutionRules:
    '1. Use the official city election office certification page.\n2. Match the published mayoral result to the market question.\n3. Ignore unofficial projections and campaign statements.\n4. Use the first final certification posted before close.\n5. If certification is later corrected, use the version available at close.\n6. Archive raw evidence in the audit notes.',
  edgeCases:
    '1. Source unavailable at close resolves No.\n2. A recount after close does not change the result.\n3. A court order before close pauses certification.\n4. A typo corrected before close uses the corrected text.\n5. A partial certification is not final.\n6. A duplicate page should be ignored.',
};

describe('formatFullSpecCopy (Machine Mode default)', () => {
  it('emits the verbose resolver-style bundle byte-identically to the prior inline implementation', () => {
    const expected = [
      `Question: ${FINAL_MARKET.refinedQuestion}`,
      `\nDescription: ${FINAL_MARKET.shortDescription}`,
      `\nMarket Period: ${FINAL_MARKET.marketStartTimeUTC} — ${FINAL_MARKET.marketEndTimeUTC}`,
      `\nOutcomes:\n${FINAL_MARKET.outcomes
        .map(
          (o, i) =>
            `${i + 1}. ${o.name}\n   Wins if: ${o.winCondition || 'N/A'}\n   Resolved by: ${o.resolutionCriteria}`,
        )
        .join('\n')}`,
      `\nFull Resolution Rules:\n${FINAL_MARKET.fullResolutionRules}`,
      `\nEdge Cases:\n${FINAL_MARKET.edgeCases}`,
    ].join('\n');

    expect(formatFullSpecCopy(FINAL_MARKET)).toBe(expected);
  });

  it('returns an empty string when there is no final content', () => {
    expect(formatFullSpecCopy(null)).toBe('');
    expect(formatFullSpecCopy(undefined)).toBe('');
    expect(formatFullSpecCopy('not an object')).toBe('');
  });

  it('uses Wins if "N/A" placeholder when an outcome lacks a win condition (machine compatibility)', () => {
    const text = formatFullSpecCopy({
      ...FINAL_MARKET,
      outcomes: [{ name: 'Yes', winCondition: '', resolutionCriteria: 'Source page.' }],
    });

    expect(text).toContain('Wins if: N/A');
  });
});

// Cross-check that the Human-mode Copy All path (formatMarketCardCopy) is
// strictly more compact than the Machine-mode bundle, and that it does not
// leak the full resolution rules verbatim.
describe('Human Mode Copy All vs Machine Mode Copy All', () => {
  it('Human compact copy is shorter than the Machine full-spec copy', () => {
    const card = buildMarketCard(FINAL_MARKET, {
      riskLevel: 'low',
      riskText: 'Anchored to one official source.',
    });
    const humanCopy = formatMarketCardCopy(card);
    const machineCopy = formatFullSpecCopy(FINAL_MARKET);

    expect(humanCopy.length).toBeLessThan(machineCopy.length);
  });

  it('Human compact copy does not include full resolution rules beyond the capped bullets', () => {
    const card = buildMarketCard(FINAL_MARKET);
    const humanCopy = formatMarketCardCopy(card);

    // The 6th rule is dropped by the cap; verify it never leaks into the
    // Human compact copy. The 5th rule should still appear (within the cap).
    expect(humanCopy).not.toContain('Archive raw evidence in the audit notes.');
    expect(humanCopy).toContain('+1 more settlement rule in full spec.');
  });
});
