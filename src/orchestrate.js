/**
 * Headless pipeline orchestrator.
 *
 * Runs the full PM_tools pipeline (draft → extract claims → verify → gather
 * evidence → route → review → aggregate → update → risk → finalize) without
 * any React UI. Takes a config object, returns a Run artifact.
 *
 * Consumers: the CLI (`bin/pm-tools.js`), the eval harness (via mock LLMs),
 * and any future server / agent integration.
 *
 * Key differences from the eval harness's original `runFixture()`:
 *   - Does NOT call installQueryModel() — uses the real queryModel by default.
 *   - Model IDs come from config.models, not hardcoded mock IDs.
 *   - Supports abort via AbortSignal.
 *   - Calls lifecycle callbacks (onStageStart / onStageEnd / onLog).
 *   - Wraps every stage in try/catch — never throws, returns partial Runs.
 *   - Populates run.status and run.gates on completion.
 *   - Enforces a concurrency limit (semaphore) to prevent API credit burn.
 */

import { queryModel } from './api/openrouter.js';
import { resolvePromptSet, DEFAULT_RIGOR_LEVEL } from './constants/promptSet.js';
import { extractClaims } from './pipeline/extractClaims.js';
import { tryParseJsonObject } from './pipeline/llmJson.js';
import { verifyClaims, structuralCheck } from './pipeline/verify.js';
import { gatherEvidence } from './pipeline/gatherEvidence.js';
import { routeClaims } from './pipeline/route.js';
import { runStructuredReviewsParallel } from './pipeline/structuredReview.js';
import { aggregate } from './pipeline/aggregate.js';
import { RIGOR_RUBRIC } from './constants/rubric.js';
import { enrichReferencesWithXData } from './pipeline/xapi.js';
import { parseRiskLevel } from './util/riskLevel.js';
import { createRun } from './types/run.js';
import { assignShortIds } from './report/shortIds.js';
import {
  DEFAULT_DRAFT_MODEL,
  DEFAULT_REVIEWER_MODELS,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_OPTIONS,
  DRAFT_MAX_TOKENS,
} from './defaults.js';

// ----------------------------------------------------------------- semaphore

const DEFAULT_MAX_CONCURRENT = 3;

/**
 * Bounded-concurrency semaphore. Used by orchestrate() to cap how many
 * pipelines run in parallel in the same process. Exposed as a factory
 * (rather than a module-level singleton) so tests and multi-tenant
 * callers can spin up independent limits — a single shared module-level
 * semaphore would silently serialise unrelated callers.
 *
 * A process-wide default is still exported below so single-process CLI
 * usage keeps its previous behaviour without any explicit wiring.
 */
export function createSemaphore(maxConcurrent = DEFAULT_MAX_CONCURRENT) {
  let running = 0;
  const queue = [];
  return {
    acquire() {
      if (running < maxConcurrent) {
        running++;
        return Promise.resolve();
      }
      return new Promise((resolve) => queue.push(resolve));
    },
    release() {
      if (queue.length > 0) {
        const next = queue.shift();
        next();
      } else {
        running--;
      }
    },
  };
}

/** Process-wide default semaphore used when the caller does not provide one. */
const defaultSemaphore = createSemaphore();

// --------------------------------------------------------- cost accounting

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

// --------------------------------------------------------------- helpers

function log(run, stage, level, message, callbacks) {
  const entry = { stage, level, message, ts: Date.now() };
  run.log.push(entry);
  callbacks?.onLog?.(entry);
}

/**
 * Check whether the caller has requested an abort. If aborted, sets
 * run.status to 'error' with a log message and returns true.
 */
