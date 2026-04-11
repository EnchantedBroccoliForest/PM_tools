// ---------------------------------------------------------------------------
// 42.space protocol context — single source of truth
// ---------------------------------------------------------------------------
//
// PM_tools is used EXCLUSIVELY to draft markets for 42.space (formerly
// Alkimiya). 42 is NOT a Conditional-Token-Framework (CTF) prediction market
// like Polymarket or Kalshi. Its mechanism is fundamentally different and
// every prompt downstream must reflect that. The block below is injected into
// every drafter / reviewer / finalizer / ideator / verifier prompt so the
// model never forgets what platform it is targeting.
//
// Sources: docs.42.space/getting-started/protocol-mechanics-101/42-markets,
// www.42.space, alkimiya.io rebrand notes, @42space "Events Futures:
// Rethinking How Markets Trade" thread, APRO Oracle x 42Space partnership
// announcement.
export const PROTOCOL_NAME = '42.space';

export const PROTOCOL_CONTEXT = `42.space PROTOCOL — every market is an Events Futures market on 42, NOT a Polymarket/CTF/LMSR binary-share market. Design must respect 42's mechanism:

1. OUTCOME TOKENS: each outcome spawns its own Outcome Token (OT) backed by collateral on its own bonding curve. No YES/NO complement-pair invariant. Prices are conviction/flow, NOT probabilities, and uncapped (no $1 ceiling).
2. PARIMUTUEL SETTLEMENT: at the deadline trading halts (mint/redeem/transfers disabled), ONE winner is declared by predefined objective rules, and ALL losing collateral is pooled and redistributed PRO-RATA to the winning OT holders. No partial wins, no probabilistic payouts, no scalar payouts, no residual/LP liquidity.
3. MECE IS HARD-REQUIRED: outcomes must be mutually exclusive AND collectively exhaustive. Overlap breaks pro-rata math; gaps PERMANENTLY STRAND real collateral. A catch-all "Other / None" is REQUIRED unless the outcome space is provably closed.
4. MULTI-OUTCOME PREFERRED: 42 is built for n-way categorical races (3–10 OTs). Binary YES/NO is a degenerate fallback only — prefer multi-outcome whenever the question permits.
5. NO RAW SCALAR PAYOUT MECHANICS: 42 settles to a single winning Outcome Token, so it cannot pay out a continuous range. Scalar questions (price, count, %, viewership) are still valid market topics, but they MUST be discretized into clean partitioning named buckets BEFORE launch (e.g. "<$10M", "$10M–$25M", "$25M–$50M", "$50M+"). Each bucket is its own OT.
6. OBJECTIVE MACHINE-READABLE ORACLE (APRO is 42's primary data partner): official scoreboards, awards-body announcements, exchange/government feeds, on-chain data, official APIs. Editorial / paywalled / interpretive / self-referential ("if users vote X") sources are forbidden.
7. FIXED OUTCOME SET AT LAUNCH — cannot add outcomes mid-flight. Enumerate every plausible result up front.
8. HARD UTC DEADLINE — single unambiguous timestamp. Postponement, source-unavailable, ambiguous reporting, ties, and "no listed outcome occurred" MUST be addressed in edge cases with NAMED outcomes they map to (no "resolver discretion" without a named fallback).
9. MEANINGFUL TRADE PHASE: 42's bonding curve rewards early conviction (two winning-OT holders can earn different returns based on entry point). A good market stays genuinely uncertain across most of the window — flag markets that collapse to certainty within ~24h.
10. WHEELHOUSE: cultural moments, esports, awards/music races, fan-culture rivalries, viral memes, crypto narratives, headlines, pop events. Draft accordingly when user intent permits.
11. NO STRANDED COLLATERAL: any path leaving real collateral with no defined winner — orphan outcomes, overlapping outcomes, undefined edge cases, ambiguous tie-breaks — is BLOCKING and must be fixed before finalize.

Do NOT import CTF/Polymarket/Kalshi/Manifold assumptions — those are different protocols with different settlement mechanics.`;

