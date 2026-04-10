/**
 * Pipeline orchestrator for the Phase 6 eval harness.
 *
 * This module runs the full PM_tools pipeline (draft → extract claims →
 * verify → gather evidence → route → review → aggregate → update → risk
 * → finalize) against a fixture, end-to-end, without the React UI. It
 * imports the real pipeline modules from `src/pipeline/**` so verifier,
 * aggregator, and routing logic run exactly as they do in production;
 * only the LLM client and URL-reachability fetch are mocked.
 *
 * The harness is intentionally a single sequential function rather than
 * a reducer rewrite: the React App's handlers interleave dispatches and
 * derived state, which is hard to reproduce outside React. A flat
 * orchestrator is easier to read, easier to ablate, and easier to reason
 * about when you want to know why a metric regressed.
 *
 * Ablation flags (passed in the `ablation` arg):
 *   - aggregation: 'majority' | 'unanimity' | 'judge'
 *   - escalation:  'always' | 'selective'
 *        'always'    → always run the full review + aggregation + debate path
 *        'selective' → skip the review stage when the claim set is clean
 *                      (no hard_fails, no contradicted, no failing citations)
 *   - evidence:    'none' | 'retrieval' | 'retrieval+debate'
 *        'none'      → skip gatherEvidence
 *        'retrieval' → run gatherEvidence with the mock fetch
 *        'retrieval+debate' → same as retrieval but marks the run as
 *                             eligible for a second review round
 *                             (debate) when routing returns 'blocked'
 *   - verifiers:   'off' | 'partial' | 'full'
 *        'off'     → no verification at all (Verification[] stays empty)
 *        'partial' → structural only (no LLM entailment call)
 *        'full'    → structural + LLM entailment
 *
 * The harness decides whether Accept is "allowed" by consulting the
 * same gates the real handleAccept consults: early-resolution risk,
 * routing overall, and (added in Phase 3) verification hard_fails.
 *
 * Returns a FixtureResult bundling the Run artifact plus fixture
 * metadata and a per-stage timing map so `metrics.js` can compute
 * summaries without re-walking the Run.
 */

import { installQueryModel, resetQueryModel, queryModel } from '../src/api/openrouter.js';
import {
  SYSTEM_PROMPTS,
  buildDraftPrompt,
  buildUpdatePrompt,
  buildRoutingFocusBlock,
  buildFinalizePrompt,
  buildEarlyResolutionPrompt,
} from '../src/constants/prompts.js';
import { extractClaims } from '../src/pipeline/extractClaims.js';
import { verifyClaims, structuralCheck } from '../src/pipeline/verify.js';
import { gatherEvidence } from '../src/pipeline/gatherEvidence.js';
import { routeClaims } from '../src/pipeline/route.js';
import { runStructuredReviewsParallel } from '../src/pipeline/structuredReview.js';
import { aggregate } from '../src/pipeline/aggregate.js';
import { RIGOR_RUBRIC } from '../src/constants/rubric.js';
import { createRun } from '../src/types/run.js';
import { createMockQueryModel, createMockFetch } from './mockApi.js';

// --- Constants the harness uses when constructing pipeline inputs --------

const FIXTURE_DRAFT_MODEL = 'mock/drafter';
const FIXTURE_REVIEWERS = [
  { id: 'mock/reviewer-a', name: 'Mock Reviewer A' },
  { id: 'mock/reviewer-b', name: 'Mock Reviewer B' },
  { id: 'mock/reviewer-c', name: 'Mock Reviewer C' },
];
const FIXTURE_JUDGE_MODEL = 'mock/judge';

// --- Cost-accounting helpers --------------------------------------------

