/**
 * Unit tests for src/pipeline/route.js.
 *
 * Tests the pure, synchronous routing logic that assigns severity levels
 * and uncertainty scores to claims based on verification + criticism data.
 */

import { describe, it, expect } from 'vitest';
import { routeClaims, groupRoutingBySeverity } from './route.js';

// --- Helpers ---

function claim(id, category = 'other') {
  return { id, category, text: `Claim ${id}`, sourceRefs: [] };
}

function verification(claimId, opts = {}) {
  return {
    claimId,
    entailment: opts.entailment || 'entailed',
    consistencyScore: null,
    toolOutput: null,
    citationResolves: opts.citationResolves !== undefined ? opts.citationResolves : true,
    verdict: opts.verdict || 'pass',
  };
}

function criticism(claimId, severity = 'minor', category = 'other') {
  return {
    id: `crit.${claimId}.${severity}`,
    reviewerModel: 'test/model',
    claimId,
    severity,
    category,
    rationale: `Test ${severity} criticism`,
  };
}

// --- Tests ---

describe('routeClaims', () => {
  it('returns empty routing for empty claim set', () => {
    const result = routeClaims({ claims: [], verifications: [], criticisms: [] });
    expect(result.items).toEqual([]);
    expect(result.overall).toBe('clean');
    expect(result.hasBlocking).toBe(false);
    expect(result.hasTargetedReview).toBe(false);
    expect(result.focusClaimIds).toEqual([]);
  });

  it('routes all-passing claims as clean', () => {
    const claims = [claim('c1'), claim('c2')];
    const verifications = [verification('c1'), verification('c2')];
    const result = routeClaims({ claims, verifications, criticisms: [] });
    expect(result.overall).toBe('clean');
    expect(result.items.every((i) => i.severity === 'ok')).toBe(true);
    expect(result.focusClaimIds).toEqual([]);
  });

  it('marks hard_fail verification as blocking', () => {
    const claims = [claim('c1')];
    const verifications = [verification('c1', { verdict: 'hard_fail' })];
    const result = routeClaims({ claims, verifications, criticisms: [] });
    expect(result.items[0].severity).toBe('blocking');
    expect(result.overall).toBe('blocked');
    expect(result.hasBlocking).toBe(true);
    expect(result.focusClaimIds).toContain('c1');
  });

  it('marks soft_fail verification as targeted_review', () => {
    const claims = [claim('c1')];
    const verifications = [verification('c1', { verdict: 'soft_fail' })];
    const result = routeClaims({ claims, verifications, criticisms: [] });
    expect(result.items[0].severity).toBe('targeted_review');
    expect(result.overall).toBe('needs_update');
    expect(result.hasTargetedReview).toBe(true);
  });

  it('marks contradicted entailment as blocking', () => {
    const claims = [claim('c1')];
    const verifications = [
      verification('c1', { entailment: 'contradicted', verdict: 'pass' }),
    ];
    const result = routeClaims({ claims, verifications, criticisms: [] });
    expect(result.items[0].severity).toBe('blocking');
  });

  it('marks not_covered entailment as targeted_review', () => {
    const claims = [claim('c1')];
    const verifications = [
      verification('c1', { entailment: 'not_covered', verdict: 'pass' }),
    ];
    const result = routeClaims({ claims, verifications, criticisms: [] });
    expect(result.items[0].severity).toBe('targeted_review');
  });

  it('marks blocker criticism as blocking', () => {
    const claims = [claim('c1')];
    const verifications = [verification('c1')];
    const criticisms = [criticism('c1', 'blocker')];
    const result = routeClaims({ claims, verifications, criticisms });
    expect(result.items[0].severity).toBe('blocking');
    expect(result.overall).toBe('blocked');
  });

  it('marks major criticism as targeted_review', () => {
    const claims = [claim('c1')];
    const verifications = [verification('c1')];
    const criticisms = [criticism('c1', 'major')];
    const result = routeClaims({ claims, verifications, criticisms });
    expect(result.items[0].severity).toBe('targeted_review');
    expect(result.overall).toBe('needs_update');
  });

  it('ignores minor and nit criticisms for severity', () => {
    const claims = [claim('c1')];
    const verifications = [verification('c1')];
    const criticisms = [criticism('c1', 'minor'), criticism('c1', 'nit')];
    const result = routeClaims({ claims, verifications, criticisms });
    expect(result.items[0].severity).toBe('ok');
    expect(result.overall).toBe('clean');
  });

  it('global blocker criticism makes overall blocked', () => {
    const claims = [claim('c1')];
    const verifications = [verification('c1')];
    const criticisms = [criticism('global', 'blocker')];
    const result = routeClaims({ claims, verifications, criticisms });
    // Global blockers affect overall but not per-claim severity
    expect(result.overall).toBe('blocked');
  });

  it('global major criticism makes overall needs_update', () => {
    const claims = [claim('c1')];
    const verifications = [verification('c1')];
    const criticisms = [criticism('global', 'major')];
    const result = routeClaims({ claims, verifications, criticisms });
    expect(result.overall).toBe('needs_update');
  });

  it('sorts focusClaimIds with blocking before targeted_review', () => {
    const claims = [claim('c1'), claim('c2'), claim('c3')];
    const verifications = [
      verification('c1', { verdict: 'soft_fail' }), // targeted
      verification('c2', { verdict: 'hard_fail' }), // blocking
      verification('c3'),                             // ok
    ];
    const result = routeClaims({ claims, verifications, criticisms: [] });
    expect(result.focusClaimIds[0]).toBe('c2'); // blocking first
    expect(result.focusClaimIds[1]).toBe('c1'); // then targeted
    expect(result.focusClaimIds).not.toContain('c3'); // ok excluded
  });

  it('uncertainty score increases with severity', () => {
    const claims = [claim('c1'), claim('c2'), claim('c3')];
    const verifications = [
      verification('c1'), // clean
      verification('c2', { verdict: 'soft_fail' }),
      verification('c3', { verdict: 'hard_fail' }),
    ];
    const result = routeClaims({ claims, verifications, criticisms: [] });
    expect(result.items[0].uncertainty).toBeLessThan(result.items[1].uncertainty);
    expect(result.items[1].uncertainty).toBeLessThan(result.items[2].uncertainty);
  });

  it('clamps uncertainty to [0, 1]', () => {
    const claims = [claim('c1')];
    // Stack multiple penalties to push score > 1
    const verifications = [
      verification('c1', { verdict: 'hard_fail', entailment: 'contradicted' }),
    ];
    const criticisms = [criticism('c1', 'blocker'), criticism('c1', 'major')];
    const result = routeClaims({ claims, verifications, criticisms });
    expect(result.items[0].uncertainty).toBeLessThanOrEqual(1);
    expect(result.items[0].uncertainty).toBeGreaterThanOrEqual(0);
  });

  it('handles null/undefined inputs gracefully', () => {
    const result = routeClaims({});
    expect(result.items).toEqual([]);
    expect(result.overall).toBe('clean');
  });
});

describe('groupRoutingBySeverity', () => {
  it('groups items by severity', () => {
    const routing = routeClaims({
      claims: [claim('c1'), claim('c2'), claim('c3')],
      verifications: [
        verification('c1'),
        verification('c2', { verdict: 'soft_fail' }),
        verification('c3', { verdict: 'hard_fail' }),
      ],
      criticisms: [],
    });
    const grouped = groupRoutingBySeverity(routing);
    expect(grouped.ok).toHaveLength(1);
    expect(grouped.targeted_review).toHaveLength(1);
    expect(grouped.blocking).toHaveLength(1);
  });

  it('handles null routing gracefully', () => {
    const grouped = groupRoutingBySeverity(null);
    expect(grouped.ok).toEqual([]);
    expect(grouped.targeted_review).toEqual([]);
    expect(grouped.blocking).toEqual([]);
  });
});
