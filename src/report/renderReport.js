/**
 * Report renderer — pure templating over a Run artifact.
 *
 * The Run JSON is the receipt; the report is the narrative. This module
 * takes a Run and emits a plain-text report at one of three tiers:
 *
 *   - headline (≤10 lines):  verdict, question, top risk, metadata footer.
 *   - report   (default):    headline + stage ledger + attention list.
 *   - full:                  report + per-claim entailment traces,
 *                            reviewer critiques, cost-by-stage, event log.
 *
 * Each assertion carries a trailing `run.<path>` reference so a reader can
 * trace any fact back to the source-of-truth JSON.
 *
 * This module MUST NOT call any LLM or network. The "humanize" pass runs
 * upstream on input-field values only — creative re-synthesis at the
 * report layer is where rigor silently leaks. All humanization here is
 * structural: headings, icons, severity ordering, collapse/expand.
 */

import { assignShortIds, claimShortIdMap } from './shortIds.js';
import { computeRunHash } from './runHash.js';
import { aggregateReviewerFindings, rubricForReviewer } from './aggregateReviews.js';
import {
  diffLines,
  formatDiff,
  countChanges,
  parseDraftSections,
  classifySection,
} from './diff.js';

// --- Severity ordering --------------------------------------------------

const ROUTING_SEVERITY_RANK = { ok: 0, info: 0, minor: 1, targeted_review: 2, blocking: 3 };
const CRITICISM_SEVERITY_RANK = { nit: 0, minor: 1, major: 2, blocker: 3 };

/** Map a `--min-severity` value onto the numeric rank used for filtering. */
function minSeverityRank(level) {
  switch (level) {
    case 'info': return 0;
    case 'minor': return 1;
    case 'targeted_review': return 2;
    case 'blocking': return 3;
    default: return 2;
  }
}

// --- Icons (ASCII so terminals without unicode still render cleanly) ----

const ICON_PASS = '✓';   // ✓
const ICON_WARN = '⚠';   // ⚠
const ICON_FAIL = '✗';   // ✗
const DOT       = '·';   // ·

// --- Top-level verdict logic -------------------------------------------

/**
 * The verdict badge printed on the first line of every report. Derived
 * deterministically from run.status + run.gates + run.routing.
 *
 * @param {import('../types/run.js').Run} run
 * @returns {{label:string, reason:string|null}}
 */
function computeVerdict(run) {
  const gates = run.gates || {};
  if (run.status === 'error') {
    return { label: 'BLOCKED', reason: 'pipeline error' };
  }
  if (run.status === 'blocked' || gates.routing?.blocked || gates.verification?.blocked || gates.risk?.blocked) {
    const reasons = [];
    if (gates.risk?.blocked) reasons.push('risk=high');
    if (gates.routing?.blocked) reasons.push('routing=blocked');
    if (gates.verification?.blocked) reasons.push('verification hard_fail');
    if (gates.sources?.blocked) reasons.push('all sources unreachable');
    return { label: 'BLOCKED', reason: reasons.join(', ') || 'gate rejected' };
  }
  const routingOverall = run.routing?.overall;
  const hasIssues = routingOverall === 'needs_update'
    || (run.aggregation?.overall && run.aggregation.overall !== 'pass')
    || (run.criticisms || []).some((c) => c.severity === 'blocker' || c.severity === 'major');
  if (hasIssues) return { label: 'NEEDS-REVIEW', reason: 'routing needs update or reviewer flagged majors' };
  if (run.status === 'complete') return { label: 'PASS', reason: null };
  if (run.status === 'partial') return { label: 'NEEDS-REVIEW', reason: 'run stopped before finalize' };
  return { label: 'NEEDS-REVIEW', reason: 'unknown status' };
}

/**
 * Top single risk to surface on the third headline line. Picks the most
 * severe blocking / targeted_review routing item or the top blocker
 * criticism.
 */
