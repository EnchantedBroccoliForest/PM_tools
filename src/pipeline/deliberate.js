/**
 * Deliberation round for the structured review pipeline.
 *
 * Implements the "Deliberate → Aggregate" pattern from llm-council-governance
 * research, which demonstrated a +5.6% accuracy improvement over independent
 * voting when council members see each other's reasoning before finalizing.
 *
 * The deliberation flow:
 *   1. Run independent structured reviews in parallel (existing pipeline)
 *   2. Format a summary of all reviewers' votes + rationales
 *   3. Each reviewer sees the summary and produces a revised vote
 *   4. The revised votes proceed to the existing aggregation pipeline
 *
 * The deliberation round is optional — controlled by the `deliberation`
 * option in the pipeline config. When disabled, the pipeline behaves
 * exactly as before (independent reviews → aggregate).
 *
 * Key design decisions (informed by the governance study):
 *   - Model diversity > sampling: deliberation uses the same diverse
 *     reviewer set, not repeated calls to a single model.
 *   - Deliberation only on disagreement: if all reviewers agree on every
 *     rubric item, the deliberation round is skipped (the study shows
 *     governance structures matter most under disagreement).
 *   - Mind-change tracking: the module logs which reviewers changed their
 *     votes after seeing peer reasoning, for diagnostics.
 */

import { queryModel } from '../api/openrouter.js';
import { SYSTEM_PROMPTS } from '../constants/prompts.js';
import { StructuredReviewResponseSchema } from '../types/run.js';

/** Same JSON salvage logic as other pipeline modules. */
function tryParseJson(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenced ? fenced[1] : trimmed;
  const braced = candidate.match(/\{[\s\S]*\}/);
  const final = braced ? braced[0] : candidate;
  try {
    return JSON.parse(final);
  } catch {
    return null;
  }
}

/**
 * Check whether all reviewers agree on every rubric item. If so,
 * deliberation adds no value (per the governance study: when all agree,
 * accuracy is ~97-100% regardless of structure).
 *
 * @param {Array<import('./structuredReview.js').StructuredReviewResult>} reviews
 * @returns {boolean} true if all reviews agree on all rubric items
 */
export function hasUnanimousAgreement(reviews) {
  const successful = reviews.filter((r) => r.reviewProse !== null);
  if (successful.length < 2) return true; // nothing to disagree on

  // Group votes by ruleId, tracking which reviewers voted on each
  const byRule = new Map();
  for (const review of successful) {
    for (const vote of review.rubricVotes) {
      if (!byRule.has(vote.ruleId)) byRule.set(vote.ruleId, { verdicts: new Set(), voterCount: 0 });
      const entry = byRule.get(vote.ruleId);
      entry.verdicts.add(vote.verdict);
      entry.voterCount += 1;
    }
  }

  // If any rule has multiple distinct verdicts, or any reviewer omitted
  // a rule that others voted on, treat it as disagreement.
  for (const { verdicts, voterCount } of byRule.values()) {
    if (verdicts.size > 1) return false;
    if (voterCount < successful.length) return false;
  }
  return true;
}

/**
 * Format a peer-review summary for a single reviewer to consume during
 * deliberation. Excludes the target reviewer's own votes so they are
 * influenced by peers, not by re-reading their own output.
 *
 * @param {Array<import('./structuredReview.js').StructuredReviewResult>} reviews
 * @param {string} excludeModel  model id to exclude (the reviewer receiving this summary)
 * @param {import('../constants/rubric.js').RubricItem[]} rubric
 * @returns {string}
 */
export function formatPeerSummary(reviews, excludeModel /* rubric */) {
  const peers = reviews.filter(
    (r) => r.model !== excludeModel && r.reviewProse !== null,
  );

  if (peers.length === 0) return '(no peer reviews available)';

  const sections = peers.map((peer) => {
    const voteSummary = peer.rubricVotes
      .map((v) => {
        return `    ${v.ruleId}: ${v.verdict} — ${v.rationale}`;
      })
      .join('\n');

    const criticismSummary =
      peer.criticisms.length > 0
        ? peer.criticisms
            .map((c) => `    [${c.severity}] ${c.category}: ${c.rationale}`)
            .join('\n')
        : '    (no criticisms)';

    return `--- ${peer.modelName} ---
Prose: ${peer.reviewProse}

Rubric votes:
${voteSummary}

Criticisms:
${criticismSummary}`;
  });

  return sections.join('\n\n');
}

