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
5. CATEGORICAL ONLY: no scalar/range markets. Any scalar question (price, count, %, viewership) MUST be discretized into clean partitioning named buckets.
6. OBJECTIVE MACHINE-READABLE ORACLE (APRO is 42's primary data partner): official scoreboards, awards-body announcements, exchange/government feeds, on-chain data, official APIs. Editorial / paywalled / interpretive / self-referential ("if users vote X") sources are forbidden.
7. FIXED OUTCOME SET AT LAUNCH — cannot add outcomes mid-flight. Enumerate every plausible result up front.
8. HARD UTC DEADLINE — single unambiguous timestamp. Postponement, source-unavailable, ambiguous reporting, ties, and "no listed outcome occurred" MUST be addressed in edge cases with NAMED outcomes they map to (no "resolver discretion" without a named fallback).
9. MEANINGFUL TRADE PHASE: 42's bonding curve rewards early conviction (two winning-OT holders can earn different returns based on entry point). A good market stays genuinely uncertain across most of the window — flag markets that collapse to certainty within ~24h.
10. WHEELHOUSE: cultural moments, esports, awards/music races, fan-culture rivalries, viral memes, crypto narratives, headlines, pop events. Draft accordingly when user intent permits.
11. NO STRANDED COLLATERAL: any path leaving real collateral with no defined winner — orphan outcomes, overlapping outcomes, undefined edge cases, ambiguous tie-breaks — is BLOCKING and must be fixed before finalize.

Do NOT import CTF/Polymarket/Kalshi/Manifold assumptions — those are different protocols with different settlement mechanics.`;

export const SYSTEM_PROMPTS = {
  drafter:
    `You are an expert at drafting prediction-market proposals for 42.space, the Events Futures asset-issuance protocol. You design markets whose outcome set, resolution rules, and edge cases are correctly shaped for 42's parimutuel-on-bonding-curve mechanism — multi-outcome categorical races with MECE outcomes, an objective oracle source, a deterministic deadline, and no path to stranded collateral. You do NOT draft Polymarket-style binary CTF markets unless the question is genuinely binary.\n\n${PROTOCOL_CONTEXT}`,

  reviewer:
    `You are a critical reviewer of prediction-market drafts for 42.space. You are a very well trained contract reviewer. Your job is to find flaws, ambiguities, and 42-specific design failures: non-MECE outcome sets that would strand collateral on settlement, missing catch-all "Other" outcomes, scalar questions that were not discretized, subjective or non-machine-readable resolution sources, fixed-outcome-set assumptions that the draft violates, deadline ambiguity, and any imported assumptions from CTF/LMSR markets that do not apply on 42.\n\n${PROTOCOL_CONTEXT}`,

  finalizer:
    `You are an expert at finalizing prediction-market proposals for 42.space. Extract and format the final market details from the draft into a structured format suitable for spawning Outcome Tokens on 42. Be extremely concise — use terse, direct language. No filler, no hedging, no redundancy. Prefer fragments over full sentences where clarity is preserved. Every word must earn its place. The outcomes array you emit will become real Outcome Tokens with real collateral attached, so it must be MECE and complete.\n\n${PROTOCOL_CONTEXT}`,

  earlyResolutionAnalyst:
    `You are an expert analyst evaluating whether a 42.space market could resolve early — whether its outcome becomes effectively certain before the end date. On 42 this is doubly important: early certainty kills the trade phase the bonding curve is built around AND can permanently transition the market into settlement, so the reward for early conviction collapses. Be extremely concise. Give a risk rating and brief justification only.\n\n${PROTOCOL_CONTEXT}`,

  ideator:
    `You are a creative prediction-market ideator for 42.space. Given vague directions from a user, research the topic area and brainstorm a diverse set of concrete, 42-shaped market ideas. Strongly favor multi-outcome categorical races (3–8+ named contenders) over binary YES/NO. Strongly favor cultural moments, esports brackets, music/award races, fan-culture rivalries, viral memes, crypto narratives, sports finals, election fields, and trending events — 42's declared wheelhouse. Every idea must be objectively resolvable via a machine-readable source, MECE, and have a meaningful trade window (not collapse to certainty in 24h).\n\n${PROTOCOL_CONTEXT}`,

  claimExtractor:
    'You are a meticulous claim extractor for 42.space prediction-market drafts. Your job is to decompose a draft into a flat list of atomic, verifiable claims — one sentence per claim, no compound statements. You output strictly valid JSON and nothing else. Do not include prose, preamble, explanation, or markdown fences.',

  structuredReviewer:
    `You are a rigorous reviewer of 42.space prediction-market drafts. You produce TWO outputs in a single JSON response: (1) a prose critique of the draft, and (2) a rubric vote answering each checklist item as yes / no / unsure with a short rationale. You evaluate the draft against 42's parimutuel-on-bonding-curve mechanism — not against generic CTF prediction-market norms. You must output strictly valid JSON matching the schema — no prose before or after, no markdown fences.\n\n${PROTOCOL_CONTEXT}`,

  aggregationJudge:
    `You are the aggregation judge for a 42.space prediction-market review. You read a rubric and the per-item votes of several independent reviewers and render a single overall verdict. You are not a tiebreaker alone — you may override a majority when reviewers agreed on something obviously wrong, ESPECIALLY when reviewers missed a 42-specific failure mode (non-MECE outcome set, stranded collateral path, scalar question that was not discretized, subjective oracle source). You output strictly valid JSON matching the schema.\n\n${PROTOCOL_CONTEXT}`,

  entailmentVerifier:
    'You are a precise entailment verifier for 42.space prediction-market drafts. Given a draft and a list of atomic claims extracted from it, you decide for each claim whether the draft entails it, contradicts it, fails to cover it, or is not applicable. You are strict: a claim is only "entailed" when its content is clearly present in the draft, not merely plausible or consistent. You output strictly valid JSON and nothing else.',
};

