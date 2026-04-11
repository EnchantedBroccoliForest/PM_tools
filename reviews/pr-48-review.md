# PR #48 Review Notes

Reviewed PR: https://github.com/EnchantedBroccoliForest/PM_tools/pull/48
Commit: df9497d
Date: 2026-04-11

## Summary

I found two issues that should be addressed before merge:

1. **Citation coverage can be falsely reported as passing when source claims have zero verification rows.**
   - In `computeMetrics`, citation coverage treats a fixture as passing when
     `ver.filter(...).every(...)` returns true.
   - Because `Array.prototype.every` on an empty array is `true`, a fixture with source
     claims but no matching verification rows is counted as citation-resolved.
   - This can hide regressions (e.g., if a refactor stops emitting source verification rows).
   - Suggested fix: require at least one matching verification row, mirroring the stricter
     `assertOne('expected_citation_resolves_all', ...)` logic.

2. **CLI usage docs in `eval/run.js` say escalation default is `selective`, but code default is `always`.**
   - Top-of-file usage comment says `--escalation=always|selective (default: selective)`.
   - Actual parser default is `escalation: 'always'`.
   - This mismatch will confuse users running ad-hoc evals and interpreting baseline behavior.
   - Suggested fix: update the usage comment/help text to match runtime defaults.

## Recommendation

Request changes before merge.
