import { AMBIENT_MODES } from '../hooks/useAmbientMode';
import './AmbientModeToggle.css';

export default function AmbientModeToggle({ mode, setMode }) {
  const modeEntries = Object.entries(AMBIENT_MODES);

  return (
    <div className="ambient-bar">
      <div className="ambient-bar__inner">
        {modeEntries.map(([key, cfg]) => {
          const isActive = mode === key;
          return (
            <button
              key={key}
              type="button"
              className={`ambient-btn ${isActive ? 'ambient-btn--active' : ''} ambient-btn--${key}`}
              onClick={() => setMode(key)}
              title={`${cfg.label} — ${cfg.description} [${cfg.shortcut}]`}
              aria-pressed={isActive}
            >
              <span className="ambient-btn__icon">{cfg.icon}</span>
              <span className="ambient-btn__label">{cfg.label}</span>
              <span className="ambient-btn__shortcut">{cfg.shortcut}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
