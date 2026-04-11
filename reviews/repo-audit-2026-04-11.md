# Repo Audit — 2026-04-11

This document summarizes potential bugs and improvement opportunities found during a full-pass repository review.

## 1) Unhandled promise rejections in background claim pipeline

**Severity:** High (stability / noisy failures)

In `App.jsx`, `runClaimExtractorAndRecord(...)` is intentionally fired in the background from at least two call sites, but those calls are not awaited and are not wrapped with `.catch(...)`.

If a future regression introduces a throw in this function (or one of the pipeline steps starts throwing unexpectedly), the app can emit unhandled promise rejections and lose observability of the failure in UI state.

**Recommendation:** Keep the background behavior but always terminate with `.catch(...)` and dispatch a `RUN_LOG` entry, so all failures are surfaced in-band.

---

## 2) Date validation can reject valid same-day future times

**Severity:** Medium (UX / correctness)

`validateDates` compares `new Date(start)` to local midnight of today and requires start date to be strictly greater than today. With date-only inputs this is usually okay, but this logic is coarse and can reject user intent around time zone boundaries because the input has no explicit timezone context.

**Recommendation:** Normalize date-only comparisons explicitly (e.g., compare YYYY-MM-DD strings in UTC semantics) and make constraints explicit in UI copy.

---

## 3) `useAmbientMode` accepts invalid mode values without guard

**Severity:** Medium (defensive coding)

`setMode` stores any incoming value and later dereferences `AMBIENT_MODES[mode].classes`. This currently works because existing call sites provide valid values, but one accidental bad call will crash at render/effect time.

**Recommendation:** Add a guard in `setMode` to ignore unknown values and optionally warn in development.

---

## 4) README default-model docs drifted from code

**Severity:** Low (documentation accuracy)

README claims default drafter/reviewer are `GPT-5.1` and `Claude 3.5 Haiku`, but code defaults are currently `openai/gpt-5.2` and `google/gemini-3-pro-preview`.

**Recommendation:** Update README defaults to match `src/constants/models.js`, or reword to avoid pinning specific defaults that change frequently.

---

## 5) Eval runner help text mismatch for escalation default

**Severity:** Low (developer confusion)

The header comment/help text says `--escalation` default is `selective`, but actual parser defaults it to `always`.

**Recommendation:** Align CLI docs/comments with real defaults to prevent confusion in CI/local comparisons.

---

## 6) Evidence resolution strategy is browser-constrained and may over-report availability

**Severity:** Low/Medium (signal quality)

`resolveCitation` treats any successful `fetch(..., { mode: 'no-cors' })` return as resolved, which is pragmatic in-browser but can overestimate URL validity when opaque responses are returned.

**Recommendation:** Keep current behavior for browser-only architecture, but document metric limitations and consider optional server-side validation path in future phases.

---

## 7) Single-file orchestration complexity in `App.jsx`

**Severity:** Medium (maintainability)

`App.jsx` contains workflow orchestration, pipeline coordination, gate logic, and presentation concerns in one large component. This increases risk of subtle regressions when adding stages.

**Recommendation:** Extract stage handlers into dedicated hooks/modules (`useDraftStage`, `useReviewStage`, etc.) and leave `App.jsx` as composition/UI.

---

## Checks run during audit

- `npm run lint` (passed)
- `npm run eval -- --quiet` (passed; 35/35 fixtures)

