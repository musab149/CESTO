import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Check, Loader2, Lock, Package, PackagePlus, Plus, RotateCcw, Search, Store, UserRound, X,
} from 'lucide-react';
import {
  HOUSE_STORE_ID, repStoresOf, useAdminMe, useAdminRepProducts, useAdminSalesRep,
  useAssignRepProducts, useUnassignRepProducts, type AdminRepProduct,
} from '@grocery-app/shared';
import BackLink from '@/components/BackLink';
import ConfirmModal from '@/components/ConfirmModal';
import EmptyState from '@/components/EmptyState';
import { Skeleton, TableSkeleton } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { useGoBack } from '@/lib/useGoBack';
import { HiddenTag, ProductMeta, Thumb } from '@/components/salesRep/RepProducts';
import { useDebounced } from '@/components/salesRep/repProductFormat';
import RepProductCatalogue, { type RepPickState } from '@/components/salesRep/RepProductCatalogue';

/**
 * A rep's products, assigned by hand — on a page of their own, laid out like
 * the order builder (2026-10-27, user: "instead of this dialog we can show a
 * full screen or side panel that can have the ui for products the way we have
 * on the create order stuff.. We should be able to search products and also
 * be able to filter them for admin").
 *
 * Left, what they have and what is about to change; right, every shop's
 * catalogue with the builder's search, category strip and filters. Picks and
 * removals are collected, not written as they are tapped — the same as a
 * basket — and go together on Save, so a slip on a card costs nothing and
 * the list says exactly what will change before it does.
 */

const PREVIEW = 8;

type Changes = Map<string, AdminRepProduct>;

