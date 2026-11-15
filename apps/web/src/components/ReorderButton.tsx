import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, RotateCcw } from 'lucide-react';
import { useReorder, type ReorderResult } from '@grocery-app/shared';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { useToast } from '@/components/Toast';
import { useCartWords } from '@/lib/homeGroceryShopper';

/**
 * "Order this again": a past order's products back in the cart — a Home
 * Grocery household's grocery list — then off to it.
 *
 * Three things the old button got wrong, all fixed here:
 *   · it REPLACED the cart on the server without a word, so whatever was
 *     being picked was gone; now, with something already in it, it asks
 *     whether to add to it or start again;
 *   · the cart on screen lives in the browser, and was never reloaded, so
 *     the reordered products did not show up at all;
 *   · what could not go back (off sale, out of stock, fewer left) was
 *     dropped silently; now it is named.
 */
export default function ReorderButton({ orderId, className, label }: {
  orderId: string;
  className: string;
  /** Defaults to "Repetir pedido". */
  label?: string;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const { lang } = useLanguageStore();
  const en = lang === 'en';
  const words = useCartWords();
  const reorder = useReorder();
  const count = useCartStore((s) => s.items.length);
  const syncToServer = useCartStore((s) => s.syncToServer);
  const loadFromServer = useCartStore((s) => s.loadFromServer);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const nameOf = (x: { name_es: string; name_en: string }) => (en ? x.name_en : x.name_es);

  const say = (r: ReorderResult) => {
    const skipped = r.skipped_items ?? [];
    const reduced = r.reduced ?? [];
    if ((r.added ?? r.items.length) > 0) {
      toast.success(
        words.shopper ? (en ? 'Added to your list' : 'Añadido a tu lista') : (en ? 'Added to your cart' : 'Añadido a tu carrito'),
        en ? 'Check it and place the order when you are ready.' : 'Revísala y haz el pedido cuando quieras.',
      );
    }
    if (skipped.length > 0) {
      toast.warning(
        en ? 'Not available now' : 'No disponible ahora',
        skipped.map(nameOf).join(', '),
      );
    } else if (r.skipped.length > 0) {
      // An older API: it says how many, not which.
      toast.warning(en ? 'Some products are not available now' : 'Algunos productos no están disponibles ahora');
    }
    if (reduced.length > 0) {
      toast.warning(
        en ? 'Fewer than last time' : 'Menos que la última vez',
        reduced.map((x) => (en ? `${nameOf(x)}: ${x.added} of ${x.wanted}` : `${nameOf(x)}: ${x.added} de ${x.wanted}`)).join(', '),
      );
    }
  };

  const run = async (mode: 'add' | 'replace') => {
    setAsking(false);
    setBusy(true);
    try {
      // The server adds to ITS copy of the cart, so first make it this one.
      if (mode === 'add') await syncToServer();
      const r = await reorder.mutateAsync({ id: orderId, mode });
      await loadFromServer();
      say(r);
      navigate('/cart');
    } catch (e) {
      toast.error(en ? 'Could not repeat this order' : 'No hemos podido repetir el pedido', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => (count > 0 ? setAsking(true) : void run('replace'))} disabled={busy} className={className}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} strokeWidth={1.75} />}
        {label ?? (en ? 'Order again' : 'Repetir pedido')}
      </button>

      {asking && (
        <div className="fixed inset-0 z-50 bg-veil/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setAsking(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="reorder-title"
            className="bg-card rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-6 shadow-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="reorder-title" className="text-[18px] font-bold text-ink font-display">
              {words.shopper
                ? (en ? `Your list already has ${count} ${count === 1 ? 'product' : 'products'}` : `Tu lista ya tiene ${count} ${count === 1 ? 'producto' : 'productos'}`)
                : (en ? `Your cart already has ${count} ${count === 1 ? 'product' : 'products'}` : `Tu carrito ya tiene ${count} ${count === 1 ? 'producto' : 'productos'}`)}
            </h3>
            <p className="mt-2 text-[14px] text-gray font-body leading-relaxed">
              {en
                ? 'Add this order to what you have, or start again with just this order?'
                : '¿Añadimos este pedido a lo que ya tienes, o empiezas de nuevo solo con este pedido?'}
            </p>
            <div className="mt-6 grid gap-2.5">
              <button type="button" onClick={() => void run('add')}
                className="min-h-[52px] rounded-xl bg-brand text-white text-[15px] font-bold font-display hover:bg-brand-mid">
                {en ? 'Add to what I have' : 'Añadir a lo que tengo'}
              </button>
              <button type="button" onClick={() => void run('replace')}
                className="min-h-[52px] rounded-xl border border-border text-ink text-[15px] font-bold font-display hover:bg-surface-linen">
                {en ? 'Start again with this order' : 'Empezar de nuevo con este pedido'}
              </button>
              <button type="button" onClick={() => setAsking(false)}
                className="min-h-[44px] rounded-xl text-gray text-[14px] font-semibold font-display hover:text-ink">
                {en ? 'Cancel' : 'Cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
