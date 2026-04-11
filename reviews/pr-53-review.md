# PR #53 Review Notes

Reviewed PR: https://github.com/EnchantedBroccoliForest/PM_tools/pull/53
Commit: a7e88ec
Date: 2026-04-11

## Summary

I found one **blocking** issue and one **major** concern that should be addressed before merge.

1. **Blocking: conflicting requirements in the new protocol guidance can cause inconsistent model behavior for scalar prompts.**
   - The new `PROTOCOL_CONTEXT` says “CATEGORICAL ONLY: no scalar/range markets.”
   - The same context immediately requires scalar questions to be discretized into named buckets.
   - The draft/review/finalization prompts repeat the discretization requirement, which conflicts with the absolute “no scalar/range markets” wording.
   - This internal contradiction can push different models to opposite interpretations (reject scalar-origin questions vs. discretize and proceed), which risks unstable outputs and avoidable reviewer disagreement.
   - Suggested fix: change the hard rule to “no raw scalar payout mechanics; scalar questions must be discretized into categorical buckets before launch.”

2. **Major: prompt duplication increases token spend substantially and may reduce reliability/cost efficiency.**
   - This PR injects a very large protocol block into multiple system prompts and also repeats many of the same constraints in task prompts.
   - Baseline token spend rises from `373,538` to `613,050` (about +64%), while accuracy metrics stay flat.
   - Even if intentional, this size increase materially affects run cost and increases risk of context pressure on smaller/cheaper reviewer models.
   - Suggested fix: keep protocol constraints centralized in one reusable block and remove repeated restatements in per-step prompts where feasible.

## Recommendation

Request changes before merge.