/**
 * Build the deliberation prompt for a single reviewer.
 *
 * @param {string} draftContent
 * @param {string} peerSummary
 * @param {import('../constants/rubric.js').RubricItem[]} rubric
 * @returns {string}
 */
export function buildDeliberationReviewPrompt(draftContent, peerSummary, rubric) {
  const rubricBlock = rubric
    .map(
      (item, i) =>
        `  ${i + 1}. id: "${item.id}"\n     question: ${item.question}\n     rationale: ${item.rationale}`,
    )
    .join('\n');

  return `You previously reviewed a 42.space market draft independently. Below are the votes and reasoning from other independent reviewers. You must now RECONSIDER your assessment in light of their perspectives.

DELIBERATION RULES (from governance research):
  - If a peer raised a valid concern you missed, acknowledge it and revise your vote accordingly.
  - If peers dismissed a concern you raised, re-evaluate: either strengthen your rationale or concede if their argument is stronger.
  - Do NOT drift toward consensus for its own sake. If you have strong evidence for a "no" vote and peers voted "yes" without addressing your specific concern, HOLD your "no".
  - Do NOT downgrade severity just because peers disagreed. Use the highest severity justified on the merits.
  - Actively look for concerns that NO reviewer (including yourself) flagged in the first round.

PEER REVIEWS:
${peerSummary}

ORIGINAL DRAFT:
${draftContent}

RUBRIC (re-vote on every item):
${rubricBlock}

Produce a single JSON object with the same schema as before:
{
  "reviewProse": "Your revised critique incorporating peer insights. Note what you changed and why.",
  "rubricVotes": [
    { "ruleId": "<rubric id>", "verdict": "yes" | "no" | "unsure", "rationale": "..." }
  ],
  "criticisms": [
    { "claimId": "...", "severity": "blocker" | "major" | "minor" | "nit", "category": "...", "rationale": "..." }
  ]
}

OUTPUT RULES:
  - Output ONLY the JSON object. No markdown fences, no prose before or after.
  - rubricVotes MUST contain exactly one entry per rubric id, in the order given.
  - In your reviewProse, explicitly state which votes you changed and why.`;
}

/**
 * Track which votes changed between the initial and deliberated rounds.
 *
 * @param {Array<{ruleId:string, verdict:string}>} initial
 * @param {Array<{ruleId:string, verdict:string}>} revised
 * @returns {Array<{ruleId:string, from:string, to:string}>}
 */
export function trackMindChanges(initial, revised) {
  const initialByRule = new Map(initial.map((v) => [v.ruleId, v.verdict]));
  const changes = [];
  for (const v of revised) {
    const prev = initialByRule.get(v.ruleId);
    if (prev && prev !== v.verdict) {
      changes.push({ ruleId: v.ruleId, from: prev, to: v.verdict });
    }
  }
  return changes;
}

/**
 * Run a deliberation round for a single reviewer. Takes the initial reviews
 * from all reviewers and produces a revised review for the target model.
 *
 * Never throws — returns the original review on any failure.
 *
 * @param {{id:string, name:string}} model
 * @param {string} draftContent
 * @param {import('../constants/rubric.js').RubricItem[]} rubric
 * @param {Array<import('./structuredReview.js').StructuredReviewResult>} allInitialReviews
 * @returns {Promise<{review: import('./structuredReview.js').StructuredReviewResult, mindChanges: Array, logEntry: {level:string, message:string}|null}>}
 */
