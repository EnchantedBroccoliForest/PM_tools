import { useState, useEffect, useCallback } from 'react';

/**
 * Ambient mode definitions
 */
export const AMBIENT_MODES = {
  sunny: { label: 'Sunny', shortcut: 'S', icon: '☀️', classes: ['ambient-day', 'ambient-sunny'], overlay: 'leaves', description: 'Golden sunlight' },
  moonlight: { label: 'Moonlight', shortcut: 'M', icon: '🌕', classes: ['ambient-moonlight'], overlay: 'moon', description: 'Lunar glow' },
  rainy: { label: 'Rainy', shortcut: 'R', icon: '🌧️', classes: ['ambient-day', 'ambient-rainy'], overlay: 'rain', description: 'Cool storm' },
};

const ALL_AMBIENT_CLASSES = ['ambient-day', 'ambient-sunny', 'ambient-moonlight', 'ambient-rainy'];

function getStoredMode() {
  try {
    const stored = localStorage.getItem('ambientMode');
    if (stored && AMBIENT_MODES[stored]) return stored;
  } catch { /* ignore */ }
  return 'moonlight';
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
      const keyMap = { s: 'sunny', m: 'moonlight', r: 'rainy' };
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
  }, [mode]);

  return { mode, setMode, cycleMode, config: AMBIENT_MODES[mode] };
}
