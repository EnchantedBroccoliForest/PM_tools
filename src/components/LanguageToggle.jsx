import { LANGUAGE_LABELS } from '../i18n';
import { useLanguage } from '../hooks/useLanguage';
import './LanguageToggle.css';

export default function LanguageToggle() {
  const { lang, setLang, t } = useLanguage();
  const next = lang === 'en' ? 'zh' : 'en';
  const nextLabel = LANGUAGE_LABELS[next];

  return (
    <button
      type="button"
      className={`language-toggle language-toggle--${lang}`}
      onClick={() => setLang(next)}
      title={t('language.switchTo', { label: nextLabel })}
      aria-label={t('language.toggleAria')}
    >
      <span className="language-toggle__current">{LANGUAGE_LABELS[lang]}</span>
      <span className="language-toggle__sep" aria-hidden="true">/</span>
      <span className="language-toggle__next">{nextLabel}</span>
    </button>
  );
}
