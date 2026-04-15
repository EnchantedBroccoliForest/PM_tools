/**
 * Pre-finalize data-source accessibility check.
 *
 * Runs between the early-resolution gate and the Accept & Finalize button.
 * The goal is narrower than `gatherEvidence`: there we harvested every URL
 * we could find and attached resolve status to citation-level verifications;
 * here we explicitly answer the question "can the specific data sources
 * named in the resolution rule actually be reached right now?" so the user
 * sees a clear per-source pass/fail list before they commit to a final
 * JSON.
 *
 * The check is scoped to what a 42.space oracle would need to read at
 * settlement time: the draft's resolution section, any source-category
 * claims the extractor produced, and the user-provided references block.
 * URLs are deduplicated and probed in parallel via `resolveCitation` from
 * gatherEvidence (no-cors GET with a short timeout). Non-URL sources
 * (e.g. "official data feed for X") are reported but not fetch-checkable.
 *
 * Never throws. Individual URL failures are captured in the per-source
 * result; catastrophic failures (no fetch implementation, etc.) degrade
 * to `status: 'error'` and the App layer surfaces that without blocking.
 */

import { resolveCitation } from './gatherEvidence';
import { resolveXUrl } from './xapi.js';

// Permissive URL matcher — catches URLs inside markdown links, bullet
// lists, and trailing punctuation. Matches the regex used in
// gatherEvidence so the two pipelines agree on what counts as a URL.
const URL_REGEX = /https?:\/\/[^\s)<>"'\]]+/g;

function cleanUrl(url) {
  return url.replace(/[.,;:!?]+$/, '');
}