export function buildDraftPrompt(question, startDate, endDate, references) {
  const referencesSection = references && references.trim()
    ? `\nReference Links:\n${references.trim()}\n`
    : '';
  return `Draft a 42.space market proposal based on the user inputs below. The proposal will spawn one Outcome Token per outcome at launch, each with its own bonding curve and collateral pool, and will settle parimutuel pro-rata to the winning OT holders — so the outcome set, resolution rules, and edge cases must be designed for THAT mechanism, not for a Polymarket-style binary CTF market.

User's Question: "${question}"
Start Date: ${startDate}
End Date: ${endDate}${referencesSection}

REQUIREMENTS specific to 42.space (every draft MUST satisfy these):
- The outcome set MUST be MECE (mutually exclusive AND collectively exhaustive). Overlapping outcomes break parimutuel pro-rata math; missing outcomes permanently strand collateral.
- Prefer a multi-outcome categorical structure (3–8+ named outcomes) over a binary YES/NO whenever the question naturally permits multiple competing answers. 42 is built for n-way races.
- Include an explicit catch-all outcome (e.g. "Other / None of the above" or "None of the listed outcomes occur by the deadline") UNLESS the outcome space is provably closed (a finite enumerated bracket where every entrant is named).
- If the user's question is scalar / continuous (price, count, percentage, viewership), you MUST discretize it into named buckets that partition the real line cleanly (e.g. "<$10M", "$10M–$25M", "$25M–$50M", "$50M+").
- Resolution source MUST be objective and machine-readable (official scoreboard, awards-body announcement, government or exchange feed, on-chain data, official API). NO editorial / paywalled / interpretive / "majority of users vote" sources. NO self-referential resolution.
- Resolution deadline MUST be a specific UTC timestamp.
- Edge cases MUST cover: postponement past the deadline, source unavailable at the deadline, ambiguous reporting, ties, and any "no enumerated outcome occurred" scenario — each with a NAMED resolution that maps cleanly onto an outcome (or "Other").
- The trade phase must remain genuinely uncertain across most of the window — flag and avoid markets that would collapse to certainty within 24 hours of launch (that defeats 42's bonding-curve trade dynamic).

Provide a comprehensive draft that includes:
1. A refined, unambiguous version of the question, framed as a 42 Events Future
2. The full Outcome Set — every Outcome Token to spawn at launch, each with a one-sentence win condition. Include the catch-all if applicable.
3. Detailed resolution rules (the objective oracle source, how the source maps onto exactly one outcome, the UTC deadline)
4. All possible edge cases and the named outcome each one resolves to (no "resolver discretion" without an explicit named fallback)
5. Potential sources for resolution (must be machine-readable; list URLs)
6. Any assumptions that need to be made explicit`;
}

