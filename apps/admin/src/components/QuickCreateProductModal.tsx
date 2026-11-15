import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2, Check } from 'lucide-react';
import {
  useAdminCategories, useQuickCreateProduct, priceWithVat, type Product, type VatCategory,
} from '@grocery-app/shared';
import { formatCurrency } from '@/lib/format';
import { useToast } from './Toast';
import { TextField, Select } from './form';

/**
 * Add a product to the catalogue in about twenty seconds.
 *
 * Not a trimmed-down ProductFormPage. That page is 1475 lines across four
 * tabs, takes no props and navigates away on save, so it cannot be shown in a
 * modal — and a rep standing at a counter with the item in their hand does
 * not want it. This asks for the few things only the person holding the
 * product knows, creates a real sellable row, and flags it `review_needed`
 * so a catalogue admin fills in images, descriptions and taxonomy later.
 *
 * VAT is asked here, because this is the single moment when the answer is
 * free. 0 % is chosen until somebody picks another (the user's default,
 * 2026-11-01), and the price typed is the base: the customer pays it plus
 * the band picked, which the price field shows as it is typed.
 */

const VAT_CHOICES: Array<{ value: VatCategory; pct: string; exampleKey: string }> = [
  { value: 'zero', pct: '0%', exampleKey: 'vatZeroEg' },
  { value: 'super_reduced', pct: '4%', exampleKey: 'vatSuperReducedEg' },
  { value: 'reduced', pct: '10%', exampleKey: 'vatReducedEg' },
  { value: 'general', pct: '21%', exampleKey: 'vatGeneralEg' },
];

export interface QuickCreateProductModalProps {
  /** Store the new product belongs to. null = the Cesto house store. */
  storeId?: string | null;
  onCreated: (product: Product) => void;
  onClose: () => void;
}

export default function QuickCreateProductModal({
  storeId = null, onCreated, onClose,
}: QuickCreateProductModalProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const quickCreate = useQuickCreateProduct();
  const { data: categories } = useAdminCategories();

  const [nameEs, setNameEs] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brand, setBrand] = useState('');
  const [vat, setVat] = useState<VatCategory>('zero');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [sku, setSku] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const categoryOptions = useMemo(() => categories ?? [], [categories]);

  const priceNum = Number(price.replace(',', '.'));
  const stockNum = Number(stock);
  const canSave =
    nameEs.trim().length > 0 &&
    categoryId !== '' &&
    Number.isFinite(priceNum) && priceNum > 0 &&
    Number.isInteger(stockNum) && stockNum >= 0;

  const save = async () => {
    if (!canSave) return;
    setSubmitError(null);
    try {
      const product = await quickCreate.mutateAsync({
        name_es: nameEs.trim(),
        // Mirrors what the full form does: the English name is optional in
        // practice, so it falls back to the Spanish one rather than blocking
        // a rep who only has the label in front of them.
        name_en: (nameEn.trim() || nameEs.trim()),
        category_id: categoryId,
        brand: brand.trim() || undefined,
        store_id: storeId,
        vat_category: vat,
        price: priceNum,
        stock_quantity: stockNum,
        sku: sku.trim() || undefined,
      });
      toast.success(
        t('quickProduct.created', 'Product added'),
        t('quickProduct.createdBody', 'Flagged for review so the catalogue team can complete it.'),
      );
      onCreated(product);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setSubmitError(msg);
      toast.error(t('quickProduct.failed', 'Could not add the product'), msg);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        className="bg-card w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-modal max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('quickProduct.title', 'New product')}
      >
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold font-display text-ink leading-tight">
              {t('quickProduct.title', 'New product')}
            </h2>
            <p className="text-xs text-muted mt-0.5">
              {t('quickProduct.subtitle', 'The essentials now — the catalogue team completes it later')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.cancel', 'Cancel')}
            className="w-8 h-8 rounded-lg hover:bg-surface-cream flex items-center justify-center shrink-0"
          >
            <X size={18} strokeWidth={1.75} className="text-muted" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <TextField
            label={t('quickProduct.nameEs', 'Name (Spanish)')}
            value={nameEs}
            onChange={(e) => setNameEs(e.target.value)}
            autoFocus
          />
          <TextField
            label={t('quickProduct.nameEn', 'Name (English)')}
            hint={t('quickProduct.nameEnHint', 'Optional — the Spanish name is used if blank')}
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
          />
          <Select
            label={t('quickProduct.category', 'Category')}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
          >
            <option value="">{t('quickProduct.categorySelect', 'Choose a category…')}</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name_es}</option>
            ))}
          </Select>
          <TextField
            label={t('quickProduct.brand', 'Brand')}
            hint={t('common.optional', 'Optional')}
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />

          <div className="grid grid-cols-2 gap-3">
            <TextField
              label={t('quickProduct.price', 'Price without IVA (€)')}
              hint={Number.isFinite(priceNum) && priceNum > 0
                ? t('quickProduct.withVat', 'With IVA: {{price}}', { price: formatCurrency(priceWithVat(priceNum, vat)) })
                : undefined}
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
            <TextField
              label={t('quickProduct.stock', 'Stock')}
              inputMode="numeric"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
            />
          </div>
          <TextField
            label={t('quickProduct.sku', 'SKU')}
            hint={t('common.optional', 'Optional')}
            value={sku}
            onChange={(e) => setSku(e.target.value)}
          />

          {/* Asked here because this is the one moment somebody is holding
              the product and can answer; 0 % until they pick another. */}
          <div>
            <p className="text-sm font-medium text-ink mb-1.5">{t('quickProduct.vat', 'IVA rate')}</p>
            <div role="radiogroup" aria-label={t('quickProduct.vat', 'IVA rate')} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {VAT_CHOICES.map((c) => {
                const active = vat === c.value;
                return (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setVat(c.value)}
                    className={`min-h-[56px] rounded-xl border-2 px-2 py-1.5 text-center transition-colors ${
                      active ? 'border-brand bg-brand-whisper' : 'border-border bg-card hover:border-brand/40'
                    }`}
                  >
                    <span className={`block text-sm font-bold font-display ${active ? 'text-brand' : 'text-ink'}`}>
                      {c.pct}
                    </span>
                    <span className="block text-[11px] text-muted leading-tight mt-0.5">
                      {t(`quickProduct.${c.exampleKey}`, '')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {submitError && (
            <p className="text-sm text-danger" role="alert">{submitError}</p>
          )}
        </div>

        <div className="sticky bottom-0 bg-card border-t border-border px-5 py-4 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[52px] rounded-xl bg-card border-2 border-border hover:border-brand font-semibold font-display text-sm text-ink"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave || quickCreate.isPending}
            className="flex-[2] min-h-[52px] rounded-xl bg-brand hover:bg-brand-mid disabled:opacity-50 text-white font-semibold font-display text-sm inline-flex items-center justify-center gap-2"
          >
            {quickCreate.isPending
              ? <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />
              : <Check size={16} strokeWidth={2.5} />}
            {t('quickProduct.save', 'Add product')}
          </button>
        </div>
      </div>
    </div>
  );
}