// All drafter / reviewer / finalizer / ideator / structured-reviewer / judge
// system prompts share the same PROTOCOL_CONTEXT block — that is the SINGLE
// source of truth for 42's hard mechanism rules. Per-role preambles below
// only set role identity and role-specific output discipline; they do NOT
// restate the protocol rules. Per-step user prompts (buildDraftPrompt etc.)
// likewise stay focused on the step-specific task and omit restatements.
export const SYSTEM_PROMPTS = {
  drafter:
    `You are an expert at drafting market proposals for 42.space. You design proposals that satisfy the protocol rules below; you do not draft Polymarket-style binary CTF markets unless the question is genuinely binary.\n\n${PROTOCOL_CONTEXT}`,

  reviewer:
    `You are a critical reviewer of 42.space market drafts and a very well trained contract reviewer. You audit drafts against the protocol rules below.\n\n${PROTOCOL_CONTEXT}`,

  finalizer:
    `You are an expert at finalizing 42.space market proposals into structured JSON for Outcome Token spawning. Be extremely concise — terse, direct language, fragments over full sentences, no filler or hedging. The outcomes array you emit becomes real Outcome Tokens with real collateral attached, so it must respect the protocol rules below.\n\n${PROTOCOL_CONTEXT}`,

  earlyResolutionAnalyst:
    `You are an expert analyst evaluating whether a 42.space market could resolve early — i.e. its outcome becomes effectively certain before the end date. Be extremely concise: give a risk rating and brief justification only.\n\n${PROTOCOL_CONTEXT}`,

  ideator:
    `You are a creative ideator for 42.space markets. Given a vague user direction, brainstorm concrete market ideas that satisfy the protocol rules below.\n\n${PROTOCOL_CONTEXT}`,

  claimExtractor:
    'You are a meticulous claim extractor for 42.space market drafts. Decompose a draft into a flat list of atomic, verifiable claims — one sentence per claim, no compound statements. Output strictly valid JSON and nothing else. No prose, preamble, explanation, or markdown fences.',

  structuredReviewer:
    `You are a rigorous reviewer of 42.space market drafts. You produce TWO outputs in a single JSON response: (1) a prose critique of the draft, and (2) a rubric vote answering each checklist item as yes / no / unsure with a short rationale. Output strictly valid JSON matching the schema — no prose before or after, no markdown fences.\n\n${PROTOCOL_CONTEXT}`,

  aggregationJudge:
    `You are the aggregation judge for a 42.space market review. You read a rubric and the per-item votes of several independent reviewers and render a single overall verdict. You may override a majority when reviewers collectively missed a protocol-rule violation. Output strictly valid JSON matching the schema.\n\n${PROTOCOL_CONTEXT}`,

  entailmentVerifier:
    'You are a precise entailment verifier for 42.space market drafts. Given a draft and a list of atomic claims extracted from it, decide for each claim whether the draft entails it, contradicts it, fails to cover it, or is not applicable. Be strict: a claim is only "entailed" when its content is clearly present in the draft, not merely plausible or consistent. Output strictly valid JSON and nothing else.',
};

export function buildDraftPrompt(question, startDate, endDate, references) {
  const referencesSection = references && references.trim()
    ? `\nReference Links:\n${references.trim()}\n`
    : '';
  // Per-step prompt is intentionally lean: the protocol rules already live in
  // PROTOCOL_CONTEXT (injected into the drafter system prompt). This prompt
  // only specifies the step's output structure.
  return `Draft a 42.space market proposal for the user inputs below, following the protocol rules from your system prompt.

User's Question: "${question}"
Start Date: ${startDate}
End Date: ${endDate}${referencesSection}

Provide a comprehensive draft that includes:
1. A refined, unambiguous version of the question, framed as a 42 Events Future
2. The full Outcome Set — every Outcome Token to spawn at launch, each with a one-sentence win condition (include a catch-all entry unless the field is provably closed)
3. Detailed resolution rules — the objective oracle source, how it maps onto exactly one outcome, and the UTC deadline
4. All possible edge cases, each terminating in a named outcome from the Outcome Set
5. Potential sources for resolution (machine-readable URLs)
6. Any assumptions that need to be made explicit`;
}

