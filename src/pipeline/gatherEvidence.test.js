/**
 * Unit tests for src/pipeline/gatherEvidence.js.
 *
 * Tests URL harvesting, citation resolution, and evidence gathering
 * with mocked fetch implementations.
 */

import { describe, it, expect } from 'vitest';
import { harvestUrls, resolveCitation, gatherEvidence } from './gatherEvidence.js';

// --- Helpers ---

function claim(id, category, text) {
  return { id, category, text, sourceRefs: [] };
}

function verification(claimId, opts = {}) {
  return {
    claimId,
    entailment: 'entailed',
    consistencyScore: null,
    toolOutput: null,
    citationResolves: true,
    verdict: 'pass',
    ...opts,
  };
}

function makeFetch(reachable) {
  const allow = new Set(reachable);
  return async (url) => {
    if (allow.has(url)) return { ok: true, status: 200, type: 'opaque' };
    throw new Error(`unreachable: ${url}`);
  };
}

// --- harvestUrls ---

describe('harvestUrls', () => {
  it('extracts URLs from source claims', () => {
    const claims = [
      claim('claim.source.0', 'source', 'See https://api.example.com/data for results.'),
    ];
    const evidence = harvestUrls({ references: '', claims });
    expect(evidence).toHaveLength(1);
    expect(evidence[0].url).toBe('https://api.example.com/data');
    expect(evidence[0].claimId).toBe('claim.source.0');
  });

  it('extracts URLs from the references block', () => {
    const evidence = harvestUrls({
      references: 'https://api.example.com/a\nhttps://api.example.com/b',
      claims: [],
    });
    expect(evidence).toHaveLength(2);
    expect(evidence[0].claimId).toBe('global');
    expect(evidence[1].claimId).toBe('global');
  });

  it('deduplicates URLs, preferring source-claim linkage', () => {
    const url = 'https://api.example.com/data';
    const claims = [claim('claim.source.0', 'source', `Data: ${url}`)];
    const evidence = harvestUrls({ references: url, claims });
    expect(evidence).toHaveLength(1);
    expect(evidence[0].claimId).toBe('claim.source.0'); // not 'global'
  });

  it('returns empty array when no URLs found', () => {
    const evidence = harvestUrls({ references: '', claims: [] });
    expect(evidence).toEqual([]);
  });

  it('strips trailing punctuation from URLs', () => {
    const claims = [
      claim('claim.source.0', 'source', 'Check https://api.example.com/data.'),
    ];
    const evidence = harvestUrls({ references: '', claims });
    expect(evidence[0].url).toBe('https://api.example.com/data');
  });

  it('extracts inline URLs from non-source claims', () => {
    const claims = [
      claim('claim.edge.0', 'edge_case', 'If https://fallback.example.com/api is down, resolve as Other.'),
    ];
    const evidence = harvestUrls({ references: '', claims });
    expect(evidence).toHaveLength(1);
    expect(evidence[0].claimId).toBe('claim.edge.0');
  });
});

// --- resolveCitation ---

describe('resolveCitation', () => {
  it('returns true for reachable URLs', async () => {
    const fetchImpl = makeFetch(['https://api.example.com']);
    const result = await resolveCitation('https://api.example.com', { fetchImpl });
    expect(result).toBe(true);
  });

  it('returns false for unreachable URLs', async () => {
    const fetchImpl = makeFetch([]);
    const result = await resolveCitation('https://dead.example.com', { fetchImpl });
    expect(result).toBe(false);
  });

  it('returns false when no fetch implementation available', async () => {
    const result = await resolveCitation('https://api.example.com', { fetchImpl: null });
    expect(result).toBe(false);
  });
});

// --- gatherEvidence ---

describe('gatherEvidence', () => {
  it('returns empty evidence when no URLs found', async () => {
    const result = await gatherEvidence({
      references: '',
      claims: [],
      verifications: [],
    });
    expect(result.evidence).toEqual([]);
    expect(result.logEntry.level).toBe('info');
    expect(result.logEntry.message).toMatch(/no URLs/i);
  });

  it('resolves URLs and updates verifications', async () => {
    const url = 'https://api.example.com/live';
    const claims = [claim('claim.source.0', 'source', url)];
    const verifications = [verification('claim.source.0')];
    const fetchImpl = makeFetch([url]);

    const result = await gatherEvidence({
      references: '',
      claims,
      verifications,
      fetchImpl,
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].url).toBe(url);
    expect(result.logEntry.level).toBe('info');
    expect(result.logEntry.message).toMatch(/all.*resolved/i);
  });

  it('marks source verifications as failed when URLs are unreachable', async () => {
    const url = 'https://dead.example.com/api';
    const claims = [claim('claim.source.0', 'source', url)];
    const verifications = [verification('claim.source.0')];
    const fetchImpl = makeFetch([]); // nothing reachable

    const result = await gatherEvidence({
      references: '',
      claims,
      verifications,
      fetchImpl,
    });

    expect(result.updatedVerifications[0].citationResolves).toBe(false);
    expect(result.updatedVerifications[0].verdict).toBe('soft_fail');
    expect(result.logEntry.level).toBe('warn');
  });

  it('does not downgrade hard_fail verdicts on unreachable URLs', async () => {
    const url = 'https://dead.example.com/api';
    const claims = [claim('claim.source.0', 'source', url)];
    const verifications = [verification('claim.source.0', { verdict: 'hard_fail' })];
    const fetchImpl = makeFetch([]);

    const result = await gatherEvidence({
      references: '',
      claims,
      verifications,
      fetchImpl,
    });

    // hard_fail should remain hard_fail
    expect(result.updatedVerifications[0].verdict).toBe('hard_fail');
  });

  it('handles mixed reachable/unreachable URLs', async () => {
    const liveUrl = 'https://live.example.com/api';
    const deadUrl = 'https://dead.example.com/api';
    const claims = [
      claim('claim.source.0', 'source', liveUrl),
      claim('claim.source.1', 'source', deadUrl),
    ];
    const verifications = [
      verification('claim.source.0'),
      verification('claim.source.1'),
    ];
    const fetchImpl = makeFetch([liveUrl]);

    const result = await gatherEvidence({
      references: '',
      claims,
      verifications,
      fetchImpl,
    });

    expect(result.evidence).toHaveLength(2);
    expect(result.logEntry.level).toBe('warn');
    expect(result.logEntry.message).toMatch(/1 of 2/);
  });
});
