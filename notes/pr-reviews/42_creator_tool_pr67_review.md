# PR Review: EnchantedBroccoliForest/42_creator_tool#67

Date reviewed: 2026-04-12

## Summary

Reviewed commit `4f389f9` in PR #67 ("fix: claims extraction failures — increase maxTokens and add truncation recovery").

### What changed

- In `src/pipeline/extractClaims.js`:
  - `maxTokens` for both extraction attempts increases from `4000` to `8000`.
  - `tryParseJson` now attempts a second-stage truncation recovery if direct `JSON.parse` fails.

## Review findings

### 1) `tryParseJson` truncation recovery is anchored to `candidate`, not the clipped JSON slice

The new recovery logic computes `arrayStart` from `candidate`:

- `const arrayStart = candidate.indexOf('[')`
- `let truncated = candidate.slice(arrayStart)`

But earlier logic already computes a clipped JSON slice (`bracketed` / `exact`) specifically to remove leading prose. If model output contains any non-JSON bracket usage before the actual array (e.g. "[note]" in prose), recovery can start from the wrong `[` and fail to salvage otherwise recoverable output.

**Suggested fix:** Run truncation recovery from the same clipped JSON slice used for parse attempt #1 (e.g., `exact`), not raw `candidate`.

## Verdict

- **Request changes** for the parser anchoring issue above. The token increase is good and likely helpful, but the recovery path should be made robust before merge.
