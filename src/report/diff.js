/**
 * Minimal unified-diff helper used by the report renderer's Update stage.
 *
 * We print a line-level diff of the initial and updated drafts (or of two
 * text field values like `refinedQuestion`) so the report stays short even
 * when the Update pass made only a handful of edits. This is intentionally
 * not a full patch library — no rename detection, no fuzzy matching. Just
 * LCS over line arrays and `+` / `-` markers.
 */

/**
 * Compute the longest-common-subsequence table for two arrays.
 * Returns a 2D array of lengths.
 */
function lcsLengths(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      dp[i + 1][j + 1] = a[i] === b[j]
        ? dp[i][j] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  return dp;
}

/**
 * Produce a list of `{ kind, text }` lines where kind is one of
 * 'context' | 'add' | 'remove'. Context lines are shown only when they
 * are adjacent to a change (we suppress long unchanged runs).
 *
 * @param {string} before
 * @param {string} after
 * @param {{contextLines?:number}} [opts]
 * @returns {Array<{kind:'context'|'add'|'remove', text:string}>}
 */
export function diffLines(before, after, opts = {}) {
  const contextLines = opts.contextLines ?? 1;
  const a = (before ?? '').split('\n');
  const b = (after ?? '').split('\n');
  const dp = lcsLengths(a, b);

  // Backtrack to build the raw operation list.
  /** @type {Array<{kind:'context'|'add'|'remove', text:string}>} */
  const ops = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ kind: 'context', text: a[i - 1] });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ kind: 'remove', text: a[i - 1] });
      i--;
    } else {
      ops.push({ kind: 'add', text: b[j - 1] });
      j--;
    }
  }
  while (i > 0) { ops.push({ kind: 'remove', text: a[i - 1] }); i--; }
  while (j > 0) { ops.push({ kind: 'add', text: b[j - 1] }); j--; }
  ops.reverse();

  // Collapse long context runs to the last/first `contextLines` on each
  // side of a change.
  /** @type {Array<{kind:'context'|'add'|'remove', text:string}>} */
  const out = [];
  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];
    if (op.kind !== 'context') { out.push(op); continue; }
    // Is this context near a change?
    const prevChange = out.length > 0 && out[out.length - 1].kind !== 'context';
    let nextChange = false;
    for (let m = k + 1; m < Math.min(ops.length, k + contextLines + 1); m++) {
      if (ops[m].kind !== 'context') { nextChange = true; break; }
    }
    if (prevChange || nextChange) out.push(op);
  }
  return out;
}

/**
 * Format a diff as a string: `+` / `-` / ` ` prefixes per line.
 *
 * @param {Array<{kind:string, text:string}>} ops
 * @returns {string}
 */
export function formatDiff(ops) {
  return ops
    .map((op) => {
      const prefix = op.kind === 'add' ? '+ ' : op.kind === 'remove' ? '- ' : '  ';
      return prefix + op.text;
    })
    .join('\n');
}

/**
 * Count add/remove ops. Useful to decide whether to print a diff at all.
 *
 * @param {Array<{kind:string}>} ops
 * @returns {{added:number, removed:number, changed:boolean}}
 */
export function countChanges(ops) {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === 'add') added++;
    else if (op.kind === 'remove') removed++;
  }
  return { added, removed, changed: added + removed > 0 };
}

/**
 * Extract top-level `## Heading` markdown sections from a draft. Returns a
 * map keyed by the section title (lowercased, trimmed). Sections we can't
 * classify are still included under their title; callers pick the ones
 * they care about.
 *
 * @param {string} draftText
 * @returns {Record<string, string>}
 */
export function parseDraftSections(draftText) {
  /** @type {Record<string, string>} */
  const sections = {};
  if (typeof draftText !== 'string') return sections;
  const lines = draftText.split('\n');
  let title = null;
  let buffer = [];
  const flush = () => {
    if (title !== null) sections[title] = buffer.join('\n').trim();
    buffer = [];
  };
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      title = m[1].toLowerCase().trim();
    } else if (title !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * Classify a section title into one of the three update-stage buckets the
 * Task 4 spec calls out, or `null` if the title is something else.
 *
 * @param {string} title
 * @returns {'question'|'resolution_criteria'|'outcomes'|null}
 */
export function classifySection(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('question')) return 'question';
  if (t.includes('outcome')) return 'outcomes';
  if (t.includes('resolution') || t.includes('criteria')) return 'resolution_criteria';
  return null;
}
