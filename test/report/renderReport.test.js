/**
 * Snapshot + invariant tests for the report renderer.
 *
 * - Line-count targets at each tier (Task 2 acceptance criteria).
 * - Determinism: same Run JSON renders byte-identical output.
 * - Traceability: every `run.<path>` reference resolves in the Run JSON.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../../src/report/renderReport.js';
import { renderHtml } from '../../src/report/renderHtml.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures', 'runs');

function loadRun(name) {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
}

function lineCount(text) {
  return text.split('\n').length;
}

describe('renderReport — line-count targets', () => {
  it('clean run fits ≤10 lines at --level headline', () => {
    const run = loadRun('clean.json');
    const out = renderReport(run, { level: 'headline' });
    expect(lineCount(out)).toBeLessThanOrEqual(10);
  });

  it('clean run fits in ~50 lines at --level report', () => {
    const run = loadRun('clean.json');
    const out = renderReport(run, { level: 'report' });
    expect(lineCount(out)).toBeLessThanOrEqual(50);
  });

  it('two-minor-issues run only grows by the attention list', () => {
    const clean = renderReport(loadRun('clean.json'), { level: 'report' });
    const minors = renderReport(loadRun('two-minor-issues.json'), { level: 'report' });
    // Minor run should be longer (has attention items + disagreement), but
    // still bounded — we tolerate up to 25 extra lines for the two-issue
    // fixture.
    const delta = lineCount(minors) - lineCount(clean);
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThanOrEqual(25);
  });

  it('blocked run surfaces BLOCKED on line 1', () => {
    const run = loadRun('blocked.json');
    const out = renderReport(run, { level: 'headline' });
    expect(out.split('\n')[0]).toBe('BLOCKED');
  });

  it('--min-severity blocking collapses non-blocking items', () => {
    const run = loadRun('two-minor-issues.json');
    const out = renderReport(run, { level: 'report', minSeverity: 'blocking' });
    // Attention section should report "(none — ... below threshold)"
    expect(out).toMatch(/\(none — \d+ claim\(s\) below threshold\)/);
  });
});

describe('renderReport — determinism', () => {
  for (const fx of ['clean.json', 'two-minor-issues.json', 'blocked.json']) {
    it(`${fx}: renders byte-identical output twice`, () => {
      const run = loadRun(fx);
      // Important: pass a deep-cloned run each time so mutation doesn't
      // leak between renders.
      const a = renderReport(JSON.parse(JSON.stringify(run)), { level: 'report' });
      const b = renderReport(JSON.parse(JSON.stringify(run)), { level: 'report' });
      expect(a).toBe(b);
    });
  }

  it('clean.json produces identical hash across two renders', () => {
    const run = loadRun('clean.json');
    const a = renderReport(JSON.parse(JSON.stringify(run)), { level: 'headline' });
    const b = renderReport(JSON.parse(JSON.stringify(run)), { level: 'headline' });
    const hashA = /Run: ([0-9a-f]+)/.exec(a)[1];
    const hashB = /Run: ([0-9a-f]+)/.exec(b)[1];
    expect(hashA).toBe(hashB);
    expect(hashA.length).toBe(12);
  });
});

describe('renderReport — traceability', () => {
  /**
   * Given a dot-path like "run.claims[0].verification", walk the Run
   * object and return true iff the path resolves. Paths mentioning
   * parenthesised label text (e.g. "run.criticisms (R1, R2)") are
   * trimmed to their root reference.
   */
  function pathResolves(run, path) {
    // Strip anything after a space — we treat "run.foo (label)" as "run.foo"
    const stripped = path.replace(/\s.*/, '');
    if (!stripped.startsWith('run')) return false;
    const parts = stripped.slice(3).split(/\.|\[|\]/).filter(Boolean);
    let cur = run;
    for (const p of parts) {
      if (cur == null) return false;
      if (/^\d+$/.test(p)) {
        cur = cur[Number(p)];
      } else {
        cur = cur[p];
      }
    }
    return cur !== undefined;
  }

  for (const fx of ['clean.json', 'two-minor-issues.json', 'blocked.json']) {
    it(`${fx}: every run.<path> reference resolves`, () => {
      const run = loadRun(fx);
      const out = renderReport(run, { level: 'full' });
      // Extract everything after the `·  ` muted separator as the path.
      const pathRegex = /·\s+(run\.[A-Za-z_][\w.[\]() ,]*?)(?=$|\n)/gm;
      const paths = [];
      for (const m of out.matchAll(pathRegex)) paths.push(m[1]);
      expect(paths.length).toBeGreaterThan(0);
      for (const p of paths) {
        expect(pathResolves(run, p), `path did not resolve: ${p}`).toBe(true);
      }
    });
  }
});

describe('renderReport — --expand surfaces full content without dragging in others', () => {
  it('--expand reviewers prints rubric but not full claims', () => {
    const run = loadRun('clean.json');
    const out = renderReport(run, { level: 'report', expand: ['reviewers'] });
    expect(out).toMatch(/R\d+ \(mock\/reviewer/);
    // 'Claims (full):' heading only appears under --expand claims / level full
    expect(out).not.toMatch(/Claims \(full\):/);
  });

  it('--expand claims prints full claims but not rubric', () => {
    const run = loadRun('clean.json');
    const out = renderReport(run, { level: 'report', expand: ['claims'] });
    expect(out).toMatch(/Claims \(full\):/);
    // rubric block from reviewer expansion is absent
    expect(out).not.toMatch(/R1 \(mock\/reviewer/);
  });
});

describe('renderHtml — parity', () => {
  it('clean.json: HTML includes all facts the text report asserts', () => {
    const run = loadRun('clean.json');
    const text = renderReport(run, { level: 'report' });
    const html = renderHtml(run, { level: 'report' });
    // Hash + question appear in both.
    const hash = /Run: ([0-9a-f]+)/.exec(text)[1];
    expect(html).toContain(hash);
    expect(html).toContain(run.input.question);
  });

  it('HTML uses <details> for collapsible sections', () => {
    const run = loadRun('clean.json');
    const html = renderHtml(run, { level: 'report', expand: ['claims'] });
    expect(html).toContain('<details');
  });
});
