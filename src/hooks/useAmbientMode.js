import { useState, useEffect, useCallback } from 'react';

/**
 * Ambient mode definitions
 */
export const AMBIENT_MODES = {
  night: { label: 'Night', shortcut: 'N', icon: '🌙', classes: [], overlay: null, description: 'Cyberpunk dark' },
  day: { label: 'Day', shortcut: 'D', icon: '☀️', classes: ['ambient-day'], overlay: null, description: 'Warm paper light' },
  sunny: { label: 'Sunny', shortcut: 'S', icon: '🌿', classes: ['ambient-day', 'ambient-sunny'], overlay: 'leaves', description: 'Golden sunlight' },
  moonlight: { label: 'Moonlight', shortcut: 'M', icon: '🌕', classes: ['ambient-moonlight'], overlay: 'moon', description: 'Lunar glow' },
  rainy: { label: 'Rainy', shortcut: 'R', icon: '🌧️', classes: ['ambient-day', 'ambient-rainy'], overlay: 'rain', description: 'Cool storm' },
};

const ALL_AMBIENT_CLASSES = ['ambient-day', 'ambient-sunny', 'ambient-moonlight', 'ambient-rainy'];

export function useAmbientMode(initialMode = 'night') {
  const [mode, setMode] = useState(initialMode);

  useEffect(() => {
    document.body.classList.remove(...ALL_AMBIENT_CLASSES);
    document.body.classList.add(...AMBIENT_MODES[mode].classes);
    return () => document.body.classList.remove(...ALL_AMBIENT_CLASSES);
  }, [mode]);

  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      const keyMap = { d: 'day', n: 'night', s: 'sunny', m: 'moonlight', r: 'rainy' };
      const newMode = keyMap[e.key.toLowerCase()];
      if (newMode && newMode !== mode) setMode(newMode);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [mode]);

  const cycleMode = useCallback(() => {
    const modeKeys = Object.keys(AMBIENT_MODES);
    const idx = modeKeys.indexOf(mode);
    setMode(modeKeys[(idx + 1) % modeKeys.length]);
  }, [mode]);

  return { mode, setMode, cycleMode, config: AMBIENT_MODES[mode] };
}
