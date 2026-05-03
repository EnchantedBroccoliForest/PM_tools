import { useRef, useEffect } from 'react';
import './App.css';
import './ambient-modes.css';
import { getModelName, getModelAbbrev } from './constants/models';
import { useModels } from './hooks/useModels';
import LLMLoadingState from './components/LLMLoadingState';
import ErrorMessage from './components/ErrorMessage';
import Enter from './components/Enter';
import Presence from './components/Presence';
import {
  getSystemPrompt,
  buildDraftPrompt,
  buildDeliberationPrompt,
  buildUpdatePrompt,
  buildRoutingFocusBlock,
  buildFinalizePrompt,
  buildEarlyResolutionPrompt,
  buildIdeatePrompt,
} from './constants/prompts';
import { queryModel } from './api/openrouter';
import { extractClaims } from './pipeline/extractClaims';
import { runStructuredReviewsParallel } from './pipeline/structuredReview';
import { aggregate } from './pipeline/aggregate';
import { verifyClaims } from './pipeline/verify';
import { gatherEvidence } from './pipeline/gatherEvidence';
import { routeClaims, groupRoutingBySeverity } from './pipeline/route';
import { checkResolutionSources } from './pipeline/checkSources';
import { humanizeFinalJson } from './pipeline/humanize';
import { repairMarketQuestionTitle } from './pipeline/marketQuestionTitle';
import { RIGOR_RUBRIC, AGGREGATION_PROTOCOLS, RUBRIC_BY_ID } from './constants/rubric';
import { parseRun, GLOBAL_CLAIM_ID } from './types/run';
import { DRAFT_MAX_TOKENS } from './defaults';
import { parseRiskLevel } from './util/riskLevel';
import {
  normalizeUtcDateTime,
  toDateInputValue,
  validateDatePair,
  validateDraftInputs,
} from './util/draftInput';
import { buildResolutionDescriptionMarkdown } from './util/resolutionDescription';
import { buildMarketCard, formatMarketCardCopy } from './util/marketCard';
import { formatFullSpecCopy } from './util/finalCopy';
import { isSafeExternalUrl, splitExternalUrlToken } from './util/externalUrl';
import { useMarketReducer } from './hooks/useMarketReducer';
import { useAmbientMode } from './hooks/useAmbientMode';
import ModelSelect from './components/ModelSelect';
import AmbientModeToggle from './components/AmbientModeToggle';
import LanguageToggle from './components/LanguageToggle';
import { useLanguage } from './hooks/useLanguage';

/** Lightweight markdown-ish rendering: **bold**, bullet lists, numbered lists */
function renderContent(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Markdown divider
    if (/^\s*---+\s*$/.test(line)) {
      elements.push(<hr key={i} className="md-divider" />);
      i++;
      continue;
    }

    // Heading lines (### or ##)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const Tag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5';
      elements.push(<Tag key={i} className="md-heading">{formatInline(headingMatch[2])}</Tag>);
      i++;
      continue;
    }

    // Bullet or numbered list items
    if (/^[\s]*[-*]\s/.test(line) || /^[\s]*\d+\.\s/.test(line)) {
      const listItems = [];
      const isOrdered = /^[\s]*\d+\.\s/.test(line);
      while (i < lines.length && (/^[\s]*[-*]\s/.test(lines[i]) || /^[\s]*\d+\.\s/.test(lines[i]))) {
        const content = lines[i].replace(/^[\s]*[-*]\s/, '').replace(/^[\s]*\d+\.\s/, '');
        listItems.push(<li key={i}>{formatInline(content)}</li>);
        i++;
      }
      const ListTag = isOrdered ? 'ol' : 'ul';
      elements.push(<ListTag key={`list-${i}`} className="md-list">{listItems}</ListTag>);
      continue;
    }

    // Empty line = spacing
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(<p key={i} className="md-paragraph">{formatInline(line)}</p>);
    i++;
  }

  return elements;
}