function checkAbort(run, signal, callbacks) {
  if (!signal?.aborted) return false;
  log(run, 'orchestrate', 'error', 'Pipeline aborted by caller.', callbacks);
  run.status = 'error';
  return true;
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

// --------------------------------------------------------- sub-stages

/**
 * Run extraction + verification + evidence + routing for a draft and fold
 * the results into the Run artifact.
 */
async function runClaimPipeline(run, draftText, models, options, fetchImpl, cost, callbacks, prompts) {
  // 1. Claim extraction.
  const claimResult = await extractClaims(models.drafter, draftText, {
    buildPrompt: prompts.buildClaimExtractorPrompt,
    buildRetryPrompt: prompts.buildStrictClaimExtractorRetryPrompt,
    systemPrompt: prompts.SYSTEM_PROMPTS.claimExtractor,
  });
  cost.record('claims', claimResult);
  if (claimResult.logEntry) {
    log(run, 'claims', claimResult.logEntry.level, claimResult.logEntry.message, callbacks);
  }
  run.claims = claimResult.claims;

  if (run.claims.length === 0) {
    run.verification = [];
    run.evidence = [];
    run.routing = routeClaims({ claims: [], verifications: [], criticisms: run.criticisms || [] });
    return;
  }

  // 2. Verification.
  let verifications = [];
  if (options.verifiers === 'off') {
    verifications = [];
    log(run, 'verify', 'info', 'Verification skipped (verifiers=off).', callbacks);
  } else if (options.verifiers === 'partial') {
    verifications = run.claims.map((c) => ({ ...structuralCheck(c), entailment: 'not_applicable' }));
    log(run, 'verify', 'info', `Verification structural-only (${verifications.length} claim(s)).`, callbacks);
  } else {
    const vResult = await verifyClaims(run.claims, draftText, models.drafter, {
      buildPrompt: prompts.buildBatchEntailmentPrompt,
      buildRetryPrompt: prompts.buildStrictBatchEntailmentRetryPrompt,
      systemPrompt: prompts.SYSTEM_PROMPTS.entailmentVerifier,
    });
    cost.record('verify', vResult);
    verifications = vResult.verifications;
    if (vResult.logEntry) {
      log(run, 'verify', vResult.logEntry.level, vResult.logEntry.message, callbacks);
    }
  }
  run.verification = verifications;

  // 3. Evidence gathering.
  if (options.evidence === 'none') {
    run.evidence = [];
    log(run, 'evidence', 'info', 'Evidence gathering skipped (evidence=none).', callbacks);
  } else {
    const eResult = await gatherEvidence({
      references: run.input.references,
      claims: run.claims,
      verifications: run.verification,
      fetchImpl,
      timeoutMs: 3000,
    });
    cost.record('evidence', { usage: null, wallClockMs: eResult.wallClockMs });
    run.evidence = eResult.evidence;
    run.verification = eResult.updatedVerifications;
    if (eResult.logEntry) {
      log(run, 'evidence', eResult.logEntry.level, eResult.logEntry.message, callbacks);
    }
  }

  // 4. Routing.
  run.routing = routeClaims({
    claims: run.claims,
    verifications: run.verification,
    criticisms: run.criticisms || [],
    evidence: run.evidence,
  });
  log(
    run, 'route',
    run.routing.overall === 'blocked' ? 'error' : run.routing.overall === 'needs_update' ? 'warn' : 'info',
    `Routing: overall=${run.routing.overall}, ` +
      `${run.routing.items.filter((i) => i.severity === 'blocking').length} blocking, ` +
      `${run.routing.items.filter((i) => i.severity === 'targeted_review').length} targeted, ` +
      `${run.routing.items.filter((i) => i.severity === 'ok').length} ok.`,
    callbacks,
  );
}

/**
 * Run the review stage: parallel structured reviews, aggregation, and a
 * re-route that folds the resulting criticisms into the routing state.
 */
async function runReviewStage(run, models, options, cost, callbacks, prompts) {
  const structured = await runStructuredReviewsParallel(
    models.reviewers,
    run.drafts[run.drafts.length - 1].content,
    RIGOR_RUBRIC,
    run.input?.numberOfOutcomes || '',
    {
      buildPrompt: prompts.buildStructuredReviewPrompt,
      buildRetryPrompt: prompts.buildStrictStructuredReviewRetryPrompt,
      systemPrompt: prompts.SYSTEM_PROMPTS.structuredReviewer,
    },
  );
  for (const r of structured) {
    if (r.usage) cost.record('review', { usage: r.usage, wallClockMs: r.wallClockMs });
    if (r.logEntry) {
      log(run, 'review', r.logEntry.level, r.logEntry.message, callbacks);
    }
  }

  const successful = structured.filter((r) => r.reviewProse !== null);
  if (successful.length === 0) {
    log(run, 'review', 'error', 'All reviewers failed.', callbacks);
    return;
  }

  const allCriticisms = successful.flatMap((r) => r.criticisms);
  run.criticisms = [...(run.criticisms || []), ...allCriticisms];

  const allVotes = successful.flatMap((r) => r.rubricVotes);
  const judgeModel = options.aggregation === 'judge' ? models.judge : undefined;
  const aggResult = await aggregate(
    options.aggregation,
    RIGOR_RUBRIC,
    allVotes,
    judgeModel,
    {
      buildPrompt: prompts.buildJudgeAggregatorPrompt,
      buildRetryPrompt: prompts.buildStrictJudgeAggregatorRetryPrompt,
      systemPrompt: prompts.SYSTEM_PROMPTS.aggregationJudge,
    },
  );
  if (aggResult.usage && aggResult.usage.totalTokens > 0) {
    cost.record('aggregation', { usage: aggResult.usage, wallClockMs: aggResult.wallClockMs });
  }
  if (aggResult.logEntry) {
    log(run, 'aggregation', aggResult.logEntry.level, aggResult.logEntry.message, callbacks);
  }
  run.aggregation = aggResult.aggregation;

  // Re-route with the newly-landed criticisms.
  run.routing = routeClaims({
    claims: run.claims,
    verifications: run.verification,
    criticisms: run.criticisms,
    evidence: run.evidence,
  });
}

/**
 * Run the update stage: new draft, re-extract, re-verify, re-route.
 */
async function runUpdateStage(run, models, options, fetchImpl, cost, callbacks, referencesStr, prompts) {
  const latestDraft = run.drafts[run.drafts.length - 1].content;
  const reviewText = run.aggregation?.checklist
    ?.map((item) => `${item.id}: ${item.decision}`)
    .join('\n') || '(no review)';
  const focusBlock = prompts.buildRoutingFocusBlock(run.routing, run.claims);
  const humanFeedback = options.humanFeedback || '';
  const updateResult = await queryModel(
    models.drafter,
    [
      { role: 'system', content: prompts.SYSTEM_PROMPTS.drafter },
      { role: 'user', content: prompts.buildUpdatePrompt(latestDraft, reviewText, humanFeedback, focusBlock, run.input?.numberOfOutcomes || '', referencesStr) },
    ],
    { maxTokens: 8000 },
  );
  cost.record('update', updateResult);
  run.drafts.push({
    model: models.drafter,
    content: updateResult.content,
    timestamp: Date.now(),
    kind: 'updated',
  });
  // Re-run the claim pipeline on the updated draft.
  await runClaimPipeline(run, updateResult.content, models, options, fetchImpl, cost, callbacks, prompts);
}

/**
 * Run the early-resolution risk analyst. Parses the risk level from the
 * response via the shared parseRiskLevel helper.
 */
async function runRiskStage(run, models, cost, callbacks, prompts) {
  const latestDraft = run.drafts[run.drafts.length - 1].content;
  const riskResult = await queryModel(
    models.drafter,
    [
      { role: 'system', content: prompts.SYSTEM_PROMPTS.earlyResolutionAnalyst },
      { role: 'user', content: prompts.buildEarlyResolutionPrompt(latestDraft, run.input.startDate, run.input.endDate) },
    ],
  );
  cost.record('early_resolution', riskResult);
  const level = parseRiskLevel(riskResult.content);
  log(
    run, 'early_resolution',
    level === 'high' ? 'warn' : 'info',
    `Risk analyst → ${level}`,
    callbacks,
  );
  return { level, text: riskResult.content };
}

/**
 * Run the finalizer and record whether the Accept gate allowed the final
 * JSON. Gate logic mirrors App.jsx's handleAccept.
 */
async function runFinalizeStage(run, riskLevel, models, cost, callbacks, prompts) {
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
    log(
      run, 'accept', 'error',
      `Finalize blocked: risk=${blockedByRisk}, routing=${blockedByRouting}, verification=${blockedByVerification}`,
      callbacks,
    );
    return gateResult;
  }

  const finalResult = await queryModel(
    models.drafter,
    [
      { role: 'system', content: prompts.SYSTEM_PROMPTS.finalizer },
      { role: 'user', content: prompts.buildFinalizePrompt(latestDraft, run.input.startDate, run.input.endDate, run.input?.numberOfOutcomes || '') },
    ],
    { temperature: 0.3 },
  );
  cost.record('accept', finalResult);
  run.finalJson = tryParseJsonObject(finalResult.content) || { raw: finalResult.content };
  return gateResult;
}

