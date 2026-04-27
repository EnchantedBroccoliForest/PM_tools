import { AMBIENT_MODES } from '../hooks/useAmbientMode';
import './AmbientModeToggle.css';

export default function AmbientModeToggle({ mode, setMode }) {
  const otherMode = mode === 'dark' ? 'light' : 'dark';
  const otherCfg = AMBIENT_MODES[otherMode];
  const currentCfg = AMBIENT_MODES[mode];

  return (
    <button
      type="button"
      className={`ambient-toggle ambient-toggle--${mode}`}
      onClick={() => setMode(otherMode)}
      title={`Switch to ${otherCfg.label} theme [${otherCfg.shortcut}]`}
      aria-label={`Switch to ${otherCfg.label} theme`}
    >
      <span className="ambient-toggle__icon" aria-hidden="true">{currentCfg.icon}</span>
    </button>
  );
}
