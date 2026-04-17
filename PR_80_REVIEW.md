# PR #80 Review Notes

Date: 2026-04-17
Reviewer: Codex agent

## Scope
Reviewed the proposed changes on GitHub for:
`https://github.com/EnchantedBroccoliForest/42_creator_tool/pull/80`

## High-risk finding

### 1) Claim ID regex likely rejects existing valid IDs (potential data loss)
**Severity:** High

PR #80 introduces a stricter `ClaimSchema.id` regex:

- New pattern: `^claim\.[a-z_]+\.[a-z0-9_]+(?:\.[a-z0-9_]+)*$`

This disallows uppercase letters in slug segments.

However, existing in-code examples include camelCase claim IDs, e.g.:

- `claim.outcome.0.resolutionCriteria`

That ID contains uppercase `C`, which is now invalid under the new regex. If extractor/verifier output (or historical fixtures/runs) still uses camelCase segments, valid claims will be dropped during validation. In this PR, extraction now validates claims individually and drops invalid entries, so this can silently reduce claim coverage and increase downstream `not_covered`/routing noise.

**Recommendation:**
- Either relax regex slug segment to allow uppercase (`[A-Za-z0-9_]+`),
- or ensure prompts and all fixtures are normalized to lowercase claim IDs before this lands.
- Add a targeted regression test with `claim.outcome.0.resolutionCriteria` to prevent accidental breakage.

## Additional review notes

- Could not check out PR branch in local git due network restrictions in this environment (`CONNECT tunnel failed, response 403` from git fetch).
- Review was performed from GitHub web/raw file views.
