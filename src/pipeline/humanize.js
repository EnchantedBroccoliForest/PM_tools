/**
 * Post-finalize humanizer pass.
 *
 * Runs silently after handleAccept's finalizer call: rewrites the prose text
 * fields of the finalized market JSON to remove AI-writing tells, while
 * preserving structural fields (outcome names, URLs, ISO timestamps, numeric
 * thresholds, comparators, tickers, the overall JSON shape). Failures never
 * bubble up — on any error the caller gets the un-humanized JSON back so the
 * Finalize flow cannot be blocked by a flaky extra LLM call.
 *
 * Defense in depth on structural drift:
 *   1. The humanizer prompt tells the model not to touch structural tokens.
 *   2. `PRESERVED_TOP_LEVEL_FIELDS` and outcome-name restoration are a
 *      blanket second layer for fields that must stay byte-for-byte stable.
 *   3. For prose fields (refinedQuestion, fullResolutionRules, edgeCases,
 *      outcome winCondition/resolutionCriteria), every protected token in
 *      the ORIGINAL string (URLs, ISO dates/timestamps, numeric tokens like
 *      "$50M" or "30%", comparators, tickers, referenced outcome names)
 *      must still appear verbatim in the humanized replacement; if any is
 *      missing, the field falls back to the original. This prevents silent
 *      mutation of resolution semantics (thresholds, source URLs, scenario
 *      → outcome mappings) that a drifting model could otherwise sneak in.
 */

import { queryModel } from '../api/openrouter.js';
import { getSystemPrompt, buildHumanizerPrompt } from '../constants/prompts.js';
import { tryParseJsonObject } from './llmJson.js';

// Fields the humanizer is NOT allowed to modify. Restored from the original
// after parsing the model's response.
const PRESERVED_TOP_LEVEL_FIELDS = ['marketStartTimeUTC', 'marketEndTimeUTC'];

// Token extractors used by the structural-drift guard. Every token the
// humanizer is told to preserve must survive verbatim in the replacement —
// if any goes missing we drop the humanized string and keep the original.
// Order matters: URLs are stripped first so their query strings don't get
// mis-parsed as numerics or ticker-like tokens.
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
const ISO_DATETIME_RE = /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?\b/g;
// Numeric tokens: optional leading `$`, digits with commas/decimals,
// optional %/bps/K/M/B/T suffix. Matches "50", "$50M", "30%", "1.5B", "25bps".
const NUMERIC_RE = /\$?\d+(?:,\d{3})*(?:\.\d+)?(?:%|bps|[KMBTkmbt])?\b/g;
// ASCII + unicode comparators. We check each separately so a missing `≥`
// isn't masked by a present `>=`.
const COMPARATOR_RE = /<=|>=|≤|≥|[<>]/g;
// Ticker-style tokens: 2+ uppercase letters, optionally qualified as
// `EXCHANGE:TICKER` or `EXCHANGE.TICKER`. Catches AAPL, BTC, NASDAQ:AAPL,
// BRK.B, as well as technical tokens like UTC that the prompt says to
// preserve. Common acronyms are still strings the market card cares about.
const TICKER_RE = /\b[A-Z]{2,}(?:[:.][A-Z0-9]{1,})?\b/g;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Extract tokens that must survive humanization. Stripping URLs first
 * prevents substrings inside a URL from being re-matched as numeric or
 * ticker tokens (e.g. "https://example.com/v2" → no "v2" ticker match).
 *
 * @param {string} text
 * @returns {string[]}
 */
function extractProtectedTokens(text) {
  if (typeof text !== 'string' || !text) return [];
  const tokens = [];

  const stripped = text.replace(URL_RE, (m) => {
    tokens.push(m);
    return ' '.repeat(m.length);
  });

  for (const re of [ISO_DATETIME_RE, NUMERIC_RE, COMPARATOR_RE, TICKER_RE]) {
    const matches = stripped.match(re);
    if (matches) tokens.push(...matches);
  }

  return tokens;
}

/**
 * True iff every protected token that appears in `original` also appears
 * verbatim in `humanized`. Extra tokens in `humanized` are allowed (they'd
 * already violate the "edit only" rule but do not endanger resolution
 * semantics the way a dropped threshold does).
 */
function preservesProtectedTokens(original, humanized) {
  if (typeof original !== 'string' || typeof humanized !== 'string') return false;
  const tokens = extractProtectedTokens(original);
  for (const tok of tokens) {
    if (!humanized.includes(tok)) return false;
  }
  return true;
}

/**
 * True iff every outcome name that appears in `original` also appears
 * verbatim in `humanized`. Used for edgeCases, fullResolutionRules, and
 * outcome-level fields where a `scenario → outcome name` reference might
 * drift and silently strand collateral on settlement.
 */
function preservesReferencedNames(original, humanized, outcomeNames) {
  if (typeof original !== 'string' || typeof humanized !== 'string') return false;
  for (const name of outcomeNames) {
    if (original.includes(name) && !humanized.includes(name)) return false;
  }
  return true;
}

/**
 * Accept `humanized` only when it is a non-empty string that preserves
 * every protected token and referenced outcome name from `original`.
 * Otherwise fall back to `original`. Returns `{value, kept}` so the caller
 * can surface drift counts in the run log.
 */
function adoptIfStable(original, humanized, outcomeNames) {
  if (typeof humanized !== 'string' || !humanized.trim()) {
    return { value: original, kept: false };
  }
  if (!preservesProtectedTokens(original, humanized)) {
    return { value: original, kept: false };
  }
  if (!preservesReferencedNames(original, humanized, outcomeNames)) {
    return { value: original, kept: false };
  }
  return { value: humanized, kept: true };
}

