const ORIGINAL_REFERENCES_LABEL = 'Original ideation references:';

// Build the text that goes into Draft Market's References field when an
// idea's arrow button is clicked. This carries both the generated idea
// context and the source material that constrained the ideation prompt.
export function buildReferenceFromIdea(idea, ideationReferences = '') {
  const ideaContext = (idea?.rest || idea?.rawText || '').trim();
  const sourceContext = typeof ideationReferences === 'string' ? ideationReferences.trim() : '';
  if (!sourceContext) return ideaContext;
  if (!ideaContext) return sourceContext;
  return `${ideaContext}\n\n${ORIGINAL_REFERENCES_LABEL}\n${sourceContext}`;
}
