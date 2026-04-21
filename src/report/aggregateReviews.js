/**
 * Reviewer rollup for the report renderer.
 *
 * The raw reviewer stream on a Run is `criticisms[]` plus an
 * `aggregation.checklist[]`. Rendering each reviewer's prose verbatim is
 * bulky and repeats the same substantive points three times over — this
 * module collapses reviewers into:
 *
 *   - a single verdict with a dissent count
 *   - a list of points ≥ 2 reviewers raised (with the reviewer short ids
 *     that agreed)
 *   - a list of disagreements, one per claim, with each side in one line
 *
 * Pure data transform — no I/O, no LLM calls. Input: the Run. Output:
 * structured rollup objects the renderer formats as text or HTML.
 */

/**
 * @typedef {Object} ReviewerInfo
 * @property {string} modelId
 * @property {string} shortId  R1, R2, ...
 */

/**
 * @typedef {Object} AgreementPoint
 * @property {string} key             normalised fingerprint of the point
 * @property {string} claimId
 * @property {string|null} claimShortId
 * @property {string} category        criticism category
 * @property {string} severity        worst severity observed
 * @property {string} rationale       representative rationale text
 * @property {string[]} reviewers     reviewer short ids that raised it
 * @property {string[]} criticismShortIds   the R<n> ids of the underlying criticism records
 */

/**
 * @typedef {Object} DisagreementPoint
 * @property {string} claimId
 * @property {string|null} claimShortId
 * @property {Array<{reviewer:string, verdict:'raised'|'silent', severity?:string, rationale?:string}>} sides
 * @property {string[]} reviewers
 * @property {string[]} criticismShortIds
 */

/**
 * @typedef {Object} ReviewerRollup
 * @property {string} verdict                 pass | fail | needs_escalation | no_review
 * @property {number} reviewerCount
 * @property {number} dissentCount
 * @property {string[]} dissenters            reviewer short ids
 * @property {ReviewerInfo[]} reviewers
 * @property {AgreementPoint[]} agreements
 * @property {DisagreementPoint[]} disagreements
 * @property {{blocker:number, major:number, minor:number, nit:number}} severityCounts
 */

const SEVERITY_RANK = { blocker: 4, major: 3, minor: 2, nit: 1 };

/**
 * Rank-based max for severities. Returns the worst severity seen in the
 * input list; defaults to 'nit' if empty.
 *
 * @param {string[]} severities
 * @returns {string}
 */
function worstSeverity(severities) {
  let best = 'nit';
  let bestRank = 0;
  for (const s of severities) {
    const r = SEVERITY_RANK[s] || 0;
    if (r > bestRank) { bestRank = r; best = s; }
  }
  return best;
}

/**
 * Normalise a criticism fingerprint so "the same point raised by two
 * reviewers" collides to a single key. We use `claimId + category` — not
 * the rationale text, which varies word-for-word between reviewers even
 * when the substantive complaint is identical.
 */
function fingerprint(criticism) {
  return `${criticism.claimId}::${criticism.category}`;
}

/**
 * Assign reviewer short ids (R1..Rn) based on first-appearance order in
 * the criticism stream. When no criticisms are present, fall back to
 * `aggregation.checklist[*].votes[*].reviewerModel`.
 *
 * @param {import('../types/run.js').Run} run
 * @returns {ReviewerInfo[]}
 */
export function reviewerList(run) {
  const seen = new Map();
  const order = [];
  for (const c of run?.criticisms || []) {
    if (!seen.has(c.reviewerModel)) {
      seen.set(c.reviewerModel, true);
      order.push(c.reviewerModel);
    }
  }
  for (const item of run?.aggregation?.checklist || []) {
    for (const v of item.votes || []) {
      if (!seen.has(v.reviewerModel)) {
        seen.set(v.reviewerModel, true);
        order.push(v.reviewerModel);
      }
    }
  }
  return order.map((modelId, i) => ({ modelId, shortId: `R${i + 1}` }));
}

/**
 * Main entry point. Returns a structured rollup the renderer can format
 * without thinking about voting semantics.
 *
 * @param {import('../types/run.js').Run} run
 * @returns {ReviewerRollup}
 */
