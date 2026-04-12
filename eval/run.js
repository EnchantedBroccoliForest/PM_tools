#!/usr/bin/env node
/**
 * CLI runner for the Phase 6 regression eval harness.
 *
 * Usage:
 *   node eval/run.js [flags]
 *   npm run eval -- [flags]
 *
 * Ablation flags (the four non-negotiable knobs from the work order):
 *   --aggregation=majority|unanimity|judge       (default: majority)
 *   --escalation=always|selective                (default: always)
 *   --evidence=none|retrieval|retrieval+debate   (default: retrieval)
 *   --verifiers=off|partial|full                 (default: full)
 *
 * Additional flags:
 *   --fixtures=<substring>           filter fixtures by id / bucket substring
 *   --out=<dir>                      output directory (default: eval/out/<timestamp>)
 *   --baseline                       rewrite eval/baseline.json with fresh metrics
 *   --check-regression               exit non-zero if any metric regressed >10%
 *   --threshold=<pct>                regression threshold, default 10
 *   --quiet                          suppress per-fixture output
 *
 * Exit codes:
 *   0 — all fixtures ran, accuracy ≥ 0.99, no regressions
 *   1 — one or more fixtures had failing assertions OR a metric regressed
 *   2 — harness infrastructure error (couldn't load fixtures, etc.)
 *
 * The runner writes the full per-fixture output (including the complete
 * Run artifact for each fixture) to `eval/out/<timestamp>/`, plus a
 * summary table to stdout.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtures } from './loadFixtures.js';
import { runFixture } from './harness.js';
import { computeMetrics, compareToBaseline } from './metrics.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const BASELINE_PATH = join(HERE, 'baseline.json');

// --- CLI parsing ---------------------------------------------------------

function parseArgs(argv) {
  const args = {
    // Defaults are chosen so `npm run eval` exercises the full pipeline:
    // always run the review stage (so ambiguity fixtures can observe the
    // reviewer decisions), run full verifiers (structural + entailment),
    // and gather evidence so citation fixtures produce real signals.
    // `escalation=selective` is the Phase 5 ablation and is tested by
    // running with --escalation=selective explicitly.
    aggregation: 'majority',
    escalation: 'always',
    evidence: 'retrieval',
    verifiers: 'full',
    fixtures: null,
    out: null,
    baseline: false,
    checkRegression: false,
    threshold: 10,
    quiet: false,
  };
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const eqIdx = raw.indexOf('=');
    const key = eqIdx === -1 ? raw.slice(2) : raw.slice(2, eqIdx);
    const value = eqIdx === -1 ? true : raw.slice(eqIdx + 1);
    switch (key) {
      case 'aggregation':
        args.aggregation = value;
        break;
      case 'escalation':
        args.escalation = value;
        break;
      case 'evidence':
        args.evidence = value;
        break;
      case 'verifiers':
        args.verifiers = value;
        break;
      case 'fixtures':
        args.fixtures = value;
        break;
      case 'out':
        args.out = value;
        break;
      case 'baseline':
        args.baseline = true;
        break;
      case 'check-regression':
        args.checkRegression = true;
        break;
      case 'threshold':
        args.threshold = Number(value) || 10;
        break;
      case 'quiet':
        args.quiet = true;
        break;
      case 'help':
      case 'h':
        args.help = true;
        break;
      default:
        console.warn(`[eval] unknown flag --${key}`);
    }
  }
  return args;
}

const HELP = `
PM_tools — Phase 6 regression eval harness

Usage:
  node eval/run.js [flags]

Ablation flags:
  --aggregation=majority|unanimity|judge       protocol for rubric roll-up
  --escalation=always|selective                whether to skip review when clean
  --evidence=none|retrieval|retrieval+debate   retrieval behaviour
  --verifiers=off|partial|full                 verifier depth

Filters & output:
  --fixtures=<substring>   only run fixtures whose id / bucket contains this string
  --out=<dir>              directory for per-run JSON dumps (default: eval/out/<ts>)
  --baseline               write metrics to eval/baseline.json (overwrites)
  --check-regression       exit non-zero if any metric regressed > threshold
  --threshold=<pct>        regression threshold, default 10
  --quiet                  suppress per-fixture output
  --help                   print this message
`;

// --- Pretty printing helpers --------------------------------------------

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

function padRight(s, n) {
  const t = String(s);
  return t.length >= n ? t : t + ' '.repeat(n - t.length);
}

function padLeft(s, n) {
  const t = String(s);
  return t.length >= n ? t : ' '.repeat(n - t.length) + t;
}

function formatSummary(metrics, ablation) {
  const lines = [];
  lines.push('');
  lines.push('========================================================');
  lines.push(`  PM_tools eval — ${metrics.fixtureCount} fixtures`);
  lines.push(`  aggregation=${ablation.aggregation} escalation=${ablation.escalation} evidence=${ablation.evidence} verifiers=${ablation.verifiers}`);
  lines.push('--------------------------------------------------------');
  lines.push(`  Accuracy                : ${pct(metrics.accuracy)}`);
  lines.push(`  Citation coverage       : ${pct(metrics.citationCoverage)}`);
  lines.push(`  Verifier pass rate      : ${pct(metrics.verifierPassRate)}`);
  lines.push(`  Override rate           : ${pct(metrics.overrideRate)}`);
  lines.push(`  Failing fixtures        : ${metrics.failingFixtures} / ${metrics.fixtureCount}`);
  lines.push(`  Token spend (total)     : ${metrics.tokenSpendTotal}`);
  lines.push(`  Token spend (mean)      : ${metrics.tokenSpendMean.toFixed(1)}`);
  lines.push(`  Wall clock (ms, total)  : ${metrics.wallClockTotalMs}`);
  lines.push('--------------------------------------------------------');
  lines.push('  Per-bucket accuracy');
  for (const [bucket, acc] of Object.entries(metrics.perBucketAccuracy)) {
    lines.push(`    ${padRight(bucket, 22)} ${pct(acc)}`);
  }
  lines.push('========================================================');
  return lines.join('\n');
}

function formatFixtureLine(ev) {
  const status = ev.failed.length === 0 ? 'PASS' : 'FAIL';
  return `  [${status}] ${padRight(ev.bucket, 20)} ${padRight(ev.fixtureId, 34)} ${padLeft(ev.passing + '/' + ev.total, 8)}`;
}

function formatFailureDetail(ev) {
  const lines = [`  Fixture ${ev.fixtureId} (${ev.bucket}) failed ${ev.failed.length} of ${ev.total} assertions:`];
  for (const a of ev.failed) {
    lines.push(`    - ${a.key}: expected ${JSON.stringify(a.expected)} got ${JSON.stringify(a.actual)}`);
  }
  return lines.join('\n');
}

// --- Output ---------------------------------------------------------------

async function writeRunOutput(outDir, fixtures, results, metrics, ablation) {
  await mkdir(outDir, { recursive: true });
  // One file per fixture for easy post-hoc inspection.
  for (let i = 0; i < fixtures.length; i++) {
    const path = join(outDir, `${fixtures[i].id}.json`);
    await writeFile(
      path,
      JSON.stringify({
        fixture: fixtures[i],
        result: results[i],
        evaluation: metrics.perFixture[i],
      }, null, 2),
    );
  }
  // Top-level summary without the per-fixture blob (already in the files above).
  const summary = {
    ablation,
    ranAt: new Date().toISOString(),
    fixtureCount: metrics.fixtureCount,
    accuracy: metrics.accuracy,
    perBucketAccuracy: metrics.perBucketAccuracy,
    citationCoverage: metrics.citationCoverage,
    verifierPassRate: metrics.verifierPassRate,
    overrideRate: metrics.overrideRate,
    tokenSpendTotal: metrics.tokenSpendTotal,
    tokenSpendMean: metrics.tokenSpendMean,
    wallClockTotalMs: metrics.wallClockTotalMs,
    failingFixtures: metrics.failingFixtures,
  };
  await writeFile(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  return summary;
}

async function maybeWriteBaseline(summary) {
  // Strip `ranAt` and `wallClockTotalMs` before persisting the baseline.
  // `ranAt` is a wall-clock timestamp that would cause spurious git diffs
  // every time someone re-baselines. `wallClockTotalMs` is influenced by
  // host load (even with mock fetch there's async scheduling jitter), so
  // excluding it from the committed baseline keeps CI stable; the live
  // run still prints it for humans.
  const { ranAt: _ranAt, wallClockTotalMs: _wallClockTotalMs, ...stable } = summary;
  await writeFile(BASELINE_PATH, JSON.stringify(stable, null, 2) + '\n');
  console.log(`[eval] wrote baseline to ${BASELINE_PATH}`);
}

async function maybeReadBaseline() {
  try {
    const raw = await readFile(BASELINE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --- Main -----------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    process.exit(0);
  }

  const ablation = {
    aggregation: args.aggregation,
    escalation: args.escalation,
    evidence: args.evidence,
    verifiers: args.verifiers,
  };

  // Load fixtures.
  let fixtures;
  try {
    fixtures = await loadFixtures({ filter: args.fixtures });
  } catch (err) {
    console.error(`[eval] failed to load fixtures: ${err.message}`);
    process.exit(2);
  }
  if (fixtures.length === 0) {
    console.error('[eval] no fixtures matched the filter');
    process.exit(2);
  }

  // Run fixtures sequentially. Parallelism would save wall-clock but the
  // mock LLM is fast enough that sequential output is more readable and
  // avoids any ordering surprises in the Run artifacts.
  const results = [];
  for (const fixture of fixtures) {
    try {
      const r = await runFixture(fixture, ablation);
      results.push(r);
    } catch (err) {
      console.error(`[eval] fixture ${fixture.id} threw: ${err.stack || err.message}`);
      process.exit(2);
    }
  }

  // Compute metrics and print summary.
  const metrics = computeMetrics(fixtures, results);

  if (!args.quiet) {
    for (const ev of metrics.perFixture) {
      console.log(formatFixtureLine(ev));
    }
    const failures = metrics.perFixture.filter((e) => e.failed.length > 0);
    for (const ev of failures) {
      console.log('');
      console.log(formatFailureDetail(ev));
    }
  }

  console.log(formatSummary(metrics, ablation));

  // Write per-fixture dumps.
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  const outDir = args.out ? join(REPO_ROOT, args.out) : join(HERE, 'out', ts);
  const summary = await writeRunOutput(outDir, fixtures, results, metrics, ablation);
  console.log(`[eval] wrote run to ${outDir}`);

  // Baseline or regression check.
  if (args.baseline) {
    await maybeWriteBaseline(summary);
  }

  if (args.checkRegression) {
    const baseline = await maybeReadBaseline();
    if (!baseline) {
      console.warn('[eval] --check-regression set but no baseline.json found; skipping comparison');
    } else {
      const { regressions, improvements } = compareToBaseline(summary, baseline, args.threshold);
      if (improvements.length > 0) {
        console.log('');
        console.log('[eval] improvements vs baseline:');
        for (const e of improvements) {
          console.log(`  + ${e.metric}: ${e.baseline} → ${e.fresh} (${pct(e.relDelta)} change)`);
        }
      }
      if (regressions.length > 0) {
        console.error('');
        console.error('[eval] REGRESSIONS vs baseline:');
        for (const e of regressions) {
          console.error(`  - ${e.metric}: ${e.baseline} → ${e.fresh} (${pct(e.relDelta)} worse)`);
        }
        process.exit(1);
      } else {
        console.log('[eval] no regressions vs baseline.');
      }
    }
  }

  // Non-zero exit if any fixture had failing assertions.
  if (metrics.failingFixtures > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`[eval] fatal: ${err.stack || err.message}`);
  process.exit(2);
});
