import { useEffect, useSyncExternalStore } from 'react';
import { fetchAvailableModels } from '../api/openrouter';
import {
  getLastModelsUpdateTime,
  getModelGroups,
  groupOpenRouterModels,
  setModelGroups,
  subscribeModels,
} from '../constants/models';

// How long a cached model list is considered fresh before we refetch.
const STALE_AFTER_MS = 60 * 60 * 1000; // 1 hour
// Interval at which we re-check while the app is open.
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

let refreshPromise = null;
let refreshTimer = null;

async function refreshModelsOnce() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const rawModels = await fetchAvailableModels();
      const groups = groupOpenRouterModels(rawModels);
      if (groups.length > 0) {
        setModelGroups(groups);
      }
    } catch (err) {
      // Keep the existing list (cache or fallback) on failure.
      console.warn('[models] refresh failed:', err?.message || err);
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function ensurePeriodicRefresh() {
  if (refreshTimer !== null) return;
  refreshTimer = setInterval(() => {
    refreshModelsOnce();
  }, REFRESH_INTERVAL_MS);
}

/**
 * Subscribe a component to the OpenRouter model list. Triggers an initial
 * fetch on mount if the cached list is missing or stale, and starts (once)
 * a shared interval that periodically refreshes in the background.
 */
export function useModels() {
  const groups = useSyncExternalStore(subscribeModels, getModelGroups);

  useEffect(() => {
    const lastUpdate = getLastModelsUpdateTime();
    const age = Date.now() - lastUpdate;
    if (lastUpdate === 0 || age > STALE_AFTER_MS) {
      refreshModelsOnce();
    }
    ensurePeriodicRefresh();
  }, []);

  return groups;
}
