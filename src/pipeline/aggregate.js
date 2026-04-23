/**
 * Aggregation protocols for Phase 2 review.
 *
 * Takes the rubric and all reviewer votes and renders an Aggregation record
 * (as defined in types/run.js). Three protocols are available:
 *
 *   - majority:  for each rubric item, majority verdict wins. Ties on no/yes
 *                pass; ties involving unsure escalate. Overall decision is
 *                the worst per-item decision (fail > escalate > pass).
 *
 *   - unanimity: every reviewer must vote yes on every item for a pass. A
 *                single no fails the item; any unsure escalates the item.
 *                Overall follows the same worst-wins rule.
 *
 *   - judge:     majority is computed as a baseline, then a separate judge
 *                model is called with the rubric and all votes to render a
 *                final verdict + rationale. The judge is allowed to override
 *                the majority. This is the only protocol that makes an
 *                additional LLM call and therefore the only async path.
 *
 * All protocols return an `Aggregation` object matching AggregationSchema.
 * The caller dispatches the result via RUN_SET_AGGREGATION.
 *
 * Judge protocol failures (JSON parse, network) degrade gracefully to the
 * majority baseline and a structured log entry — the UI should never be
 * blocked by the judge being flaky.
 */

import { queryModel } from '../api/openrouter.js';
import {
  SYSTEM_PROMPTS,
  buildJudgeAggregatorPrompt,
  buildStrictJudgeAggregatorRetryPrompt,
} from '../constants/prompts.js';
import { JudgeAggregatorResponseSchema } from '../types/run.js';
import { tryParseJsonObject, createUsageAggregator } from './llmJson.js';

/**
 * Group reviewer votes by rubric id and build a ChecklistItem list in the
 * rubric's declared order. Missing votes for a rubric item yield an empty
 * votes array (the aggregator treats this as "no signal" → escalate).
 *
 * @param {import('../constants/rubric').RubricItem[]} rubric
 * @param {Array<{ruleId:string, reviewerModel:string, verdict:'yes'|'no'|'unsure', rationale:string}>} allVotes
 * @returns {Array<{id:string, question:string, votes:Array<{reviewerModel:string, verdict:string, rationale:string}>, decision:string}>}
 */
function buildChecklistSkeleton(rubric, allVotes) {
  const byRule = new Map();
  for (const v of allVotes) {
    if (!byRule.has(v.ruleId)) byRule.set(v.ruleId, []);
    byRule.get(v.ruleId).push({
      reviewerModel: v.reviewerModel,
      verdict: v.verdict,
      rationale: v.rationale || '',
    });
  }
  return rubric.map((item) => ({
    id: item.id,
    question: item.question,
    votes: byRule.get(item.id) || [],
    decision: 'escalate', // placeholder — protocol fills this in
  }));
}

/**
 * Combine per-item decisions into a single overall verdict. "fail" wins over
 * "escalate" wins over "pass". An empty checklist (no rubric / no votes)
 * escalates.
 *
 * @param {Array<{decision:string}>} checklist
 * @returns {'pass'|'fail'|'needs_escalation'}
 */
function rollupOverall(checklist) {
  if (checklist.length === 0) return 'needs_escalation';
  let hasFail = false;
  let hasEscalate = false;
  for (const item of checklist) {
    if (item.decision === 'fail') hasFail = true;
    else if (item.decision === 'escalate') hasEscalate = true;
  }
  if (hasFail) return 'fail';
  if (hasEscalate) return 'needs_escalation';
  return 'pass';
}

/**
 * Majority protocol. Count yes/no/unsure per item; pick the plurality.
 * Plurality ties: if yes and no are tied, item passes (bias toward the
 * draft — the user is the one who wrote it, and `no` votes without a
 * majority are not strong evidence). Any tie involving unsure escalates.
 *
 * @param {Array<{id:string, question:string, votes:Array, decision:string}>} checklist
 */
function applyMajority(checklist) {
  return checklist.map((item) => {
    if (item.votes.length === 0) return { ...item, decision: 'escalate' };
    const tally = { yes: 0, no: 0, unsure: 0 };
    for (const v of item.votes) {
      if (tally[v.verdict] !== undefined) tally[v.verdict] += 1;
    }
    const max = Math.max(tally.yes, tally.no, tally.unsure);
    const winners = Object.entries(tally).filter(([, c]) => c === max).map(([k]) => k);
    // Single winner → decide by its verdict. Any tie (pure yes/no or anything
    // involving unsure) escalates so the disagreement reaches the human
    // instead of being silently resolved.
    const decision = winners.length === 1
      ? (winners[0] === 'yes' ? 'pass' : winners[0] === 'no' ? 'fail' : 'escalate')
      : 'escalate';
    return { ...item, decision };
  });
}

