export const MODEL_GROUPS = [
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

export const AVAILABLE_MODELS = MODEL_GROUPS.flatMap((g) => g.models);

export const DEFAULT_DRAFT_MODEL = AVAILABLE_MODELS[1].id;
export const DEFAULT_REVIEW_MODEL = AVAILABLE_MODELS[13].id;

export function getModelName(id) {
  return AVAILABLE_MODELS.find((m) => m.id === id)?.name || id;
}

const PROVIDER_ABBREVS = {
  'OpenAI': 'OA',
  'Anthropic': 'A',
  'Google': 'G',
  'DeepSeek': 'DS',
  'Meta': 'M',
  'Mistral': 'Mi',
};

export function getModelAbbrev(id) {
  for (const group of MODEL_GROUPS) {
    if (group.models.some((m) => m.id === id)) {
      return PROVIDER_ABBREVS[group.label] || group.label[0];
    }
  }
  return '?';
}
