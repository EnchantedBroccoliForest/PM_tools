/**
 * Pipeline orchestrator for the Phase 6 eval harness.
 *
 * This module runs the full PM_tools pipeline against a fixture, end-to-end,
 * without the React UI. It delegates to the production `orchestrate()` from
 * `src/orchestrate.js` so there is a single authoritative pipeline sequence.
 * Only the LLM client and URL-reachability fetch are mocked.
 *
 * The harness installs a deterministic mock via `installQueryModel()` before
 * calling orchestrate, and restores the real client afterward.
 *
 * Ablation flags (passed in the `ablation` arg):
 *   - aggregation: 'majority' | 'unanimity' | 'judge'
 *   - escalation:  'always' | 'selective'
 *   - evidence:    'none' | 'retrieval' | 'retrieval+debate'
 *   - verifiers:   'off' | 'partial' | 'full'
 *
 * Returns a FixtureResult bundling the Run artifact plus fixture
 * metadata and a per-stage timing map so `metrics.js` can compute
 * summaries without re-walking the Run.
 */

import { installQueryModel, resetQueryModel } from '../src/api/openrouter.js';
import { orchestrate } from '../src/orchestrate.js';
import { createMockQueryModel, createMockFetch } from './mockApi.js';

// --- Constants the harness uses when constructing pipeline inputs --------

const FIXTURE_DRAFT_MODEL = 'mock/drafter';
const FIXTURE_REVIEWERS = [
  { id: 'mock/reviewer-a', name: 'Mock Reviewer A' },
  { id: 'mock/reviewer-b', name: 'Mock Reviewer B' },
  { id: 'mock/reviewer-c', name: 'Mock Reviewer C' },
];
const FIXTURE_JUDGE_MODEL = 'mock/judge';

// --- Public entry point --------------------------------------------------

/**
 * @typedef {Object} FixtureResult
 * @property {string} fixtureId
 * @property {string} bucket
 * @property {import('../src/types/run.js').Run} run
 * @property {{allowed:boolean, blockedByRisk:boolean, blockedByRouting:boolean, blockedByVerification:boolean}} gate
 * @property {{level:string, text:string}} risk
 * @property {object} ablation
 * @property {boolean} reviewSkipped           true when selective escalation skipped Phase 2
 * @property {string[]} missingMockFields      fixture keys that were missing from mockResponses
 * @property {Object<string, number>} calls    mock calls by role
 */

/**
 * Run a fixture end-to-end and return a FixtureResult.
 *
 * @param {object} fixture
 * @param {object} ablation
 * @returns {Promise<FixtureResult>}
 */
export async function runFixture(fixture, ablation) {
  const mockQuery = createMockQueryModel(fixture, {
    onWarn: (m) => console.warn(`[eval] ${m}`),
  });
  const mockFetch = createMockFetch(fixture);
  installQueryModel(mockQuery);

  try {
    const run = await orchestrate({
      input: {
        question: fixture.input?.question || '',
        startDate: fixture.input?.startDate || '',
        endDate: fixture.input?.endDate || '',
        references: fixture.input?.references || '',
      },
      models: {
        drafter: FIXTURE_DRAFT_MODEL,
        reviewers: FIXTURE_REVIEWERS,
        judge: FIXTURE_JUDGE_MODEL,
      },
      options: {
        aggregation: ablation.aggregation,
        escalation: ablation.escalation,
        evidence: ablation.evidence,
        verifiers: ablation.verifiers,
      },
      fetchImpl: mockFetch,
    });

    // Derive the gate and risk from the run's gates and log for backward
    // compat with metrics.js which expects these top-level fields.
    const gates = run.gates || {};

    const riskLevel = gates.risk?.level || 'unknown';
    // Find the risk analyst log entry to extract the raw text.
    const riskLogEntry = run.log.find((l) => l.stage === 'early_resolution');
    const risk = { level: riskLevel, text: riskLogEntry?.message || '' };

    const gate = {
      allowed: run.status === 'complete',
      blockedByRisk: gates.risk?.blocked || false,
      blockedByRouting: gates.routing?.blocked || false,
      blockedByVerification: gates.verification?.blocked || false,
    };

    // Detect whether review was skipped by checking the log.
    const reviewSkipped = run.log.some(
      (l) => l.stage === 'review' && l.message.includes('Review skipped by selective escalation'),
    );

    return {
      fixtureId: fixture.id,
      bucket: fixture.bucket,
      run,
      gate,
      risk,
      ablation,
      reviewSkipped,
      missingMockFields: [...mockQuery.missingFields],
      calls: { ...mockQuery.callsByRole },
    };
  } finally {
    resetQueryModel();
  }
}

export { FIXTURE_REVIEWERS, FIXTURE_DRAFT_MODEL, FIXTURE_JUDGE_MODEL };
