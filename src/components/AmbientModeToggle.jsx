import { AMBIENT_MODES } from '../hooks/useAmbientMode';
import { useLanguage } from '../hooks/useLanguage';
import './AmbientModeToggle.css';

export default function AmbientModeToggle({ mode, setMode }) {
  const { t } = useLanguage();
  const otherMode = mode === 'dark' ? 'light' : 'dark';
  const otherCfg = AMBIENT_MODES[otherMode];
  const currentCfg = AMBIENT_MODES[mode];
  const otherLabel = t(`ambient.${otherMode}`);

  return (
    <button
      type="button"
      className={`ambient-toggle ambient-toggle--${mode}`}
      onClick={() => setMode(otherMode)}
      title={t('ambient.switchTo', { label: otherLabel, shortcut: otherCfg.shortcut })}
      aria-label={t('ambient.switchToAria', { label: otherLabel })}
    >
      <span className="ambient-toggle__icon" aria-hidden="true">{currentCfg.icon}</span>
    </button>
  );
}
