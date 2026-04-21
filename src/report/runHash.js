/**
 * Canonical JSON + short hash of a Run.
 *
 * The Run artifact is the canonical audit log. The report is the narrative.
 * Every report carries a short hash of its source Run so a reader can
 * cross-reference any printed fact back to the JSON: `Run: <hash>`.
 *
 * `canonicalJSON` sorts object keys so two Runs that are semantically
 * equal serialise to identical bytes (object key insertion order is not a
 * semantic difference). Arrays preserve index order — positional claim /
 * criticism / evidence ordering is semantically meaningful in this schema.
 *
 * SHA-256 is imported from Node's `crypto` module. Callers running in a
 * pure-browser context should supply a shim via the `hashImpl` override;
 * the CLI path never touches the browser so we keep the direct `crypto`
 * import here.
 */

import { createHash } from 'node:crypto';

/**
 * Stable stringifier. Sorts object keys; preserves array order. Drops
 * `undefined` and function values (same rule as `JSON.stringify`).
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJSON(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJSON(v ?? null)).join(',') + ']';
  }
  const keys = Object.keys(value).filter((k) => {
    const v = value[k];
    return v !== undefined && typeof v !== 'function';
  }).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ':' + canonicalJSON(value[k]),
  );
  return '{' + parts.join(',') + '}';
}

/**
 * 12-character truncated sha256 over the canonical JSON of a Run.
 *
 * @param {unknown} run
 * @returns {string}
 */
export function computeRunHash(run) {
  return createHash('sha256').update(canonicalJSON(run)).digest('hex').slice(0, 12);
}