export function aggregateReviewerFindings(run) {
  const reviewers = reviewerList(run);
  const reviewerShortById = new Map(reviewers.map((r) => [r.modelId, r.shortId]));
  const claimShortById = new Map(
    (run?.claims || []).map((c, i) => [c.id, c.shortId || `C${i + 1}`]),
  );

  const criticisms = run?.criticisms || [];

  // Group criticisms by fingerprint (claim + category).
  /** @type {Map<string, Array<{criticism:any, reviewer:string}>>} */
  const groups = new Map();
  criticisms.forEach((c, i) => {
    const key = fingerprint(c);
    const reviewerShort = reviewerShortById.get(c.reviewerModel) || c.reviewerModel;
    const criticismShort = c.shortId || `R${i + 1}`;
    // Note: reviewer short id and criticism short id can collide in the
    // R<n> namespace — criticisms number up from R1 independently of
    // reviewer numbering. The renderer disambiguates with context.
    const bucket = groups.get(key) || [];
    bucket.push({ criticism: { ...c, shortId: criticismShort }, reviewer: reviewerShort });
    groups.set(key, bucket);
  });

  /** @type {AgreementPoint[]} */
  const agreements = [];
  /** @type {DisagreementPoint[]} */
  const disagreements = [];

  for (const [key, entries] of groups.entries()) {
    const reviewersRaised = [...new Set(entries.map((e) => e.reviewer))];
    const severities = entries.map((e) => e.criticism.severity);
    const rationale = entries[0].criticism.rationale || '';
    const claimId = entries[0].criticism.claimId;
    const category = entries[0].criticism.category;
    const claimShortId = claimShortById.get(claimId) || null;
    const criticismShortIds = entries.map((e) => e.criticism.shortId);

    if (reviewersRaised.length >= 2) {
      agreements.push({
        key,
        claimId,
        claimShortId,
        category,
        severity: worstSeverity(severities),
        rationale,
        reviewers: reviewersRaised,
        criticismShortIds,
      });
    } else if (reviewers.length > 1) {
      // Exactly one reviewer raised this point while at least one other
      // reviewer was present — a disagreement worth surfacing.
      const raiser = reviewersRaised[0];
      const silent = reviewers
        .map((r) => r.shortId)
        .filter((sid) => sid !== raiser);
      disagreements.push({
        claimId,
        claimShortId,
        sides: [
          { reviewer: raiser, verdict: 'raised', severity: worstSeverity(severities), rationale },
          ...silent.map((sid) => ({ reviewer: sid, verdict: 'silent' })),
        ],
        reviewers: [raiser, ...silent],
        criticismShortIds,
      });
    }
  }

  // Severity counts (across all criticisms, not just grouped ones).
  const severityCounts = { blocker: 0, major: 0, minor: 0, nit: 0 };
  for (const c of criticisms) {
    if (severityCounts[c.severity] !== undefined) severityCounts[c.severity] += 1;
  }

  // Verdict + dissent: if we have an aggregation, lift it. Otherwise
  // derive from the worst severity observed.
  let verdict = run?.aggregation?.overall || 'no_review';
  const dissenters = [];
  if (run?.aggregation?.checklist) {
    // Dissent is any reviewer whose per-item votes disagree with the
    // aggregated decision on any item. Cheap approximation suitable for
    // a one-line rollup.
    for (const item of run.aggregation.checklist) {
      const want = item.decision === 'pass' ? 'yes' : item.decision === 'fail' ? 'no' : null;
      if (!want) continue;
      for (const v of item.votes || []) {
        if (v.verdict !== want) {
          const sid = reviewerShortById.get(v.reviewerModel);
          if (sid && !dissenters.includes(sid)) dissenters.push(sid);
        }
      }
    }
  }

  return {
    verdict,
    reviewerCount: reviewers.length,
    dissentCount: dissenters.length,
    dissenters,
    reviewers,
    agreements: agreements.sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    ),
    disagreements,
    severityCounts,
  };
}

/**
 * Render a rubric table for a single reviewer at `--level full` / `--expand
 * reviewers`. Returns an array of `{ id, verdict, reason }` ready to format.
 *
 * @param {import('../types/run.js').Run} run
 * @param {string} reviewerModelId
 * @returns {Array<{id:string, question:string, verdict:string, reason:string}>}
 */
export function rubricForReviewer(run, reviewerModelId) {
  const items = run?.aggregation?.checklist || [];
  return items.map((item) => {
    const vote = (item.votes || []).find((v) => v.reviewerModel === reviewerModelId);
    return {
      id: item.id,
      question: item.question,
      verdict: vote?.verdict || 'missing',
      reason: vote?.rationale || '',
    };
  });
}
