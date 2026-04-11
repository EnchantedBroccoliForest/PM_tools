/**
 * Claim verification pipeline (Phase 3).
 *
 * Produces a `Verification` record for each claim in the current run. Two
 * verifiers run in sequence:
 *
 *   1. Structural verifier (pure client, no LLM). Checks category-specific
 *      structural invariants:
 *        - timestamp: must contain an ISO-8601-ish date or HH:MM time
 *        - source:    must contain an http(s) URL
 *        - threshold: must contain a numeric value
 *        - question:  must be non-empty
 *      These cheap checks catch extractor garbage before we waste LLM
 *      budget on entailment.
 *
 *   2. Batched draft-entailment verifier (one LLM call per run). For each
 *      claim, the model decides whether the draft text itself entails the
 *      claim, contradicts it, fails to cover it, or is not applicable.
 *      This catches extractor hallucinations — claims the model invented
 *      that don't actually appear in the draft.
 *
 * The two verifier outputs are merged into a final verdict per claim:
 *   - hard_fail: structural check failed OR entailment is contradicted
 *   - soft_fail: entailment is not_covered (extraction drift) but the
 *                claim is at least structurally valid
 *   - pass:      entailment is entailed or not_applicable
 *
 * Evidence-based consistency scoring (SelfCheckGPT-style multi-sample) is
 * deliberately deferred to Phase 4 — without retrieved sources the signal
 * is weaker than re-checking against the draft, and doing it right requires
 * the evidence module this phase does not yet provide.
 *
 * The orchestrator never throws. LLM failures degrade to structural-only
 * verifications with a structured logEntry the caller should surface via
 * RUN_LOG so the failure is visible in the run trace.
 */

import { queryModel } from '../api/openrouter.js';
import {
  SYSTEM_PROMPTS,
  buildBatchEntailmentPrompt,
  buildStrictBatchEntailmentRetryPrompt,
} from '../constants/prompts.js';
import { BatchEntailmentResponseSchema } from '../types/run.js';

/** Shared JSON salvage helper — same logic as other pipelines. */
function tryParseJson(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const bracketed = candidate.match(/\[[\s\S]*\]/);
  const final = bracketed ? bracketed[0] : candidate;
  try {
    return JSON.parse(final);
  } catch {
    return null;
  }
}

/**
 * Structural verifier. Pure function, no I/O. Returns a partially-filled
 * Verification record that the entailment verifier then layers on top of.
 *
 * `citationResolves` is boolean-only (the Run schema does not allow null),
 * so we use `true` as a "vacuously resolves" default for non-source claims
 * and `false` for source claims with no URL. Phase 4 will replace this
 * with a real fetch() once we have the evidence module.
 *
 * @param {import('../types/run').Claim} claim
 * @returns {import('../types/run').Verification}
 */
export function structuralCheck(claim) {
  const base = {
    claimId: claim.id,
    entailment: 'not_applicable', // filled in by entailment pass
    consistencyScore: null,
    toolOutput: null,
    citationResolves: true,
    verdict: 'pass',
  };

  switch (claim.category) {
    case 'timestamp': {
      // Require an ISO-8601-ish date OR a time-of-day pattern. We allow
      // both because start/end claims can legitimately be just a date.
      const hasIsoDate = /\d{4}-\d{2}-\d{2}/.test(claim.text);
      const hasTime = /\d{1,2}:\d{2}/.test(claim.text);
      if (!hasIsoDate && !hasTime) {
        return {
          ...base,
          toolOutput: 'Structural: no ISO date or HH:MM pattern found.',
          verdict: 'hard_fail',
        };
      }
      return base;
    }
    case 'source': {
      // Require an http(s) URL somewhere in the text.
      const hasUrl = /https?:\/\/[^\s)]+/.test(claim.text);
      if (!hasUrl) {
        return {
          ...base,
          citationResolves: false,
          toolOutput: 'Structural: source claim contains no http(s) URL.',
          verdict: 'hard_fail',
        };
      }
      return base;
    }
    case 'threshold': {
      // Require at least one digit. Thresholds without numbers are almost
      // always extraction errors, but we treat this as soft_fail rather
      // than hard_fail in case the threshold is expressed verbally
      // ("majority", "plurality") and the extractor categorised generously.
      const hasNumber = /\d/.test(claim.text);
      if (!hasNumber) {
        return {
          ...base,
          toolOutput: 'Structural: threshold claim contains no numeric value.',
          verdict: 'soft_fail',
        };
      }
      return base;
    }
    case 'question': {
      if (!claim.text || claim.text.trim().length === 0) {
        return {
          ...base,
          toolOutput: 'Structural: question claim is empty.',
          verdict: 'hard_fail',
        };
      }
      return base;
    }
    default:
      return base;
  }
}

/**
 * Merge the entailment result from the LLM into a structural-only
 * Verification. Structural failures trump entailment — we never upgrade a
 * hard_fail to a pass just because the LLM thinks the claim is entailed.
 *
 * @param {import('../types/run').Verification} structural
 * @param {{entailment:string, rationale:string}|null} entailmentResult
 * @returns {import('../types/run').Verification}
 */
