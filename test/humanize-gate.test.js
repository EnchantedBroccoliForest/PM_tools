/**
 * Humanize-gate structural test.
 *
 * Phase 3 made one user-visible behavior decision (§0.4 in the plan):
 * the post-finalize humanizer runs only under Human rigor, and only
 * from the UI's handleAccept. The CLI and eval harness produce
 * un-humanized JSON in both modes so the eval baseline stays stable.
 *
 * That decision is encoded in two spots, both load-bearing:
 *
 *   1. src/App.jsx's handleAccept wraps humanizeFinalJson in a
 *      `runRigor === 'human'` guard, and emits a canary log line
 *      ("Humanize skipped: Machine rigor selected.") on the skip path.
 *      The canary is what a future regression test or a manual run
 *      check looks for to confirm Machine never humanized.
 *
 *   2. src/orchestrate.js does not import or invoke the humanizer at
 *      all. This is the §0.4 locked decision: humanization is
 *      UI-only.
 *
 * A React-harness test that drives the gate at runtime would be
 * stronger, but the repo has no such harness today. This file gives
 * us a regression signal without spinning one up: any refactor that
 * drops the gate, drops the canary, or wires the humanizer into the
 * orchestrator path will fail here.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

function readSource(rel) {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

describe('humanize gate is wired in handleAccept under Human rigor only', () => {
  const APP = readSource('src/App.jsx');
  const APP_CODE = stripComments(APP);

  it('App.jsx still imports humanizeFinalJson (Human path needs it)', () => {
    expect(APP_CODE).toMatch(/import\s*{\s*humanizeFinalJson\s*}\s*from/);
  });

  it('handleAccept guards humanizeFinalJson with a Human-rigor conditional', () => {
    // Find the handleAccept body and check the gate appears inside it.
    const handleAcceptIdx = APP.indexOf('const handleAccept');
    expect(handleAcceptIdx).toBeGreaterThan(-1);
    // Slice forward enough text to cover the body. The whole file is
    // ~2300 lines; a 12_000-char window covers handleAccept comfortably
    // without bleeding into far-away handlers.
    const body = APP.slice(handleAcceptIdx, handleAcceptIdx + 12000);
    const bodyCode = stripComments(body);
    // Gate condition: `runRigor === 'human'` (the snapshotted rigor name
    // used by Phase 3's handleAccept).
    expect(bodyCode).toMatch(/runRigor\s*===\s*['"]human['"]/);
    // The actual humanizer call must appear inside that body.
    expect(bodyCode).toMatch(/humanizeFinalJson\s*\(/);
  });

  it('handleAccept emits the "Humanize skipped" canary log line on the Machine path', () => {
    expect(APP).toContain('Humanize skipped: Machine rigor selected.');
  });
});

describe('orchestrate stays UI-free of the humanizer (§0.4 locked decision)', () => {
  const ORCH = stripComments(readSource('src/orchestrate.js'));

  it('does not import humanizeFinalJson', () => {
    expect(ORCH).not.toMatch(/from\s+['"][^'"]*pipeline\/humanize/);
    expect(ORCH).not.toMatch(/\bhumanizeFinalJson\b/);
  });

  it('does not import the humanizer system prompt or builder', () => {
    expect(ORCH).not.toMatch(/buildHumanizerPrompt/);
    // SYSTEM_PROMPTS access in orchestrate.js was already removed in
    // Phase 2, but a future refactor could try to look up
    // `getSystemPrompt('humanizer', ...)` — that would still be a §0.4
    // violation. Catch it here.
    expect(ORCH).not.toMatch(/getSystemPrompt\(\s*['"]humanizer['"]/);
  });
});
