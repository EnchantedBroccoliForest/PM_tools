import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

function App() {
  const [question, setQuestion] = useState('');
  const [resolutionDate, setResolutionDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatedContent, setGeneratedContent] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!question.trim() || !resolutionDate) {
      setError('Please fill in both the question and resolution date');
      return;
    }

    setLoading(true);
    setError(null);
    setGeneratedContent(null);

    try {
      const apiKey = process.env.REACT_APP_OPENAI_API_KEY;
      if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
        throw new Error('OpenAI API key not configured. Please add REACT_APP_OPENAI_API_KEY to your .env file.');
      }

      // Call OpenAI API
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You are an expert at creating prediction market questions with clear, unambiguous resolution criteria. You help create well-defined markets that can be objectively resolved.'
            },
            {
              role: 'user',
              content: `Create a prediction market for the following question: "${question}"
              
Resolution Date: ${resolutionDate}

Please provide:
1. A well-defined resolution criteria that is appropriate for prediction markets. This should be clear, objective, and unambiguous.
2. A long-form description that explains the market, provides context, and helps traders understand what they're betting on.
3. Edge cases to consider - potential ambiguities or scenarios that might affect resolution.

Format your response as JSON with the following structure:
{
  "resolutionCriteria": "...",
  "description": "...",
  "edgeCases": "..."
}`
            }
          ],
          temperature: 0.7,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to generate content');
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      
      // Try to parse JSON from the response
      let parsedContent;
      try {
        // Extract JSON from markdown code blocks if present
        const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
        if (jsonMatch) {
          parsedContent = JSON.parse(jsonMatch[1]);
        } else {
          parsedContent = JSON.parse(content);
        }
      } catch (parseError) {
        // If parsing fails, create a structured object from the text
        const lines = content.split('\n');
        parsedContent = {
          resolutionCriteria: extractSection(lines, 'resolution', 'criteria'),
          description: extractSection(lines, 'description'),
          edgeCases: extractSection(lines, 'edge', 'cases')
        };
      }

      setGeneratedContent(parsedContent);
    } catch (err) {
      setError(err.message || 'An error occurred while generating content');
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Helper function to extract sections from text
  const extractSection = (lines, ...keywords) => {
    let section = [];
    let inSection = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase();
      if (keywords.some(keyword => line.includes(keyword) && (line.includes(':') || line.includes('#')))) {
        inSection = true;
        continue;
      }
      if (inSection) {
        if (line.trim() === '' && section.length > 0) {
          // Check if next non-empty line starts a new section
          let nextNonEmpty = i + 1;
          while (nextNonEmpty < lines.length && lines[nextNonEmpty].trim() === '') {
            nextNonEmpty++;
          }
          if (nextNonEmpty < lines.length && 
              (lines[nextNonEmpty].toLowerCase().includes(':') || 
               lines[nextNonEmpty].toLowerCase().includes('#'))) {
            break;
          }
        }
        if (inSection) {
          section.push(lines[i]);
        }
      }
    }
    
    return section.join('\n').trim() || 'Content not found in expected format';
  };

  return (
    <div className="App">
      <div className="container">
        <header className="header">
          <h1>Create Prediction Market</h1>
          <p className="subtitle">AI-assisted market creation powered by ChatGPT</p>
        </header>

        <form onSubmit={handleSubmit} className="market-form">
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
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="resolutionDate">
              Market Resolution Date *
            </label>
            <input
              id="resolutionDate"
              type="date"
              value={resolutionDate}
              onChange={(e) => setResolutionDate(e.target.value)}
              className="input"
              disabled={loading}
            />
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <button 
            type="submit" 
            className="submit-button"
            disabled={loading || !question.trim() || !resolutionDate}
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                Generating...
              </>
            ) : (
              'Generate Market Details'
            )}
          </button>
        </form>

        {generatedContent && (
          <div className="generated-content">
            <h2>Generated Market Details</h2>
            
            <div className="content-section">
              <h3>Resolution Criteria</h3>
              <div className="content-box">
                <p>{generatedContent.resolutionCriteria}</p>
              </div>
            </div>

            <div className="content-section">
              <h3>Description</h3>
              <div className="content-box">
                <p style={{ whiteSpace: 'pre-wrap' }}>{generatedContent.description}</p>
              </div>
            </div>

            <div className="content-section">
              <h3>Edge Cases to Consider</h3>
              <div className="content-box">
                <p style={{ whiteSpace: 'pre-wrap' }}>{generatedContent.edgeCases}</p>
              </div>
            </div>

            <button 
              className="reset-button"
              onClick={() => {
                setGeneratedContent(null);
                setQuestion('');
                setResolutionDate('');
                setError(null);
              }}
            >
              Create Another Market
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
