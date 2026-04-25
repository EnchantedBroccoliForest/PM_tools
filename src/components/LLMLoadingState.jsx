import { useState, useEffect } from 'react';
import { useEnterTransition } from '../hooks/useEnterTransition';

const PHASE_CONFIG = {
  draft: {
    label: 'Drafting market proposal',
    messages: [
      'Analyzing your question...',
      'Researching resolution criteria...',
      'Structuring market parameters...',
      'Composing draft...',
    ],
  },
  review: {
    label: 'Reviewing draft',
    messages: [
      'Reading the draft carefully...',
      'Identifying ambiguities...',
      'Checking resolution criteria...',
      'Compiling critique...',
    ],
  },
  update: {
    label: 'Updating draft with feedback',
    messages: [
      'Incorporating review feedback...',
      'Refining resolution criteria...',
      'Improving clarity...',
      'Polishing the draft...',
    ],
  },
  accept: {
    label: 'Finalizing market',
    messages: [
      'Structuring market data...',
      'Formatting resolution rules...',
      'Generating final JSON...',
      'Almost there...',
    ],
  },
  'early-resolution': {
    label: 'Analyzing early resolution risk',
    messages: [
      'Reviewing outcomes and resolution rules...',
      'Evaluating scenarios for early certainty...',
      'Assessing risk level...',
      'Compiling analysis...',
    ],
  },
  ideate: {
    label: 'Brainstorming market ideas',
    messages: [
      'Researching the topic area...',
      'Scanning for catalysts and trends...',
      'Generating candidate questions...',
      'Curating the most interesting ideas...',
    ],
  },
};

function formatElapsed(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining.toString().padStart(2, '0')}s`;
}

export default function LLMLoadingState({ phase, meta, rigor }) {
  const [elapsed, setElapsed] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const mounted = useEnterTransition();

  const config = PHASE_CONFIG[phase] || PHASE_CONFIG.draft;
  const modelNames = meta?.models || [];
  // Phase 3: surface the rigor chip next to the phase label so the user
  // (and any QA) can see at a glance which mode the run is operating
  // under. Only render when rigor is provided — older callers without
  // rigor wired through stay visually unchanged.
  const rigorLabel = rigor === 'human' ? 'Human' : rigor === 'machine' ? 'Machine' : null;

  // Elapsed timer — update every second
  useEffect(() => {
    if (!meta?.startTime) return;
    const kickoff = setTimeout(() => {
      setElapsed(Date.now() - meta.startTime);
    }, 0);
    const interval = setInterval(() => {
      setElapsed(Date.now() - meta.startTime);
    }, 1000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [meta?.startTime]);

  // Cycle status messages every 4 seconds
  useEffect(() => {
    const kickoff = setTimeout(() => setMessageIndex(0), 0);
    const interval = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % config.messages.length);
    }, 4000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [phase, config.messages.length]);

  const isMultiModel = modelNames.length > 1;

  return (
    <div className={`llm-loading ${mounted ? 'llm-loading--mounted' : ''}`}>
      <div className="llm-loading__spinner-ring">
        <svg className="llm-loading__spinner-svg" viewBox="0 0 50 50">
          <circle className="llm-loading__track" cx="25" cy="25" r="20" />
          <circle className="llm-loading__arc" cx="25" cy="25" r="20" />
        </svg>
      </div>

      <div className="llm-loading__info">
        <div className="llm-loading__phase">
          {config.label}
          {rigorLabel && (
            <span className={`llm-loading__rigor llm-loading__rigor--${rigor}`}>
              {rigorLabel}
            </span>
          )}
        </div>

        <div className="llm-loading__models">
          {isMultiModel ? (
            modelNames.map((name, i) => (
              <span key={i} className="llm-loading__model-tag">{name}</span>
            ))
          ) : modelNames.length === 1 ? (
            <span className="llm-loading__model-tag">{modelNames[0]}</span>
          ) : null}
        </div>

        <div className="llm-loading__status">
          <span className="llm-loading__message" key={messageIndex}>
            {config.messages[messageIndex]}
          </span>
        </div>
      </div>

      <div className="llm-loading__elapsed">{formatElapsed(elapsed)}</div>
    </div>
  );
}
