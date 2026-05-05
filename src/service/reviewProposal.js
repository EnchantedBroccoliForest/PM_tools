import { extractClaims } from '../pipeline/extractClaims.js';
import { verifyClaims, structuralCheck } from '../pipeline/verify.js';
import { gatherEvidence } from '../pipeline/gatherEvidence.js';
import { routeClaims } from '../pipeline/route.js';
import { runStructuredReviewsParallel } from '../pipeline/structuredReview.js';
import { aggregate } from '../pipeline/aggregate.js';
import { RIGOR_RUBRIC } from '../constants/rubric.js';
import { createRun } from '../types/run.js';
import { assignShortIds } from '../report/shortIds.js';
import {
  DEFAULT_DRAFT_MODEL,
  DEFAULT_REVIEWER_MODELS,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_OPTIONS,
} from '../defaults.js';

export class ReviewRequestError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ReviewRequestError';
    this.statusCode = statusCode;
  }
}

const VALID_RIGOR = new Set(['machine', 'human']);
const VALID_AGGREGATION = new Set(['majority', 'unanimity', 'judge']);
const VALID_EVIDENCE = new Set(['none', 'retrieval']);
const VALID_VERIFIERS = new Set(['off', 'partial', 'full']);

function createCostTracker() {
  const byStage = {};
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let wallClockMs = 0;
  return {
    record(stage, result) {
      if (!result) return;
      const tokensIn = result.usage?.promptTokens || 0;
      const tokensOut = result.usage?.completionTokens || 0;
      const ms = result.wallClockMs || 0;
      totalTokensIn += tokensIn;
      totalTokensOut += tokensOut;
      wallClockMs += ms;
      byStage[stage] = (byStage[stage] || 0) + tokensIn + tokensOut;
    },
    snapshot() {
      return { totalTokensIn, totalTokensOut, wallClockMs, byStage: { ...byStage } };
    },
  };
}

function normalizeReferences(references) {
  if (Array.isArray(references)) {
    return references.map((ref) => String(ref).trim()).filter(Boolean).join('\n');
  }
  if (references == null) return '';
  return String(references);
}

function normalizeReviewers(raw) {
  if (!raw) return DEFAULT_REVIEWER_MODELS;
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_REVIEWER_MODELS;
  return raw
    .map((item) => {
      if (typeof item === 'string') return { id: item, name: item };
      if (item && typeof item.id === 'string') {
        return { id: item.id, name: item.name || item.id };
      }
      return null;
    })
    .filter(Boolean);
}

function assertEnum(name, value, valid) {
  if (!valid.has(value)) {
    throw new ReviewRequestError(`${name} must be one of ${[...valid].join(', ')}`);
  }
}

function log(run, stage, level, message, callbacks) {
  const entry = { stage, level, message, ts: Date.now() };
  run.log.push(entry);
  callbacks?.onLog?.(entry);
}

function buildSummary(run, reviews) {
  const criticisms = run.criticisms || [];
  const bySeverity = criticisms.reduce((acc, criticism) => {
    acc[criticism.severity] = (acc[criticism.severity] || 0) + 1;
    return acc;
  }, {});
  return {
    overall: run.aggregation?.overall || 'needs_escalation',
    routing: run.routing?.overall || 'clean',
    reviewCount: reviews.filter((review) => review.reviewProse).length,
    claimCount: run.claims?.length || 0,
    criticismCount: criticisms.length,
    criticismCountBySeverity: bySeverity,
    blockingCriticisms: criticisms.filter((criticism) => criticism.severity === 'blocker'),
  };
}

/**
 * Review an existing proposal draft without running the drafter/update/finalize
 * stages. This is the service-oriented entry point for callers that already
 * have market proposal text and want PM_tools critique via HTTP.
 *
 * @param {object} request
 * @param {string} request.proposalText
 * @param {string|string[]} [request.references]
 * @param {object} [request.models]
 * @param {object} [request.options]
 * @param {object} [runtime]
 * @param {typeof fetch} [runtime.fetchImpl]
 * @param {AbortSignal} [runtime.signal]
 * @param {object} [runtime.callbacks]
 */
