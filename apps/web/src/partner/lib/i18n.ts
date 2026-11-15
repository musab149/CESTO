import { partnerT, type PartnerLang } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * Partner translations for the web dashboard.
 *
 * The dictionaries used to live in this file. They moved to
 * `@grocery-app/shared` (i18n/partner.ts) when mobile grew a partner mode,
 * because both apps render the same screens and a string fixed in one would
 * otherwise stay wrong in the other — silently, since a missing key renders as
 * the key rather than throwing.
 *
 * What stays here is the binding to THIS app's language store. Mobile has its
 * own store and its own three-line equivalent.
 *
 * Missing keys return the key itself, mirroring the customer store's fallback.
 */
export function usePartnerT(): (key: string) => string {
  const lang = useLanguageStore((s) => s.lang) as PartnerLang;
  return (key: string) => partnerT(lang, key);
}
