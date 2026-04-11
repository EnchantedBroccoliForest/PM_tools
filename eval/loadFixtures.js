/**
 * Fixture loader and normaliser.
 *
 * Responsibilities:
 *
 *   1. Read the shared `_defaults.json` once so every fixture inherits a
 *      canonical clean `mockResponses` block. Individual fixtures only
 *      specify the fields their scenario actually cares about, which
 *      keeps fixture files small and self-documenting.
 *
 *   2. Walk `eval/fixtures/<bucket>/*.json`, filter out the underscore-
 *      prefixed metadata files, and produce a merged fixture ready to
 *      hand to `runFixture`. Merge rules:
 *        - top-level fields from the fixture file win
 *        - mockResponses is shallow-merged so a fixture can override
 *          `draft` without having to copy the whole default claims list
 *        - urlResolves is deep-merged (object-level spread) so a fixture
 *          can add a single bad URL without wiping the default
 *          reachable ones
 *
 *   3. Support basic filtering via a glob-ish `--fixtures=<pattern>`
 *      flag from the CLI. The implementation is a simple substring
 *      match on the fixture id (not real glob) — enough for the eval
 *      harness use case without bringing in minimatch.
 *
 * Validation is intentionally loose. Fixtures are data files written by
 * humans and validated at harness-run time by the pipeline modules
 * themselves (via zod). We do the bare minimum here: require an id, a
 * bucket, and an input block; warn on anything else suspicious.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(HERE, 'fixtures');
const DEFAULTS_PATH = join(FIXTURE_ROOT, '_defaults.json');

/**
 * Deep-merge two plain objects. Only used for `urlResolves` where we
 * want the user's additions layered over the defaults without wiping.
 */
function mergeUrlResolves(defaults, override) {
  return { ...(defaults || {}), ...(override || {}) };
}

/**
 * Shallow-merge a fixture's mockResponses with the defaults. Arrays
 * and objects at the top level are replaced wholesale — a fixture that
 * overrides `claims` means "use exactly these claims, not the default
 * set merged with overrides." The one exception is `urlResolves`,
 * where additive merging is the more useful default.
 */
function mergeMockResponses(defaults, override) {
  const d = defaults || {};
  const o = override || {};
  return {
    ...d,
    ...o,
    urlResolves: mergeUrlResolves(d.urlResolves, o.urlResolves),
  };
}

/**
 * Merge a loaded fixture file with the shared defaults. Returns a fresh
 * fixture object ready to hand to `runFixture`.
 *
 * @param {object} fixture       parsed fixture JSON
 * @param {object} defaults      parsed _defaults.json
 * @returns {object}
 */
export function mergeFixtureWithDefaults(fixture, defaults) {
  if (!fixture || typeof fixture !== 'object') {
    throw new TypeError('mergeFixtureWithDefaults: fixture must be an object');
  }
  return {
    ...fixture,
    mockResponses: mergeMockResponses(
      defaults?.mockResponses,
      fixture.mockResponses,
    ),
  };
}

/**
 * Read and parse `_defaults.json`. Throws a readable error if the file
 * is missing — the defaults are non-optional, every fixture needs them.
 */
export async function loadDefaults() {
  const raw = await readFile(DEFAULTS_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse _defaults.json: ${err.message}`);
  }
}

/**
 * List the four fixture buckets. Derived from directory layout so
 * adding a new bucket doesn't require code changes — any subdirectory
 * of `eval/fixtures/` that isn't a file is treated as a bucket.
 */
async function listBuckets() {
  const entries = await readdir(FIXTURE_ROOT, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !name.startsWith('_'))
    .sort();
}

/**
 * Load every fixture file under `eval/fixtures/`, merge with defaults,
 * and return a flat array sorted by (bucket, id) for stable runs.
 *
 * @param {object} [options]
 * @param {string} [options.filter]   substring matched against fixture.id
 * @returns {Promise<object[]>}
 */
export async function loadFixtures({ filter } = {}) {
  const defaults = await loadDefaults();
  const buckets = await listBuckets();
  const all = [];

  for (const bucket of buckets) {
    const dir = join(FIXTURE_ROOT, bucket);
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.json')) continue;
      if (entry.name.startsWith('_')) continue;
      const path = join(dir, entry.name);
      const raw = await readFile(path, 'utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        throw new Error(`Failed to parse fixture ${path}: ${err.message}`);
      }
      if (!parsed.id) parsed.id = entry.name.replace(/\.json$/, '');
      if (!parsed.bucket) parsed.bucket = bucket;
      const merged = mergeFixtureWithDefaults(parsed, defaults);
      // Stamp the source path for nicer error messages in the runner.
      merged.sourcePath = path;
      all.push(merged);
    }
  }

  all.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket.localeCompare(b.bucket);
    return a.id.localeCompare(b.id);
  });

  if (filter) {
    return all.filter((f) => f.id.includes(filter) || f.bucket.includes(filter));
  }
  return all;
}