export async function reviewProposal(request, runtime = {}) {
  const proposalText = request?.proposalText || request?.draft || request?.text;
  if (typeof proposalText !== 'string' || proposalText.trim().length === 0) {
    throw new ReviewRequestError('proposalText is required and must be a non-empty string');
  }

  const rigor = request?.rigor || request?.input?.rigor || 'machine';
  assertEnum('rigor', rigor, VALID_RIGOR);

  const optionsRaw = request?.options || {};
  const aggregation = optionsRaw.aggregation || DEFAULT_OPTIONS.aggregation;
  const evidenceMode = optionsRaw.evidence || DEFAULT_OPTIONS.evidence;
  const verifiers = optionsRaw.verifiers || DEFAULT_OPTIONS.verifiers;
  assertEnum('options.aggregation', aggregation, VALID_AGGREGATION);
  assertEnum('options.evidence', evidenceMode, VALID_EVIDENCE);
  assertEnum('options.verifiers', verifiers, VALID_VERIFIERS);

  const modelsRaw = request?.models || {};
  const models = {
    drafter: modelsRaw.drafter || modelsRaw.verifier || DEFAULT_DRAFT_MODEL,
    reviewers: normalizeReviewers(modelsRaw.reviewers || request?.reviewers),
    judge: modelsRaw.judge || DEFAULT_JUDGE_MODEL,
  };

  const references = normalizeReferences(request?.references || request?.input?.references);
  const run = createRun({
    question: request?.question || request?.input?.question || '(existing proposal)',
    startDate: request?.startDate || request?.input?.startDate || '',
    endDate: request?.endDate || request?.input?.endDate || '',
    references,
    numberOfOutcomes: request?.numberOfOutcomes || request?.input?.numberOfOutcomes || '',
    rigor,
  });
  const callbacks = runtime.callbacks;
  const cost = createCostTracker();

  const checkAbort = () => {
    if (!runtime.signal?.aborted) return;
    throw new ReviewRequestError('Review request aborted by caller', 499);
  };

  run.drafts.push({
    model: request?.source || 'user/proposal',
    content: proposalText,
    timestamp: Date.now(),
    kind: 'initial',
  });

  let structuredReviews = [];

  try {
    checkAbort();
    callbacks?.onStageStart?.('claims');
    const claimResult = await extractClaims(models.drafter, proposalText);
    cost.record('claims', claimResult);
    run.claims = claimResult.claims;
    if (claimResult.logEntry) {
      log(run, 'claims', claimResult.logEntry.level, claimResult.logEntry.message, callbacks);
    }
    callbacks?.onStageEnd?.('claims', claimResult);

    checkAbort();
    callbacks?.onStageStart?.('verify');
    if (verifiers === 'off') {
      run.verification = [];
      log(run, 'verify', 'info', 'Verification skipped (verifiers=off).', callbacks);
    } else if (verifiers === 'partial') {
      run.verification = run.claims.map((claim) => ({
        ...structuralCheck(claim),
        entailment: 'not_applicable',
      }));
      log(run, 'verify', 'info', `Verification structural-only (${run.verification.length} claim(s)).`, callbacks);
    } else {
      const verifyResult = await verifyClaims(run.claims, proposalText, models.drafter, rigor);
      cost.record('verify', verifyResult);
      run.verification = verifyResult.verifications;
      if (verifyResult.logEntry) {
        log(run, 'verify', verifyResult.logEntry.level, verifyResult.logEntry.message, callbacks);
      }
    }
    callbacks?.onStageEnd?.('verify', run.verification);

    checkAbort();
    callbacks?.onStageStart?.('evidence');
    if (evidenceMode === 'none') {
      run.evidence = [];
      log(run, 'evidence', 'info', 'Evidence gathering skipped (evidence=none).', callbacks);
    } else {
      const evidenceResult = await gatherEvidence({
        references,
        claims: run.claims,
        verifications: run.verification,
        fetchImpl: runtime.fetchImpl,
        timeoutMs: optionsRaw.evidenceTimeoutMs || 3000,
      });
      cost.record('evidence', { usage: null, wallClockMs: evidenceResult.wallClockMs });
      run.evidence = evidenceResult.evidence;
      run.verification = evidenceResult.updatedVerifications;
      if (evidenceResult.logEntry) {
        log(run, 'evidence', evidenceResult.logEntry.level, evidenceResult.logEntry.message, callbacks);
      }
    }
    callbacks?.onStageEnd?.('evidence', run.evidence);

    run.routing = routeClaims({
      claims: run.claims,
      verifications: run.verification,
      criticisms: run.criticisms,
      evidence: run.evidence,
    });

    checkAbort();
    callbacks?.onStageStart?.('review');
    structuredReviews = await runStructuredReviewsParallel(
      models.reviewers,
      proposalText,
      RIGOR_RUBRIC,
      run.input.numberOfOutcomes || '',
      rigor,
    );
    for (const review of structuredReviews) {
      if (review.usage) cost.record('review', { usage: review.usage, wallClockMs: review.wallClockMs });
      if (review.logEntry) {
        log(run, 'review', review.logEntry.level, review.logEntry.message, callbacks);
      }
    }
    const successfulReviews = structuredReviews.filter((review) => review.reviewProse !== null);
    if (successfulReviews.length === 0) {
      log(run, 'review', 'error', 'All structured reviewers failed.', callbacks);
      run.status = 'error';
    } else {
      run.criticisms = successfulReviews.flatMap((review) => review.criticisms);
      const allVotes = successfulReviews.flatMap((review) => review.rubricVotes);
      const judgeModel = aggregation === 'judge' ? models.judge : undefined;
      const aggregationResult = await aggregate(aggregation, RIGOR_RUBRIC, allVotes, judgeModel, rigor);
      if (aggregationResult.usage && aggregationResult.usage.totalTokens > 0) {
        cost.record('aggregation', {
          usage: aggregationResult.usage,
          wallClockMs: aggregationResult.wallClockMs,
        });
      }
      if (aggregationResult.logEntry) {
        log(run, 'aggregation', aggregationResult.logEntry.level, aggregationResult.logEntry.message, callbacks);
      }
      run.aggregation = aggregationResult.aggregation;
      run.routing = routeClaims({
        claims: run.claims,
        verifications: run.verification,
        criticisms: run.criticisms,
        evidence: run.evidence,
      });
      run.status = 'partial';
    }
    callbacks?.onStageEnd?.('review', structuredReviews);
  } catch (err) {
    if (err instanceof ReviewRequestError) throw err;
    log(run, 'service', 'error', `Review failed: ${err.message || err}`, callbacks);
    run.status = 'error';
  }

  run.cost = cost.snapshot();
  assignShortIds(run);

  const reviews = structuredReviews.map((review) => ({
    model: review.model,
    modelName: review.modelName,
    reviewProse: review.reviewProse,
    rubricVotes: review.rubricVotes,
    criticisms: review.criticisms,
    error: review.reviewProse === null ? review.logEntry?.message || 'Reviewer failed' : null,
  }));

  return {
    status: run.status === 'error' ? 'error' : 'reviewed',
    summary: buildSummary(run, reviews),
    reviews,
    run,
  };
}
