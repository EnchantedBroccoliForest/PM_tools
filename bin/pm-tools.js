#!/usr/bin/env node
/**
 * 42_creator_tool CLI.
 *
 * Commands:
 *   draft      Run the full pipeline and print a Run artifact
 *   ideate     Brainstorm market ideas
 *   validate   Re-run claim extraction + verification on an existing Run
 *
 * Usage:
 *   npx pm-tools draft -q "Will X happen?" --start 2026-06-01 --end 2026-09-01
 *   echo '{"input":{...}}' | npx pm-tools draft --verbose
 */

import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';

// ------------------------------------------------------------------ help

const USAGE = `\
pm-tools — prediction market drafting pipeline

COMMANDS
  draft      Run the full pipeline (draft → review → update → finalize)
  ideate     Brainstorm market ideas from a direction prompt
  validate   Re-run claim extraction + verification on an existing Run
  report     Re-render an existing Run JSON (from stdin or --input) into the
             narrative report. No network, no LLM calls.

DRAFT FLAGS
  --question, -q     Market question (required)
  --start            Start date, ISO 8601 (required)
  --end              End date, ISO 8601 (required)
  --references       Resolution source URLs (comma-separated)
  --rigor            machine | human (default: machine). Machine uses
                     today's adversarial reviewer prompts and skips the
                     post-finalize humanizer. Human softens reviewer
                     wording, prefers concise drafts, and runs the
                     humanizer over the final card. The eval baseline
                     is pinned to Machine; --rigor=human is for ad-hoc
                     comparison runs and is not gated by CI.
  --drafter          OpenRouter model ID for drafting
  --reviewers        Comma-separated reviewer model IDs
  --aggregation      majority | unanimity | judge
  --escalation       always | selective
  --feedback         Human feedback string (injected before update stage)
  --output, -o       Write Run JSON to file instead of stdout
  --input, -i        For 'report' only: read Run JSON from this path
                     (alternative to piping it on stdin)
  --format           json | report | html (default: json unless --level set)
  --level            headline | report | full (text report tier)
  --min-severity     info | minor | targeted_review | blocking
                     (default: targeted_review at --level report)
  --expand           repeatable: reviewers | claims | evidence | events |
                     costs | updates — pull full content for that section
  --verbose          Print stage progress to stderr
  --no-finalize      Stop after update (skip finalize)
  --no-review        Stop after initial draft + claim pipeline
  --xapi-enrich      Enrich references with X/Twitter data via xAPI
  --timeout          Max seconds before aborting (default: 300)

IDEATE FLAGS
  --direction, -d    Direction/topic for brainstorming (required)
  --drafter          OpenRouter model ID

ENVIRONMENT
  OPENROUTER_API_KEY         API key (preferred)
  VITE_OPENROUTER_API_KEY    API key (Vite fallback)
  XAPI_KEY                   xAPI key for X/Twitter enrichment (optional)

STDIN
  If stdin is not a TTY, it is read as JSON matching the orchestrate config
  shape. CLI flags override stdin fields.

EXAMPLES
  npx pm-tools draft -q "Will BTC exceed 100k?" --start 2026-06-01 --end 2026-09-01
  npx pm-tools draft -q "..." --start ... --end ... --level report
  npx pm-tools draft -q "..." --start ... --end ... --level headline
  npx pm-tools draft -q "..." --start ... --end ... --level report --expand reviewers
  cat run.json | npx pm-tools report --level report
  cat run.json | npx pm-tools report --level report --min-severity blocking
  cat run.json | npx pm-tools report --format html --level full > report.html
  npx pm-tools ideate -d "AI regulation in the EU"
`;

// ----------------------------------------------------------- arg parsing

function parseCliArgs() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      question: { type: 'string', short: 'q' },
      start: { type: 'string' },
      end: { type: 'string' },
      references: { type: 'string' },
      rigor: { type: 'string' },
      drafter: { type: 'string' },
      reviewers: { type: 'string' },
      aggregation: { type: 'string' },
      escalation: { type: 'string' },
      feedback: { type: 'string' },
      output: { type: 'string', short: 'o' },
      input: { type: 'string', short: 'i' },
      format: { type: 'string' },
      level: { type: 'string' },
      'min-severity': { type: 'string' },
      expand: { type: 'string', multiple: true },
      verbose: { type: 'boolean', default: false },
      'no-finalize': { type: 'boolean', default: false },
      'no-review': { type: 'boolean', default: false },
      'xapi-enrich': { type: 'boolean', default: false },
      timeout: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
      // ideate
      direction: { type: 'string', short: 'd' },
    },
  });
  return { values, command: positionals[0] || null };
}