export function buildReviewPrompt(draftContent) {
  // Per-step prompt is intentionally lean: the failure modes to look for are
  // already enumerated in PROTOCOL_CONTEXT (system prompt). This prompt only
  // tells the reviewer what to do with the draft.
  return `Review this 42.space market draft against the protocol rules in your system prompt. Challenge the resolution rules rigorously, surface every violation, prioritize blockers, and suggest concrete edits.

DRAFT TO REVIEW:
${draftContent}`;
}

export function buildDeliberationPrompt(draftContent, reviews) {
  const reviewsText = reviews
    .map(
      (r, i) =>
        `--- Reviewer ${i + 1} (${r.modelName}) ---\n${r.content}`
    )
    .join('\n\n');

  // Per-step prompt is intentionally lean: the protocol failure modes are
  // already in PROTOCOL_CONTEXT (system prompt). This prompt only orchestrates
  // the deliberation step.
  return `You previously reviewed a 42.space market draft. Below are critiques from other independent reviewers. Consider their reasoning: do you agree, disagree, or have additional concerns? Provide your updated review incorporating any valid points from other reviewers that you missed, and flag any protocol-rule violations they overlooked.

ORIGINAL DRAFT:
${draftContent}

OTHER REVIEWERS' CRITIQUES:
${reviewsText}

Provide your consolidated review, noting:
1. Points of agreement across reviewers
2. Points of disagreement and your position
3. Any new issues raised that are valid (especially blockers other reviewers missed)
4. Your final prioritized list of recommended changes — blockers first`;
}

export function buildUpdatePrompt(draftContent, reviewContent, humanReviewInput, focusBlock) {
  // Phase 5: `focusBlock` is an optional pre-rendered string produced by
  // buildRoutingFocusBlock(). When present it lists the specific claims
  // the routing pipeline flagged as blocking or needing targeted review,
  // so the updater knows where to direct its attention. Omitting it
  // preserves the pre-Phase-5 behavior exactly.
  const focusSection = focusBlock && focusBlock.trim()
    ? `\n\nROUTING FOCUS (address these FIRST — blocking claims must be fixed before this draft can be finalized):\n${focusBlock}`
    : '';

  // Per-step prompt is intentionally lean: protocol rules live in
  // PROTOCOL_CONTEXT (system prompt). This prompt only orchestrates the
  // update step.
  return `This is a critical review of a 42.space market draft. First determine whether each critique is consistent with the protocol rules in your system prompt. Incorporate the correct suggestions and generate a new draft. If a reviewer suggestion would violate a protocol rule, push back on it instead of incorporating it.

IMPORTANT: When human reviewer feedback is provided, treat it with higher priority than the AI-generated critical review. Weight human feedback approximately 25% more heavily — if the human's suggestions conflict with or differ from the AI review, lean toward the human's perspective. The human reviewer has domain-specific context and intent that should take precedence. (Exception: if the human's suggestion would violate a protocol rule, surface the conflict in your draft notes rather than silently breaking the market.)

ORIGINAL DRAFT:
${draftContent}

CRITICAL REVIEW:
${reviewContent}${humanReviewInput.trim() ? `

HUMAN REVIEWER FEEDBACK (HIGH PRIORITY — weight 25% more than AI review):
${humanReviewInput}` : ''}${focusSection}`;
}

/**
 * Render a routing focus block: one bullet per flagged claim with its
 * severity, the claim text, and the human-readable reasons the router
 * attached to it. Returns an empty string when there's nothing to focus
 * on — the caller uses that to omit the whole ROUTING FOCUS section.
 *
 * @param {import('../types/run').Routing|null} routing
 * @param {import('../types/run').Claim[]} claims
 * @returns {string}
 */
