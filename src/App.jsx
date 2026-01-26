import { useState } from 'react';
import './App.css';

function App() {
  const AVAILABLE_MODELS = [
    { id: 'openai/gpt-5.2-extended-thinking', name: 'GPT-5.2 Extended Thinking' },
    { id: 'openai/gpt-5.2', name: 'GPT-5.2' },
    { id: 'openai/gpt-5.1', name: 'GPT-5.1' },
    { id: 'openai/o4-mini', name: 'O4 Mini' },
    { id: 'openai/o3', name: 'O3' },
    { id: 'openai/gpt-4.5-preview', name: 'GPT-4.5 Preview' },
    { id: 'openai/gpt-4o', name: 'GPT-4o' },
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'anthropic/claude-opus-4.5', name: 'Claude Opus 4.5' },
    { id: 'anthropic/claude-opus-4', name: 'Claude Opus 4' },
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
    { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku' },
    { id: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro' },
    { id: 'google/gemini-2.5-pro-preview', name: 'Gemini 2.5 Pro' },
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash' },
    { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1' },
    { id: 'deepseek/deepseek-v3', name: 'DeepSeek V3' },
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
    { id: 'mistralai/mistral-large', name: 'Mistral Large' },
    { id: 'mistralai/mixtral-8x22b-instruct', name: 'Mixtral 8x22B' },
  ];

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
  const [error, setError] = useState(null);

  const handleDraft = async () => {
    setDraftLoading(true);
    setError(null);
    setDraftContent(null);

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
          'X-Title': 'Market Creator'
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: 'system',
              content: 'You are an expert at creating prediction market questions with clear, unambiguous resolution criteria. You help create well-defined markets that can be objectively resolved.'
            },
            {
              role: 'user',
              content: `Draft a prediction market question based on user inputs. Be extremely rigorous. Cover all possible edge cases.

User's Question: "${question}"
Start Date: ${startDate}
End Date: ${endDate}

Provide a comprehensive draft that includes:
1. A refined, unambiguous version of the question
2. Detailed resolution criteria
3. All possible edge cases and how they should be handled
4. Potential sources for resolution
5. Any assumptions that need to be made explicit`
            }
          ],
          temperature: 0.7,
          max_tokens: 3000
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to generate draft');
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      setDraftContent(content);
      setReviewContent(null);
      setHasUpdated(false);
      setFinalContent(null);
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
          'X-Title': 'Prediction Market Creator'
        },
        body: JSON.stringify({
          model: reviewModel,
          messages: [
            {
              role: 'system',
              content: 'You are a critical reviewer specializing in prediction market design. Your job is to find flaws, ambiguities, and potential issues in market definitions.'
            },
            {
              role: 'user',
              content: `Review this draft for a prediction market. Challenge the resolution rules rigorously, identify potential areas of misinterpretations and suggest edits.

DRAFT TO REVIEW:
${draftContent}`
            }
          ],
          temperature: 0.7,
          max_tokens: 3000
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to generate review');
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      setReviewContent(content);
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
          'X-Title': 'Prediction Market Creator'
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: 'system',
              content: 'You are an expert at creating prediction market questions with clear, unambiguous resolution criteria. You help create well-defined markets that can be objectively resolved.'
            },
            {
              role: 'user',
              content: `This is a critical review of the draft. Review and first determine if the critiques make sense. Incorporate the suggestions or criticisms from the Reviewer that make sense and generate a new draft.

ORIGINAL DRAFT:
${draftContent}

CRITICAL REVIEW:
${reviewContent}`
            }
          ],
          temperature: 0.7,
          max_tokens: 3000
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to generate updated draft');
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      setDraftContent(content);
      setReviewContent(null);
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
          'X-Title': 'Prediction Market Creator'
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: 'system',
              content: 'You are an expert at creating prediction market questions. Extract and format the final market details from the draft into a structured format.'
            },
            {
              role: 'user',
              content: `Based on the following draft, generate the final prediction market details in a structured JSON format.

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
}`
            }
          ],
          temperature: 0.3,
          max_tokens: 3000
        })
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
    setFinalContent(null);
    setHasUpdated(false);
    setQuestion('');
    setStartDate('');
    setEndDate('');
    setError(null);
  };

  return (
    <div className="App">
      <div className="container">
        <header className="header">
          <h1>Create Prediction Market</h1>
          <p className="subtitle">AI-assisted market creation via OpenRouter</p>
          <p className="model-version">Model: {AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name || selectedModel}</p>
        </header>

        <div className="market-form">
          <div className="form-group">
            <label htmlFor="question">
              Prediction Market Question *
            </label>
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

          <div className="form-group">
            <label htmlFor="startDate">
              Start Date *
            </label>
            <input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input"
              disabled={draftLoading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="endDate">
              End Date *
            </label>
            <input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input"
              disabled={draftLoading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="model">
              AI Model *
            </label>
            <select
              id="model"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="input"
              disabled={draftLoading}
            >
              {AVAILABLE_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <button
            type="button"
            className="draft-button"
            disabled={draftLoading || !question.trim() || !startDate || !endDate}
            onClick={handleDraft}
          >
            {draftLoading ? (
              <>
                <span className="spinner"></span>
                Drafting...
              </>
            ) : (
              'Draft'
            )}
          </button>
        </div>

        {draftContent && (
          <div className="draft-review-section">
            <div className="review-controls">
              <div className="form-group" style={{ display: 'inline-block', marginRight: '1rem' }}>
                <label htmlFor="reviewModel">Review Model:</label>
                <select
                  id="reviewModel"
                  value={reviewModel}
                  onChange={(e) => setReviewModel(e.target.value)}
                  className="input"
                  disabled={reviewLoading}
                  style={{ marginLeft: '0.5rem' }}
                >
                  {AVAILABLE_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="review-button"
                disabled={reviewLoading || draftLoading || updateLoading || acceptLoading}
                onClick={handleReview}
              >
                {reviewLoading ? (
                  <>
                    <span className="spinner"></span>
                    Reviewing...
                  </>
                ) : (
                  'Review'
                )}
              </button>
              {reviewContent && (
                <div style={{ display: 'inline-block', marginLeft: '1rem' }}>
                  <button
                    type="button"
                    className="review-button"
                    disabled={updateLoading || draftLoading || reviewLoading || acceptLoading}
                    onClick={handleUpdate}
                  >
                    {updateLoading ? (
                      <>
                        <span className="spinner"></span>
                        Updating...
                      </>
                    ) : (
                      'Update'
                    )}
                  </button>
                  <p style={{ fontStyle: 'italic', fontSize: '0.85rem', color: '#a0a0a0', marginTop: '0.5rem' }}>update the draft based on the reviewer's critique</p>
                </div>
              )}
            </div>

            <div className="side-by-side" style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <div className="draft-content" style={{ flex: 1 }}>
                <h2>Draft Output</h2>
                <p className="model-label">Model: {AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name || selectedModel}</p>
                <div className="content-box">
                  <p style={{ whiteSpace: 'pre-wrap' }}>{draftContent}</p>
                </div>
              </div>

              {reviewContent && (
                <div className="review-content" style={{ flex: 1 }}>
                  <h2>Review Critique</h2>
                  <p className="model-label">Model: {AVAILABLE_MODELS.find(m => m.id === reviewModel)?.name || reviewModel}</p>
                  <div className="content-box">
                    <p style={{ whiteSpace: 'pre-wrap' }}>{reviewContent}</p>
                  </div>
                </div>
              )}
            </div>

            {hasUpdated && (
              <div className="accept-section" style={{ marginTop: '2rem', textAlign: 'center' }}>
                <button
                  type="button"
                  className="review-button"
                  disabled={acceptLoading || draftLoading || reviewLoading || updateLoading}
                  onClick={handleAccept}
                >
                  {acceptLoading ? (
                    <>
                      <span className="spinner"></span>
                      Finalizing...
                    </>
                  ) : (
                    'Accept'
                  )}
                </button>
              </div>
            )}
          </div>
        )}

        {finalContent && (
          <div className="final-content" style={{ marginTop: '2rem' }}>
            <h2>Final Market Details</h2>

            {finalContent.raw ? (
              <div className="content-box">
                <p style={{ whiteSpace: 'pre-wrap' }}>{finalContent.raw}</p>
              </div>
            ) : (
              <>
                <div className="content-section">
                  <h3>1. Outcomes and Resolution Criteria</h3>
                  <div className="content-box">
                    {finalContent.outcomes?.map((outcome, index) => (
                      <div key={index} style={{ marginBottom: '1rem' }}>
                        <strong>{outcome.name}</strong>
                        <p style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>{outcome.resolutionCriteria}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="content-section">
                  <h3>2. Market Start Time (UTC)</h3>
                  <div className="content-box">
                    <p>{finalContent.marketStartTimeUTC}</p>
                  </div>
                </div>

                <div className="content-section">
                  <h3>3. Market End Time (UTC)</h3>
                  <div className="content-box">
                    <p>{finalContent.marketEndTimeUTC}</p>
                  </div>
                </div>

                <div className="content-section">
                  <h3>4. Short Description</h3>
                  <div className="content-box">
                    <p>{finalContent.shortDescription}</p>
                  </div>
                </div>

                <div className="content-section">
                  <h3>5. Full Resolution Rules</h3>
                  <div className="content-box">
                    <p style={{ whiteSpace: 'pre-wrap' }}>{finalContent.fullResolutionRules}</p>
                  </div>
                </div>

                <div className="content-section">
                  <h3>6. Edge Cases</h3>
                  <div className="content-box">
                    <p style={{ whiteSpace: 'pre-wrap' }}>{finalContent.edgeCases}</p>
                  </div>
                </div>
              </>
            )}

            <button
              className="reset-button"
              style={{ marginTop: '2rem' }}
              onClick={handleReset}
            >
              Create Another Market
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
