import { useMemo, useState } from 'react';
import { PackagePlus, Loader2, Check } from 'lucide-react';
import {
  useSalesCategories, useQuickCreateSalesProduct, priceWithVat,
  type SalesProduct as Product, type SalesRepStore, type VatCategory,
} from '@grocery-app/shared';
import { formatCurrency } from '../lib/format';
import { useToast } from './Toast';
import { TextField, Select } from './form';
import { usePortT } from '../lib/portT';
import { Button, Dialog } from './Dialog';

/**
 * Add a product to the catalogue in about twenty seconds.
 *
 * Ported verbatim from apps/admin/src/components/QuickCreateProductModal.tsx.
 * The admin's shop picker became the rep's own shops (lib/repStore on the
 * API): with one, the product goes there; with several, the rep picks which.
 * The order it lands on is still Cesto's.
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
  onCreated: (product: Product) => void;
  onClose: () => void;
  /**
   * The rep's shops that can be sold from (lib/repStore on the API). One: the
   * product goes there. Several: the rep picks which. Undefined: an API from
   * before shops, which files it itself.
   */
  shops?: SalesRepStore[];
}

export default function QuickCreateProductModal({
  onCreated, onClose, shops,
}: QuickCreateProductModalProps) {
  const t = usePortT();
  const toast = useToast();
  const quickCreate = useQuickCreateSalesProduct();
  const { data: categories } = useSalesCategories();

  const [nameEs, setNameEs] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brand, setBrand] = useState('');
  const [vat, setVat] = useState<VatCategory>('zero');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [sku, setSku] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Which shop it goes into: asked only when there is a choice to make.
  const pickShop = (shops?.length ?? 0) > 1;
  const [shopId, setShopId] = useState('');
  const intoId = pickShop ? shopId : shops?.[0]?.id;

  const categoryOptions = useMemo(() => categories ?? [], [categories]);

  const priceNum = Number(price.replace(',', '.'));
  const stockNum = Number(stock);
  const canSave =
    nameEs.trim().length > 0 &&
    categoryId !== '' &&
    Number.isFinite(priceNum) && priceNum > 0 &&
    Number.isInteger(stockNum) && stockNum >= 0 &&
    (!pickShop || shopId !== '');

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
        vat_category: vat,
        price: priceNum,
        stock_quantity: stockNum,
        sku: sku.trim() || undefined,
        store_id: intoId || undefined,
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
    <Dialog
      onClose={onClose}
      closeLabel={t('common.cancel', 'Cancel')}
      icon={PackagePlus}
      title={t('quickProduct.title', 'New product')}
      subtitle={(
        <>
          {t('quickProduct.subtitle', 'The essentials now — the catalogue team completes it later')}
          {shops?.length === 1 && <> {t('repShop.quickAddInto', 'It goes into {{name}}.', { name: shops[0].name })}</>}
        </>
      )}
      ariaLabel={t('quickProduct.title', 'New product')}
      bodyClassName="px-5 py-4 space-y-4"
      footer={(
        <div className="flex gap-2.5">
          <Button variant="secondary" className="flex-1" onClick={onClose}>{t('common.cancel', 'Cancel')}</Button>
          <Button className="flex-[2]" onClick={save} disabled={!canSave || quickCreate.isPending}>
            {quickCreate.isPending
              ? <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />
              : <Check size={16} strokeWidth={2.5} />}
            {t('quickProduct.save', 'Add product')}
          </Button>
        </div>
      )}
    >
          {/* First: it decides whose product this is, and a rep with the
              item in hand knows which shop it came from. */}
          {pickShop && (
            <Select
              label={t('repShop.quickAddShop', 'Shop')}
              value={shopId}
              onChange={(e) => setShopId(e.target.value)}
            >
              <option value="">{t('repShop.quickAddPick', 'Pick which shop it goes into')}</option>
              {shops!.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          )}
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
                    className={`min-h-[56px] rounded-xl border px-2 py-1.5 text-center transition-colors ${
                      active ? 'border-brand ring-1 ring-brand bg-brand-whisper/60' : 'border-border bg-card hover:border-brand/40'
                    }`}
                  >
                    <span className={`block text-sm font-bold font-display ${active ? 'text-brand' : 'text-ink'}`}>
                      {c.pct}
                    </span>
                    <span className="block text-[10px] text-muted leading-tight mt-0.5">
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
    </Dialog>
  );
}