/**
 * Unanimity protocol. Every vote must be yes for a pass. A single no fails
 * the item. Any unsure (without a no) escalates the item.
 */
function applyUnanimity(checklist) {
  return checklist.map((item) => {
    if (item.votes.length === 0) return { ...item, decision: 'escalate' };
    const hasNo = item.votes.some((v) => v.verdict === 'no');
    const hasUnsure = item.votes.some((v) => v.verdict === 'unsure');
    const allYes = item.votes.every((v) => v.verdict === 'yes');
    let decision;
    if (hasNo) decision = 'fail';
    else if (hasUnsure) decision = 'escalate';
    else if (allYes) decision = 'pass';
    else decision = 'escalate';
    return { ...item, decision };
  });
}

/**
 * Majority aggregation (sync). Returns a full Aggregation record.
 *
 * @param {import('../constants/rubric').RubricItem[]} rubric
 * @param {Array<object>} allVotes
 * @returns {import('../types/run').Aggregation}
 */
export function aggregateMajority(rubric, allVotes) {
  const skeleton = buildChecklistSkeleton(rubric, allVotes);
  const checklist = applyMajority(skeleton);
  return {
    protocol: 'majority',
    checklist,
    judgeRationale: null,
    overall: rollupOverall(checklist),
  };
}

/**
 * Unanimity aggregation (sync). Returns a full Aggregation record.
 *
 * @param {import('../constants/rubric').RubricItem[]} rubric
 * @param {Array<object>} allVotes
 * @returns {import('../types/run').Aggregation}
 */
export function aggregateUnanimity(rubric, allVotes) {
  const skeleton = buildChecklistSkeleton(rubric, allVotes);
  const checklist = applyUnanimity(skeleton);
  return {
    protocol: 'unanimity',
    checklist,
    judgeRationale: null,
    overall: rollupOverall(checklist),
  };
}

/**
 * Judge aggregation (async). Computes the majority baseline first, then
 * calls a judge model to render the final verdict. On any failure the
 * baseline is returned unchanged with a note in the rationale, so the UI
 * is never blocked on a flaky judge.
 *
 * @typedef {Object} JudgeAggregationResult
 * @property {import('../types/run').Aggregation} aggregation
 * @property {{promptTokens:number, completionTokens:number, totalTokens:number}} usage
 * @property {number} wallClockMs
 * @property {{level:'info'|'warn'|'error', message:string}|null} logEntry
 *
 * @param {import('../constants/rubric').RubricItem[]} rubric
 * @param {Array<object>} allVotes
 * @param {string} judgeModelId   OpenRouter model id used for the judge
 * @param {{
 *   buildPrompt?: typeof buildJudgeAggregatorPrompt,
 *   buildRetryPrompt?: typeof buildStrictJudgeAggregatorRetryPrompt,
 *   systemPrompt?: string,
 * }} [prompts]                   optional rigor-level overrides; defaults
 *                                to machine-mode prompts so existing
 *                                callers keep their current behaviour.
 * @returns {Promise<JudgeAggregationResult>}
 */