export function buildRoutingFocusBlock(routing, claims) {
  if (!routing || !routing.items || routing.items.length === 0) return '';
  const claimsById = new Map((claims || []).map((c) => [c.id, c]));
  const focus = routing.items.filter(
    (i) => i.severity === 'blocking' || i.severity === 'targeted_review',
  );
  if (focus.length === 0) return '';
  // Sort: blocking before targeted_review, then by descending uncertainty.
  focus.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'blocking' ? -1 : 1;
    return b.uncertainty - a.uncertainty;
  });
  return focus
    .map((item) => {
      const claim = claimsById.get(item.claimId);
      const text = claim ? claim.text : '(claim text unavailable)';
      const reasons = item.reasons.length > 0 ? ` [${item.reasons.join('; ')}]` : '';
      return `  - ${item.severity.toUpperCase()} ${item.claimId}: ${text}${reasons}`;
    })
    .join('\n');
}

export function buildFinalizePrompt(draftContent, startDate, endDate) {
  // Per-step prompt is intentionally lean: protocol rules live in
  // PROTOCOL_CONTEXT (system prompt). This prompt only specifies the JSON
  // schema and the conciseness discipline.
  return `Based on the following 42.space market draft, generate the final market details in a structured JSON format. Each entry in the "outcomes" array will become an Outcome Token spawned at launch and must respect the protocol rules in your system prompt.

CONCISENESS RULES:
- Cut all output text by at least 50% compared to the draft. Be terse and direct.
- Use fragments and short declarative sentences. No filler, hedging, qualifiers, or redundant phrasing.
- Do NOT repeat information across fields — each field must contain unique content only.
- winCondition: max 1 sentence stating WHAT must be true for this OT to be the winning outcome. resolutionCriteria: max 1 sentence stating HOW it is verified (source, method, threshold). Zero overlap between them.
- shortDescription: max 15 words.
- fullResolutionRules: compact numbered list, max 1 line per rule. No prose.
- edgeCases: compact numbered list, format "scenario → named outcome it resolves to", max 1 line each. Every edge case must terminate in a named outcome from the outcomes array above (or its catch-all).

DRAFT:
${draftContent}

USER PROVIDED DATES:
Start Date: ${startDate}
End Date: ${endDate}

Generate a JSON response with exactly these fields:
{
  "refinedQuestion": "Concise, unambiguous market question",
  "outcomes": [
    {
      "name": "Outcome name (becomes an Outcome Token on 42)",
      "winCondition": "One sentence: what must be true for this Outcome Token to win",
      "resolutionCriteria": "Verification method and source — no overlap with winCondition"
    }
  ],
  "marketStartTimeUTC": "YYYY-MM-DDTHH:MM:SSZ format based on start date",
  "marketEndTimeUTC": "YYYY-MM-DDTHH:MM:SSZ format based on end date (hard parimutuel cutoff)",
  "shortDescription": "One sentence market description",
  "fullResolutionRules": "Compact numbered rules — no redundancy with outcome-level criteria",
  "edgeCases": "Numbered list: scenario → named outcome from the outcomes array"
}`;
}

export function buildIdeatePrompt(direction) {
  const trimmed = (direction || '').trim();
  const directionSection = trimmed
    ? `USER DIRECTION:\n${trimmed}`
    : 'USER DIRECTION:\n(no specific direction — surprise the user with broadly interesting ideas in 42.space\'s wheelhouse)';

  // Per-step prompt is intentionally lean: the protocol rules and 42's
  // wheelhouse already live in PROTOCOL_CONTEXT (system prompt). This prompt
  // only specifies the ideation output structure.
  return `Generate a diverse set of 42.space market ideas based on the vague direction below, following the protocol rules in your system prompt. Brainstorm freely — it's fine to propose unexpected angles the user may not have considered. Prefer ideas where at least one underdog outcome is plausible but underloved (42's structural feature is uncapped upside on minority conviction).

${directionSection}

Produce 6–10 distinct market ideas. For each idea, provide:
1. **Title** — a concise, specific market question framed as a 42 Events Future
2. **Outcome Set** — the named Outcome Tokens to spawn at launch (3–8 entries preferred; include a catch-all "Other / None" unless the field is provably closed). One line.
3. **Why it's interesting** — 1 sentence on the narrative tension, catalyst, or uncertainty that gives the market a meaningful trade phase across competing OTs
4. **Resolvability** — 1 sentence naming the objective machine-readable source the oracle will read
5. **Suggested timeframe** — a rough end date or window

- Avoid duplicates — spread across subtopics, timeframes, and angles.
- Keep each idea tight — no preamble, no filler.
- Number the ideas 1., 2., 3., ...
- End with a brief 1–2 sentence note on themes or follow-up directions the user might explore.`;
}

