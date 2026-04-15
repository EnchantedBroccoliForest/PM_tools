/**
 * Evidence gathering pipeline (Phase 4).
 *
 * Produces the `evidence` array on the Run artifact and refreshes the
 * `citationResolves` field on claim-level Verifications with real fetch
 * results. This is the browser-only subset of the full evidence story —
 * Phase 4 deliberately does NOT make LLM calls or talk to a web-search
 * API. A later phase can layer retrieval on top once a server component
 * is available.
 *
 * Pipeline stages, all pure client:
 *
 *   1. harvestUrls(references, claims)
 *        Extracts http(s) URLs from the user's reference block and from
 *        source-category claim text. Deduplicates by URL. Each surviving
 *        URL becomes an Evidence record with a stable id and a claimId
 *        link: URLs extracted from a source claim link to that claim,
 *        URLs from the reference block link to 'global'.
 *
 *   2. resolveCitation(url, { timeoutMs, fetchImpl })
 *        Performs a no-cors HEAD fetch with a short timeout. Returns
 *        `true` on any kind of response (including opaque CORS
 *        responses, which is the best we can do from a browser) and
 *        `false` only on definite failures: DNS error, connection
 *        refused, abort/timeout. This catches dead and typo'd URLs even
 *        when CORS prevents reading the response body.
 *
 *   3. gatherEvidence(input)
 *        Orchestrator. Harvests URLs, resolves them in parallel, and
 *        returns the new evidence list alongside an updated verification
 *        list whose source-claim `citationResolves` flags now reflect
 *        real fetch results. Structural `hard_fail` verdicts are left
 *        alone — real resolution does not upgrade a structurally
 *        invalid claim to passing.
 *
 * Never throws. Failures in individual URL resolution are absorbed into
 * `citationResolves: false`; a completely non-functional fetch
 * implementation still returns a well-formed evidence list with every
 * citation marked unresolved.
 */

/**
 * @typedef {Object} HarvestInput
 * @property {string} references                 raw reference block text
 * @property {import('../types/run').Claim[]} claims
 */

/**
 * @typedef {Object} GatherEvidenceInput
 * @property {string} references
 * @property {import('../types/run').Claim[]} claims
 * @property {import('../types/run').Verification[]} verifications
 * @property {typeof fetch} [fetchImpl]
 * @property {number} [timeoutMs]
 */

/**
 * @typedef {Object} GatherEvidenceResult
 * @property {import('../types/run').Evidence[]} evidence
 * @property {import('../types/run').Verification[]} updatedVerifications
 * @property {number} wallClockMs
 * @property {{level:'info'|'warn'|'error', message:string}|null} logEntry
 */

import { resolveXUrl } from './xapi.js';

// Match bare http(s) URLs up to the next whitespace / closing punctuation.
// Intentionally permissive — we want to catch URLs buried in markdown like
// `[title](https://example.com)` without requiring the link syntax.
const URL_REGEX = /https?:\/\/[^\s)<>"'\]]+/g;

/**
 * Strip trailing punctuation that is almost never part of a URL: `.,;:!?`.
 * This catches the common case where the user pastes a URL at the end of a
 * sentence and the period gets captured by the regex.
 */
function cleanUrl(url) {
  return url.replace(/[.,;:!?]+$/, '');
}

/**
 * Extract unique URLs from a string, preserving order of first appearance.
 * Returns [] for empty/whitespace input.
 */
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
 * Harvest URLs from references + source claims. Deduplicates across both
 * inputs, preferring source-claim linkage over 'global' when the same URL
 * appears in both.
 *
 * @param {HarvestInput} input
 * @returns {import('../types/run').Evidence[]}
 */