export async function aggregateJudge(rubric, allVotes, judgeModelId, prompts = {}) {
  const buildPrompt = prompts.buildPrompt || buildJudgeAggregatorPrompt;
  const buildRetryPrompt = prompts.buildRetryPrompt || buildStrictJudgeAggregatorRetryPrompt;
  const systemPrompt = prompts.systemPrompt || SYSTEM_PROMPTS.aggregationJudge;

  const baseline = aggregateMajority(rubric, allVotes);
  const { aggregate, accumulate } = createUsageAggregator();

  let raw;
  try {
    const r = await queryModel(
      judgeModelId,
      [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: buildPrompt(rubric, baseline.checklist),
        },
      ],
      { temperature: 0.2, maxTokens: 1500 }
    );
    accumulate(r);
    raw = r.content;
  } catch (err) {
    return {
      aggregation: {
        ...baseline,
        protocol: 'judge',
        judgeRationale: `Judge call failed (${err.message || err}); falling back to majority baseline.`,
      },
      usage: aggregate.usage,
      wallClockMs: aggregate.wallClockMs,
      logEntry: {
        level: 'error',
        message: `Judge aggregator network/API failure: ${err.message || err}`,
      },
    };
  }

  let parsed = tryParseJsonObject(raw);
  let validated = parsed && JudgeAggregatorResponseSchema.safeParse(parsed);

  if (!validated || !validated.success) {
    try {
      const r2 = await queryModel(
        judgeModelId,
        [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: buildRetryPrompt(rubric, baseline.checklist),
          },
        ],
        { temperature: 0.1, maxTokens: 1500 }
      );
      accumulate(r2);
      parsed = tryParseJsonObject(r2.content);
      validated = parsed && JudgeAggregatorResponseSchema.safeParse(parsed);
    } catch (err) {
      return {
        aggregation: {
          ...baseline,
          protocol: 'judge',
          judgeRationale: `Judge retry failed (${err.message || err}); falling back to majority baseline.`,
        },
        usage: aggregate.usage,
        wallClockMs: aggregate.wallClockMs,
        logEntry: {
          level: 'error',
          message: `Judge aggregator strict retry failed: ${err.message || err}`,
        },
      };
    }
  }

  if (!validated || !validated.success) {
    return {
      aggregation: {
        ...baseline,
        protocol: 'judge',
        judgeRationale:
          'Judge aggregator returned invalid JSON on both attempts; falling back to majority baseline.',
      },
      usage: aggregate.usage,
      wallClockMs: aggregate.wallClockMs,
      logEntry: {
        level: 'error',
        message:
          'Judge aggregator returned invalid JSON on both attempts; falling back to majority baseline.',
      },
    };
  }

  // Apply the judge's per-item decisions over the baseline checklist. If
  // the judge skipped an item we keep the majority decision for it.
  const decisionById = new Map(
    validated.data.perItemDecisions.map((d) => [d.id, d.decision])
  );
  const judgedChecklist = baseline.checklist.map((item) =>
    decisionById.has(item.id)
      ? { ...item, decision: decisionById.get(item.id) }
      : item
  );

  return {
    aggregation: {
      protocol: 'judge',
      checklist: judgedChecklist,
      judgeRationale: validated.data.rationale || '',
      // Trust the judge's explicit overall, but if it is missing/invalid
      // roll it up from the judged checklist.
      overall: validated.data.overall || rollupOverall(judgedChecklist),
    },
    usage: aggregate.usage,
    wallClockMs: aggregate.wallClockMs,
    logEntry: null,
  };
}

/**
 * Dispatcher — pick the right protocol implementation. Sync protocols are
 * wrapped in a Promise.resolve for a uniform async interface.
 *
 * @param {'majority'|'unanimity'|'judge'} protocol
 * @param {import('../constants/rubric').RubricItem[]} rubric
 * @param {Array<object>} allVotes
 * @param {string} [judgeModelId]   required when protocol === 'judge'
 * @param {{
 *   buildPrompt?: typeof buildJudgeAggregatorPrompt,
 *   buildRetryPrompt?: typeof buildStrictJudgeAggregatorRetryPrompt,
 *   systemPrompt?: string,
 * }} [prompts]                     optional rigor-level overrides; only
 *                                  used by the judge protocol.
 * @returns {Promise<JudgeAggregationResult>}
 */
export async function aggregate(protocol, rubric, allVotes, judgeModelId, prompts = {}) {
  const empty = {
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    wallClockMs: 0,
    logEntry: null,
  };
  if (protocol === 'unanimity') {
    return { aggregation: aggregateUnanimity(rubric, allVotes), ...empty };
  }
  if (protocol === 'judge') {
    if (!judgeModelId) {
      return {
        aggregation: {
          ...aggregateMajority(rubric, allVotes),
          protocol: 'judge',
          judgeRationale:
            'No judge model configured; falling back to majority baseline.',
        },
        ...empty,
        logEntry: {
          level: 'warn',
          message: 'Judge protocol selected but no judge model provided; used majority.',
        },
      };
    }
    return aggregateJudge(rubric, allVotes, judgeModelId, prompts);
  }
  // Default / 'majority'
  return { aggregation: aggregateMajority(rubric, allVotes), ...empty };
}
