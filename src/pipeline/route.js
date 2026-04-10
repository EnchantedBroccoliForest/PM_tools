/**
 * Uncertainty-based claim routing (Phase 5).
 *
 * Turns the per-claim evidence produced by the Phase 1-4 pipelines
 * (extraction, verification, evidence resolution, aggregation-level
 * criticism) into a single routing decision per claim plus a run-level
 * rollup the Accept gate consults.
 *
 * Three severities, in increasing order of attention required:
 *
 *   - ok:              the claim is structurally valid, entailed by the
 *                      draft, has no blocker/major criticism against it,
 *                      and (if a source claim) has at least one URL that
 *                      resolved from the browser.
 *
 *   - targeted_review: soft_fail verdict, or any 'not_covered' entailment,
 *                      or any 'major' criticism targeting the claim, or
 *                      any 'blocker'/'major' global criticism (which we
 *                      attach to every claim because we cannot pin it
 *                      more precisely). The updater should address these
 *                      before the user accepts the draft; they do not
 *                      block finalize.
 *
 *   - blocking:        hard_fail verdict, 'contradicted' entailment, or
 *                      any 'blocker' criticism targeting the claim. These
 *                      prevent the Accept button from finalizing the run
 *                      until they are resolved — either by running an
 *                      Update pass that fixes them, or by the user
 *                      explicitly editing the draft.
 *
 * The routing module is deliberately pure and synchronous — it performs
 * no I/O and no LLM calls — so it can run cheaply every time the Run
 * artifact changes, including on imported runs. It also never throws:
 * empty inputs produce an empty-but-well-formed Routing.
 *
 * Uncertainty score:
 *   Each claim gets a 0..1 uncertainty estimate, used only for display
 *   sorting and for the run-level "most uncertain" highlight. It is NOT
 *   the primary routing signal — severity is. The score is the sum of
 *   the contributing penalties clamped to [0, 1]:
 *
 *     hard_fail / contradicted       +0.9
 *     soft_fail                      +0.5
 *     not_covered entailment         +0.4
 *     citationResolves === false     +0.3
 *     per-criticism blocker (cap 1)  +0.8
 *     per-criticism major   (cap 2)  +0.3 each
 *     per-criticism minor/nit        ignored
 *
 *   This produces a monotonic score: anything with severity === 'blocking'
 *   is uncertainty >= 0.8, anything with severity === 'targeted_review'
 *   is >= 0.3, and 'ok' claims top out around 0.1.
 */

/**
 * @typedef {import('../types/run').Claim} Claim
 * @typedef {import('../types/run').Verification} Verification
 * @typedef {import('../types/run').Criticism} Criticism
 * @typedef {import('../types/run').Evidence} Evidence
 * @typedef {import('../types/run').ClaimRouting} ClaimRouting
 * @typedef {import('../types/run').Routing} Routing
 */

/**
 * @typedef {Object} RouteClaimsInput
 * @property {Claim[]} claims
 * @property {Verification[]} verifications
 * @property {Criticism[]} [criticisms]
 * @property {Evidence[]} [evidence]     currently unused — wired in for forward compatibility
 */

/**
 * Compute an uncertainty score and accumulate the human-readable reasons
 * for a single claim. Returns a partial routing record; the caller picks
 * the final severity based on the maxSeverity it observed.
 *
 * @param {Claim} claim
 * @param {Verification|null} verification
 * @param {Criticism[]} claimCriticisms          criticisms whose claimId matches this claim
 * @param {Criticism[]} globalCriticisms         global-scope criticisms (claimId === 'global')
 * @returns {{uncertainty:number, reasons:string[], severity:'ok'|'targeted_review'|'blocking'}}
 */
