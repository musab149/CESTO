import { Minus, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { useToast } from '@/components/Toast';
import QuantityField from '@/components/QuantityField';
import { cappedMessage } from '@/lib/quantityMessages';
import { useCartWords } from '@/lib/homeGroceryShopper';

interface AddToCartButtonProps {
  productId: string;
  variantId: string;
  maxStock: number;
  compact?: boolean;
  tone?: 'brand' | 'dark';
}

export default function AddToCartButton({ productId, variantId, maxStock, compact, tone = 'brand' }: AddToCartButtonProps) {
  const quantity = useCartStore((s) => s.getQuantity(variantId));
  const addItem = useCartStore((s) => s.addItem);
  const updateQuantity = useCartStore((s) => s.updateQuantity);
  const { t, lang } = useLanguageStore();
  const toast = useToast();
  // "Añadir a la lista" for a Home Grocery household — see useCartWords.
  const words = useCartWords();

  const outOfStock = maxStock === 0;
  // A Home Grocery household's order is never parked as a draft — short stock
  // refuses it — so for them an out-of-stock product cannot go on the list.
  const soldOut = outOfStock && words.shopper;
  // Out of stock is still orderable — it lands as a draft order until
  // restocked. No live stock number to cap against, so fall back to a
  // modest fixed default instead of leaving the stepper unbounded.
  const stepperMax = outOfStock ? 10 : maxStock;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {quantity === 0 ? (
        <motion.button
          key="add"
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.85, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!soldOut) addItem(productId, variantId); }}
          disabled={soldOut}
          aria-label={soldOut ? (lang === 'en' ? 'Out of stock' : 'Agotado') : compact ? words.add : undefined}
          className={`${soldOut ? 'opacity-50 cursor-not-allowed ' : ''}` + (
            compact
              ? 'w-10 h-10 rounded-full bg-brand-deepest text-white flex items-center justify-center hover:bg-brand active:scale-95 transition-all shadow-[0_4px_14px_rgba(15,23,42,0.22)]'
              : tone === 'dark'
                ? 'group relative w-full h-9 rounded-md bg-ink text-card text-[12.5px] font-semibold font-ui hover:bg-charcoal active:scale-[0.98] transition-all flex items-center justify-center gap-1.5'
                : 'group relative w-full h-10 rounded-xl bg-brand text-white text-[13px] font-semibold font-ui hover:bg-brand-deepest active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 shadow-brand'
          )}
        >
          {tone !== 'dark' && <Plus size={compact ? 18 : 15} strokeWidth={compact ? 2 : 2.5} />}
          {!compact && (
            <span>
              {soldOut ? (lang === 'en' ? 'Out of stock' : 'Agotado') : outOfStock ? t('product.preorder') : words.add}
            </span>
          )}
        </motion.button>
      ) : (
        <motion.div
          key="stepper"
          initial={{ scale: 0.92, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.92, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className={`w-full ${tone === 'dark' ? 'h-9 rounded-md bg-ink text-card' : 'h-10 rounded-xl bg-brand-deepest shadow-brand text-white'} flex items-center overflow-hidden`}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
          <button
            onClick={() => updateQuantity(variantId, quantity - 1)}
            className="w-10 h-full flex items-center justify-center hover:bg-brand transition-colors"
            aria-label="decrease"
          >
            <Minus size={15} strokeWidth={2.5} />
          </button>
          <span className="flex-1 flex justify-center">
            <QuantityField
              value={quantity}
              max={stepperMax}
              onChange={(n) => updateQuantity(variantId, n)}
              onCapped={(n) => { const m = cappedMessage(lang, n); toast.warning(m.title, m.body); }}
              label={lang === 'en' ? 'Quantity' : 'Cantidad'}
              className="font-bold text-[14px] font-mono text-white"
            />
          </span>
          <button
            onClick={() => { if (quantity < stepperMax) updateQuantity(variantId, quantity + 1); }}
            className={`w-10 h-full flex items-center justify-center hover:bg-brand transition-colors ${quantity >= stepperMax ? 'opacity-30 cursor-not-allowed' : ''}`}
            disabled={quantity >= stepperMax}
            aria-label="increase"
          >
            <Plus size={15} strokeWidth={2.5} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
