import { describe, it, expect } from 'vitest';
import { ClaimSchema, RunSchema, createRun, parseRun } from './run.js';

function makeClaim(id) {
  return { id, category: 'outcome_win', text: 'anything', sourceRefs: [] };
}

describe('ClaimSchema.id pattern', () => {
  it('accepts the shapes produced by the claim-extractor prompt', () => {
    const accepted = [
      'claim.question.0',
      'claim.timestamp.start',
      'claim.timestamp.end',
      'claim.outcome.0.win',
      'claim.outcome.12.criterion',
      'claim.edge.3',
      'claim.source.0',
      'claim.threshold.7',
    ];
    for (const id of accepted) {
      const result = ClaimSchema.safeParse(makeClaim(id));
      expect(result.success, `expected ${id} to be accepted`).toBe(true);
    }
  });

  it('accepts camelCase subfields (defensive against prompt tweaks)', () => {
    // Historically the JSDoc example used "resolutionCriteria" — the schema
    // must not regress valid claims just because the prompt switched
    // slug convention.
    const result = ClaimSchema.safeParse(makeClaim('claim.outcome.0.resolutionCriteria'));
    expect(result.success).toBe(true);
  });

  it('rejects ids that do not start with claim.<category>.', () => {
    const rejected = [
      'outcome.0.win',
      'claim.0',
      'claim.',
      '',
      'claim.outcome',
      'claim..0.win',
    ];
    for (const id of rejected) {
      const result = ClaimSchema.safeParse(makeClaim(id));
      expect(result.success, `expected ${JSON.stringify(id)} to be rejected`).toBe(false);
    }
  });
});

// ----------------------------------------------------------- rigor field --
//
// Phase 1 added `rigor` to the Run input. Older runs exported before this
// field existed must continue to validate (default 'machine'); explicit
// values flow through createRun and are pinned by the schema enum.

const VALID_RUN_BASE = {
  runId: 'run_test',
  startedAt: 0,
  drafts: [],
  criticisms: [],
  claims: [],
  evidence: [],
  verification: [],
  routing: null,
  aggregation: null,
  finalJson: null,
  cost: { totalTokensIn: 0, totalTokensOut: 0, wallClockMs: 0, byStage: {} },
  log: [],
};

describe('Run.input.rigor', () => {
  it('createRun stamps the rigor passed in', () => {
    const run = createRun({
      question: 'Q?',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      references: '',
      numberOfOutcomes: '',
      rigor: 'human',
    });
    expect(run.input.rigor).toBe('human');
  });

  it('createRun defaults rigor to machine when omitted', () => {
    const run = createRun({
      question: 'Q?',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      references: '',
    });
    expect(run.input.rigor).toBe('machine');
  });

  it('parseRun accepts a run missing input.rigor (older export) and defaults to machine', () => {
    const olderRun = {
      ...VALID_RUN_BASE,
      input: { question: 'Q?', startDate: '2026-01-01', endDate: '2026-12-31', references: '' },
    };
    const parsed = parseRun(olderRun);
    expect(parsed).not.toBeNull();
    expect(parsed.input.rigor).toBe('machine');
  });

  it('parseRun rejects an unknown rigor value', () => {
    const badRun = {
      ...VALID_RUN_BASE,
      input: { question: 'Q?', startDate: '2026-01-01', endDate: '2026-12-31', references: '', rigor: 'yolo' },
    };
    expect(parseRun(badRun)).toBeNull();
    // Verify the schema error is pinned to the rigor field rather than
    // surfacing as a generic unknown-shape failure.
    const direct = RunSchema.safeParse(badRun);
    expect(direct.success).toBe(false);
    if (!direct.success) {
      const paths = direct.error.issues.map((i) => i.path.join('.'));
      expect(paths.some((p) => p === 'input.rigor')).toBe(true);
    }
  });

  it('parseRun accepts both machine and human as valid rigor values', () => {
    for (const rigor of ['machine', 'human']) {
      const run = {
        ...VALID_RUN_BASE,
        input: { question: 'Q?', startDate: '2026-01-01', endDate: '2026-12-31', references: '', rigor },
      };
      const parsed = parseRun(run);
      expect(parsed, `rigor=${rigor} should validate`).not.toBeNull();
      expect(parsed.input.rigor).toBe(rigor);
    }
  });
});