export function harvestUrls({ references, claims }) {
  const byUrl = new Map();

  // Pass 1: source-category claims. URLs extracted here get their claimId
  // set to the claim id they came from, which is strictly better than the
  // 'global' linkage we'd assign from the references block.
  const sourceClaims = (claims || []).filter((c) => c.category === 'source');
  for (const claim of sourceClaims) {
    const urls = extractUrls(claim.text);
    for (const url of urls) {
      if (!byUrl.has(url)) {
        byUrl.set(url, { url, claimId: claim.id });
      }
    }
  }

  // Pass 2: user-provided references block. Only add URLs we have not
  // already linked to a source claim. Any URL that appears in both places
  // keeps its source-claim linkage from Pass 1.
  for (const url of extractUrls(references)) {
    if (!byUrl.has(url)) {
      byUrl.set(url, { url, claimId: 'global' });
    }
  }

  // Pass 3: also scan non-source claims for inline URLs. A draft might
  // embed a reference URL inside a resolution rule ("resolved per Reuters
  // at https://..."); that URL should count as evidence for that claim,
  // not 'global'. We only overwrite 'global' linkages — never a more
  // specific source-claim linkage.
  const nonSourceClaims = (claims || []).filter((c) => c.category !== 'source');
  for (const claim of nonSourceClaims) {
    const urls = extractUrls(claim.text);
    for (const url of urls) {
      const existing = byUrl.get(url);
      if (!existing) {
        byUrl.set(url, { url, claimId: claim.id });
      } else if (existing.claimId === 'global') {
        existing.claimId = claim.id;
      }
    }
  }

  const now = Date.now();
  const items = Array.from(byUrl.values());
  return items.map((item, i) => ({
    id: `evidence.${i}`,
    claimId: item.claimId,
    url: item.url,
    title: '', // not populated without retrieval
    excerpt: '', // not populated without retrieval
    fetchedAt: now,
    rank: i,
  }));
}

/**
 * Attempt to resolve a single URL. Returns a boolean: true if the fetch
 * produced any kind of response (including an opaque CORS response) or
 * false if it failed with a network error or timeout.
 *
 * The caller passes fetchImpl explicitly so tests can mock it. In real
 * code the default is the global fetch.
 *
 * @param {string} url
 * @param {{timeoutMs?:number, fetchImpl?:typeof fetch}} [options]
 * @returns {Promise<boolean>}
 */
