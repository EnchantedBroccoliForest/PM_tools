/**
 * Canonical rigor rubric for prediction-market drafts.
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
      'Are the outcomes mutually exclusive and collectively exhaustive (MECE)?',
    rationale:
      'Parimutuel markets require a partition of outcome space — overlapping outcomes double-count stakes and missing outcomes strand collateral.',
  },
  {
    id: 'objective_source',
    question:
      'Does each outcome have a clearly named, objectively verifiable resolution source?',
    rationale:
      'A source that is ambiguous, paywalled, or subject to editorial judgement turns the market into an opinion poll. Each outcome must cite a concrete source.',
  },
  {
    id: 'timing_unambiguous',
    question:
      'Are the start, end, and any tie-break timestamps unambiguous (explicit timezone, explicit cutoff)?',
    rationale:
      'Timezone drift and off-by-one date errors are the most common cause of disputed resolutions. UTC-anchored timestamps are the default.',
  },
  {
    id: 'manipulation_resistant',
    question:
      'Is the market resistant to manipulation or self-resolution by interested parties?',
    rationale:
      'Low-liquidity sources, resolver conflicts of interest, and self-referential outcomes (e.g., "if this market resolves X...") create perverse incentives.',
  },
  {
    id: 'atomic_claims',
    question:
      'Are the claims atomic and non-compound (no "X and Y" in a single outcome or rule)?',
    rationale:
      'Compound claims cannot be verified as a unit and hide ambiguity. Each rule should state exactly one testable proposition.',
  },
  {
    id: 'edge_cases_covered',
    question:
      'Are edge cases explicitly enumerated, with a named resolution for each (cancellations, postponements, source unavailable, etc.)?',
    rationale:
      'An unhandled edge case becomes a post-hoc dispute. The draft should list scenarios and say exactly how each resolves.',
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
