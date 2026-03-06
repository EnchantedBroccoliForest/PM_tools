import { useState } from 'react';
import './App.css';

const MODEL_GROUPS = [
  {
    label: 'OpenAI',
    models: [
      { id: 'openai/gpt-5.2-extended-thinking', name: 'GPT-5.2 Extended Thinking' },
      { id: 'openai/gpt-5.2', name: 'GPT-5.2' },
      { id: 'openai/gpt-5.1', name: 'GPT-5.1' },
      { id: 'openai/o4-mini', name: 'O4 Mini' },
      { id: 'openai/o3', name: 'O3' },
      { id: 'openai/gpt-4.5-preview', name: 'GPT-4.5 Preview' },
      { id: 'openai/gpt-4o', name: 'GPT-4o' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
    ],
  },
  {
    label: 'Anthropic',
    models: [
      { id: 'anthropic/claude-opus-4.5', name: 'Claude Opus 4.5' },
      { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4' },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
    ],
  },
  {
    label: 'Google',
    models: [
      { id: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro' },
      { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro' },
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
    ],
  },
  {
    label: 'DeepSeek',
    models: [
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1' },
      { id: 'deepseek/deepseek-v3', name: 'DeepSeek V3' },
    ],
  },
  {
    label: 'Meta',
    models: [
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
    ],
  },
  {
    label: 'Mistral',
    models: [
      { id: 'mistralai/mistral-large', name: 'Mistral Large' },
      { id: 'mistralai/mixtral-8x22b-instruct', name: 'Mixtral 8x22B' },
    ],
  },
];

const AVAILABLE_MODELS = MODEL_GROUPS.flatMap((g) => g.models);

function ModelSelect({ id, value, onChange, disabled, className }) {
  return (
    <select id={id} value={value} onChange={onChange} disabled={disabled} className={className}>
      {MODEL_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function App() {
  const [question, setQuestion] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[1].id);
  const [draftLoading, setDraftLoading] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [acceptLoading, setAcceptLoading] = useState(false);
  const [draftContent, setDraftContent] = useState(null);
  const [reviewContent, setReviewContent] = useState(null);
  const [finalContent, setFinalContent] = useState(null);
  const [hasUpdated, setHasUpdated] = useState(false);
  const [reviewModel, setReviewModel] = useState(AVAILABLE_MODELS[13].id);
  const [humanReviewInput, setHumanReviewInput] = useState('');
  const [error, setError] = useState(null);
  const [dateError, setDateError] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  const currentStep = finalContent ? 3 : draftContent ? 2 : 1;

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const getModelName = (id) =>
    AVAILABLE_MODELS.find((m) => m.id === id)?.name || id;

  const validateDates = (start, end) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (start) {
      const startDateObj = new Date(start);
      if (startDateObj <= today) {
        return 'Start Date must be in the future';
      }
    }

    if (start && end) {
      const startDateObj = new Date(start);
      const endDateObj = new Date(end);
      if (endDateObj <= startDateObj) {
        return 'End Date must be later than Start Date';
      }
    }

    return null;
  };

  const handleStartDateChange = (e) => {
    const newStartDate = e.target.value;
    setStartDate(newStartDate);
    setDateError(validateDates(newStartDate, endDate));
  };

  const handleEndDateChange = (e) => {
    const newEndDate = e.target.value;
    setEndDate(newEndDate);
    setDateError(validateDates(startDate, newEndDate));
  };

  const handleDraft = async () => {
    setDraftContent(null);
    setReviewContent(null);
    setHumanReviewInput('');
    setFinalContent(null);
    setHasUpdated(false);
    setError(null);
    setDraftLoading(true);

    try {
      const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
      if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
        throw new Error('OpenRouter API key not configured. Please add VITE_OPENROUTER_API_KEY to your environment.');
      }

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Market Creator',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: 'system',
              content: 'You are an expert at creating prediction market questions with clear, unambiguous resolution criteria. You help create well-defined markets that can be objectively resolved.',
            },
            {
              role: 'user',
              content: `Draft a prediction market proposal based on user inputs. Write a clear, unambiguous Resolution Rules and provide links to all sources. The market must be objectively resolvable with sources that can be easily publicly verified. Come up with a complete set of mutually-exclusive outcomes and their resolution criteria. Cover all possible edge cases.

User's Question: "${question}"
Start Date: ${startDate}
End Date: ${endDate}

Provide a comprehensive draft that includes:
1. A refined, unambiguous version of the question
2. Detailed resolution criteria
3. All possible edge cases and how they should be handled
4. Potential sources for resolution
5. Any assumptions that need to be made explicit`,
            },
          ],
          temperature: 0.7,
          max_tokens: 3000,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to generate draft');
      }

      const data = await response.json();
      setDraftContent(data.choices[0].message.content);
    } catch (err) {
      setError(err.message || 'An error occurred while generating draft');
      console.error('Error:', err);
    } finally {
      setDraftLoading(false);
    }
  };

  const handleReview = async () => {
    if (!draftContent) return;

    setReviewLoading(true);
    setError(null);

    try {
      const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
      if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
        throw new Error('OpenRouter API key not configured. Please add VITE_OPENROUTER_API_KEY to your environment.');
      }

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Market Creator',
        },
        body: JSON.stringify({
          model: reviewModel,
          messages: [
            {
              role: 'system',
              content: 'You are a critical reviewer specializing in prediction market design. You are a very well trained contract reviewer. Your job is to find flaws, ambiguities, and potential issues in market definitions, resolution rules, and the completeness of the outcome set.',
            },
            {
              role: 'user',
              content: `Review this draft for a prediction market. Challenge the resolution rules rigorously, identify potential areas of misinterpretations or incompleteness and suggest edits.

DRAFT TO REVIEW:
${draftContent}`,
            },
          ],
          temperature: 0.7,
          max_tokens: 3000,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to generate review');
      }

      const data = await response.json();
      setReviewContent(data.choices[0].message.content);
    } catch (err) {
      setError(err.message || 'An error occurred while generating review');
      console.error('Error:', err);
    } finally {
      setReviewLoading(false);
    }
  };

  const handleUpdate = async () => {
    if (!draftContent || !reviewContent) return;

    setUpdateLoading(true);
    setError(null);

    try {
      const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
      if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
        throw new Error('OpenRouter API key not configured. Please add VITE_OPENROUTER_API_KEY to your environment.');
      }

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Market Creator',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: 'system',
              content: 'You are an expert at creating prediction market questions with clear, unambiguous resolution criteria. You help create well-defined markets that can be objectively resolved.',
            },
            {
              role: 'user',
              content: `This is a critical review of the draft. Review and first determine if the critiques make logical sense. Incorporate the suggestions or criticisms from the Reviewer that are correct and generate a new draft.

ORIGINAL DRAFT:
${draftContent}

CRITICAL REVIEW:
${reviewContent}${humanReviewInput.trim() ? `

HUMAN REVIEWER FEEDBACK:
${humanReviewInput}` : ''}`,
            },
          ],
          temperature: 0.7,
          max_tokens: 3000,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to generate updated draft');
      }

      const data = await response.json();
      setDraftContent(data.choices[0].message.content);
      setHasUpdated(true);
    } catch (err) {
      setError(err.message || 'An error occurred while updating draft');
      console.error('Error:', err);
    } finally {
      setUpdateLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!draftContent) return;

    setAcceptLoading(true);
    setError(null);

    try {
      const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
      if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
        throw new Error('OpenRouter API key not configured. Please add VITE_OPENROUTER_API_KEY to your environment.');
      }

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Market Creator',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: 'system',
              content: 'You are an expert at creating prediction market questions. Extract and format the final market details from the draft into a structured format.',
            },
            {
              role: 'user',
              content: `Based on the following draft, generate the final and condensed prediction market details in a structured JSON format.

DRAFT:
${draftContent}

USER PROVIDED DATES:
Start Date: ${startDate}
End Date: ${endDate}

Generate a JSON response with exactly these fields:
{
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
}`,
            },
          ],
          temperature: 0.3,
          max_tokens: 3000,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to generate final content');
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      let parsedContent;
      try {
        const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (jsonMatch) {
          parsedContent = JSON.parse(jsonMatch[1]);
        } else {
          parsedContent = JSON.parse(content);
        }
      } catch (parseError) {
        parsedContent = { raw: content };
      }

      setFinalContent(parsedContent);
    } catch (err) {
      setError(err.message || 'An error occurred while finalizing market');
      console.error('Error:', err);
    } finally {
      setAcceptLoading(false);
    }
  };

  const handleReset = () => {
    setDraftContent(null);
    setReviewContent(null);
    setHumanReviewInput('');
    setFinalContent(null);
    setHasUpdated(false);
    setQuestion('');
    setStartDate('');
    setEndDate('');
    setError(null);
    setDateError(null);
  };

  const anyLoading = draftLoading || reviewLoading || updateLoading || acceptLoading;

  return (
    <div className="App">
      <div className="container">

        {/* Header */}
        <header className="header">
          <h1>Market Creator</h1>
          <p className="subtitle">AI-assisted prediction market creation via OpenRouter</p>
        </header>

        {/* Step Indicator */}
        <div className="step-indicator">
          <div className={`step ${currentStep >= 1 ? 'step--active' : ''} ${currentStep > 1 ? 'step--done' : ''}`}>
            <div className="step__dot">{currentStep > 1 ? '✓' : '1'}</div>
            <div className="step__label">Setup</div>
          </div>
          <div className={`step-line ${currentStep > 1 ? 'step-line--done' : ''}`} />
          <div className={`step ${currentStep >= 2 ? 'step--active' : ''} ${currentStep > 2 ? 'step--done' : ''}`}>
            <div className="step__dot">{currentStep > 2 ? '✓' : '2'}</div>
            <div className="step__label">Draft & Review</div>
          </div>
          <div className={`step-line ${currentStep > 2 ? 'step-line--done' : ''}`} />
          <div className={`step ${currentStep >= 3 ? 'step--active' : ''}`}>
            <div className="step__dot">3</div>
            <div className="step__label">Finalize</div>
          </div>
        </div>

        {/* Setup Form */}
        <div className="market-form">
          <div className="form-group">
            <label htmlFor="question">Prediction Market Question</label>
            <input
              id="question"
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g., Will AI achieve AGI by 2030?"
              className="input"
              disabled={draftLoading}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="startDate">Start Date</label>
              <input
                id="startDate"
                type="date"
                value={startDate}
                onChange={handleStartDateChange}
                className="input"
                disabled={draftLoading}
              />
              {startDate && (
                <p className="utc-hint">
                  {new Date(startDate + 'T00:00:00').toISOString().replace('T', ' ').slice(0, -5)} UTC
                </p>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="endDate">End Date</label>
              <input
                id="endDate"
                type="date"
                value={endDate}
                onChange={handleEndDateChange}
                className="input"
                disabled={draftLoading}
              />
              {endDate && (
                <p className="utc-hint">
                  {new Date(endDate + 'T23:59:59').toISOString().replace('T', ' ').slice(0, -5)} UTC
                </p>
              )}
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="model">Drafting Model</label>
            <ModelSelect
              id="model"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="input"
              disabled={draftLoading}
            />
          </div>

          {dateError && <div className="error-message">{dateError}</div>}
          {error && <div className="error-message">{error}</div>}

          <button
            type="button"
            className="draft-button"
            disabled={draftLoading || !question.trim() || !startDate || !endDate || !!dateError}
            onClick={handleDraft}
          >
            {draftLoading ? (
              <>
                <span className="spinner" />
                Drafting...
              </>
            ) : (
              'Draft Market'
            )}
          </button>
        </div>

        {/* Draft & Review Section */}
        {draftContent && (
          <div className="draft-review-section">

            {/* Action Toolbar */}
            <div className="action-toolbar">
              <div className="toolbar-group">
                <label htmlFor="reviewModel">Review Model</label>
                <ModelSelect
                  id="reviewModel"
                  value={reviewModel}
                  onChange={(e) => setReviewModel(e.target.value)}
                  className="toolbar-select"
                  disabled={anyLoading}
                />
              </div>

              <div className="toolbar-divider" />

              <div className="toolbar-group">
                <button
                  type="button"
                  className="review-button"
                  disabled={anyLoading}
                  onClick={handleReview}
                >
                  {reviewLoading ? (
                    <>
                      <span className="spinner" />
                      Reviewing...
                    </>
                  ) : (
                    'Review'
                  )}
                </button>
                <span className="toolbar-hint">Run with different models multiple times</span>
              </div>

              {reviewContent && (
                <>
                  <div className="toolbar-divider" />
                  <div className="toolbar-group">
                    <button
                      type="button"
                      className="review-button"
                      disabled={anyLoading}
                      onClick={handleUpdate}
                    >
                      {updateLoading ? (
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
                      {acceptLoading ? (
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

            {/* Side-by-side columns */}
            <div className="side-by-side">

              {/* Draft column */}
              <div className="col-panel">
                <div className="col-panel-header">
                  <h2>Draft</h2>
                  <div className="col-panel-actions">
                    <span className="model-badge">{getModelName(selectedModel)}</span>
                    <button
                      className={`copy-btn ${copiedId === 'draft' ? 'copy-btn--copied' : ''}`}
                      onClick={() => handleCopy(draftContent, 'draft')}
                    >
                      {copiedId === 'draft' ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
                <div className="content-box">
                  <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{draftContent}</p>
                </div>
              </div>

              {/* Review column */}
              {reviewContent && (
                <div className="col-panel">
                  <div className="human-review-section">
                    <h2>Your Feedback</h2>
                    <span className="hint">Optional — included when you click Update Draft</span>
                    <textarea
                      value={humanReviewInput}
                      onChange={(e) => setHumanReviewInput(e.target.value)}
                      placeholder="Add your own critiques or additional feedback..."
                      className="input"
                      style={{ minHeight: '100px', resize: 'vertical', fontFamily: 'inherit' }}
                      disabled={updateLoading}
                    />
                  </div>

                  <div className="col-panel-header">
                    <h2>Agent Review</h2>
                    <div className="col-panel-actions">
                      <span className="model-badge">{getModelName(reviewModel)}</span>
                      <button
                        className={`copy-btn ${copiedId === 'review' ? 'copy-btn--copied' : ''}`}
                        onClick={() => handleCopy(reviewContent, 'review')}
                      >
                        {copiedId === 'review' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <div className="content-box">
                    <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{reviewContent}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Final Content */}
        {finalContent && (
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
                        {copiedId === 'rules' ? 'Copied!' : 'Copy'}
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
  );
}

export default App;
