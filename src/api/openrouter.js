const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // exponential backoff

// The documented env var is VITE_OPENROUTER_API_KEY. We accept the legacy
// VITE_OPENAI_API_KEY as a fallback so existing deployments keep working,
// but warn loudly at module load if neither is set.
const API_KEY_ENV = 'VITE_OPENROUTER_API_KEY';
const LEGACY_API_KEY_ENV = 'VITE_OPENAI_API_KEY';

function readConfiguredApiKey() {
  const primary = import.meta.env[API_KEY_ENV];
  if (primary && primary !== 'YOUR_API_KEY_HERE') return primary;
  const legacy = import.meta.env[LEGACY_API_KEY_ENV];
  if (legacy && legacy !== 'YOUR_API_KEY_HERE') {
    console.warn(
      `[pm_tools] ${LEGACY_API_KEY_ENV} is deprecated; set ${API_KEY_ENV} instead.`
    );
    return legacy;
  }
  return null;
}

// Runtime warning if neither variable is configured. This runs once at module
// load so the developer sees it in the browser console immediately, without
// waiting for the first LLM call to fail.
if (typeof window !== 'undefined' && readConfiguredApiKey() === null) {
  console.warn(
    `[pm_tools] No OpenRouter API key configured. Set ${API_KEY_ENV} in your environment (a .env file at the repo root works for local dev).`
  );
}

function getApiKey() {
  const apiKey = readConfiguredApiKey();
  if (!apiKey) {
    throw new Error(
      `OpenRouter API key not configured. Please set ${API_KEY_ENV} in your environment.`
    );
  }
  return apiKey;
}

function isRetryable(status) {
  return status === 429 || status >= 500;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalised usage object. OpenRouter forwards the upstream provider's
 * usage counters but some models omit fields — we coerce to zero so
 * downstream cost accounting never blows up on undefined arithmetic.
 *
 * @typedef {{promptTokens:number, completionTokens:number, totalTokens:number}} Usage
 */

/**
 * @typedef {Object} ModelResult
 * @property {string} content           the raw assistant message text
 * @property {Usage} usage              normalised token usage
 * @property {number} wallClockMs       client-measured duration including retries
 */

function normalizeUsage(raw) {
  const promptTokens = Number(raw?.prompt_tokens) || 0;
  const completionTokens = Number(raw?.completion_tokens) || 0;
  const totalTokens = Number(raw?.total_tokens) || promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

/**
 * Query a single model via OpenRouter with retry and exponential backoff.
 *
 * Phase 1: returns a structured ModelResult so callers can plumb usage and
 * wall-clock timing into the Run artifact's cost accounting. Callers should
 * destructure `.content` instead of treating the return as a bare string.
 *
 * @returns {Promise<ModelResult>}
 */
export async function queryModel(model, messages, { temperature = 0.7, maxTokens = 3000 } = {}) {
  const apiKey = getApiKey();
  const startedAt = Date.now();
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Market Creator',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error?.message || `API error ${response.status}`;

        if (isRetryable(response.status) && attempt < MAX_RETRIES) {
          lastError = new Error(errorMsg);
          await sleep(RETRY_DELAYS[attempt]);
          continue;
        }
        throw new Error(errorMsg);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim() === '') {
        throw new Error('Model returned an empty or malformed response');
      }
      return {
        content,
        usage: normalizeUsage(data?.usage),
        wallClockMs: Date.now() - startedAt,
      };
    } catch (err) {
      if (err.name === 'TypeError' && attempt < MAX_RETRIES) {
        // Network error — retry
        lastError = err;
        await sleep(RETRY_DELAYS[attempt]);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/**
 * Fetch the full list of models currently available via OpenRouter.
 * The /models endpoint is public, so the API key is optional but sent when present.
 * Returns the raw `data` array (each item has id, name, description, architecture, etc.).
 */
export async function fetchAvailableModels() {
  const headers = {
    'HTTP-Referer': window.location.origin,
    'X-Title': 'Market Creator',
  };
  try {
    headers.Authorization = `Bearer ${getApiKey()}`;
  } catch {
    // /models works unauthenticated; continue without the header.
  }

  const response = await fetch(MODELS_URL, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch models: HTTP ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data?.data) ? data.data : [];
}

/**
 * Query multiple models in parallel (like llm-council's query_models_parallel).
 *
 * Phase 1: return shape is now
 * `{model, modelName, content, usage, wallClockMs, error}` — `content` is
 * `null` when the call failed, and `error` holds the failure message.
 * Successful entries always carry `usage` and `wallClockMs`.
 *
 * @returns {Promise<Array<{model:string, modelName:string, content:string|null, usage:Usage|null, wallClockMs:number|null, error?:string}>>}
 */
export async function queryModelsParallel(models, messages, options = {}) {
  const results = await Promise.allSettled(
    models.map((m) =>
      queryModel(m.id, messages, options).then((result) => ({
        model: m.id,
        modelName: m.name,
        content: result.content,
        usage: result.usage,
        wallClockMs: result.wallClockMs,
      }))
    )
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    return {
      model: models[i].id,
      modelName: models[i].name,
      content: null,
      usage: null,
      wallClockMs: null,
      error: result.reason?.message || 'Unknown error',
    };
  });
}
