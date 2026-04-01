import { useRef, useEffect } from 'react';
import './App.css';
import './ambient-modes.css';
import { AVAILABLE_MODELS, getModelName, getModelAbbrev } from './constants/models';
import LLMLoadingState from './components/LLMLoadingState';
import AmbientModeToggle from './components/AmbientModeToggle';
import AmbientOverlay from './components/AmbientOverlay';
import { useAmbientMode } from './hooks/useAmbientMode';
import {
  SYSTEM_PROMPTS,
  buildDraftPrompt,
  buildReviewPrompt,
  buildDeliberationPrompt,
  buildUpdatePrompt,
  buildFinalizePrompt,
  buildEarlyResolutionPrompt,
} from './constants/prompts';
import { queryModel, queryModelsParallel } from './api/openrouter';
import { useMarketReducer } from './hooks/useMarketReducer';
import ModelSelect from './components/ModelSelect';

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

function App() {
  const [state, dispatch] = useMarketReducer();
  const { mode: ambientMode, setMode: setAmbientMode, config: ambientConfig } = useAmbientMode('night');
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
    loading,
    loadingMeta,
    error,
    theme,
    dateError,
    draftContent,
    reviews,
    deliberatedReview,
    finalContent,
    hasUpdated,
    copiedId,
  } = state;

  const currentStep = finalContent ? 3 : draftContent ? 2 : 1;
  const anyLoading = loading !== null;
  const progressPercent = finalContent ? 100 : hasUpdated ? 75 : reviews.length > 0 ? 50 : draftContent? 33 : 0;

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

  // --- Stage 1: Draft (single model) ---
  const handleDraft = async () => {
    dispatch({ type: 'START_LOADING', phhase: 'draft', models: [getModelName(selectedModel)] });
    try {
      const content = await queryModel(selectedModel, [
        { role: 'system', content: SYSTEM_PROMPTS.drafter },
        { role: 'user', content: buildDraftPrompt(question, startDate, endDate, references) },
      ]);
      dispatch({ type: 'DRAFT_SUCCESS', content });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || 'Failed to generate draft' });
    }
  };

  // --- Stage 2: Multi-reviewer deliberation (inspired by llm-council Structure D) ---
  //
  // Phase 1: All selected review models review independently in parallel
  // Phase 2: If multiple reviewers, each sees the others' critiques and produces
  //          a consolidated deliberated review (like deliberate_synthesize.py)
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

      const successfulReviews = independentReviews.filter((r) => r.content !== null);

      if (successfulReviews.length === 0) {
        throw new Error('All reviewers failed. Please try again.');
      }

      // Phase 2: Deliberation â if we have multiple successful reviews,
      // use the first reviewer as "chairman" to synthesize a consolidated critique
      let deliberatedReview = null;

      if (successfulReviews.length > 1) {
        const deliberationPrompt = buildDeliberationPrompt(draftContent, successfulReviews);
        deliberatedReview = await queryModel(successfulReviews[0].model, [
          { role: 'system', content: SYSTEM_PROMPTS.reviewer },
          { role: 'user', content: deliberationPrompt },
        ]);
      }

      dispatch({
        type: 'REVIEW_SUCCESS',
        reviews: successfulReviews,
        deliberatedReview,
      });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || 'Failed to generate review' });
    }
  };

  // --- Stage 3: Update draft with review feedback ---
  const handleUpdate = async () => {
    if (!draftContent || reviews.length === 0) return;
    dispatch({ type: 'START_LOADING', phase: 'update', models: [getModelName(selectedModel)] });

    try {
      // Use the deliberated review if available, otherwise fall back to first review
      const reviewText = deliberatedReview || reviews[0].content;
      const content = await queryModel(selectedModel, [
        { role: 'system', content: SYSTEM_PROMPTS.drafter },
        { role: 'user', content: buildUpdatePrompt(draftContent, reviewText, humanReviewInput) },
      ]);
      dispatch({ type: 'UPDATE_SUCCESS', content });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || 'Failed to update draft' });
    }
  };

  // --- Stage 4: Finalize to structured JSON ---
  const handleAccept = async () => {
    if (!draftContent) return;
    dispatch({ type: 'START_LOADING', phase: 'accept', models: [getModelName(selectedModel)] });

    try {
      const content = await queryModel(
        selectedModel,
        [
          { role: 'system', content: SYSTEM_PROMPTS.finalizer },
          { role: 'user', content: buildFinalizePrompt(draftContent, startDate, endDate) },
        ],
        { temperature: 0.3 }
      );

      let parsedContent;
      try {
        const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (jsonMatch) {
          parsedContent = JSON.parse(jsonMatch[1]);
        } else {
          parsedContent = JSON.parse(content);
        }
      } catch {
        parsedContent = { raw: content };
      }

      dispatch({ type: 'FINALIZE_SUCCESS', content: parsedContent });

      // Auto-run early resolution risk analysis if we got structured output
      if (!parsedContent.raw) {
        dispatch({ type: 'START_EARLY_RESOLUTION', models: [getModelName(selectedModel)] });
        try {
          const riskContent = await queryModel(selectedModel, [
            { role: 'system', content: SYSTEM_PROMPTS.earlyResolutionAnalyst },
            { role: 'user', content: buildEarlyResolutionPrompt(parsedContent) },
          ]);
          dispatch({ type: 'EARLY_RESOLUTION_SUCCESS', content: riskContent });
        } catch (riskErr) {
          dispatch({ type: 'EARLY_RESOLUTION_ERROR', error: riskErr.message || 'Failed to analyze early resolution risk' });
        }
      }
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || 'Failed to finalize market' });
    }
  };

  const handleSubmitPastedDraft = () => {
    if (!pastedDraft.trim()) return;
    dispatch({ type: 'SUBMIT_PASTED_DRAFT', content: pastedDraft.trim() });
  };

  const handleReset = () => dispatch({ type: 'RESET' });

  return (
    <div className={`App ${ambientConfig.classes.join(' ')}`}>
      <AmbientOverlay mode={ambientMode} />
      <AmbientModeToggle mode={ambientMode} setMode={setAmbientMode} />
      <div className="container">

        {/* Header */}
        <header className="header">
          <div className="header__top-row">
            <h1>Market Creator<span className="wordmark-dot" /></h1>
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
              </div>

              {mode === 'draft' ? (
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
              ) : (
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

              {/* Draft output â stays in Panel 1 right under the button */}
              {loading === 'draft' && (
                <div className="draft-output-section fade-in">
                  <LLMLoadingState phase="draft" meta={loadingMeta} />
                </div>
              )}
              {draftContent && (
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
                            disabled={anyLoading}
                            onClick={handleAccept}
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

                  {/* Your Feedback */}
                  <div className="col-panel col-panel--review">
                    <div className="human-review-section">
                      <h2>Your Feedback</h2>
                      <span className="hint">Optional â included when you click Update Draft</span>
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
                            `\nMarket Period: ${finalContent.marketStartTimeUTC} â ${finalContent.marketEndTimeUTC}`,
                            finalContent.outcomes?.length > 0 && `\nOutcomes:\n${finalContent.outcomes.map((o, i) =>
                              `${i + 1}. ${o.name}\n   Winning Condition: ${o.winCondition || 'N/A'}\n   Resolution Criteria: ${o.resolutionCriteria}`
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
                                    <strong>Winning Condition:</strong> {outcome.winCondition}
                                  </div>
                                )}
                                <div className="outcome-row__criteria">
                                  <strong>Resolution Criteria:</strong> {outcome.resolutionCriteria}
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

                      {/* Early Resolution Risk */}
                      <div className="final-doc__section">
                        <div className="final-doc__section-header">
                          <h3 className="final-doc__heading">Early Resolution Risk</h3>
                          {finalContent.earlyResolutionRisk && (
                            <div className="col-panel-actions">
                              <span className="model-badge" data-tooltip={getModelName(selectedModel)}>{getModelAbbrev(selectedModel)}</span>
                              <button
                                className={`copy-btn ${copiedId === 'early-risk' ? 'copy-btn--copied' : ''}`}
                                onClick={() => handleCopy(finalContent.earlyResolutionRisk, 'early-risk')}
                              >
                                {copiedId === 'early-risk' ? 'Copied!' : 'Copy'}
                              </button>
                            </div>
                          )}
                        </div>
                        {loading === 'early-resolution' ? (
                          <LLMLoadingState phase="early-resolution" meta={loadingMeta} />
                        ) : finalContent.earlyResolutionRisk ? (
                          <div className="final-doc__text final-doc__text--risk fade-in">
                            {renderContent(finalContent.earlyResolutionRisk)}
                          </div>
                        ) : null}
                      </div>
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
      </div>
    </div>
  );
}

export default App;
