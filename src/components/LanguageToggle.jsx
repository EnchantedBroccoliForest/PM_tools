import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES } from '../i18n';
import { useLanguage } from '../hooks/useLanguage';
import './LanguageToggle.css';

export default function LanguageToggle() {
  const { lang, setLang, t } = useLanguage();

  return (
    <div className="language-toggle">
      <select
        className="language-toggle__select"
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        aria-label={t('language.toggleAria')}
      >
        {SUPPORTED_LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {LANGUAGE_LABELS[code]}
          </option>
        ))}
      </select>
      <span className="language-toggle__chevron" aria-hidden="true">▾</span>
    </div>
  );
}
