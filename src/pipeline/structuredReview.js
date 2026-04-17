/**
 * Structured review pipeline.
 *
 * Runs a single reviewer model against the draft with the Phase 2 structured
 * review prompt, which asks for a JSON object containing:
 *
 *   - reviewProse:    a paragraph-length critique (carried into the UI's
 *                     existing reviews[] list so the Panel 2 view is
 *                     unchanged for humans)
 *   - rubricVotes:    one {verdict, rationale} per rubric item (feeds the
 *                     Phase 2 aggregator)
 *   - criticisms:     real Criticism records, not the synthetic Phase 1
 *                     projection
 *
 * The function never throws. On any failure it returns null fields plus a
 * structured logEntry the caller should surface via RUN_LOG. One strict-
 * JSON retry is attempted on parse failures.
 *
 * Why one pass instead of two (prose + rubric separately)? Two passes
 * double the API bill and let the prose and votes drift out of sync, which
 * defeats the whole point of grounding aggregation in the same review.
 */

import { queryModel } from '../api/openrouter.js';
import {
  SYSTEM_PROMPTS,
  buildStructuredReviewPrompt,
  buildStrictStructuredReviewRetryPrompt,
} from '../constants/prompts.js';
import { StructuredReviewResponseSchema } from '../types/run.js';
import { tryParseJsonObject, createUsageAggregator } from './llmJson.js';

/**
 * @typedef {Object} StructuredReviewResult
 * @property {string}   model                reviewer model id
 * @property {string}   modelName            human-readable reviewer name
 * @property {string|null} reviewProse       prose critique (null on failure)
 * @property {import('../types/run').Vote[]} rubricVotes  rubric votes attributed to this reviewer (empty on failure)
 * @property {import('../types/run').Criticism[]} criticisms  real criticisms (empty on failure)
 * @property {{promptTokens:number, completionTokens:number, totalTokens:number}|null} usage
 * @property {number|null} wallClockMs
 * @property {{level:'info'|'warn'|'error', message:string}|null} logEntry
 */

/**
 * Run one structured review pass.
 *
 * @param {{id:string, name:string}} model        reviewer
 * @param {string} draftContent                   the draft being reviewed
 * @param {import('../constants/rubric').RubricItem[]} rubric
 * @param {string} [numberOfOutcomes]             optional hard restriction on
 *                                                the outcome-set cardinality;
 *                                                empty string means no
 *                                                restriction (default).
 * @returns {Promise<StructuredReviewResult>}
 */
