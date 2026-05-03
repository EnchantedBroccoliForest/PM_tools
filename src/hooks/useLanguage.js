import { useContext } from 'react';
import { LanguageContext } from './languageContext';
import { translate } from '../i18n';

// Falls back to English when no provider is mounted (so isolated component
// tests don't need to wrap themselves in <LanguageProvider>).
export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (ctx) return ctx;
  return {
    lang: 'en',
    setLang: () => {},
    t: (key, params) => translate('en', key, params),
  };
}
