/**
 * Structural guard: the report layer must not make LLM or network calls.
 *
 * Task 7 makes this invariant explicit: creative re-synthesis at the
 * report layer is where rigor silently leaks. All humanization in `src/
 * report/` must stay structural (headings, icons, severity ordering,
 * collapse/expand). This test fails if anyone imports the OpenRouter
 * client, the humanize pipeline, or calls `fetch`/`XMLHttpRequest` from
 * within the report module.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = join(HERE, '..', '..', 'src', 'report');

function listJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...listJsFiles(full));
    else if (name.endsWith('.js') || name.endsWith('.jsx')) out.push(full);
  }
  return out;
}

// Patterns that would indicate an LLM / network call leaked into the
// report layer. Each entry has a regex and a human-readable description.
const FORBIDDEN_PATTERNS = [
  { pattern: /from\s+['"].*api\/openrouter/, why: 'imports the OpenRouter client' },
  { pattern: /\bqueryModel\s*\(/, why: 'calls queryModel() directly' },
  { pattern: /\bhumanizeFinalJson\s*\(/, why: 'invokes humanizeFinalJson() on the report path' },
  { pattern: /from\s+['"].*pipeline\/humanize/, why: 'imports the humanizer module' },
  { pattern: /\bfetch\s*\(/, why: 'calls fetch()' },
  { pattern: /\bXMLHttpRequest\b/, why: 'uses XMLHttpRequest' },
];

describe('src/report/ stays offline', () => {
  const files = listJsFiles(REPORT_DIR);

  it('discovers at least one source file under src/report/', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file.replace(REPORT_DIR, 'src/report')}: no LLM / network imports or calls`, () => {
      const src = readFileSync(file, 'utf8');
      // Strip block comments and line comments so doc mentions of the
      // humanizer don't trip the check.
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');
      for (const { pattern, why } of FORBIDDEN_PATTERNS) {
        expect(stripped, `${file} ${why}`).not.toMatch(pattern);
      }
    });
  }
});

describe('src/pipeline/humanize.js stays scoped to input-field humanization', () => {
  it('is not imported from src/report/', () => {
    const files = listJsFiles(REPORT_DIR);
    for (const file of files) {
      const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(src).not.toMatch(/pipeline\/humanize/);
    }
  });
});
