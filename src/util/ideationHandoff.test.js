import { describe, expect, it } from 'vitest';
import { buildReferenceFromIdea } from './ideationHandoff.js';

describe('buildReferenceFromIdea', () => {
  it('returns idea context when no ideation references were supplied', () => {
    expect(buildReferenceFromIdea({ rest: 'Outcome Set: A / B' })).toBe('Outcome Set: A / B');
  });

  it('falls back to raw idea text when rest is unavailable', () => {
    expect(buildReferenceFromIdea({ rawText: '1. **Title** Example market' })).toBe('1. **Title** Example market');
  });

  it('returns ideation references when the generated idea has no body', () => {
    expect(buildReferenceFromIdea({}, 'https://example.com/feed')).toBe('https://example.com/feed');
  });

  it('appends original ideation references after the generated idea context', () => {
    expect(
      buildReferenceFromIdea(
        { rest: 'Outcome Set: A / B' },
        'https://example.com/feed\nImportant source note.',
      ),
    ).toBe(
      'Outcome Set: A / B\n\n' +
      'Original ideation references:\n' +
      'https://example.com/feed\nImportant source note.',
    );
  });
});
