import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Briefcase, Check, ShoppingBag, Users, X } from 'lucide-react';
import {
  PRODUCT_AUDIENCES, lacksB2bPrice, unpricedSizesOf, useAdminProduct, useSetProductAudience, type ProductAudience,
} from '@grocery-app/shared';
import Combobox, { type ComboboxOption } from '@/components/form/Combobox';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import { formatCurrency } from '@/lib/format';

/*
 * Who the shop shows a product to (2026-10-25, user request): both kinds of
 * customer — each at their own price — B2C only, or B2B only. B2B is a
 * business account; everyone else, visitors included, is B2C. The API
 * enforces it everywhere a customer browses or buys (lib/audience).
 */

const ICONS: Record<ProductAudience, typeof Users> = { all: Users, b2c: ShoppingBag, b2b: Briefcase };

export function useAudienceWords() {
  const { t } = useTranslation();
  return {
    label: (a: ProductAudience) => (a === 'all'
      ? t('audience.all', 'All customers')
      : a === 'b2c' ? t('audience.b2c', 'B2C only') : t('audience.b2b', 'B2B only')),
    hint: (a: ProductAudience) => (a === 'all'
      ? t('audience.hintAll', 'Shoppers and businesses, each at their own price.')
      : a === 'b2c'
        ? t('audience.hintB2c', 'Hidden from business accounts.')
        : t('audience.hintB2b', 'Only business accounts see it — hidden from shoppers and visitors.')),
  };
}

export function useAudienceOptions(): ComboboxOption[] {
  const w = useAudienceWords();
  return PRODUCT_AUDIENCES.map((a) => {
    const Icon = ICONS[a];
    return { value: a, label: w.label(a), hint: w.hint(a), icon: <Icon size={14} strokeWidth={1.75} /> };
  });
}

