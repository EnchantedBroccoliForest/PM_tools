/**
 * HTML renderer for the report.
 *
 * Same Run → same three tiers (headline / report / full) as the CLI text
 * renderer. Presentation differences only: collapsed sections are native
 * `<details>` blocks, severity badges combine color and an icon (never
 * color alone), and the Run hash in the footer is copyable.
 *
 * Pure function — no LLM calls, no network. The CLI text renderer is the
 * source of truth for what facts appear and in what order; this file wraps
 * the same structural primitives in HTML.
 */

import { claimShortIdMap } from './shortIds.js';
import { computeRunHash } from './runHash.js';
import { aggregateReviewerFindings, rubricForReviewer } from './aggregateReviews.js';
import { diffLines, countChanges, parseDraftSections, classifySection } from './diff.js';

const ROUTING_SEVERITY_RANK = { ok: 0, info: 0, minor: 1, targeted_review: 2, blocking: 3 };
const CRITICISM_SEVERITY_RANK = { nit: 0, minor: 1, major: 2, blocker: 3 };

function minSeverityRank(level) {
  switch (level) {
    case 'info': return 0;
    case 'minor': return 1;
    case 'targeted_review': return 2;
    case 'blocking': return 3;
    default: return 2;
  }
}

function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function badge(label) {
  const cls = label === 'PASS' ? 'pass' : label === 'BLOCKED' ? 'blocked' : 'warn';
  const icon = label === 'PASS' ? '✓' : label === 'BLOCKED' ? '✗' : '⚠';
  return `<span class="pm-badge pm-badge-${cls}" role="status"><span aria-hidden="true">${icon}</span> ${escapeHtml(label)}</span>`;
}

function severityChip(sev) {
  const cls = sev === 'blocking' || sev === 'blocker' ? 'blocked'
    : sev === 'targeted_review' || sev === 'major' ? 'warn'
    : sev === 'minor' ? 'minor'
    : 'ok';
  const icon = cls === 'blocked' ? '✗' : cls === 'warn' ? '⚠' : cls === 'minor' ? '•' : '✓';
  return `<span class="pm-sev pm-sev-${cls}"><span aria-hidden="true">${icon}</span> ${escapeHtml(sev)}</span>`;
}

function ref(path) {
  return ` <span class="pm-ref" title="${escapeHtml(path)}">${escapeHtml(path)}</span>`;
}

function computeVerdict(run) {
  const gates = run.gates || {};
  if (run.status === 'error') return { label: 'BLOCKED', reason: 'pipeline error' };
  if (run.status === 'blocked' || gates.routing?.blocked || gates.verification?.blocked || gates.risk?.blocked) {
    return { label: 'BLOCKED', reason: 'gate rejected' };
  }
  const routingOverall = run.routing?.overall;
  const hasIssues = routingOverall === 'needs_update'
    || (run.aggregation?.overall && run.aggregation.overall !== 'pass')
    || (run.criticisms || []).some((c) => c.severity === 'blocker' || c.severity === 'major');
  if (hasIssues) return { label: 'NEEDS-REVIEW', reason: 'routing or reviewer flagged issues' };
  if (run.status === 'complete') return { label: 'PASS', reason: null };
  return { label: 'NEEDS-REVIEW', reason: 'status partial' };
}

function topRisk(run) {
  const shortOf = claimShortIdMap(run);
  const items = (run.routing?.items || []).slice().sort((a, b) => {
    const r = ROUTING_SEVERITY_RANK[b.severity] - ROUTING_SEVERITY_RANK[a.severity];
    if (r !== 0) return r;
    return (b.uncertainty || 0) - (a.uncertainty || 0);
  });
  const worst = items.find((i) => i.severity !== 'ok');
  if (worst) {
    const sid = shortOf.get(worst.claimId) || worst.claimId;
    const reason = (worst.reasons || [])[0] || worst.severity;
    return {
      text: `${sid}: ${worst.severity} — ${reason}`,
      path: `run.routing.items[${(run.routing.items || []).indexOf(worst)}]`,
    };
  }
  return null;
}

