import { queryModel } from '../api/openrouter.js';
import { buildMarketQuestionTitleRepairPrompt } from '../constants/prompts.js';
import { tryParseJsonObject } from './llmJson.js';
import { validateMarketQuestionTitle } from '../util/marketQuestionTitle.js';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate and, when needed, repair only finalJson.refinedQuestion.
 *
 * This keeps the market title human-readable without letting the LLM mutate
 * outcomes, resolver rules, timestamps, or edge-case mappings after finalize.
 */
export async function repairMarketQuestionTitle(model, finalJson, rigor = 'machine', deps = {}) {
  if (!isPlainObject(finalJson) || 'raw' in finalJson) {
    return {
      finalJson,
      repaired: false,
      usage: null,
      wallClockMs: 0,
      logEntry: {
        level: 'info',
        message: 'Market question title check skipped: finalizer output was not structured JSON.',
      },
    };
  }

  const initial = validateMarketQuestionTitle(finalJson.refinedQuestion, rigor);
  if (initial.valid) {
    return {
      finalJson: {
        ...finalJson,
        refinedQuestion: initial.normalized,
      },
      repaired: false,
      usage: null,
      wallClockMs: 0,
      logEntry: {
        level: 'info',
        message: 'Market question title passed readability budget.',
      },
    };
  }

  const query = deps.queryModel || queryModel;
  const started = Date.now();
  let result;
  try {
    result = await query(
      model,
      [
        {
          role: 'system',
          content: 'You rewrite market titles only. Output strictly valid JSON and preserve every field not explicitly requested by the user.',
        },
        {
          role: 'user',
          content: buildMarketQuestionTitleRepairPrompt(finalJson, rigor),
        },
      ],
      { temperature: 0.2, maxTokens: 500 },
    );
  } catch (err) {
    return {
      finalJson,
      repaired: false,
      usage: null,
      wallClockMs: Date.now() - started,
      logEntry: {
        level: 'warn',
        message: `Market question title repair failed: ${err?.message || 'unknown error'}`,
      },
    };
  }

  const parsed = tryParseJsonObject(result?.content);
  const candidate = parsed?.refinedQuestion;
  const repaired = validateMarketQuestionTitle(candidate, rigor);

  if (!repaired.valid) {
    return {
      finalJson,
      repaired: false,
      usage: result?.usage || null,
      wallClockMs: result?.wallClockMs || Date.now() - started,
      logEntry: {
        level: 'warn',
        message: `Market question title repair rejected: ${repaired.reasons.join('; ') || 'invalid response'}. Original reasons: ${initial.reasons.join('; ')}.`,
      },
    };
  }

  return {
    finalJson: {
      ...finalJson,
      refinedQuestion: repaired.normalized,
    },
    repaired: true,
    usage: result.usage,
    wallClockMs: result.wallClockMs || Date.now() - started,
    logEntry: {
      level: 'info',
      message: `Market question title repaired: ${initial.reasons.join('; ')}.`,
    },
  };
}
