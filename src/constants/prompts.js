export const SYSTEM_PROMPTS = {
  drafter:
    'You are an expert at creating prediction market questions with clear, unambiguous resolution criteria. You help create well-defined markets that can be objectively resolved.',

  reviewer:
    'You are a critical reviewer specializing in prediction market design. You are a very well trained contract reviewer. Your job is to find flaws, ambiguities, and potential issues in market definitions, resolution rules, and the completeness of the outcome set.',

  finalizer:
    'You are an expert at creating prediction market questions. Extract and format the final market details from the draft into a structured format. Be extremely concise — use terse, direct language. No filler, no hedging, no redundancy. Prefer fragments over full sentences where clarity is preserved. Every word must earn its place.',

  earlyResolutionAnalyst:
    'You are an expert analyst evaluating whether a prediction market could resolve early — whether its outcome becomes effectively certain before the end date. Be extremely concise. Give a risk rating and brief justification only.',

  ideator:
    'You are a creative prediction market ideator. Given vague directions from a user, research the topic area and brainstorm a diverse set of concrete, high-quality prediction market ideas. Draw on current events, upcoming catalysts, policy debates, technology trends, and cultural moments. Favor markets that are objectively resolvable, genuinely uncertain, and interesting to bet on.',

  claimExtractor:
    'You are a meticulous claim extractor. Your job is to decompose a prediction market draft into a flat list of atomic, verifiable claims — one sentence per claim, no compound statements. You output strictly valid JSON and nothing else. Do not include prose, preamble, explanation, or markdown fences.',

  structuredReviewer:
    'You are a rigorous prediction market reviewer. You produce TWO outputs in a single JSON response: (1) a prose critique of the draft, and (2) a rubric vote answering each checklist item as yes / no / unsure with a short rationale. You must output strictly valid JSON matching the schema — no prose before or after, no markdown fences.',

  aggregationJudge:
    'You are the aggregation judge for a prediction market review. You read a rubric and the per-item votes of several independent reviewers and render a single overall verdict. You are not a tiebreaker alone — you may override a majority when reviewers agreed on something obviously wrong. You output strictly valid JSON matching the schema.',

  entailmentVerifier:
    'You are a precise entailment verifier. Given a prediction market draft and a list of atomic claims extracted from it, you decide for each claim whether the draft entails it, contradicts it, fails to cover it, or is not applicable. You are strict: a claim is only "entailed" when its content is clearly present in the draft, not merely plausible or consistent. You output strictly valid JSON and nothing else.',
};

export function buildDraftPrompt(question, startDate, endDate, references) {
  const referencesSection = references && references.trim()
    ? `\nReference Links:\n${references.trim()}\n`
    : '';
  return `Draft a prediction market proposal based on user inputs. Write a clear, unambiguous Resolution Rules and provide links to all sources. The market must be objectively resolvable with sources that can be easily publicly verified. Come up with a complete set of mutually-exclusive outcomes and their resolution criteria. Cover all possible edge cases.

User's Question: "${question}"
Start Date: ${startDate}
End Date: ${endDate}${referencesSection}

Provide a comprehensive draft that includes:
1. A refined, unambiguous version of the question
2. Detailed resolution criteria
3. All possible edge cases and how they should be handled
4. Potential sources for resolution
5. Any assumptions that need to be made explicit`;
}

