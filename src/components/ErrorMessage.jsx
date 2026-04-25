import { useEffect, useRef, useState } from 'react';

/**
 * Animated error banner. Pass `message` (truthy to show, null/empty to hide).
 * The banner enters with a slide-down transition and exits with a brief
 * upward fade so it never disappears with a hard cut. While exiting, it
 * holds the previous message so the text doesn't blank out mid-animation.
 */
export default function ErrorMessage({ message, onDismiss, dismissLabel = 'Dismiss', exitMs = 150 }) {
  const [render, setRender] = useState(!!message);
  const [phase, setPhase] = useState(message ? 'visible' : 'idle');
  const [shown, setShown] = useState(message || '');
  const [lastMessage, setLastMessage] = useState(message || null);
  const timer = useRef(null);

  if (message !== lastMessage) {
    setLastMessage(message || null);
    if (message) {
      setShown(message);
      setRender(true);
      setPhase('enter');
    } else if (render) {
      setPhase('exiting');
    }
  }

  useEffect(() => {
    if (phase === 'enter') {
      const id = requestAnimationFrame(() => setPhase('visible'));
      return () => cancelAnimationFrame(id);
    }
    if (phase === 'exiting') {
      timer.current = setTimeout(() => {
        setRender(false);
        setPhase('idle');
      }, exitMs);
      return () => clearTimeout(timer.current);
    }
    return undefined;
  }, [phase, exitMs]);

  if (!render) return null;

  const cls = [
    'error-message',
    phase === 'visible' && 'error-message--visible',
    phase === 'exiting' && 'error-message--exiting',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls}>
      <span>{shown}</span>
      {onDismiss && (
        <button className="error-dismiss" onClick={onDismiss} aria-label={dismissLabel}>
          &times;
        </button>
      )}
    </div>
  );
}
