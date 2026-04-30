// Static fallback list — used before the OpenRouter API has been fetched,
// and if the network request fails entirely.
export const FALLBACK_MODEL_GROUPS = [
  {
    label: 'OpenAI',
    models: [
      { id: 'openai/gpt-5.2-extended-thinking', name: 'GPT-5.2 Extended Thinking' },
      { id: 'openai/gpt-5.2', name: 'GPT-5.2' },
      { id: 'openai/gpt-5.1', name: 'GPT-5.1' },
      { id: 'openai/o4-mini', name: 'O4 Mini' },
      { id: 'openai/o3', name: 'O3' },
      { id: 'openai/gpt-4.5-preview', name: 'GPT-4.5 Preview' },
      { id: 'openai/gpt-4o', name: 'GPT-4o' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
    ],
  },
  {
    label: 'Anthropic',
    models: [
      { id: 'anthropic/claude-opus-4.5', name: 'Claude Opus 4.5' },
      { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4' },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
    ],
  },
  {
    label: 'Google',
    models: [
      { id: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro' },
      { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro' },
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
    ],
  },
  {
    label: 'DeepSeek',
    models: [
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1' },
      { id: 'deepseek/deepseek-v3', name: 'DeepSeek V3' },
    ],
  },
  {
    label: 'Meta',
    models: [
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
    ],
  },
  {
    label: 'Mistral',
    models: [
      { id: 'mistralai/mistral-large', name: 'Mistral Large' },
      { id: 'mistralai/mixtral-8x22b-instruct', name: 'Mixtral 8x22B' },
    ],
  },
];

// Friendly labels for known OpenRouter provider prefixes. Any prefix not listed
// here falls back to a title-cased version of the raw prefix.
const PROVIDER_LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  deepseek: 'DeepSeek',
  'meta-llama': 'Meta',
  mistralai: 'Mistral',
  'x-ai': 'xAI',
  cohere: 'Cohere',
  perplexity: 'Perplexity',
  qwen: 'Qwen',
  amazon: 'Amazon',
  microsoft: 'Microsoft',
  nvidia: 'NVIDIA',
  'nous-research': 'Nous Research',
  'liquid': 'Liquid',
  'inflection': 'Inflection',
  '01-ai': '01.AI',
  'ai21': 'AI21',
};

// Known providers get a preferred ordering; everything else sorts alphabetically after.
const PROVIDER_ORDER = [
  'OpenAI',
  'Anthropic',
  'Google',
  'xAI',
  'DeepSeek',
  'Meta',
  'Mistral',
  'Qwen',
  'Cohere',
  'Perplexity',
];

const PROVIDER_ABBREVS = {
  OpenAI: 'OA',
  Anthropic: 'A',
  Google: 'G',
  DeepSeek: 'DS',
  Meta: 'M',
  Mistral: 'Mi',
  xAI: 'X',
  Cohere: 'Co',
  Perplexity: 'Px',
  Qwen: 'Q',
};

function titleCase(slug) {
  return slug
    .split(/[-_]/)
    .map((part) => (part.length > 0 ? part[0].toUpperCase() + part.slice(1) : ''))
    .join(' ');
}

function providerRank(label) {
  const idx = PROVIDER_ORDER.indexOf(label);
  return idx === -1 ? PROVIDER_ORDER.length : idx;
}

function stripProviderPrefix(name, providerLabel) {
  // OpenRouter names look like "OpenAI: GPT-5.2". Strip the redundant provider prefix.
  const prefix = `${providerLabel}:`;
  if (name.startsWith(prefix)) return name.slice(prefix.length).trim();
  return name;
}

function isTextOutputModel(model) {
  const modality = model?.architecture?.modality;
  if (typeof modality !== 'string') return true; // include when unknown
  // e.g. "text->text", "text+image->text", "text->image"
  const arrow = modality.split('->');
  const output = arrow.length > 1 ? arrow[1] : modality;
  return output.includes('text');
}

/**
 * Convert the raw OpenRouter /models response into the grouped shape the UI expects.
 */
export function groupOpenRouterModels(rawModels) {
  const groupMap = new Map();

  for (const m of rawModels) {
    if (!m?.id || typeof m.id !== 'string') continue;
    if (!isTextOutputModel(m)) continue;

    const slashIdx = m.id.indexOf('/');
    const prefix = slashIdx === -1 ? m.id : m.id.slice(0, slashIdx);
    const label = PROVIDER_LABELS[prefix] || titleCase(prefix);
    const displayName = stripProviderPrefix(m.name || m.id, label);

    if (!groupMap.has(label)) groupMap.set(label, []);
    groupMap.get(label).push({ id: m.id, name: displayName });
  }

  return [...groupMap.entries()]
    .sort(([a], [b]) => {
      const ra = providerRank(a);
      const rb = providerRank(b);
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    })
    .map(([label, models]) => ({
      label,
      models: models.sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

// --- Reactive store -------------------------------------------------------

const CACHE_KEY = 'pm_tools_openrouter_models_v1';

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.groups) || parsed.groups.length === 0) return null;
    if (typeof parsed.timestamp !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(groups) {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ groups, timestamp: Date.now() })
    );
  } catch {
    // Ignore storage errors — cache is best-effort.
  }
}

const cached = readCache();
let currentGroups = cached?.groups || FALLBACK_MODEL_GROUPS;
let lastUpdatedAt = cached?.timestamp || 0;
const listeners = new Set();

export function getModelGroups() {
  return currentGroups;
}

export function getLastModelsUpdateTime() {
  return lastUpdatedAt;
}

export function setModelGroups(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return;
  currentGroups = groups;
  lastUpdatedAt = Date.now();
  writeCache(groups);
  for (const listener of listeners) listener();
}

export function subscribeModels(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// --- Helpers that operate on the current store ---------------------------

export function getAvailableModels() {
  return currentGroups.flatMap((g) => g.models);
}

// Defaults are kept as explicit IDs so they stay stable regardless of how the
// fetched list is ordered. If an ID is no longer offered, ModelSelect still
// surfaces it as a fallback option so the user can switch away from it.
export const DEFAULT_DRAFT_MODEL = 'openai/gpt-5.2';
export const DEFAULT_REVIEW_MODEL = 'google/gemini-3-pro-preview';
export const DEFAULT_SECOND_REVIEW_MODEL = 'anthropic/claude-opus-4.5';
export const DEFAULT_REVIEW_MODELS = [
  DEFAULT_REVIEW_MODEL,
  DEFAULT_SECOND_REVIEW_MODEL,
];
export const REVIEW_MODEL_ADD_ORDER = [
  ...DEFAULT_REVIEW_MODELS,
  DEFAULT_DRAFT_MODEL,
  'anthropic/claude-sonnet-4',
];

export function getModelName(id) {
  return getAvailableModels().find((m) => m.id === id)?.name || id;
}

export function getModelAbbrev(id) {
  for (const group of currentGroups) {
    if (group.models.some((m) => m.id === id)) {
      return PROVIDER_ABBREVS[group.label] || group.label[0];
    }
  }
  return '?';
}
