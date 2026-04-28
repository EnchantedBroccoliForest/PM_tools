const DEFAULT_LIMITS = Object.freeze({
  questionChars: 220,
  descriptionChars: 160,
  outcomeNameChars: 80,
  outcomeWinChars: 160,
  outcomeResolutionChars: 180,
  settlementBullets: 5,
  settlementBulletChars: 220,
  edgeCaseBullets: 5,
  edgeCaseBulletChars: 220,
  riskChars: 180,
  copyChars: 1600,
});

export const MARKET_CARD_LIMITS = Object.freeze({ ...DEFAULT_LIMITS });

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function resolveLimits(overrides = {}) {
  return Object.fromEntries(
    Object.entries(DEFAULT_LIMITS).map(([key, fallback]) => [
      key,
      positiveInteger(overrides[key], fallback),
    ]),
  );
}

function toText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function oneLine(value) {
  return toText(value).replace(/\s+/g, ' ');
}

export function truncateText(value, maxChars) {
  const text = oneLine(value);
  if (!text || !maxChars || text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function truncateBlock(value, maxChars) {
  const text = toText(value)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n');
  if (!text || !maxChars || text.length <= maxChars) return text;
  if (maxChars <= 3) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 3).trimEnd()}...`;
}

function cleanBullet(value, maxChars) {
  const text = oneLine(value)
    .replace(/^[-*]\s+/, '')
    .replace(/^\d{1,2}[.)]\s+/, '');
  return truncateText(text, maxChars);
}

function isHeadingOnly(value) {
  return /^[A-Za-z][A-Za-z0-9 /_-]{0,40}:$/.test(value);
}

function splitBullets(value, maxItems, maxChars) {
  if (Array.isArray(value)) {
    const allItems = value
      .map((item) => cleanBullet(item, maxChars))
      .filter((line) => line && !isHeadingOnly(line));

    return {
      items: allItems.slice(0, maxItems),
      hiddenCount: Math.max(0, allItems.length - maxItems),
    };
  }

  const raw = toText(value);
  if (!raw) return { items: [], hiddenCount: 0 };

  const prepared = raw
    .replace(/\r/g, '\n')
    .replace(/\s+(?=\d{1,2}[.)]\s+)/g, '\n');

  const allItems = prepared
    .split(/\n+/)
    .map((line) => cleanBullet(line, maxChars))
    .filter((line) => line && !isHeadingOnly(line));

  return {
    items: allItems.slice(0, maxItems),
    hiddenCount: Math.max(0, allItems.length - maxItems),
  };
}

function formatPeriod(start, end) {
  const startText = oneLine(start);
  const endText = oneLine(end);
  if (startText && endText) return `${startText} -> ${endText}`;
  return startText || endText;
}

function buildOutcomes(outcomes, limits) {
  if (!Array.isArray(outcomes)) return [];
  return outcomes.map((outcome, index) => {
    const name = truncateText(outcome?.name || `Outcome ${index + 1}`, limits.outcomeNameChars);
    return {
      name,
      winCondition: truncateText(outcome?.winCondition, limits.outcomeWinChars),
      resolutionCriteria: truncateText(outcome?.resolutionCriteria, limits.outcomeResolutionChars),
    };
  });
}

function firstBulletOrText(value, maxChars) {
  const bullets = splitBullets(value, 1, maxChars);
  return bullets.items[0] || truncateText(value, maxChars);
}

function buildRisk(finalJson, options, limits) {
  const text = options.riskText || finalJson?.earlyResolutionRisk || finalJson?.risk || '';
  const summary = firstBulletOrText(text, limits.riskChars);
  const level = oneLine(options.riskLevel || finalJson?.earlyResolutionRiskLevel || finalJson?.riskLevel);
  if (!summary && !level) return null;
  return { level, summary };
}

export function buildMarketCard(finalJson, options = {}) {
  const limits = resolveLimits(options.limits);

  if (!finalJson || typeof finalJson !== 'object') {
    return {
      isRaw: true,
      raw: toText(finalJson),
      fullSpec: finalJson,
    };
  }

  if (finalJson.raw) {
    return {
      isRaw: true,
      raw: toText(finalJson.raw),
      fullSpec: finalJson,
    };
  }

  const settlement = splitBullets(
    finalJson.fullResolutionRules,
    limits.settlementBullets,
    limits.settlementBulletChars,
  );
  const edgeCases = splitBullets(
    finalJson.edgeCases,
    limits.edgeCaseBullets,
    limits.edgeCaseBulletChars,
  );

  return {
    isRaw: false,
    question: truncateText(finalJson.refinedQuestion || finalJson.question, limits.questionChars),
    description: truncateText(finalJson.shortDescription || finalJson.description, limits.descriptionChars),
    period: formatPeriod(finalJson.marketStartTimeUTC, finalJson.marketEndTimeUTC),
    outcomes: buildOutcomes(finalJson.outcomes, limits),
    settlementBullets: settlement.items,
    hiddenSettlementCount: settlement.hiddenCount,
    edgeCaseBullets: edgeCases.items,
    hiddenEdgeCaseCount: edgeCases.hiddenCount,
    risk: buildRisk(finalJson, options, limits),
    fullSpec: finalJson,
    limits,
  };
}

function pushSection(lines, title, items, hiddenCount, hiddenLabel) {
  if (items.length === 0 && hiddenCount === 0) return;
  lines.push('', `${title}:`);
  for (const item of items) lines.push(`- ${item}`);
  if (hiddenCount > 0) {
    const noun = hiddenCount === 1 ? hiddenLabel : `${hiddenLabel}s`;
    lines.push(`- +${hiddenCount} more ${noun} in full spec.`);
  }
}

export function formatMarketCardCopy(card, options = {}) {
  if (!card || typeof card !== 'object') return '';
  if (card.isRaw) return toText(card.raw);

  const copyChars = positiveInteger(options.copyChars, card.limits?.copyChars || DEFAULT_LIMITS.copyChars);
  const lines = ['Market card'];

  if (card.question) lines.push('', `Question: ${card.question}`);
  if (card.description) lines.push(`Description: ${card.description}`);
  if (card.period) lines.push(`Market period: ${card.period}`);

  if (card.outcomes?.length > 0) {
    lines.push('', 'Outcomes:');
    card.outcomes.forEach((outcome, index) => {
      const win = outcome.winCondition || 'See resolution criteria.';
      lines.push(`${index + 1}. ${outcome.name}: ${win}`);
      if (outcome.resolutionCriteria && outcome.resolutionCriteria !== outcome.winCondition) {
        lines.push(`   Verify: ${outcome.resolutionCriteria}`);
      }
    });
  }

  pushSection(
    lines,
    'Settlement',
    card.settlementBullets || [],
    card.hiddenSettlementCount || 0,
    'settlement rule',
  );
  pushSection(
    lines,
    'Edge cases',
    card.edgeCaseBullets || [],
    card.hiddenEdgeCaseCount || 0,
    'edge case',
  );

  if (card.risk) {
    const level = card.risk.level ? `${card.risk.level.toUpperCase()}: ` : '';
    lines.push('', `Risk: ${level}${card.risk.summary || 'See full risk analysis.'}`);
  }

  return truncateBlock(lines.join('\n'), copyChars);
}