function renderStageLedgerHtml(run) {
  const rows = [];
  const drafts = run.drafts || [];
  const initial = drafts.find((d) => d.kind === 'initial');
  if (initial) {
    rows.push(`<li>${severityChip('ok')} <b>Draft</b>: 1 draft (${escapeHtml(initial.model)})${ref(`run.drafts[${drafts.indexOf(initial)}]`)}</li>`);
  }
  if ((run.claims || []).length > 0) {
    const entailed = (run.verification || []).filter((v) => v.entailment === 'entailed').length;
    const hard = (run.verification || []).filter((v) => v.verdict === 'hard_fail').length;
    const sev = hard > 0 ? 'blocking' : 'ok';
    rows.push(`<li>${severityChip(sev)} <b>Claims</b>: ${run.claims.length} extracted, ${entailed} entailed${hard ? `, ${hard} hard_fail` : ''}${ref('run.claims')}</li>`);
  }
  const evidence = run.evidence || [];
  if (evidence.length > 0) {
    const sourceVerifs = (run.verification || []).filter((v) => {
      const c = (run.claims || []).find((cc) => cc.id === v.claimId);
      return c && c.category === 'source';
    });
    const reachable = sourceVerifs.filter((v) => v.citationResolves !== false).length;
    const total = sourceVerifs.length || evidence.length;
    const sev = reachable < total ? 'targeted_review' : 'ok';
    rows.push(`<li>${severityChip(sev)} <b>Evidence</b>: ${reachable}/${total} sources accessible${ref('run.evidence')}</li>`);
  }
  if (run.aggregation) {
    const blockers = (run.criticisms || []).filter((c) => c.severity === 'blocker').length;
    const flagged = (run.criticisms || []).filter((c) => c.severity === 'minor' || c.severity === 'major').length;
    const reviewerCount = new Set((run.criticisms || []).map((c) => c.reviewerModel)).size
      || new Set((run.aggregation.checklist?.[0]?.votes || []).map((v) => v.reviewerModel)).size;
    const sev = run.aggregation.overall === 'pass' ? 'ok' : run.aggregation.overall === 'fail' ? 'blocking' : 'targeted_review';
    rows.push(`<li>${severityChip(sev)} <b>Review</b>: ${reviewerCount} reviewers, ${blockers} blockers, ${flagged} flagged${ref('run.aggregation')}</li>`);
  }
  const updated = drafts.find((d) => d.kind === 'updated');
  if (updated) {
    const ops = diffLines(initial?.content || '', updated.content);
    const { added, removed, changed } = countChanges(ops);
    const summary = changed ? `${added} + / ${removed} −` : 'unchanged';
    rows.push(`<li>${severityChip('ok')} <b>Update</b>: ${summary}${ref(`run.drafts[${drafts.indexOf(updated)}]`)}</li>`);
  }
  if (run.riskAnalysis) {
    const sev = run.riskAnalysis.level === 'high' ? 'blocking' : run.riskAnalysis.level === 'medium' ? 'targeted_review' : 'ok';
    rows.push(`<li>${severityChip(sev)} <b>Risk</b>: ${escapeHtml(run.riskAnalysis.level || 'unknown')}${ref('run.riskAnalysis')}</li>`);
  }
  if (run.finalJson) {
    const sev = run.status === 'complete' ? 'ok' : 'targeted_review';
    rows.push(`<li>${severityChip(sev)} <b>Finalize</b>: ${escapeHtml(run.status || 'unknown')}${ref('run.finalJson')}</li>`);
  }
  return `<ul class="pm-stages">${rows.join('')}</ul>`;
}

