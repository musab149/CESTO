import { useTranslation } from 'react-i18next';
import type { InvoiceBlocker } from '@grocery-app/shared';

/**
 * Blocker text in the panel's language, not the API's.
 *
 * The server builds `message` in Spanish because it has no idea who is
 * reading — it is one string for an admin panel that runs in English, a
 * partner surface, and whatever comes next. So the code is the contract and
 * the prose is the fallback: a blocker this build has never heard of still
 * says something useful rather than nothing.
 *
 * `count` goes ONLY to unreviewed_vat. i18next pluralises any lookup that
 * carries a count, so handing it to the others would send them looking for a
 * `_other` form that does not exist, miss, and fall through to the Spanish —
 * which is the bug this exists to fix.
 */
export function useBlockerMessage(): (b: InvoiceBlocker) => string {
  const { t } = useTranslation();
  return (b) => {
    const key = `invoices.blocker.${b.code}`;
    const translated = b.code === 'unreviewed_vat'
      ? t(key, { count: b.product_ids?.length ?? 0, defaultValue: '' })
      : t(key, { defaultValue: '' });
    return translated || b.message;
  };
}
