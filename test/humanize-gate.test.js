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

/**
 * Find the balanced `{...}` block that immediately follows the first
 * match of `anchorRegex` in `src` and return the contents (without the
 * outer braces). Returns null when either the anchor or its block is
 * missing. Used by the gate test to extract the body of the
 * `if (runRigor === 'human') { ... }` block so we can assert which
 * calls live inside it vs alongside it.
 *
 * Quotes and template literals inside the block can confuse a naive
 * brace counter — App.jsx's gate body doesn't currently have any, but
 * skipping over them keeps this helper safe against future edits.
 */
function balancedBlockAfter(src, anchorRegex) {
  const match = anchorRegex.exec(src);
  if (!match) return null;
  let i = match.index + match[0].length;
  while (i < src.length && src[i] !== '{') i++;
  if (i >= src.length) return null;
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) break;
        i++;
      }
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(start + 1, i);
    }
  }
  return null;
}

describe('humanize gate is wired in handleAccept under Human rigor only', () => {
  const APP = readSource('src/App.jsx');
  const APP_CODE = stripComments(APP);

  it('App.jsx still imports humanizeFinalJson (Human path needs it)', () => {
    expect(APP_CODE).toMatch(/import\s*{\s*humanizeFinalJson\s*}\s*from/);
  });

  it('every humanizeFinalJson call in App.jsx lives inside the Human-rigor guard block', () => {
    // The weaker version of this test (and the version a previous review
    // flagged as P3) only required the conditional and the call to both
    // appear somewhere in handleAccept — which would still pass if a
    // future refactor moved the call out of the guard. To lock the real
    // contract, we extract the balanced `if (runRigor === 'human') { ... }`
    // block and assert that every humanizer call in the entire file lives
    // inside it.
    const guardBlock = balancedBlockAfter(
      APP_CODE,
      /if\s*\(\s*runRigor\s*===\s*['"]human['"]\s*\)\s*/,
    );
    expect(guardBlock, 'expected `if (runRigor === \'human\') { ... }` block in App.jsx').not.toBeNull();
    expect(guardBlock).toMatch(/humanizeFinalJson\s*\(/);

    const totalCalls = (APP_CODE.match(/humanizeFinalJson\s*\(/g) || []).length;
    const callsInsideGuard = (guardBlock.match(/humanizeFinalJson\s*\(/g) || []).length;
    expect(
      totalCalls,
      'unguarded humanizeFinalJson() call detected outside the Human-rigor block',
    ).toBe(callsInsideGuard);
    expect(totalCalls).toBeGreaterThan(0);
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