function createCostTracker() {
  const byStage = {};
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let wallClockMs = 0;
  return {
    record(stage, result) {
      if (!result) return;
      const tokensIn = Number(result.usage?.promptTokens) || 0;
      const tokensOut = Number(result.usage?.completionTokens) || 0;
      const ms = Number(result.wallClockMs) || 0;
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

// --- Pipeline sub-stages -------------------------------------------------

/**
 * Run extraction + verification + evidence + routing for a draft and fold
 * the results into the Run artifact. Mirrors `runClaimExtractorAndRecord`
 * from `src/App.jsx` but with ablation knobs and no React dispatches.
 */
async function runClaimPipeline(run, draftText, ablation, mockFetch, cost) {
  // 1. Claim extraction.
  const claimResult = await extractClaims(FIXTURE_DRAFT_MODEL, draftText);
  cost.record('claims', claimResult);
  if (claimResult.logEntry) {
    run.log.push({
      stage: 'claims',
      level: claimResult.logEntry.level,
      message: claimResult.logEntry.message,
      ts: Date.now(),
    });
  }
  run.claims = claimResult.claims;

  if (run.claims.length === 0) {
    // Nothing to verify / route. Match the UI's behaviour exactly.
    run.verification = [];
    run.evidence = [];
    run.routing = routeClaims({ claims: [], verifications: [], criticisms: run.criticisms || [] });
    return;
  }

  // 2. Verification. Three modes, gated on the ablation flag.
  let verifications = [];
  if (ablation.verifiers === 'off') {
    verifications = [];
    run.log.push({
      stage: 'verify',
      level: 'info',
      message: 'Verification skipped (ablation.verifiers=off).',
      ts: Date.now(),
    });
  } else if (ablation.verifiers === 'partial') {
    // Structural only — no LLM entailment call.
    verifications = run.claims.map((c) => ({ ...structuralCheck(c), entailment: 'not_applicable' }));
    run.log.push({
      stage: 'verify',
      level: 'info',
      message: `Verification structural-only (${verifications.length} claim(s)).`,
      ts: Date.now(),
    });
  } else {
    // 'full' — structural + LLM entailment.
    const vResult = await verifyClaims(run.claims, draftText, FIXTURE_DRAFT_MODEL);
    cost.record('verify', vResult);
    verifications = vResult.verifications;
    if (vResult.logEntry) {
      run.log.push({
        stage: 'verify',
        level: vResult.logEntry.level,
        message: vResult.logEntry.message,
        ts: Date.now(),
      });
    }
  }
  run.verification = verifications;

  // 3. Evidence gathering. `none` skips the whole pass.
  if (ablation.evidence === 'none') {
    run.evidence = [];
    run.log.push({
      stage: 'evidence',
      level: 'info',
      message: 'Evidence gathering skipped (ablation.evidence=none).',
      ts: Date.now(),
    });
  } else {
    const eResult = await gatherEvidence({
      references: run.input.references,
      claims: run.claims,
      verifications: run.verification,
      fetchImpl: mockFetch,
      timeoutMs: 1000,
    });
    cost.record('evidence', { usage: null, wallClockMs: eResult.wallClockMs });
    run.evidence = eResult.evidence;
    run.verification = eResult.updatedVerifications;
    if (eResult.logEntry) {
      run.log.push({
        stage: 'evidence',
        level: eResult.logEntry.level,
        message: eResult.logEntry.message,
        ts: Date.now(),
      });
    }
  }

  // 4. Routing. Pure function, always runs.
  run.routing = routeClaims({
    claims: run.claims,
    verifications: run.verification,
    criticisms: run.criticisms || [],
    evidence: run.evidence,
  });
  run.log.push({
    stage: 'route',
    level: run.routing.overall === 'blocked' ? 'error' : run.routing.overall === 'needs_update' ? 'warn' : 'info',
    message:
      `Routing: overall=${run.routing.overall}, ` +
      `${run.routing.items.filter((i) => i.severity === 'blocking').length} blocking, ` +
      `${run.routing.items.filter((i) => i.severity === 'targeted_review').length} targeted, ` +
      `${run.routing.items.filter((i) => i.severity === 'ok').length} ok.`,
    ts: Date.now(),
  });
}

/**
 * Decide whether the review stage is worth running under 'selective'
 * escalation. A claim set is "clean" if no verification is hard_fail,
 * no entailment is contradicted, and no cited URL failed to resolve.
 */
function isClaimSetClean(run) {
  for (const v of run.verification || []) {
    if (v.verdict === 'hard_fail') return false;
    if (v.entailment === 'contradicted') return false;
    if (v.citationResolves === false) return false;
  }
  return true;
}

/**
 * Run the review stage: parallel structured reviews, aggregation, and a
 * re-route that folds the resulting criticisms into the routing state.
 */
async function runReviewStage(run, ablation, cost) {
  const structured = await runStructuredReviewsParallel(
    FIXTURE_REVIEWERS,
    run.drafts[run.drafts.length - 1].content,
    RIGOR_RUBRIC,
  );
  for (const r of structured) {
    if (r.usage) cost.record('review', { usage: r.usage, wallClockMs: r.wallClockMs });
    if (r.logEntry) {
      run.log.push({
        stage: 'review',
        level: r.logEntry.level,
        message: r.logEntry.message,
        ts: Date.now(),
      });
    }
  }

  const successful = structured.filter((r) => r.reviewProse !== null);
  if (successful.length === 0) {
    run.log.push({
      stage: 'review',
      level: 'error',
      message: 'All reviewers failed.',
      ts: Date.now(),
    });
    return;
  }

  const allCriticisms = successful.flatMap((r) => r.criticisms);
  run.criticisms = [...(run.criticisms || []), ...allCriticisms];

  const allVotes = successful.flatMap((r) => r.rubricVotes);
  const aggResult = await aggregate(
    ablation.aggregation,
    RIGOR_RUBRIC,
    allVotes,
    FIXTURE_JUDGE_MODEL,
  );
  if (aggResult.usage && aggResult.usage.totalTokens > 0) {
    cost.record('aggregation', { usage: aggResult.usage, wallClockMs: aggResult.wallClockMs });
  }
  if (aggResult.logEntry) {
    run.log.push({
      stage: 'aggregation',
      level: aggResult.logEntry.level,
      message: aggResult.logEntry.message,
      ts: Date.now(),
    });
  }
  run.aggregation = aggResult.aggregation;

  // Re-route with the newly-landed criticisms. This matches the UI's
  // behaviour in handleReview — criticisms can promote a claim from ok
  // to targeted_review / blocking.
  run.routing = routeClaims({
    claims: run.claims,
    verifications: run.verification,
    criticisms: run.criticisms,
    evidence: run.evidence,
  });
}

/**
 * Run the update stage: new draft from the mocked updater, re-extract,
 * re-verify, re-route. Matches handleUpdate + runClaimExtractorAndRecord.
 */
async function runUpdateStage(run, ablation, mockFetch, cost) {
  const latestDraft = run.drafts[run.drafts.length - 1].content;
  const reviewText = run.aggregation?.checklist
    ?.map((item) => `${item.id}: ${item.decision}`)
    .join('\n') || '(no review)';
  const focusBlock = buildRoutingFocusBlock(run.routing, run.claims);
  const updateResult = await queryModel(
    FIXTURE_DRAFT_MODEL,
    [
      { role: 'system', content: SYSTEM_PROMPTS.drafter },
      { role: 'user', content: buildUpdatePrompt(latestDraft, reviewText, '', focusBlock) },
    ],
  );
  cost.record('update', updateResult);
  run.drafts.push({
    model: FIXTURE_DRAFT_MODEL,
    content: updateResult.content,
    timestamp: Date.now(),
    kind: 'updated',
  });
  // Re-run the claim pipeline on the updated draft.
  await runClaimPipeline(run, updateResult.content, ablation, mockFetch, cost);
}

/**
 * Run the early-resolution risk analyst. Parses the risk level out of
 * the mocked response using the same regex as App.jsx.
 */
async function runRiskStage(run, cost) {
  const latestDraft = run.drafts[run.drafts.length - 1].content;
  const riskResult = await queryModel(
    FIXTURE_DRAFT_MODEL,
    [
      { role: 'system', content: SYSTEM_PROMPTS.earlyResolutionAnalyst },
      { role: 'user', content: buildEarlyResolutionPrompt(latestDraft, run.input.startDate, run.input.endDate) },
    ],
  );
  cost.record('early_resolution', riskResult);
  const match = typeof riskResult.content === 'string'
    ? riskResult.content.match(/risk\s*rating\s*[:-]?\s*(low|medium|high)/i)
    : null;
  const level = match ? match[1].toLowerCase() : 'unknown';
  run.log.push({
    stage: 'early_resolution',
    level: level === 'high' ? 'warn' : 'info',
    message: `Risk analyst → ${level}`,
    ts: Date.now(),
  });
  return { level, text: riskResult.content };
}

/**
 * Run the finalizer and record whether the Accept gate actually
 * allowed the final JSON to be produced. The gate logic mirrors
 * App.jsx's handleAccept: HIGH risk and routing=blocked both block.
 */
async function runFinalizeStage(run, riskLevel, cost) {
  const latestDraft = run.drafts[run.drafts.length - 1].content;
  const routingOverall = run.routing?.overall || 'clean';
  const blockedByRisk = riskLevel === 'high';
  const blockedByRouting = routingOverall === 'blocked';
  const blockedByVerification = (run.verification || []).some((v) => v.verdict === 'hard_fail');

  const gateResult = {
    allowed: !blockedByRisk && !blockedByRouting && !blockedByVerification,
    blockedByRisk,
    blockedByRouting,
    blockedByVerification,
  };

  if (!gateResult.allowed) {
    run.log.push({
      stage: 'accept',
      level: 'error',
      message:
        `Finalize blocked: risk=${blockedByRisk}, routing=${blockedByRouting}, verification=${blockedByVerification}`,
      ts: Date.now(),
    });
    return gateResult;
  }

  const finalResult = await queryModel(
    FIXTURE_DRAFT_MODEL,
    [
      { role: 'system', content: SYSTEM_PROMPTS.finalizer },
      { role: 'user', content: buildFinalizePrompt(latestDraft, run.input.startDate, run.input.endDate) },
    ],
    { temperature: 0.3 },
  );
  cost.record('accept', finalResult);
  let parsed;
  try {
    const match = finalResult.content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
    parsed = match ? JSON.parse(match[1]) : JSON.parse(finalResult.content);
  } catch {
    parsed = { raw: finalResult.content };
  }
  run.finalJson = parsed;
  return gateResult;
}

// --- Public entry point --------------------------------------------------

/**
 * @typedef {Object} FixtureResult
 * @property {string} fixtureId
 * @property {string} bucket
 * @property {import('../src/types/run.js').Run} run
 * @property {{allowed:boolean, blockedByRisk:boolean, blockedByRouting:boolean, blockedByVerification:boolean}} gate
 * @property {{level:string, text:string}} risk
 * @property {object} ablation
 * @property {boolean} reviewSkipped           true when selective escalation skipped Phase 2
 * @property {string[]} missingMockFields      fixture keys that were missing from mockResponses
 * @property {Object<string, number>} calls    mock calls by role
 */

/**
 * Run a fixture end-to-end and return a FixtureResult.
 *
 * @param {object} fixture
 * @param {object} ablation
 * @returns {Promise<FixtureResult>}
 */
export async function runFixture(fixture, ablation) {
  const mockQuery = createMockQueryModel(fixture, {
    onWarn: (m) => console.warn(`[eval] ${m}`),
  });
  const mockFetch = createMockFetch(fixture);
  installQueryModel(mockQuery);
  const cost = createCostTracker();
  let reviewSkipped = false;

  try {
    const run = createRun(fixture.input || {});

    // 1. Draft.
    const draftResult = await queryModel(
      FIXTURE_DRAFT_MODEL,
      [
        { role: 'system', content: SYSTEM_PROMPTS.drafter },
        {
          role: 'user',
          content: buildDraftPrompt(
            fixture.input?.question || '',
            fixture.input?.startDate || '',
            fixture.input?.endDate || '',
            fixture.input?.references || '',
          ),
        },
      ],
    );
    cost.record('draft', draftResult);
    run.drafts.push({
      model: FIXTURE_DRAFT_MODEL,
      content: draftResult.content,
      timestamp: Date.now(),
      kind: 'initial',
    });

    // 2. Claim pipeline on the initial draft.
    await runClaimPipeline(run, draftResult.content, ablation, mockFetch, cost);

    // 3. Review + aggregation. Under 'selective' escalation we skip the
    //    review stage when the claim pipeline already looks clean, which
    //    is the Phase 5 "selective escalation router" behaviour.
    if (ablation.escalation === 'selective' && isClaimSetClean(run)) {
      reviewSkipped = true;
      run.log.push({
        stage: 'review',
        level: 'info',
        message: 'Review skipped by selective escalation (claim set clean).',
        ts: Date.now(),
      });
    } else {
      await runReviewStage(run, ablation, cost);
    }

    // 4. Update. The update stage always runs — it's how the updater
    //    addresses routing focus claims. In an end-to-end run, skipping
    //    update would mean we never test the update prompt.
    await runUpdateStage(run, ablation, mockFetch, cost);

    // 5. Risk analyst on the updated draft. Mirrors handleUpdate's
    //    post-update early-resolution check.
    const risk = await runRiskStage(run, cost);

    // 6. Finalize (gated). This is the canonical Accept.
    const gate = await runFinalizeStage(run, risk.level, cost);

    run.cost = cost.snapshot();
    return {
      fixtureId: fixture.id,
      bucket: fixture.bucket,
      run,
      gate,
      risk,
      ablation,
      reviewSkipped,
      missingMockFields: [...mockQuery.missingFields],
      calls: { ...mockQuery.callsByRole },
    };
  } finally {
    resetQueryModel();
  }
}

export { FIXTURE_REVIEWERS, FIXTURE_DRAFT_MODEL, FIXTURE_JUDGE_MODEL };
