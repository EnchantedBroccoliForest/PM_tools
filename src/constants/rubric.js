/**
 * Canonical rigor rubric for 42.space market drafts.
 *
 * 42 is an Events Futures protocol: each outcome spawns its own Outcome
 * Token on a bonding curve, and at the deadline trading halts and ALL
 * collateral committed to losing tokens is redistributed parimutuel pro-rata
 * to holders of the winning token. Every rubric item is phrased so it
 * catches a real failure mode of THAT mechanism — not a generic Polymarket /
 * CTF / LMSR concern.
 *
 * Each rubric item is a yes/no/unsure question a reviewer answers about the
 * draft. The set is intentionally small (six items) so reviewers can fill it
 * out reliably in one pass — the brief's warning against "consensus is not
 * verification" means we want a tight, well-understood checklist rather than
 * an ad-hoc long tail.
 *
 * Rubric items are referenced by id from structured review responses and
 * carried through into `ChecklistItem.id` inside the Run artifact.
 *
 * Phase 2 uses this rubric for rubric-level aggregation. Later phases may
 * extend the rubric with claim-level items, but the id space stays stable:
 * callers should treat an unknown id as non-applicable rather than crash.
 */

/**
 * @typedef {Object} RubricItem
 * @property {string} id         short stable identifier (snake_case)
 * @property {string} question   the yes/no question posed to reviewers
 * @property {string} rationale  brief explanation of why this matters; shown
 *                               in the UI tooltip and included in the
 *                               structured review prompt so reviewers
 *                               understand the intent of each item
 */

/** @type {RubricItem[]} */
export const RIGOR_RUBRIC = [
  {
    id: 'mece',
    question:
      'Is the outcome set MECE — every plausible result mapped to exactly one Outcome Token, with a catch-all if the space is not provably closed?',
    rationale:
      '42 spawns one Outcome Token per outcome and settles parimutuel pro-rata to the winner. Overlapping outcomes break pro-rata math; missing outcomes permanently strand real collateral on losing tokens with no path to redistribution. A catch-all "Other / None" is required unless the field is provably closed.',
  },
  {
    id: 'objective_source',
    question:
      'Does the resolution map onto a clearly named, machine-readable, objectively verifiable source that an oracle (e.g. APRO) can read deterministically?',
    rationale:
      'A source that is ambiguous, paywalled, editorial, interpretive, or self-referential turns the market into an opinion poll and breaks 42\'s objective-oracle settlement pipeline. Sources must be official scoreboards, awards-body announcements, government / exchange feeds, on-chain data, or official APIs.',
  },
  {
    id: 'timing_unambiguous',
    question:
      'Are the start, parimutuel cutoff (end), and any tie-break timestamps unambiguous (explicit UTC, explicit cutoff)?',
    rationale:
      'On 42 the end timestamp is the hard parimutuel cutoff at which trading halts and settlement begins. Timezone drift and off-by-one date errors are the most common cause of disputed resolutions. UTC-anchored timestamps are required.',
  },
  {
    id: 'manipulation_resistant',
    question:
      'Is the market resistant to manipulation or self-resolution by interested parties (including 42 traders themselves)?',
    rationale:
      'Low-liquidity sources, resolver conflicts of interest, and self-referential outcomes ("if 42 users vote X...", "if this OT trades above $Y...") create direct arbitrage incentives because traders also hold the winning collateral pool.',
  },
  {
    id: 'atomic_claims',
    question:
      'Are the claims atomic and non-compound (no "X and Y" in a single outcome win condition or rule)?',
    rationale:
      'Compound win conditions cannot be verified as a unit and hide ambiguity that breaks the deterministic single-winner settlement. Each Outcome Token must encode exactly one testable proposition.',
  },
  {
    id: 'edge_cases_covered',
    question:
      'Are edge cases explicitly enumerated, each terminating in a NAMED outcome from the outcome set (cancellations, postponements, source unavailable, ties, "no listed outcome occurred", etc.)?',
    rationale:
      'On 42 every edge case must terminate in one of the spawned Outcome Tokens — there is no LP layer or residual liquidity to absorb undefined cases. "Resolver discretion" without a named fallback is a stranded-collateral risk and is blocking.',
  },
];

/** Convenience index for O(1) lookup by id. */
export const RUBRIC_BY_ID = Object.fromEntries(
  RIGOR_RUBRIC.map((item) => [item.id, item])
);

/**
 * Aggregation protocol ids. Exported as a plain array so the UI can render
 * a dropdown and the reducer can validate SET_FIELD values without
 * importing a zod schema at render time.
 */
export const AGGREGATION_PROTOCOLS = /** @type {const} */ ([
  'majority',
  'unanimity',
  'judge',
]);