function collectOutcomeNames(original) {
  if (!Array.isArray(original.outcomes)) return [];
  return original.outcomes
    .map((o) => (o && typeof o.name === 'string' ? o.name : ''))
    .filter(Boolean);
}

/**
 * Merge humanized text back into the original JSON. Structural fields
 * (outcome names, marketStart/EndTimeUTC) are always taken from the
 * original; prose fields are only adopted when they preserve every
 * protected token and outcome-name reference that appeared in the
 * original. Returns `{merged, rejectedFields}` — `rejectedFields` names
 * the dot-path of every humanized string that failed the guard so the
 * caller can log the drift for traceability.
 *
 * @param {Object} original
 * @param {Object} humanized
 * @returns {{merged: Object, rejectedFields: string[]}}
 */
export function mergeHumanized(original, humanized) {
  if (!isPlainObject(original)) return { merged: original, rejectedFields: [] };
  if (!isPlainObject(humanized)) return { merged: original, rejectedFields: [] };

  const outcomeNames = collectOutcomeNames(original);
  const rejectedFields = [];
  const merged = { ...original };

  for (const key of ['refinedQuestion', 'shortDescription', 'fullResolutionRules', 'edgeCases']) {
    if (typeof original[key] !== 'string') continue;
    const { value, kept } = adoptIfStable(original[key], humanized[key], outcomeNames);
    merged[key] = value;
    if (!kept && typeof humanized[key] === 'string' && humanized[key].trim()) {
      rejectedFields.push(key);
    }
  }

  for (const key of PRESERVED_TOP_LEVEL_FIELDS) {
    if (key in original) merged[key] = original[key];
  }

  if (Array.isArray(original.outcomes)) {
    const humanizedOutcomes = Array.isArray(humanized.outcomes) ? humanized.outcomes : [];
    merged.outcomes = original.outcomes.map((origOutcome, i) => {
      const h = humanizedOutcomes[i];
      if (!isPlainObject(h)) return origOutcome;

      const winResult = adoptIfStable(origOutcome.winCondition, h.winCondition, outcomeNames);
      if (!winResult.kept && typeof h.winCondition === 'string' && h.winCondition.trim()) {
        rejectedFields.push(`outcomes[${i}].winCondition`);
      }

      const critResult = adoptIfStable(origOutcome.resolutionCriteria, h.resolutionCriteria, outcomeNames);
      if (!critResult.kept && typeof h.resolutionCriteria === 'string' && h.resolutionCriteria.trim()) {
        rejectedFields.push(`outcomes[${i}].resolutionCriteria`);
      }

      return {
        ...origOutcome,
        winCondition: winResult.value,
        resolutionCriteria: critResult.value,
        // Outcome names are referenced by edgeCases — never rewrite.
        name: origOutcome.name,
      };
    });
  }

  return { merged, rejectedFields };
}

/**
 * Humanize the text fields of a finalized 42.space market JSON.
 *
 * @param {string} model
 * @param {Object} finalJson  Parsed JSON produced by the finalizer stage.
 * @param {{queryModel?: typeof queryModel}} [deps]  Test injection hook.
 * @returns {Promise<{
 *   humanizedJson: Object,
 *   usage: {promptTokens:number, completionTokens:number, totalTokens:number}|null,
 *   wallClockMs: number,
 *   logEntry: {level: 'info'|'warn'|'error', message: string},
 * }>}
 */
export async function humanizeFinalJson(model, finalJson, deps = {}) {
  const query = deps.queryModel || queryModel;

  // `{ raw: "..." }` is the fallback shape handleAccept stores when the
  // finalizer's response was unparseable — nothing structured to humanize.
  if (!isPlainObject(finalJson) || 'raw' in finalJson) {
    return {
      humanizedJson: finalJson,
      usage: null,
      wallClockMs: 0,
      logEntry: {
        level: 'info',
        message: 'Humanize skipped: finalizer output was not structured JSON.',
      },
    };
  }

  const started = Date.now();
  let result;
  try {
    result = await query(
      model,
      [
        { role: 'system', content: getSystemPrompt('humanizer') },
        { role: 'user', content: buildHumanizerPrompt(finalJson) },
      ],
      { temperature: 0.4 }
    );
  } catch (err) {
    return {
      humanizedJson: finalJson,
      usage: null,
      wallClockMs: Date.now() - started,
      logEntry: {
        level: 'warn',
        message: `Humanize failed: ${err?.message || 'unknown error'}`,
      },
    };
  }

  const parsed = tryParseJsonObject(result?.content);
  if (!parsed) {
    return {
      humanizedJson: finalJson,
      usage: result?.usage || null,
      wallClockMs: result?.wallClockMs || Date.now() - started,
      logEntry: {
        level: 'warn',
        message: 'Humanize skipped: model output was not valid JSON.',
      },
    };
  }

  const { merged, rejectedFields } = mergeHumanized(finalJson, parsed);

  const logEntry = rejectedFields.length > 0
    ? {
        level: 'warn',
        message: `Humanize applied with ${rejectedFields.length} field(s) rejected for structural drift: ${rejectedFields.join(', ')}.`,
      }
    : {
        level: 'info',
        message: 'Humanize applied to finalized market JSON.',
      };

  return {
    humanizedJson: merged,
    usage: result.usage,
    wallClockMs: result.wallClockMs || Date.now() - started,
    logEntry,
  };
}
