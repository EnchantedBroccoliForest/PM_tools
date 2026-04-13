# PR Review: EnchantedBroccoliForest/42_creator_tool#70

## Findings

### 1) `SET_VIEWING_VERSION` accepts out-of-range indexes (medium)
- In `useMarketReducer`, `SET_VIEWING_VERSION` directly assigns `action.index` with no bounds check.
- App code dispatches `viewingVersionIndex - 1` / `+ 1` from button handlers. While buttons are usually disabled at edges, rapid state transitions or any future non-UI dispatch path can still produce invalid indexes.
- When index is invalid, `displayedVersion` becomes `undefined`, causing fallback rendering with `draftContent` while the version badge/index UI can become inconsistent.

**Suggested fix**
Clamp index in reducer:

```js
case 'SET_VIEWING_VERSION': {
  const max = Math.max(0, state.draftVersions.length - 1);
  const index = Math.min(max, Math.max(0, action.index));
  return { ...state, viewingVersionIndex: index };
}
```

## Notes
- Could not run project tests locally for this external PR because the target repository is outside the current workspace and direct git/network access is restricted in this runtime.
