import { salesT, type SalesLang } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Sales-rep translations bound to THIS app's language store.
 *
 * The dictionaries live in @grocery-app/shared (i18n/sales.ts) because the rep
 * tablet app will render the same screens, and a string corrected in one copy
 * would stay wrong in the other — silently, since a missing key renders as the
 * key rather than throwing. What stays here is the three-line binding; mobile
 * writes its own against its own store.
 */
export function useSalesT(): (key: string, vars?: Record<string, string | number>) => string {
  const lang = useLanguageStore((s) => s.lang) as SalesLang;
  return (key, vars) => salesT(lang, key, vars);
}
