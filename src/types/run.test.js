import { describe, it, expect } from 'vitest';
import { ClaimSchema } from './run.js';

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
