import { partnerT, type PartnerLang } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Partner translations for mobile partner mode.
 *
 * Mirrors apps/web/src/partner/lib/i18n.ts exactly. Both are three lines over
 * the same shared dictionaries; only the language store differs, which is the
 * whole reason the hook is not shared too.
 *
 * Missing keys return the key itself.
 */
export function usePartnerT(): (key: string) => string {
  const lang = useLanguageStore((s) => s.lang) as PartnerLang;
  return (key: string) => partnerT(lang, key);
}
