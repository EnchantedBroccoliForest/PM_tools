/**
 * Metrics computation for the Phase 6 eval harness.
 *
 * Takes a list of FixtureResults (from `runFixture`) and a list of the
 * corresponding fixtures (with their `expectedProperties`), and produces
 * both per-fixture assertion results and aggregate metrics.
 *
 * The design deliberately keeps assertions additive and per-property:
 * each expected property in a fixture becomes one assertion, and the
 * fixture's overall accuracy is the fraction of its assertions that
 * passed. This lets partial progress show up in the metrics — a
 * refactor that fixes 3 of 5 failing assertions still visibly moves
 * the needle.
 *
 * Assertion keys (all optional per fixture):
 *
 *   - expected_risk                  'low' | 'medium' | 'high' | 'unknown'
 *   - expected_routing_overall       'clean' | 'needs_update' | 'blocked'
 *   - expected_aggregation_overall   'pass' | 'fail' | 'needs_escalation'
 *   - expected_finalize_allowed      boolean
 *   - expected_blocked_by_risk       boolean
 *   - expected_blocked_by_routing    boolean
 *   - expected_blocked_by_verification boolean
 *   - expected_blocked_by_sources    boolean
 *   - expected_has_hard_fail         boolean   (any verification with verdict=hard_fail)
 *   - expected_has_soft_fail         boolean   (any verification with verdict=soft_fail)
 *   - expected_has_contradicted      boolean   (any entailment=contradicted)
 *   - expected_citation_resolves_all boolean   (all source claims citationResolves=true)
 *   - expected_blocking_count        number | 'gte-1'   (claims flagged blocking)
 *   - expected_targeted_count        number | 'gte-1'
 *   - min_claims                     number
 *   - max_claims                     number
 *   - expected_review_skipped        boolean   (selective escalation)
 *   - expected_aggregation_protocol  'majority' | 'unanimity' | 'judge'
 *
 * Aggregate metrics:
 *
 *   - accuracy                  (total passing assertions) / (total assertions)
 *   - perBucketAccuracy         same, split by bucket
 *   - citationCoverage          fraction of fixtures where all source claims resolved
 *   - overrideRate              fraction of fixtures where finalize was allowed despite routing=blocked
 *                               (always 0 for the current harness; reserved for when the
 *                                harness learns to simulate explicit user overrides)
 *   - verifierPassRate          across all verification records, fraction with verdict=pass
 *   - tokenSpendTotal           sum of totalTokensIn + totalTokensOut
 *   - tokenSpendMean            tokenSpendTotal / fixtureCount
 *   - wallClockTotalMs          sum of all fixture wallClockMs
 *   - fixtureCount              number of fixtures scored
 *   - failingFixtures           count of fixtures with any failed assertion
 */

/**
 * Run one assertion against a fixture result. Returns
 * `{key, passed, expected, actual, reason?}`.
 */
function assertOne(key, expected, result) {
  const run = result.run;
  const ver = run.verification || [];
  const claims = run.claims || [];
  const routing = run.routing || { overall: 'clean', items: [] };

  switch (key) {
    case 'expected_risk':
      return {
        key,
        expected,
        actual: result.risk?.level || 'unknown',
        passed: (result.risk?.level || 'unknown') === expected,
      };
    case 'expected_routing_overall':
      return { key, expected, actual: routing.overall, passed: routing.overall === expected };
    case 'expected_aggregation_overall': {
      const actual = run.aggregation?.overall || 'none';
      return { key, expected, actual, passed: actual === expected };
    }
    case 'expected_finalize_allowed':
      return { key, expected, actual: result.gate.allowed, passed: result.gate.allowed === expected };
    case 'expected_blocked_by_risk':
      return { key, expected, actual: result.gate.blockedByRisk, passed: result.gate.blockedByRisk === expected };
    case 'expected_blocked_by_routing':
      return { key, expected, actual: result.gate.blockedByRouting, passed: result.gate.blockedByRouting === expected };
    case 'expected_blocked_by_verification':
      return { key, expected, actual: result.gate.blockedByVerification, passed: result.gate.blockedByVerification === expected };
    case 'expected_blocked_by_sources':
      return { key, expected, actual: result.gate.blockedBySources, passed: result.gate.blockedBySources === expected };
    case 'expected_has_hard_fail': {
      const actual = ver.some((v) => v.verdict === 'hard_fail');
      return { key, expected, actual, passed: actual === expected };
    }
    case 'expected_has_soft_fail': {
      const actual = ver.some((v) => v.verdict === 'soft_fail');
      return { key, expected, actual, passed: actual === expected };
    }
    case 'expected_has_contradicted': {
      const actual = ver.some((v) => v.entailment === 'contradicted');
      return { key, expected, actual, passed: actual === expected };
    }
    case 'expected_citation_resolves_all': {
      const sourceIds = new Set(claims.filter((c) => c.category === 'source').map((c) => c.id));
      const sourceVer = ver.filter((v) => sourceIds.has(v.claimId));
      const actual = sourceVer.length > 0 && sourceVer.every((v) => v.citationResolves === true);
      return { key, expected, actual, passed: actual === expected };
    }
    case 'expected_blocking_count': {
      const actual = routing.items.filter((i) => i.severity === 'blocking').length;
      const passed = expected === 'gte-1' ? actual >= 1 : actual === expected;
      return { key, expected, actual, passed };
    }
    case 'expected_targeted_count': {
      const actual = routing.items.filter((i) => i.severity === 'targeted_review').length;
      const passed = expected === 'gte-1' ? actual >= 1 : actual === expected;
      return { key, expected, actual, passed };
    }
    case 'min_claims':
      return { key, expected, actual: claims.length, passed: claims.length >= expected };
    case 'max_claims':
      return { key, expected, actual: claims.length, passed: claims.length <= expected };
    case 'expected_review_skipped':
      return { key, expected, actual: result.reviewSkipped, passed: result.reviewSkipped === expected };
    case 'expected_aggregation_protocol': {
      const actual = run.aggregation?.protocol || 'none';
      return { key, expected, actual, passed: actual === expected };
    }
    default:
      return { key, expected, actual: null, passed: false, reason: 'unknown assertion key' };
  }
}

