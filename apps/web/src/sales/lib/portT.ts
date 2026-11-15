import { salesT, type SalesLang } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';

/**
 * react-i18next's `t`, for screens ported out of apps/admin.
 *
 * Those pages are copies. Every line of their JSX calls
 * `t('clients.name', 'Full name')` — admin's key, admin's inline English
 * default — and the single most valuable property of a port is that a diff
 * against the original shows only the changes that were meant. Rewriting a
 * hundred call sites to `t('sales.port.clients.name')` would bury three
 * deliberate differences in a hundred incidental ones.
 *
 * So the call sites stay exactly as they are in admin and this maps them:
 * `clients.name` is looked up as `sales.port.clients.name` in the sales
 * dictionary, whose values were copied out of admin's locale files.
 *
 * SIGNATURE MATCHES react-i18next's, which is what makes the files
 * interchangeable:
 *   t(key)
 *   t(key, 'English default')
 *   t(key, 'English default', { vars })
 *   t(key, { vars })                     ← i18next's other overload
 *
 * The default is honoured rather than ignored. A key missing from the
 * dictionary then renders admin's English instead of the raw key — the same
 * degradation admin has, which is deliberately NOT silent-looking: see
 * [[i18n-silent-fallthrough]]. Cross-check the extractor output after any
 * rename rather than trusting the screen to look fine.
 */
type Vars = Record<string, string | number>;

export function usePortT(): {
  (key: string): string;
  (key: string, fallback: string): string;
  (key: string, fallback: string, vars: Vars): string;
  (key: string, vars: Vars): string;
} {
  const lang = useLanguageStore((s) => s.lang) as SalesLang;

  return (key: string, b?: string | Vars, c?: Vars): string => {
    const fallback = typeof b === 'string' ? b : undefined;
    const vars = typeof b === 'object' ? b : c;

    const full = `sales.port.${key}`;
    // A count picks the _one / _other form where the dictionary has one —
    // "1 artículos" was the plain key read for every number.
    if (vars && typeof vars.count === 'number') {
      const form = `${full}_${vars.count === 1 ? 'one' : 'other'}`;
      const plural = salesT(lang, form, vars);
      if (plural !== form) return plural;
    }
    const hit = salesT(lang, full, vars);
    // salesT returns the key itself when it has nothing, which is how a miss
    // is detected here.
    if (hit !== full) return hit;

    if (fallback === undefined) return key;
    if (!vars) return fallback;
    return fallback.replace(/\{\{(\w+)\}\}/g, (m, n: string) => (
      n in vars ? String(vars[n]) : m
    ));
  };
}