// Claim extractor — decomposes a draft into a flat list of atomic claims.
// Used by src/pipeline/extractClaims.js, which wraps this in zod validation
// and a retry loop. Emits stable ids of the form `claim.<category>.<index>`
// (or `.<subfield>`) so downstream verifiers can hang results off them.
export function buildClaimExtractorPrompt(draftContent) {
  return `Extract all atomic claims from the 42.space market draft below.

OUTPUT: a strict JSON array. Each element is an object with exactly these fields:
  - id:         string, unique, of the form "claim.<category>.<index>" or "claim.<category>.<index>.<subfield>"
  - category:   one of "question" | "outcome_win" | "outcome_criterion" | "edge_case" | "source" | "timestamp" | "threshold" | "other"
  - text:       one sentence, declarative, verifiable, no compound statements
  - sourceRefs: always the empty array []  (evidence linking happens later)

WHAT TO EXTRACT (produce one claim per item, in this order):
  1. The refined question itself                               → category "question", id "claim.question.0"
  2. The market start time                                     → category "timestamp", id "claim.timestamp.start"
  3. The market end time                                       → category "timestamp", id "claim.timestamp.end"
  4. For each outcome in order, the winCondition              → category "outcome_win", id "claim.outcome.<i>.win"
  5. For each outcome in order, the resolutionCriteria        → category "outcome_criterion", id "claim.outcome.<i>.criterion"
  6. Every edge case listed in the draft                      → category "edge_case", id "claim.edge.<i>"
  7. Every cited source URL                                    → category "source", id "claim.source.<i>"    text = the URL exactly as cited
  8. Every explicit numerical threshold                       → category "threshold", id "claim.threshold.<i>"

RULES:
  - No prose. No markdown. No explanation. Output ONLY the JSON array.
  - Do not fabricate claims not present in the draft.
  - Do not merge claims. If the draft says "X and Y", emit two claims.
  - Indices start at 0 and are contiguous within a category.
  - If a field is missing from the draft, OMIT the corresponding claim rather than inventing one.

DRAFT:
${draftContent}`;
}

// Stricter retry builder: used only when the first extraction returned
// invalid JSON. Emphasises the "JSON only" constraint even harder.
export function buildStrictClaimExtractorRetryPrompt(draftContent) {
  return `Your previous response was not valid JSON. Try again.

Output ONLY a JSON array. No prose. No markdown fences. No commentary. Nothing before or after the array. The first character of your response must be "[" and the last character must be "]".

${buildClaimExtractorPrompt(draftContent)}`;
}