export async function resolveCitation(url, options = {}) {
  const { timeoutMs = 3000, fetchImpl = typeof fetch === 'function' ? fetch : null } =
    options;
  if (!fetchImpl) return false;

  const controller =
    typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    // We use GET rather than HEAD because some CDNs respond 405 to HEAD
    // even though the URL is live. no-cors means the response is opaque
    // but any non-error return is a strong signal the host exists and
    // the URL is routable.
    await fetchImpl(url, {
      method: 'GET',
      mode: 'no-cors',
      redirect: 'follow',
      signal: controller?.signal,
      // Hint to the browser not to cache this purely diagnostic fetch.
      cache: 'no-store',
    });
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolve many URLs in parallel. Returns both the boolean resolve map and
 * any xAPI metadata captured for X/Twitter URLs. Never throws.
 *
 * @param {string[]} urls
 * @param {{timeoutMs?:number, fetchImpl?:typeof fetch}} [options]
 * @returns {Promise<{
 *   resolveMap: Map<string, boolean>,
 *   xapiMeta: Map<string, {name?:string, screenName?:string, description?:string, text?:string, authorScreenName?:string}>,
 * }>}
 */
async function resolveAll(urls, options) {
  /** @type {Map<string, {name?:string, screenName?:string, description?:string, text?:string, authorScreenName?:string}>} */
  const xapiMeta = new Map();
  const entries = await Promise.all(
    urls.map(async (url) => {
      // Try xAPI for X/Twitter URLs — richer than a no-cors probe.
      const xResult = await resolveXUrl(url, options);
      if (xResult) {
        xapiMeta.set(url, xResult.meta);
        return [url, true];
      }
      const ok = await resolveCitation(url, options);
      return [url, ok];
    })
  );
  return { resolveMap: new Map(entries), xapiMeta };
}

/**
 * Update Verification.citationResolves for source-category claims based on
 * real fetch results. Non-source claims are left untouched — their
 * citationResolves stays at the structural default (true). Structural
 * hard_fail verdicts are also left alone since they already failed for a
 * reason unrelated to reachability.
 *
 * @param {import('../types/run').Verification[]} verifications
 * @param {import('../types/run').Claim[]} claims
 * @param {Map<string, boolean>} resolveMap
 * @returns {import('../types/run').Verification[]}
 */
function applyResolveToVerifications(verifications, claims, resolveMap) {
  const claimById = new Map((claims || []).map((c) => [c.id, c]));
  return verifications.map((v) => {
    const claim = claimById.get(v.claimId);
    if (!claim || claim.category !== 'source') return v;
    // Extract the URL(s) from the source claim text and OR the resolve
    // results. A source claim with two URLs resolves iff either works.
    const urls = extractUrls(claim.text);
    if (urls.length === 0) return v; // structural check already set citationResolves=false
    const anyResolved = urls.some((u) => resolveMap.get(u) === true);
    if (anyResolved) return v; // already true; no change required
    // All URLs failed to resolve. Override citationResolves and degrade
    // the verdict: pass → soft_fail. Do not touch an existing hard_fail.
    const newVerdict = v.verdict === 'pass' ? 'soft_fail' : v.verdict;
    const note = 'Evidence: all cited URLs failed to resolve from the browser.';
    const toolOutput = v.toolOutput ? `${v.toolOutput} | ${note}` : note;
    return {
      ...v,
      citationResolves: false,
      verdict: newVerdict,
      toolOutput,
    };
  });
}

/**
 * Main orchestrator. Harvest URLs, resolve them in parallel, and fold the
 * results into both the Evidence list and the existing Verifications.
 * Never throws.
 *
 * @param {GatherEvidenceInput} input
 * @returns {Promise<GatherEvidenceResult>}
 */
export async function gatherEvidence(input) {
  const {
    references,
    claims,
    verifications,
    fetchImpl,
    timeoutMs,
  } = input || {};

  const startedAt = Date.now();
  const evidence = harvestUrls({ references: references || '', claims: claims || [] });

  if (evidence.length === 0) {
    return {
      evidence: [],
      updatedVerifications: verifications || [],
      wallClockMs: Date.now() - startedAt,
      logEntry: {
        level: 'info',
        message: 'Evidence: no URLs found in references or source claims.',
      },
    };
  }

  const urls = evidence.map((e) => e.url);
  const { resolveMap, xapiMeta } = await resolveAll(urls, { timeoutMs, fetchImpl });

  const resolvedCount = Array.from(resolveMap.values()).filter(Boolean).length;
  const unresolvedCount = urls.length - resolvedCount;

  // Enrich evidence records with xAPI metadata (title/excerpt) when available.
  for (const ev of evidence) {
    const meta = xapiMeta.get(ev.url);
    if (!meta) continue;
    if (meta.text) {
      ev.title = `@${meta.authorScreenName || 'unknown'}`;
      ev.excerpt = meta.text.slice(0, 300);
    } else if (meta.name) {
      ev.title = meta.name;
      ev.excerpt = meta.description ? meta.description.slice(0, 300) : '';
    }
  }

  const updatedVerifications = applyResolveToVerifications(
    verifications || [],
    claims || [],
    resolveMap
  );

  // Attach resolve result to each Evidence record in toolOutput-like form.
  // The per-URL resolve status is already surfaced on the linked claim's
  // Verification.citationResolves, so we just log a single summary line.
  //
  // Note on title/excerpt: these were originally left empty until a later
  // phase could populate them with real retrieved content. The xAPI
  // integration (see loop above) now populates them for X/Twitter URLs
  // only, so downstream readers should treat non-empty title/excerpt as
  // "enriched" rather than the previous "never set" invariant.
  const logEntry = {
    level: unresolvedCount > 0 ? 'warn' : 'info',
    message:
      unresolvedCount > 0
        ? `Evidence: ${resolvedCount} of ${urls.length} URL(s) resolved; ${unresolvedCount} failed.`
        : `Evidence: all ${resolvedCount} URL(s) resolved.`,
  };

  return {
    evidence,
    updatedVerifications,
    wallClockMs: Date.now() - startedAt,
    logEntry,
  };
}
