import { businessT, type BusinessLang } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Business-panel translations bound to THIS app's language store. The
 * dictionaries live in @grocery-app/shared (i18n/business.ts) because the app
 * will render the same screens; mobile binds its own store.
 */
export function useBizT(): (key: string, vars?: Record<string, string | number>) => string {
  const lang = useLanguageStore((s) => s.lang) as BusinessLang;
  return (key, vars) => businessT(lang, key, vars);
}