/** The product form's choice: three buttons, the meaning of the picked one below. */
export function AudienceSegmented({ value, onChange }: { value: ProductAudience; onChange: (a: ProductAudience) => void }) {
  const { t } = useTranslation();
  const w = useAudienceWords();
  return (
    <div>
      <div role="radiogroup" aria-label={t('audience.label', 'Shown to')} className="inline-flex flex-wrap rounded-xl border border-border bg-surface-cream p-1 gap-1">
        {PRODUCT_AUDIENCES.map((a) => {
          const Icon = ICONS[a];
          const on = value === a;
          return (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(a)}
              className={`h-9 px-3.5 rounded-lg inline-flex items-center gap-1.5 text-sm font-semibold font-display transition-colors ${
                on ? 'bg-brand text-white shadow-sm' : 'text-ink hover:bg-card'
              }`}
            >
              <Icon size={15} strokeWidth={1.75} />
              {w.label(a)}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted font-body">{w.hint(value)}</p>
    </div>
  );
}

/**
 * The products table's control: change who sees a product without opening
 * it. B2B only needs a B2B price on every size, so a product missing one is
 * asked for it first (B2bPriceDialog) — from the row's own sizes, or from the
 * API's refusal when the row was stale.
 */
export function AudienceRowSelect({ productId, name, value, variants }: {
  productId: string;
  name: string;
  value: ProductAudience | undefined;
  variants?: Array<{ b2b_price?: number | string | null; is_active?: boolean }>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const w = useAudienceWords();
  const options = useAudienceOptions();
  const setAudience = useSetProductAudience();
  const [asking, setAsking] = useState(false);
  return (
    <div className="w-[150px]">
      <Combobox
        value={value ?? 'all'}
        onChange={(next) => {
          if (next === (value ?? 'all')) return;
          if (next === 'b2b' && variants?.some(lacksB2bPrice)) { setAsking(true); return; }
          setAudience.mutate({ id: productId, audience: next as ProductAudience }, {
            onSuccess: () => toast.success(t('audience.saved', '{{name}}: {{who}}', { name, who: w.label(next as ProductAudience) })),
            onError: (err) => {
              if (unpricedSizesOf(err)) { setAsking(true); return; }
              toast.error(err instanceof Error ? err.message : t('audience.failed', 'Could not change who sees it'));
            },
          });
        }}
        options={options}
        ariaLabel={t('audience.label', 'Shown to')}
        disabled={setAudience.isPending}
        menuPortal
        menuMinWidth={280}
      />
      {asking && <B2bPriceDialog productId={productId} name={name} onClose={() => setAsking(false)} />}
    </div>
  );
}

/**
 * Asks for the B2B prices a product is missing before it goes B2B only: one
 * field per size without one. The prices and the setting are saved together
 * (PUT /api/admin/products/:id/audience), so neither lands alone.
 */
export function B2bPriceDialog({ productId, name, onClose, onDone }: {
  productId: string;
  name: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const w = useAudienceWords();
  const { data: product, isLoading, refetch } = useAdminProduct(productId);
  const setAudience = useSetProductAudience();
  const [prices, setPrices] = useState<Record<string, string>>({});

  const sizes = (product?.variants ?? []).filter(lacksB2bPrice);
  const entered = sizes.map((v) => ({ variant_id: v.id, b2b_price: Number((prices[v.id] ?? '').replace(',', '.')) }));
  const ready = !isLoading && !!product && entered.every((p) => p.b2b_price > 0);

  function save() {
    setAudience.mutate({ id: productId, audience: 'b2b', b2bPrices: entered }, {
      onSuccess: () => {
        toast.success(t('audience.saved', '{{name}}: {{who}}', { name, who: w.label('b2b') }));
        onDone?.();
        onClose();
      },
      onError: (err) => {
        // A size was added or emptied meanwhile: show the sizes as they are now.
        if (unpricedSizesOf(err)) { void refetch(); return; }
        toast.error(err instanceof Error ? err.message : t('audience.failed', 'Could not change who sees it'));
      },
    });
  }

  return (
    <ConfirmModal
      open
      title={t('audience.priceFirstTitle', 'Set a B2B price first')}
      message={t('audience.priceFirstBody', {
        name,
        defaultValue: 'A business would pay the shop price for {{name}}. Give each size a B2B price to show it to B2B only.',
      })}
      confirmLabel={t('audience.priceFirstConfirm', 'Save and show to B2B only')}
      confirmDisabled={!ready || setAudience.isPending}
      onConfirm={save}
      onCancel={onClose}
    >
      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1].map((i) => <div key={i} className="h-[60px] rounded-lg bg-surface-linen animate-pulse" />)}
        </div>
      ) : sizes.length === 0 ? (
        <p className="text-sm font-body text-gray">{t('audience.priceFirstAllSet', 'Every size has a B2B price now.')}</p>
      ) : (
        <div className="space-y-2">
          {sizes.map((v, i) => (
            <div key={v.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface-cream px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold font-display text-ink truncate">{v.name_es}</p>
                <p className="text-xs font-body text-muted">
                  {t('audience.shopPrice', 'Shop price {{price}}', { price: formatCurrency(Number(v.price)) })}
                </p>
              </div>
              <div className="relative w-28 shrink-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted pointer-events-none">€</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  autoFocus={i === 0}
                  value={prices[v.id] ?? ''}
                  onChange={(e) => setPrices((p) => ({ ...p, [v.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && ready && !setAudience.isPending) save(); }}
                  placeholder="0.00"
                  aria-label={t('audience.b2bPriceFor', 'B2B price for {{size}}', { size: v.name_es })}
                  className="w-full h-10 pl-7 pr-2 rounded-lg border-2 border-border bg-card text-sm font-display text-ink placeholder:text-muted focus:border-brand focus:outline-none"
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </ConfirmModal>
  );
}

/**
 * After a bulk "B2B only": the products left as they were because a size has
 * no B2B price, each with a way to price it here and then.
 */
export function NeedsB2bPriceDialog({ count, products, onClose }: {
  count: number;
  products: Array<{ id: string; name_es: string }>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [pricing, setPricing] = useState<{ id: string; name_es: string } | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const more = count - products.length;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card rounded-2xl p-6 shadow-modal w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold font-display text-ink">
            {t('audience.needsTitle', { count, defaultValue: '{{count}} need a B2B price first' })}
          </h3>
          <button onClick={onClose} aria-label={t('common.close', 'Close')} className="p-1.5 rounded-lg hover:bg-surface-linen transition-colors">
            <X size={18} strokeWidth={1.75} className="text-muted" />
          </button>
        </div>
        <p className="text-sm font-body text-gray mb-4">
          {t('audience.needsBody', 'Left as they were: a business would pay the shop price for one of their sizes. Give them a B2B price to show them to B2B only.')}
        </p>
        <ul className="max-h-[320px] overflow-y-auto divide-y divide-border rounded-lg border border-border">
          {products.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="flex-1 min-w-0 text-sm font-semibold font-display text-ink truncate">{p.name_es}</span>
              {done.has(p.id) ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold font-display text-success shrink-0">
                  <Check size={14} strokeWidth={1.75} />
                  {t('audience.b2b', 'B2B only')}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setPricing(p)}
                  className="shrink-0 h-8 px-3 rounded-lg bg-card border border-border hover:border-brand hover:bg-brand-mist/40 text-ink text-xs font-semibold font-display transition"
                >
                  {t('audience.setPrice', 'Set B2B price')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {more > 0 && (
          <p className="mt-2 text-xs font-body text-muted">{t('audience.needsMore', { count: more, defaultValue: '…and {{count}} more.' })}</p>
        )}
        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="h-11 px-5 rounded-xl text-sm font-semibold font-display text-white bg-brand hover:bg-brand-mid transition-colors"
          >
            {t('audience.needsDone', 'Done')}
          </button>
        </div>
        {pricing && (
          <B2bPriceDialog
            productId={pricing.id}
            name={pricing.name_es}
            onClose={() => setPricing(null)}
            onDone={() => setDone((d) => new Set(d).add(pricing.id))}
          />
        )}
      </div>
    </div>
  );
}