// Structured reviewer prompt — replaces the plain `buildReviewPrompt` for
// the Phase 2 review path. Asks a single reviewer to produce BOTH a prose
// critique (so the UI can show it unchanged) and a rubric vote + a list of
// structured criticisms (so the Run artifact gets real data).
//
// The rubric is passed in explicitly so adding or reordering rubric items
// never requires changing this module — `src/constants/rubric.js` is the
// single source of truth.
export function buildStructuredReviewPrompt(draftContent, rubric) {
  const rubricBlock = rubric
    .map(
      (item, i) =>
        `  ${i + 1}. id: "${item.id}"\n     question: ${item.question}\n     rationale: ${item.rationale}`
    )
    .join('\n');

  // Per-step prompt is intentionally lean: the protocol rules and the
  // failure-mode list live in PROTOCOL_CONTEXT (system prompt) and the
  // rubric. This prompt only specifies the JSON output schema.
  return `Review the 42.space market draft below against the protocol rules in your system prompt. Produce a single JSON object (no prose before or after) with exactly these fields:

{
  "reviewProse": "A paragraph-length critique of the draft in plain text. Flag ambiguities, missing edge cases, resolution risk, protocol-rule violations, and concrete edits. This is shown to the human user verbatim.",
  "rubricVotes": [
    {
      "ruleId": "<one of the rubric ids below>",
      "verdict": "yes" | "no" | "unsure",
      "rationale": "One or two sentences. If verdict is 'no' or 'unsure', be specific about what is wrong or what is missing."
    }
  ],
  "criticisms": [
    {
      "claimId": "<a claim id from the draft, or 'global' if this critique applies to the whole draft>",
      "severity": "blocker" | "major" | "minor" | "nit",
      "category": "mece" | "objectivity" | "source" | "timing" | "ambiguity" | "manipulation" | "atomicity" | "other",
      "rationale": "One or two sentences stating the problem and the suggested fix. Anything that would strand collateral on settlement is a blocker."
    }
  ]
}

RUBRIC (vote on every item, in this order):
${rubricBlock}

RULES:
  - Output ONLY the JSON object. No markdown fences, no prose before or after.
  - rubricVotes MUST contain exactly one entry per rubric id, in the order given.
  - criticisms is a list — it MAY be empty if the draft is genuinely flawless, but usually will not be.
  - Be honest about "unsure": if you cannot tell from the draft alone, vote unsure with a rationale explaining what evidence you would need.

DRAFT TO REVIEW:
${draftContent}`;
}

// Strict retry for the structured reviewer. Used when the first pass
// returned invalid JSON. Identical content but leans harder on the
// "JSON only" constraint.
export function buildStrictStructuredReviewRetryPrompt(draftContent, rubric) {
  return `Your previous response was not valid JSON. Try again.

Output ONLY a JSON object. No prose. No markdown fences. No commentary. Nothing before or after the object. The first character of your response must be "{" and the last character must be "}".

${buildStructuredReviewPrompt(draftContent, rubric)}`;
}

// Judge aggregator prompt — only used when the user selects the 'judge'
// aggregation protocol. Called ONCE after all reviewers have voted. Takes
// the rubric and the per-item vote tallies and renders a single pass /
// fail / escalate verdict with a rationale.
//
// Rationale is required because the judge result is otherwise opaque — a
// plain pass/fail verdict from a single extra LLM call would replace one
// single-point-of-failure (the chairman) with another.
export function buildJudgeAggregatorPrompt(rubric, checklist) {
  const rubricById = Object.fromEntries(rubric.map((r) => [r.id, r]));
  const itemsBlock = checklist
    .map((item) => {
      const rub = rubricById[item.id];
      const question = rub ? rub.question : '(unknown rubric item)';
      const votesBlock = item.votes
        .map(
          (v) =>
            `    - ${v.reviewerModel}: ${v.verdict}${
              v.rationale ? ` — ${v.rationale}` : ''
            }`
        )
        .join('\n');
      return `  id: ${item.id}\n  question: ${question}\n  votes:\n${votesBlock}`;
    })
    .join('\n\n');

  // Per-step prompt is intentionally lean: the protocol rules and override
  // criteria live in the system prompt. This prompt only orchestrates the
  // judge step.
  return `You are judging a rubric-based review of a 42.space market draft. Below is each rubric item with the votes cast by independent reviewers. A "yes" on every rubric item is necessary but not sufficient — if the reviewers collectively missed a protocol-rule violation, override the majority.

REVIEWS:
${itemsBlock}

Produce a single JSON object with exactly these fields:

{
  "perItemDecisions": [
    {
      "id": "<rubric id>",
      "decision": "pass" | "fail" | "escalate"
    }
  ],
  "overall": "pass" | "fail" | "needs_escalation",
  "rationale": "One paragraph explaining your verdict — specifically cite which rubric items drove pass vs fail, and name any disagreements between reviewers that you resolved."
}

RULES:
  - Output ONLY the JSON object. No prose before or after. No markdown fences.
  - perItemDecisions MUST contain one entry per rubric item above, in the same order.
  - "overall" is "pass" only if every per-item decision is "pass". If any item is "fail", overall is "fail". If any item is "escalate" (and none are "fail"), overall is "needs_escalation".
  - The rationale must name specific rubric ids — do not give a generic summary.`;
}