function renderAttentionHtml(run, minRank) {
  const shortOf = claimShortIdMap(run);
  const items = [];
  (run.routing?.items || []).forEach((item, idx) => {
    const rank = ROUTING_SEVERITY_RANK[item.severity] ?? 0;
    if (rank < minRank) return;
    const sid = shortOf.get(item.claimId) || item.claimId;
    const reason = (item.reasons || [])[0] || item.severity;
    items.push({ rank, html: `<li>${severityChip(item.severity)} <b>${escapeHtml(sid)}</b>: ${escapeHtml(reason)}${ref(`run.routing.items[${idx}]`)}</li>` });
  });
  (run.criticisms || []).forEach((c, i) => {
    if (c.claimId !== 'global') return;
    const mapped = c.severity === 'blocker' ? 3 : c.severity === 'major' ? 2 : c.severity === 'minor' ? 1 : 0;
    if (mapped < minRank) return;
    const sid = c.shortId || `R${i + 1}`;
    items.push({ rank: mapped, html: `<li>${severityChip(c.severity)} <b>${escapeHtml(sid)}</b>: ${escapeHtml((c.rationale || '').slice(0, 140))}${ref(`run.criticisms[${i}]`)}</li>` });
  });
  items.sort((a, b) => b.rank - a.rank);
  const collapsed = (run.routing?.items || []).filter((i) => (ROUTING_SEVERITY_RANK[i.severity] ?? 0) < minRank).length;
  if (items.length === 0) {
    return `<p class="pm-attention-empty">(none — ${collapsed} claim(s) below threshold)${ref('run.routing')}</p>`;
  }
  const list = items.map((it) => it.html).join('');
  const tail = collapsed > 0 ? `<li class="pm-collapsed">+${collapsed} claim(s) below threshold collapsed${ref('run.routing')}</li>` : '';
  return `<ul class="pm-attention">${list}${tail}</ul>`;
}

function renderReviewerSummaryHtml(run) {
  const rollup = aggregateReviewerFindings(run);
  if (rollup.verdict === 'no_review') return `<p>(review skipped or not run)${ref('run.aggregation')}</p>`;
  const verdictLabel = rollup.verdict === 'pass' ? 'PASS' : rollup.verdict === 'fail' ? 'FAIL' : 'NEEDS-REVIEW';
  const dissent = rollup.dissentCount > 0
    ? ` (${rollup.reviewerCount - rollup.dissentCount} of ${rollup.reviewerCount} reviewers, ${rollup.dissenters.join(', ')} dissenting)`
    : ` (${rollup.reviewerCount} of ${rollup.reviewerCount} reviewers)`;

  const parts = [`<p><b>Verdict</b>: ${badge(verdictLabel)}${escapeHtml(dissent)}${ref('run.aggregation.overall')}</p>`];
  if (rollup.agreements.length > 0) {
    parts.push('<b>Agreement</b>:<ul>');
    for (const ap of rollup.agreements.slice(0, 5)) {
      const claimRef = ap.claimShortId ? `${ap.claimShortId}/` : '';
      parts.push(`<li>${severityChip(ap.severity)} ${escapeHtml(claimRef)}${escapeHtml(ap.category)} [${escapeHtml(ap.reviewers.join(', '))}] — ${escapeHtml(ap.rationale.slice(0, 120))}${ref(`run.criticisms (${ap.criticismShortIds.join(', ')})`)}</li>`);
    }
    parts.push('</ul>');
  }
  if (rollup.disagreements.length > 0) {
    parts.push('<b>Disagreement</b>:<ul>');
    for (const dp of rollup.disagreements.slice(0, 3)) {
      const raiser = dp.sides.find((s) => s.verdict === 'raised');
      const silent = dp.sides.filter((s) => s.verdict === 'silent').map((s) => s.reviewer);
      const claimRef = dp.claimShortId ? `${dp.claimShortId}: ` : '';
      parts.push(`<li>${escapeHtml(claimRef)}<b>${escapeHtml(raiser?.reviewer || '?')}</b> vs. ${escapeHtml(silent.join('/'))} — ${escapeHtml((raiser?.rationale || '').slice(0, 120))}${ref(`run.criticisms (${dp.criticismShortIds.join(', ')})`)}</li>`);
    }
    parts.push('</ul>');
  }
  return parts.join('\n');
}

