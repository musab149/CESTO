import { create } from 'zustand';
import { translations } from '../constants/translations';

type Language = 'es' | 'en';

interface LanguageState {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
  lang: 'en',
  setLang: (lang) => set({ lang }),
  t: (key, params) => {
    let text = translations[get().lang][key] ?? key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v));
      });
    }
    return text;
  },
}));