/**
 * Evaluate all assertions for one fixture result. Returns
 * `{fixtureId, bucket, assertions, accuracy}`.
 */
export function evaluateFixture(fixture, result) {
  const expected = fixture.expectedProperties || {};
  const assertions = Object.entries(expected).map(([k, v]) => assertOne(k, v, result));
  const passing = assertions.filter((a) => a.passed).length;
  const total = assertions.length;
  return {
    fixtureId: fixture.id,
    bucket: fixture.bucket,
    assertions,
    passing,
    total,
    accuracy: total === 0 ? 1 : passing / total,
    failed: assertions.filter((a) => !a.passed),
  };
}

/**
 * Aggregate metrics across every fixture result. The fixtures and
 * results arrays must be index-aligned.
 *
 * @param {object[]} fixtures
 * @param {object[]} results
 * @returns {object}
 */
export function computeMetrics(fixtures, results) {
  const perFixture = fixtures.map((f, i) => evaluateFixture(f, results[i]));
  let totalPassing = 0;
  let totalAssertions = 0;
  let failingFixtures = 0;
  const bucketTally = new Map();
  let tokenSpendTotal = 0;
  let wallClockTotalMs = 0;
  let verifierRecords = 0;
  let verifierPassing = 0;
  let citationFixtures = 0;
  let citationFixturesPassing = 0;
  let overrideCount = 0;

  for (let i = 0; i < fixtures.length; i++) {
    const fx = fixtures[i];
    const ev = perFixture[i];
    const res = results[i];
    totalPassing += ev.passing;
    totalAssertions += ev.total;
    if (ev.failed.length > 0) failingFixtures += 1;

    const tally = bucketTally.get(fx.bucket) || { passing: 0, total: 0 };
    tally.passing += ev.passing;
    tally.total += ev.total;
    bucketTally.set(fx.bucket, tally);

    const cost = res.run.cost || { totalTokensIn: 0, totalTokensOut: 0, wallClockMs: 0 };
    tokenSpendTotal += (cost.totalTokensIn || 0) + (cost.totalTokensOut || 0);
    wallClockTotalMs += cost.wallClockMs || 0;

    const ver = res.run.verification || [];
    verifierRecords += ver.length;
    verifierPassing += ver.filter((v) => v.verdict === 'pass').length;

    const claims = res.run.claims || [];
    const sourceIds = new Set(claims.filter((c) => c.category === 'source').map((c) => c.id));
    if (sourceIds.size > 0) {
      citationFixtures += 1;
      const allResolved = ver
        .filter((v) => sourceIds.has(v.claimId))
        .every((v) => v.citationResolves === true);
      if (allResolved) citationFixturesPassing += 1;
    }

    // Override rate: a fixture "overrides" when finalize was allowed
    // despite the routing overall being 'blocked'. The current harness
    // never forces this, so this is always 0, but the metric is
    // reserved so later work can wire in a forced-override mode.
    if (res.run.routing?.overall === 'blocked' && res.gate.allowed) {
      overrideCount += 1;
    }
  }

  const perBucketAccuracy = {};
  for (const [bucket, tally] of bucketTally.entries()) {
    perBucketAccuracy[bucket] = tally.total === 0 ? 1 : tally.passing / tally.total;
  }

  return {
    fixtureCount: fixtures.length,
    accuracy: totalAssertions === 0 ? 1 : totalPassing / totalAssertions,
    perBucketAccuracy,
    citationCoverage: citationFixtures === 0 ? 1 : citationFixturesPassing / citationFixtures,
    overrideRate: fixtures.length === 0 ? 0 : overrideCount / fixtures.length,
    verifierPassRate: verifierRecords === 0 ? 1 : verifierPassing / verifierRecords,
    tokenSpendTotal,
    tokenSpendMean: fixtures.length === 0 ? 0 : tokenSpendTotal / fixtures.length,
    wallClockTotalMs,
    failingFixtures,
    perFixture,
  };
}