function extractUrls(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return [];
  const matches = text.match(URL_REGEX) || [];
  const seen = new Set();
  const out = [];
  for (const raw of matches) {
    const cleaned = cleanUrl(raw);
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  return out;
}

/**
 * Best-effort: slice out the portion of the draft that looks like a
 * resolution / sources section. This is only used to label URLs with
 * `origin: 'resolution_section'` so the UI can highlight them as the
 * highest-priority accessibility checks. If no section header matches we
 * just fall back to scanning the full draft text.
 */
function extractResolutionSection(draftContent) {
  if (typeof draftContent !== 'string' || draftContent.length === 0) return '';
  // Match markdown-style headers or bold labels like "**Resolution Rules**"
  // through to the next similarly-formatted header. Case-insensitive.
  const re = /((?:^|\n)\s*(?:#+\s*|\*\*)(?:resolution(?:\s+rules?)?|sources?|potential\s+sources?|data\s+sources?)[^\n]*)([\s\S]*?)(?=\n\s*(?:#+\s*|\*\*)[A-Z]|\n\s*\d+\.\s+[A-Z]|$)/i;
  const match = draftContent.match(re);
  return match ? `${match[1]}${match[2]}` : '';
}

/**
 * @typedef {Object} SourceCheckEntry
 * @property {string} url
 * @property {'resolution_section'|'source_claim'|'references'|'draft_body'} origin
 * @property {string|null} claimId        source-category claim id, if any
 * @property {boolean} accessible         true iff resolveCitation returned true
 */

/**
 * @typedef {Object} SourceCheckResult
 * @property {'ok'|'some_unreachable'|'all_unreachable'|'no_sources'|'error'} status
 * @property {SourceCheckEntry[]} sources
 * @property {number} checkedAt
 * @property {number} wallClockMs
 * @property {string|null} error
 * @property {{level:'info'|'warn'|'error', message:string}} logEntry
 */

/**
 * @typedef {Object} CheckResolutionSourcesInput
 * @property {string} draftContent                        the updated draft text
 * @property {string} references                          user-provided references block
 * @property {import('../types/run').Claim[]} [claims]    latest extracted claims (may be empty)
 * @property {typeof fetch} [fetchImpl]                   override for tests
 * @property {number} [timeoutMs]                         per-URL timeout
 */

/**
 * Probe every data source the draft could resolve against and return a
 * clear per-source pass/fail list the UI can render as a pre-finalize gate.
 *
 * URLs are collected, in descending priority, from:
 *   1. source-category claims (extractor-identified resolution sources)
 *   2. a best-effort "Resolution Rules" / "Sources" section of the draft
 *   3. the user-provided references block
 *   4. any other http(s) URLs embedded in the draft body
 *
 * A URL that appears in more than one location keeps its highest-priority
 * origin label so the UI can surface "resolution source" first.
 *
 * @param {CheckResolutionSourcesInput} input
 * @returns {Promise<SourceCheckResult>}
 */
export async function checkResolutionSources(input) {
  const startedAt = Date.now();
  const {
    draftContent = '',
    references = '',
    claims = [],
    fetchImpl,
    timeoutMs,
  } = input || {};

  /** @type {Map<string, {url:string, origin:SourceCheckEntry['origin'], claimId:string|null}>} */
  const byUrl = new Map();

  const addIfNew = (url, origin, claimId = null) => {
    if (!byUrl.has(url)) {
      byUrl.set(url, { url, origin, claimId });
    }
  };

  // 1. source-category claims — highest signal, claim-pinned
  for (const claim of claims || []) {
    if (!claim || claim.category !== 'source') continue;
    for (const url of extractUrls(claim.text || '')) {
      addIfNew(url, 'source_claim', claim.id);
    }
  }

  // 2. resolution / sources section of the draft itself
  const resolutionSection = extractResolutionSection(draftContent);
  for (const url of extractUrls(resolutionSection)) {
    addIfNew(url, 'resolution_section');
  }

  // 3. user-provided references block
  for (const url of extractUrls(references)) {
    addIfNew(url, 'references');
  }

  // 4. any remaining URLs in the draft body (catches inline citations
  //    that didn't land in a section header and didn't come through as a
  //    source claim)
  for (const url of extractUrls(draftContent)) {
    addIfNew(url, 'draft_body');
  }

  const entries = Array.from(byUrl.values());

  if (entries.length === 0) {
    return {
      status: 'no_sources',
      sources: [],
      checkedAt: Date.now(),
      wallClockMs: Date.now() - startedAt,
      error: null,
      logEntry: {
        level: 'warn',
        message:
          'Source accessibility: no machine-readable URLs found in the draft, its resolution section, references, or source claims.',
      },
    };
  }

  // Parallel probe. resolveCitation never throws — worst case it returns
  // false — so a Promise.all here is safe.
  let results;
  try {
    results = await Promise.all(
      entries.map(async (entry) => {
        // Try xAPI for X/Twitter URLs first — richer signal than no-cors fetch.
        // We only use it for accessibility here; the SourceCheckEntry shape
        // does not carry the full metadata because no caller reads it yet.
        // If a UI surface later wants to show "resolved via @handle", add
        // an xapiMeta field to the SourceCheckEntry typedef and re-enable.
        const xResult = await resolveXUrl(entry.url, { fetchImpl, timeoutMs });
        if (xResult) {
          return { ...entry, accessible: xResult.accessible };
        }
        const accessible = await resolveCitation(entry.url, { fetchImpl, timeoutMs });
        return { ...entry, accessible };
      })
    );
  } catch (err) {
    return {
      status: 'error',
      sources: [],
      checkedAt: Date.now(),
      wallClockMs: Date.now() - startedAt,
      error: err?.message || String(err),
      logEntry: {
        level: 'error',
        message: `Source accessibility: check failed with error: ${err?.message || err}`,
      },
    };
  }

  const reachableCount = results.filter((r) => r.accessible).length;
  const unreachableCount = results.length - reachableCount;

  /** @type {SourceCheckResult['status']} */
  let status;
  if (unreachableCount === 0) status = 'ok';
  else if (reachableCount === 0) status = 'all_unreachable';
  else status = 'some_unreachable';

  const logLevel = status === 'ok' ? 'info' : 'warn';
  const logMessage =
    status === 'ok'
      ? `Source accessibility: all ${results.length} source URL(s) reachable.`
      : `Source accessibility: ${reachableCount}/${results.length} reachable; ${unreachableCount} inaccessible.`;

  return {
    status,
    sources: results,
    checkedAt: Date.now(),
    wallClockMs: Date.now() - startedAt,
    error: null,
    logEntry: { level: logLevel, message: logMessage },
  };
}