// -------------------------------------------------------- gates builder

/**
 * Populate run.gates from the data already on the Run. Does not add new
 * pipeline logic — just summarizes existing state.
 */
function buildGates(run, riskLevel) {
  const level = (riskLevel === 'low' || riskLevel === 'medium' || riskLevel === 'high')
    ? riskLevel
    : 'medium'; // unknown risk → treat as medium for the gates summary

  const routingOverall = run.routing?.overall || 'clean';
  const hasHardFail = (run.verification || []).some((v) => v.verdict === 'hard_fail');

  // Source status: derive from evidence. If no evidence was gathered, the
  // status depends on whether there were any URLs to check.
  let sourcesStatus = 'no_sources';
  if (run.evidence && run.evidence.length > 0) {
    // If any source-claim verification has citationResolves === false,
    // some sources are unreachable.
    const sourceVerifs = (run.verification || []).filter((v) => {
      const claim = (run.claims || []).find((c) => c.id === v.claimId);
      return claim && claim.category === 'source';
    });
    if (sourceVerifs.length === 0) {
      sourcesStatus = 'ok';
    } else {
      const allResolve = sourceVerifs.every((v) => v.citationResolves !== false);
      const noneResolve = sourceVerifs.every((v) => v.citationResolves === false);
      if (allResolve) sourcesStatus = 'ok';
      else if (noneResolve) sourcesStatus = 'all_unreachable';
      else sourcesStatus = 'some_unreachable';
    }
  }

  return {
    risk: { level, blocked: level === 'high' },
    routing: { overall: routingOverall, blocked: routingOverall === 'blocked' },
    verification: { hasHardFail, blocked: hasHardFail },
    sources: { status: sourcesStatus, blocked: sourcesStatus === 'all_unreachable' },
  };
}

