import { useRef, useEffect } from 'react';
import './App.css';
import './ambient-modes.css';
import { getModelName, getModelAbbrev } from './constants/models';
import { useModels } from './hooks/useModels';
import LLMLoadingState from './components/LLMLoadingState';
import {
  SYSTEM_PROMPTS,
  buildDraftPrompt,
  buildReviewPrompt,
  buildDeliberationPrompt,
  buildUpdatePrompt,
  buildFinalizePrompt,
  buildEarlyResolutionPrompt,
  buildIdeatePrompt,
} from './constants/prompts';
import { queryModel, queryModelsParallel } from './api/openrouter';
import { extractClaims } from './pipeline/extractClaims';
import { parseRun } from './types/run';
import { useMarketReducer } from './hooks/useMarketReducer';
import { useAmbientMode } from './hooks/useAmbientMode';
import ModelSelect from './components/ModelSelect';
import AmbientModeToggle from './components/AmbientModeToggle';

/** Lightweight markdown-ish rendering: **bold**, bullet lists, numbered lists */
function renderContent(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

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

function formatInline(text) {
  // Split on **bold** markers
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

// Parse the risk level out of the early-resolution analyst response. The
// prompt instructs the model to begin with "Risk rating: Low/Medium/High" —
// anything else falls back to 'unknown', which does NOT block the gate (only
// confirmed HIGH blocks).
function parseRiskLevel(text) {
  if (typeof text !== 'string' || text.length === 0) return 'unknown';
  const match = text.match(/risk\s*rating\s*[:-]?\s*(low|medium|high)/i);
  return match ? match[1].toLowerCase() : 'unknown';
}

function App() {
  const [state, dispatch] = useMarketReducer();
  const { mode: ambientMode, setMode: setAmbientMode, config: ambientConfig } = useAmbientMode();
  // Kicks off the initial OpenRouter model fetch + periodic refresh and
  // re-renders the app when the model list changes, so getModelName/abbrev
  // reflect the freshly fetched list.
  useModels();
  const panel2Ref = useRef(null);
  const panel3Ref = useRef(null);

  const {
    mode,
    question,
    startDate,
    endDate,
    references,
    selectedModel,
    reviewModels,
    humanReviewInput,
    pastedDraft,
    ideatingInput,
    ideatingModel,
    ideatingContent,
    loading,
    loadingMeta,
    error,
    dateError,
    draftContent,
    reviews,
    deliberatedReview,
    finalContent,
    hasUpdated,
    earlyResolutionRisk,
    earlyResolutionRiskLevel,
    earlyResolutionAcknowledged,
    currentRun,
    runTraceOpen,
    copiedId,
  } = state;

  // Phase 0 gate: Accept & Finalize is blocked when the early-resolution
  // analyst has flagged the updated draft as HIGH risk and the user has not
  // yet acknowledged it. Low / Medium / Unknown do not block.
  const needsRiskAck =
    earlyResolutionRiskLevel === 'high' && !earlyResolutionAcknowledged;

  const currentStep = finalContent ? 3 : draftContent ? 2 : 1;
  const anyLoading = loading !== null;
  const progressPercent = finalContent ? 100 : hasUpdated ? 75 : reviews.length > 0 ? 50 : draftContent ? 33 : 0;

  // Auto-scroll to active panel on mobile
  useEffect(() => {
    if (currentStep === 2 && panel2Ref.current) {
      panel2Ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (currentStep === 3 && panel3Ref.current) {
      panel3Ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentStep]);

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      dispatch({ type: 'SET_COPIED', id });
      setTimeout(() => dispatch({ type: 'SET_COPIED', id: null }), 2000);
    }).catch(() => {
      dispatch({ type: 'SET_ERROR', error: 'Failed to copy to clipboard' });
    });
  };

  const formatUTCDateHint = (dateString, suffix) => {
    if (!dateString) return null;
    const parsed = new Date(`${dateString}T${suffix}`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().replace('T', ' ').slice(0, -5);
  };

  const handleDismissError = () => dispatch({ type: 'SET_ERROR', error: null });

  const validateDates = (start, end) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (start) {
      const startDateObj = new Date(start);
      if (startDateObj <= today) return 'Start Date must be in the future';
    }
    if (start && end) {
      const startDateObj = new Date(start);
      const endDateObj = new Date(end);
      if (endDateObj <= startDateObj) return 'End Date must be later than Start Date';
    }
    return null;
  };

  const handleDateChange = (field, value) => {
    const newStart = field === 'startDate' ? value : startDate;
    const newEnd = field === 'endDate' ? value : endDate;
    dispatch({ type: 'SET_DATE', field, value, dateError: validateDates(newStart, newEnd) });
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
  };

  // --- Stage 1: Draft (single model) ---
  const handleDraft = async () => {
    dispatch({ type: 'START_LOADING', phase: 'draft', models: [getModelName(selectedModel)] });
    // Start a fresh Run artifact; previous run (if any) is discarded.
    dispatch({
      type: 'RUN_START',
      input: { question, startDate, endDate, references },
    });
    try {
      const result = await queryModel(selectedModel, [
        { role: 'system', content: SYSTEM_PROMPTS.drafter },
        { role: 'user', content: buildDraftPrompt(question, startDate, endDate, references) },
      ]);
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
      runClaimExtractorAndRecord(result.content);
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || 'Failed to generate draft' });
      dispatch({ type: 'RUN_LOG', stage: 'draft', level: 'error', message: err.message || 'Draft failed' });
    }
  };

  // --- Stage 2: Multi-reviewer deliberation (inspired by llm-council Structure D) ---
  //
  // Phase 1: All selected review models review independently in parallel. The
  //          successful reviews are projected into Criticism objects on the
  //          Run artifact with synthetic ids; Phase 2 will replace this with
  //          structured per-claim voting.
  const handleReview = async () => {
    if (!draftContent) return;
    dispatch({ type: 'START_LOADING', phase: 'review', models: reviewModels.map((id) => getModelName(id)) });

    try {
      const reviewerModels = reviewModels.map((id) => ({
        id,
        name: getModelName(id),
      }));

      // Phase 1: Independent parallel reviews
      const messages = [
        { role: 'system', content: SYSTEM_PROMPTS.reviewer },
        { role: 'user', content: buildReviewPrompt(draftContent) },
      ];
      const independentReviews = await queryModelsParallel(reviewerModels, messages);

      // Accumulate per-reviewer cost into the run artifact.
      for (const r of independentReviews) {
        if (r.content !== null && r.usage) {
          recordCost('review', { usage: r.usage, wallClockMs: r.wallClockMs });
        }
      }

      const successfulReviews = independentReviews.filter((r) => r.content !== null);

      if (successfulReviews.length === 0) {
        throw new Error('All reviewers failed. Please try again.');
      }

      // Phase 2: Deliberation — if we have multiple successful reviews,
      // use the first reviewer as "chairman" to synthesize a consolidated critique.
      // This chairman pattern is the brief's canonical single-point-of-failure
      // aggregator and will be replaced by a pluggable decision protocol in
      // Phase 2. For now we keep it so existing UI behaviour is preserved.
      let deliberatedReview = null;

      if (successfulReviews.length > 1) {
        const deliberationPrompt = buildDeliberationPrompt(draftContent, successfulReviews);
        const delibResult = await queryModel(successfulReviews[0].model, [
          { role: 'system', content: SYSTEM_PROMPTS.reviewer },
          { role: 'user', content: deliberationPrompt },
        ]);
        deliberatedReview = delibResult.content;
        recordCost('deliberation', delibResult);
      }

      dispatch({
        type: 'REVIEW_SUCCESS',
        reviews: successfulReviews,
        deliberatedReview,
      });

      // Run artifact: append a Criticism per successful reviewer. This is a
      // deliberately thin projection — Phase 2 will replace this with real
      // structured per-claim voting rooted in the Answer Contract.
      const now = Date.now();
      const criticisms = successfulReviews.map((r, i) => ({
        id: `criticism.${now}.${i}`,
        reviewerModel: r.model,
        claimId: 'global',
        severity: 'minor',
        category: 'other',
        rationale: (r.content || '').slice(0, 1000),
      }));
      dispatch({ type: 'RUN_APPEND_CRITICISMS', criticisms });

      // Trivial Phase-1 Aggregation: records that the aggregation stage ran
      // and nothing was escalated. Phase 2 replaces this with checklist-level
      // majority / unanimity / judge protocols.
      dispatch({
        type: 'RUN_SET_AGGREGATION',
        aggregation: {
          protocol: 'majority',
          checklist: [],
          judgeRationale: null,
          overall: 'pass',
        },
      });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || 'Failed to generate review' });
      dispatch({ type: 'RUN_LOG', stage: 'review', level: 'error', message: err.message || 'Review failed' });
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

    let updatedDraft;
    try {
      // Use the deliberated review if available, otherwise fall back to first review
      const reviewText = deliberatedReview || reviews[0].content;
      const result = await queryModel(selectedModel, [
        { role: 'system', content: SYSTEM_PROMPTS.drafter },
        { role: 'user', content: buildUpdatePrompt(draftContent, reviewText, humanReviewInput) },
      ]);
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
      runClaimExtractorAndRecord(updatedDraft);
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || 'Failed to update draft' });
      dispatch({ type: 'RUN_LOG', stage: 'update', level: 'error', message: err.message || 'Update failed' });
      return;
    }

    // Chain: early-resolution risk check on the updated draft.
    dispatch({ type: 'START_EARLY_RESOLUTION', models: [getModelName(selectedModel)] });
    try {
      const riskResult = await queryModel(selectedModel, [
        { role: 'system', content: SYSTEM_PROMPTS.earlyResolutionAnalyst },
        { role: 'user', content: buildEarlyResolutionPrompt(updatedDraft, startDate, endDate) },
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
        error: riskErr.message || 'Failed to analyze early resolution risk',
      });
      dispatch({
        type: 'RUN_LOG',
        stage: 'early_resolution',
        level: 'error',
        message: riskErr.message || 'Early resolution check failed',
      });
    }
  };

  // --- Stage 4: Finalize to structured JSON ---
  // The early-resolution gate (set during handleUpdate) must be cleared
  // before this runs; the Accept button is disabled when needsRiskAck is true.
  const handleAccept = async () => {
    if (!draftContent) return;
    if (needsRiskAck) return; // belt-and-braces; button should already be disabled
    dispatch({ type: 'START_LOADING', phase: 'accept', models: [getModelName(selectedModel)] });

    try {
      const result = await queryModel(
        selectedModel,
        [
          { role: 'system', content: SYSTEM_PROMPTS.finalizer },
          { role: 'user', content: buildFinalizePrompt(draftContent, startDate, endDate) },
        ],
        { temperature: 0.3 }
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

      dispatch({ type: 'FINALIZE_SUCCESS', content: parsedContent });
      dispatch({ type: 'RUN_SET_FINAL', finalJson: parsedContent });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || 'Failed to finalize market' });
      dispatch({ type: 'RUN_LOG', stage: 'accept', level: 'error', message: err.message || 'Finalize failed' });
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
      input: { question, startDate, endDate, references },
    });
    dispatch({
      type: 'RUN_APPEND_DRAFT',
      model: 'pasted',
      content: trimmed,
      kind: 'initial',
    });
    runClaimExtractorAndRecord(trimmed);
  };

  // --- Ideating: generate market ideas from vague user direction ---
  const handleIdeate = async () => {
    dispatch({ type: 'START_LOADING', phase: 'ideate', models: [getModelName(ideatingModel)] });
    try {
      const result = await queryModel(ideatingModel, [
        { role: 'system', content: SYSTEM_PROMPTS.ideator },
        { role: 'user', content: buildIdeatePrompt(ideatingInput) },
      ]);
      dispatch({ type: 'IDEATE_SUCCESS', content: result.content });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || 'Failed to generate market ideas' });
    }
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
      dispatch({ type: 'SET_ERROR', error: `Failed to export run: ${err.message || err}` });
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
          dispatch({ type: 'SET_ERROR', error: 'Import failed: file is not a valid Run JSON.' });
          return;
        }
        dispatch({ type: 'RUN_IMPORT', run });
      } catch (err) {
        dispatch({ type: 'SET_ERROR', error: `Import failed: ${err.message || err}` });
      }
    };
    reader.onerror = () => {
      dispatch({ type: 'SET_ERROR', error: 'Failed to read import file.' });
    };
    reader.readAsText(file);
  };

  const handleToggleRunTrace = () => dispatch({ type: 'TOGGLE_RUN_TRACE' });

  return (
    <div className={`App ${ambientConfig.classes.join(' ')}`}>
      <div className="container">

        {/* Header */}
        <header className="header">
          <div className="header__top-row">
            <AmbientModeToggle mode={ambientMode} setMode={setAmbientMode} />
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
                <div className="step__label">Setup</div>
              </div>
            </div>
            <div className="panel-body">
              {/* Mode Toggle */}
              <div className="mode-toggle">
                <button
                  type="button"
                  className={`mode-toggle__btn ${mode === 'draft' ? 'mode-toggle__btn--active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_FIELD', field: 'mode', value: 'draft' })}
                  disabled={anyLoading}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                  Draft Market
                </button>
                <button
                  type="button"
                  className={`mode-toggle__btn ${mode === 'review' ? 'mode-toggle__btn--active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_FIELD', field: 'mode', value: 'review' })}
                  disabled={anyLoading}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                  Review Market
                </button>
                <button
                  type="button"
                  className={`mode-toggle__btn ${mode === 'ideating' ? 'mode-toggle__btn--active' : ''}`}
                  onClick={() => dispatch({ type: 'SET_FIELD', field: 'mode', value: 'ideating' })}
                  disabled={anyLoading}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2z" /></svg>
                  Ideating
                </button>
              </div>

              {mode === 'draft' && (
              <div className="market-form">
                <div className="form-group">
                  <label htmlFor="question">Prediction Market Question</label>
                  <input
                    id="question"
                    type="text"
                    value={question}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'question', value: e.target.value })}
                    placeholder="e.g., Will AI achieve AGI by 2030?"
                    className="input"
                    disabled={loading === 'draft'}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="startDate">Start Date</label>
                    <input
                      id="startDate"
                      type="date"
                      value={startDate}
                      onChange={(e) => handleDateChange('startDate', e.target.value)}
                      className="input"
                      disabled={loading === 'draft'}
                    />
                    {startDate && (
                      <p className="utc-hint">
                        {formatUTCDateHint(startDate, '00:00:00')} UTC
                      </p>
                    )}
                  </div>
                  <div className="form-group">
                    <label htmlFor="endDate">End Date</label>
                    <input
                      id="endDate"
                      type="date"
                      value={endDate}
                      onChange={(e) => handleDateChange('endDate', e.target.value)}
                      className="input"
                      disabled={loading === 'draft'}
                    />
                    {endDate && (
                      <p className="utc-hint">
                        {formatUTCDateHint(endDate, '23:59:59')} UTC
                      </p>
                    )}
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="references">
                    References <span className="label-hint">(optional)</span>
                  </label>
                  <textarea
                    id="references"
                    value={references}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'references', value: e.target.value })}
                    placeholder="Paste links or notes for the AI to reference, one per line..."
                    className="input textarea"
                    disabled={loading === 'draft'}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="model">Drafting Model</label>
                  <ModelSelect
                    id="model"
                    value={selectedModel}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'selectedModel', value: e.target.value })}
                    className="input"
                    disabled={loading === 'draft'}
                  />
                </div>

                {dateError && (
                  <div className="error-message">
                    <span>{dateError}</span>
                    <button className="error-dismiss" onClick={() => dispatch({ type: 'SET_DATE', field: 'startDate', value: startDate, dateError: null })} aria-label="Dismiss">&times;</button>
                  </div>
                )}
                {error && (
                  <div className="error-message">
                    <span>{error}</span>
                    <button className="error-dismiss" onClick={handleDismissError} aria-label="Dismiss">&times;</button>
                  </div>
                )}

                <button
                  type="button"
                  className="draft-button"
                  disabled={loading === 'draft' || !question.trim() || !startDate || !endDate || !!dateError}
                  onClick={handleDraft}
                >
                  {loading === 'draft' ? (
                    <>
                      <span className="spinner" />
                      Drafting...
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                      Draft Market
                    </>
                  )}
                </button>
              </div>
              )}

              {mode === 'review' && (
              <div className="market-form">
                <div className="form-group">
                  <label htmlFor="pastedDraft">Paste Existing Draft</label>
                  <textarea
                    id="pastedDraft"
                    value={pastedDraft}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'pastedDraft', value: e.target.value })}
                    placeholder="Paste your existing market draft here..."
                    className="input textarea textarea--tall"
                  />
                </div>

                {error && (
                  <div className="error-message">
                    <span>{error}</span>
                    <button className="error-dismiss" onClick={handleDismissError} aria-label="Dismiss">&times;</button>
                  </div>
                )}

                <button
                  type="button"
                  className="draft-button"
                  disabled={!pastedDraft.trim()}
                  onClick={handleSubmitPastedDraft}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  Submit for Review
                </button>
              </div>
              )}

              {mode === 'ideating' && (
              <div className="market-form">
                <div className="form-group">
                  <label htmlFor="ideatingInput">Vague Direction</label>
                  <textarea
                    id="ideatingInput"
                    value={ideatingInput}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'ideatingInput', value: e.target.value })}
                    placeholder="Describe a rough area of interest — e.g., 'AI regulation in 2026', 'upcoming crypto ETF decisions', 'European elections'. The model will research and brainstorm market ideas."
                    className="input textarea textarea--tall"
                    disabled={loading === 'ideate'}
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="ideatingModel">Ideation Model</label>
                  <ModelSelect
                    id="ideatingModel"
                    value={ideatingModel}
                    onChange={(e) => dispatch({ type: 'SET_FIELD', field: 'ideatingModel', value: e.target.value })}
                    className="input"
                    disabled={loading === 'ideate'}
                  />
                </div>

                {error && (
                  <div className="error-message">
                    <span>{error}</span>
                    <button className="error-dismiss" onClick={handleDismissError} aria-label="Dismiss">&times;</button>
                  </div>
                )}

                <button
                  type="button"
                  className="draft-button"
                  disabled={loading === 'ideate' || !ideatingInput.trim()}
                  onClick={handleIdeate}
                >
                  {loading === 'ideate' ? (
                    <>
                      <span className="spinner" />
                      Ideating...
                    </>
                  ) : (
                    <>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18h6" /><path d="M10 22h4" /><path d="M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2z" /></svg>
                      Generate Ideas
                    </>
                  )}
                </button>

                {loading === 'ideate' && (
                  <div className="draft-output-section fade-in">
                    <LLMLoadingState phase="ideate" meta={loadingMeta} />
                  </div>
                )}

                {ideatingContent && loading !== 'ideate' && (
                  <div className="draft-output-section fade-in">
                    <div className="col-panel col-panel--draft">
                      <div className="col-panel-header">
                        <h2>Market Ideas</h2>
                        <div className="col-panel-actions">
                          <span className="model-badge" data-tooltip={getModelName(ideatingModel)}>{getModelAbbrev(ideatingModel)}</span>
                          <button
                            className={`copy-btn ${copiedId === 'ideating' ? 'copy-btn--copied' : ''}`}
                            onClick={() => handleCopy(ideatingContent, 'ideating')}
                          >
                            {copiedId === 'ideating' ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                      </div>
                      <div className="content-box content-box--rich">
                        {renderContent(ideatingContent)}
                      </div>
                    </div>
                  </div>
                )}
              </div>
              )}

              {/* Draft output — stays in Panel 1 right under the button */}
              {mode !== 'ideating' && loading === 'draft' && (
                <div className="draft-output-section fade-in">
                  <LLMLoadingState phase="draft" meta={loadingMeta} />
                </div>
              )}
              {mode !== 'ideating' && draftContent && (
                <div className="draft-output-section fade-in">
                  <div className="col-panel col-panel--draft">
                    <div className="col-panel-header">
                      <h2>Draft</h2>
                      <div className="col-panel-actions">
                        <span className="model-badge" data-tooltip={getModelName(selectedModel)}>{getModelAbbrev(selectedModel)}</span>
                        <button
                          className={`copy-btn ${copiedId === 'draft' ? 'copy-btn--copied' : ''}`}
                          onClick={() => handleCopy(draftContent, 'draft')}
                        >
                          {copiedId === 'draft' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                    <div className="content-box content-box--rich">
                      {renderContent(draftContent)}
                    </div>
                  </div>
                </div>
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
                <div className="step__label">Draft & Review</div>
              </div>
            </div>
            <div className="panel-body">
              {!draftContent ? (
                <div className="panel-placeholder">
                  <div className="placeholder-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                  </div>
                  <p>Complete setup and draft a market to continue</p>
                </div>
              ) : (
                <div className="draft-review-section fade-in">

                  {/* Action Toolbar */}
                  <div className="action-toolbar">
                    {/* Multi-reviewer selector */}
                    <div className="toolbar-group">
                      <label>Review Council</label>
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
                                title="Remove reviewer"
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
                            + Add Reviewer
                          </button>
                        )}
                      </div>
                      <span className="toolbar-hint">
                        {reviewModels.length > 1
                          ? 'Multiple reviewers will deliberate to produce a stronger critique'
                          : 'Add more reviewers for multi-model deliberation'}
                      </span>
                    </div>

                    <div className="toolbar-divider" />

                    <div className="toolbar-actions">
                      <div className="toolbar-group toolbar-group--primary">
                        <button
                          type="button"
                          className="review-button--primary"
                          disabled={anyLoading}
                          onClick={handleReview}
                        >
                          {loading === 'review' ? (
                            <>
                              <span className="spinner" />
                              {reviewModels.length > 1 ? 'Deliberating...' : 'Reviewing...'}
                            </>
                          ) : (
                            <>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                              {reviewModels.length > 1 ? 'Review & Deliberate' : 'Review'}
                            </>
                          )}
                        </button>
                      </div>

                      {reviews.length > 0 && (
                        <div className="toolbar-group">
                          <button
                            type="button"
                            className="review-button"
                            disabled={anyLoading}
                            onClick={handleUpdate}
                          >
                            {loading === 'update' ? (
                              <>
                                <span className="spinner" />
                                Updating...
                              </>
                            ) : (
                              <>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
                                Update Draft
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
                            disabled={anyLoading || needsRiskAck}
                            onClick={handleAccept}
                            title={needsRiskAck ? 'Acknowledge the HIGH early-resolution risk below before finalizing.' : undefined}
                          >
                            {loading === 'accept' ? (
                              <>
                                <span className="spinner" />
                                Finalizing...
                              </>
                            ) : (
                              <>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                                Accept & Finalize
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
                      className={`risk-gate risk-gate--${earlyResolutionRiskLevel || 'checking'} fade-in`}
                      role={earlyResolutionRiskLevel === 'high' ? 'alert' : 'status'}
                    >
                      <div className="risk-gate__header">
                        <span className="risk-gate__label">Early-Resolution Risk</span>
                        {loading === 'early-resolution' ? (
                          <span className="risk-gate__level risk-gate__level--checking">
                            <span className="spinner" /> Checking…
                          </span>
                        ) : (
                          <span className={`risk-gate__level risk-gate__level--${earlyResolutionRiskLevel}`}>
                            {earlyResolutionRiskLevel === 'unknown'
                              ? 'Unknown'
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
                            This market may resolve before its end date. Acknowledge the risk to unlock Finalize,
                            or revise the draft (e.g. add an explicit early-resolution clause, shorten the window,
                            or tighten the outcome set).
                          </p>
                          <button
                            type="button"
                            className="risk-gate__ack-btn"
                            onClick={() => dispatch({ type: 'ACKNOWLEDGE_EARLY_RESOLUTION' })}
                          >
                            Acknowledge HIGH risk & unlock Finalize
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Your Feedback */}
                  <div className="col-panel col-panel--review">
                    <div className="human-review-section">
                      <h2>Your Feedback</h2>
                      <span className="hint">Optional — included when you click Update Draft</span>
                      <textarea
                        value={humanReviewInput}
                        onChange={(e) =>
                          dispatch({ type: 'SET_FIELD', field: 'humanReviewInput', value: e.target.value })
                        }
                        placeholder="Add your own critiques or additional feedback..."
                        className="input textarea"
                        disabled={loading === 'update'}
                      />
                    </div>
                  </div>

                  {/* Loading state for review */}
                  {loading === 'review' && reviews.length === 0 && (
                    <div className="col-panel col-panel--review">
                      <LLMLoadingState phase="review" meta={loadingMeta} />
                    </div>
                  )}

                  {/* Agent Review content */}
                  {reviews.length > 0 && (
                    <div className="col-panel col-panel--review fade-in">
                      {deliberatedReview && (
                        <div className="fade-in">
                          <div className="col-panel-header">
                            <h2>Deliberated Review</h2>
                            <div className="col-panel-actions">
                              <span className="model-badge deliberation-badge" data-tooltip="Council Deliberation">C</span>
                              <button
                                className={`copy-btn ${copiedId === 'deliberated' ? 'copy-btn--copied' : ''}`}
                                onClick={() => handleCopy(deliberatedReview, 'deliberated')}
                              >
                                {copiedId === 'deliberated' ? 'Copied!' : 'Copy'}
                              </button>
                            </div>
                          </div>
                          <div className="content-box content-box--rich">
                            {renderContent(deliberatedReview)}
                          </div>
                        </div>
                      )}

                      {reviews.map((review, idx) => (
                        <div key={idx} className={`${deliberatedReview ? 'individual-review' : ''} fade-in`}>
                          <div className="col-panel-header">
                            <h2>{deliberatedReview ? `Reviewer ${idx + 1}` : 'Agent Review'}</h2>
                            <div className="col-panel-actions">
                              <span className="model-badge" data-tooltip={review.modelName}>{getModelAbbrev(review.model)}</span>
                              <button
                                className={`copy-btn ${copiedId === `review-${idx}` ? 'copy-btn--copied' : ''}`}
                                onClick={() => handleCopy(review.content, `review-${idx}`)}
                              >
                                {copiedId === `review-${idx}` ? 'Copied!' : 'Copy'}
                              </button>
                            </div>
                          </div>
                          <div className="content-box content-box--rich">
                            {renderContent(review.content)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
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
                <div className="step__label">Finalize</div>
              </div>
            </div>
            <div className="panel-body">
              {!finalContent && loading !== 'accept' ? (
                <div className="panel-placeholder">
                  <div className="placeholder-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                  </div>
                  <p>Draft, review, and update your market to finalize</p>
                </div>
              ) : loading === 'accept' ? (
                <LLMLoadingState phase="accept" meta={loadingMeta} />
              ) : (
                <div className="final-content fade-in">
                  <div className="final-header">
                    <div className="final-header__icon">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                    </div>
                    <h2>Final Market Details</h2>
                    <div className="final-header__actions">
                      <button
                        className={`copy-btn ${copiedId === 'full-output' ? 'copy-btn--copied' : ''}`}
                        onClick={() => {
                          const text = [
                            finalContent.refinedQuestion && `Question: ${finalContent.refinedQuestion}`,
                            finalContent.shortDescription && `\nDescription: ${finalContent.shortDescription}`,
                            `\nMarket Period: ${finalContent.marketStartTimeUTC} — ${finalContent.marketEndTimeUTC}`,
                            finalContent.outcomes?.length > 0 && `\nOutcomes:\n${finalContent.outcomes.map((o, i) =>
                              `${i + 1}. ${o.name}\n   Wins if: ${o.winCondition || 'N/A'}\n   Resolved by: ${o.resolutionCriteria}`
                            ).join('\n')}`,
                            finalContent.fullResolutionRules && `\nFull Resolution Rules:\n${finalContent.fullResolutionRules}`,
                            finalContent.edgeCases && `\nEdge Cases:\n${finalContent.edgeCases}`,
                          ].filter(Boolean).join('\n');
                          handleCopy(text, 'full-output');
                        }}
                      >
                        {copiedId === 'full-output' ? 'Copied!' : 'Copy All'}
                      </button>
                    </div>
                  </div>

                  {finalContent.raw ? (
                    <div className="final-doc">
                      <div className="content-box content-box--rich">
                        {renderContent(finalContent.raw)}
                      </div>
                    </div>
                  ) : (
                    <div className="final-doc">
                      {/* Question + Description */}
                      {finalContent.refinedQuestion && (
                        <div className="final-doc__question">
                          {finalContent.refinedQuestion}
                        </div>
                      )}

                      {finalContent.shortDescription && (
                        <p className="final-doc__description">{finalContent.shortDescription}</p>
                      )}

                      {/* Market Period */}
                      <div className="final-doc__period">
                        <span className="final-doc__period-label">Market Period</span>
                        <span className="final-doc__period-dates">
                          {finalContent.marketStartTimeUTC} &mdash; {finalContent.marketEndTimeUTC}
                        </span>
                      </div>

                      {/* Outcomes */}
                      {finalContent.outcomes?.length > 0 && (
                        <div className="final-doc__section">
                          <h3 className="final-doc__heading">Outcomes ({finalContent.outcomes.length})</h3>
                          <div className="final-doc__outcomes">
                            {finalContent.outcomes.map((outcome, index) => (
                              <div key={index} className="outcome-row">
                                <div className="outcome-row__header">
                                  <span className="outcome-row__number">{index + 1}</span>
                                  <span className="outcome-row__name">{outcome.name}</span>
                                </div>
                                {outcome.winCondition && (
                                  <div className="outcome-row__win">
                                    <strong>Wins if:</strong> {outcome.winCondition}
                                  </div>
                                )}
                                <div className="outcome-row__criteria">
                                  <strong>Resolved by:</strong> {outcome.resolutionCriteria}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Resolution Rules */}
                      {finalContent.fullResolutionRules && (
                        <div className="final-doc__section">
                          <div className="final-doc__section-header">
                            <h3 className="final-doc__heading">Resolution Rules</h3>
                            <button
                              className={`copy-btn ${copiedId === 'rules' ? 'copy-btn--copied' : ''}`}
                              onClick={() => handleCopy(finalContent.fullResolutionRules, 'rules')}
                            >
                              {copiedId === 'rules' ? 'Copied!' : 'Copy'}
                            </button>
                          </div>
                          <div className="final-doc__text">
                            {renderContent(finalContent.fullResolutionRules)}
                          </div>
                        </div>
                      )}

                      {/* Edge Cases */}
                      {finalContent.edgeCases && (
                        <div className="final-doc__section">
                          <h3 className="final-doc__heading">Edge Cases</h3>
                          <div className="final-doc__text">
                            {renderContent(finalContent.edgeCases)}
                          </div>
                        </div>
                      )}

                      {/* Early-resolution risk — computed pre-finalize during
                          the Update → Finalize gate; shown here for reference. */}
                      {earlyResolutionRisk && (
                        <div className="final-doc__section">
                          <div className="final-doc__section-header">
                            <h3 className="final-doc__heading">
                              Early Resolution Risk
                              {earlyResolutionRiskLevel && earlyResolutionRiskLevel !== 'unknown' && (
                                <span className={`risk-gate__level risk-gate__level--${earlyResolutionRiskLevel}`} style={{ marginLeft: '0.5rem' }}>
                                  {earlyResolutionRiskLevel.toUpperCase()}
                                </span>
                              )}
                            </h3>
                            <div className="col-panel-actions">
                              <span className="model-badge" data-tooltip={getModelName(selectedModel)}>{getModelAbbrev(selectedModel)}</span>
                              <button
                                className={`copy-btn ${copiedId === 'early-risk' ? 'copy-btn--copied' : ''}`}
                                onClick={() => handleCopy(earlyResolutionRisk, 'early-risk')}
                              >
                                {copiedId === 'early-risk' ? 'Copied!' : 'Copy'}
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

                  <button className="reset-button" onClick={handleReset}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
                    Create Another Market
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
            <span id="run-trace-heading">Run trace</span>
            <span className="run-trace__chevron" aria-hidden="true">
              {runTraceOpen ? '▾' : '▸'}
            </span>
            {currentRun && (
              <span className="run-trace__summary">
                {currentRun.drafts.length} draft{currentRun.drafts.length === 1 ? '' : 's'}
                {' · '}
                {currentRun.claims.length} claim{currentRun.claims.length === 1 ? '' : 's'}
                {' · '}
                {currentRun.cost.totalTokensIn + currentRun.cost.totalTokensOut} tok
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
                  Export run as JSON
                </button>
                <label className="run-trace__button run-trace__button--import">
                  Import run
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
                  No run yet. Generate or submit a draft to start a run.
                </p>
              )}

              {currentRun && (
                <>
                  <div className="run-trace__section">
                    <h4 className="run-trace__heading">
                      Run {currentRun.runId}
                    </h4>
                    <div className="run-trace__kv">
                      <span>Started</span>
                      <span>{new Date(currentRun.startedAt).toLocaleString()}</span>
                    </div>
                    <div className="run-trace__kv">
                      <span>Question</span>
                      <span>{currentRun.input?.question || '(none)'}</span>
                    </div>
                  </div>

                  <div className="run-trace__section">
                    <h4 className="run-trace__heading">
                      Drafts ({currentRun.drafts.length})
                    </h4>
                    {currentRun.drafts.length === 0 ? (
                      <p className="run-trace__empty">No drafts yet.</p>
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
                      Claims ({currentRun.claims.length})
                    </h4>
                    {currentRun.claims.length === 0 ? (
                      <p className="run-trace__empty">
                        No claims extracted yet.
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

                  <div className="run-trace__section">
                    <h4 className="run-trace__heading">Cost</h4>
                    <div className="run-trace__kv">
                      <span>Tokens in</span>
                      <span>{currentRun.cost.totalTokensIn}</span>
                    </div>
                    <div className="run-trace__kv">
                      <span>Tokens out</span>
                      <span>{currentRun.cost.totalTokensOut}</span>
                    </div>
                    <div className="run-trace__kv">
                      <span>Wall clock</span>
                      <span>{(currentRun.cost.wallClockMs / 1000).toFixed(1)}s</span>
                    </div>
                    {Object.keys(currentRun.cost.byStage).length > 0 && (
                      <div className="run-trace__by-stage">
                        {Object.entries(currentRun.cost.byStage).map(([stage, tokens]) => (
                          <div key={stage} className="run-trace__kv">
                            <span>↳ {stage}</span>
                            <span>{tokens} tok</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {currentRun.log.length > 0 && (
                    <div className="run-trace__section">
                      <h4 className="run-trace__heading">
                        Log ({currentRun.log.length})
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