function renderRubricTableHtml(run, reviewer) {
  const items = rubricForReviewer(run, reviewer.modelId);
  const rows = items.map((row) => {
    const pass = row.verdict === 'yes';
    const sev = pass ? 'ok' : row.verdict === 'no' ? 'blocking' : 'targeted_review';
    const score = pass ? '1/1' : '0/1';
    const reason = !pass && row.reason ? ` — ${escapeHtml(row.reason.slice(0, 120))}` : '';
    return `<tr><td>${escapeHtml(row.id)}</td><td>${score}</td><td>${severityChip(sev)}</td><td>${reason}</td></tr>`;
  }).join('');
  return `<h4>${escapeHtml(reviewer.shortId)} — ${escapeHtml(reviewer.modelId)}${ref('run.aggregation.checklist')}</h4>
<table class="pm-rubric"><thead><tr><th>Rule</th><th>Score</th><th>Verdict</th><th>Reason</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderReviewersFullHtml(run) {
  const rollup = aggregateReviewerFindings(run);
  const parts = [];
  for (const r of rollup.reviewers) {
    parts.push(renderRubricTableHtml(run, r));
    const crits = (run.criticisms || [])
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.reviewerModel === r.modelId);
    if (crits.length > 0) {
      parts.push('<ul>');
      for (const { c, i } of crits) {
        const sid = c.shortId || `R${i + 1}`;
        parts.push(`<li>${severityChip(c.severity)} <b>${escapeHtml(sid)}</b> ${escapeHtml(c.category)}: ${escapeHtml(c.rationale.slice(0, 200))}${ref(`run.criticisms[${i}]`)}</li>`);
      }
      parts.push('</ul>');
    }
  }
  return parts.join('\n');
}

function renderUpdateDiffHtml(run) {
  const drafts = run.drafts || [];
  const initial = drafts.find((d) => d.kind === 'initial');
  const updated = drafts.find((d) => d.kind === 'updated');
  if (!initial || !updated) return '';
  const before = parseDraftSections(initial.content);
  const after = parseDraftSections(updated.content);
  const titles = new Set([...Object.keys(before), ...Object.keys(after)]);
  const buckets = new Map();
  for (const t of titles) {
    const b = classifySection(t);
    if (!b) continue;
    const entry = buckets.get(b) || { bucket: b };
    if (t in before) entry.beforeTitle = t;
    if (t in after) entry.afterTitle = t;
    buckets.set(b, entry);
  }
  const order = ['question', 'resolution_criteria', 'outcomes'];
  const items = [];
  for (const name of order) {
    const entry = buckets.get(name);
    const b = entry?.beforeTitle ? before[entry.beforeTitle] : '';
    const a = entry?.afterTitle ? after[entry.afterTitle] : '';
    if (b === a || (!b && !a)) {
      items.push(`<li><b>${escapeHtml(name)}</b>: unchanged${ref('run.drafts')}</li>`);
      continue;
    }
    const ops = diffLines(b, a, { contextLines: 0 });
    const { added, removed } = countChanges(ops);
    items.push(`<li><b>${escapeHtml(name)}</b>: ${added} + / ${removed} −${ref('run.drafts')}</li>`);
  }
  return `<ul class="pm-update">${items.join('')}</ul>`;
}

/**
 * @param {import('../types/run.js').Run} run
 * @param {import('./renderReport.js').RenderOptions} [options]
 * @returns {string} HTML fragment (no <html> wrapper)
 */
export function renderHtml(run, options = {}) {
  const level = options.level || 'report';
  const defaultMinSeverity = level === 'full' ? 'info' : 'targeted_review';
  const minRank = minSeverityRank(options.minSeverity || defaultMinSeverity);
  const expand = new Set(options.expand || []);

  // Hash the artifact AS RECEIVED; never mutate the input — see the
  // matching note in renderReport.js.
  const hash = computeRunHash(run);
  const verdict = computeVerdict(run);
  const question = run.input?.question || '(no question)';
  const risk = topRisk(run);
  const cost = run.cost || {};
  const totalTokens = (cost.totalTokensIn || 0) + (cost.totalTokensOut || 0);
  const wallSec = ((cost.wallClockMs || 0) / 1000).toFixed(1);

  const parts = [];

  parts.push(`<section class="pm-report" data-run-hash="${escapeHtml(hash)}">`);
  parts.push(`<header class="pm-headline">`);
  parts.push(`<h1>${badge(verdict.label)}</h1>`);
  parts.push(`<p class="pm-question">${escapeHtml(question)}</p>`);
  if (risk) {
    parts.push(`<p class="pm-top-risk">Top risk: ${escapeHtml(risk.text)}${ref(risk.path)}</p>`);
  } else if (verdict.label !== 'PASS') {
    parts.push(`<p class="pm-top-risk">Top risk: ${escapeHtml(verdict.reason || 'see attention list')}</p>`);
  }
  parts.push(`</header>`);

  if (level === 'headline') {
    parts.push(renderFooterHtml(run, hash, totalTokens, wallSec));
    parts.push('</section>');
    return parts.join('\n');
  }

  parts.push('<h2>Stages</h2>');
  parts.push(renderStageLedgerHtml(run));

  if (run.aggregation) {
    if (expand.has('reviewers') || level === 'full') {
      parts.push('<details open><summary><h2 style="display:inline">Review</h2></summary>');
      parts.push(renderReviewersFullHtml(run));
      parts.push('</details>');
    } else {
      parts.push('<details open><summary><h2 style="display:inline">Review</h2></summary>');
      parts.push(renderReviewerSummaryHtml(run));
      parts.push('</details>');
    }
  }

  if ((run.drafts || []).some((d) => d.kind === 'updated')) {
    parts.push('<details><summary><h2 style="display:inline">Update</h2></summary>');
    parts.push(renderUpdateDiffHtml(run));
    parts.push('</details>');
  }

  parts.push('<h2>Attention</h2>');
  parts.push(renderAttentionHtml(run, minRank));

  if (expand.has('claims') || level === 'full') {
    parts.push('<details><summary><h2 style="display:inline">Claims (full)</h2></summary><ul>');
    (run.claims || []).forEach((c, i) => {
      const v = (run.verification || []).find((x) => x.claimId === c.id);
      parts.push(`<li><b>${escapeHtml(c.shortId || `C${i + 1}`)}</b> [${escapeHtml(c.category)}] ${escapeHtml(v?.verdict || '—')}/${escapeHtml(v?.entailment || '—')}: ${escapeHtml(c.text.slice(0, 160))}${ref(`run.claims[${i}]`)}</li>`);
    });
    parts.push('</ul></details>');
  }
  if (expand.has('evidence') || level === 'full') {
    parts.push('<details><summary><h2 style="display:inline">Evidence (full)</h2></summary><ul>');
    (run.evidence || []).forEach((e, i) => {
      parts.push(`<li><b>${escapeHtml(e.shortId || `S${i + 1}`)}</b> <a href="${escapeHtml(e.url)}">${escapeHtml(e.url)}</a> (rank ${e.rank})${ref(`run.evidence[${i}]`)}</li>`);
    });
    parts.push('</ul></details>');
  }
  if (expand.has('events') || level === 'full') {
    parts.push('<details><summary><h2 style="display:inline">Events (full)</h2></summary><ul>');
    (run.log || []).forEach((l, i) => {
      parts.push(`<li><b>${escapeHtml(l.shortId || `E${i + 1}`)}</b> [${escapeHtml(l.stage)}] ${escapeHtml(l.level)}: ${escapeHtml(l.message)}${ref(`run.log[${i}]`)}</li>`);
    });
    parts.push('</ul></details>');
  }
  if (expand.has('costs') || level === 'full') {
    parts.push('<details><summary><h2 style="display:inline">Costs (full)</h2></summary><ul>');
    const byStage = run.cost?.byStage || {};
    for (const stage of Object.keys(byStage).sort()) {
      parts.push(`<li><b>${escapeHtml(stage)}</b>: ${byStage[stage]} tokens${ref(`run.cost.byStage.${stage}`)}</li>`);
    }
    parts.push('</ul></details>');
  }

  parts.push(renderFooterHtml(run, hash, totalTokens, wallSec));
  parts.push('</section>');
  return parts.join('\n');
}

function renderFooterHtml(run, hash, totalTokens, wallSec) {
  // Hash is copyable by click-select; rendered in a <code> for monospace.
  // Reviewer count includes anyone who voted via aggregation.checklist —
  // not only the subset that left criticisms — so clean runs still credit
  // every participating reviewer.
  const reviewerSet = new Set((run.criticisms || []).map((c) => c.reviewerModel));
  for (const item of run.aggregation?.checklist || []) {
    for (const v of item.votes || []) reviewerSet.add(v.reviewerModel);
  }
  const reviewerSuffix = reviewerSet.size > 0 ? ` +${reviewerSet.size}r` : '';
  const judgeSuffix = run.aggregation?.protocol === 'judge' ? ' +judge' : '';
  const modelMix = (run.drafts?.[0]?.model || '?') + reviewerSuffix + judgeSuffix;
  return `<footer class="pm-footer">
    <span>Run: <code class="pm-hash">${escapeHtml(hash)}</code></span>
    <span>cost: ${totalTokens} tok</span>
    <span>wall: ${escapeHtml(wallSec)}s</span>
    <span>models: ${escapeHtml(modelMix)}</span>
  </footer>`;
}