export function buildStrictJudgeAggregatorRetryPrompt(rubric, checklist) {
  return `Your previous response was not valid JSON. Try again.

Output ONLY a JSON object. No prose. No markdown fences. The first character must be "{" and the last character must be "}".

${buildJudgeAggregatorPrompt(rubric, checklist)}`;
}

// Batched draft-entailment verifier — Phase 3. One LLM call per run
// instead of one per claim, which keeps verification affordable for
// drafts with 20+ claims. The verifier is asked to render, for every
// claim, whether the draft actually entails it. This catches extractor
// hallucinations (a claim the extractor invented that does not appear
// in the draft) before those claims reach downstream features.
//
// Phase 4 (evidence) will introduce a richer verifier that also checks
// against retrieved sources. Phase 3 deliberately only checks against
// the draft text itself so we can run it without any external calls.
export function buildBatchEntailmentPrompt(claims, draftContent) {
  const claimsBlock = claims
    .map(
      (c, i) =>
        `  ${i + 1}. id: ${c.id}\n     category: ${c.category}\n     text: ${c.text}`
    )
    .join('\n');

  return `For each atomic claim below, decide whether the 42.space market draft entails it, contradicts it, fails to cover it, or is not applicable.

Definitions (use these exact strings):
  - "entailed":       the claim's content is clearly present in the draft, either stated explicitly or as an unambiguous paraphrase.
  - "contradicted":   the draft contains content that is inconsistent with the claim (e.g., a different end date, an opposing resolution rule).
  - "not_covered":    the draft does not mention the claim's content at all. This usually indicates an extraction error.
  - "not_applicable": entailment is not a meaningful check for this claim (e.g., the claim is a bare URL, or the claim repeats the question id rather than content).

DRAFT:
${draftContent}

CLAIMS:
${claimsBlock}

Output a strict JSON array with exactly one object per claim, IN THE SAME ORDER. Each object has exactly these fields:
[
  {
    "id": "<claim id>",
    "entailment": "entailed" | "contradicted" | "not_covered" | "not_applicable",
    "rationale": "one short sentence explaining your decision"
  }
]

RULES:
  - Output ONLY the JSON array. No prose before or after. No markdown fences.
  - Be strict: "entailed" requires the content to actually be in the draft. "It sounds reasonable" is not entailment.
  - If you mark a claim "contradicted", the rationale must quote the specific conflicting passage from the draft.
  - The first character of your response must be "[" and the last must be "]".`;
}

export function buildStrictBatchEntailmentRetryPrompt(claims, draftContent) {
  return `Your previous response was not valid JSON. Try again.

Output ONLY a JSON array. No prose. No markdown fences. The first character must be "[" and the last character must be "]".

${buildBatchEntailmentPrompt(claims, draftContent)}`;
}

// NOTE: this builder takes the *raw updated draft* (not a finalized JSON
// object). The risk check now gates Stage 4 — HIGH risk must be acknowledged
// before the user can Accept & Finalize.
export function buildEarlyResolutionPrompt(draftContent, startDate, endDate) {
  // Per-step prompt is intentionally lean: the protocol context (why early
  // certainty is bad on 42) lives in the system prompt. This prompt only
  // orchestrates the risk check.
  return `Review the 42.space market draft below. Based on its outcomes and resolution rules, determine whether the market's outcome could become effectively certain *before* the stated End Date — a scenario that collapses 42's bonding-curve trade phase.

DRAFT:
${draftContent}

USER-PROVIDED DATES:
Start Date: ${startDate}
End Date: ${endDate}

Respond concisely (max 4-6 sentences total). The FIRST line of your response must be exactly one of:
Risk rating: Low
Risk rating: Medium
Risk rating: High

Then on following lines, list the key scenarios (if any) that could cause early certainty. Keep it brief — no preamble, no restating the question.`;
}