function formatRelativeTime(timestamp, t) {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 10) return t('common.justNow');
  if (seconds < 60) return t('common.secondsAgo', { n: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('common.minutesAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  return t('common.hoursAgo', { n: hours });
}

function formatInline(text) {
  const elements = [];
  const tokenPattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|_[^_]+_|https?:\/\/[^\s<>"'\])]+)/g;
  let lastIndex = 0;
  let match;

  while ((match = tokenPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${match.index}-${token}`;
    if (token.startsWith('**') && token.endsWith('**')) {
      elements.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('_') && token.endsWith('_')) {
      const previousChar = match.index > 0 ? text[match.index - 1] : '';
      const nextChar = text[match.index + token.length] || '';
      if (/\w/.test(previousChar) || /\w/.test(nextChar)) {
        elements.push(token);
      } else {
        elements.push(<em key={key}>{token.slice(1, -1)}</em>);
      }
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (linkMatch) {
        elements.push(renderExternalLink(linkMatch[2], linkMatch[1], key, 'md-link') || token);
      } else {
        const { href, suffix } = splitExternalUrlToken(token);
        const link = renderExternalLink(href, href, key, 'md-link');
        if (link) {
          elements.push(link);
          if (suffix) elements.push(suffix);
        } else {
          elements.push(token);
        }
      }
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements;
}

function renderExternalLink(href, label, key, className) {
  if (!isSafeExternalUrl(href)) return null;
  return (
    <a
      key={key}
      className={className}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      {label}
    </a>
  );
}

function SourceUrlLink({ url }) {
  const link = renderExternalLink(
    url,
    <code>{url}</code>,
    url,
    'risk-gate__source-link'
  );
  return link || <code>{url}</code>;
}

// Parse the Ideate stage output into discrete ideas. The prompt asks the
// model to number ideas `1.`, `2.`, ... and include a `**Title**` field for
// each, so we split on top-level numbered starts and best-effort extract the
// title from each block. The trailing "themes / follow-up" note (if any) is
// captured as a postamble so it isn't absorbed into the last idea.
function parseIdeateContent(rawText, t) {
  if (!rawText || typeof rawText !== 'string') {
    return { preamble: '', ideas: [], postamble: '' };
  }
  const lines = rawText.split('\n');
  const preambleLines = [];
  const ideas = [];
  let current = null;

  for (const line of lines) {
    const startMatch = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (startMatch) {
      if (current) ideas.push(current);
      current = { number: Number(startMatch[1]), lines: [line] };
      continue;
    }
    if (current) {
      current.lines.push(line);
    } else {
      preambleLines.push(line);
    }
  }
  if (current) ideas.push(current);

  // Detach a trailing "themes / follow-up" paragraph from the last idea if
  // it looks like a standalone note (separated by a blank line, not indented,
  // and not one of the known Idea sub-fields). This keeps the button
  // association clean when the LLM ends with a summary sentence.
  let postamble = '';
  if (ideas.length > 0) {
    const last = ideas[ideas.length - 1];
    let splitAt = -1;
    for (let i = last.lines.length - 1; i > 0; i--) {
      const prev = last.lines[i - 1];
      const curr = last.lines[i];
      const isBlank = prev.trim() === '';
      const isTopLevelProse =
        curr.trim() !== '' &&
        !/^\s/.test(curr) &&
        !/^\s*[-*]\s/.test(curr) &&
        !/\*\*(Title|Outcome Set|Why|Resolvability|Suggested timeframe)/i.test(curr);
      if (isBlank && isTopLevelProse) {
        splitAt = i;
        break;
      }
    }
    if (splitAt > 0) {
      const tail = last.lines.slice(splitAt);
      last.lines = last.lines.slice(0, splitAt);
      postamble = tail.join('\n').trim();
    }
  }

  const parsedIdeas = ideas.map((idea) => {
    const rawText = idea.lines.join('\n');
    const { title, rest } = extractIdeaTitleAndRest(rawText, idea.number, t);
    return {
      number: idea.number,
      rawText,
      title,
      rest,
    };
  });

  return {
    preamble: preambleLines.join('\n').trim(),
    ideas: parsedIdeas,
    postamble,
  };
}

// Extract a clean title string and the "rest" of the idea body (everything
// except the title line), for populating Draft Market's Reference field.
function extractIdeaTitleAndRest(ideaText, number, t) {
  const lines = ideaText.split('\n');

  // Strategy 1: find an explicit "**Title**" label anywhere in the idea.
  let titleLineIdx = -1;
  let title = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/\*\*\s*Title\s*\*\*\s*[—:-]*\s*(.+)$/i);
    if (m) {
      titleLineIdx = i;
      title = m[1];
      break;
    }
  }

  // Strategy 2: fall back to the first line after the "N." prefix.
  if (titleLineIdx === -1 && lines.length > 0) {
    const firstLineMatch = lines[0].match(/^\s*\d+[.)]\s+(.+)$/);
    if (firstLineMatch) {
      titleLineIdx = 0;
      title = firstLineMatch[1];
    }
  }

  // Clean up the title: strip markdown bold, leading label prefixes, and
  // surrounding quotes.
  title = (title || '')
    .replace(/\*\*/g, '')
    .replace(/^\s*Title\s*[:—-]\s*/i, '')
    .replace(/^["'`\u201C\u2018]+|["'`\u201D\u2019]+$/g, '')
    .trim();

  // Build the "rest" by removing just the title line (or the title segment
  // from the first line if the title came from strategy 2).
  let rest;
  if (titleLineIdx === 0) {
    // The title was on the first line, possibly preceded by "N.".
    // Drop the whole first line so we don't duplicate the title in the
    // Reference field.
    rest = lines.slice(1).join('\n');
  } else if (titleLineIdx > 0) {
    // Preserve everything except the dedicated title line.
    rest = [...lines.slice(0, titleLineIdx), ...lines.slice(titleLineIdx + 1)]
      .join('\n');
  } else {
    // Could not find a title at all — keep the body as-is (minus the
    // leading number so it reads cleanly).
    rest = ideaText.replace(/^\s*\d+[.)]\s*/, '');
  }

  return { title: title || t('ideas.fallbackTitle', { n: number }), rest: rest.trim() };
}

// Build the text that goes into the Draft Market "References" field when an
// idea's arrow button is clicked. Includes the idea's context (Outcome Set,
// Why it's interesting, Resolvability, Suggested timeframe) so the drafting
// model has the same framing the ideator used.
function buildReferenceFromIdea(idea) {
  return (idea.rest || idea.rawText || '').trim();
}

function buildReviewConfig(reviewModels, aggregationProtocol) {
  return {
    reviewModels: [...(reviewModels || [])],
    aggregationProtocol,
  };
}

function reviewConfigsEqual(a, b) {
  if (!a || !b) return false;
  if (a.aggregationProtocol !== b.aggregationProtocol) return false;
  const aModels = a.reviewModels || [];
  const bModels = b.reviewModels || [];
  if (aModels.length !== bModels.length) return false;
  return aModels.every((model, index) => model === bModels[index]);
}

function toSimpleRoutingReason(reason, t) {
  if (!reason) return '';
  if (reason === 'verification hard_fail') return t('routingReason.verificationHard');
  if (reason === 'verification soft_fail') return t('routingReason.verificationSoft');
  if (reason === 'draft contradicts claim') return t('routingReason.draftContradicts');
  if (reason === 'not covered by draft') return t('routingReason.notCovered');
  if (reason === 'cited URL did not resolve') return t('routingReason.urlUnreachable');
  if (reason === 'run has a global blocker criticism') return t('routingReason.globalBlocker');
  const blockerMatch = reason.match(/^(\d+)\s+blocker criticism\(s\)$/);
  if (blockerMatch) {
    const n = blockerMatch[1];
    return t(n === '1' ? 'routingReason.blockerCount' : 'routingReason.blockerCountPlural', { n });
  }
  const majorMatch = reason.match(/^(\d+)\s+major criticism\(s\)$/);
  if (majorMatch) {
    const n = majorMatch[1];
    return t(n === '1' ? 'routingReason.majorCount' : 'routingReason.majorCountPlural', { n });
  }
  return reason;
}

function humanReadableClaimCategory(claimId, t) {
  if (!claimId) return '';
  if (claimId.startsWith('claim.source')) return t('claimCategory.resolutionSource');
  if (claimId.startsWith('claim.threshold')) return t('claimCategory.resolutionRule');
  if (claimId.startsWith('claim.mece')) return t('claimCategory.outcomeCoverage');
  if (claimId.startsWith('claim.edge')) return t('claimCategory.edgeCase');
  if (claimId.startsWith('claim.timing')) return t('claimCategory.timing');
  if (claimId.startsWith('claim.oracle')) return t('claimCategory.oracle');
  return t('claimCategory.claim');
}

function getSimpleBlockReasons(currentRun, t) {
  const reasons = new Set();
  const routingItems = currentRun?.routing?.items || [];
  for (const item of routingItems) {
    if (item.severity !== 'blocking') continue;
    for (const reason of item.reasons || []) {
      reasons.add(toSimpleRoutingReason(reason, t));
    }
  }

  if ((currentRun?.criticisms || []).some((c) => c.claimId === GLOBAL_CLAIM_ID && c.severity === 'blocker')) {
    reasons.add(t('routingReason.runBlocker'));
  }
  return Array.from(reasons);
}

function App() {
  const [state, dispatch] = useMarketReducer();
  const { mode: ambientMode, setMode: setAmbientMode, config: ambientConfig } = useAmbientMode();
  const { t } = useLanguage();
  // Kicks off the initial OpenRouter model fetch + periodic refresh and
  // re-renders the app when the model list changes, so getModelName/abbrev
  // reflect the freshly fetched list.
  useModels();
  const panel2Ref = useRef(null);
  const panel3Ref = useRef(null);
  const draftOutputRef = useRef(null);
  // Phase 5: a mirror of `currentRun` kept in a ref so async handlers that
  // fire successive dispatches (claim extract → verify → evidence → route)
  // can read the latest criticism/claim set synchronously without waiting
  // for React to re-render. Updated via useEffect below.
  const currentRunRef = useRef(null);

  const {
    mode,
    question,
    startDate,
    endDate,
    references,
    numberOfOutcomes,
    rigor,
    selectedModel,
    reviewModels,
    aggregationProtocol,
    humanReviewInput,
    pastedDraft,
    ideatingInput,
    ideatingModel,
    ideatingContent,
    loading,
    loadingMeta,
    error,
    dateError,
    touchedFields,
    draftContent,
    draftVersions,
    viewingVersionIndex,
    draftJustUpdated,
    reviews,
    deliberatedReview,
    lastReviewConfig,
    finalContent,
    hasUpdated,
    earlyResolutionRisk,
    earlyResolutionRiskLevel,
    earlyResolutionAcknowledged,
    routingAcknowledged,
    sourceAccessibility,
    sourceAccessibilityAcknowledged,
    currentRun,
    runTraceOpen,
    copiedId,
  } = state;

  const latestVersionIndex = draftVersions.length - 1;
  const displayedVersion = draftVersions[viewingVersionIndex];
  const displayedDraftContent = displayedVersion ? displayedVersion.content : draftContent;
  const isViewingLatest = viewingVersionIndex === latestVersionIndex;

  // Phase 3: rigor for display surfaces (loading-state chip, finalized
  // footer). Reads from the Run snapshot so an in-flight run keeps showing
  // its frozen rigor even if the user starts a new draft from a different
  // toggle position; falls back to live state for the pre-RUN_START case.
  const displayRigor = currentRun?.input?.rigor ?? rigor;
  const resolutionDescriptionMarkdown = finalContent && !finalContent.raw
    ? buildResolutionDescriptionMarkdown(finalContent)
    : '';

  // Human Mode shows a compact "market card" first instead of the full
  // resolver-style spec. Machine Mode keeps the existing detailed layout.
  const isHumanFinal = displayRigor === 'human' && finalContent && !finalContent.raw;
  const finalMarketCard = isHumanFinal
    ? buildMarketCard(finalContent, {
        riskLevel: earlyResolutionRiskLevel,
        riskText: earlyResolutionRisk,
      })
    : null;

  // Phase 0 gate: Accept & Finalize is blocked when the early-resolution
  // analyst has flagged the updated draft as HIGH risk and the user has not
  // yet acknowledged it. Low / Medium / Unknown do not block.
  const needsRiskAck =
    earlyResolutionRiskLevel === 'high' && !earlyResolutionAcknowledged;

  // Phase 5: the routing gate is independent of the early-resolution gate.
  // Any claim flagged 'blocking' (or a global blocker criticism, which
  // the router encodes as overall === 'blocked') prevents Accept until
  // the user explicitly acknowledges. A `needs_update` overall does NOT
  // block — it's surfaced as a warning in the Run trace panel only.
  const routingOverall = currentRun?.routing?.overall || 'clean';
  const needsRoutingAck = routingOverall === 'blocked' && !routingAcknowledged;

  // Pre-finalize source-accessibility gate. Runs after early-resolution in
  // handleUpdate. Any confirmed-unreachable source URL blocks Accept until
  // the user either re-runs Update with better sources or explicitly
  // acknowledges. Gate statuses:
  //   - 'ok' / 'no_sources' / 'error' / null → do not block
  //   - 'some_unreachable' / 'all_unreachable' → block until ack
  const sourceAccessStatus = sourceAccessibility?.status || null;
  const sourceAccessHasUnreachable =
    sourceAccessStatus === 'some_unreachable' || sourceAccessStatus === 'all_unreachable';
  const needsSourceAck = sourceAccessHasUnreachable && !sourceAccessibilityAcknowledged;

  const currentStep = finalContent ? 3 : draftContent ? 2 : 1;
  const anyLoading = loading !== null;
  const progressPercent = finalContent ? 100 : hasUpdated ? 75 : reviews.length > 0 ? 50 : draftContent ? 33 : 0;
  const currentReviewConfig = buildReviewConfig(reviewModels, aggregationProtocol);
  const hasReviews = reviews.length > 0;
  const reviewConfigChanged =
    hasReviews && !reviewConfigsEqual(currentReviewConfig, lastReviewConfig);
  const reviewAlreadyCurrent = hasReviews && !reviewConfigChanged;
  const updateDraftReady = hasReviews && !reviewConfigChanged;
  const baseReviewActionLabel = reviewModels.length > 1
    ? t('toolbar.reviewAndDeliberate')
    : t('toolbar.review');
  const reviewActionLabel = reviewConfigChanged
    ? t('toolbar.rerun', { action: baseReviewActionLabel })
    : baseReviewActionLabel;
  const reviewLoadingLabel = reviewModels.length > 1
    ? t('toolbar.deliberating')
    : t('toolbar.reviewing');
  const draftValidation = validateDraftInputs({ question, startDate, endDate });
  const draftFieldErrors = draftValidation.errors;
  // Returns the validation error code for `field` (or null). Render-side
  // code looks up `t(code)` to get the localized message; the boolean form
  // is for class/attribute toggles that only need to know "is there one?".
  const visibleFieldErrorCode = (field) =>
    touchedFields?.[field] ? draftFieldErrors[field] : null;
  const visibleFieldError = (field) => {
    const code = visibleFieldErrorCode(field);
    return code ? t(code) : null;
  };
  const inputClassName = (field) =>
    visibleFieldErrorCode(field) ? 'input input--error' : 'input';

  // Auto-scroll to active panel on mobile
  useEffect(() => {
    if (currentStep === 2 && panel2Ref.current) {
      panel2Ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (currentStep === 3 && panel3Ref.current) {
      panel3Ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentStep]);

  // After an update, scroll the refreshed draft into view and clear the flash flag
  useEffect(() => {
    if (!draftJustUpdated) return;
    if (draftOutputRef.current) {
      draftOutputRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const timer = setTimeout(() => dispatch({ type: 'CLEAR_DRAFT_JUST_UPDATED' }), 1800);
    return () => clearTimeout(timer);
  }, [draftJustUpdated, dispatch]);

  // Keep the ref mirror of `currentRun` up to date so async pipelines can
  // read the latest criticism/claim set without closing over stale state.
  useEffect(() => {
    currentRunRef.current = currentRun;
  }, [currentRun]);

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      dispatch({ type: 'SET_COPIED', id });
      setTimeout(() => dispatch({ type: 'SET_COPIED', id: null }), 2000);
    }).catch(() => {
      dispatch({ type: 'SET_ERROR', error: t('error.copy') });
    });
  };

  const formatUTCDateHint = (dateString, fallbackTime) => {
    const normalized = normalizeUtcDateTime(dateString, fallbackTime);
    if (!normalized) return null;
    return normalized.replace('T', ' ').replace('Z', ' UTC');
  };

  const handleDismissError = () => dispatch({ type: 'SET_ERROR', error: null });

  const handleDateChange = (field, value) => {
    const newStart = field === 'startDate' ? value : startDate;
    const newEnd = field === 'endDate' ? value : endDate;
    dispatch({ type: 'SET_DATE', field, value, dateError: validateDatePair(newStart, newEnd) });
  };

  // Small helper: dispatch a RUN_COST entry for a single LLM call result.
  // Accepts the `{usage, wallClockMs}` subset returned by queryModel.
  const recordCost = (stage, result) => {
    if (!result || !result.usage) return;
    dispatch({
      type: 'RUN_COST',
      stage,
      tokensIn: result.usage.promptTokens,
      tokensOut: result.usage.completionTokens,
      wallClockMs: result.wallClockMs || 0,
    });
  };

  // Kick off claim extraction in the background for a draft and fold the
  // result (and any log entries) into the current run. Never throws.
  //
  // Phase 3: chains into verification automatically. Verification needs
  // both the freshly extracted claims and the draft text, so piggybacking
  // on extraction keeps the two in sync — every time claims change,
  // verifications are refreshed against the same draft snapshot.
  const runClaimExtractorAndRecord = async (draftText) => {
    const result = await extractClaims(selectedModel, draftText);
    dispatch({
      type: 'RUN_COST',
      stage: 'claims',
      tokensIn: result.usage.promptTokens,
      tokensOut: result.usage.completionTokens,
      wallClockMs: result.wallClockMs,
    });
    dispatch({ type: 'RUN_SET_CLAIMS', claims: result.claims });
    if (result.logEntry) {
      dispatch({
        type: 'RUN_LOG',
        stage: 'claims',
        level: result.logEntry.level,
        message: result.logEntry.message,
      });
    }

    // Chain into verification. If extraction returned no claims (either
    // because the draft is empty or because the extractor failed twice)
    // the verifier logs a skip and returns immediately.
    if (result.claims.length > 0) {
      const vResult = await verifyClaims(result.claims, draftText, selectedModel);
      recordCost('verify', vResult);
      dispatch({
        type: 'RUN_SET_VERIFICATION',
        verification: vResult.verifications,
      });
      if (vResult.logEntry) {
        dispatch({
          type: 'RUN_LOG',
          stage: 'verify',
          level: vResult.logEntry.level,
          message: vResult.logEntry.message,
        });
      }

      // Phase 4: evidence gathering. Harvest URLs from the references
      // block and source claims, resolve them in parallel via no-cors
      // fetch, and fold the resolve results back into the verification
      // list. This can only downgrade a source-claim verdict from pass
      // to soft_fail when all URLs fail; it never upgrades an existing
      // hard_fail. The evidence record itself (ids, claim linkage, URLs)
      // is written to currentRun.evidence unconditionally so the Run
      // trace panel can show the harvested citations.
      const eResult = await gatherEvidence({
        references,
        claims: result.claims,
        verifications: vResult.verifications,
      });
      dispatch({
        type: 'RUN_COST',
        stage: 'evidence',
        tokensIn: 0,
        tokensOut: 0,
        wallClockMs: eResult.wallClockMs,
      });
      dispatch({ type: 'RUN_SET_EVIDENCE', evidence: eResult.evidence });
      // Re-dispatch verifications with the citation-resolve overrides
      // applied. We always overwrite here, even if nothing changed, so
      // that exporting immediately after gatherEvidence returns reflects
      // the latest state without a race against a stale setState.
      dispatch({
        type: 'RUN_SET_VERIFICATION',
        verification: eResult.updatedVerifications,
      });
      if (eResult.logEntry) {
        dispatch({
          type: 'RUN_LOG',
          stage: 'evidence',
          level: eResult.logEntry.level,
          message: eResult.logEntry.message,
        });
      }

      // Phase 5: uncertainty-based routing. Pure sync computation over
      // the claim set, the post-evidence verification list, and whatever
      // criticisms the review pass has already accumulated (read from
      // currentRunRef so we pick up criticisms dispatched earlier in
      // this same handler without waiting for a re-render). Produces a
      // per-claim severity + a run-level overall the Accept gate reads.
      const latestCriticisms = currentRunRef.current?.criticisms || [];
      const routing = routeClaims({
        claims: result.claims,
        verifications: eResult.updatedVerifications,
        criticisms: latestCriticisms,
        evidence: eResult.evidence,
      });
      dispatch({ type: 'RUN_SET_ROUTING', routing });
      dispatch({
        type: 'RUN_LOG',
        stage: 'route',
        level: routing.overall === 'blocked' ? 'error' : routing.overall === 'needs_update' ? 'warn' : 'info',
        message:
          `Routing: overall=${routing.overall}, ` +
          `${routing.items.filter((i) => i.severity === 'blocking').length} blocking, ` +
          `${routing.items.filter((i) => i.severity === 'targeted_review').length} targeted, ` +
          `${routing.items.filter((i) => i.severity === 'ok').length} ok.`,
      });
    }
  };

  // --- Stage 1: Draft (single model) ---
  const handleDraft = async () => {
    const validation = validateDraftInputs({ question, startDate, endDate });
    if (!validation.isValid) {
      dispatch({ type: 'TOUCH_DRAFT_REQUIRED_FIELDS' });
      dispatch({
        type: 'SET_DATE_ERROR',
        dateError: validation.errors.startDate || validation.errors.endDate || null,
      });
      return;
    }

    const startDateUTC = validation.startDateUTC;
    const endDateUTC = validation.endDateUTC;

    dispatch({ type: 'START_LOADING', phase: 'draft', models: [getModelName(selectedModel)] });
    // Start a fresh Run artifact; previous run (if any) is discarded. Note
    // that `rigor` here is the live reducer field (the user's current
    // selection), and including it in RUN_START is what freezes it onto
    // run.input.rigor so every later stage reads the snapshot via
    // currentRunRef.current?.input?.rigor — see handleReview for that read.
    dispatch({
      type: 'RUN_START',
      input: { question, startDate: startDateUTC, endDate: endDateUTC, references, numberOfOutcomes, rigor },
    });
    try {
      const result = await queryModel(selectedModel, [
        { role: 'system', content: getSystemPrompt('drafter', rigor) },
        { role: 'user', content: buildDraftPrompt(question, startDateUTC, endDateUTC, references, numberOfOutcomes, rigor) },
      ], { maxTokens: DRAFT_MAX_TOKENS });
      dispatch({ type: 'DRAFT_SUCCESS', content: result.content });
      recordCost('draft', result);
      dispatch({
        type: 'RUN_APPEND_DRAFT',
        model: selectedModel,
        content: result.content,
        kind: 'initial',
      });
      // Claim extraction runs in the background so the UI isn't blocked
      // on a second LLM round-trip; failures are logged, not thrown.
      runClaimExtractorAndRecord(result.content).catch((bgErr) => {
        dispatch({
          type: 'RUN_LOG',
          stage: 'claims',
          level: 'error',
          message: t('log.claimExtractionCrashed', { message: bgErr?.message || bgErr }),
        });
      });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || t('error.draft') });
      dispatch({ type: 'RUN_LOG', stage: 'draft', level: 'error', message: err.message || t('log.draftFailed') });
    }
  };

  // --- Stage 2: Structured multi-reviewer review + aggregation (Phase 2) ---
  //
  // Each selected review model runs the structured review prompt in parallel.
  // Each reviewer produces, in one JSON response:
  //   - reviewProse:  the paragraph-length critique shown in the existing
  //                   Panel 2 UI (so human-facing behaviour is unchanged)
  //   - rubricVotes:  one verdict per rubric item, feeding the aggregator
  //   - criticisms:   real Criticism records, replacing Phase 1's synthetic
  //                   global-criticism projection
  //
  // After all reviewers return, we roll their votes up via the currently
  // selected aggregation protocol (majority / unanimity / judge). The judge
  // protocol is the only one that makes an extra LLM call; the others are
  // pure-client. A deliberation pass is still run when we have multiple
  // successful reviews so the existing "deliberated review" UI keeps
  // working — the chairman is no longer the aggregator of record, only a
  // human-readable synthesis.
  const handleReview = async () => {
    if (!draftContent) return;
    dispatch({ type: 'START_LOADING', phase: 'review', models: reviewModels.map((id) => getModelName(id)) });

    // Read rigor off the Run snapshot so a mid-flow toggle (which the UI
    // also disables) can never leak into a stage that has already started.
    // Fall back to live state for safety; the toggle is locked while a
    // draft exists, so the two should agree.
    const runRigor = currentRunRef.current?.input?.rigor ?? rigor;

    try {
      const reviewerModels = reviewModels.map((id) => ({
        id,
        name: getModelName(id),
      }));

      // Structured reviews in parallel. Individual failures are surfaced
      // inside each result (logEntry + null prose) rather than rejecting.
      const structuredResults = await runStructuredReviewsParallel(
        reviewerModels,
        draftContent,
        RIGOR_RUBRIC,
        numberOfOutcomes,
        runRigor,
      );

      // Per-reviewer cost + log accounting.
      for (const r of structuredResults) {
        if (r.usage) {
          recordCost('review', { usage: r.usage, wallClockMs: r.wallClockMs || 0 });
        }
        if (r.logEntry) {
          dispatch({
            type: 'RUN_LOG',
            stage: 'review',
            level: r.logEntry.level,
            message: r.logEntry.message,
          });
        }
      }

      const successful = structuredResults.filter((r) => r.reviewProse !== null);
      if (successful.length === 0) {
        throw new Error(t('error.allReviewersFailed'));
      }

      // Shape successful structured reviews into the legacy `reviews[]`
      // record the Panel 2 UI reads. This is the compatibility shim that
      // lets Phase 2 ship without touching the review rendering code.
      const legacyReviews = successful.map((r) => ({
        model: r.model,
        modelName: r.modelName,
        content: r.reviewProse,
      }));

      // Human-readable deliberation — no longer the canonical aggregator,
      // but still useful to the user as a consolidated read. Only runs
      // when we have 2+ reviewers.
      let deliberatedReview = null;
      if (legacyReviews.length > 1) {
        const deliberationPrompt = buildDeliberationPrompt(draftContent, legacyReviews, numberOfOutcomes, runRigor);
        const delibResult = await queryModel(legacyReviews[0].model, [
          { role: 'system', content: getSystemPrompt('reviewer', runRigor) },
          { role: 'user', content: deliberationPrompt },
        ]);
        deliberatedReview = delibResult.content;
        recordCost('deliberation', delibResult);
      }

      dispatch({
        type: 'REVIEW_SUCCESS',
        reviews: legacyReviews,
        deliberatedReview,
        reviewConfig: buildReviewConfig(reviewModels, aggregationProtocol),
      });

      // Real Criticism records from every successful reviewer go into the
      // Run artifact. Phase 1's synthetic projection is gone.
      const allCriticisms = successful.flatMap((r) => r.criticisms);
      if (allCriticisms.length > 0) {
        dispatch({ type: 'RUN_APPEND_CRITICISMS', criticisms: allCriticisms });
      }

      // Collect every rubric vote from every reviewer, then run the
      // selected aggregation protocol.
      const allVotes = successful.flatMap((r) => r.rubricVotes);
      const judgeModelId = legacyReviews[0]?.model;
      const aggResult = await aggregate(
        aggregationProtocol,
        RIGOR_RUBRIC,
        allVotes,
        judgeModelId,
        runRigor,
      );

      if (aggResult.usage && aggResult.usage.totalTokens > 0) {
        recordCost('aggregation', {
          usage: aggResult.usage,
          wallClockMs: aggResult.wallClockMs || 0,
        });
      }
      if (aggResult.logEntry) {
        dispatch({
          type: 'RUN_LOG',
          stage: 'aggregation',
          level: aggResult.logEntry.level,
          message: aggResult.logEntry.message,
        });
      }

      dispatch({ type: 'RUN_SET_AGGREGATION', aggregation: aggResult.aggregation });

      // Phase 5: re-route claims now that criticisms have landed. The
      // pre-review routing (from runClaimExtractorAndRecord) was computed
      // off an empty criticism list; recomputing here lets blocker/major
      // criticisms promote a claim into 'blocking' or 'targeted_review'
      // so the Accept gate sees them immediately.
      //
      // Read claims/verification/evidence from the freshest ref, not a
      // pre-await snapshot — a background runClaimExtractorAndRecord
      // started by handleDraft/handleUpdate may have finished during the
      // aggregate() await above and published new verify/evidence state.
      // Union allCriticisms in explicitly because the RUN_APPEND_CRITICISMS
      // dispatched above may not have flushed through to the ref yet.
      const latestRun = currentRunRef.current;
      const combinedCriticisms = [...(latestRun?.criticisms || []), ...allCriticisms];
      const routing = routeClaims({
        claims: latestRun?.claims || [],
        verifications: latestRun?.verification || [],
        criticisms: combinedCriticisms,
        evidence: latestRun?.evidence || [],
      });
      dispatch({ type: 'RUN_SET_ROUTING', routing });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || t('error.review') });
      dispatch({ type: 'RUN_LOG', stage: 'review', level: 'error', message: err.message || t('log.reviewFailed') });
    }
  };

  // --- Stage 3: Update draft with review feedback, then gate on risk ---
  //
  // Phase 0: after a successful update, immediately chain into the
  // early-resolution analyst. The analyst's verdict gates Stage 4 — HIGH
  // risk blocks Accept until the user acknowledges. This is intentionally
  // pre-finalize (not post-finalize as in earlier iterations): if a draft is
  // going to leave collateral stranded, we want to catch that before the
  // user commits to a final JSON.
  const handleUpdate = async () => {
    if (!draftContent || reviews.length === 0) return;
    dispatch({ type: 'START_LOADING', phase: 'update', models: [getModelName(selectedModel)] });

    // See handleReview for the snapshotting rationale.
    const runRigor = currentRunRef.current?.input?.rigor ?? rigor;

    let updatedDraft;
    try {
      // Use the deliberated review if available, otherwise fall back to first review
      const reviewText = deliberatedReview || reviews[0].content;
      // Phase 5: feed the updater a pre-rendered focus block listing
      // every blocking / targeted_review claim from the current routing,
      // so the updater knows which specific claims to fix first. Falls
      // back to an empty string (unchanged behavior) if routing hasn't
      // run yet or there's nothing flagged.
      const focusBlock = buildRoutingFocusBlock(
        currentRunRef.current?.routing || null,
        currentRunRef.current?.claims || [],
      );
      const result = await queryModel(selectedModel, [
        { role: 'system', content: getSystemPrompt('drafter', runRigor) },
        { role: 'user', content: buildUpdatePrompt(displayedDraftContent, reviewText, humanReviewInput, focusBlock, numberOfOutcomes, references, runRigor) },
      ], { maxTokens: DRAFT_MAX_TOKENS });
      updatedDraft = result.content;
      dispatch({ type: 'UPDATE_SUCCESS', content: updatedDraft });
      recordCost('update', result);
      dispatch({
        type: 'RUN_APPEND_DRAFT',
        model: selectedModel,
        content: updatedDraft,
        kind: 'updated',
      });
      // Re-extract claims from the updated draft — the latest extraction
      // is always the canonical one for downstream verifiers.
      runClaimExtractorAndRecord(updatedDraft).catch((bgErr) => {
        dispatch({
          type: 'RUN_LOG',
          stage: 'claims',
          level: 'error',
          message: t('log.claimExtractionCrashed', { message: bgErr?.message || bgErr }),
        });
      });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || t('error.update') });
      dispatch({ type: 'RUN_LOG', stage: 'update', level: 'error', message: err.message || t('log.updateFailed') });
      return;
    }

    // Chain: early-resolution risk check on the updated draft.
    dispatch({ type: 'START_EARLY_RESOLUTION', models: [getModelName(selectedModel)] });
    try {
      const riskResult = await queryModel(selectedModel, [
        { role: 'system', content: getSystemPrompt('earlyResolutionAnalyst', runRigor) },
        {
          role: 'user',
          content: buildEarlyResolutionPrompt(
            updatedDraft,
            normalizeUtcDateTime(startDate, '00:00:00'),
            normalizeUtcDateTime(endDate, '23:59:59'),
            runRigor,
          ),
        },
      ]);
      recordCost('early_resolution', riskResult);
      dispatch({
        type: 'EARLY_RESOLUTION_SUCCESS',
        content: riskResult.content,
        level: parseRiskLevel(riskResult.content),
      });
    } catch (riskErr) {
      dispatch({
        type: 'EARLY_RESOLUTION_ERROR',
        error: riskErr.message || t('error.earlyResolution'),
      });
      dispatch({
        type: 'RUN_LOG',
        stage: 'early_resolution',
        level: 'error',
        message: riskErr.message || t('log.earlyResolutionFailed'),
      });
    }

    // Chain: data-source accessibility check. Runs against the updated
    // draft, the user references, and whatever claims have already been
    // extracted (claim extraction happens in the background, so this may
    // run before or after it completes — it degrades gracefully when
    // claims aren't yet available by scanning the draft text directly).
    dispatch({ type: 'START_SOURCE_ACCESSIBILITY' });
    try {
      const checkResult = await checkResolutionSources({
        draftContent: updatedDraft,
        references,
        claims: currentRunRef.current?.claims || [],
      });
      dispatch({
        type: 'RUN_COST',
        stage: 'source_accessibility',
        tokensIn: 0,
        tokensOut: 0,
        wallClockMs: checkResult.wallClockMs || 0,
      });
      dispatch({
        type: 'SOURCE_ACCESSIBILITY_SUCCESS',
        result: checkResult,
      });
      if (checkResult.logEntry) {
        dispatch({
          type: 'RUN_LOG',
          stage: 'source_accessibility',
          level: checkResult.logEntry.level,
          message: checkResult.logEntry.message,
        });
      }
    } catch (srcErr) {
      dispatch({
        type: 'SOURCE_ACCESSIBILITY_ERROR',
        error: srcErr.message || t('error.sourceAccessibility'),
      });
      dispatch({
        type: 'RUN_LOG',
        stage: 'source_accessibility',
        level: 'error',
        message: srcErr.message || t('log.sourceAccessibilityFailed'),
      });
    }
  };

  // --- Stage 4: Finalize to structured JSON ---
  // The early-resolution gate (set during handleUpdate) must be cleared
  // before this runs; the Accept button is disabled when needsRiskAck is true.
  const handleAccept = async () => {
    if (!draftContent) return;
    if (needsRiskAck) return; // belt-and-braces; button should already be disabled
    if (needsRoutingAck) return; // Phase 5: block on un-acknowledged blocking claims
    if (needsSourceAck) return; // block until unreachable data sources are addressed or acknowledged
    dispatch({ type: 'START_LOADING', phase: 'accept', models: [getModelName(selectedModel)] });

    // See handleReview for the snapshotting rationale.
    const runRigor = currentRunRef.current?.input?.rigor ?? rigor;

    try {
      const result = await queryModel(
        selectedModel,
        [
          { role: 'system', content: getSystemPrompt('finalizer', runRigor) },
          {
            role: 'user',
            content: buildFinalizePrompt(
              draftContent,
              normalizeUtcDateTime(startDate, '00:00:00'),
              normalizeUtcDateTime(endDate, '23:59:59'),
              numberOfOutcomes,
              runRigor,
            ),
          },
        ],
        { temperature: 0.3, maxTokens: DRAFT_MAX_TOKENS }
      );
      recordCost('accept', result);

      let parsedContent;
      try {
        const jsonMatch = result.content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (jsonMatch) {
          parsedContent = JSON.parse(jsonMatch[1]);
        } else {
          parsedContent = JSON.parse(result.content);
        }
      } catch {
        parsedContent = { raw: result.content };
      }

      // Phase 3: humanizer runs only under Human rigor. Machine runs ship
      // the un-humanized finalizer JSON straight to the market card, which
      // is the existing eval-baseline behavior. The RUN_LOG entry on the
      // skip path is intentionally informative so a regression that
      // accidentally calls the humanizer under Machine surfaces as a
      // missing 'Humanize skipped' line in the run trace.
      let finalContent = parsedContent;
      if (runRigor === 'human') {
        const humResult = await humanizeFinalJson(selectedModel, parsedContent);
        recordCost('humanize', humResult);
        dispatch({
          type: 'RUN_LOG',
          stage: 'humanize',
          level: humResult.logEntry.level,
          message: humResult.logEntry.message,
        });
        finalContent = humResult.humanizedJson;
      } else {
        dispatch({
          type: 'RUN_LOG',
          stage: 'humanize',
          level: 'info',
          message: 'Humanize skipped: Machine rigor selected.',
        });
      }

      const titleResult = await repairMarketQuestionTitle(selectedModel, finalContent, runRigor);
      recordCost('title_repair', titleResult);
      dispatch({
        type: 'RUN_LOG',
        stage: 'title_repair',
        level: titleResult.logEntry.level,
        message: titleResult.logEntry.message,
      });
      finalContent = titleResult.finalJson;

      dispatch({ type: 'FINALIZE_SUCCESS', content: finalContent });
      dispatch({ type: 'RUN_SET_FINAL', finalJson: finalContent });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || t('error.finalize') });
      dispatch({ type: 'RUN_LOG', stage: 'accept', level: 'error', message: err.message || t('log.finalizeFailed') });
    }
  };

  const handleSubmitPastedDraft = () => {
    const trimmed = pastedDraft.trim();
    if (!trimmed) return;
    dispatch({ type: 'SUBMIT_PASTED_DRAFT', content: trimmed });
    // Start a Run artifact so imported drafts participate in the same
    // claim-extraction → review → verify pipeline.
    dispatch({
      type: 'RUN_START',
      input: {
        question,
        startDate: normalizeUtcDateTime(startDate, '00:00:00'),
        endDate: normalizeUtcDateTime(endDate, '23:59:59'),
        references,
        numberOfOutcomes,
        rigor,
      },
    });
    dispatch({
      type: 'RUN_APPEND_DRAFT',
      model: 'pasted',
      content: trimmed,
      kind: 'initial',
    });
    runClaimExtractorAndRecord(trimmed).catch((bgErr) => {
      dispatch({
        type: 'RUN_LOG',
        stage: 'claims',
        level: 'error',
        message: t('log.claimExtractionCrashed', { message: bgErr?.message || bgErr }),
      });
    });
  };

  // --- Ideating: generate market ideas from vague user direction ---
  const handleIdeate = async () => {
    dispatch({ type: 'START_LOADING', phase: 'ideate', models: [getModelName(ideatingModel)] });
    try {
      const result = await queryModel(ideatingModel, [
        { role: 'system', content: getSystemPrompt('ideator', rigor) },
        { role: 'user', content: buildIdeatePrompt(ideatingInput, rigor) },
      ]);
      dispatch({ type: 'IDEATE_SUCCESS', content: result.content });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || t('error.ideate') });
    }
  };

  // Handoff from Ideate → Draft Market: switch modes and prefill the
  // Question and References fields from the chosen idea. The user can then
  // pick dates / tweak the question and hit Draft Market.
  const handleUseIdeaForDraft = (idea) => {
    dispatch({
      type: 'USE_IDEA_FOR_DRAFT',
      question: idea.title || '',
      references: buildReferenceFromIdea(idea),
    });
  };

  const handleReset = () => dispatch({ type: 'RESET' });

  // --- Run trace: export current run as JSON download ---
  // Client-side only; no server involved. The download filename carries the
  // runId so multiple exports from the same session are distinguishable.
  const handleExportRun = () => {
    if (!currentRun) return;
    try {
      const json = JSON.stringify(currentRun, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentRun.runId || 'run'}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      dispatch({ type: 'RUN_EXPORT' });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: t('error.exportRun', { message: err.message || err }) });
    }
  };

  // --- Run trace: import a previously exported run ---
  // Validates with zod via parseRun; on failure the file is ignored and an
  // error is surfaced to the user. On success the reducer rehydrates the
  // legacy view-state fields so the main UI re-renders the imported run.
  const handleImportRun = (event) => {
    const file = event.target.files && event.target.files[0];
    // Reset the input so the same file can be re-imported without a page reload.
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result);
        const run = parseRun(raw);
        if (!run) {
          dispatch({ type: 'SET_ERROR', error: t('error.importInvalid') });
          return;
        }
        dispatch({ type: 'RUN_IMPORT', run });
      } catch (err) {
        dispatch({ type: 'SET_ERROR', error: t('error.importGeneric', { message: err.message || err }) });
      }
    };
    reader.onerror = () => {
      dispatch({ type: 'SET_ERROR', error: t('error.readImport') });
    };
    reader.readAsText(file);
  };

  const handleToggleRunTrace = () => dispatch({ type: 'TOGGLE_RUN_TRACE' });

  return (
    <div className={`App ${ambientConfig.classes.join(' ')}`}>
      <LanguageToggle />
      <AmbientModeToggle mode={ambientMode} setMode={setAmbientMode} />
      <div className="container">

        {/* Header */}
        <header className="header">
          <div className="header__top-row">
            {/* Rigor Toggle — locks once a draft exists so the run keeps the
                rigor it started with. The downstream stages also snapshot
                rigor onto the Run artifact (see RUN_START dispatches) so a
                late toggle cannot leak into an in-flight pipeline. */}
            <div className="header__rigor">
              <span className="rigor-toggle__label">{t('header.outputStyle')}</span>
              <div className="rigor-toggle rigor-toggle--header mode-toggle">
                <button
                  type="button"
                  className={`mode-toggle__btn rigor-toggle__btn rigor-toggle__btn--machine ${rigor === 'machine' ? 'mode-toggle__btn--active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_FIELD', field: 'rigor', value: 'machine' })}
                  disabled={anyLoading || !!draftContent}
                  data-tooltip={t('header.machineModeTooltip')}
                  aria-label={t('header.machineModeAria')}
                >
                  <span className="rigor-toggle__icon" aria-hidden="true">🤖</span>
                  {t('header.machineMode')}
                </button>
                <button
                  type="button"
                  className={`mode-toggle__btn rigor-toggle__btn rigor-toggle__btn--human ${rigor === 'human' ? 'mode-toggle__btn--active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_FIELD', field: 'rigor', value: 'human' })}
                  disabled={anyLoading || !!draftContent}
                  data-tooltip={t('header.humanModeTooltip')}
                  aria-label={t('header.humanModeAria')}
                >
                  <span className="rigor-toggle__icon" aria-hidden="true">🧑</span>
                  {t('header.humanMode')}
                </button>
              </div>
            </div>
          </div>
          {/* Progress bar */}
          <div className="progress-bar" role="progressbar" aria-valuenow={progressPercent} aria-valuemin={0} aria-valuemax={100}>
            <div className="progress-bar__fill" style={{ width: `${progressPercent}%` }} />
          </div>
        </header>

        {/* Horizontal Panels */}
        <div className="panels-row">

          {/* Panel 1: Setup + Draft Output */}
          <div className={`panel ${currentStep === 1 ? 'panel--active' : ''} ${currentStep > 1 ? 'panel--done' : ''}`}>
            <div className="panel-header">
              <div className={`step ${currentStep >= 1 ? 'step--active' : ''} ${currentStep > 1 ? 'step--done' : ''}`}>
                <div className="step__number">{currentStep > 1 ? <svg className="step__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> : '1'}</div>
                <div className="step__label">{t('step.setup')}</div>
              </div>
            </div>
            <div className="panel-body">
              {/* Mode Toggle */}
              <div className="mode-toggle">
                <button
                  type="button"
                  className={`mode-toggle__btn ${mode === 'ideating' ? 'mode-toggle__btn--active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_FIELD', field: 'mode', value: 'ideating' })}
                  disabled={anyLoading}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2z" /></svg>
                  {t('mode.ideating')}
                </button>
                <button
                  type="button"
                  className={`mode-toggle__btn ${mode === 'draft' ? 'mode-toggle__btn--active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_FIELD', field: 'mode', value: 'draft' })}
                  disabled={anyLoading}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                  {t('mode.draftMarket')}
                </button>
              </div>

              {mode === 'draft' && (
              <div className="market-form">
                <div className="form-group">
                  <label htmlFor="question">
                    {t('form.question')} <span className="required-marker" aria-hidden="true">*</span>
                  </label>
                  <input
                    id="question"
                    type="text"
                    value={question}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'question', value: e.target.value })}
                    onBlur={() => dispatch({ type: 'TOUCH_FIELD', field: 'question' })}
                    placeholder={t('form.questionPlaceholder')}
                    className={inputClassName('question')}
                    disabled={loading === 'draft'}
                    required
                    aria-invalid={!!visibleFieldError('question')}
                    aria-describedby={visibleFieldError('question') ? 'question-error' : undefined}
                  />
                  {visibleFieldError('question') && (
                    <p id="question-error" className="field-error">{visibleFieldError('question')}</p>
                  )}
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="startDate">
                      {t('form.startDate')} <span className="label-hint">{t('form.utc')}</span> <span className="required-marker" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="startDate"
                      type="date"
                      value={toDateInputValue(startDate, '00:00:00')}
                      onChange={(e) => handleDateChange('startDate', e.target.value)}
                      onBlur={() => dispatch({ type: 'TOUCH_FIELD', field: 'startDate' })}
                      className={inputClassName('startDate')}
                      disabled={loading === 'draft'}
                      required
                      aria-invalid={!!visibleFieldError('startDate')}
                      aria-describedby={
                        visibleFieldError('startDate')
                          ? 'startDate-error'
                          : startDate
                            ? 'startDate-hint'
                            : undefined
                      }
                    />
                    {startDate && (
                      <p id="startDate-hint" className="utc-hint">
                        {formatUTCDateHint(startDate, '00:00:00')}
                      </p>
                    )}
                    {visibleFieldError('startDate') && (
                      <p id="startDate-error" className="field-error">{visibleFieldError('startDate')}</p>
                    )}
                  </div>
                  <div className="form-group">
                    <label htmlFor="endDate">
                      {t('form.endDate')} <span className="label-hint">{t('form.utc')}</span> <span className="required-marker" aria-hidden="true">*</span>
                    </label>
                    <input
                      id="endDate"
                      type="date"
                      value={toDateInputValue(endDate, '23:59:59')}
                      onChange={(e) => handleDateChange('endDate', e.target.value)}
                      onBlur={() => dispatch({ type: 'TOUCH_FIELD', field: 'endDate' })}
                      className={inputClassName('endDate')}
                      disabled={loading === 'draft'}
                      required
                      aria-invalid={!!visibleFieldError('endDate')}
                      aria-describedby={
                        visibleFieldError('endDate')
                          ? 'endDate-error'
                          : endDate
                            ? 'endDate-hint'
                            : undefined
                      }
                    />
                    {endDate && (
                      <p id="endDate-hint" className="utc-hint">
                        {formatUTCDateHint(endDate, '23:59:59')}
                      </p>
                    )}
                    {visibleFieldError('endDate') && (
                      <p id="endDate-error" className="field-error">{visibleFieldError('endDate')}</p>
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="references">
                    {t('form.references')} <span className="label-hint">{t('form.optional')}</span>
                  </label>
                  <textarea
                    id="references"
                    value={references}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'references', value: e.target.value })}
                    placeholder={t('form.referencesPlaceholder')}
                    className="input textarea"
                    disabled={loading === 'draft'}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="numberOfOutcomes">
                    {t('form.numberOfOutcomes')} <span className="label-hint">{t('form.optional')}</span>
                  </label>
                  <input
                    id="numberOfOutcomes"
                    type="number"
                    min="2"
                    step="1"
                    value={numberOfOutcomes}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'numberOfOutcomes', value: e.target.value })}
                    placeholder={t('form.numberOfOutcomesPlaceholder')}
                    className="input"
                    disabled={loading === 'draft'}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="model">{t('form.draftingModel')}</label>
                  <ModelSelect
                    id="model"
                    value={selectedModel}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'selectedModel', value: e.target.value })}
                    className="input"
                    disabled={loading === 'draft'}
                  />
                </div>

                <ErrorMessage
                  message={dateError ? t(dateError) : null}
                  onDismiss={() => dispatch({ type: 'SET_DATE', field: 'startDate', value: startDate, dateError: null })}
                  dismissLabel={t('common.dismiss')}
                />
                <ErrorMessage message={error} onDismiss={handleDismissError} dismissLabel={t('common.dismiss')} />

                <button
                  type="button"
                  className="draft-button"
                  disabled={loading === 'draft' || !!dateError}
                  onClick={handleDraft}
                >
                  {loading === 'draft' ? (
                    <>
                      <span className="spinner" />
                      {t('form.drafting')}
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                      {t('form.draftMarket')}
                    </>
                  )}
                </button>
              </div>
              )}

              {mode === 'review' && (
              <div className="market-form">
                <div className="form-group">
                  <label htmlFor="pastedDraft">{t('form.pasteExistingDraft')}</label>
                  <textarea
                    id="pastedDraft"
                    value={pastedDraft}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'pastedDraft', value: e.target.value })}
                    placeholder={t('form.pasteExistingDraftPlaceholder')}
                    className="input textarea textarea--tall"
                  />
                </div>

                <ErrorMessage message={error} onDismiss={handleDismissError} dismissLabel={t('common.dismiss')} />

                <button
                  type="button"
                  className="draft-button"
                  disabled={!pastedDraft.trim()}
                  onClick={handleSubmitPastedDraft}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  {t('form.submitForReview')}
                </button>
              </div>
              )}

              {mode === 'ideating' && (
              <div className="market-form">
                <div className="form-group">
                  <label htmlFor="ideatingInput">{t('form.vagueDirection')}</label>
                  <textarea
                    id="ideatingInput"
                    value={ideatingInput}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'ideatingInput', value: e.target.value })}
                    placeholder={t('form.vagueDirectionPlaceholder')}
                    className="input textarea textarea--tall"
                    disabled={loading === 'ideate'}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="ideatingModel">{t('form.ideationModel')}</label>
                  <ModelSelect
                    id="ideatingModel"
                    value={ideatingModel}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'ideatingModel', value: e.target.value })}
                    className="input"
                    disabled={loading === 'ideate'}
                  />
                </div>

                <ErrorMessage message={error} onDismiss={handleDismissError} dismissLabel={t('common.dismiss')} />

                <button
                  type="button"
                  className="draft-button"
                  disabled={loading === 'ideate' || !ideatingInput.trim()}
                  onClick={handleIdeate}
                >
                  {loading === 'ideate' ? (
                    <>
                      <span className="spinner" />
                      {t('form.ideating')}
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2z" /></svg>
                      {t('form.generateIdeas')}
                    </>
                  )}
                </button>

                {loading === 'ideate' && (
                  <Enter className="draft-output-section">
                    <LLMLoadingState phase="ideate" meta={loadingMeta} rigor={displayRigor} />
                  </Enter>
                )}

                {ideatingContent && loading !== 'ideate' && (
                  <Enter className="draft-output-section">
                    <div className="col-panel col-panel--draft">
                      <div className="col-panel-header">
                        <h2>{t('ideas.heading')}</h2>
                        <div className="col-panel-actions">
                          <span className="model-badge" data-tooltip={getModelName(ideatingModel)} tabIndex={0} role="img" aria-label={t('common.modelAria', { name: getModelName(ideatingModel) })}>{getModelAbbrev(ideatingModel)}</span>
                          <button
                            type="button"
                            className="copy-btn"
                            onClick={handleIdeate}
                            disabled={!ideatingInput.trim() || loading === 'ideate'}
                            title={t('ideas.refreshTitle')}
                            aria-label={t('ideas.refreshAria')}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: '-1px', marginRight: 4 }}><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" /><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" /></svg>
                            {t('ideas.refresh')}
                          </button>
                          <button
                            className={`copy-btn ${copiedId === 'ideating' ? 'copy-btn--copied' : ''}`}
                            onClick={() => handleCopy(ideatingContent, 'ideating')}
                          >
                            {copiedId === 'ideating' ? t('common.copied') : t('common.copy')}
                          </button>
                        </div>
                      </div>
                      <div className="content-box content-box--rich">
                        {(() => {
                          const { preamble, ideas, postamble } = parseIdeateContent(ideatingContent, t);
                          if (ideas.length === 0) {
                            // Fallback: the LLM didn't number its output, so
                            // render the raw content without per-idea buttons.
                            return renderContent(ideatingContent);
                          }
                          return (
                            <>
                              {preamble && (
                                <div className="ideate-preamble">{renderContent(preamble)}</div>
                              )}
                              <div className="ideate-ideas">
                                {ideas.map((idea, idx) => (
                                  <div
                                    key={`idea-${idx}-${idea.number}`}
                                    className="ideate-idea stagger-item"
                                    style={{ '--stagger': Math.min(idx, 8) }}
                                  >
                                    <div className="ideate-idea__header">
                                      <span className="ideate-idea__number">{idea.number}.</span>
                                      <span className="ideate-idea__title">{idea.title}</span>
                                      <button
                                        type="button"
                                        className="ideate-idea__use-btn"
                                        onClick={() => handleUseIdeaForDraft(idea)}
                                        title={t('ideas.useTitle')}
                                        aria-label={t('ideas.useAria', { n: idea.number })}
                                      >
                                        &rarr;
                                      </button>
                                    </div>
                                    {idea.rest && (
                                      <div className="ideate-idea__body">
                                        {renderContent(idea.rest)}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                              {postamble && (
                                <div className="ideate-postamble">{renderContent(postamble)}</div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </Enter>
                )}
              </div>
              )}

              {/* Draft output — stays in Panel 1 right under the button */}
              {mode !== 'ideating' && loading === 'draft' && (
                <Enter className="draft-output-section">
                  <LLMLoadingState phase="draft" meta={loadingMeta} rigor={displayRigor} />
                </Enter>
              )}
              {mode !== 'ideating' && draftContent && (
                <Enter className="draft-output-section" ref={draftOutputRef}>
                  <div className={`col-panel col-panel--draft ${draftJustUpdated ? 'col-panel--just-updated' : ''}`}>
                    <div className="col-panel-header">
                      <div className="draft-title-group">
                        <h2>{t('draft.heading')}</h2>
                        {draftVersions.length > 0 && (
                          <span className="version-badge" title={t('draft.versionTitle', { current: viewingVersionIndex + 1, total: draftVersions.length })}>
                            v{viewingVersionIndex + 1}
                            {draftVersions.length > 1 && <span className="version-badge__total">/{draftVersions.length}</span>}
                          </span>
                        )}
                        {displayedVersion && (
                          <span className="version-timestamp">
                            {isViewingLatest && displayedVersion.source === 'update' ? t('draft.updated') : ''}
                            {formatRelativeTime(displayedVersion.timestamp, t)}
                          </span>
                        )}
                      </div>
                      <div className="col-panel-actions">
                        {draftVersions.length > 1 && (
                          <div className="version-switcher" role="group" aria-label={t('draft.versionHistoryAria')}>
                            <button
                              type="button"
                              className="version-switcher__btn"
                              disabled={viewingVersionIndex === 0}
                              onClick={() => dispatch({ type: 'SET_VIEWING_VERSION', index: viewingVersionIndex - 1 })}
                              aria-label={t('draft.previousVersion')}
                              title={t('draft.previousVersion')}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                            </button>
                            <button
                              type="button"
                              className="version-switcher__btn"
                              disabled={isViewingLatest}
                              onClick={() => dispatch({ type: 'SET_VIEWING_VERSION', index: viewingVersionIndex + 1 })}
                              aria-label={t('draft.nextVersion')}
                              title={t('draft.nextVersion')}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                            </button>
                          </div>
                        )}
                        <span className="model-badge" data-tooltip={getModelName(selectedModel)} tabIndex={0} role="img" aria-label={t('common.modelAria', { name: getModelName(selectedModel) })}>{getModelAbbrev(selectedModel)}</span>
                        <button
                          className={`copy-btn ${copiedId === 'draft' ? 'copy-btn--copied' : ''}`}
                          onClick={() => handleCopy(displayedDraftContent, 'draft')}
                        >
                          {copiedId === 'draft' ? t('common.copied') : t('common.copy')}
                        </button>
                      </div>
                    </div>
                    {!isViewingLatest && (
                      <div className="version-banner">
                        <span>{t('draft.viewingEarlier', { current: viewingVersionIndex + 1, total: draftVersions.length })}</span>
                        <button
                          type="button"
                          className="version-banner__btn"
                          onClick={() => dispatch({ type: 'SET_VIEWING_VERSION', index: latestVersionIndex })}
                        >
                          {t('draft.jumpToLatest')}
                        </button>
                      </div>
                    )}
                    <div className="content-box content-box--rich">
                      {renderContent(displayedDraftContent)}
                    </div>
                  </div>
                </Enter>
              )}
            </div>
          </div>

          {/* Connector line */}
          <div className={`panel-connector ${currentStep > 1 ? 'panel-connector--done' : ''}`} />

          {/* Panel 2: Draft & Review (feedback + agent reviews) */}
          <div ref={panel2Ref} className={`panel ${currentStep === 2 ? 'panel--active' : ''} ${currentStep > 2 ? 'panel--done' : ''} ${currentStep < 2 ? 'panel--locked' : ''}`}>
            <div className="panel-header">
              <div className={`step ${currentStep >= 2 ? 'step--active' : ''} ${currentStep > 2 ? 'step--done' : ''}`}>
                <div className="step__number">{currentStep > 2 ? <svg className="step__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> : '2'}</div>
                <div className="step__label">{t('step.draftReview')}</div>
              </div>
            </div>
            <div className="panel-body">
              {!draftContent ? (
                <div className="panel-placeholder">
                  <div className="placeholder-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                  </div>
                  <p>{t('placeholder.draftReview')}</p>
                </div>
              ) : (
                <Enter className="draft-review-section">

                  {/* Action Toolbar */}
                  <div className="action-toolbar">
                    {/* Multi-reviewer selector */}
                    <div className="toolbar-group">
                      <label>{t('toolbar.reviewCouncil')}</label>
                      <div className="review-models-list">
                        {reviewModels.map((modelId, idx) => (
                          <div key={idx} className="review-model-row">
                            <ModelSelect
                              id={`reviewModel-${idx}`}
                              value={modelId}
                              onChange={(e) =>
                                dispatch({ type: 'SET_REVIEW_MODEL', index: idx, value: e.target.value })
                              }
                              className="toolbar-select"
                              disabled={anyLoading}
                            />
                            {reviewModels.length > 1 && (
                              <button
                                type="button"
                                className="remove-reviewer-btn"
                                onClick={() => dispatch({ type: 'REMOVE_REVIEW_MODEL', index: idx })}
                                disabled={anyLoading}
                                title={t('toolbar.removeReviewer')}
                              >
                                &times;
                              </button>
                            )}
                          </div>
                        ))}
                        {reviewModels.length < 4 && (
                          <button
                            type="button"
                            className="add-reviewer-btn"
                            onClick={() => dispatch({ type: 'ADD_REVIEW_MODEL' })}
                            disabled={anyLoading}
                          >
                            {t('toolbar.addReviewer')}
                          </button>
                        )}
                      </div>
                      <span className="toolbar-hint">
                        {reviewModels.length > 1
                          ? t('toolbar.councilHintMulti')
                          : t('toolbar.councilHintSingle')}
                      </span>
                    </div>

                    <div className="toolbar-divider" />

                    {/* Phase 2: Aggregation protocol selector. Governs how
                        per-item rubric votes are rolled up into the final
                        aggregation decision. */}
                    <div className="toolbar-group">
                      <label htmlFor="aggregation-protocol">{t('toolbar.aggregation')}</label>
                      <select
                        id="aggregation-protocol"
                        className="toolbar-select"
                        value={aggregationProtocol}
                        disabled={anyLoading}
                        onChange={(e) =>
                          dispatch({
                            type: 'SET_FIELD',
                            field: 'aggregationProtocol',
                            value: e.target.value,
                          })
                        }
                      >
                        {AGGREGATION_PROTOCOLS.map((p) => (
                          <option key={p} value={p}>
                            {p.charAt(0).toUpperCase() + p.slice(1)}
                          </option>
                        ))}
                      </select>
                      <span className="toolbar-hint">
                        {aggregationProtocol === 'majority' && t('toolbar.aggMajority')}
                        {aggregationProtocol === 'unanimity' && t('toolbar.aggUnanimity')}
                        {aggregationProtocol === 'judge' && t('toolbar.aggJudge')}
                      </span>
                    </div>

                    <div className="toolbar-divider" />

                    <div className="toolbar-actions">
                      <div className={`toolbar-group ${updateDraftReady ? '' : 'toolbar-group--primary'}`}>
                        <button
                          type="button"
                          className={updateDraftReady ? 'review-button' : 'review-button--primary'}
                          disabled={anyLoading || reviewAlreadyCurrent}
                          onClick={handleReview}
                          title={
                            reviewAlreadyCurrent
                              ? t('toolbar.reviewAlreadyCurrent')
                              : undefined
                          }
                        >
                          {loading === 'review' ? (
                            <>
                              <span className="spinner" />
                              {reviewLoadingLabel}
                            </>
                          ) : (
                            <>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                              {reviewActionLabel}
                            </>
                          )}
                        </button>
                        {reviewConfigChanged && (
                          <span className="toolbar-hint">
                            {t('toolbar.councilChanged')}
                          </span>
                        )}
                      </div>

                      {reviews.length > 0 && !reviewConfigChanged && (
                        <div className="toolbar-group toolbar-group--primary">
                          <button
                            type="button"
                            className="review-button--primary"
                            disabled={anyLoading}
                            onClick={handleUpdate}
                          >
                            {loading === 'update' ? (
                              <>
                                <span className="spinner" />
                                {t('toolbar.updating')}
                              </>
                            ) : (
                              <>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                                {t('toolbar.updateDraft')}
                              </>
                            )}
                          </button>
                        </div>
                      )}

                      {hasUpdated && (
                        <div className="toolbar-group">
                          <button
                            type="button"
                            className="accept-button"
                            disabled={anyLoading || needsRiskAck || needsRoutingAck || needsSourceAck || reviewConfigChanged}
                            onClick={handleAccept}
                            title={
                              reviewConfigChanged
                                ? t('toolbar.acceptTitleConfigChanged')
                                : needsRiskAck
                                ? t('toolbar.acceptTitleNeedsRiskAck')
                                : needsRoutingAck
                                  ? t('toolbar.acceptTitleNeedsRoutingAck')
                                  : needsSourceAck
                                    ? t('toolbar.acceptTitleNeedsSourceAck')
                                    : undefined
                            }
                          >
                            {loading === 'accept' ? (
                              <>
                                <span className="spinner" />
                                {t('toolbar.finalizing')}
                              </>
                            ) : (
                              <>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                {t('toolbar.acceptFinalize')}
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Early-resolution risk gate — runs pre-finalize.
                      HIGH risk blocks Accept & Finalize until acknowledged. */}
                  {hasUpdated && (loading === 'early-resolution' || earlyResolutionRiskLevel) && (
                    <div
                      className={`risk-gate risk-gate--${earlyResolutionRiskLevel || 'checking'}`}
                      role={earlyResolutionRiskLevel === 'high' ? 'alert' : 'status'}
                    >
                      <div className="risk-gate__header">
                        <span className="risk-gate__label">{t('gate.earlyLabel')}</span>
                        {loading === 'early-resolution' ? (
                          <span className="risk-gate__level risk-gate__level--checking">
                            <span className="spinner" /> {t('gate.checking')}
                          </span>
                        ) : (
                          <span className={`risk-gate__level risk-gate__level--${earlyResolutionRiskLevel}`}>
                            {earlyResolutionRiskLevel === 'unknown'
                              ? t('gate.unknown')
                              : earlyResolutionRiskLevel === 'high'
                                ? t('gate.high')
                                : earlyResolutionRiskLevel === 'medium'
                                  ? t('gate.medium')
                                  : earlyResolutionRiskLevel === 'low'
                                    ? t('gate.low')
                                    : (earlyResolutionRiskLevel || '').toUpperCase()}
                          </span>
                        )}
                      </div>
                      {loading !== 'early-resolution' && earlyResolutionRisk && (
                        <div className="risk-gate__body">
                          {renderContent(earlyResolutionRisk)}
                        </div>
                      )}
                      {needsRiskAck && (
                        <div className="risk-gate__actions">
                          <p className="risk-gate__warning">
                            {t('gate.earlyWarning')}
                          </p>
                          <button
                            type="button"
                            className="risk-gate__ack-btn"
                            onClick={() => dispatch({ type: 'ACKNOWLEDGE_EARLY_RESOLUTION' })}
                          >
                            {t('gate.earlyAck')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Phase 5: routing gate — runs pre-finalize. Any
                      'blocking' routing item (or a global blocker
                      criticism) prevents Accept until acknowledged. */}
                  {hasUpdated && currentRun?.routing && currentRun.routing.overall !== 'clean' && (
                    <div
                      className={`risk-gate risk-gate--${currentRun.routing.overall === 'blocked' ? 'high' : 'medium'}`}
                      role={currentRun.routing.overall === 'blocked' ? 'alert' : 'status'}
                    >
                      <div className="risk-gate__header">
                        <span className="risk-gate__label">{t('gate.routingLabel')}</span>
                        <span className={`risk-gate__level risk-gate__level--${currentRun.routing.overall === 'blocked' ? 'high' : 'medium'}`}>
                          {currentRun.routing.overall === 'blocked' ? t('gate.routingBlocked') : t('gate.routingNeedsUpdate')}
                        </span>
                      </div>
                      <div className="risk-gate__body">
                        <p className="risk-gate__hint">
                          {t('gate.routingHint')}
                        </p>
                        {(() => {
                          const grouped = groupRoutingBySeverity(currentRun.routing);
                          const claimsById = new Map(currentRun.claims.map((c) => [c.id, c]));

                          // Pull out reasons that appear on EVERY item in a group —
                          // these are universal signals (e.g. a global blocker
                          // criticism) and are far more useful surfaced once at
                          // the top than repeated on every card.
                          const findSharedReasons = (items) => {
                            if (items.length < 2) return new Set();
                            const first = new Set(items[0].reasons || []);
                            for (let i = 1; i < items.length; i++) {
                              const cur = new Set(items[i].reasons || []);
                              for (const r of first) {
                                if (!cur.has(r)) first.delete(r);
                              }
                            }
                            return first;
                          };

                          const renderCard = (item, shared) => {
                            const claim = claimsById.get(item.claimId);
                            const category = humanReadableClaimCategory(item.claimId, t);
                            const uniqueReasons = (item.reasons || []).filter((r) => !shared.has(r));
                            const hasText = claim && claim.text && claim.text.trim();
                            // Drop cards that add nothing specific — no claim text AND no unique reasons.
                            // The shared reasons banner already tells the user why they're flagged.
                            if (!hasText && uniqueReasons.length === 0) return null;
                            return (
                              <li key={item.claimId} className="risk-gate__item">
                                <span className="risk-gate__category">{category}</span>
                                {hasText ? (
                                  <span className="risk-gate__claim-text">{claim.text}</span>
                                ) : (
                                  <span className="risk-gate__claim-text risk-gate__claim-text--faint">
                                    <code>{item.claimId}</code> {t('gate.routingClaimUnavailable')}
                                  </span>
                                )}
                                {uniqueReasons.length > 0 && (
                                  <ul className="risk-gate__reason-list">
                                    {uniqueReasons.map((r, i) => (
                                      <li key={i} className="risk-gate__reason-item">{toSimpleRoutingReason(r, t)}</li>
                                    ))}
                                  </ul>
                                )}
                              </li>
                            );
                          };

                          const renderGroup = (items) => {
                            const shared = findSharedReasons(items);
                            const cards = items.slice(0, 12).map((item) => renderCard(item, shared)).filter(Boolean);
                            return { shared, cards };
                          };

                          const renderSharedBanner = (shared, total) => {
                            if (shared.size === 0) return null;
                            return (
                              <div className="risk-gate__shared-banner">
                                <span className="risk-gate__shared-title">
                                  {t(total === 1 ? 'gate.routingAffectingOne' : 'gate.routingAffectingMany', { n: total })}
                                </span>
                                <ul className="risk-gate__reason-list">
                                  {Array.from(shared).map((r, i) => (
                                    <li key={i} className="risk-gate__reason-item">{toSimpleRoutingReason(r, t)}</li>
                                  ))}
                                </ul>
                              </div>
                            );
                          };

                          const blocking = renderGroup(grouped.blocking);
                          const targeted = renderGroup(grouped.targeted_review);

                          return (
                            <>
                              {grouped.blocking.length > 0 && (
                                <>
                                  <p className="risk-gate__subheading risk-gate__subheading--blocking">{t('gate.routingMustFix', { n: grouped.blocking.length })}</p>
                                  {renderSharedBanner(blocking.shared, grouped.blocking.length)}
                                  {blocking.cards.length > 0 && <ul className="risk-gate__list">{blocking.cards}</ul>}
                                </>
                              )}
                              {grouped.targeted_review.length > 0 && (
                                <>
                                  <p className="risk-gate__subheading risk-gate__subheading--review">{t('gate.routingWorthReviewing', { n: grouped.targeted_review.length })}</p>
                                  {renderSharedBanner(targeted.shared, grouped.targeted_review.length)}
                                  {targeted.cards.length > 0 && <ul className="risk-gate__list">{targeted.cards}</ul>}
                                </>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      {needsRoutingAck && (
                        <div className="risk-gate__actions">
                          {getSimpleBlockReasons(currentRun, t).length > 0 && (
                            <>
                              <p className="risk-gate__subheading">{t('gate.routingWhyBlocked')}</p>
                              <ul className="risk-gate__list">
                                {getSimpleBlockReasons(currentRun, t).map((reason) => (
                                  <li key={reason}>{reason}</li>
                                ))}
                              </ul>
                            </>
                          )}
                          <p className="risk-gate__warning">
                            {t('gate.routingWarning')}
                          </p>
                          <button
                            type="button"
                            className="risk-gate__ack-btn"
                            onClick={() => dispatch({ type: 'ACKNOWLEDGE_ROUTING' })}
                          >
                            {t('gate.routingAck')}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Data-source accessibility gate — runs pre-finalize after
                      early-resolution. Confirmed-unreachable source URLs
                      block Accept until the user explicitly acknowledges. */}
                  {hasUpdated && (loading === 'source-accessibility' || sourceAccessibility) && (() => {
                    const status = sourceAccessibility?.status || null;
                    const isChecking = loading === 'source-accessibility';
                    const STATUS_META = {
                      ok:               { level: 'low',     label: t('gate.sourceReachable') },
                      some_unreachable: { level: 'medium',  label: t('gate.sourcePartial') },
                      all_unreachable:  { level: 'high',    label: t('gate.sourceAllUnreachable') },
                      no_sources:       { level: 'unknown', label: t('gate.sourceNoSources') },
                      error:            { level: 'unknown', label: t('gate.sourceError') },
                    };
                    const meta = STATUS_META[status] || { level: 'checking', label: t('gate.sourceUnknown') };
                    const gateLevel = meta.level;
                    const levelLabel = isChecking ? null : meta.label;
                    const originLabel = (origin) => {
                      if (origin === 'source_claim') return t('origin.sourceClaim');
                      if (origin === 'resolution_section') return t('origin.resolutionSection');
                      if (origin === 'references') return t('origin.references');
                      if (origin === 'draft_body') return t('origin.draftBody');
                      return origin;
                    };
                    const sources = sourceAccessibility?.sources || [];
                    const unreachable = sources.filter((s) => !s.accessible);
                    const reachable = sources.filter((s) => s.accessible);
                    return (
                      <div
                        className={`risk-gate risk-gate--${gateLevel}`}
                        role={needsSourceAck ? 'alert' : 'status'}
                      >
                        <div className="risk-gate__header">
                          <span className="risk-gate__label">{t('gate.sourceLabel')}</span>
                          {isChecking ? (
                            <span className="risk-gate__level risk-gate__level--checking">
                              <span className="spinner" /> {t('gate.checking')}
                            </span>
                          ) : (
                            <span className={`risk-gate__level risk-gate__level--${gateLevel}`}>
                              {levelLabel}
                            </span>
                          )}
                        </div>
                        {!isChecking && sourceAccessibility && (
                          <div className="risk-gate__body">
                            <p className="risk-gate__hint">
                              {t('gate.sourceHint')}
                            </p>
                            {status === 'no_sources' && (
                              <p>
                                {t('gate.sourceNoSourcesText')}
                              </p>
                            )}
                            {status === 'error' && (
                              <p>
                                {t('gate.sourceErrorText', { error: sourceAccessibility.error || t('gate.unknownError') })}
                              </p>
                            )}
                            {unreachable.length > 0 && (
                              <>
                                <p className="risk-gate__subheading">
                                  {t('gate.sourceUnreachableHeading', { n: unreachable.length })}
                                </p>
                                <ul className="risk-gate__list">
                                  {unreachable.slice(0, 10).map((s) => (
                                    <li key={s.url}>
                                      <SourceUrlLink url={s.url} />
                                      <span className="risk-gate__reasons">
                                        {' '}({originLabel(s.origin)})
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}
                            {reachable.length > 0 && (
                              <>
                                <p className="risk-gate__subheading">
                                  {t('gate.sourceReachableHeading', { n: reachable.length })}
                                </p>
                                <ul className="risk-gate__list">
                                  {reachable.slice(0, 10).map((s) => (
                                    <li key={s.url}>
                                      <SourceUrlLink url={s.url} />
                                      <span className="risk-gate__reasons">
                                        {' '}({originLabel(s.origin)})
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </>
                            )}
                          </div>
                        )}
                        {needsSourceAck && (
                          <div className="risk-gate__actions">
                            <p className="risk-gate__warning">
                              {status === 'all_unreachable'
                                ? t('gate.sourceWarningAll')
                                : t('gate.sourceWarningSome')}
                            </p>
                            <button
                              type="button"
                              className="risk-gate__ack-btn"
                              onClick={() => dispatch({ type: 'ACKNOWLEDGE_SOURCE_ACCESSIBILITY' })}
                            >
                              {t('gate.sourceAck')}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {/* Your Feedback */}
                  <div className="col-panel col-panel--review">
                    <div className="human-review-section">
                      <h2>{t('feedback.heading')}</h2>
                      <span className="hint">{t('feedback.hint')}</span>
                      <textarea
                        value={humanReviewInput}
                        onChange={(e) =>
                          dispatch({ type: 'SET_FIELD', field: 'humanReviewInput', value: e.target.value })
                        }
                        placeholder={t('feedback.placeholder')}
                        className="input textarea"
                        disabled={loading === 'update'}
                      />
                    </div>
                  </div>

                  {/* Loading state for review */}
                  {loading === 'review' && reviews.length === 0 && (
                    <div className="col-panel col-panel--review">
                      <LLMLoadingState phase="review" meta={loadingMeta} rigor={displayRigor} />
                    </div>
                  )}

                  {/* Agent Review content */}
                  {reviews.length > 0 && (
                    <Enter className="col-panel col-panel--review">
                      {deliberatedReview && (
                        <Enter>
                          <div className="col-panel-header">
                            <h2>{t('reviews.deliberated')}</h2>
                            <div className="col-panel-actions">
                              <span className="model-badge deliberation-badge" data-tooltip={t('reviews.councilDeliberation')} tabIndex={0} role="img" aria-label={t('reviews.councilDeliberation')}>C</span>
                              <button
                                className={`copy-btn ${copiedId === 'deliberated' ? 'copy-btn--copied' : ''}`}
                                onClick={() => handleCopy(deliberatedReview, 'deliberated')}
                              >
                                {copiedId === 'deliberated' ? t('common.copied') : t('common.copy')}
                              </button>
                            </div>
                          </div>
                          <div className="content-box content-box--rich">
                            {renderContent(deliberatedReview)}
                          </div>
                        </Enter>
                      )}

                      {reviews.map((review, idx) => (
                        <Enter key={idx} className={deliberatedReview ? 'individual-review' : ''}>
                          <div className="col-panel-header">
                            <h2>{deliberatedReview ? t('reviews.reviewerN', { n: idx + 1 }) : t('reviews.agentReview')}</h2>
                            <div className="col-panel-actions">
                              <span className="model-badge" data-tooltip={review.modelName} tabIndex={0} role="img" aria-label={t('common.modelAria', { name: review.modelName })}>{getModelAbbrev(review.model)}</span>
                              <button
                                className={`copy-btn ${copiedId === `review-${idx}` ? 'copy-btn--copied' : ''}`}
                                onClick={() => handleCopy(review.content, `review-${idx}`)}
                              >
                                {copiedId === `review-${idx}` ? t('common.copied') : t('common.copy')}
                              </button>
                            </div>
                          </div>
                          <div className="content-box content-box--rich">
                            {renderContent(review.content)}
                          </div>
                        </Enter>
                      ))}
                    </Enter>
                  )}
                </Enter>
              )}
            </div>
          </div>

          {/* Connector line */}
          <div className={`panel-connector ${currentStep > 2 ? 'panel-connector--done' : ''}`} />

          {/* Panel 3: Finalize */}
          <div ref={panel3Ref} className={`panel ${currentStep === 3 ? 'panel--active' : ''} ${currentStep < 3 ? 'panel--locked' : ''}`}>
            <div className="panel-header">
              <div className={`step ${currentStep >= 3 ? 'step--active' : ''}`}>
                <div className="step__number">3</div>
                <div className="step__label">{t('step.finalize')}</div>
              </div>
            </div>
            <div className="panel-body">
              {!finalContent && loading !== 'accept' ? (
                <div className="panel-placeholder">
                  <div className="placeholder-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                  </div>
                  <p>{t('placeholder.finalize')}</p>
                </div>
              ) : loading === 'accept' ? (
                <LLMLoadingState phase="accept" meta={loadingMeta} rigor={displayRigor} />
              ) : (
                <div className="final-content">
                  <div className="final-header stagger-item" style={{ '--stagger': 0 }}>
                    <div className="final-header__icon">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                    </div>
                    <h2>{t('final.heading')}</h2>
                    <div className="final-header__actions">
                      <button
                        className={`copy-btn ${copiedId === 'full-output' ? 'copy-btn--copied' : ''}`}
                        onClick={() => {
                          const text = finalMarketCard
                            ? formatMarketCardCopy(finalMarketCard)
                            : formatFullSpecCopy(finalContent);
                          handleCopy(text, 'full-output');
                        }}
                      >
                        {copiedId === 'full-output' ? t('common.copied') : t('common.copyAll')}
                      </button>
                      {isHumanFinal && (
                        <button
                          className={`copy-btn copy-btn--secondary ${copiedId === 'full-spec' ? 'copy-btn--copied' : ''}`}
                          onClick={() => handleCopy(formatFullSpecCopy(finalContent), 'full-spec')}
                        >
                          {copiedId === 'full-spec' ? t('common.copied') : t('final.copyFullSpec')}
                        </button>
                      )}
                    </div>
                  </div>

                  {finalContent.raw ? (
                    <div className="final-doc">
                      <div className="content-box content-box--rich stagger-item" style={{ '--stagger': 1 }}>
                        {renderContent(finalContent.raw)}
                      </div>
                    </div>
                  ) : isHumanFinal && finalMarketCard && !finalMarketCard.isRaw ? (
                    <div className="final-doc final-doc--human">
                      <div className="market-card stagger-item" style={{ '--stagger': 1 }}>
                        {finalMarketCard.question && (
                          <div className="market-card__question">{finalMarketCard.question}</div>
                        )}
                        {finalMarketCard.description && (
                          <p className="market-card__description">{finalMarketCard.description}</p>
                        )}
                        {finalMarketCard.period && (
                          <div className="market-card__period">
                            <span className="market-card__period-label">{t('final.marketPeriod')}</span>
                            <span className="market-card__period-dates">{finalMarketCard.period}</span>
                          </div>
                        )}

                        {finalMarketCard.outcomes.length > 0 && (
                          <div className="market-card__section">
                            <h3 className="market-card__heading">
                              {t('final.outcomes', { n: finalMarketCard.outcomes.length })}
                            </h3>
                            <ul className="market-card__outcomes">
                              {finalMarketCard.outcomes.map((outcome, index) => {
                                const showVerify =
                                  outcome.resolutionCriteria &&
                                  outcome.resolutionCriteria !== outcome.winCondition;
                                return (
                                  <li key={index} className="market-card__outcome">
                                    <div className="market-card__outcome-line">
                                      <span className="market-card__outcome-name">{outcome.name}:</span>{' '}
                                      <span className="market-card__outcome-win">
                                        {outcome.winCondition || t('final.seeResolution')}
                                      </span>
                                    </div>
                                    {showVerify && (
                                      <div className="market-card__verify">
                                        <span className="market-card__verify-label">{t('final.verify')}</span>{' '}
                                        {outcome.resolutionCriteria}
                                      </div>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}

                        {(finalMarketCard.settlementBullets.length > 0 || finalMarketCard.hiddenSettlementCount > 0) && (
                          <div className="market-card__section">
                            <h3 className="market-card__heading">{t('final.settlement')}</h3>
                            <ul className="market-card__bullets">
                              {finalMarketCard.settlementBullets.map((bullet, index) => (
                                <li key={index}>{bullet}</li>
                              ))}
                              {finalMarketCard.hiddenSettlementCount > 0 && (
                                <li className="market-card__bullets-more">
                                  {t('final.moreInFullSpec', { n: finalMarketCard.hiddenSettlementCount })}
                                </li>
                              )}
                            </ul>
                          </div>
                        )}

                        {(finalMarketCard.edgeCaseBullets.length > 0 || finalMarketCard.hiddenEdgeCaseCount > 0) && (
                          <div className="market-card__section">
                            <h3 className="market-card__heading">{t('final.edgeCases')}</h3>
                            <ul className="market-card__bullets">
                              {finalMarketCard.edgeCaseBullets.map((bullet, index) => (
                                <li key={index}>{bullet}</li>
                              ))}
                              {finalMarketCard.hiddenEdgeCaseCount > 0 && (
                                <li className="market-card__bullets-more">
                                  {t('final.moreInFullSpec', { n: finalMarketCard.hiddenEdgeCaseCount })}
                                </li>
                              )}
                            </ul>
                          </div>
                        )}

                        {finalMarketCard.risk && (finalMarketCard.risk.summary || finalMarketCard.risk.level) && (
                          <div className={`market-card__risk market-card__risk--${finalMarketCard.risk.level || 'unknown'}`}>
                            <span className="market-card__risk-label">{t('final.riskShort')}</span>
                            {finalMarketCard.risk.level && finalMarketCard.risk.level !== 'unknown' && (
                              <span className={`risk-gate__level risk-gate__level--${finalMarketCard.risk.level}`}>
                                {finalMarketCard.risk.level === 'high'
                                  ? t('gate.high')
                                  : finalMarketCard.risk.level === 'medium'
                                    ? t('gate.medium')
                                    : finalMarketCard.risk.level === 'low'
                                      ? t('gate.low')
                                      : finalMarketCard.risk.level.toUpperCase()}
                              </span>
                            )}
                            {finalMarketCard.risk.summary && (
                              <span className="market-card__risk-summary">{finalMarketCard.risk.summary}</span>
                            )}
                          </div>
                        )}
                      </div>

                      <details className="final-doc__details stagger-item" style={{ '--stagger': 2 }}>
                        <summary>{t('final.showFullSpec')}</summary>
                        <div className="final-doc__details-body">
                          {/* Untruncated outcomes — the market card above
                              caps win/resolution text via buildMarketCard().
                              Without this block long resolver criteria would
                              be invisible despite the "full spec" label. */}
                          {finalContent.outcomes?.length > 0 && (
                            <div className="final-doc__section">
                              <h3 className="final-doc__heading">
                                {t('final.outcomes', { n: finalContent.outcomes.length })}
                              </h3>
                              <div className="final-doc__outcomes">
                                {finalContent.outcomes.map((outcome, index) => (
                                  <div key={index} className="outcome-row">
                                    <div className="outcome-row__header">
                                      <span className="outcome-row__number">{index + 1}</span>
                                      <span className="outcome-row__name">{outcome.name}</span>
                                    </div>
                                    {outcome.winCondition && (
                                      <div className="outcome-row__win">
                                        <strong>{t('final.winsIf')}</strong> {outcome.winCondition}
                                      </div>
                                    )}
                                    {outcome.resolutionCriteria && (
                                      <div className="outcome-row__criteria">
                                        <strong>{t('final.resolvedBy')}</strong> {outcome.resolutionCriteria}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {resolutionDescriptionMarkdown && (
                            <div className="final-doc__section final-doc__section--description">
                              <div className="final-doc__section-header">
                                <h3 className="final-doc__heading">{t('final.dashboardDescription')}</h3>
                                <button
                                  className={`copy-btn ${copiedId === 'description-markdown' ? 'copy-btn--copied' : ''}`}
                                  onClick={() => handleCopy(resolutionDescriptionMarkdown, 'description-markdown')}
                                >
                                  {copiedId === 'description-markdown' ? t('common.copied') : t('common.copy')}
                                </button>
                              </div>
                              <div className="final-doc__text final-doc__text--markdown">
                                {renderContent(resolutionDescriptionMarkdown)}
                              </div>
                            </div>
                          )}

                          {finalContent.fullResolutionRules && (
                            <div className="final-doc__section">
                              <div className="final-doc__section-header">
                                <h3 className="final-doc__heading">{t('final.resolutionRules')}</h3>
                                <button
                                  className={`copy-btn ${copiedId === 'rules' ? 'copy-btn--copied' : ''}`}
                                  onClick={() => handleCopy(finalContent.fullResolutionRules, 'rules')}
                                >
                                  {copiedId === 'rules' ? t('common.copied') : t('common.copy')}
                                </button>
                              </div>
                              <div className="final-doc__text">
                                {renderContent(finalContent.fullResolutionRules)}
                              </div>
                            </div>
                          )}

                          {finalContent.edgeCases && (
                            <div className="final-doc__section">
                              <div className="final-doc__section-header">
                                <h3 className="final-doc__heading">{t('final.edgeCases')}</h3>
                                <button
                                  className={`copy-btn ${copiedId === 'edge-cases' ? 'copy-btn--copied' : ''}`}
                                  onClick={() => handleCopy(finalContent.edgeCases, 'edge-cases')}
                                >
                                  {copiedId === 'edge-cases' ? t('common.copied') : t('common.copy')}
                                </button>
                              </div>
                              <div className="final-doc__text">
                                {renderContent(finalContent.edgeCases)}
                              </div>
                            </div>
                          )}

                          {earlyResolutionRisk && (
                            <div className="final-doc__section">
                              <div className="final-doc__section-header">
                                <h3 className="final-doc__heading">
                                  {t('final.earlyResolutionRisk')}
                                  {earlyResolutionRiskLevel && earlyResolutionRiskLevel !== 'unknown' && (
                                    <span className={`risk-gate__level risk-gate__level--${earlyResolutionRiskLevel}`} style={{ marginLeft: '0.5rem' }}>
                                      {earlyResolutionRiskLevel === 'high'
                                        ? t('gate.high')
                                        : earlyResolutionRiskLevel === 'medium'
                                          ? t('gate.medium')
                                          : earlyResolutionRiskLevel === 'low'
                                            ? t('gate.low')
                                            : earlyResolutionRiskLevel.toUpperCase()}
                                    </span>
                                  )}
                                </h3>
                                <button
                                  className={`copy-btn ${copiedId === 'early-risk' ? 'copy-btn--copied' : ''}`}
                                  onClick={() => handleCopy(earlyResolutionRisk, 'early-risk')}
                                >
                                  {copiedId === 'early-risk' ? t('common.copied') : t('common.copy')}
                                </button>
                              </div>
                              <div className="final-doc__text final-doc__text--risk">
                                {renderContent(earlyResolutionRisk)}
                              </div>
                            </div>
                          )}
                        </div>
                      </details>
                    </div>
                  ) : (
                    <div className="final-doc">
                      {/* Question + Description */}
                      {finalContent.refinedQuestion && (
                        <div className="final-doc__question stagger-item" style={{ '--stagger': 1 }}>
                          {finalContent.refinedQuestion}
                        </div>
                      )}

                      {finalContent.shortDescription && (
                        <p className="final-doc__description stagger-item" style={{ '--stagger': 2 }}>{finalContent.shortDescription}</p>
                      )}

                      {/* Market Period */}
                      <div className="final-doc__period stagger-item" style={{ '--stagger': 3 }}>
                        <span className="final-doc__period-label">{t('final.marketPeriod')}</span>
                        <span className="final-doc__period-dates">
                          {finalContent.marketStartTimeUTC} &mdash; {finalContent.marketEndTimeUTC}
                        </span>
                      </div>

                      {resolutionDescriptionMarkdown && (
                        <div className="final-doc__section final-doc__section--description stagger-item" style={{ '--stagger': 4 }}>
                          <div className="final-doc__section-header">
                            <h3 className="final-doc__heading">{t('final.description')}</h3>
                            <button
                              className={`copy-btn ${copiedId === 'description-markdown' ? 'copy-btn--copied' : ''}`}
                              onClick={() => handleCopy(resolutionDescriptionMarkdown, 'description-markdown')}
                            >
                              {copiedId === 'description-markdown' ? t('common.copied') : t('common.copy')}
                            </button>
                          </div>
                          <div className="final-doc__text final-doc__text--markdown">
                            {renderContent(resolutionDescriptionMarkdown)}
                          </div>
                        </div>
                      )}

                      {/* Outcomes */}
                      {finalContent.outcomes?.length > 0 && (
                        <div className="final-doc__section stagger-item" style={{ '--stagger': 5 }}>
                          <h3 className="final-doc__heading">{t('final.outcomes', { n: finalContent.outcomes.length })}</h3>
                          <div className="final-doc__outcomes">
                            {finalContent.outcomes.map((outcome, index) => (
                              <div
                                key={index}
                                className="outcome-row stagger-item"
                                style={{ '--stagger': Math.min(5 + index, 8) }}
                              >
                                <div className="outcome-row__header">
                                  <span className="outcome-row__number">{index + 1}</span>
                                  <span className="outcome-row__name">{outcome.name}</span>
                                </div>
                                {outcome.winCondition && (
                                  <div className="outcome-row__win">
                                    <strong>{t('final.winsIf')}</strong> {outcome.winCondition}
                                  </div>
                                )}
                                <div className="outcome-row__criteria">
                                  <strong>{t('final.resolvedBy')}</strong> {outcome.resolutionCriteria}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Resolution Rules */}
                      {finalContent.fullResolutionRules && (
                        <div className="final-doc__section stagger-item" style={{ '--stagger': 8 }}>
                          <div className="final-doc__section-header">
                            <h3 className="final-doc__heading">{t('final.resolutionRules')}</h3>
                            <button
                              className={`copy-btn ${copiedId === 'rules' ? 'copy-btn--copied' : ''}`}
                              onClick={() => handleCopy(finalContent.fullResolutionRules, 'rules')}
                            >
                              {copiedId === 'rules' ? t('common.copied') : t('common.copy')}
                            </button>
                          </div>
                          <div className="final-doc__text">
                            {renderContent(finalContent.fullResolutionRules)}
                          </div>
                        </div>
                      )}

                      {/* Edge Cases */}
                      {finalContent.edgeCases && (
                        <div className="final-doc__section stagger-item" style={{ '--stagger': 8 }}>
                          <h3 className="final-doc__heading">{t('final.edgeCases')}</h3>
                          <div className="final-doc__text">
                            {renderContent(finalContent.edgeCases)}
                          </div>
                        </div>
                      )}

                      {/* Early-resolution risk — computed pre-finalize during
                          the Update → Finalize gate; shown here for reference. */}
                      {earlyResolutionRisk && (
                        <div className="final-doc__section stagger-item" style={{ '--stagger': 8 }}>
                          <div className="final-doc__section-header">
                            <h3 className="final-doc__heading">
                              {t('final.earlyResolutionRisk')}
                              {earlyResolutionRiskLevel && earlyResolutionRiskLevel !== 'unknown' && (
                                <span className={`risk-gate__level risk-gate__level--${earlyResolutionRiskLevel}`} style={{ marginLeft: '0.5rem' }}>
                                  {earlyResolutionRiskLevel === 'high'
                                    ? t('gate.high')
                                    : earlyResolutionRiskLevel === 'medium'
                                      ? t('gate.medium')
                                      : earlyResolutionRiskLevel === 'low'
                                        ? t('gate.low')
                                        : earlyResolutionRiskLevel.toUpperCase()}
                                </span>
                              )}
                            </h3>
                            <div className="col-panel-actions">
                              <span className="model-badge" data-tooltip={getModelName(selectedModel)} tabIndex={0} role="img" aria-label={t('common.modelAria', { name: getModelName(selectedModel) })}>{getModelAbbrev(selectedModel)}</span>
                              <button
                                className={`copy-btn ${copiedId === 'early-risk' ? 'copy-btn--copied' : ''}`}
                                onClick={() => handleCopy(earlyResolutionRisk, 'early-risk')}
                              >
                                {copiedId === 'early-risk' ? t('common.copied') : t('common.copy')}
                              </button>
                            </div>
                          </div>
                          <div className="final-doc__text final-doc__text--risk">
                            {renderContent(earlyResolutionRisk)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Phase 3: rigor provenance footer. Mirrors the chip on
                      the loading spinner so users can confirm which mode
                      this market was produced under after the run is done. */}
                  <p className={`final-doc__rigor-footer final-doc__rigor-footer--${displayRigor}`}>
                    {displayRigor === 'human' ? t('final.rigorHuman') : t('final.rigorMachine')}
                  </p>

                  <button className="reset-button" onClick={handleReset}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                    {t('final.createAnother')}
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>

        {/* Run trace panel — Phase 1. Collapsible, shows the current Run
            artifact (drafts, claims, cost) and provides export/import of
            the raw JSON for bug reports and round-trip verification. */}
        <section className="run-trace" aria-labelledby="run-trace-heading">
          <button
            type="button"
            className="run-trace__toggle"
            onClick={handleToggleRunTrace}
            aria-expanded={runTraceOpen}
          >
            <span id="run-trace-heading">{t('trace.heading')}</span>
            <span className="run-trace__chevron" aria-hidden="true">
              {runTraceOpen ? '▾' : '▸'}
            </span>
            {currentRun && (
              <span className="run-trace__summary">
                {t(currentRun.drafts.length === 1 ? 'trace.summaryDrafts' : 'trace.summaryDraftsPlural', { n: currentRun.drafts.length })}
                {' · '}
                {t(currentRun.claims.length === 1 ? 'trace.summaryClaims' : 'trace.summaryClaimsPlural', { n: currentRun.claims.length })}
                {' · '}
                {t('trace.summaryTokens', { n: currentRun.cost.totalTokensIn + currentRun.cost.totalTokensOut })}
              </span>
            )}
          </button>

          {runTraceOpen && (
            <div className="run-trace__body">
              <div className="run-trace__actions">
                <button
                  type="button"
                  className="run-trace__button"
                  onClick={handleExportRun}
                  disabled={!currentRun}
                >
                  {t('trace.exportRun')}
                </button>
                <label className="run-trace__button run-trace__button--import">
                  {t('trace.importRun')}
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportRun}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>

              {!currentRun && (
                <p className="run-trace__empty">
                  {t('trace.empty')}
                </p>
              )}

              {currentRun && (
                <>
                  <div className="run-trace__section">
                    <h4 className="run-trace__heading">
                      {t('trace.run', { id: currentRun.runId })}
                    </h4>
                    <div className="run-trace__kv">
                      <span>{t('trace.started')}</span>
                      <span>{new Date(currentRun.startedAt).toLocaleString()}</span>
                    </div>
                    <div className="run-trace__kv">
                      <span>{t('trace.question')}</span>
                      <span>{currentRun.input?.question || t('common.none')}</span>
                    </div>
                  </div>

                  <div className="run-trace__section">
                    <h4 className="run-trace__heading">
                      {t('trace.draftsHeading', { n: currentRun.drafts.length })}
                    </h4>
                    {currentRun.drafts.length === 0 ? (
                      <p className="run-trace__empty">{t('trace.noDrafts')}</p>
                    ) : (
                      <ol className="run-trace__list">
                        {currentRun.drafts.map((d, i) => (
                          <li key={i} className="run-trace__draft">
                            <div className="run-trace__draft-meta">
                              <span className="run-trace__badge">{d.kind}</span>
                              <span>{getModelName(d.model)}</span>
                              <span className="run-trace__ts">
                                {new Date(d.timestamp).toLocaleTimeString()}
                              </span>
                            </div>
                            <div className="run-trace__draft-preview">
                              {(d.content || '').slice(0, 200)}
                              {(d.content || '').length > 200 ? '…' : ''}
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>

                  <div className="run-trace__section">
                    <h4 className="run-trace__heading">
                      {t('trace.claimsHeading', { n: currentRun.claims.length })}
                    </h4>
                    {currentRun.claims.length === 0 ? (
                      <p className="run-trace__empty">
                        {t('trace.noClaims')}
                      </p>
                    ) : (
                      <ul className="run-trace__list">
                        {currentRun.claims.map((c) => (
                          <li key={c.id} className="run-trace__claim">
                            <code className="run-trace__claim-id">{c.id}</code>
                            <span className="run-trace__badge">{c.category}</span>
                            <span className="run-trace__claim-text">{c.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* Phase 2: aggregation checklist — only present once
                      handleReview has run. Shows the rubric decisions plus
                      every reviewer's vote under each item. */}
                  {currentRun.aggregation && (
                    <div className="run-trace__section">
                      <h4 className="run-trace__heading">
                        {t('trace.aggregationHeading', { protocol: currentRun.aggregation.protocol })} —{' '}
                        <span className={`run-trace__verdict run-trace__verdict--${currentRun.aggregation.overall}`}>
                          {currentRun.aggregation.overall}
                        </span>
                      </h4>
                      {currentRun.aggregation.judgeRationale && (
                        <p className="run-trace__judge-rationale">
                          {t('trace.judge', { rationale: currentRun.aggregation.judgeRationale })}
                        </p>
                      )}
                      {currentRun.aggregation.checklist.length === 0 ? (
                        <p className="run-trace__empty">
                          {t('trace.noChecklist')}
                        </p>
                      ) : (
                        <ul className="run-trace__list">
                          {currentRun.aggregation.checklist.map((item) => {
                            const rub = RUBRIC_BY_ID[item.id];
                            return (
                              <li key={item.id} className="run-trace__checklist-item">
                                <div className="run-trace__checklist-header">
                                  <span className={`run-trace__verdict run-trace__verdict--${item.decision}`}>
                                    {item.decision}
                                  </span>
                                  <code className="run-trace__claim-id">{item.id}</code>
                                  <span className="run-trace__checklist-question">
                                    {rub ? rub.question : item.question}
                                  </span>
                                </div>
                                {item.votes.length > 0 && (
                                  <ul className="run-trace__vote-list">
                                    {item.votes.map((v, i) => (
                                      <li key={i} className="run-trace__vote">
                                        <span className={`run-trace__badge run-trace__verdict--${v.verdict === 'yes' ? 'pass' : v.verdict === 'no' ? 'fail' : 'escalate'}`}>
                                          {v.verdict}
                                        </span>
                                        <span className="run-trace__ts">
                                          {getModelName(v.reviewerModel)}
                                        </span>
                                        {v.rationale && (
                                          <span className="run-trace__vote-rationale">
                                            — {v.rationale}
                                          </span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* Phase 2: real criticisms (replaced Phase 1's synthetic
                      global-criticism projection). Shown here so reviewers
                      can compare per-claim issues across models. */}
                  {currentRun.criticisms.length > 0 && (
                    <div className="run-trace__section">
                      <h4 className="run-trace__heading">
                        {t('trace.criticismsHeading', { n: currentRun.criticisms.length })}
                      </h4>
                      <ul className="run-trace__list">
                        {currentRun.criticisms.map((c) => (
                          <li key={c.id} className="run-trace__criticism">
                            <div className="run-trace__criticism-header">
                              <span className={`run-trace__badge run-trace__severity--${c.severity}`}>
                                {c.severity}
                              </span>
                              <span className="run-trace__badge">{c.category}</span>
                              <code className="run-trace__claim-id">{c.claimId}</code>
                              <span className="run-trace__ts">
                                {getModelName(c.reviewerModel)}
                              </span>
                            </div>
                            <div className="run-trace__criticism-text">{c.rationale}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Phase 3: claim verification. Structural + draft
                      entailment checks. Each line shows the per-claim
                      verdict plus a compact rationale pulled from either
                      the structural tool output or the entailment response. */}
                  {currentRun.verification.length > 0 && (
                    <div className="run-trace__section">
                      <h4 className="run-trace__heading">
                        {t('trace.verificationHeading', { n: currentRun.verification.length })}
                        {(() => {
                          const counts = currentRun.verification.reduce(
                            (acc, v) => {
                              acc[v.verdict] = (acc[v.verdict] || 0) + 1;
                              return acc;
                            },
                            {}
                          );
                          const parts = [];
                          if (counts.pass) parts.push(t('trace.verifyPass', { n: counts.pass }));
                          if (counts.soft_fail) parts.push(t('trace.verifySoft', { n: counts.soft_fail }));
                          if (counts.hard_fail) parts.push(t('trace.verifyHard', { n: counts.hard_fail }));
                          return parts.length > 0 ? (
                            <span className="run-trace__summary">
                              {' — '}
                              {parts.join(', ')}
                            </span>
                          ) : null;
                        })()}
                      </h4>
                      <ul className="run-trace__list">
                        {currentRun.verification.map((v) => {
                          // Choose verdict class: reuse aggregation colors
                          // (pass→pass, soft_fail→escalate, hard_fail→fail).
                          const verdictClass =
                            v.verdict === 'pass'
                              ? 'pass'
                              : v.verdict === 'hard_fail'
                                ? 'fail'
                                : 'escalate';
                          return (
                            <li key={v.claimId} className="run-trace__verification">
                              <div className="run-trace__verification-header">
                                <span className={`run-trace__badge run-trace__verdict--${verdictClass}`}>
                                  {v.verdict}
                                </span>
                                <span className="run-trace__badge">{v.entailment}</span>
                                <code className="run-trace__claim-id">{v.claimId}</code>
                                {v.citationResolves === false && (
                                  <span className="run-trace__badge run-trace__verdict--fail">
                                    {t('trace.urlMissing')}
                                  </span>
                                )}
                              </div>
                              {v.toolOutput && (
                                <div className="run-trace__verification-detail">
                                  {v.toolOutput}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {/* Phase 5: uncertainty-based routing. Shows the
                      overall decision (clean / needs_update / blocked)
                      plus a count per severity bucket. Individual claims
                      are listed under their bucket so the user can see
                      exactly which items the updater is being asked to
                      fix next. */}
                  {currentRun.routing && currentRun.routing.items.length > 0 && (
                    <div className="run-trace__section">
                      <h4 className="run-trace__heading">
                        {t('trace.routingHeading')}
                        <span className={`run-trace__badge run-trace__routing--${currentRun.routing.overall}`}>
                          {currentRun.routing.overall}
                        </span>
                        <span className="run-trace__summary">
                          {' — '}
                          {t('trace.routingBlocking', { n: currentRun.routing.items.filter((i) => i.severity === 'blocking').length })},{' '}
                          {t('trace.routingTargeted', { n: currentRun.routing.items.filter((i) => i.severity === 'targeted_review').length })},{' '}
                          {t('trace.routingOk', { n: currentRun.routing.items.filter((i) => i.severity === 'ok').length })}
                        </span>
                      </h4>
                      <ul className="run-trace__list">
                        {currentRun.routing.items
                          .slice()
                          .sort((a, b) => b.uncertainty - a.uncertainty)
                          .map((item) => (
                            <li key={item.claimId} className="run-trace__routing">
                              <div className="run-trace__routing-header">
                                <span className={`run-trace__badge run-trace__routing--${item.severity}`}>
                                  {item.severity}
                                </span>
                                <span className="run-trace__badge">
                                  u={item.uncertainty.toFixed(2)}
                                </span>
                                <code className="run-trace__claim-id">{item.claimId}</code>
                              </div>
                              {item.reasons.length > 0 && (
                                <div className="run-trace__routing-reasons">
                                  {item.reasons.map((r) => toSimpleRoutingReason(r, t)).join('; ')}
                                </div>
                              )}
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}

                  {/* Phase 4: harvested evidence with per-URL resolve
                      status. The resolve flag mirrors the underlying
                      source claim's Verification.citationResolves (when
                      linked to a source claim) or defaults to unknown. */}
                  {currentRun.evidence.length > 0 && (
                    <div className="run-trace__section">
                      <h4 className="run-trace__heading">
                        {t('trace.evidenceHeading', { n: currentRun.evidence.length })}
                        {(() => {
                          // Summarise resolve status: look up each evidence's
                          // owning source-claim verification (if any) and
                          // count the citationResolves flag. Non-source
                          // claims have no meaningful resolve signal here.
                          const verifByClaim = new Map(
                            currentRun.verification.map((v) => [v.claimId, v])
                          );
                          let resolved = 0;
                          let failed = 0;
                          for (const e of currentRun.evidence) {
                            const v = verifByClaim.get(e.claimId);
                            if (!v) continue;
                            if (v.citationResolves) resolved += 1;
                            else failed += 1;
                          }
                          if (resolved + failed === 0) return null;
                          return (
                            <span className="run-trace__summary">
                              {' — '}
                              {t('trace.evidenceResolved', { n: resolved })}
                              {failed > 0 ? t('trace.evidenceFailed', { n: failed }) : ''}
                            </span>
                          );
                        })()}
                      </h4>
                      <ul className="run-trace__list">
                        {currentRun.evidence.map((e) => {
                          const verif = currentRun.verification.find(
                            (v) => v.claimId === e.claimId
                          );
                          const resolveState =
                            verif && verif.citationResolves === false
                              ? 'failed'
                              : verif
                                ? 'resolved'
                                : 'unchecked';
                          return (
                            <li key={e.id} className="run-trace__evidence">
                              <div className="run-trace__evidence-header">
                                <span
                                  className={`run-trace__badge run-trace__evidence--${resolveState}`}
                                >
                                  {resolveState}
                                </span>
                                <code className="run-trace__claim-id">
                                  {e.claimId}
                                </code>
                              </div>
                              <a
                                href={e.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="run-trace__evidence-url"
                              >
                                {e.url}
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  <div className="run-trace__section">
                    <h4 className="run-trace__heading">{t('trace.cost')}</h4>
                    <div className="run-trace__kv">
                      <span>{t('trace.tokensIn')}</span>
                      <span>{currentRun.cost.totalTokensIn}</span>
                    </div>
                    <div className="run-trace__kv">
                      <span>{t('trace.tokensOut')}</span>
                      <span>{currentRun.cost.totalTokensOut}</span>
                    </div>
                    <div className="run-trace__kv">
                      <span>{t('trace.wallClock')}</span>
                      <span>{(currentRun.cost.wallClockMs / 1000).toFixed(1)}s</span>
                    </div>
                    {Object.keys(currentRun.cost.byStage).length > 0 && (
                      <div className="run-trace__by-stage">
                        {Object.entries(currentRun.cost.byStage).map(([stage, tokens]) => (
                          <div key={stage} className="run-trace__kv">
                            <span>↳ {stage}</span>
                            <span>{t('trace.tokens', { n: tokens })}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {currentRun.log.length > 0 && (
                    <div className="run-trace__section">
                      <h4 className="run-trace__heading">
                        {t('trace.logHeading', { n: currentRun.log.length })}
                      </h4>
                      <ul className="run-trace__list">
                        {currentRun.log.map((entry, i) => (
                          <li
                            key={i}
                            className={`run-trace__log run-trace__log--${entry.level}`}
                          >
                            <span className="run-trace__ts">
                              {new Date(entry.ts).toLocaleTimeString()}
                            </span>
                            <span className="run-trace__badge">{entry.stage}</span>
                            <span>{entry.message}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default App;
