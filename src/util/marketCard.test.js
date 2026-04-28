import { describe, it, expect } from 'vitest';
import { buildMarketCard, formatMarketCardCopy } from './marketCard.js';

const FINAL_MARKET = {
  refinedQuestion: 'Will Example City publish its final certified mayoral result by 2027-01-15?',
  shortDescription: 'This resolves based on Example City publishing a final certified mayoral result through its election office.',
  marketStartTimeUTC: '2026-12-01T00:00:00Z',
  marketEndTimeUTC: '2027-01-15T23:59:59Z',
  outcomes: [
    {
      name: 'Yes',
      winCondition: 'The city election office publishes a final certified result on or before the market close timestamp.',
      resolutionCriteria: 'Use the timestamp and content of the city election office final certification page.',
    },
    {
      name: 'No',
      winCondition: 'No final certified result is published by the market close timestamp.',
      resolutionCriteria: 'Use the city election office site and any official notice that certification remains pending.',
    },
  ],
  fullResolutionRules:
    '1. Use the official city election office certification page. 2. Match the published mayoral result to the market question. 3. Ignore unofficial projections and campaign statements. 4. Use the first final certification posted before close. 5. If certification is later corrected, use the version available at close. 6. Archive raw evidence in the audit notes.',
  edgeCases:
    '1. Source unavailable at close resolves No.\n2. A recount after close does not change the result.\n3. A court order before close pauses certification.\n4. A typo corrected before close uses the corrected text.\n5. A partial certification is not final.\n6. A duplicate page should be ignored.',
};

describe('buildMarketCard', () => {
  it('derives a capped market card without mutating the final JSON', () => {
    const originalRules = FINAL_MARKET.fullResolutionRules;

    const card = buildMarketCard(FINAL_MARKET, {
      riskLevel: 'low',
      riskText: 'Risk rating: Low\nThe market is anchored to one official source.',
    });

    expect(FINAL_MARKET.fullResolutionRules).toBe(originalRules);
    expect(card.question).toBe(FINAL_MARKET.refinedQuestion);
    expect(card.description.length).toBeLessThanOrEqual(160);
    expect(card.outcomes).toHaveLength(2);
    expect(card.outcomes[0].winCondition.length).toBeLessThanOrEqual(160);
    expect(card.outcomes[0].resolutionCriteria.length).toBeLessThanOrEqual(180);
    expect(card.settlementBullets).toHaveLength(5);
    expect(card.hiddenSettlementCount).toBe(1);
    expect(card.edgeCaseBullets).toHaveLength(5);
    expect(card.hiddenEdgeCaseCount).toBe(1);
    expect(card.risk).toEqual({
      level: 'low',
      summary: 'Risk rating: Low',
    });
    expect(card.fullSpec).toBe(FINAL_MARKET);
  });

  it('formats concise default clipboard text with hidden detail counts', () => {
    const card = buildMarketCard(FINAL_MARKET, {
      riskLevel: 'medium',
      riskText: 'Watch for certification delays.',
    });

    const copy = formatMarketCardCopy(card);

    expect(copy.length).toBeLessThanOrEqual(1600);
    expect(copy).toContain('Market card');
    expect(copy).toContain('Question: Will Example City publish');
    expect(copy).toContain('\nOutcomes:\n1. Yes:');
    expect(copy).toContain('\nSettlement:\n- Use the official city election office certification page.');
    expect(copy).toContain('Settlement:');
    expect(copy).toContain('+1 more settlement rule in full spec.');
    expect(copy).toContain('+1 more edge case in full spec.');
    expect(copy).toContain('Risk: MEDIUM: Watch for certification delays.');
    expect(copy).not.toContain('Archive raw evidence in the audit notes.');
    expect(copy).not.toContain('A duplicate page should be ignored.');
  });

  it('passes raw fallback content through unchanged', () => {
    const card = buildMarketCard({ raw: 'Unparsed finalizer text.' });

    expect(card.isRaw).toBe(true);
    expect(formatMarketCardCopy(card)).toBe('Unparsed finalizer text.');
  });
});
