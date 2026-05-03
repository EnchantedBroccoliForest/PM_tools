import { useCallback, useEffect, useMemo, useState } from 'react';
import { LanguageContext } from '../hooks/languageContext';
import { SUPPORTED_LANGUAGES, translate } from '../i18n';

const STORAGE_KEY = 'language';

function getStoredLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && SUPPORTED_LANGUAGES.includes(stored)) return stored;
  } catch { /* ignore */ }
  return 'en';
}

export default function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(getStoredLanguage);

  const setLang = useCallback((next) => {
    if (!SUPPORTED_LANGUAGES.includes(next)) return;
    setLangState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  }, [lang]);

  const value = useMemo(() => ({
    lang,
    setLang,
    t: (key, params) => translate(lang, key, params),
  }), [lang, setLang]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}
