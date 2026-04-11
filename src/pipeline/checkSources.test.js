/**
 * Unit tests for src/pipeline/checkSources.js.
 *
 * Follow-up from the PR #57 review — covers the two behaviours most likely
 * to silently regress under future pipeline / prompt refactors:
 *
 *   1. URL-origin precedence: the same URL can appear in a source claim,
 *      the draft's resolution section, the references block, and the
 *      draft body. checkResolutionSources must label it with the
 *      highest-priority origin (source_claim > resolution_section >
 *      references > draft_body) so the pre-finalize gate surfaces
 *      resolution-critical sources first.
 *
 *   2. Status classification: the gate's `status` field maps directly to
 *      blocking behaviour in the Accept flow, so every branch (`ok`,
 *      `some_unreachable`, `all_unreachable`, `no_sources`, `error`) must
 *      stay correct.
 *
 * Uses vitest's default globals (describe / it / expect) and a mocked
 * fetch implementation so the tests don't touch the network.
 */

import { describe, it, expect } from 'vitest';

import { checkResolutionSources } from './checkSources';

// A fetchImpl that resolves for every URL in the `reachable` set and
// rejects for every URL outside it. Returned from each test so its
// behaviour is local and explicit.
function makeFetch(reachable) {
  const allow = new Set(reachable);
  return async (url) => {
    if (allow.has(url)) return new Response(null, { status: 200 });
    throw new Error(`network: ${url}`);
  };
}

// Minimal Claim factory — only the fields checkResolutionSources reads.
function sourceClaim(id, text) {
  return { id, category: 'source', text, sourceRefs: [] };
}

