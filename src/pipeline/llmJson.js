/**
 * Shared helpers for parsing LLM JSON responses and accumulating per-call
 * cost telemetry. Consolidated from four near-identical copies that lived
 * in extractClaims.js, verify.js, aggregate.js, and structuredReview.js.
 *
 * Two JSON variants are exposed:
 *
 *   - tryParseJsonObject: salvages the outermost `{...}` if the model added
 *     leading prose or wrapped the response in ```json fences.
 *
 *   - tryParseJsonArray: salvages the outermost `[...]`. Includes
 *     truncation recovery — if the model hit its max-tokens budget
 *     mid-element, scan for the last top-level element boundary and try
 *     parsing each prefix from last to first. Returns `{data, recovered}`;
 *     `recovered === true` means some trailing elements were dropped.
 *
 * The accumulator helper builds the `{usage, wallClockMs}` aggregator that
 * every pipeline stage needs to sum across multiple queryModel calls.
 */

function stripFences(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1] : trimmed;
}

/**
 * Parse a single JSON object, salvaging the outermost `{...}` if the model
 * added leading prose. Returns the parsed value or null on failure.
 */
export function tryParseJsonObject(text) {
  const candidate = stripFences(text);
  if (candidate === null) return null;
  const braced = candidate.match(/\{[\s\S]*\}/);
  const final = braced ? braced[0] : candidate;
  try {
    return JSON.parse(final);
  } catch {
    return null;
  }
}

/**
 * Parse a JSON array with truncation recovery.
 *
 * Returns `{data, recovered}` where `recovered` is true when the outer
 * array was truncated mid-element and we recovered a shorter prefix
 * (meaning some trailing items were dropped). Returns null if neither the
 * full parse nor any prefix parse succeeds.
 */
export function tryParseJsonArray(text) {
  const candidate = stripFences(text);
  if (candidate === null) return null;
  const bracketed = candidate.match(/\[[\s\S]*\]/);
  const exact = bracketed ? bracketed[0] : candidate;
  try {
    return { data: JSON.parse(exact), recovered: false };
  } catch {
    // fall through to truncation recovery
  }

  // Recovery: scan once tracking quote/escape state so `}` inside a JSON
  // string value is ignored. Record positions where depth returns from 2
  // to 1 — those are end-of-element boundaries in the top-level array —
  // and try them from last to first. This bounds parse attempts by the
  // number of top-level objects rather than every `}` character.
  const arrayStart = exact.indexOf('[');
  if (arrayStart === -1) return null;
  const src = exact.slice(arrayStart);

  const cuts = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (escape) { escape = false; continue; }
    if (inString) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (ch === '}' && depth === 1) cuts.push(i);
    }
  }

  for (let i = cuts.length - 1; i >= 0; i--) {
    const slice = src.slice(0, cuts[i] + 1).replace(/,\s*$/, '') + ']';
    try {
      return { data: JSON.parse(slice), recovered: true };
    } catch {
      // try an earlier cut
    }
  }

  return null;
}

/**
 * Build a fresh cost aggregator. `aggregate.usage` sums promptTokens,
 * completionTokens, totalTokens; `aggregate.wallClockMs` sums call durations.
 * `accumulate(result)` folds one queryModel result into the running totals.
 */
export function createUsageAggregator() {
  const aggregate = {
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    wallClockMs: 0,
  };
  const accumulate = (result) => {
    if (!result || !result.usage) return;
    aggregate.usage.promptTokens += result.usage.promptTokens;
    aggregate.usage.completionTokens += result.usage.completionTokens;
    aggregate.usage.totalTokens += result.usage.totalTokens;
    aggregate.wallClockMs += result.wallClockMs || 0;
  };
  return { aggregate, accumulate };
}