// ---------------------------------------------------------- stdin reader

function readStdinJson() {
  if (process.stdin.isTTY) return null;
  try {
    const raw = readFileSync(0, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --------------------------------------------------- report dispatcher

const VALID_LEVELS = new Set(['headline', 'report', 'full']);
const VALID_MIN_SEVERITY = new Set(['info', 'minor', 'targeted_review', 'blocking']);
const VALID_EXPAND = new Set(['reviewers', 'claims', 'evidence', 'events', 'costs', 'updates']);

/**
 * Decide how to render the Run based on CLI flags. `--format json` always
 * wins; otherwise `--level` selects the text-report tier (default 'report'
 * when any --level / --min-severity / --expand flag is present).
 */
async function formatRun(run, values) {
  const format = values.format || (values.level || values['min-severity'] || values.expand ? 'report' : 'json');
  if (format === 'json') {
    return JSON.stringify(run, null, 2);
  }
  if (format === 'html') {
    const { renderHtml } = await import('../src/report/renderHtml.js');
    return renderHtml(run, buildRenderOptions(values));
  }
  // text report
  const { renderReport } = await import('../src/report/renderReport.js');
  return renderReport(run, buildRenderOptions(values));
}

function buildRenderOptions(values) {
  const level = values.level || 'report';
  if (!VALID_LEVELS.has(level)) {
    process.stderr.write(`Error: --level must be one of ${[...VALID_LEVELS].join(', ')}\n`);
    process.exit(2);
  }
  const minSeverity = values['min-severity'];
  if (minSeverity && !VALID_MIN_SEVERITY.has(minSeverity)) {
    process.stderr.write(`Error: --min-severity must be one of ${[...VALID_MIN_SEVERITY].join(', ')}\n`);
    process.exit(2);
  }
  const expand = values.expand || [];
  for (const section of expand) {
    if (!VALID_EXPAND.has(section)) {
      process.stderr.write(`Error: --expand must be one of ${[...VALID_EXPAND].join(', ')}\n`);
      process.exit(2);
    }
  }
  return { level, minSeverity, expand };
}

// ---------------------------------------------------- command: draft

async function cmdDraft(values, stdinConfig) {
  const { orchestrate } = await import('../src/orchestrate.js');

  // Merge stdin config with CLI flags (flags override).
  const base = stdinConfig || {};
  const baseInput = base.input || {};
  const baseModels = base.models || {};
  const baseOptions = base.options || {};

  const question = values.question || baseInput.question;
  const startDate = values.start || baseInput.startDate;
  const endDate = values.end || baseInput.endDate;

  if (!question || !startDate || !endDate) {
    process.stderr.write('Error: --question (-q), --start, and --end are required.\n\n');
    process.stderr.write(USAGE);
    process.exit(2);
  }

  // Default to 'machine' so headless / scripted
  // callers retain today's behavior — Human mode is opt-in. CLI flag wins
  // over stdin to match the rest of this command's precedence rules; an
  // unrecognised value is rejected so a typo (e.g. --rigor=Human) cannot
  // silently downgrade the run to the default.
  const rawRigor = values.rigor || baseInput.rigor || 'machine';
  if (rawRigor !== 'machine' && rawRigor !== 'human') {
    process.stderr.write(`Error: --rigor must be 'machine' or 'human' (got '${rawRigor}').\n`);
    process.exit(2);
  }
  const rigor = rawRigor;

  // Build references from CLI flag or stdin.
  let references = baseInput.references;
  if (values.references) {
    references = values.references.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (typeof references === 'string') {
    references = references.split('\n').filter(Boolean);
  }

  // Build reviewers from CLI flag or stdin.
  let reviewers = baseModels.reviewers;
  if (values.reviewers) {
    reviewers = values.reviewers.split(',').map((s) => s.trim()).filter(Boolean)
      .map((id) => ({ id, name: id }));
  }

  const config = {
    input: {
      question,
      startDate,
      endDate,
      references: references || [],
      rigor,
    },
    models: {
      drafter: values.drafter || baseModels.drafter,
      reviewers: reviewers || baseModels.reviewers,
      judge: baseModels.judge,
    },
    options: {
      aggregation: values.aggregation || baseOptions.aggregation,
      escalation: values.escalation || baseOptions.escalation,
      humanFeedback: values.feedback || baseOptions.humanFeedback,
      skipReview: values['no-review'] || baseOptions.skipReview,
      skipFinalize: values['no-finalize'] || baseOptions.skipFinalize,
      xapiEnrich: values['xapi-enrich'] || baseOptions.xapiEnrich || false,
    },
  };

  // Verbose callbacks — print stage progress to stderr.
  if (values.verbose) {
    const stageTimers = new Map();
    config.callbacks = {
      onStageStart(stage) {
        stageTimers.set(stage, Date.now());
        process.stderr.write(`[${stage}] starting...\n`);
      },
      onStageEnd(stage) {
        const elapsed = stageTimers.has(stage)
          ? ((Date.now() - stageTimers.get(stage)) / 1000).toFixed(1)
          : '?';
        process.stderr.write(`[${stage}] done (${elapsed}s)\n`);
      },
      onLog(entry) {
        if (entry.level === 'error' || entry.level === 'warn') {
          process.stderr.write(`[${entry.stage}] ${entry.level}: ${entry.message}\n`);
        }
      },
    };
  }

  // Abort setup: timeout + SIGINT.
  const controller = new AbortController();
  const timeoutSec = parseInt(values.timeout, 10) || 300;
  const timer = setTimeout(() => {
    process.stderr.write(`\nTimeout after ${timeoutSec}s — aborting pipeline.\n`);
    controller.abort();
  }, timeoutSec * 1000);

  const sigHandler = () => {
    process.stderr.write('\nSIGINT received — aborting pipeline gracefully.\n');
    controller.abort();
  };
  process.on('SIGINT', sigHandler);

  let run;
  try {
    run = await orchestrate(config, controller.signal);
  } finally {
    clearTimeout(timer);
    process.off('SIGINT', sigHandler);
  }

  // Output. JSON by default (machine consumption); switch to the narrative
  // report renderer when --level / --min-severity / --expand are present
  // or --format=report|html.
  const output = await formatRun(run, values);

  if (values.output) {
    writeFileSync(values.output, output + '\n', 'utf8');
    process.stderr.write(`Run written to ${values.output}\n`);
  } else {
    process.stdout.write(output + '\n');
  }

  // Exit code.
  if (run.status === 'complete') process.exit(0);
  if (run.status === 'error') process.exit(2);
  process.exit(1); // blocked or partial
}

// ---------------------------------------------------- command: ideate

async function cmdIdeate(values) {
  const { queryModel } = await import('../src/api/openrouter.js');
  const { getSystemPrompt, buildIdeatePrompt } = await import('../src/constants/prompts.js');
  const { DEFAULT_DRAFT_MODEL } = await import('../src/defaults.js');

  const direction = values.direction || values.question;
  if (!direction) {
    process.stderr.write('Error: --direction (-d) is required for ideate.\n\n');
    process.stderr.write(USAGE);
    process.exit(2);
  }

  const model = values.drafter || DEFAULT_DRAFT_MODEL;
  if (values.verbose) {
    process.stderr.write(`[ideate] model=${model}\n`);
  }

  const result = await queryModel(model, [
    { role: 'system', content: getSystemPrompt('ideator') },
    { role: 'user', content: buildIdeatePrompt(direction) },
  ]);

  process.stdout.write(result.content + '\n');
  process.exit(0);
}

// ----------------------------------------------------- command: report

async function cmdReport(values) {
  let raw;
  // Primary path: --input <file>. Falls back to stdin so existing
  // pipelines like `cat run.json | pm-tools report` still work.
  if (values.input) {
    try {
      raw = readFileSync(values.input, 'utf8');
    } catch (err) {
      process.stderr.write(`Error: failed to read ${values.input}: ${err.message}\n`);
      process.exit(2);
    }
  } else if (!process.stdin.isTTY) {
    try {
      raw = readFileSync(0, 'utf8');
    } catch {
      process.stderr.write('Error: failed to read Run JSON from stdin.\n');
      process.exit(2);
    }
  } else {
    process.stderr.write('Error: pass --input <file.json> or pipe a Run JSON into stdin for `report`.\n');
    process.exit(2);
  }
  let run;
  try {
    run = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`Error: stdin is not valid JSON: ${err.message}\n`);
    process.exit(2);
  }

  // Force non-json format: the whole point of `report` is the narrative
  // renderer. Respect --format=html if provided, otherwise text.
  if (!values.format || values.format === 'json') values.format = 'report';
  const output = await formatRun(run, values);
  if (values.output) {
    writeFileSync(values.output, output + '\n', 'utf8');
    process.stderr.write(`Report written to ${values.output}\n`);
  } else {
    process.stdout.write(output + '\n');
  }
  process.exit(0);
}

// -------------------------------------------------- command: validate

async function cmdValidate(values) {
  const { extractClaims } = await import('../src/pipeline/extractClaims.js');
  const { verifyClaims } = await import('../src/pipeline/verify.js');
  const { DEFAULT_DRAFT_MODEL } = await import('../src/defaults.js');

  // Read a Run from stdin or --output file.
  let runJson;
  if (!process.stdin.isTTY) {
    try {
      runJson = JSON.parse(readFileSync(0, 'utf8'));
    } catch {
      process.stderr.write('Error: stdin must contain a valid Run JSON.\n');
      process.exit(2);
    }
  } else {
    process.stderr.write('Error: pipe a Run JSON into stdin for validate.\n');
    process.exit(2);
  }

  const draftContent = runJson.drafts?.[runJson.drafts.length - 1]?.content;
  if (!draftContent) {
    process.stderr.write('Error: Run has no draft content.\n');
    process.exit(2);
  }

  const model = values.drafter || DEFAULT_DRAFT_MODEL;
  if (values.verbose) {
    process.stderr.write(`[validate] extracting claims with ${model}...\n`);
  }

  const claimResult = await extractClaims(model, draftContent);
  if (values.verbose) {
    process.stderr.write(`[validate] extracted ${claimResult.claims.length} claims\n`);
    process.stderr.write(`[validate] verifying...\n`);
  }

  const verifyResult = await verifyClaims(claimResult.claims, draftContent, model);

  const output = {
    claims: claimResult.claims,
    verification: verifyResult.verifications,
    usage: {
      claims: claimResult.usage,
      verify: verifyResult.usage,
    },
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(0);
}

// ----------------------------------------------------------------- main

async function main() {
  let parsed;
  try {
    parsed = parseCliArgs();
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n\n`);
    process.stderr.write(USAGE);
    process.exit(2);
  }

  const { values, command } = parsed;

  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  if (!command) {
    process.stderr.write(USAGE);
    process.exit(2);
  }

  // Check for API key early — but `report` is offline-only and must work
  // without one (that's the whole point: re-render a saved Run from disk).
  if (command !== 'report') {
    const hasKey = !!(
      process.env.OPENROUTER_API_KEY ||
      process.env.VITE_OPENROUTER_API_KEY ||
      process.env.VITE_OPENAI_API_KEY
    );
    if (!hasKey) {
      process.stderr.write(
        'Error: No API key found. Set OPENROUTER_API_KEY in your environment.\n' +
        '  export OPENROUTER_API_KEY=sk-or-...\n'
      );
      process.exit(2);
    }
  }

  // Read stdin config for commands that support it.
  const stdinConfig = (command === 'draft') ? readStdinJson() : null;

  switch (command) {
    case 'draft':
      await cmdDraft(values, stdinConfig);
      break;
    case 'ideate':
      await cmdIdeate(values);
      break;
    case 'validate':
      await cmdValidate(values);
      break;
    case 'report':
      await cmdReport(values);
      break;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n`);
      process.stderr.write(USAGE);
      process.exit(2);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message || err}\n`);
  if (err.stack) process.stderr.write(err.stack + '\n');
  process.exit(2);
});