function topRisk(run) {
  const shortOf = claimShortIdMap(run);
  const routeItems = (run.routing?.items || []).slice().sort((a, b) => {
    const r = ROUTING_SEVERITY_RANK[b.severity] - ROUTING_SEVERITY_RANK[a.severity];
    if (r !== 0) return r;
    return (b.uncertainty || 0) - (a.uncertainty || 0);
  });
  const worstRoute = routeItems.find((i) => i.severity !== 'ok');
  if (worstRoute) {
    const sid = shortOf.get(worstRoute.claimId) || worstRoute.claimId;
    const reason = (worstRoute.reasons || [])[0] || worstRoute.severity;
    return {
      text: `${sid}: ${worstRoute.severity} — ${reason}`,
      path: `run.routing.items[${(run.routing.items || []).indexOf(worstRoute)}]`,
    };
  }
  const blockers = (run.criticisms || [])
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.severity === 'blocker' || c.severity === 'major')
    .sort((a, b) => CRITICISM_SEVERITY_RANK[b.c.severity] - CRITICISM_SEVERITY_RANK[a.c.severity]);
  if (blockers.length > 0) {
    const { c, i } = blockers[0];
    const sid = c.shortId || `R${i + 1}`;
    return {
      text: `${sid}: ${c.severity} — ${c.rationale.slice(0, 120)}`,
      path: `run.criticisms[${i}]`,
    };
  }
  return null;
}

// --- Metadata footer ----------------------------------------------------

function modelMix(run) {
  const drafter = run.drafts?.[0]?.model || '?';
  const reviewers = Array.from(new Set((run.criticisms || []).map((c) => c.reviewerModel))).length;
  const judge = run.aggregation?.protocol === 'judge' ? ' +judge' : '';
  const reviewerSuffix = reviewers > 0 ? ` +${reviewers}r` : '';
  return `${drafter}${reviewerSuffix}${judge}`;
}

function costSummary(cost) {
  const totalTokens = (cost?.totalTokensIn || 0) + (cost?.totalTokensOut || 0);
  const wallSec = ((cost?.wallClockMs || 0) / 1000).toFixed(1);
  return { totalTokens, wallSec };
}

// --- Severity / status visuals ----------------------------------------

function trailingRef(line, path) {
  if (!path) return line;
  return `${line}  ${DOT}  ${path}`;
}

// --- Stage ledger -------------------------------------------------------