/**
 * Compare a fresh metrics bundle against a committed baseline. Returns
 * a list of regression entries — each entry names a metric that moved
 * in the wrong direction by more than `thresholdPct` percent.
 *
 * "Wrong direction" is metric-specific:
 *   - accuracy, perBucketAccuracy, citationCoverage, verifierPassRate
 *     → regression = fresh < baseline (lower is worse)
 *   - overrideRate, tokenSpendTotal, tokenSpendMean, wallClockTotalMs,
 *     failingFixtures
 *     → regression = fresh > baseline (higher is worse)
 *
 * The threshold is applied relative to the baseline value. Zero
 * baselines are handled specially: any non-zero fresh value is a
 * regression unless the metric is itself bidirectional (accuracy).
 *
 * @param {object} fresh
 * @param {object} baseline
 * @param {number} [thresholdPct]   default 10
 * @returns {{regressions:Array, improvements:Array}}
 */
export function compareToBaseline(fresh, baseline, thresholdPct = 10) {
  if (!baseline || typeof baseline !== 'object') {
    return { regressions: [], improvements: [], missingBaseline: true };
  }

  const threshold = thresholdPct / 100;
  const regressions = [];
  const improvements = [];

  const higherIsWorse = new Set([
    'overrideRate',
    'tokenSpendTotal',
    'tokenSpendMean',
    'wallClockTotalMs',
    'failingFixtures',
  ]);
  const lowerIsWorse = new Set([
    'accuracy',
    'citationCoverage',
    'verifierPassRate',
  ]);

  const checkScalar = (key, a, b) => {
    if (typeof a !== 'number' || typeof b !== 'number') return;
    if (a === b) return;
    const direction = a > b ? 'up' : 'down';
    const absDelta = Math.abs(a - b);
    const relDelta = b === 0 ? (a === 0 ? 0 : Infinity) : absDelta / Math.abs(b);

    const worse =
      (higherIsWorse.has(key) && direction === 'up') ||
      (lowerIsWorse.has(key) && direction === 'down');
    const better =
      (higherIsWorse.has(key) && direction === 'down') ||
      (lowerIsWorse.has(key) && direction === 'up');

    const entry = { metric: key, baseline: b, fresh: a, delta: a - b, relDelta };
    if (worse && relDelta > threshold) regressions.push(entry);
    else if (better && relDelta > threshold) improvements.push(entry);
  };

  for (const key of [
    'accuracy',
    'citationCoverage',
    'verifierPassRate',
    'overrideRate',
    'tokenSpendTotal',
    'tokenSpendMean',
    'wallClockTotalMs',
    'failingFixtures',
  ]) {
    checkScalar(key, fresh[key], baseline[key]);
  }

  // Per-bucket accuracy: every bucket is lower-is-worse.
  const freshBuckets = fresh.perBucketAccuracy || {};
  const baseBuckets = baseline.perBucketAccuracy || {};
  for (const bucket of Object.keys(baseBuckets)) {
    const a = freshBuckets[bucket];
    const b = baseBuckets[bucket];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    const relDelta = b === 0 ? (a === 0 ? 0 : Infinity) : Math.abs(a - b) / Math.abs(b);
    if (a < b && relDelta > threshold) {
      regressions.push({ metric: `perBucketAccuracy.${bucket}`, baseline: b, fresh: a, delta: a - b, relDelta });
    } else if (a > b && relDelta > threshold) {
      improvements.push({ metric: `perBucketAccuracy.${bucket}`, baseline: b, fresh: a, delta: a - b, relDelta });
    }
  }

  return { regressions, improvements, missingBaseline: false };
}
