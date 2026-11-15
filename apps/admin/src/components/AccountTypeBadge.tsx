import { useTranslation } from 'react-i18next';

/**
 * What kind of account this is, in the wording the rep chose when opening it
 * — B2B (Wholesale) or Home Grocery, the same two names the client form uses.
 *
 * Worth a column even on tabs that are already filtered by type, because two
 * of them are not: a partner or a rashan subscriber can hold either kind, and
 * which one decides the prices they are charged.
 *
 * `is_business` is optional on the row types — an API deployed before it was
 * selected does not send it — so undefined renders nothing rather than
 * claiming B2C.
 */
export default function AccountTypeBadge({ isBusiness, className = '' }: {
  isBusiness?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  if (isBusiness === undefined) return null;
  return (
    <span
      className={`inline-flex items-center h-5 px-1.5 rounded text-[11px] font-bold uppercase tracking-wide shrink-0 ${
        isBusiness ? 'bg-brand-mist text-brand' : 'bg-surface-linen text-gray'
      } ${className}`}
    >
      {isBusiness ? t('customers.typeB2b', 'B2B') : t('customers.typeB2c', 'B2C')}
    </span>
  );
}