function renderStageLedger(run) {
  const lines = [];
  const drafts = run.drafts || [];
  const initial = drafts.find((d) => d.kind === 'initial');
  if (initial) {
    const idx = drafts.indexOf(initial);
    lines.push(trailingRef(
      `  ${ICON_PASS} Draft:        1 draft (initial, ${initial.model})`,
      `run.drafts[${idx}]`,
    ));
  }

  const claimCount = (run.claims || []).length;
  if (claimCount > 0) {
    const verifs = run.verification || [];
    const entailed = verifs.filter((v) => v.entailment === 'entailed').length;
    const hardFail = verifs.filter((v) => v.verdict === 'hard_fail').length;
    const suffix = hardFail > 0 ? `, ${hardFail} hard_fail` : '';
    const icon = hardFail > 0 ? ICON_FAIL : ICON_PASS;
    lines.push(trailingRef(
      `  ${icon} Claims:       ${claimCount} extracted, ${entailed} entailed${suffix}`,
      'run.claims',
    ));
  }

  const evidence = run.evidence || [];
  if (evidence.length > 0) {
    const sourceVerifs = (run.verification || []).filter((v) => {
      const c = (run.claims || []).find((cc) => cc.id === v.claimId);
      return c && c.category === 'source';
    });
    const reachable = sourceVerifs.filter((v) => v.citationResolves !== false).length;
    const total = sourceVerifs.length || evidence.length;
    const icon = reachable < total ? ICON_WARN : ICON_PASS;
    lines.push(trailingRef(
      `  ${icon} Evidence:     ${reachable}/${total} sources accessible`,
      'run.evidence',
    ));
  }

  if (run.aggregation) {
    const agg = run.aggregation;
    const reviewerCount = new Set((run.criticisms || []).map((c) => c.reviewerModel)).size
      || new Set((agg.checklist?.[0]?.votes || []).map((v) => v.reviewerModel)).size;
    const blockers = (run.criticisms || []).filter((c) => c.severity === 'blocker').length;
    const minors = (run.criticisms || []).filter((c) => c.severity === 'minor' || c.severity === 'major').length;
    const icon = agg.overall === 'pass' ? ICON_PASS : agg.overall === 'fail' ? ICON_FAIL : ICON_WARN;
    lines.push(trailingRef(
      `  ${icon} Review:       ${reviewerCount} reviewers, ${blockers} blockers, ${minors} flagged`,
      'run.aggregation',
    ));
  }

  const updated = drafts.find((d) => d.kind === 'updated');
  if (updated) {
    const updatedIdx = drafts.indexOf(updated);
    const initialText = initial?.content || '';
    const ops = diffLines(initialText, updated.content);
    const { added, removed, changed } = countChanges(ops);
    const summary = changed ? `${added} + / ${removed} −` : 'unchanged';
    lines.push(trailingRef(
      `  ${ICON_PASS} Update:       ${summary}`,
      `run.drafts[${updatedIdx}]`,
    ));
  }

  if (run.riskAnalysis) {
    const level = run.riskAnalysis.level || 'unknown';
    const icon = level === 'high' ? ICON_FAIL : level === 'medium' ? ICON_WARN : ICON_PASS;
    lines.push(trailingRef(
      `  ${icon} Risk:         ${level}`,
      'run.riskAnalysis',
    ));
  }

  if (run.finalJson) {
    const ok = run.status === 'complete';
    const icon = ok ? ICON_PASS : ICON_WARN;
    lines.push(trailingRef(
      `  ${icon} Finalize:     ${run.status || 'unknown'}`,
      'run.finalJson',
    ));
  }
  return lines;
}

// --- Attention list -----------------------------------------------------

function renderAttentionList(run, minRank) {
  const shortOf = claimShortIdMap(run);
  const lines = [];
  const attentionItems = [];

  // Routing-driven attention.
  (run.routing?.items || []).forEach((item, idx) => {
    const rank = ROUTING_SEVERITY_RANK[item.severity] ?? 0;
    if (rank < minRank) return;
    const sid = shortOf.get(item.claimId) || item.claimId;
    const reason = (item.reasons || [])[0] || item.severity;
    attentionItems.push({
      rank,
      line: trailingRef(
        `  ${sid}: ${item.severity} — ${reason}`,
        `run.routing.items[${idx}]`,
      ),
    });
  });

  // Criticisms not already routed into a claim flag (global blockers, etc).
  (run.criticisms || []).forEach((c, i) => {
    const cRank = CRITICISM_SEVERITY_RANK[c.severity] ?? 0;
    // Map criticism severity onto routing severity for filtering
    // consistency: blocker → blocking (3), major → targeted_review (2),
    // minor → minor (1), nit → info (0).
    const mapped = c.severity === 'blocker' ? 3 : c.severity === 'major' ? 2 : c.severity === 'minor' ? 1 : 0;
    if (mapped < minRank) return;
    if (c.claimId !== 'global') return; // claim-pinned ones are surfaced via routing
    const sid = c.shortId || `R${i + 1}`;
    const reason = (c.rationale || '').slice(0, 120);
    attentionItems.push({
      rank: mapped,
      line: trailingRef(
        `  ${sid}: ${c.severity} — ${reason}`,
        `run.criticisms[${i}]`,
      ),
    });
    void cRank;
  });

  attentionItems.sort((a, b) => b.rank - a.rank);
  const okClaims = (run.routing?.items || []).filter((i) => (ROUTING_SEVERITY_RANK[i.severity] ?? 0) < minRank).length;
  if (attentionItems.length === 0) {
    lines.push(trailingRef(`  (none — ${okClaims} claim(s) below threshold)`, 'run.routing'));
  } else {
    for (const it of attentionItems) lines.push(it.line);
    if (okClaims > 0) {
      lines.push(trailingRef(`  +${okClaims} claim(s) below threshold collapsed`, 'run.routing'));
    }
  }
  return lines;
}