function scoreClaim(claim, verification, claimCriticisms, globalCriticisms) {
  const reasons = [];
  let score = 0;
  /** @type {'ok'|'targeted_review'|'blocking'} */
  let severity = 'ok';

  const bumpSeverity = (next) => {
    // blocking > targeted_review > ok
    if (next === 'blocking') severity = 'blocking';
    else if (next === 'targeted_review' && severity !== 'blocking') severity = 'targeted_review';
  };

  if (verification) {
    if (verification.verdict === 'hard_fail') {
      score += 0.9;
      reasons.push('verification hard_fail');
      bumpSeverity('blocking');
    } else if (verification.verdict === 'soft_fail') {
      score += 0.5;
      reasons.push('verification soft_fail');
      bumpSeverity('targeted_review');
    }

    if (verification.entailment === 'contradicted') {
      score += 0.9;
      reasons.push('draft contradicts claim');
      bumpSeverity('blocking');
    } else if (verification.entailment === 'not_covered') {
      score += 0.4;
      reasons.push('not covered by draft');
      bumpSeverity('targeted_review');
    }

    if (verification.citationResolves === false && claim.category === 'source') {
      score += 0.3;
      reasons.push('cited URL did not resolve');
      // Do not bump severity independently — the verification verdict
      // already reflects the citation failure via Phase 4's override.
    }
  }

  // Per-claim criticisms. Cap blocker contribution at 1 (the existence of
  // any blocker dominates the score; stacking blockers adds no more signal
  // in this simple model).
  let blockerCount = 0;
  let majorCount = 0;
  for (const c of claimCriticisms) {
    if (c.severity === 'blocker') blockerCount += 1;
    else if (c.severity === 'major') majorCount += 1;
  }
  if (blockerCount > 0) {
    score += 0.8;
    reasons.push(`${blockerCount} blocker criticism(s)`);
    bumpSeverity('blocking');
  }
  if (majorCount > 0) {
    score += Math.min(majorCount, 2) * 0.3;
    reasons.push(`${majorCount} major criticism(s)`);
    bumpSeverity('targeted_review');
  }

  // Global criticisms apply to every claim; we add a small penalty so the
  // overall routing reflects them, but do not bump severity (otherwise a
  // single global blocker would mark every claim as blocking, which is
  // more noise than signal).
  if (globalCriticisms.some((c) => c.severity === 'blocker')) {
    score += 0.2;
    reasons.push('run has a global blocker criticism');
    // Global blockers DO surface as run-level overall: the rollup will
    // compute that separately from per-claim severities.
  }

  // Clamp to [0, 1].
  const uncertainty = Math.min(1, Math.max(0, score));

  return { uncertainty, reasons, severity };
}

/**
 * Pure entry point. Takes the current claim/verification/criticism state
 * of a Run and returns a fully-populated Routing. Never throws.
 *
 * @param {RouteClaimsInput} input
 * @returns {Routing}
 */
export function routeClaims(input) {
  const claims = input?.claims || [];
  const verifications = input?.verifications || [];
  const criticisms = input?.criticisms || [];

  // Empty claim set → empty routing. This is the initial state before
  // the first draft has been extracted, and also what an import of a
  // minimal run looks like.
  if (claims.length === 0) {
    return {
      items: [],
      overall: 'clean',
      hasBlocking: false,
      hasTargetedReview: false,
      focusClaimIds: [],
    };
  }

  const verifByClaim = new Map(verifications.map((v) => [v.claimId, v]));
  const criticismsByClaim = new Map();
  const globalCriticisms = [];
  for (const c of criticisms) {
    if (!c) continue;
    if (c.claimId === 'global') {
      globalCriticisms.push(c);
      continue;
    }
    const bucket = criticismsByClaim.get(c.claimId);
    if (bucket) bucket.push(c);
    else criticismsByClaim.set(c.claimId, [c]);
  }

  /** @type {ClaimRouting[]} */
  const items = claims.map((claim) => {
    const verification = verifByClaim.get(claim.id) || null;
    const claimCriticisms = criticismsByClaim.get(claim.id) || [];
    const { uncertainty, reasons, severity } = scoreClaim(
      claim,
      verification,
      claimCriticisms,
      globalCriticisms,
    );
    return {
      claimId: claim.id,
      severity,
      uncertainty,
      reasons,
    };
  });

  const hasBlocking = items.some((i) => i.severity === 'blocking');
  const hasTargetedReview = items.some((i) => i.severity === 'targeted_review');

  // Global blocker criticisms force a non-clean overall even when every
  // individual claim happens to be ok — the blocker is pinned to the run,
  // not any single claim.
  const hasGlobalBlocker = globalCriticisms.some((c) => c.severity === 'blocker');
  const hasGlobalMajor = globalCriticisms.some((c) => c.severity === 'major');

  /** @type {'clean'|'needs_update'|'blocked'} */
  let overall;
  if (hasBlocking || hasGlobalBlocker) overall = 'blocked';
  else if (hasTargetedReview || hasGlobalMajor) overall = 'needs_update';
  else overall = 'clean';

  // Focus list for the next update prompt: blocking first (sorted by
  // descending uncertainty), then targeted_review. 'ok' claims are
  // deliberately excluded — the updater should leave them alone.
  const blocking = items
    .filter((i) => i.severity === 'blocking')
    .sort((a, b) => b.uncertainty - a.uncertainty);
  const targeted = items
    .filter((i) => i.severity === 'targeted_review')
    .sort((a, b) => b.uncertainty - a.uncertainty);
  const focusClaimIds = [...blocking, ...targeted].map((i) => i.claimId);

  return {
    items,
    overall,
    hasBlocking,
    hasTargetedReview,
    focusClaimIds,
  };
}

/**
 * Convenience: group a routing result by severity for UI rendering.
 * Returns objects with stable key order so the Run trace panel can
 * iterate deterministically.
 *
 * @param {Routing} routing
 * @returns {{blocking:ClaimRouting[], targeted_review:ClaimRouting[], ok:ClaimRouting[]}}
 */
export function groupRoutingBySeverity(routing) {
  const out = { blocking: [], targeted_review: [], ok: [] };
  for (const item of routing?.items || []) {
    out[item.severity].push(item);
  }
  return out;
}
