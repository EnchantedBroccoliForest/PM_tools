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
import { ClaimSchema } from '../types/run.js';
import { tryParseJsonArray, createUsageAggregator } from './llmJson.js';

/** Max completion tokens for claim extraction calls. */
const CLAIM_EXTRACTION_MAX_TOKENS = 8000;

/**
 * Validate claims one-at-a-time so a single malformed entry doesn't force
 * us to drop the whole batch. Returns the kept claims plus a list of
 * dropped { index, reason } descriptors the caller can surface in the log.
 */
function validateClaimsIndividually(rawArray) {
  const kept = [];
  const dropped = [];
  const seen = new Set();
  if (!Array.isArray(rawArray)) return { kept, dropped };
  rawArray.forEach((candidate, i) => {
    const parsed = ClaimSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = issue?.path?.join('.') || '?';
      dropped.push({ index: i, reason: `${field}: ${issue?.message || 'invalid'}` });
      return;
    }
    if (seen.has(parsed.data.id)) {
      dropped.push({ index: i, reason: `duplicate id ${parsed.data.id}` });
      return;
    }
    seen.add(parsed.data.id);
    kept.push(parsed.data);
  });
  return { kept, dropped };
}

function formatDropWarning(dropped) {
  if (dropped.length === 0) return '';
  const sample = dropped.slice(0, 3).map((d) => `#${d.index} (${d.reason})`).join(', ');
  const suffix = dropped.length > 3 ? `, +${dropped.length - 3} more` : '';
  return ` Dropped ${dropped.length} invalid claim(s): ${sample}${suffix}.`;
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
  const { aggregate, accumulate } = createUsageAggregator();

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

  const parsed1 = tryParseJsonArray(rawResponse);
  if (parsed1) {
    const { kept, dropped } = validateClaimsIndividually(parsed1.data);
    if (kept.length > 0) {
      const truncationNote = parsed1.recovered
        ? ` Output was truncated; some trailing claims may have been lost.`
        : '';
      const dropNote = formatDropWarning(dropped);
      const logEntry =
        parsed1.recovered || dropped.length > 0
          ? { level: 'warn', message: `Claim extractor kept ${kept.length} claim(s).${truncationNote}${dropNote}` }
          : null;
      return { claims: kept, usage: aggregate.usage, wallClockMs: aggregate.wallClockMs, logEntry };
    }
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

  const parsed2 = tryParseJsonArray(retryResponse);
  if (parsed2) {
    const { kept, dropped } = validateClaimsIndividually(parsed2.data);
    if (kept.length > 0) {
      const retryNote = parsed2.recovered
        ? ` Output was truncated; some trailing claims may have been lost.`
        : '';
      const dropNote = formatDropWarning(dropped);
      return {
        claims: kept,
        usage: aggregate.usage,
        wallClockMs: aggregate.wallClockMs,
        logEntry: {
          level: 'warn',
          message: `Claim extractor succeeded on strict retry with ${kept.length} claim(s) (first pass was invalid).${retryNote}${dropNote}`,
        },
      };
    }
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