export function buildReviewPrompt(draftContent) {
  return `Review this draft for a prediction market. Challenge the resolution rules rigorously, identify potential areas of misinterpretations or incompleteness and suggest edits.

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

  return `You previously reviewed a prediction market draft. Below are critiques from other independent reviewers. Consider their reasoning: do you agree, disagree, or have additional concerns? Provide your updated review incorporating any valid points from other reviewers that you missed.

ORIGINAL DRAFT:
${draftContent}

OTHER REVIEWERS' CRITIQUES:
${reviewsText}

Provide your consolidated review, noting:
1. Points of agreement across reviewers
2. Points of disagreement and your position
3. Any new issues raised that are valid
4. Your final prioritized list of recommended changes`;
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

  return `This is a critical review of the draft. Review and first determine if the critiques make logical sense. Incorporate the suggestions or criticisms from the Reviewer that are correct and generate a new draft.

IMPORTANT: When human reviewer feedback is provided, treat it with higher priority than the AI-generated critical review. Weight human feedback approximately 25% more heavily — if the human's suggestions conflict with or differ from the AI review, lean toward the human's perspective. The human reviewer has domain-specific context and intent that should take precedence.

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
  return `Based on the following draft, generate the final prediction market details in a structured JSON format.

IMPORTANT — CONCISENESS RULES:
- Cut all output text by at least 50% compared to the draft. Be terse and direct.
- Use fragments and short declarative sentences. No filler, hedging, qualifiers, or redundant phrasing.
- Do NOT repeat information across fields — each field must contain unique content only.
- winCondition: max 1 sentence stating WHAT must be true. resolutionCriteria: max 1 sentence stating HOW it is verified (source, method, threshold). Zero overlap between them.
- shortDescription: max 15 words.
- fullResolutionRules: compact numbered list, max 1 line per rule. No prose.
- edgeCases: compact numbered list, format "scenario → resolution", max 1 line each.

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
      "name": "Outcome name",
      "winCondition": "One sentence: what must be true for this outcome to win",
      "resolutionCriteria": "Verification method and source — no overlap with winCondition"
    }
  ],
  "marketStartTimeUTC": "YYYY-MM-DDTHH:MM:SSZ format based on start date",
  "marketEndTimeUTC": "YYYY-MM-DDTHH:MM:SSZ format based on end date",
  "shortDescription": "One sentence market description",
  "fullResolutionRules": "Compact numbered rules — no redundancy with outcome-level criteria",
  "edgeCases": "Numbered list: scenario → resolution"
}`;
}

export function buildIdeatePrompt(direction) {
  const trimmed = (direction || '').trim();
  const directionSection = trimmed
    ? `USER DIRECTION:\n${trimmed}`
    : 'USER DIRECTION:\n(no specific direction — surprise the user with broadly interesting ideas)';

  return `Generate a diverse set of prediction market ideas based on the vague direction below. Research the topic area using your own knowledge of current events, upcoming catalysts, and relevant trends. Brainstorm freely — it's fine to propose unexpected angles the user may not have considered.

${directionSection}

Produce 6–10 distinct market ideas. For each idea, provide:
1. **Title** — a concise, specific market question
2. **Why it's interesting** — 1 sentence on the tension, catalyst, or uncertainty that makes it bet-worthy
3. **Resolvability** — 1 sentence noting how it could be objectively resolved (key source or event)
4. **Suggested timeframe** — a rough end date or window

Guidelines:
- Prefer markets that are genuinely uncertain (not near-certain outcomes)
- Avoid duplicates — spread across subtopics, timeframes, and angles
- Keep each idea tight — no preamble, no filler
- Number the ideas 1., 2., 3., ...
- End with a brief 1–2 sentence note on themes or follow-up directions the user might explore`;
}

// Claim extractor — decomposes a draft into a flat list of atomic claims.
// Used by src/pipeline/extractClaims.js, which wraps this in zod validation
// and a retry loop. Emits stable ids of the form `claim.<category>.<index>`
// (or `.<subfield>`) so downstream verifiers can hang results off them.
export function buildClaimExtractorPrompt(draftContent) {
  return `Extract all atomic claims from the prediction market draft below.

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

  return `Review the prediction market draft below. Produce a single JSON object (no prose before or after) with exactly these fields:

{
  "reviewProse": "A paragraph-length critique of the draft in plain text. Flag ambiguities, missing edge cases, resolution risk, and concrete edits. This is shown to the human user verbatim.",
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
      "rationale": "One or two sentences stating the problem and the suggested fix."
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

  return `You are the judge for a rubric-based review of a prediction market draft. Below is each rubric item with the votes cast by independent reviewers.

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

  return `For each atomic claim below, decide whether the draft entails it, contradicts it, fails to cover it, or is not applicable.

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
  return `Review the prediction market draft below. Based on its outcomes and resolution rules, determine whether the market's outcome could become effectively certain *before* the stated End Date — a scenario that would strand collateral and require an explicit early-resolution clause.

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