// ------------------------------------------------- public entry point

/**
 * Run the full PM_tools pipeline headlessly.
 *
 * @param {object} config
 * @param {object} config.input
 * @param {string} config.input.question         required
 * @param {string} config.input.startDate        ISO 8601, required
 * @param {string} config.input.endDate          ISO 8601, required
 * @param {string[]} [config.input.references]   resolution source URLs
 * @param {object} [config.models]
 * @param {string} [config.models.drafter]
 * @param {{id:string, name:string}[]} [config.models.reviewers]
 * @param {string} [config.models.judge]
 * @param {object} [config.options]
 * @param {'majority'|'unanimity'|'judge'} [config.options.aggregation]
 * @param {'always'|'selective'} [config.options.escalation]
 * @param {'none'|'retrieval'} [config.options.evidence]
 * @param {'off'|'partial'|'full'} [config.options.verifiers]
 * @param {string} [config.options.humanFeedback]
 * @param {boolean} [config.options.skipReview]   stop after claim pipeline, before review + update
 * @param {boolean} [config.options.skipFinalize]
 * @param {object} [config.callbacks]
 * @param {(stage:string)=>void} [config.callbacks.onStageStart]
 * @param {(stage:string, result:any)=>void} [config.callbacks.onStageEnd]
 * @param {(entry:object)=>void} [config.callbacks.onLog]
 * @param {typeof fetch} [config.fetchImpl]      override for tests (evidence URL probes)
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>} the Run artifact
 */
export async function orchestrate(config, signal) {
  const semaphore = config?.semaphore || defaultSemaphore;
  await semaphore.acquire();
  try {
    const run = await _orchestrateInner(config, signal);
    // Stamp stable short ids (C1..Cn, R1..Rn, S1..Sn, E1..En) at production
    // time so the report renderer and any downstream consumers reference the
    // same ids without re-deriving them at render time.
    assignShortIds(run);
    return run;
  } finally {
    semaphore.release();
  }
}