// --- Reviewer section ---------------------------------------------------

function renderReviewerSummary(run) {
  const rollup = aggregateReviewerFindings(run);
  const lines = [];
  if (rollup.verdict === 'no_review') {
    lines.push(trailingRef('  (review skipped or not run)', 'run.aggregation'));
    return lines;
  }
  const dissent = rollup.dissentCount > 0
    ? ` (${rollup.reviewerCount - rollup.dissentCount} of ${rollup.reviewerCount} reviewers, ${rollup.dissenters.join(', ')} dissenting)`
    : ` (${rollup.reviewerCount} of ${rollup.reviewerCount} reviewers)`;
  const verdictLabel = rollup.verdict === 'pass'
    ? 'PASS'
    : rollup.verdict === 'fail'
      ? 'FAIL'
      : 'NEEDS-REVIEW';
  lines.push(trailingRef(`  Verdict: ${verdictLabel}${dissent}`, 'run.aggregation.overall'));

  if (rollup.agreements.length > 0) {
    lines.push('  Agreement:');
    for (const ap of rollup.agreements.slice(0, 5)) {
      const claimRef = ap.claimShortId ? `${ap.claimShortId}/` : '';
      const tag = `[${ap.reviewers.join(', ')}]`;
      lines.push(trailingRef(
        `    ${claimRef}${ap.category} (${ap.severity}) ${tag} — ${ap.rationale.slice(0, 100)}`,
        `run.criticisms (${ap.criticismShortIds.join(', ')})`,
      ));
    }
  }
  if (rollup.disagreements.length > 0) {
    lines.push('  Disagreement:');
    for (const dp of rollup.disagreements.slice(0, 3)) {
      const raiser = dp.sides.find((s) => s.verdict === 'raised');
      const silentRevs = dp.sides.filter((s) => s.verdict === 'silent').map((s) => s.reviewer);
      const claimRef = dp.claimShortId ? `${dp.claimShortId}: ` : '';
      lines.push(trailingRef(
        `    ${claimRef}${raiser?.reviewer} vs. ${silentRevs.join('/')} — ${(raiser?.rationale || '').slice(0, 100)}`,
        `run.criticisms (${dp.criticismShortIds.join(', ')})`,
      ));
    }
  }
  return lines;
}

// --- Update-stage diff --------------------------------------------------

function renderUpdateDiff(run) {
  const drafts = run.drafts || [];
  const initial = drafts.find((d) => d.kind === 'initial');
  const updated = drafts.find((d) => d.kind === 'updated');
  if (!initial || !updated) return [];
  const before = parseDraftSections(initial.content);
  const after = parseDraftSections(updated.content);
  const allTitles = new Set([...Object.keys(before), ...Object.keys(after)]);
  /** @type {Map<string, { beforeTitle?: string, afterTitle?: string, bucket: string}>} */
  const buckets = new Map();
  for (const title of allTitles) {
    const bucket = classifySection(title);
    if (!bucket) continue;
    const entry = buckets.get(bucket) || { bucket };
    if (title in before) entry.beforeTitle = title;
    if (title in after) entry.afterTitle = title;
    buckets.set(bucket, entry);
  }
  const order = ['question', 'resolution_criteria', 'outcomes'];
  const lines = [];
  for (const name of order) {
    const entry = buckets.get(name);
    const b = entry?.beforeTitle ? before[entry.beforeTitle] : '';
    const a = entry?.afterTitle ? after[entry.afterTitle] : '';
    if (b === a || (!b && !a)) {
      lines.push(trailingRef(`  ${name}: unchanged`, 'run.drafts'));
      continue;
    }
    const ops = diffLines(b, a, { contextLines: 0 });
    const { added, removed } = countChanges(ops);
    lines.push(trailingRef(`  ${name}: ${added} + / ${removed} −`, 'run.drafts'));
  }
  return lines;
}

