const TITLE_LIMITS = Object.freeze({
  machine: 90,
  human: 70,
});

const DISALLOWED_PATTERNS = Object.freeze([
  {
    re: /https?:\/\//i,
    reason: 'must not include URLs',
  },
  {
    re: /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    reason: 'must not include ISO timestamps',
  },
  {
    re: /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*(?:UTC|ET|EST|EDT|GMT)\b/i,
    reason: 'must not include exact clock times',
  },
  {
    re: /\b(?:according to|as confirmed by|as measured by|resolution source|resolution criteria|will resolve|resolves?|resolved|oracle|outcome token|parimutuel|MECE|42\.space)\b/i,
    reason: 'must keep resolver mechanics out of the title',
  },
]);

function oneLine(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function getMarketQuestionTitleLimit(rigor = 'machine') {
  return TITLE_LIMITS[rigor] || TITLE_LIMITS.machine;
}

export function validateMarketQuestionTitle(title, rigor = 'machine') {
  const normalized = oneLine(title);
  const maxChars = getMarketQuestionTitleLimit(rigor);
  const reasons = [];

  if (!normalized) {
    reasons.push('missing title');
  }

  if (normalized.length > maxChars) {
    reasons.push(`too long (${normalized.length}/${maxChars} chars)`);
  }

  const questionMarks = (normalized.match(/\?/g) || []).length;
  if (questionMarks !== 1 || !normalized.endsWith('?')) {
    reasons.push('must be one question ending in ?');
  }

  for (const { re, reason } of DISALLOWED_PATTERNS) {
    if (re.test(normalized)) reasons.push(reason);
  }

  return {
    valid: reasons.length === 0,
    reasons,
    normalized,
    maxChars,
  };
}