describe('checkResolutionSources — URL-origin precedence', () => {
  it('labels a URL that appears in a source claim as source_claim even when it is also in the references block and draft body', async () => {
    const url = 'https://api.example.com/scoreboard';
    const draft = `Resolution Rules: see ${url} for the official feed.`;
    const references = `${url}`;
    const claims = [sourceClaim('claim.source.0', `Source feed: ${url}`)];

    const result = await checkResolutionSources({
      draftContent: draft,
      references,
      claims,
      fetchImpl: makeFetch([url]),
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({
      url,
      origin: 'source_claim',
      claimId: 'claim.source.0',
      accessible: true,
    });
  });

  it('labels a URL found only in the resolution section as resolution_section, beating references and draft_body', async () => {
    const url = 'https://data.example.org/feed';
    // Header + URL inside a "**Resolution Rules**" section, plus the same
    // URL dangling in the references block. No matching source claim.
    const draft = `
**Question**
Who wins?

**Resolution Rules**
Resolve via ${url}.
`;
    const references = url;

    const result = await checkResolutionSources({
      draftContent: draft,
      references,
      claims: [],
      fetchImpl: makeFetch([url]),
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].origin).toBe('resolution_section');
    expect(result.sources[0].claimId).toBeNull();
  });

  it('labels a URL found only in the references block as references', async () => {
    const url = 'https://refs.example.com/doc';
    const result = await checkResolutionSources({
      draftContent: 'A draft body with no URLs at all.',
      references: `See ${url}`,
      claims: [],
      fetchImpl: makeFetch([url]),
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].origin).toBe('references');
  });

  it('labels a URL only found inline in the draft body (not in a recognised section, not a source claim, not in references) as draft_body', async () => {
    const url = 'https://inline.example.com/path';
    const draft = `The winner is declared per ${url}.`;
    const result = await checkResolutionSources({
      draftContent: draft,
      references: '',
      claims: [],
      fetchImpl: makeFetch([url]),
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].origin).toBe('draft_body');
  });

  it('deduplicates across origins and keeps the highest-priority label when a URL appears in multiple places', async () => {
    // Priority order documented in the module: source_claim >
    // resolution_section > references > draft_body.
    const urlA = 'https://a.example.com';
    const urlB = 'https://b.example.com';
    const urlC = 'https://c.example.com';

    // Note: the "Edge Cases" header terminates the resolution section so
    // urlC genuinely lives in the draft body (not inside the section),
    // which lets us exercise the references > draft_body precedence.
    const draft = `
**Resolution Rules**
Use ${urlA} and ${urlB}.

**Edge Cases**
Body text also cites ${urlC}.
`;
    const references = `${urlA}\n${urlC}`;
    const claims = [sourceClaim('claim.source.0', urlA)];

    const result = await checkResolutionSources({
      draftContent: draft,
      references,
      claims,
      fetchImpl: makeFetch([urlA, urlB, urlC]),
    });

    // Exactly three unique URLs, each with the correct highest-priority
    // origin.
    expect(result.sources).toHaveLength(3);
    const byUrl = Object.fromEntries(result.sources.map((s) => [s.url, s]));
    expect(byUrl[urlA].origin).toBe('source_claim');
    expect(byUrl[urlA].claimId).toBe('claim.source.0');
    expect(byUrl[urlB].origin).toBe('resolution_section');
    // urlC appears in both the draft body and the references block;
    // references beats draft_body.
    expect(byUrl[urlC].origin).toBe('references');
  });
});

describe('checkResolutionSources — status classification', () => {
  it('returns status=ok when every URL resolves', async () => {
    const urls = ['https://a.example.com', 'https://b.example.com'];
    const result = await checkResolutionSources({
      draftContent: urls.join('\n'),
      references: '',
      claims: [],
      fetchImpl: makeFetch(urls),
    });

    expect(result.status).toBe('ok');
    expect(result.sources.every((s) => s.accessible)).toBe(true);
    expect(result.error).toBeNull();
    expect(result.logEntry.level).toBe('info');
  });

  it('returns status=some_unreachable when at least one but not all URLs fail', async () => {
    const ok = 'https://ok.example.com';
    const bad = 'https://bad.example.com';
    const result = await checkResolutionSources({
      draftContent: `${ok} ${bad}`,
      references: '',
      claims: [],
      fetchImpl: makeFetch([ok]),
    });

    expect(result.status).toBe('some_unreachable');
    const byUrl = Object.fromEntries(result.sources.map((s) => [s.url, s.accessible]));
    expect(byUrl[ok]).toBe(true);
    expect(byUrl[bad]).toBe(false);
    expect(result.logEntry.level).toBe('warn');
  });

  it('returns status=all_unreachable when every URL fails', async () => {
    const urls = ['https://x.example.com', 'https://y.example.com'];
    const result = await checkResolutionSources({
      draftContent: urls.join('\n'),
      references: '',
      claims: [],
      // No URLs in the reachable set → every fetch throws.
      fetchImpl: makeFetch([]),
    });

    expect(result.status).toBe('all_unreachable');
    expect(result.sources.every((s) => !s.accessible)).toBe(true);
    expect(result.logEntry.level).toBe('warn');
  });

  it('returns status=no_sources when the draft, references, and claims contain no URLs at all', async () => {
    const result = await checkResolutionSources({
      draftContent: 'A draft with no URLs, only prose.',
      references: 'Just a textual reference, nothing to fetch.',
      claims: [sourceClaim('claim.source.0', 'Official scoreboard from the organizer.')],
      // fetchImpl unused because no URLs will be probed, but pass a
      // throwing stub to prove we never called it.
      fetchImpl: async () => {
        throw new Error('should not be called');
      },
    });

    expect(result.status).toBe('no_sources');
    expect(result.sources).toEqual([]);
    expect(result.logEntry.level).toBe('warn');
    expect(result.error).toBeNull();
  });

  it('returns status=error when the Promise.all itself rejects for an unexpected reason', async () => {
    // The module wraps resolveCitation in a Promise.all inside a
    // try/catch. resolveCitation is designed to never throw, so the only
    // way to hit the catch in practice is if a caller-supplied fetchImpl
    // throws synchronously during iteration — we simulate that by
    // supplying a fetchImpl proxy whose property access throws.
    //
    // The more direct failure path: pass a fetchImpl that causes
    // Promise.all to reject by throwing from inside the map callback
    // after resolveCitation completes. We do this via a Proxy on the
    // sources array isn't possible from outside, so instead we rely on
    // a fetchImpl that makes resolveCitation throw *after* the try/catch
    // inside resolveCitation returns — not possible. So this test
    // instead uses the documented behaviour: resolveCitation handles its
    // own errors, returns false, and checkResolutionSources never emits
    // 'error' in normal operation. We still cover the branch by
    // injecting a rejecting Promise.all via a monkey-patched Array.
    //
    // Instead of all that, exercise the branch by passing a bogus
    // draftContent that triggers a throw inside Array.prototype.some via
    // a getter on String.prototype. That's fragile.
    //
    // Pragmatic approach: simulate the branch directly by monkey-patching
    // Promise.all for the duration of the call.
    const origAll = Promise.all;
    Promise.all = () => Promise.reject(new Error('synthetic failure'));
    try {
      const result = await checkResolutionSources({
        draftContent: 'https://x.example.com',
        references: '',
        claims: [],
      });
      expect(result.status).toBe('error');
      expect(result.error).toContain('synthetic failure');
      expect(result.sources).toEqual([]);
      expect(result.logEntry.level).toBe('error');
    } finally {
      Promise.all = origAll;
    }
  });
});