export async function runDeliberationRound(model, draftContent, rubric, allInitialReviews) {
  const rubricIds = new Set(rubric.map((r) => r.id));
  const peerSummary = formatPeerSummary(allInitialReviews, model.id, rubric);
  const prompt = buildDeliberationReviewPrompt(draftContent, peerSummary, rubric);

  // Find the original review for this model
  const originalReview = allInitialReviews.find((r) => r.model === model.id);

  let raw;
  try {
    const r = await queryModel(
      model.id,
      [
        { role: 'system', content: SYSTEM_PROMPTS.structuredReviewer },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.3, maxTokens: 3000 },
    );
    raw = r.content;

    const parsed = tryParseJson(raw);
    const validated = parsed && StructuredReviewResponseSchema.safeParse(parsed);

    if (!validated || !validated.success) {
      return {
        review: originalReview,
        mindChanges: [],
        logEntry: {
          level: 'warn',
          message: `Deliberation round returned invalid JSON for ${model.name}; using initial review.`,
        },
      };
    }

    const data = validated.data;
    const validVotes = data.rubricVotes.filter((v) => rubricIds.has(v.ruleId));
    const rubricVotesWithModel = validVotes.map((v) => ({
      ruleId: v.ruleId,
      reviewerModel: model.id,
      verdict: v.verdict,
      rationale: v.rationale || '',
    }));

    const now = Date.now();
    const criticisms = data.criticisms.map((c, i) => ({
      id: `criticism.delib.${now}.${model.id}.${i}`,
      reviewerModel: model.id,
      claimId: c.claimId,
      severity: c.severity,
      category: c.category,
      rationale: c.rationale,
    }));

    // Track mind changes
    const initialVotes = originalReview?.rubricVotes || [];
    const mindChanges = trackMindChanges(initialVotes, rubricVotesWithModel);

    const revisedReview = {
      model: model.id,
      modelName: model.name,
      reviewProse: data.reviewProse,
      rubricVotes: rubricVotesWithModel,
      criticisms,
      usage: r.usage,
      wallClockMs: r.wallClockMs,
      logEntry: null,
    };

    return {
      review: revisedReview,
      mindChanges,
      logEntry: mindChanges.length > 0
        ? {
            level: 'info',
            message: `Deliberation: ${model.name} changed ${mindChanges.length} vote(s): ${mindChanges.map((c) => `${c.ruleId} ${c.from}→${c.to}`).join(', ')}.`,
          }
        : {
            level: 'info',
            message: `Deliberation: ${model.name} held all votes after seeing peer reasoning.`,
          },
    };
  } catch (err) {
    return {
      review: originalReview,
      mindChanges: [],
      logEntry: {
        level: 'warn',
        message: `Deliberation round failed for ${model.name}: ${err.message || err}; using initial review.`,
      },
    };
  }
}

/**
 * Run a full deliberation round across all reviewers in parallel.
 * Returns the revised reviews and an aggregate mind-change summary.
 *
 * @param {Array<{id:string, name:string}>} models
 * @param {string} draftContent
 * @param {import('../constants/rubric.js').RubricItem[]} rubric
 * @param {Array<import('./structuredReview.js').StructuredReviewResult>} initialReviews
 * @returns {Promise<{reviews: Array, mindChanges: Array, logEntries: Array}>}
 */
export async function runDeliberationParallel(models, draftContent, rubric, initialReviews) {
  const successfulModels = models.filter((m) =>
    initialReviews.some((r) => r.model === m.id && r.reviewProse !== null),
  );

  const settled = await Promise.allSettled(
    successfulModels.map((m) =>
      runDeliberationRound(m, draftContent, rubric, initialReviews),
    ),
  );

  const reviews = [];
  const allMindChanges = [];
  const logEntries = [];

  for (let i = 0; i < settled.length; i++) {
    if (settled[i].status === 'fulfilled') {
      const { review, mindChanges, logEntry } = settled[i].value;
      if (review) reviews.push(review);
      allMindChanges.push(...mindChanges);
      if (logEntry) logEntries.push(logEntry);
    } else {
      // Fallback to initial review
      const original = initialReviews.find(
        (r) => r.model === successfulModels[i].id,
      );
      if (original) reviews.push(original);
      logEntries.push({
        level: 'warn',
        message: `Deliberation rejected for ${successfulModels[i].name}: ${settled[i].reason?.message || settled[i].reason}; using initial review.`,
      });
    }
  }

  // Include initial reviews for models that didn't participate in deliberation
  // (i.e., models whose initial review failed)
  for (const review of initialReviews) {
    if (!reviews.some((r) => r.model === review.model)) {
      reviews.push(review);
    }
  }

  return { reviews, mindChanges: allMindChanges, logEntries };
}
