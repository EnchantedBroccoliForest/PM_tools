import './App.css';
import { AVAILABLE_MODELS, getModelName, getModelAbbrev } from './constants/models';
import {
  SYSTEM_PROMPTS,
  buildDraftPrompt,
  buildReviewPrompt,
  buildDeliberationPrompt,
  buildUpdatePrompt,
  buildFinalizePrompt,
} from './constants/prompts';
import { queryModel, queryModelsParallel } from './api/openrouter';
import { useMarketReducer } from './hooks/useMarketReducer';
import ModelSelect from './components/ModelSelect';

function App() {
  const [state, dispatch] = useMarketReducer();

  const {
    question,
    startDate,
    endDate,
    selectedModel,
    reviewModels,
    humanReviewInput,
    loading,
    error,
    dateError,
    draftContent,
    reviews,
    deliberatedReview,
    finalContent,
    hasUpdated,
    copiedId,
    referenceLinks,
    referenceFiles,
  } = state;

  const currentStep = finalContent ? 3 : draftContent ? 2 : 1;
  const anyLoading = loading !== null;

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      dispatch({ type: 'SET_COPIED', id });
      setTimeout(() => dispatch({ type: 'SET_COPIED', id: null }), 2000);
    });
  };

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

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const readers = files.map(
      (file) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: file.name, content: reader.result });
          reader.onerror = () => resolve({ name: file.name, content: '[Failed to read file]' });
          reader.readAsText(file);
        })
    );

    Promise.all(readers).then((results) => {
      dispatch({ type: 'ADD_REFERENCE_FILES', files: results });
    });

    e.target.value = '';
  };

  // --- Stage 1: Draft (single model) ---
  const handleDraft = async () => {
    dispatch({ type: 'START_LOADING', phase: 'draft' });
    try {
      const content = await queryModel(selectedModel, [
        { role: 'system', content: SYSTEM_PROMPTS.drafter },
        { role: 'user', content: buildDraftPrompt(question, startDate, endDate, { links: referenceLinks, files: referenceFiles }) },
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
    dispatch({ type: 'START_LOADING', phase: 'review' });

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

      // Phase 2: Deliberation — if we have multiple successful reviews,
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
    dispatch({ type: 'START_LOADING', phase: 'update' });

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
    dispatch({ type: 'START_LOADING', phase: 'accept' });

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
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: err.message || 'Failed to finalize market' });
    }
  };

  const handleReset = () => dispatch({ type: 'RESET' });

  return (
    <div className="App">
      <div className="container">

        {/* Header */}
        <header className="header">
          <h1>Market Creator<span className="wordmark-dot" /></h1>
          <p className="subtitle">AI-assisted prediction market creation via OpenRouter</p>
        </header>

        {/* Horizontal Panels */}
        <div className="panels-row">

          {/* Panel 1: Setup */}
          <div className={`panel ${currentStep === 1 ? 'panel--active' : ''} ${currentStep > 1 ? 'panel--done' : ''}`}>
            <div className="panel-header">
              <div className={`step ${currentStep >= 1 ? 'step--active' : ''} ${currentStep > 1 ? 'step--done' : ''}`}>
                <div className="step__number">1</div>
                <div className="step__label">Setup</div>
              </div>
            </div>
            <div className="panel-body">
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
                      <span>&#128336;</span> {new Date(startDate + 'T00:00:00').toISOString().replace('T', ' ').slice(0, -5)} UTC
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
                      <span>&#128336;</span> {new Date(endDate + 'T23:59:59').toISOString().replace('T', ' ').slice(0, -5)} UTC
                    </p>
                  )}
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

                <div className="form-group">
                  <label>References <span className="optional-tag">Optional</span></label>
                  <div className="reference-links">
                    {referenceLinks.map((link, idx) => (
                      <div key={idx} className="reference-link-row">
                        <input
                          type="url"
                          value={link}
                          onChange={(e) =>
                            dispatch({ type: 'SET_REFERENCE_LINK', index: idx, value: e.target.value })
                          }
                          placeholder="https://..."
                          className="input"
                          disabled={loading === 'draft'}
                        />
                        {referenceLinks.length > 1 && (
                          <button
                            type="button"
                            className="remove-reviewer-btn"
                            onClick={() => dispatch({ type: 'REMOVE_REFERENCE_LINK', index: idx })}
                            disabled={loading === 'draft'}
                            title="Remove link"
                          >
                            x
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      className="add-reviewer-btn"
                      onClick={() => dispatch({ type: 'ADD_REFERENCE_LINK' })}
                      disabled={loading === 'draft'}
                    >
                      + Add Link
                    </button>
                  </div>

                  <div className="reference-files">
                    <label className="file-upload-btn" aria-disabled={loading === 'draft'}>
                      Upload Files
                      <input
                        type="file"
                        multiple
                        accept=".txt,.md,.csv,.json,.pdf,.html,.xml,.log"
                        onChange={handleFileUpload}
                        disabled={loading === 'draft'}
                        style={{ display: 'none' }}
                      />
                    </label>
                    {referenceFiles.length > 0 && (
                      <div className="uploaded-files-list">
                        {referenceFiles.map((file, idx) => (
                          <div key={idx} className="uploaded-file-tag">
                            <span className="uploaded-file-name">{file.name}</span>
                            <button
                              type="button"
                              className="remove-file-btn"
                              onClick={() => dispatch({ type: 'REMOVE_REFERENCE_FILE', index: idx })}
                              disabled={loading === 'draft'}
                              title="Remove file"
                            >
                              x
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="toolbar-hint">Links or documents to inform the market design</span>
                </div>

                {dateError && <div className="error-message">{dateError}</div>}
                {error && <div className="error-message">{error}</div>}

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
                    'Draft Market'
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Connector line */}
          <div className={`panel-connector ${currentStep > 1 ? 'panel-connector--done' : ''}`} />

          {/* Panel 2: Draft & Review */}
          <div className={`panel ${currentStep === 2 ? 'panel--active' : ''} ${currentStep > 2 ? 'panel--done' : ''} ${currentStep < 2 ? 'panel--locked' : ''}`}>
            <div className="panel-header">
              <div className={`step ${currentStep >= 2 ? 'step--active' : ''} ${currentStep > 2 ? 'step--done' : ''}`}>
                <div className="step__number">2</div>
                <div className="step__label">Draft & Review</div>
              </div>
            </div>
            <div className="panel-body">
              {!draftContent ? (
                <div className="panel-placeholder">
                  <p>Complete setup and draft a market to continue</p>
                </div>
              ) : (
                <div className="draft-review-section">

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
                                x
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
                          reviewModels.length > 1 ? 'Review & Deliberate' : 'Review'
                        )}
                      </button>
                      <span className="toolbar-hint">
                        {reviewModels.length > 1
                          ? 'Models review independently, then deliberate on disagreements'
                          : 'Run with different models multiple times'}
                      </span>
                    </div>

                    {reviews.length > 0 && (
                      <>
                        <div className="toolbar-divider" />
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
                              'Update Draft'
                            )}
                          </button>
                          <span className="toolbar-hint">Incorporate critique into draft</span>
                        </div>
                      </>
                    )}

                    {hasUpdated && (
                      <>
                        <div className="toolbar-divider" />
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
                              'Accept & Finalize'
                            )}
                          </button>
                          <span className="toolbar-hint">Generate structured market details</span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Draft content */}
                  <div className="col-panel col-panel--draft">
                    <div className="col-panel-header">
                      <h2>Draft</h2>
                      <div className="col-panel-actions">
                        <span className="model-badge" data-tooltip={getModelName(selectedModel)}>{getModelAbbrev(selectedModel)}</span>
                        <button
                          className={`copy-btn ${copiedId === 'draft' ? 'copy-btn--copied' : ''}`}
                          onClick={() => handleCopy(draftContent, 'draft')}
                        >
                          {copiedId === 'draft' ? <><span>&#9112;</span> Copied!</> : <><span>&#9112;</span> Copy</>}
                        </button>
                      </div>
                    </div>
                    <div className="content-box">
                      <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{draftContent}</p>
                    </div>
                  </div>

                  {/* Review content */}
                  {reviews.length > 0 && (
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
                          className="input"
                          style={{ minHeight: '100px', resize: 'vertical', fontFamily: 'inherit' }}
                          disabled={loading === 'update'}
                        />
                      </div>

                      {deliberatedReview && (
                        <>
                          <div className="col-panel-header">
                            <h2>Deliberated Review</h2>
                            <div className="col-panel-actions">
                              <span className="model-badge deliberation-badge" data-tooltip="Council Deliberation">C</span>
                              <button
                                className={`copy-btn ${copiedId === 'deliberated' ? 'copy-btn--copied' : ''}`}
                                onClick={() => handleCopy(deliberatedReview, 'deliberated')}
                              >
                                {copiedId === 'deliberated' ? <><span>&#9112;</span> Copied!</> : <><span>&#9112;</span> Copy</>}
                              </button>
                            </div>
                          </div>
                          <div className="content-box">
                            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{deliberatedReview}</p>
                          </div>
                        </>
                      )}

                      {reviews.map((review, idx) => (
                        <div key={idx} className={deliberatedReview ? 'individual-review' : ''}>
                          <div className="col-panel-header">
                            <h2>{deliberatedReview ? `Reviewer ${idx + 1}` : 'Agent Review'}</h2>
                            <div className="col-panel-actions">
                              <span className="model-badge" data-tooltip={review.modelName}>{getModelAbbrev(review.model)}</span>
                              <button
                                className={`copy-btn ${copiedId === `review-${idx}` ? 'copy-btn--copied' : ''}`}
                                onClick={() => handleCopy(review.content, `review-${idx}`)}
                              >
                                {copiedId === `review-${idx}` ? <><span>&#9112;</span> Copied!</> : <><span>&#9112;</span> Copy</>}
                              </button>
                            </div>
                          </div>
                          <div className="content-box">
                            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{review.content}</p>
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
          <div className={`panel ${currentStep === 3 ? 'panel--active' : ''} ${currentStep < 3 ? 'panel--locked' : ''}`}>
            <div className="panel-header">
              <div className={`step ${currentStep >= 3 ? 'step--active' : ''}`}>
                <div className="step__number">3</div>
                <div className="step__label">Finalize</div>
              </div>
            </div>
            <div className="panel-body">
              {!finalContent ? (
                <div className="panel-placeholder">
                  <p>Draft, review, and update your market to finalize</p>
                </div>
              ) : (
                <div className="final-content">
                  <div className="final-header">
                    <h2>Final Market Details</h2>
                    <p>Review and deploy your prediction market</p>
                  </div>

                  {finalContent.raw ? (
                    <div className="content-section">
                      <div className="content-box">
                        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{finalContent.raw}</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {finalContent.outcomes?.length > 0 && (
                        <div className="content-section">
                          <h3>Outcomes & Resolution Criteria</h3>
                          <div className="outcomes-grid">
                            {finalContent.outcomes.map((outcome, index) => (
                              <div key={index} className="outcome-card">
                                <div className="outcome-index">Outcome {index + 1}</div>
                                <div className="outcome-name">{outcome.name}</div>
                                <div className="outcome-criteria">{outcome.resolutionCriteria}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="content-section">
                        <h3>Market Timing</h3>
                        <div className="time-row">
                          <div className="time-display">
                            <div className="time-label">Start Time (UTC)</div>
                            {finalContent.marketStartTimeUTC}
                          </div>
                          <div className="time-display">
                            <div className="time-label">End Time (UTC)</div>
                            {finalContent.marketEndTimeUTC}
                          </div>
                        </div>
                      </div>

                      {finalContent.shortDescription && (
                        <div className="content-section">
                          <h3>Short Description</h3>
                          <div className="content-box">
                            <p style={{ margin: 0 }}>{finalContent.shortDescription}</p>
                          </div>
                        </div>
                      )}

                      {finalContent.fullResolutionRules && (
                        <div className="content-section">
                          <h3>Full Resolution Rules</h3>
                          <div className="col-panel-header" style={{ marginBottom: '0.5rem' }}>
                            <span />
                            <button
                              className={`copy-btn ${copiedId === 'rules' ? 'copy-btn--copied' : ''}`}
                              onClick={() => handleCopy(finalContent.fullResolutionRules, 'rules')}
                            >
                              {copiedId === 'rules' ? <><span>&#9112;</span> Copied!</> : <><span>&#9112;</span> Copy</>}
                            </button>
                          </div>
                          <div className="content-box">
                            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{finalContent.fullResolutionRules}</p>
                          </div>
                        </div>
                      )}

                      {finalContent.edgeCases && (
                        <div className="content-section">
                          <h3>Edge Cases</h3>
                          <div className="content-box">
                            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{finalContent.edgeCases}</p>
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <button className="reset-button" onClick={handleReset}>
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
