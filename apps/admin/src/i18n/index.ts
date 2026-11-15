import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';

const LANGUAGE_KEY = 'cesto-admin-lang';

function savedLanguage(): 'en' | 'es' {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === 'es' ? 'es' : 'en';
  } catch {
    return 'en';
  }
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  // What this browser last chose; English until then.
  lng: savedLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  try { localStorage.setItem(LANGUAGE_KEY, lng); } catch { /* a private window: this session only */ }
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.language;

export default i18n;
