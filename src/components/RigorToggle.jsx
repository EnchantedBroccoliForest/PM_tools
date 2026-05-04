import { useLanguage } from '../hooks/useLanguage';
import './RigorToggle.css';

const RIGOR_CONFIG = {
  human: { icon: '🧑', labelKey: 'header.humanMode', tooltipKey: 'header.humanModeTooltip', ariaKey: 'header.humanModeAria' },
  machine: { icon: '🤖', labelKey: 'header.machineMode', tooltipKey: 'header.machineModeTooltip', ariaKey: 'header.machineModeAria' },
};

export default function RigorToggle({ rigor, onChange, disabled }) {
  const { t } = useLanguage();
  const next = rigor === 'human' ? 'machine' : 'human';
  const currentCfg = RIGOR_CONFIG[rigor] ?? RIGOR_CONFIG.human;
  const nextCfg = RIGOR_CONFIG[next];
  const nextLabel = t(nextCfg.labelKey);

  return (
    <button
      type="button"
      className={`rigor-icon-toggle rigor-icon-toggle--${rigor}`}
      onClick={() => onChange(next)}
      disabled={disabled}
      title={t('rigor.switchTo', { label: nextLabel })}
      aria-label={t('rigor.switchToAria', { label: nextLabel })}
    >
      <span className="rigor-icon-toggle__icon" aria-hidden="true">{currentCfg.icon}</span>
    </button>
  );
}
