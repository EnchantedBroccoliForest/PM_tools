export const SYSTEM_PROMPTS = {
  drafter:
    'You are an expert at creating prediction market questions with clear, unambiguous resolution criteria. You help create well-defined markets that can be objectively resolved.',

  reviewer:
    'You are a critical reviewer specializing in prediction market design. You are a very well trained contract reviewer. Your job is to find flaws, ambiguities, and potential issues in market definitions, resolution rules, and the completeness of the outcome set.',

  finalizer:
    'You are an expert at creating prediction market questions. Extract and format the final market details from the draft into a structured format.',

  earlyResolutionAnalyst:
    'You are an expert analyst specializing in prediction markets. You evaluate whether a market could resolve early — that is, whether its outcome could become effectively certain before the stated end date.',
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
  return `Based on the following draft, generate the final and condensed prediction market details in a structured JSON format.

DRAFT:
${draftContent}

USER PROVIDED DATES:
Start Date: ${startDate}
End Date: ${endDate}

Generate a JSON response with exactly these fields:
{
  "refinedQuestion": "The refined, unambiguous version of the market question",
  "outcomes": [
    {
      "name": "Outcome name",
      "resolutionCriteria": "Specific criteria for this outcome"
    }
  ],
  "marketStartTimeUTC": "YYYY-MM-DDTHH:MM:SSZ format based on start date",
  "marketEndTimeUTC": "YYYY-MM-DDTHH:MM:SSZ format based on end date",
  "shortDescription": "A brief 1-2 sentence market description",
  "fullResolutionRules": "Complete resolution rules",
  "edgeCases": "All edge cases and how they will be handled"
}`;
}

export function buildEarlyResolutionPrompt(finalContent) {
  const outcomes = finalContent.outcomes
    ?.map((o, i) => `  ${i + 1}. ${o.name}: ${o.resolutionCriteria}`)
    .join('\n') || 'N/A';

  return `Review the market details below. Based on the list of outcomes and the resolution rules, identify if there is a possibility that this market's outcome becomes certain prior to the stated End Date.

MARKET QUESTION:
${finalContent.refinedQuestion || 'N/A'}

OUTCOMES:
${outcomes}

RESOLUTION RULES:
${finalContent.fullResolutionRules || 'N/A'}

MARKET END DATE: ${finalContent.marketEndTimeUTC || 'N/A'}

Analyze:
1. Could any outcome become effectively certain (>99% likelihood) before the end date?
2. What specific events or scenarios could cause early certainty?
3. Rate the overall early resolution risk: Low / Medium / High
4. If applicable, recommend mitigations (e.g., adjusted end date, additional edge-case rules).`;
}
