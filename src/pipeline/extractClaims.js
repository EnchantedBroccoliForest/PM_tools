/**
 * Claim extraction pipeline.
 *
 * Wraps a single LLM pass that decomposes a draft into a flat list of atomic
 * Claim objects. Output is validated with zod; on the first parse failure we
 * retry once with a stricter "JSON only" prompt; on second failure we fall
 * back to an empty claim list and return a structured error so callers can
 * log it without crashing the UI.
 *
 * Later phases (verifiers, retrieval, routing) hang off of `claim.id`, so
 * every claim must carry a stable id. The prompt enforces the
 * `claim.<category>.<index>[.<subfield>]` naming convention; this module
 * does not synthesise ids — if the LLM produces a claim without one, it is
 * dropped at zod validation time.
 */

import { queryModel } from '../api/openrouter.js';
import {
  SYSTEM_PROMPTS,
  buildClaimExtractorPrompt,
  buildStrictClaimExtractorRetryPrompt,
} from '../constants/prompts.js';
import { ClaimArraySchema } from '../types/run.js';

/**
 * Best-effort parse of an LLM response to JSON. Models sometimes wrap JSON
 * in ```json fences or add a stray leading explanation; peel those off
 * before handing to JSON.parse.
 */
function tryParseJson(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  // Strip ```json ... ``` fences.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  // As a final salvage, clip to the outermost [ ... ] if there is leading prose.
  const bracketed = candidate.match(/\[[\s\S]*\]/);
  const exact = bracketed ? bracketed[0] : candidate;
  try {
    return JSON.parse(exact);
  } catch {
    // fall through to truncation recovery
  }

  // RECOVERY: if the model hit max_tokens, the JSON array may be truncated
  // mid-object. Find the last complete object and close the array.
  const arrayStart = candidate.indexOf('[');
  if (arrayStart === -1) return null;

  let truncated = candidate.slice(arrayStart);
  const lastCompleteObject = truncated.lastIndexOf('}');
  if (lastCompleteObject === -1) return null;

  let recovered = truncated.slice(0, lastCompleteObject + 1)
    .replace(/,\s*$/, ''); // remove trailing comma
  recovered += ']'; // close the array

  try {
    return JSON.parse(recovered);
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} ExtractClaimsResult
 * @property {import('../types/run').Claim[]} claims
 * @property {{promptTokens:number, completionTokens:number, totalTokens:number}} usage
 * @property {number} wallClockMs
 * @property {{level:'info'|'warn'|'error', message:string}|null} logEntry
 */

/**
 * Run claim extraction against a draft. Never throws — on any failure we
 * return an empty claims array plus a `logEntry` the caller should surface
 * via RUN_LOG so the failure is visible in the run trace but the UI stays
 * responsive.
 *
 * @param {string} model           OpenRouter model id
 * @param {string} draftContent    the draft text to decompose
 * @returns {Promise<ExtractClaimsResult>}
 */
export async function extractClaims(model, draftContent) {
  const aggregate = {
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    wallClockMs: 0,
  };

  const accumulate = (result) => {
    aggregate.usage.promptTokens += result.usage.promptTokens;
    aggregate.usage.completionTokens += result.usage.completionTokens;
    aggregate.usage.totalTokens += result.usage.totalTokens;
    aggregate.wallClockMs += result.wallClockMs;
  };

  // Attempt 1: standard extraction prompt.
  let rawResponse;
  try {
    const result = await queryModel(
      model,
      [
        { role: 'system', content: SYSTEM_PROMPTS.claimExtractor },
        { role: 'user', content: buildClaimExtractorPrompt(draftContent) },
      ],
      { temperature: 0.2, maxTokens: 8000 }
    );
    accumulate(result);
    rawResponse = result.content;
  } catch (err) {
    return {
      claims: [],
      usage: aggregate.usage,
      wallClockMs: aggregate.wallClockMs,
      logEntry: {
        level: 'error',
        message: `Claim extractor network/API failure: ${err.message || err}`,
      },
    };
  }

  const parsed1 = tryParseJson(rawResponse);
  const validated1 = parsed1 && ClaimArraySchema.safeParse(parsed1);
  if (validated1 && validated1.success) {
    return {
      claims: validated1.data,
      usage: aggregate.usage,
      wallClockMs: aggregate.wallClockMs,
      logEntry: null,
    };
  }

  // Attempt 2: stricter retry prompt.
  let retryResponse;
  try {
    const result = await queryModel(
      model,
      [
        { role: 'system', content: SYSTEM_PROMPTS.claimExtractor },
        { role: 'user', content: buildStrictClaimExtractorRetryPrompt(draftContent) },
      ],
      { temperature: 0.1, maxTokens: 8000 }
    );
    accumulate(result);
    retryResponse = result.content;
  } catch (err) {
    return {
      claims: [],
      usage: aggregate.usage,
      wallClockMs: aggregate.wallClockMs,
      logEntry: {
        level: 'error',
        message: `Claim extractor retry failed (network): ${err.message || err}`,
      },
    };
  }

  const parsed2 = tryParseJson(retryResponse);
  const validated2 = parsed2 && ClaimArraySchema.safeParse(parsed2);
  if (validated2 && validated2.success) {
    return {
      claims: validated2.data,
      usage: aggregate.usage,
      wallClockMs: aggregate.wallClockMs,
      logEntry: {
        level: 'warn',
        message: 'Claim extractor succeeded on strict retry (first pass was invalid JSON).',
      },
    };
  }

  // Both attempts failed. Return empty claims so the UI does not hard-crash.
  return {
    claims: [],
    usage: aggregate.usage,
    wallClockMs: aggregate.wallClockMs,
    logEntry: {
      level: 'error',
      message:
        'Claim extractor returned invalid JSON on both attempts; falling back to empty claim list. Downstream verifiers will skip claim-level checks for this draft.',
    },
  };
}
