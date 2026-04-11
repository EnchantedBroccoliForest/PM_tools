import { useState, useEffect, useCallback } from 'react';

/**
 * Theme mode definitions
 */
export const AMBIENT_MODES = {
  light: { label: 'Light', shortcut: 'L', icon: '☀️', classes: ['ambient-light'], description: 'Light theme' },
  dark: { label: 'Dark', shortcut: 'D', icon: '🌙', classes: ['ambient-dark'], description: 'Dark theme' },
};

const ALL_AMBIENT_CLASSES = ['ambient-light', 'ambient-dark'];

function getStoredMode() {
  try {
    const stored = localStorage.getItem('ambientMode');
    if (stored && AMBIENT_MODES[stored]) return stored;
  } catch { /* ignore */ }
  return 'dark';
}

export function useAmbientMode() {
  const [mode, setModeState] = useState(getStoredMode);

  const setMode = useCallback((newMode) => {
    setModeState(newMode);
    try { localStorage.setItem('ambientMode', newMode); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    document.body.classList.remove(...ALL_AMBIENT_CLASSES);
    document.body.classList.add(...AMBIENT_MODES[mode].classes);
    return () => document.body.classList.remove(...ALL_AMBIENT_CLASSES);
  }, [mode]);

  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const keyMap = { l: 'light', d: 'dark' };
      const newMode = keyMap[e.key.toLowerCase()];
      if (newMode && newMode !== mode) setMode(newMode);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mode, setMode]);

  const cycleMode = useCallback(() => {
    const modeKeys = Object.keys(AMBIENT_MODES);
    const idx = modeKeys.indexOf(mode);
    setMode(modeKeys[(idx + 1) % modeKeys.length]);
  }, [mode, setMode]);

  return { mode, setMode, cycleMode, config: AMBIENT_MODES[mode] };
}
