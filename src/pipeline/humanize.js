/**
 * Post-finalize humanizer pass.
 *
 * Runs silently after handleAccept's finalizer call: rewrites the prose text
 * fields of the finalized market JSON to remove AI-writing tells, while
 * preserving structural fields (outcome names, URLs, ISO timestamps, the
 * overall JSON shape). Failures never bubble up — on any error the caller
 * gets the un-humanized JSON back so the Finalize flow cannot be blocked by
 * a flaky extra LLM call.
 *
 * Structural fields are restored from the ORIGINAL JSON after the model
 * responds. The humanizer prompt tells the model not to touch them, and
 * this module enforces it defensively — so a model that drifts on an
 * outcome name cannot strand edge-case references that point to it.
 */

import { queryModel } from '../api/openrouter';
import { SYSTEM_PROMPTS, buildHumanizerPrompt } from '../constants/prompts';
import { tryParseJsonObject } from './llmJson';

// Fields the humanizer is NOT allowed to modify. Restored from the original
// after parsing the model's response.
const PRESERVED_TOP_LEVEL_FIELDS = ['marketStartTimeUTC', 'marketEndTimeUTC'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Merge humanized text back into the original JSON. Any structural field is
 * taken from the original; any string field in the humanized response that is
 * missing, empty, or the wrong type falls back to the original value so
 * single-field drift never corrupts the downstream Outcome Token spawn.
 */
export function mergeHumanized(original, humanized) {
  if (!isPlainObject(original)) return original;
  if (!isPlainObject(humanized)) return original;

  const merged = { ...original };

  for (const key of ['refinedQuestion', 'shortDescription', 'fullResolutionRules', 'edgeCases']) {
    const v = humanized[key];
    if (typeof v === 'string' && v.trim()) merged[key] = v;
  }

  for (const key of PRESERVED_TOP_LEVEL_FIELDS) {
    if (key in original) merged[key] = original[key];
  }

  if (Array.isArray(original.outcomes)) {
    const humanizedOutcomes = Array.isArray(humanized.outcomes) ? humanized.outcomes : [];
    merged.outcomes = original.outcomes.map((origOutcome, i) => {
      const h = humanizedOutcomes[i];
      if (!isPlainObject(h)) return origOutcome;
      return {
        ...origOutcome,
        winCondition:
          typeof h.winCondition === 'string' && h.winCondition.trim()
            ? h.winCondition
            : origOutcome.winCondition,
        resolutionCriteria:
          typeof h.resolutionCriteria === 'string' && h.resolutionCriteria.trim()
            ? h.resolutionCriteria
            : origOutcome.resolutionCriteria,
        // Outcome names are referenced by edgeCases — never rewrite.
        name: origOutcome.name,
      };
    });
  }

  return merged;
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
        { role: 'system', content: SYSTEM_PROMPTS.humanizer },
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

  return {
    humanizedJson: mergeHumanized(finalJson, parsed),
    usage: result.usage,
    wallClockMs: result.wallClockMs || Date.now() - started,
    logEntry: {
      level: 'info',
      message: 'Humanize applied to finalized market JSON.',
    },
  };
}
