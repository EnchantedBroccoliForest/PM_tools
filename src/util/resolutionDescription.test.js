import { describe, expect, it } from 'vitest';
import {
  buildResolutionDescriptionMarkdown,
  isStandardResolutionDescription,
} from './resolutionDescription.js';

const FINAL_JSON = {
  refinedQuestion: 'Will Example FC win the Singapore Cup final at National Stadium on 2026-12-14?',
  marketStartTimeUTC: '2026-12-01T00:00:00Z',
  marketEndTimeUTC: '2026-12-14T14:00:00Z',
  outcomes: [
    {
      name: 'Example FC',
      resolutionCriteria: 'Use the official match centre result.',
    },
  ],
  fullResolutionRules: '1. Use https://example.com/match-centre?match=42 for the final score. 2. Ignore friendlies.',
  edgeCases: '1. Abandoned match before full time resolves Other / None.',
};

describe('buildResolutionDescriptionMarkdown', () => {
  it('preserves a model-provided standard description verbatim', () => {
    const markdown = [
      '## Resolution Criteria:',
      'Example FC must win at National Stadium by the UTC timestamp.',
      '',
      '## Resolution Sources:',
      'Official Match Centre: [match page](https://example.com/match-centre?match=42); set the match filter to final.',
      '',
      '## Additional Information:',
      'Exclude friendlies. Resolution window: resolved within 24 hours after the index timestamp.',
      '',
      '---',
      '_Language: en_',
    ].join('\n');

    expect(buildResolutionDescriptionMarkdown({ ...FINAL_JSON, resolutionDescriptionMarkdown: markdown })).toBe(markdown);
    expect(isStandardResolutionDescription(markdown)).toBe(true);
  });

  it('builds the dashboard description template from final JSON', () => {
    const markdown = buildResolutionDescriptionMarkdown(FINAL_JSON);

    expect(markdown).toContain('## Resolution Criteria:');
    expect(markdown).toContain('Example FC win the Singapore Cup final');
    expect(markdown).toContain('2026-12-14T14:00:00Z');
    expect(markdown).toContain('## Resolution Sources:');
    expect(markdown).toContain('[example.com](https://example.com/match-centre?match=42)');
    expect(markdown).not.toContain('Use https://');
    expect(markdown).toContain('## Additional Information:');
    expect(markdown).toContain('resolved within 24 hours after the index timestamp 2026-12-14T14:00:00Z');
    expect(markdown).toContain('_Language: en_');
  });

  it('falls back clearly when no external URL was emitted', () => {
    const markdown = buildResolutionDescriptionMarkdown({
      ...FINAL_JSON,
      fullResolutionRules: '1. Use the official match centre for the final score.',
    });

    expect(markdown).toContain('add the external URL before dashboard submission');
  });
});