export async function runStructuredReview(model, draftContent, rubric, numberOfOutcomes = '') {
  const rubricIds = new Set(rubric.map((r) => r.id));
  const { aggregate, accumulate } = createUsageAggregator();

  // Attempt 1
  let raw;
  try {
    const r = await queryModel(
      model.id,
      [
        { role: 'system', content: SYSTEM_PROMPTS.structuredReviewer },
        { role: 'user', content: buildStructuredReviewPrompt(draftContent, rubric, numberOfOutcomes) },
      ],
      { temperature: 0.4, maxTokens: 3000 }
    );
    accumulate(r);
    raw = r.content;
  } catch (err) {
    return {
      model: model.id,
      modelName: model.name,
      reviewProse: null,
      rubricVotes: [],
      criticisms: [],
      usage: aggregate.usage,
      wallClockMs: aggregate.wallClockMs,
      logEntry: {
        level: 'error',
        message: `Structured review network/API failure (${model.name}): ${err.message || err}`,
      },
    };
  }

  let parsed = tryParseJsonObject(raw);
  let validated = parsed && StructuredReviewResponseSchema.safeParse(parsed);

  // Attempt 2 — strict retry
  if (!validated || !validated.success) {
    try {
      const r2 = await queryModel(
        model.id,
        [
          { role: 'system', content: SYSTEM_PROMPTS.structuredReviewer },
          {
            role: 'user',
            content: buildStrictStructuredReviewRetryPrompt(draftContent, rubric, numberOfOutcomes),
          },
        ],
        { temperature: 0.2, maxTokens: 3000 }
      );
      accumulate(r2);
      parsed = tryParseJsonObject(r2.content);
      validated = parsed && StructuredReviewResponseSchema.safeParse(parsed);
    } catch (err) {
      return {
        model: model.id,
        modelName: model.name,
        reviewProse: null,
        rubricVotes: [],
        criticisms: [],
        usage: aggregate.usage,
        wallClockMs: aggregate.wallClockMs,
        logEntry: {
          level: 'error',
          message: `Structured review strict retry failed (${model.name}): ${err.message || err}`,
        },
      };
    }
  }

  if (!validated || !validated.success) {
    return {
      model: model.id,
      modelName: model.name,
      reviewProse: null,
      rubricVotes: [],
      criticisms: [],
      usage: aggregate.usage,
      wallClockMs: aggregate.wallClockMs,
      logEntry: {
        level: 'error',
        message: `Structured review returned invalid JSON on both attempts (${model.name}); falling back.`,
      },
    };
  }

  const data = validated.data;

  // Drop votes for unknown rubric ids. A reviewer that invents a rubric
  // item isn't wrong in an interesting way — it just means we should
  // ignore that vote rather than crash the aggregator. We warn via the
  // log so the drift is visible in the run trace.
  const validVotes = data.rubricVotes.filter((v) => rubricIds.has(v.ruleId));
  const droppedCount = data.rubricVotes.length - validVotes.length;

  // Project rubricVotes → Vote objects carrying the reviewer model id.
  // These are consumed by the aggregator to build ChecklistItems.
  const rubricVotesWithModel = validVotes.map((v) => ({
    ruleId: v.ruleId,
    reviewerModel: model.id,
    verdict: v.verdict,
    rationale: v.rationale || '',
  }));

  // Project structured criticisms → Run-level Criticism records. A stable
  // id scheme is required for downstream features (e.g. Phase 3
  // verification can reference criticisms by id).
  const now = Date.now();
  const criticisms = data.criticisms.map((c, i) => ({
    id: `criticism.${now}.${model.id}.${i}`,
    reviewerModel: model.id,
    claimId: c.claimId,
    severity: c.severity,
    category: c.category,
    rationale: c.rationale,
  }));

  const logEntry =
    droppedCount > 0
      ? {
          level: 'warn',
          message: `Structured review (${model.name}) produced ${droppedCount} vote(s) with unknown rubric ids; ignored.`,
        }
      : null;

  return {
    model: model.id,
    modelName: model.name,
    reviewProse: data.reviewProse,
    rubricVotes: rubricVotesWithModel,
    criticisms,
    usage: aggregate.usage,
    wallClockMs: aggregate.wallClockMs,
    logEntry,
  };
}

/**
 * Run structured review in parallel across a list of reviewers. Failures
 * are surfaced inside each result (logEntry + null prose) rather than
 * rejecting the whole promise.
 *
 * @param {Array<{id:string, name:string}>} models
 * @param {string} draftContent
 * @param {import('../constants/rubric').RubricItem[]} rubric
 * @param {string} [numberOfOutcomes]  optional hard restriction on the
 *                                     outcome-set cardinality (propagated to
 *                                     every reviewer); empty string = no
 *                                     restriction.
 * @returns {Promise<StructuredReviewResult[]>}
 */
export async function runStructuredReviewsParallel(models, draftContent, rubric, numberOfOutcomes = '') {
  const settled = await Promise.allSettled(
    models.map((m) => runStructuredReview(m, draftContent, rubric, numberOfOutcomes))
  );
  return settled.map((s, i) => {
    if (s.status === 'fulfilled') return s.value;
    return {
      model: models[i].id,
      modelName: models[i].name,
      reviewProse: null,
      rubricVotes: [],
      criticisms: [],
      usage: null,
      wallClockMs: null,
      logEntry: {
        level: 'error',
        message: `Structured review rejected (${models[i].name}): ${s.reason?.message || s.reason}`,
      },
    };
  });
}
