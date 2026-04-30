const STANDARD_HEADINGS = [
  '## Resolution Criteria:',
  '## Resolution Sources:',
  '## Additional Information:',
];

const URL_PATTERN = /https?:\/\/[^\s)\]}>"']+/gi;

function toText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join('\n');
  if (typeof value === 'object') return Object.values(value).map(toText).filter(Boolean).join('\n');
  return '';
}

function oneLine(value) {
  return toText(value).replace(/\s+/g, ' ').trim();
}

function stripLeadingListMarker(value) {
  return oneLine(value).replace(/^(?:[-*]|\d+[.)])\s+/, '');
}

function firstSentence(value) {
  const text = stripLeadingListMarker(value);
  if (!text) return '';
  const match = text.match(/^.*?[.!?](?:\s|$)/);
  return (match ? match[0] : text).trim();
}

function withoutBareUrls(value) {
  return oneLine(value).replace(URL_PATTERN, 'the linked source');
}

function stripTrailingUrlPunctuation(url) {
  return url.replace(/[.,;:!?]+$/g, '');
}

function findFirstUrl(...values) {
  for (const value of values) {
    const text = toText(value);
    const match = text.match(URL_PATTERN);
    if (match?.[0]) return stripTrailingUrlPunctuation(match[0]);
  }
  return '';
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'source';
  }
}

function normalizeLanguageCode(code) {
  const normalized = oneLine(code).toLowerCase();
  return /^[a-z]{2}$/.test(normalized) ? normalized : 'en';
}

function normalizeMarkdown(markdown) {
  return typeof markdown === 'string'
    ? markdown.trim().replace(/\r\n/g, '\n')
    : '';
}

export function isStandardResolutionDescription(markdown) {
  const normalized = normalizeMarkdown(markdown);
  return STANDARD_HEADINGS.every((heading) => normalized.includes(heading))
    && normalized.includes('---')
    && /_Language:\s*[a-z]{2}_/i.test(normalized);
}

function buildResolutionCriteria(finalJson) {
  const question = oneLine(finalJson?.refinedQuestion || finalJson?.question);
  const start = oneLine(finalJson?.marketStartTimeUTC);
  const end = oneLine(finalJson?.marketEndTimeUTC);
  const period = start && end
    ? `from ${start} through the index timestamp ${end}`
    : 'over the market timeframe and UTC index timestamp';
  const criteria = withoutBareUrls(
    firstSentence(finalJson?.outcomes?.[0]?.resolutionCriteria)
      || firstSentence(finalJson?.fullResolutionRules),
  );

  if (question && criteria) {
    return `${question} resolves to the named outcome whose condition is met ${period}. ${criteria}`;
  }
  if (question) {
    return `${question} resolves to the named outcome whose condition is met ${period}.`;
  }
  return `Resolution is determined by the named outcome whose condition is met ${period}.`;
}

function buildResolutionSources(finalJson) {
  const url = findFirstUrl(
    finalJson?.resolutionDescriptionMarkdown,
    finalJson?.resolutionSourceUrl,
    finalJson?.fullResolutionRules,
    finalJson?.outcomes,
    finalJson?.edgeCases,
  );
  const sourceName = oneLine(finalJson?.resolutionSourceName) || (url ? hostFromUrl(url) : 'Primary resolution source');
  const uiParams = oneLine(finalJson?.resolutionSourceParameters || finalJson?.resolutionUiParameters);

  if (url) {
    const params = uiParams || 'use the page state, filters, and timestamp specified in the resolution rules';
    return `${sourceName}: [${sourceName}](${url}); ${params}.`;
  }
  return `${sourceName}: add the external URL before dashboard submission; use the page state, filters, and timestamp specified in the resolution rules.`;
}

function buildAdditionalInformation(finalJson) {
  const end = oneLine(finalJson?.marketEndTimeUTC);
  const edgeCase = firstSentence(finalJson?.edgeCases);
  const window = end
    ? `resolved within 24 hours after the index timestamp ${end}`
    : 'resolved within 24 hours after the index timestamp';
  const exclusions = edgeCase
    ? `Apply listed edge cases and exclusions, including: ${edgeCase}`
    : 'Apply the listed edge cases and exclude unofficial, out-of-window, or later-corrected values unless the rules state otherwise.';
  return `${exclusions} Resolution window: ${window}.`;
}

export function buildResolutionDescriptionMarkdown(finalJson, options = {}) {
  const modelMarkdown = normalizeMarkdown(
    finalJson?.resolutionDescriptionMarkdown || finalJson?.descriptionMarkdown,
  );
  if (isStandardResolutionDescription(modelMarkdown)) {
    return modelMarkdown;
  }

  const language = normalizeLanguageCode(
    finalJson?.language || finalJson?.languageCode || options.language,
  );

  return [
    '## Resolution Criteria:',
    buildResolutionCriteria(finalJson),
    '',
    '## Resolution Sources:',
    buildResolutionSources(finalJson),
    '',
    '## Additional Information:',
    buildAdditionalInformation(finalJson),
    '',
    '---',
    `_Language: ${language}_`,
  ].join('\n');
}
