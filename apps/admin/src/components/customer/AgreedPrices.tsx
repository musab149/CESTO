import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Package, Tag, Trash2 } from 'lucide-react';
import {
  resolveImageUrl, useAdminCustomerDiscounts, useRemoveCustomerDiscount, type CustomerProductDiscount,
} from '@grocery-app/shared';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';

const euros = (v: number | string) =>
  `${Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/**
 * The prices agreed with this customer (2026-10-25): euros off one unit of a
 * product size, set on an order by staff or a rep and remembered. They see
 * and pay it in the shop, and the next order built for them starts with it.
 * The latest order that says anything about it wins; removing it here sends
 * the product back to its normal price for them.
 */
export default function AgreedPrices({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { data: rows, isLoading, isError } = useAdminCustomerDiscounts(userId);
  const remove = useRemoveCustomerDiscount(userId);
  const [confirming, setConfirming] = useState<CustomerProductDiscount | null>(null);
  const en = i18n.language === 'en';
  const nameOf = (x: { name_es: string; name_en: string }) => (en && x.name_en ? x.name_en : x.name_es);

  const doRemove = () => {
    if (!confirming) return;
    remove.mutate(confirming.variant_id, {
      onSuccess: () => {
        toast.success(t('agreedPrices.removed', 'Agreed price removed'));
        setConfirming(null);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : t('agreedPrices.removeFailed', 'Could not remove it')),
    });
  };

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-border">
        <h3 className="text-sm font-bold font-display text-ink">
          {t('agreedPrices.title', 'Agreed prices')}{rows?.length ? ` (${rows.length})` : ''}
        </h3>
      </div>
      {isLoading ? (
        <div className="px-5 py-4 space-y-2">
          <div className="skeleton h-10 !rounded-lg" />
          <div className="skeleton h-10 !rounded-lg" />
        </div>
      ) : isError ? (
        <p className="px-5 py-4 text-sm text-muted">{t('agreedPrices.loadError', 'Could not load the agreed prices.')}</p>
      ) : !rows?.length ? (
        <div className="px-5 py-4 flex items-start gap-3">
          <Tag className="w-4 h-4 text-muted mt-0.5 shrink-0" strokeWidth={1.75} />
          <p className="text-sm text-muted leading-relaxed">
            {t('agreedPrices.empty', 'None yet. A discount given on a product in an order for this customer is saved here, and their next orders start with it.')}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.variant_id} className="px-5 py-3 flex items-center gap-3">
              <span className="w-10 h-10 rounded-lg bg-surface-cream border border-border shrink-0 overflow-hidden flex items-center justify-center">
                {r.product.image_url
                  ? <img src={resolveImageUrl(r.product.image_url, 'thumb')} alt="" className="w-full h-full object-cover" draggable={false} />
                  : <Package size={16} strokeWidth={1.75} className="text-muted" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink leading-snug line-clamp-2">
                  {nameOf(r.product)}
                  {r.variant.name_es && <span className="text-muted"> · {nameOf(r.variant)}</span>}
                </p>
                <p className="text-[12px] text-muted tabular-nums">
                  <span className="line-through">{euros(r.price)}</span>
                  {' → '}
                  <span className="font-semibold text-ink">{euros(r.customer_price)}</span>
                  {' · '}
                  {t('agreedPrices.offEach', '{{amount}} off each', { amount: euros(r.amount) })}
                </p>
                {r.order && (
                  <p className="text-[11.5px] text-muted">
                    {t('agreedPrices.setOn', 'Set on')}{' '}
                    <Link to={`/orders/${r.order.id}`} className="font-mono text-brand hover:underline">{r.order.order_number}</Link>
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setConfirming(r)}
                aria-label={t('agreedPrices.remove', 'Remove agreed price')}
                title={t('agreedPrices.remove', 'Remove agreed price')}
                className="w-8 h-8 rounded-lg hover:bg-danger-bg flex items-center justify-center text-muted hover:text-danger transition-colors shrink-0"
              >
                <Trash2 size={15} strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmModal
        open={!!confirming}
        title={t('agreedPrices.confirmTitle', 'Remove this agreed price?')}
        message={confirming
          ? t('agreedPrices.confirmBody', '{{product}} goes back to {{price}} for this customer, in the shop and in the next order built for them.', {
            product: nameOf(confirming.product),
            price: euros(confirming.price),
          })
          : ''}
        confirmLabel={t('agreedPrices.removeShort', 'Remove')}
        danger
        confirmDisabled={remove.isPending}
        onConfirm={doRemove}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
