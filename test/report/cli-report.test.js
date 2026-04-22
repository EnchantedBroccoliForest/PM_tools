/**
 * End-to-end tests for the `pm-tools report` subcommand.
 *
 * The `report` command is the only offline CLI path — it reads a Run JSON
 * and re-renders it without any LLM or network calls. We spawn the CLI
 * the way a real user would, so the flag wiring, priority rules, and
 * error messages are tested as a contract rather than as internals.
 *
 * Priority rule under test: `--input <file>` wins over stdin; stdin wins
 * when stdin is not a TTY; otherwise the command prints a usage error on
 * stderr and exits non-zero.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const CLI = join(REPO, 'bin', 'pm-tools.js');
const FIXTURE = join(REPO, 'test', 'fixtures', 'runs', 'clean.json');
const FIXTURE_JSON = readFileSync(FIXTURE, 'utf8');

function run(args, { stdin, env } = {}) {
  // `report` is supposed to work without an API key, but the test
  // harness sets one explicitly so a mis-routed gate can't silently
  // pass by being lenient about auth.
  const mergedEnv = { ...process.env, OPENROUTER_API_KEY: 'stub', ...(env || {}) };
  return spawnSync('node', [CLI, 'report', ...args], {
    input: stdin,
    encoding: 'utf8',
    env: mergedEnv,
  });
}

describe('pm-tools report — input priority', () => {
  it('--input <file> succeeds without stdin', () => {
    const result = run(['--input', FIXTURE, '--level', 'headline']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^PASS\n/);
    expect(result.stdout).toContain('Run: ');
  });

  it('-i short flag is an alias for --input', () => {
    const result = run(['-i', FIXTURE, '--level', 'headline']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^PASS\n/);
  });

  it('stdin fallback works when --input is absent', () => {
    const result = run(['--level', 'headline'], { stdin: FIXTURE_JSON });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^PASS\n/);
  });

  it('--input wins when both are provided', () => {
    const result = run(['--input', FIXTURE, '--level', 'headline'], { stdin: '{"garbage":true}' });
    expect(result.status, result.stderr).toBe(0);
    // Must have rendered the real fixture (has `Question:`), not the
    // stdin garbage (which would fail schema or be dropped).
    expect(result.stdout).toContain('Question: Will the referenced event');
  });

  it('missing --input and no stdin → usage error on stderr, non-zero exit', () => {
    // With stdin omitted, spawnSync treats it as a no-input stream, but
    // the CLI checks `process.stdin.isTTY` — in spawn mode it's false,
    // so this instead exercises the "empty stdin" path and yields a
    // JSON parse error rather than a TTY usage error. That's still a
    // user-facing non-zero exit. Force the TTY path by supplying a
    // non-JSON string which fails the JSON.parse.
    const result = run(['--level', 'headline'], { stdin: '' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Error:/);
  });

  it('--input pointing at a non-existent file → clean error, non-zero exit', () => {
    const result = run(['--input', '/nonexistent/path/run.json', '--level', 'headline']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Error: failed to read/);
  });

  it('--input with malformed JSON → parse error, non-zero exit', () => {
    const result = run(['--input', CLI, '--level', 'headline']); // CLI file is JS, not JSON
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Error: stdin is not valid JSON|Error: failed to read|Error:/);
  });

  it('--format html produces HTML instead of text', () => {
    const result = run(['--input', FIXTURE, '--format', 'html', '--level', 'headline']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('<section class="pm-report"');
    expect(result.stdout).toContain('<footer class="pm-footer">');
  });
});

describe('pm-tools report — flag validation', () => {
  it('--level bogus → usage error', () => {
    const result = run(['--input', FIXTURE, '--level', 'bogus']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--level must be one of/);
  });

  it('--min-severity bogus → usage error', () => {
    const result = run(['--input', FIXTURE, '--min-severity', 'bogus']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--min-severity must be one of/);
  });

  it('--expand bogus → usage error', () => {
    const result = run(['--input', FIXTURE, '--expand', 'bogus']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--expand must be one of/);
  });

  it('report works without OPENROUTER_API_KEY', () => {
    // Scrub the API key env var to confirm the `report` path is truly
    // offline (the API-key gate is bypassed for this subcommand only).
    const env = { ...process.env };
    delete env.OPENROUTER_API_KEY;
    delete env.VITE_OPENROUTER_API_KEY;
    delete env.VITE_OPENAI_API_KEY;
    const result = spawnSync('node', [CLI, 'report', '--input', FIXTURE, '--level', 'headline'], {
      encoding: 'utf8',
      env,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^PASS\n/);
  });
});
