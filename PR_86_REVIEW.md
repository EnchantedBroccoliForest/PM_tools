# PR #86 Review Notes

Date: 2026-04-19
Reviewer: Codex agent
PR: https://github.com/EnchantedBroccoliForest/42_creator_tool/pull/86
Commit reviewed: `8da0c21`

## Status

❌ **Request changes (1 high-risk correctness issue).**

## High-risk finding

### 1) `mergeHumanized` merges outcomes by array index, which can silently mis-assign win/resolution text if the model reorders outcomes

In `src/pipeline/humanize.js`, outcome text fields are merged with:

- `merged.outcomes = original.outcomes.map((origOutcome, i) => { const h = humanizedOutcomes[i]; ... })`

This assumes the model preserves outcome order. But LLMs often reorder list items while rewriting prose. If outcomes are reordered, the function will:

- keep `name` from `origOutcome` (good), **but**
- pull `winCondition` / `resolutionCriteria` from the wrong humanized outcome at index `i` (bad).

That creates internally inconsistent outcomes (name from A, criteria from B), which is a market-integrity risk for final resolution semantics.

#### Why this matters

The PR's goal is to preserve structural invariants while polishing prose. Index-based merge breaks that guarantee under common model drift (reordering), and the existing tests only cover name drift, not order drift.

#### Recommended fix

Match humanized outcomes to originals by stable key (outcome `name`) before restoring `name`, e.g.:

1. Build a map from humanized outcomes by normalized `name`.
2. For each original outcome, lookup by original name.
3. Only adopt `winCondition`/`resolutionCriteria` from the matched entry.
4. Fallback to original values if no match.

As a safety fallback, if duplicate/ambiguous names are detected, skip outcome-level humanization entirely for that market.

#### Recommended test additions

Add a regression test where humanized output swaps two outcomes and verify each original outcome retains the correct semantic pair (`name` + matching `winCondition`/`resolutionCriteria`).

## Notes

- Review performed from GitHub commit/PR pages in this environment.
