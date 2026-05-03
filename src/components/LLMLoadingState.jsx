import { useState, useEffect } from 'react';
import { useEnterTransition } from '../hooks/useEnterTransition';
import { useLanguage } from '../hooks/useLanguage';

const PHASE_KEYS = {
  draft: { label: 'loading.draftLabel', messages: ['loading.draftMsg1', 'loading.draftMsg2', 'loading.draftMsg3', 'loading.draftMsg4'] },
  review: { label: 'loading.reviewLabel', messages: ['loading.reviewMsg1', 'loading.reviewMsg2', 'loading.reviewMsg3', 'loading.reviewMsg4'] },
  update: { label: 'loading.updateLabel', messages: ['loading.updateMsg1', 'loading.updateMsg2', 'loading.updateMsg3', 'loading.updateMsg4'] },
  accept: { label: 'loading.acceptLabel', messages: ['loading.acceptMsg1', 'loading.acceptMsg2', 'loading.acceptMsg3', 'loading.acceptMsg4'] },
  'early-resolution': { label: 'loading.earlyResLabel', messages: ['loading.earlyResMsg1', 'loading.earlyResMsg2', 'loading.earlyResMsg3', 'loading.earlyResMsg4'] },
  ideate: { label: 'loading.ideateLabel', messages: ['loading.ideateMsg1', 'loading.ideateMsg2', 'loading.ideateMsg3', 'loading.ideateMsg4'] },
};

function formatElapsed(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining.toString().padStart(2, '0')}s`;
}

export default function LLMLoadingState({ phase, meta, rigor }) {
  const { t } = useLanguage();
  const [elapsed, setElapsed] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);
  const mounted = useEnterTransition();

  const phaseKeys = PHASE_KEYS[phase] || PHASE_KEYS.draft;
  const modelNames = meta?.models || [];
  // Phase 3: surface the rigor chip next to the phase label so the user
  // (and any QA) can see at a glance which mode the run is operating
  // under. Only render when rigor is provided — older callers without
  // rigor wired through stay visually unchanged.
  const rigorLabel = rigor === 'human'
    ? t('loading.rigorHuman')
    : rigor === 'machine'
      ? t('loading.rigorMachine')
      : null;

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
      setMessageIndex((prev) => (prev + 1) % phaseKeys.messages.length);
    }, 4000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(interval);
    };
  }, [phase, phaseKeys.messages.length]);

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
          {t(phaseKeys.label)}
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
            {t(phaseKeys.messages[messageIndex])}
          </span>
        </div>
      </div>

      <div className="llm-loading__elapsed">{formatElapsed(elapsed)}</div>
    </div>
  );
}
