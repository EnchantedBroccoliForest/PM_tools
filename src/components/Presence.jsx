import { useEffect, useRef, useState } from 'react';

/**
 * Wraps a child so it animates in (.enter -> .enter--mounted) on render,
 * and animates out (.exit) for `exitMs` milliseconds before unmounting
 * when the `when` prop flips to false.
 */
export default function Presence({
  when,
  children,
  className = '',
  as = 'div',
  exitMs = 150,
  ...rest
}) {
  const Tag = as;
  const [render, setRender] = useState(when);
  const [phase, setPhase] = useState(when ? 'mounted' : 'idle');
  const [lastWhen, setLastWhen] = useState(when);
  const timer = useRef(null);

  if (when !== lastWhen) {
    setLastWhen(when);
    if (when) {
      setRender(true);
      setPhase('enter');
    } else if (render) {
      setPhase('exit');
    }
  }

  useEffect(() => {
    if (phase === 'enter') {
      const id = requestAnimationFrame(() => setPhase('mounted'));
      return () => cancelAnimationFrame(id);
    }
    if (phase === 'exit') {
      timer.current = setTimeout(() => {
        setRender(false);
        setPhase('idle');
      }, exitMs);
      return () => clearTimeout(timer.current);
    }
    return undefined;
  }, [phase, exitMs]);

  if (!render) return null;

  const phaseClass =
    phase === 'exit' ? 'exit' : phase === 'mounted' ? 'enter enter--mounted' : 'enter';
  const cls = [phaseClass, className].filter(Boolean).join(' ');
  return (
    <Tag className={cls} {...rest}>
      {children}
    </Tag>
  );
}