export function buildReviewPrompt(draftContent) {
  return `Review this draft for a 42.space market. Challenge the resolution rules rigorously and surface every flaw a 42-specific reviewer would catch — not just generic prediction-market hygiene.

In particular, audit the draft against 42's parimutuel-on-bonding-curve mechanism. A draft FAILS if any of these are true:
- The outcome set is not MECE (two outcomes can both be true, or some plausible result fits no outcome). On 42 this strands real collateral — it is a blocker, not a nit.
- A catch-all "Other / None" outcome is missing on a non-binary market whose space is not provably closed.
- The question is scalar/continuous and was not discretized into clean named buckets.
- The resolution source is editorial, paywalled, interpretive, self-referential, or otherwise not machine-readable by an objective oracle (APRO-compatible).
- The resolution deadline is not a single unambiguous UTC timestamp.
- An edge case (postponement, source-unavailable, tie, ambiguous reporting, "no listed outcome occurred") lacks a named outcome it resolves to.
- The market would collapse to certainty within ~24h of launch (kills the trade phase).
- The draft assumes CTF / Polymarket-style binary share mechanics (1 YES + 1 NO = $1, prices = probability, LP residual liquidity, scalar payout) — these do not apply on 42.

Surface every issue, prioritize blockers, and suggest concrete edits.

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

  return `You previously reviewed a 42.space market draft. Below are critiques from other independent reviewers. Consider their reasoning: do you agree, disagree, or have additional concerns? Provide your updated review incorporating any valid points from other reviewers that you missed.

Pay particular attention to 42-specific failure modes that any reviewer may have overlooked: non-MECE outcome sets that would strand collateral on settlement, missing catch-all outcomes, scalar questions that were not discretized, subjective or non-machine-readable resolution sources, deadline ambiguity, and any imported assumptions from CTF/LMSR/Polymarket-style markets that do not apply on 42's parimutuel-on-bonding-curve mechanism.

ORIGINAL DRAFT:
${draftContent}

OTHER REVIEWERS' CRITIQUES:
${reviewsText}

Provide your consolidated review, noting:
1. Points of agreement across reviewers
2. Points of disagreement and your position
3. Any new issues raised that are valid (especially 42-specific blockers other reviewers missed)
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

  return `This is a critical review of a 42.space market draft. Review and first determine if the critiques make logical sense for 42's parimutuel-on-bonding-curve mechanism (NOT a CTF/Polymarket-style market). Incorporate the suggestions or criticisms from the Reviewer that are correct and generate a new draft.

The updated draft must continue to satisfy 42's hard requirements: MECE outcome set with explicit catch-all, multi-outcome categorical structure preferred over binary, scalar questions discretized into named buckets, machine-readable objective oracle source, single UTC deadline, every edge case mapped onto a named outcome, and no path that could strand collateral. If a reviewer suggestion would violate any of these, push back on it instead of incorporating it.

IMPORTANT: When human reviewer feedback is provided, treat it with higher priority than the AI-generated critical review. Weight human feedback approximately 25% more heavily — if the human's suggestions conflict with or differ from the AI review, lean toward the human's perspective. The human reviewer has domain-specific context and intent that should take precedence. (Exception: if the human's suggestion would VIOLATE one of 42's hard mechanism requirements above, surface the conflict in your draft notes rather than silently breaking the market.)

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
  return `Based on the following 42.space market draft, generate the final market details in a structured JSON format. Each entry in the "outcomes" array will become an Outcome Token (OT) spawned at launch on 42, with its own bonding curve and collateral pool, settled parimutuel pro-rata at the deadline.

42 MECHANISM CONSTRAINTS — the JSON you emit must satisfy ALL of these:
- The "outcomes" array MUST be MECE. Every plausible result of the underlying event must map to exactly one entry. If the outcome space is not provably closed, the LAST entry MUST be an explicit catch-all (e.g. "Other / None of the above") so collateral cannot be stranded at settlement.
- Prefer multi-outcome (3+ entries) over binary YES/NO whenever the draft permits — 42 is built for n-way races.
- If the underlying question is scalar/continuous, the entries MUST be named buckets that partition the real line cleanly with no gaps and no overlaps.
- Resolution sources must be machine-readable and objective (no editorial / interpretive / self-referential sources).
- "marketEndTimeUTC" is the hard parimutuel cutoff at which trading halts and settlement begins — it must be a single unambiguous UTC timestamp.

IMPORTANT — CONCISENESS RULES:
- Cut all output text by at least 50% compared to the draft. Be terse and direct.
- Use fragments and short declarative sentences. No filler, hedging, qualifiers, or redundant phrasing.
- Do NOT repeat information across fields — each field must contain unique content only.
- winCondition: max 1 sentence stating WHAT must be true for this OT to be the winning outcome. resolutionCriteria: max 1 sentence stating HOW it is verified (source, method, threshold). Zero overlap between them.
- shortDescription: max 15 words.
- fullResolutionRules: compact numbered list, max 1 line per rule. No prose.
- edgeCases: compact numbered list, format "scenario → named outcome it resolves to", max 1 line each. Every edge case must terminate in a named outcome from the array above (or the catch-all).

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
      "name": "Outcome name (will become an Outcome Token on 42)",
      "winCondition": "One sentence: what must be true for this Outcome Token to be declared the winner",
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

  return `Generate a diverse set of 42.space market ideas based on the vague direction below. Research the topic area using your own knowledge of current events, upcoming catalysts, narrative trends, and pop/cultural moments. Brainstorm freely — it's fine to propose unexpected angles the user may not have considered.

${directionSection}

Produce 6–10 distinct market ideas. For each idea, provide:
1. **Title** — a concise, specific market question framed as a 42 Events Future
2. **Outcome Set** — the named Outcome Tokens to spawn at launch (3–8 entries preferred; include a catch-all "Other / None" unless the field is provably closed). One line.
3. **Why it's interesting** — 1 sentence on the narrative tension, catalyst, or uncertainty that gives the market a meaningful trade phase across competing OTs
4. **Resolvability** — 1 sentence naming the OBJECTIVE machine-readable source the oracle will read (official scoreboard, awards body, exchange feed, on-chain data, official API). Editorial / paywalled / interpretive sources are disqualifying.
5. **Suggested timeframe** — a rough end date or window

42-FIT GUIDELINES (strong preferences — follow them unless the user direction explicitly overrides):
- STRONGLY favor multi-outcome categorical races (n-way brackets, award fields, election fields, esports finals, "which X wins / trends most / hits #1") over binary YES/NO. 42 is built for n-way races and binary is the degenerate case.
- STRONGLY favor cultural moments, esports brackets, music/awards races, fan-culture rivalries, viral memes, crypto narratives, headlines, and pop events — 42's declared wheelhouse since the rebrand from Alkimiya.
- Each idea must be MECE — overlapping or missing outcomes would strand collateral on settlement.
- If the natural question is scalar (price, count, percentage, viewership), discretize it into clean named buckets in the Outcome Set line.
- Each idea must have meaningful uncertainty across most of the trade window — avoid markets that would collapse to certainty within 24h of launch (kills the bonding-curve trade phase).
- Prefer ideas where at least one underdog outcome is plausible but underloved (42's structural feature is uncapped upside on minority conviction).
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

  return `Review the 42.space market draft below. Evaluate it against 42's parimutuel-on-bonding-curve mechanism — NOT against generic CTF / Polymarket-style binary-share norms. Produce a single JSON object (no prose before or after) with exactly these fields:

{
  "reviewProse": "A paragraph-length critique of the draft in plain text. Flag ambiguities, missing edge cases, resolution risk, 42-specific failure modes (non-MECE outcome set, missing catch-all, scalar question not discretized, subjective oracle source, deadline ambiguity, paths that strand collateral), and concrete edits. This is shown to the human user verbatim.",
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
      "rationale": "One or two sentences stating the problem and the suggested fix. Any non-MECE outcome set, any path that strands collateral, any scalar question that was not discretized, and any subjective / non-machine-readable resolution source MUST be marked 'blocker'."
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

  return `You are the judge for a rubric-based review of a 42.space market draft. 42 is an Events Futures protocol where each outcome spawns its own Outcome Token on a bonding curve and settles parimutuel pro-rata to winners — so a "yes" verdict on every rubric item is necessary but NOT sufficient. If reviewers collectively missed a 42-specific failure mode (non-MECE outcome set, missing catch-all, scalar question not discretized, subjective oracle source, path that strands collateral on settlement), you may override a clean majority with an "escalate" or "fail". Below is each rubric item with the votes cast by independent reviewers.

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
  return `Review the 42.space market draft below. Based on its outcomes and resolution rules, determine whether the market's outcome could become effectively certain *before* the stated End Date.

On 42, early certainty is doubly damaging: (1) it kills the bonding-curve trade phase the protocol is built around — once everyone knows the answer, there is no reason to mint, redeem, or rotate between Outcome Tokens, so the "reward early conviction" mechanism collapses; (2) under the lifecycle, a market that becomes deterministic before deadline either strands traders in a frozen pool or forces a deliberate early settlement that pre-empts the trade window. Both outcomes are bad — flag them.

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