export default function SalesRepProductsPage() {
  const { t } = useTranslation();
  const { userId = '' } = useParams<{ userId: string }>();
  const goBack = useGoBack();
  const toast = useToast();

  const { data: me, isLoading: meLoading } = useAdminMe();
  const canEdit = me?.role === 'super_admin';
  const { data: rep, isLoading: repLoading } = useAdminSalesRep(userId);

  const [adds, setAdds] = useState<Changes>(() => new Map());
  const [removes, setRemoves] = useState<Changes>(() => new Map());
  const [catalogueOpen, setCatalogueOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [saving, setSaving] = useState(false);
  const pending = adds.size + removes.size;

  // Their list as it stands: by shop (the profile card links straight to
  // one, ?shop=), and searchable once it is long.
  const [params, setParams] = useSearchParams();
  const shop = params.get('shop') ?? '';
  const pickShop = (id: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    if (id) n.set('shop', id); else n.delete('shop');
    return n;
  }, { replace: true });
  const [typed, setTyped] = useState('');
  const q = useDebounced(typed.trim());
  const [expanded, setExpanded] = useState(false);
  const { data: current, isLoading: listLoading } = useAdminRepProducts(userId, { q: q || undefined, storeId: shop || undefined, limit: 100 });
  const items = current?.items ?? [];
  const total = current?.total ?? 0;
  const byShop = current?.by_shop;
  // All of them, whatever the list is narrowed to.
  const allCount = byShop ? byShop.reduce((n, g) => n + g.count, 0) : (q || shop ? null : total);
  const hidden = !q && !shop && current && allCount !== null ? allCount - current.sellable : 0;
  const shown = expanded || q ? items : items.slice(0, PREVIEW);

  const assign = useAssignRepProducts();
  const unassign = useUnassignRepProducts();

  const stores = repStoresOf(rep);
  const shopIds = useMemo(() => new Set((stores ?? []).filter((s) => s.sellable).map((s) => s.id)), [stores]);
  const shopNames = (stores ?? []).filter((s) => s.sellable)
    .map((s) => (s.id === HOUSE_STORE_ID ? t('salesReps.products.cesto', 'Cesto Shop') : s.name));

  const stateOf = useCallback((p: AdminRepProduct): RepPickState => {
    if (p.assigned) return removes.has(p.id) ? 'removing' : 'assigned';
    return adds.has(p.id) ? 'adding' : 'none';
  }, [adds, removes]);

  const without = (m: Changes, id: string) => { const n = new Map(m); n.delete(id); return n; };
  const toggle = useCallback((p: AdminRepProduct) => {
    if (p.assigned) setRemoves((m) => (m.has(p.id) ? without(m, p.id) : new Map(m).set(p.id, p)));
    else setAdds((m) => (m.has(p.id) ? without(m, p.id) : new Map(m).set(p.id, p)));
  }, []);
  const pickMany = useCallback((ps: AdminRepProduct[]) => setAdds((m) => {
    const n = new Map(m);
    for (const p of ps) if (!p.assigned) n.set(p.id, p);
    return n;
  }), []);
  // A row of their list is theirs by definition; it carries no `assigned` flag.
  const toggleTheirs = (p: AdminRepProduct) => toggle({ ...p, assigned: true });

  // Leaving with changes asks first — the browser's own prompt for a reload
  // or a closed tab, ours for the way back.
  useEffect(() => {
    if (pending === 0) return;
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [pending]);
  const back = () => goBack(`/sales-reps/${userId}`);
  const leave = () => (pending > 0 ? setConfirmLeave(true) : back());

  const save = async () => {
    if (pending === 0 || saving) return;
    setSaving(true);
    const addIds = [...adds.keys()];
    const removeIds = [...removes.keys()];
    try {
      // The server takes up to 500 at a time.
      for (let i = 0; i < addIds.length; i += 500) {
        await assign.mutateAsync({ userId, args: [addIds.slice(i, i + 500)] });
      }
      setAdds(new Map());
      for (let i = 0; i < removeIds.length; i += 500) {
        await unassign.mutateAsync({ userId, args: [removeIds.slice(i, i + 500)] });
      }
      setRemoves(new Map());
      toast.success(
        t('salesReps.products.saved', { name: rep?.name ?? '', defaultValue: 'Products updated for {{name}}' }),
        summaryOf(t, addIds.length, removeIds.length),
      );
      back();
    } catch (e) {
      // Whatever went before the failure is saved and already off the lists
      // above; what is left is what still needs saving.
      toast.error(t('salesReps.products.saveFailed', 'Could not save the changes'), e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (repLoading || meLoading) return <div className="p-4 sm:p-6"><TableSkeleton rows={6} cols={2} /></div>;
  if (!rep) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState
          icon={<UserRound size={22} strokeWidth={1.75} />}
          title={t('salesReps.notFound', 'Not a sales rep')}
          description={t('salesReps.notFoundBody', 'This account does not hold the sales rep role.')}
          action={{ label: t('common.back', 'Back'), onClick: () => goBack('/users?tab=salesreps') }}
        />
      </div>
    );
  }
  const title = t('salesReps.products.pageTitle', { name: rep.name, defaultValue: 'Products for {{name}}' });
  // Any admin may look; changing them is a super admin's, like their shops.
  // Without that, the list stands alone — no catalogue, no Save.
  const readOnly = !canEdit;
  const initials = rep.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className={readOnly ? '' : 'pb-40 lg:pb-0'}>
      <BackLink label={t('common.back', 'Back')} title={title} onClick={leave} className="px-4 sm:px-6 pt-4" />
      <div className="lg:hidden px-4 sm:px-6 pt-2">
        <h1 className="text-base font-bold font-display text-ink truncate">{title}</h1>
      </div>

      <div className="p-4 sm:p-6 xl:flex xl:gap-6 xl:items-start">
        <div className={`space-y-3 max-w-2xl ${readOnly ? '' : 'xl:max-w-none xl:w-[440px] 2xl:w-[500px] xl:shrink-0'}`}>
          {/* ─── Who, and what they sell already ─── */}
          <section className="bg-card rounded-xl border border-border/60 shadow-card p-4 flex items-start gap-3">
            <span className="w-11 h-11 rounded-full bg-brand text-white flex items-center justify-center text-sm font-bold font-display shrink-0">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold font-display text-ink truncate">{rep.name}</p>
              <p className="mt-0.5 flex items-start gap-1.5 text-[12.5px] text-gray leading-snug">
                <Store size={14} strokeWidth={1.75} className="text-brand shrink-0 mt-px" />
                <span className="min-w-0">
                  {shopNames.length > 0
                    ? t('salesReps.products.sellsFrom', { shops: shopNames.join(', '), defaultValue: 'Sells from {{shops}}' })
                    : t('salesReps.products.sellsFromNone', 'No shop — they sell only the products assigned here')}
                </span>
              </p>
              {readOnly && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-muted">
                  <Lock size={13} strokeWidth={1.75} className="shrink-0" />
                  {t('salesReps.products.readOnlyNote', 'Only a super admin can change them.')}
                </p>
              )}
            </div>
          </section>

          {/* ─── What will change ─────────────────── */}
          {pending > 0 && (
            <section className="bg-card rounded-xl border-2 border-brand/40 shadow-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-brand-mist/30">
                <PackagePlus size={17} strokeWidth={1.75} className="text-brand shrink-0" />
                <h2 className="text-sm font-bold font-display text-ink flex-1 min-w-0 truncate">
                  {t('salesReps.products.changesTitle', 'Not saved yet')}
                </h2>
                <button
                  type="button"
                  onClick={() => { setAdds(new Map()); setRemoves(new Map()); }}
                  className="py-2.5 -my-2.5 px-1 -mx-1 text-xs font-semibold font-display text-gray hover:text-danger"
                >
                  {t('salesReps.products.clearChanges', 'Clear')}
                </button>
              </div>
              {adds.size > 0 && (
                <ChangeGroup
                  label={t('salesReps.products.toAdd', { count: adds.size, defaultValue: 'To add ({{count}})' })}
                  tone="add"
                  items={[...adds.values()]}
                  actionLabel={(p) => t('salesReps.products.unpick', { name: p.name_es, defaultValue: 'Leave out {{name}}' })}
                  onAction={(p) => setAdds((m) => without(m, p.id))}
                />
              )}
              {removes.size > 0 && (
                <ChangeGroup
                  label={t('salesReps.products.toRemove', { count: removes.size, defaultValue: 'To remove ({{count}})' })}
                  tone="remove"
                  items={[...removes.values()]}
                  actionLabel={(p) => t('salesReps.products.keepName', { name: p.name_es, defaultValue: 'Keep {{name}}' })}
                  onAction={(p) => setRemoves((m) => without(m, p.id))}
                />
              )}
            </section>
          )}

          {/* ─── What they have ───────────────────── */}
          <section className="bg-card rounded-xl border border-border/60 shadow-card overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5">
              <Package size={17} strokeWidth={1.75} className="text-brand shrink-0" />
              <h2 className="text-sm font-bold font-display text-ink flex-1 min-w-0 truncate">
                {t('salesReps.products.current', 'Assigned now')}
              </h2>
              {!!allCount && (
                <span className="min-w-6 h-6 px-1.5 rounded-full bg-surface-cream text-xs font-bold font-display text-gray inline-flex items-center justify-center tabular-nums">
                  {allCount}
                </span>
              )}
            </div>
            <div className="border-t border-border/60 px-4 py-3">
              {/* By shop: where they come from, and a way to look at one
                  shop's at a time. Hidden once there is only one. */}
              {byShop && (byShop.length > 1 || shop) && (
                <div role="radiogroup" aria-label={t('salesReps.products.byShop', 'By shop')} className="mb-3 flex flex-wrap gap-1.5">
                  {[{ id: '', label: t('salesReps.products.filterAll', 'All'), count: allCount ?? 0 },
                    ...byShop.map((g) => ({ id: g.store?.id ?? HOUSE_STORE_ID, label: g.store?.name ?? t('salesReps.products.cesto', 'Cesto Shop'), count: g.count }))]
                    .map((c) => (
                      <button
                        key={c.id || 'all'}
                        type="button"
                        role="radio"
                        aria-checked={shop === c.id}
                        onClick={() => { pickShop(c.id); setExpanded(false); }}
                        className={`h-9 sm:h-8 max-w-full pl-3 pr-2 rounded-full border text-xs font-semibold font-display inline-flex items-center gap-1.5 transition-colors ${
                          shop === c.id ? 'bg-brand border-brand text-white' : 'bg-card border-border text-gray hover:border-brand hover:text-ink'
                        }`}
                      >
                        <span className="truncate">{c.label}</span>
                        <span className={`min-w-5 h-5 px-1 rounded-full text-[11px] font-bold tabular-nums inline-flex items-center justify-center ${
                          shop === c.id ? 'bg-white/20 text-white' : 'bg-surface-cream text-gray'
                        }`}>{c.count}</span>
                      </button>
                    ))}
                </div>
              )}

              {hidden > 0 && (
                <p className="mb-2 flex items-start gap-1.5 rounded-lg bg-warning-bg px-2.5 py-2 text-[12.5px] font-semibold text-warning">
                  <AlertTriangle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
                  {t('salesReps.products.hiddenHint', { count: hidden, defaultValue: '{{count}} are not shown to them: inactive, or their shop is switched off.' })}
                </p>
              )}

              {listLoading && !current ? (
                <ul className="space-y-3" aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <li key={i} className="flex items-center gap-3">
                      <Skeleton className="w-10 h-10 rounded-lg" />
                      <div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>
                    </li>
                  ))}
                </ul>
              ) : allCount === 0 ? (
                <div className="rounded-xl border-2 border-dashed border-border px-4 py-6 text-center">
                  <span className="mx-auto w-11 h-11 rounded-xl bg-brand-mist/40 text-brand flex items-center justify-center">
                    <PackagePlus size={20} strokeWidth={1.75} />
                  </span>
                  <p className="mt-2.5 text-sm font-bold font-display text-ink">{t('salesReps.products.emptyTitle', 'No products assigned')}</p>
                  <p className="mt-1 text-[12.5px] text-muted leading-snug">
                    {readOnly ? t('salesReps.products.emptyReadOnly', 'Nothing is assigned to them by hand. They sell only their shops\' products.') : (
                      <>
                        <span className="xl:hidden">{t('salesReps.products.emptyPage', 'Open the catalogue and pick products from any shop. They show up in the rep\'s catalogue and when they build or edit an order.')}</span>
                        <span className="hidden xl:inline">{t('salesReps.products.emptyPageWide', 'Pick products from any shop in the catalogue beside this. They show up in the rep\'s catalogue and when they build or edit an order.')}</span>
                      </>
                    )}
                  </p>
                </div>
              ) : (
                <>
                  {(q !== '' || (allCount ?? total) > PREVIEW) && (
                    <div className="relative mb-1">
                      <Search size={15} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                      <input
                        type="search"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        placeholder={t('salesReps.products.search', 'Search their products…')}
                        aria-label={t('salesReps.products.search', 'Search their products…')}
                        className="w-full h-9 bg-surface-cream border border-border rounded-lg pl-9 pr-3 text-[13px] font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/25 focus:border-brand"
                      />
                    </div>
                  )}
                  {items.length === 0 ? (
                    <p className="py-2 text-[13px] text-muted">{t('salesReps.products.noMatch', 'None of their products match.')}</p>
                  ) : (
                    <ul className="divide-y divide-border/70">
                      {shown.map((p) => {
                        const going = removes.has(p.id);
                        return (
                          <li key={p.id} className="flex items-center gap-3 py-2.5">
                            <span className={going ? 'opacity-50 grayscale' : ''}><Thumb url={p.image_url} /></span>
                            <span className="min-w-0 flex-1">
                              <span className={`block text-[13.5px] font-semibold font-display truncate ${
                                going ? 'text-muted line-through' : p.is_active && !p.shop_unavailable ? 'text-ink' : 'text-muted'
                              }`}>{p.name_es}</span>
                              <ProductMeta p={p} />
                              {going
                                ? <span className="mt-1 inline-flex px-1.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-danger-bg text-danger">{t('salesReps.products.removing', 'Will be removed')}</span>
                                : <HiddenTag p={p} />}
                            </span>
                            {readOnly ? null : going ? (
                              <button
                                type="button"
                                onClick={() => toggleTheirs(p)}
                                className="h-9 sm:h-8 px-2.5 rounded-lg text-xs font-semibold font-display text-gray hover:text-ink hover:bg-surface-cream inline-flex items-center gap-1 shrink-0"
                              >
                                <RotateCcw size={13} strokeWidth={2} />
                                {t('salesReps.products.keep', 'Keep it')}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggleTheirs(p)}
                                aria-label={t('salesReps.products.remove', { name: p.name_es, defaultValue: 'Remove {{name}}' })}
                                title={t('salesReps.products.remove', { name: p.name_es, defaultValue: 'Remove {{name}}' })}
                                className="w-9 h-9 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-muted hover:text-danger hover:bg-danger-bg shrink-0 transition-colors"
                              >
                                <X size={15} strokeWidth={2} />
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {!q && items.length > PREVIEW && (
                    <button
                      type="button"
                      onClick={() => setExpanded((v) => !v)}
                      className="-mt-1.5 -mb-2.5 py-2.5 px-1 -mx-1 text-xs font-semibold font-display text-brand hover:underline"
                    >
                      {expanded ? t('salesReps.products.showLess', 'Show fewer') : t('salesReps.products.showAll', { count: total, defaultValue: 'Show all {{count}}' })}
                    </button>
                  )}
                  {total > items.length && (expanded || q) && (
                    <p className="mt-1.5 text-[11.5px] text-muted">
                      {t('salesReps.products.capped', { shown: items.length, total, defaultValue: 'Showing {{shown}} of {{total}}. Search to find the rest.' })}
                    </p>
                  )}
                </>
              )}

              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setCatalogueOpen(true)}
                  className="hidden lg:inline-flex xl:hidden mt-3 w-full min-h-[52px] rounded-xl border-2 border-dashed border-border hover:border-brand text-sm font-semibold font-display text-brand items-center justify-center gap-2"
                >
                  <Plus size={16} strokeWidth={2.5} />
                  {t('salesReps.products.add', 'Add products')}
                </button>
              )}
            </div>
          </section>

          {/* ─── Save ─────────────────────────────── */}
          {!readOnly && <div className="fixed lg:static bottom-0 left-0 right-0 z-30 bg-surface-linen/95 lg:bg-transparent backdrop-blur lg:backdrop-blur-none border-t lg:border-t-0 border-border lg:pt-2">
            <div className="lg:hidden flex items-center gap-2 px-4 pt-3">
              <p className="min-w-0 flex-1 text-[12.5px] font-semibold font-display text-ink truncate">{summaryOf(t, adds.size, removes.size)}</p>
              <button
                type="button"
                onClick={() => setCatalogueOpen(true)}
                className="xl:hidden min-h-[44px] px-3.5 rounded-xl border-2 border-brand text-brand font-semibold font-display text-sm inline-flex items-center gap-1.5 shrink-0"
              >
                <Plus size={16} strokeWidth={2.5} />
                <span className="max-[379px]:hidden">{t('salesReps.products.add', 'Add products')}</span>
              </button>
            </div>
            <p className="hidden lg:block mb-2 text-[12.5px] text-muted">{summaryOf(t, adds.size, removes.size)}</p>
            <div className="flex gap-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:p-0 lg:gap-4 lg:justify-end">
              <button
                type="button"
                onClick={leave}
                className="flex-1 lg:flex-none min-h-[52px] px-5 rounded-xl bg-card border-2 border-border hover:border-brand font-semibold font-display text-sm text-ink"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={pending === 0 || saving}
                className="flex-[2] lg:flex-none min-h-[52px] px-5 rounded-xl bg-brand hover:bg-brand-mid disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold font-display text-sm inline-flex items-center justify-center gap-2"
              >
                {saving ? <Loader2 size={16} strokeWidth={2.5} className="animate-spin" /> : <Check size={16} strokeWidth={2.5} />}
                {t('salesReps.products.save', 'Save changes')}
              </button>
            </div>
          </div>}
        </div>

        {!readOnly && <RepProductCatalogue
          userId={userId}
          open={catalogueOpen}
          onClose={() => setCatalogueOpen(false)}
          stateOf={stateOf}
          onToggle={toggle}
          onPickMany={pickMany}
          shopIds={shopIds}
          pending={pending}
        />}
      </div>

      <ConfirmModal
        open={confirmLeave}
        danger
        title={t('salesReps.products.discardTitle', 'Leave without saving?')}
        message={t('salesReps.products.discardBody', 'The products you picked or took off here will not change.')}
        confirmLabel={t('salesReps.products.discard', 'Leave')}
        cancelLabel={t('salesReps.products.stay', 'Stay')}
        onConfirm={() => { setConfirmLeave(false); setAdds(new Map()); setRemoves(new Map()); back(); }}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}

/** "3 to add · 1 to remove", or that nothing has changed. */
function summaryOf(t: ReturnType<typeof useTranslation>['t'], add: number, remove: number): string {
  if (add === 0 && remove === 0) return t('salesReps.products.noChanges', 'No changes yet');
  return [
    add > 0 ? t('salesReps.products.nToAdd', { count: add, defaultValue: '{{count}} to add' }) : null,
    remove > 0 ? t('salesReps.products.nToRemove', { count: remove, defaultValue: '{{count}} to remove' }) : null,
  ].filter(Boolean).join(' · ');
}

/** One side of the pending changes: what will be added, or taken off. */
function ChangeGroup({ label, tone, items, actionLabel, onAction }: {
  label: string;
  tone: 'add' | 'remove';
  items: AdminRepProduct[];
  actionLabel: (p: AdminRepProduct) => string;
  onAction: (p: AdminRepProduct) => void;
}) {
  return (
    <div className="border-t border-border/60 px-4 pt-2.5 pb-1">
      <p className={`text-[11px] font-bold uppercase tracking-[0.1em] font-display ${tone === 'add' ? 'text-brand' : 'text-danger'}`}>{label}</p>
      <ul className="mt-1 divide-y divide-border/60 max-h-[260px] overflow-y-auto -mx-1 px-1">
        {items.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-2">
            <span className={tone === 'remove' ? 'opacity-50 grayscale' : ''}><Thumb url={p.image_url} /></span>
            <span className="min-w-0 flex-1">
              <span className={`block text-[13px] font-semibold font-display truncate ${tone === 'remove' ? 'text-muted line-through' : 'text-ink'}`}>{p.name_es}</span>
              <ProductMeta p={p} />
            </span>
            <button
              type="button"
              onClick={() => onAction(p)}
              aria-label={actionLabel(p)}
              title={actionLabel(p)}
              className="w-9 h-9 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-surface-cream shrink-0 transition-colors"
            >
              {tone === 'add' ? <X size={15} strokeWidth={2} /> : <RotateCcw size={14} strokeWidth={2} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
