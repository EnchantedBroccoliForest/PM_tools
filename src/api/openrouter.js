const API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // exponential backoff

function getApiKey() {
  const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
  if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
    throw new Error(
      'OpenRouter API key not configured. Please add VITE_OPENAI_API_KEY to your environment.'
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
 * Query a single model via OpenRouter with retry and exponential backoff.
 */
export async function queryModel(model, messages, { temperature = 0.7, maxTokens = 3000 } = {}) {
  const apiKey = getApiKey();
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
      return content;
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
 * Returns an array of { model, modelName, content, error } objects.
 */
export async function queryModelsParallel(models, messages, options = {}) {
  const results = await Promise.allSettled(
    models.map((m) =>
      queryModel(m.id, messages, options).then((content) => ({
        model: m.id,
        modelName: m.name,
        content,
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
      error: result.reason?.message || 'Unknown error',
    };
  });
}
