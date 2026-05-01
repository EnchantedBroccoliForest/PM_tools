import { describe, expect, it } from 'vitest';
import { isSafeExternalUrl, splitExternalUrlToken } from './externalUrl.js';

describe('external URL helpers', () => {
  it('allows only http and https external URLs', () => {
    expect(isSafeExternalUrl('https://example.com/source')).toBe(true);
    expect(isSafeExternalUrl('http://example.com/source')).toBe(true);
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeExternalUrl('not a url')).toBe(false);
  });

  it('detaches prose punctuation from a bare URL token', () => {
    expect(splitExternalUrlToken('https://example.com/source.')).toEqual({
      href: 'https://example.com/source',
      suffix: '.',
    });
    expect(splitExternalUrlToken('https://example.com/source?!')).toEqual({
      href: 'https://example.com/source',
      suffix: '?!',
    });
  });

  it('preserves URL punctuation that is not trailing prose', () => {
    expect(splitExternalUrlToken('https://example.com/source?a=1&b=2')).toEqual({
      href: 'https://example.com/source?a=1&b=2',
      suffix: '',
    });
  });
});