// --- Rubric table (Task 6) ----------------------------------------------

function renderRubricTable(run, reviewer) {
  const items = rubricForReviewer(run, reviewer.modelId);
  const lines = [];
  lines.push(`  ${reviewer.shortId} (${reviewer.modelId}):`);
  for (const row of items) {
    const verdict = row.verdict;
    const pass = verdict === 'yes';
    const icon = pass ? ICON_PASS : verdict === 'no' ? ICON_FAIL : ICON_WARN;
    const score = pass ? '1/1' : '0/1';
    const reason = (!pass && row.reason) ? ` — ${row.reason.slice(0, 80)}` : '';
    // Pad id for column alignment.
    const idCol = row.id.padEnd(22);
    lines.push(trailingRef(
      `    ${idCol} ${score} ${icon}${reason}`,
      `run.aggregation.checklist (${row.id})`,
    ));
  }
  return lines;
}

// --- Full-tier details --------------------------------------------------

function renderClaimsFull(run) {
  const lines = [];
  const verifById = new Map((run.verification || []).map((v, i) => [v.claimId, { v, i }]));
  (run.claims || []).forEach((c, i) => {
    const sid = c.shortId || `C${i + 1}`;
    const vr = verifById.get(c.id);
    const verdict = vr?.v?.verdict || 'no-verification';
    const entail = vr?.v?.entailment || '—';
    const first = trailingRef(
      `  ${sid} [${c.category}] ${verdict}/${entail}: ${c.text.slice(0, 120)}`,
      `run.claims[${i}]`,
    );
    lines.push(first);
    if (vr?.v?.toolOutput) {
      lines.push(trailingRef(`      ${vr.v.toolOutput.slice(0, 160)}`, `run.verification[${vr.i}]`));
    }
  });
  return lines;
}

function renderReviewersFull(run) {
  const rollup = aggregateReviewerFindings(run);
  const lines = [];
  for (const r of rollup.reviewers) {
    lines.push(...renderRubricTable(run, r));
    const crits = (run.criticisms || [])
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.reviewerModel === r.modelId);
    for (const { c, i } of crits) {
      const sid = c.shortId || `R${i + 1}`;
      lines.push(trailingRef(
        `    ${sid} ${c.severity}/${c.category}: ${c.rationale.slice(0, 160)}`,
        `run.criticisms[${i}]`,
      ));
    }
  }
  return lines;
}

function renderEvidenceFull(run) {
  const lines = [];
  (run.evidence || []).forEach((e, i) => {
    const sid = e.shortId || `S${i + 1}`;
    lines.push(trailingRef(
      `  ${sid} ${e.url} (rank ${e.rank})`,
      `run.evidence[${i}]`,
    ));
  });
  return lines;
}

function renderEventsFull(run) {
  const lines = [];
  (run.log || []).forEach((l, i) => {
    const sid = l.shortId || `E${i + 1}`;
    lines.push(trailingRef(
      `  ${sid} [${l.stage}] ${l.level}: ${l.message}`,
      `run.log[${i}]`,
    ));
  });
  return lines;
}

function renderCostsFull(run) {
  const lines = [];
  const cost = run.cost || {};
  const byStage = cost.byStage || {};
  for (const stage of Object.keys(byStage).sort()) {
    lines.push(trailingRef(
      `  ${stage.padEnd(20)} ${byStage[stage]} tokens`,
      `run.cost.byStage.${stage}`,
    ));
  }
  lines.push(trailingRef(
    `  total                ${(cost.totalTokensIn || 0) + (cost.totalTokensOut || 0)} tokens, ${((cost.wallClockMs || 0) / 1000).toFixed(1)}s`,
    'run.cost',
  ));
  return lines;
}

