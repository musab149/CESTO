import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, RotateCcw } from 'lucide-react';
import { useReorder, type ReorderResult } from '@grocery-app/shared';
import { useCartStore } from '@/stores/cartStore';
import { useLanguageStore } from '@/stores/languageStore';
import { useToast } from '@/sales/components/Toast';
import { Dialog } from '@/sales/components/Dialog';
import { useBizT } from '../lib/i18n';

/**
 * "Repetir pedido" in the business panel (2026-10-29): the shop's
 * ReorderButton, in the panel's dialog and toasts, landing on the panel's
 * cart. The same three rules — ask before replacing a cart that has
 * something in it, reload the cart on screen, and name what could not go
 * back (off sale, out of stock, fewer left).
 *
 * A line that has lost its wholesale price does go back, and the cart says
 * so: it is the cart that holds checkout until it is taken out.
 */
export default function ReorderButton({ orderId, className, label, children }: {
  orderId: string; className: string; label?: string;
  /** Its own inside (the home's quick-action tile), told when it is busy. */
  children?: (busy: boolean) => React.ReactNode;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const t = useBizT();
  const en = useLanguageStore((s) => s.lang) === 'en';
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
    if ((r.added ?? r.items.length) > 0) toast.success(t('biz.reorder.added'), t('biz.reorder.addedBody'));
    if (skipped.length > 0) toast.warning(t('biz.reorder.skipped'), skipped.map(nameOf).join(', '));
    else if (r.skipped.length > 0) toast.warning(t('biz.reorder.someSkipped'));
    if (reduced.length > 0) {
      toast.warning(t('biz.reorder.reduced'), reduced.map((x) => t('biz.reorder.reducedLine', { name: nameOf(x), added: x.added, wanted: x.wanted })).join(', '));
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
      navigate('/business/cart');
    } catch (e) {
      toast.error(t('biz.reorder.failed'), e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => (count > 0 ? setAsking(true) : void run('replace'))} disabled={busy} className={className}>
        {children ? children(busy) : (
          <>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} strokeWidth={1.9} />}
            {label ?? t('biz.reorder.cta')}
          </>
        )}
      </button>
      {asking && (
        <Dialog
          onClose={() => setAsking(false)}
          icon={RotateCcw}
          title={t(count === 1 ? 'biz.reorder.askTitle_one' : 'biz.reorder.askTitle_other', { count })}
          subtitle={t('biz.reorder.askBody')}
          closeLabel={t('biz.closeMenu')}
          bodyClassName="px-5 pb-5 pt-1"
        >
          <div className="grid gap-2.5">
            <button type="button" onClick={() => void run('add')} className="min-h-[52px] rounded-xl bg-brand text-white text-[15px] font-bold font-display hover:bg-brand-mid transition-colors">
              {t('biz.reorder.add')}
            </button>
            <button type="button" onClick={() => void run('replace')} className="min-h-[52px] rounded-xl border border-border bg-card text-ink text-[15px] font-bold font-display hover:bg-surface-cream transition-colors">
              {t('biz.reorder.replace')}
            </button>
            <button type="button" onClick={() => setAsking(false)} className="min-h-[44px] rounded-xl text-gray text-[14px] font-semibold font-display hover:text-ink">
              {t('biz.cancel')}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
