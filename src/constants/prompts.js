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

export function buildUpdatePrompt(draftContent, reviewContent, humanReviewInput) {
  return `This is a critical review of the draft. Review and first determine if the critiques make logical sense. Incorporate the suggestions or criticisms from the Reviewer that are correct and generate a new draft.

IMPORTANT: When human reviewer feedback is provided, treat it with higher priority than the AI-generated critical review. Weight human feedback approximately 25% more heavily — if the human's suggestions conflict with or differ from the AI review, lean toward the human's perspective. The human reviewer has domain-specific context and intent that should take precedence.

ORIGINAL DRAFT:
${draftContent}

CRITICAL REVIEW:
${reviewContent}${humanReviewInput.trim() ? `

HUMAN REVIEWER FEEDBACK (HIGH PRIORITY — weight 25% more than AI review):
${humanReviewInput}` : ''}`;
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

export function buildEarlyResolutionPrompt(finalContent) {
  const outcomes = finalContent.outcomes
    ?.map((o, i) => `  ${i + 1}. ${o.name}${o.winCondition ? `\n     Wins if: ${o.winCondition}` : ''}\n     Resolution Criteria: ${o.resolutionCriteria}`)
    .join('\n') || 'N/A';

  return `Review the market details below. Based on the list of outcomes and the resolution rules, identify if there is a possibility that this market's outcome becomes certain prior to the stated End Date.

MARKET QUESTION:
${finalContent.refinedQuestion || 'N/A'}

OUTCOMES:
${outcomes}

RESOLUTION RULES:
${finalContent.fullResolutionRules || 'N/A'}

MARKET END DATE: ${finalContent.marketEndTimeUTC || 'N/A'}

Respond concisely (max 4-6 sentences total). State:
1. Risk rating: Low / Medium / High
2. Key scenarios (if any) that could cause early certainty
Keep it brief — no preamble, no restating the question.`;
}