// --- Public entry point -------------------------------------------------

/**
 * @typedef {Object} RenderOptions
 * @property {'headline'|'report'|'full'} [level]          default 'report'
 * @property {'info'|'minor'|'targeted_review'|'blocking'} [minSeverity]
 * @property {Array<'reviewers'|'claims'|'evidence'|'events'|'costs'|'updates'>} [expand]
 */

/**
 * Render a Run into a plain-text report. Pure function: no I/O, no LLM
 * calls. Byte-identical for identical input.
 *
 * @param {import('../types/run.js').Run} run
 * @param {RenderOptions} [options]
 * @returns {string}
 */
export function renderReport(run, options = {}) {
  const level = options.level || 'report';
  const defaultMinSeverity = level === 'full' ? 'info' : 'targeted_review';
  const minRank = minSeverityRank(options.minSeverity || defaultMinSeverity);
  const expand = new Set(options.expand || []);

  assignShortIds(run);
  const hash = computeRunHash(run);
  const verdict = computeVerdict(run);
  const { totalTokens, wallSec } = costSummary(run.cost);
  const question = run.input?.question || '(no question)';

  const lines = [];

  // --- Headline block (always) -----------------------------------------
  lines.push(verdict.label);
  lines.push(`Question: ${question}`);
  const risk = topRisk(run);
  if (risk) {
    lines.push(trailingRef(`Top risk: ${risk.text}`, risk.path));
  } else if (verdict.label !== 'PASS') {
    lines.push(`Top risk: ${verdict.reason || 'see attention list'}`);
  }
  lines.push('');
  lines.push(
    `Run: ${hash}  ${DOT}  cost: ${totalTokens} tok  ${DOT}  wall: ${wallSec}s  ${DOT}  models: ${modelMix(run)}`,
  );

  if (level === 'headline') {
    return lines.join('\n');
  }

  // --- Report tier ------------------------------------------------------
  lines.push('');
  lines.push('Stages:');
  lines.push(...renderStageLedger(run));

  // Review section — aggregated by default, expanded on request.
  if (run.aggregation) {
    lines.push('');
    lines.push('Review:');
    if (expand.has('reviewers') || level === 'full') {
      lines.push(...renderReviewersFull(run));
    } else {
      lines.push(...renderReviewerSummary(run));
    }
  }

  // Update diff: short by default.
  if ((run.drafts || []).some((d) => d.kind === 'updated')) {
    lines.push('');
    lines.push('Update:');
    lines.push(...renderUpdateDiff(run));
    if (expand.has('updates') || level === 'full') {
      const initial = run.drafts.find((d) => d.kind === 'initial');
      const updated = run.drafts.find((d) => d.kind === 'updated');
      const ops = diffLines(initial?.content || '', updated?.content || '');
      const diffText = formatDiff(ops);
      if (diffText) {
        lines.push('  (full diff)');
        for (const l of diffText.split('\n')) lines.push('    ' + l);
      }
    }
  }

  // Attention list.
  lines.push('');
  lines.push('Attention:');
  lines.push(...renderAttentionList(run, minRank));

  // --- Expanded / full-tier sections -----------------------------------
  if (expand.has('claims') || level === 'full') {
    lines.push('');
    lines.push('Claims (full):');
    lines.push(...renderClaimsFull(run));
  }
  if (expand.has('evidence') || level === 'full') {
    lines.push('');
    lines.push('Evidence (full):');
    lines.push(...renderEvidenceFull(run));
  }
  if (expand.has('events') || level === 'full') {
    lines.push('');
    lines.push('Events (full):');
    lines.push(...renderEventsFull(run));
  }
  if (expand.has('costs') || level === 'full') {
    lines.push('');
    lines.push('Costs (full):');
    lines.push(...renderCostsFull(run));
  }

  return lines.join('\n');
}

export { computeRunHash };
