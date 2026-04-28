# Human Mode output reduction plan

## Problem statement

Human Mode is currently a tone fork, not a shape fork. It softens reviewer wording and runs a UI-only humanizer pass, but the pipeline still asks models to produce the full audit artifact and the UI still renders every generated field in the final card. The result is shorter in places, but still much too verbose for a human-facing output mode.

The core design goal is to keep Machine Mode as the full audit and regression-baseline path while making Human Mode feel like a compact market card first, with the full spec and audit details available only when the user asks for them.

## Diagnosis

1. Human draft prompts still request expansive output.
   - `src/constants/prompts.js` adds a Human concision rider, but the same prompt still asks for a comprehensive draft, full outcome set, detailed resolution rules, all possible edge cases, sources, and assumptions.
   - This creates conflicting instructions: the model is told to be brief, then immediately told to be exhaustive.

2. Human Mode inherits most Machine system prompts.
   - Tests currently assert that the Human bucket inherits drafter, finalizer, ideator, early-resolution analyst, claim extractor, entailment verifier, and humanizer prompts from Machine.
   - That protects safety, but it also means the main visible generation stages are not truly shaped for human-readable output.

3. Token budgets are shared across modes.
   - `DRAFT_MAX_TOKENS` is 8000 for both Machine and Human draft/update calls.
   - This avoids truncation but removes a practical length brake from Human Mode.

4. The final JSON schema has no output budget.
   - `RunSchema.finalJson` accepts an unconstrained record.
   - Prompt wording is the only limit on field length, bullet count, duplicate content, and copied output size.

5. The humanizer is a polish pass, not a compression guarantee.
   - `mergeHumanized()` accepts structurally stable replacements but does not require them to be shorter.
   - If a shorter rewrite drops a protected token or outcome name, the field falls back to the original verbose value.

6. CLI Human Mode does not run the humanizer.
   - Headless output remains raw finalizer JSON unless the caller explicitly requests a report format.
   - A user can select `--rigor=human` and still receive a machine-oriented JSON artifact by default.

7. The UI final panel displays the full spec by default.
   - The final panel renders question, description, dates, every outcome, win condition, resolution criteria, full resolution rules, edge cases, and early-resolution risk.
   - `Copy All` copies the full text bundle, not a compact market-card version.

## Product target

Human Mode should produce and display a market-card-first output:

- one concise market question
- one short description
- outcome names with one compact win condition each
- 3 to 5 settlement bullets
- 3 to 5 edge-case bullets
- source/risk/audit details collapsed behind explicit detail affordances
- a copy action that copies the compact card by default

Machine Mode should remain unchanged unless a change is explicitly called out below.

## Acceptance criteria

Human Mode output is considered improved when all of the following are true:

- The first visible final output in the UI is a compact card, not the full audit spec.
- The default Human copy action emits the compact card, not the full spec.
- Full resolution rules, all edge cases, risk analysis, and run trace are still available.
- Machine Mode final display and copy behavior are preserved unless deliberately changed in a separate PR.
- Human final card text has deterministic budget tests.
- The eval baseline remains pinned to Machine Mode.

Suggested initial budgets:

- `shortDescription`: 160 characters max
- each outcome `winCondition`: 160 characters max
- each outcome `resolutionCriteria`: 180 characters max
- `fullResolutionRules`: 5 bullets max in Human display
- `edgeCases`: 5 bullets max in Human display
- default Human copied card: 1200 to 1600 characters target, excluding URLs when required

## Implementation plan

### Phase 1: Add deterministic compact-card rendering

Add a pure helper, likely `src/util/marketCard.js`, that derives a compact card from existing `finalJson` without making LLM calls.

Responsibilities:

- accept `finalJson` and optional risk metadata
- return a display model with `question`, `description`, `period`, `outcomes`, `settlementBullets`, `edgeCaseBullets`, and `fullSpec`
- cap rendered bullets for Human display while preserving the original values for detail views
- provide a `formatMarketCardCopy(card)` helper for clipboard text

This should be deterministic so tests can pin exact output.

### Phase 2: Make the UI market-card first in Human Mode

Update `src/App.jsx` final rendering:

- when `displayRigor === 'human'`, render the compact market card first
- keep full resolution rules and edge cases inside collapsed detail sections
- keep early-resolution risk visible as a compact badge/summary, with full text in details
- change Human `Copy All` behavior to copy the compact card
- add a separate full-spec copy button for users who need the complete artifact

Update `src/App.css` only for necessary layout and detail styling. Keep this quiet and utilitarian; this is an operational tool, not a landing page.

### Phase 3: Add CLI card output

Update `bin/pm-tools.js` and report helpers:

- add `--format card`
- make `pm-tools report --format card` render the compact card offline from saved Run JSON
- consider defaulting `--rigor=human` to `card` for interactive terminal output unless `--format json` is explicit
- keep JSON default for automation if stdin/config indicates machine consumption

This gives Human Mode a readable headless surface without wiring the UI-only humanizer into the orchestrator.

### Phase 4: Add schema-level output budgets

Add final-output validation separate from the broad `RunSchema.finalJson` record.

Candidate implementation:

- introduce `FinalMarketSchema` in `src/types/finalMarket.js` or near the finalizer pipeline
- validate finalizer output before accepting it into `run.finalJson`
- on Human Mode budget failure, retry with a strict brevity repair prompt
- preserve Machine Mode behavior initially, or gate stricter validation behind Human only until baseline effects are understood

Budget checks should count characters and bullet lines, not just tokens.

### Phase 5: Split Human token budgets and prompt shape

Add mode-specific token settings after schema validation exists.

Suggested starting point:

- Machine draft/update: keep 8000
- Human draft: 1800 to 2400
- Human update: 2200 to 3000
- Human finalizer: 1200 to 1800
- Human structured review: keep current JSON budget unless failures appear

Prompt changes:

- replace Human draft wording that says `comprehensive`, `detailed`, and `all possible`
- require `settlement-critical only` assumptions
- cap edge cases and resolution bullets directly in Human prompts
- preserve load-bearing protocol and JSON-only instructions

### Phase 6: Make the humanizer a compression pass

Update `src/pipeline/humanize.js` so adopted replacements must be structurally stable and no longer than the original, except where the replacement only preserves required structural tokens.

Add tests for:

- shorter stable replacements are accepted
- longer replacements are rejected or trimmed by a repair pass
- protected tokens and outcome references still prevent unsafe adoption
- fallback behavior remains non-blocking

## Test plan

Add tests before tightening prompts so regressions are visible:

- unit tests for compact-card derivation and copy text
- UI render tests, if existing test setup supports React server rendering, that Human final output shows compact sections first
- prompt tests that assert Human prompt bodies contain concrete budget language, not just `differs from Machine`
- humanizer tests for shorter-or-equal adoption
- CLI report tests for `--format card`
- existing `npm run test`
- existing `npm run eval:check` to confirm Machine baseline stability

## Suggested PR sequence

1. Compact card renderer and Human UI copy behavior.
2. CLI `--format card` and report rendering.
3. Final output schema budgets and Human repair retry.
4. Human prompt rewrite plus mode-specific token budgets.
5. Humanizer compression guard.

This sequence produces user-visible relief immediately while keeping risky model-behavior changes behind deterministic render and validation layers.