/**
 * Deterministic short-id assignment for a Run artifact.
 *
 * Every referenceable item in a Run gets a short, human-readable id:
 *
 *   - C1..Cn    for claims            (run.claims[i].shortId)
 *   - CR1..CRn  for criticisms        (run.criticisms[i].shortId)
 *   - S1..Sn    for sources/evidence  (run.evidence[i].shortId)
 *   - E1..En    for stage log events  (run.log[i].shortId)
 *
 * A fifth namespace, RV#, is assigned at render time (see
 * aggregateReviews.js) for reviewer identities. Every prefix is
 * lexically disjoint — `C`, `CR`, `S`, `E`, `RV` — so a token in
 * rendered output unambiguously identifies one entity kind without
 * relying on surrounding context.
 *
 * IDs are derived from array order and are therefore stable for any
 * given Run JSON: the same Run re-read produces the same ids. The
 * report renderer uses these ids everywhere, and the `--expand` / trace
 * machinery relies on them as lookup keys.
 *
 * This helper is called at production time (end of `orchestrate()`) so
 * the ids land on the canonical Run artifact; the report renderer also
 * calls it idempotently on imported runs that pre-date the field, so
 * legacy artifacts still render with stable references.
 */

/**
 * Assign short ids to every referenceable item on a Run. Mutates `run` in
 * place and returns it so the call can be chained.
 *
 * @param {import('../types/run.js').Run & Record<string, unknown>} run
 * @returns {typeof run}
 */
export function assignShortIds(run) {
  if (!run || typeof run !== 'object') return run;
  (run.claims || []).forEach((c, i) => {
    if (c && typeof c === 'object') c.shortId = `C${i + 1}`;
  });
  (run.criticisms || []).forEach((c, i) => {
    if (c && typeof c === 'object') c.shortId = `CR${i + 1}`;
  });
  (run.evidence || []).forEach((e, i) => {
    if (e && typeof e === 'object') e.shortId = `S${i + 1}`;
  });
  (run.log || []).forEach((l, i) => {
    if (l && typeof l === 'object') l.shortId = `E${i + 1}`;
  });
  return run;
}

/**
 * Given a Run, return a Map from the canonical (long) claim id to the
 * short id. Small convenience for renderers that already have a claim id
 * and want to display its short form.
 *
 * @param {import('../types/run.js').Run} run
 * @returns {Map<string, string>}
 */
export function claimShortIdMap(run) {
  const map = new Map();
  (run?.claims || []).forEach((c, i) => {
    map.set(c.id, c.shortId || `C${i + 1}`);
  });
  return map;
}
