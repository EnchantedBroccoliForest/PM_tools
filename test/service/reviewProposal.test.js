import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installQueryModel, resetQueryModel } from '../../src/api/openrouter.js';
import { reviewProposal } from '../../src/service/reviewProposal.js';
import { createMockQueryModel } from '../../eval/mockApi.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const FIXTURE = JSON.parse(readFileSync(join(REPO, 'eval', 'fixtures', '_defaults.json'), 'utf8'));

beforeEach(() => {
  installQueryModel(createMockQueryModel(FIXTURE));
});

afterEach(() => {
  resetQueryModel();
});

describe('reviewProposal', () => {
  it('reviews existing proposal text without drafting or finalizing', async () => {
    const result = await reviewProposal({
      proposalText: FIXTURE.mockResponses.draft,
      references: ['https://example.com/feed'],
      models: {
        drafter: 'mock/drafter',
        reviewers: [
          { id: 'mock/reviewer-a', name: 'Mock Reviewer A' },
          { id: 'mock/reviewer-b', name: 'Mock Reviewer B' },
        ],
      },
      options: {
        evidence: 'none',
        verifiers: 'full',
        aggregation: 'majority',
      },
    });

    expect(result.status).toBe('reviewed');
    expect(result.reviews).toHaveLength(2);
    expect(result.reviews[0].reviewProse).toContain('Baseline clean review');
    expect(result.run.drafts).toHaveLength(1);
    expect(result.run.drafts[0].model).toBe('user/proposal');
    expect(result.run.finalJson).toBeNull();
    expect(result.run.aggregation.overall).toBe('pass');
    expect(result.summary.claimCount).toBeGreaterThan(0);
    expect(result.summary.reviewCount).toBe(2);
  });

  it('rejects empty proposal text', async () => {
    await expect(reviewProposal({ proposalText: '   ' })).rejects.toMatchObject({
      statusCode: 400,
    });
  });
});
