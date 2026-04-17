const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // exponential backoff

// API key precedence (first match wins):
//   1. OPENROUTER_API_KEY       — CLI / server / headless use (no VITE_ prefix)
//   2. VITE_OPENROUTER_API_KEY  — Vite dev server (browser)
//   3. VITE_OPENAI_API_KEY      — legacy fallback for existing deployments
const CLI_API_KEY_ENV = 'OPENROUTER_API_KEY';
const API_KEY_ENV = 'VITE_OPENROUTER_API_KEY';
const LEGACY_API_KEY_ENV = 'VITE_OPENAI_API_KEY';

// Pull env variables from whatever environment we happen to be running in.
// In Vite (browser) that's `import.meta.env`; when this module is imported
// from Node (eval harness, CLI tools) `import.meta.env` is undefined and we
// fall back to `process.env`. Guarded at access time so both environments
// can `import` this module without throwing.
function readEnv(key) {
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key] != null) {
      return import.meta.env[key];
    }
  } catch {
    // `import.meta.env` access in some bundlers throws instead of returning
    // undefined — swallow and fall through to process.env.
  }
  if (typeof process !== 'undefined' && process.env && process.env[key] != null) {
    return process.env[key];
  }
  return undefined;
}

function readConfiguredApiKey() {
  // 1. OPENROUTER_API_KEY — preferred for CLI / server / headless use.
  const cli = readEnv(CLI_API_KEY_ENV);
  if (cli && cli !== 'YOUR_API_KEY_HERE') return cli;
  // 2. VITE_OPENROUTER_API_KEY — Vite dev server (browser).
  const primary = readEnv(API_KEY_ENV);
  if (primary && primary !== 'YOUR_API_KEY_HERE') return primary;
  // 3. VITE_OPENAI_API_KEY — legacy fallback.
  const legacy = readEnv(LEGACY_API_KEY_ENV);
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

// Referer header is only meaningful when running in a browser. In Node
// (eval harness) we fall back to a stable constant so the request still
// carries a non-empty X-* identifier.
function getRefererOrigin() {
  if (typeof window !== 'undefined' && window?.location?.origin) {
    return window.location.origin;
  }
  return 'https://pm-tools.local';
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
 * Phase 6: the public `queryModel` export delegates through a mutable
 * implementation pointer so the eval harness can install a deterministic
 * mock via `installQueryModel(fn)` without any pipeline module changes.
 * `realQueryModel` (below) is the network-hitting implementation; the
 * exported `queryModel` just forwards to whichever function is currently
 * installed.
 *
 * @returns {Promise<ModelResult>}
 */
async function realQueryModel(model, messages, { temperature = 0.7, maxTokens = 3000 } = {}) {
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
          'HTTP-Referer': getRefererOrigin(),
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

// Mutable pointer for dependency-injected queryModel. Defaults to the real
// OpenRouter client; the eval harness swaps in a mock via installQueryModel.
let _queryModelImpl = realQueryModel;

/**
 * Install a custom queryModel implementation. Used by `eval/run.js` to
 * plug in a deterministic mock for regression runs. The UI never calls
 * this. `fn` must match the realQueryModel signature and return a
 * `{content, usage, wallClockMs}` ModelResult.
 *
 * @param {(model:string, messages:Array, options?:object) => Promise<ModelResult>} fn
 */
export function installQueryModel(fn) {
  if (typeof fn !== 'function') {
    throw new TypeError('installQueryModel: fn must be a function');
  }
  _queryModelImpl = fn;
}

/**
 * Restore the default (real OpenRouter) queryModel implementation.
 * Called by tests to unwind after installQueryModel.
 */
export function resetQueryModel() {
  _queryModelImpl = realQueryModel;
}

/**
 * Public queryModel entry point. Delegates through `_queryModelImpl` so
 * the eval harness can inject a mock without pipeline-module edits.
 *
 * @param {string} model
 * @param {Array<{role:string, content:string}>} messages
 * @param {object} [options]
 * @returns {Promise<ModelResult>}
 */
export function queryModel(model, messages, options) {
  return _queryModelImpl(model, messages, options);
}

/**
 * Fetch the full list of models currently available via OpenRouter.
 * The /models endpoint is public, so the API key is optional but sent when present.
 * Returns the raw `data` array (each item has id, name, description, architecture, etc.).
 */
export async function fetchAvailableModels() {
  const headers = {
    'HTTP-Referer': getRefererOrigin(),
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