async function _orchestrateInner(config, signal) {
  const { input, models: modelsRaw, options: optionsRaw, callbacks, fetchImpl } = config || {};

  // Resolve models with defaults.
  const models = {
    drafter: modelsRaw?.drafter || DEFAULT_DRAFT_MODEL,
    reviewers: modelsRaw?.reviewers?.length > 0 ? modelsRaw.reviewers : DEFAULT_REVIEWER_MODELS,
    judge: modelsRaw?.judge || DEFAULT_JUDGE_MODEL,
  };

  // Resolve options with defaults.
  const options = {
    aggregation: optionsRaw?.aggregation || DEFAULT_OPTIONS.aggregation,
    escalation: optionsRaw?.escalation || DEFAULT_OPTIONS.escalation,
    evidence: optionsRaw?.evidence || DEFAULT_OPTIONS.evidence,
    verifiers: optionsRaw?.verifiers || DEFAULT_OPTIONS.verifiers,
    humanFeedback: optionsRaw?.humanFeedback || undefined,
    skipReview: optionsRaw?.skipReview || false,
    skipFinalize: optionsRaw?.skipFinalize || false,
    xapiEnrich: optionsRaw?.xapiEnrich || false,
  };

  // Resolve rigor level + prompt bundle. Machine is the default; passing
  // 'human' through optionsRaw routes every prompt reference below at the
  // human-mode bundle (currently a Phase 1 stub that aliases the
  // machine-mode prompts; Phase 3 replaces it with real human prompts).
  // We deliberately do NOT pre-validate the value here — resolvePromptSet
  // silently falls back to machine on anything unknown, and we store the
  // value the caller actually passed (after fallback) in options.
  const rigorLevel = optionsRaw?.rigorLevel || DEFAULT_RIGOR_LEVEL;
  const prompts = resolvePromptSet(rigorLevel);
  options.rigorLevel = prompts.rigorLevel;

  // Human-mode pipeline softeners — only applied when the caller did not
  // explicitly set the option, so power users can still override per-call.
  // Machine mode never enters this block, so machine eval baselines stay
  // byte-identical.
  if (prompts.rigorLevel === 'human') {
    if (optionsRaw?.verifiers === undefined)   options.verifiers   = 'partial';
    if (optionsRaw?.evidence === undefined)    options.evidence    = 'none';
    if (optionsRaw?.escalation === undefined)  options.escalation  = 'selective';
    if (optionsRaw?.aggregation === undefined) options.aggregation = 'majority';
  }

  // Build the Run input. References may arrive as an array (CLI) or string (UI/harness).
  const refs = input?.references;
  let referencesStr = Array.isArray(refs) ? refs.join('\n') : (refs || '');

  const run = createRun({
    question: input?.question || '',
    startDate: input?.startDate || '',
    endDate: input?.endDate || '',
    references: referencesStr,
  });

  // Tag the run with its rigor level only when non-default. This keeps the
  // committed machine-mode eval baseline byte-identical (it has no
  // `rigorLevel` key) while still labelling every human-mode run for
  // debuggability and downstream formatters.
  if (prompts.rigorLevel !== DEFAULT_RIGOR_LEVEL) {
    run.rigorLevel = prompts.rigorLevel;
  }

  let riskLevel = 'unknown';

  // Helper to wrap a stage in try/catch with abort check and callbacks.
  const stage = async (name, fn) => {
    if (checkAbort(run, signal, callbacks)) return false;
    callbacks?.onStageStart?.(name);
    try {
      const result = await fn();
      callbacks?.onStageEnd?.(name, result);
      return true;
    } catch (err) {
      log(run, name, 'error', `Stage failed: ${err.message || err}`, callbacks);
      run.status = 'error';
      callbacks?.onStageEnd?.(name, { error: err.message || String(err) });
      return false;
    }
  };

  const cost = createCostTracker();

  // --- 1. Draft ---
  let ok = await stage('draft', async () => {
    const draftResult = await queryModel(
      models.drafter,
      [
        { role: 'system', content: prompts.SYSTEM_PROMPTS.drafter },
        {
          role: 'user',
          content: prompts.buildDraftPrompt(
            input?.question || '',
            input?.startDate || '',
            input?.endDate || '',
            referencesStr,
            input?.numberOfOutcomes || '',
          ),
        },
      ],
      { maxTokens: DRAFT_MAX_TOKENS },
    );
    cost.record('draft', draftResult);
    run.drafts.push({
      model: models.drafter,
      content: draftResult.content,
      timestamp: Date.now(),
      kind: 'initial',
    });
    return draftResult;
  });
  if (!ok || run.status === 'error') {
    run.cost = cost.snapshot();
    run.gates = buildGates(run, riskLevel);
    return run;
  }

  // --- 2. Claim pipeline on the initial draft ---
  ok = await stage('claims', async () => {
    await runClaimPipeline(
      run, run.drafts[0].content, models, options, fetchImpl, cost, callbacks, prompts,
    );
  });
  if (!ok || run.status === 'error') {
    run.cost = cost.snapshot();
    run.gates = buildGates(run, riskLevel);
    return run;
  }

  // --- 3. Escalation gate + Review ---
  if (options.skipReview) {
    // Stop after initial draft + claim pipeline.
    run.status = 'partial';
    run.cost = cost.snapshot();
    run.gates = buildGates(run, riskLevel);
    return run;
  }

  if (options.escalation === 'selective' && isClaimSetClean(run)) {
    log(run, 'review', 'info', 'Review skipped by selective escalation (claim set clean).', callbacks);
  } else {
    ok = await stage('review', async () => {
      await runReviewStage(run, models, options, cost, callbacks, prompts);
    });
    if (!ok || run.status === 'error') {
      run.cost = cost.snapshot();
      run.gates = buildGates(run, riskLevel);
      return run;
    }
  }

  // --- 3.5. Optional xAPI enrichment ---
  if (options.xapiEnrich) {
    ok = await stage('xapi_enrich', async () => {
      const enriched = await enrichReferencesWithXData(
        referencesStr,
        run.drafts[run.drafts.length - 1]?.content || '',
        { fetchImpl },
      );
      if (enriched !== referencesStr) {
        referencesStr = enriched;
        log(run, 'xapi_enrich', 'info', 'References enriched with X/Twitter context via xAPI.', callbacks);
      } else {
        log(run, 'xapi_enrich', 'info', 'No X/Twitter content found to enrich.', callbacks);
      }
    });
    // Enrichment failure is non-fatal — proceed with original references.
    if (!ok) {
      log(run, 'xapi_enrich', 'warn', 'xAPI enrichment failed; continuing with original references.', callbacks);
    }
  }

  // --- 4. Update ---
  ok = await stage('update', async () => {
    await runUpdateStage(run, models, options, fetchImpl, cost, callbacks, referencesStr, prompts);
  });
  if (!ok || run.status === 'error') {
    run.cost = cost.snapshot();
    run.gates = buildGates(run, riskLevel);
    return run;
  }

  // --- 5. Risk analysis ---
  let riskText = '';
  ok = await stage('early_resolution', async () => {
    const result = await runRiskStage(run, models, cost, callbacks, prompts);
    riskLevel = result.level;
    riskText = result.text;
    return result;
  });
  // Stash the raw risk-analyst response on the run so consumers (eval
  // harness, CLI summary) can access the full text, not just the parsed level.
  run.riskAnalysis = { level: riskLevel, text: riskText };

  if (!ok || run.status === 'error') {
    run.cost = cost.snapshot();
    run.gates = buildGates(run, riskLevel);
    return run;
  }

  // --- 6. Finalize ---
  if (options.skipFinalize) {
    run.status = 'partial';
    run.cost = cost.snapshot();
    run.gates = buildGates(run, riskLevel);
    return run;
  }

  let gate;
  ok = await stage('accept', async () => {
    gate = await runFinalizeStage(run, riskLevel, models, cost, callbacks, prompts);
    return gate;
  });
  if (!ok || run.status === 'error') {
    run.cost = cost.snapshot();
    run.gates = buildGates(run, riskLevel);
    return run;
  }

  // --- Set final status ---
  run.cost = cost.snapshot();
  run.gates = buildGates(run, riskLevel);

  if (gate && !gate.allowed) {
    run.status = 'blocked';
  } else {
    run.status = 'complete';
  }

  return run;
}
