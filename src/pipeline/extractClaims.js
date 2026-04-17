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

/** Max completion tokens for claim extraction calls. */
const CLAIM_EXTRACTION_MAX_TOKENS = 8000;

/**
 * Best-effort parse of an LLM response to JSON. Models sometimes wrap JSON
 * in ```json fences or add a stray leading explanation; peel those off
 * before handing to JSON.parse.
 *
 * Returns `{ data, recovered }` where `recovered` is true when truncation
 * recovery was used (meaning some trailing claims were likely dropped).
 */
function tryParseJson(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const bracketed = candidate.match(/\[[\s\S]*\]/);
  const exact = bracketed ? bracketed[0] : candidate;
  try {
    return { data: JSON.parse(exact), recovered: false };
  } catch {
    // fall through to truncation recovery
  }

  // RECOVERY: the outer array is truncated mid-element. Scan once, tracking
  // quote/escape state so `}` inside a JSON string value is ignored. Record
  // positions where depth returns from 2 to 1 — those are end-of-element
  // boundaries in the top-level array — and try them from last to first.
  // This bounds parse attempts by the number of top-level objects rather
  // than every `}` character.
  const arrayStart = exact.indexOf('[');
  if (arrayStart === -1) return null;
  const src = exact.slice(arrayStart);

  const cuts = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (ch === '}' && depth === 1) cuts.push(i);
    }
  }

  for (let i = cuts.length - 1; i >= 0; i--) {
    const slice = src.slice(0, cuts[i] + 1).replace(/,\s*$/, '') + ']';
    try {
      return { data: JSON.parse(slice), recovered: true };
    } catch {
      // try an earlier cut
    }
  }

  return null;
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
      { temperature: 0.2, maxTokens: CLAIM_EXTRACTION_MAX_TOKENS }
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
  const validated1 = parsed1 && ClaimArraySchema.safeParse(parsed1.data);
  if (validated1 && validated1.success) {
    return {
      claims: validated1.data,
      usage: aggregate.usage,
      wallClockMs: aggregate.wallClockMs,
      logEntry: parsed1.recovered
        ? { level: 'warn', message: `Claim extractor output was truncated; recovered ${validated1.data.length} claims (some may have been dropped).` }
        : null,
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
      { temperature: 0.1, maxTokens: CLAIM_EXTRACTION_MAX_TOKENS }
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
  const validated2 = parsed2 && ClaimArraySchema.safeParse(parsed2.data);
  if (validated2 && validated2.success) {
    const retryNote = parsed2.recovered
      ? ` Output was truncated; recovered ${validated2.data.length} claims (some may have been dropped).`
      : '';
    return {
      claims: validated2.data,
      usage: aggregate.usage,
      wallClockMs: aggregate.wallClockMs,
      logEntry: {
        level: 'warn',
        message: `Claim extractor succeeded on strict retry (first pass was invalid JSON).${retryNote}`,
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
