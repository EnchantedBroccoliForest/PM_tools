# PR Review: EnchantedBroccoliForest/42_creator_tool#64

Date reviewed: 2026-04-12

## Summary

Reviewed commit `5ad121c` in PR #64 ("Populate start/end dates when using an ideated idea for drafting").

### What changed

- In `src/hooks/useMarketReducer.js`, action `USE_IDEA_FOR_DRAFT` now sets:
  - `startDate: action.startDate || ''`
  - `endDate: action.endDate || ''`
  - `dateError: null`
- Existing `mode`, `question`, `references`, and `error` updates remain.

## Review findings

### 1) Potential regression risk: wiping existing dates when action dates are missing

The reducer now always overwrites dates with empty strings when `action.startDate` or `action.endDate` is absent/falsy. If the ideation-to-draft handoff ever omits one/both values (e.g., parser failure, partial data), this can clear user-entered dates unexpectedly.

Suggested reducer fallback behavior:

- `startDate: action.startDate ?? state.startDate`
- `endDate: action.endDate ?? state.endDate`

This preserves existing values unless explicit new values are provided.

## Verdict

- Approve with one non-blocking suggestion above, unless product intent is to always reset missing date fields to blank.
