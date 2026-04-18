/**
 * Parse the risk level out of the early-resolution analyst's response.
 *
 * The prompt instructs the model to begin with "Risk rating: Low/Medium/High".
 * Previously the same regex was duplicated in App.jsx and orchestrate.js;
 * anything downstream (the Accept gate, the UI badge, the run log) that
 * cares about the level should read it from here.
 *
 * Returns one of 'low' | 'medium' | 'high' | 'unknown'. 'unknown' is a
 * no-match fallback and does NOT block the gate — only a confirmed 'high'
 * blocks.
 */
export function parseRiskLevel(text) {
  if (typeof text !== 'string' || text.length === 0) return 'unknown';
  const match = text.match(/risk\s*rating\s*[:-]?\s*(low|medium|high)/i);
  return match ? match[1].toLowerCase() : 'unknown';
}
