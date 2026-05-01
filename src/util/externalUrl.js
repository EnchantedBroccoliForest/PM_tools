export function isSafeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function splitExternalUrlToken(token) {
  const href = String(token || '').replace(/[.,;:!?]+$/g, '');
  return { href, suffix: String(token || '').slice(href.length) };
}