function mergeVerdict(structural, entailmentResult) {
  const entailment = entailmentResult?.entailment || 'not_covered';
  const entailmentRationale = entailmentResult?.rationale || '';

  // Compose the toolOutput: structural message (if any) + entailment
  // rationale, so the run trace surfaces both signals in one field.
  const toolOutputParts = [];
  if (structural.toolOutput) toolOutputParts.push(structural.toolOutput);
  if (entailmentRationale) toolOutputParts.push(`Entailment: ${entailmentRationale}`);
  const toolOutput = toolOutputParts.length > 0 ? toolOutputParts.join(' | ') : null;

  // Structural hard_fail is terminal.
  if (structural.verdict === 'hard_fail') {
    return { ...structural, entailment, toolOutput };
  }

  // Layer entailment on top of the structural verdict. Contradicted is
  // always hard_fail; not_covered degrades pass → soft_fail but leaves
  // an existing soft_fail alone.
  let verdict = structural.verdict;
  if (entailment === 'contradicted') {
    verdict = 'hard_fail';
  } else if (entailment === 'not_covered' && verdict === 'pass') {
    verdict = 'soft_fail';
  }

  return { ...structural, entailment, toolOutput, verdict };
}

/**
 * @typedef {Object} VerifyClaimsResult
 * @property {import('../types/run').Verification[]} verifications
 * @property {{promptTokens:number, completionTokens:number, totalTokens:number}} usage
 * @property {number} wallClockMs
 * @property {{level:'info'|'warn'|'error', message:string}|null} logEntry
 */

/**
 * Run the full verification pipeline against a claim set + draft. Never
 * throws; failures return structural-only verdicts and a logEntry.
 *
 * @param {import('../types/run').Claim[]} claims
 * @param {string} draftContent
 * @param {string} verifierModelId   OpenRouter model id for the entailment pass
 * @returns {Promise<VerifyClaimsResult>}
 */
export async function verifyClaims(claims, draftContent, verifierModelId) {
  const emptyUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

  if (!claims || claims.length === 0) {
    return {
      verifications: [],
      usage: emptyUsage,
      wallClockMs: 0,
      logEntry: {
        level: 'info',
        message: 'Verification skipped: no claims extracted yet.',
      },
    };
  }

  // Structural pass — always runs, always succeeds.
  const structuralById = new Map();
  for (const c of claims) {
    structuralById.set(c.id, structuralCheck(c));
  }

  // Batched entailment pass.
  const aggregate = { usage: { ...emptyUsage }, wallClockMs: 0 };
  const accumulate = (r) => {
    aggregate.usage.promptTokens += r.usage.promptTokens;
    aggregate.usage.completionTokens += r.usage.completionTokens;
    aggregate.usage.totalTokens += r.usage.totalTokens;
    aggregate.wallClockMs += r.wallClockMs;
  };

  const buildStructuralOnlyFallback = (logEntry) => ({
    verifications: claims.map((c) => {
      const s = structuralById.get(c.id);
      return { ...s, entailment: 'not_covered' };
    }),
    usage: aggregate.usage,
    wallClockMs: aggregate.wallClockMs,
    logEntry,
  });

  let raw;
  try {
    const r = await queryModel(
      verifierModelId,
      [
        { role: 'system', content: SYSTEM_PROMPTS.entailmentVerifier },
        { role: 'user', content: buildBatchEntailmentPrompt(claims, draftContent) },
      ],
      { temperature: 0.1, maxTokens: 3000 }
    );
    accumulate(r);
    raw = r.content;
  } catch (err) {
    return buildStructuralOnlyFallback({
      level: 'error',
      message: `Entailment verifier network/API failure: ${err.message || err}`,
    });
  }

  let parsed = tryParseJson(raw);
  let validated = parsed && BatchEntailmentResponseSchema.safeParse(parsed);

  // Attempt 2 — strict retry
  if (!validated || !validated.success) {
    try {
      const r2 = await queryModel(
        verifierModelId,
        [
          { role: 'system', content: SYSTEM_PROMPTS.entailmentVerifier },
          {
            role: 'user',
            content: buildStrictBatchEntailmentRetryPrompt(claims, draftContent),
          },
        ],
        { temperature: 0.05, maxTokens: 3000 }
      );
      accumulate(r2);
      parsed = tryParseJson(r2.content);
      validated = parsed && BatchEntailmentResponseSchema.safeParse(parsed);
    } catch (err) {
      return buildStructuralOnlyFallback({
        level: 'error',
        message: `Entailment verifier retry failed: ${err.message || err}`,
      });
    }
  }

  if (!validated || !validated.success) {
    return buildStructuralOnlyFallback({
      level: 'error',
      message:
        'Entailment verifier returned invalid JSON on both attempts; verifications limited to structural checks.',
    });
  }

  // Map entailment results by claim id for fast lookup. Drop entries that
  // reference ids not present in the claim set — this guards against a
  // verifier that invents or reorders ids.
  const claimIds = new Set(claims.map((c) => c.id));
  const entailmentById = new Map();
  let droppedCount = 0;
  for (const r of validated.data) {
    if (claimIds.has(r.id)) {
      entailmentById.set(r.id, r);
    } else {
      droppedCount += 1;
    }
  }

  // Final merge — produce one Verification per claim, in claim order.
  const verifications = claims.map((c) => {
    const structural = structuralById.get(c.id);
    const entailment = entailmentById.get(c.id) || null;
    return mergeVerdict(structural, entailment);
  });

  const missingCount = claims.length - entailmentById.size;
  let logEntry = null;
  if (droppedCount > 0 || missingCount > 0) {
    const parts = [];
    if (droppedCount > 0) parts.push(`${droppedCount} unknown claim id(s) dropped`);
    if (missingCount > 0) parts.push(`${missingCount} claim(s) missing from verifier response (treated as not_covered)`);
    logEntry = {
      level: 'warn',
      message: `Entailment verifier drift: ${parts.join('; ')}.`,
    };
  }

  return {
    verifications,
    usage: aggregate.usage,
    wallClockMs: aggregate.wallClockMs,
    logEntry,
  };
}
