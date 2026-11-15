import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, List, Search, Store, X } from 'lucide-react';
import { HOUSE_STORE_ID, resolveImageUrl, useAdminStores, useUpdateSalesRep, type SalesRepStore } from '@grocery-app/shared';
import CestoLogo from '@/components/CestoLogo';
import Combobox, { type ComboboxOption } from '@/components/form/Combobox';
import { useToast } from '@/components/Toast';

/*
 * The shops a sales rep sells from (2026-10-25: one; 2026-10-26: several, user
 * request — "admin can assign multiple stores to the rep and from those
 * assigned stores the products will show to them"). The rep sees and sells
 * only their active products, and with none cannot build orders. Cesto's own
 * catalogue is a choice too ('cesto'); the API refuses ADDING a shop that is
 * switched off, suspended or being deleted, and lets one assigned before that
 * stay (lib/repStore). Assigning is a super-admin act, like hiring.
 */

/** The shops that can be added: live, switched on, not suspended. */
function usePickableShops() {
  const { data, isLoading } = useAdminStores({ isActive: 'true', deletionState: 'live', limit: 200 });
  const shops = useMemo(
    () => (data?.items ?? [])
      .filter((s) => s.status !== 'suspended')
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({ id: s.id, name: s.name, products: s._count.products, logo_bg: s.logo_bg })),
    [data],
  );
  return { shops, isLoading };
}

/** The menu that adds one more shop to `value`. */
function AddShopPicker({ value, onAdd, disabled }: {
  value: string[];
  onAdd: (id: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { shops, isLoading } = usePickableShops();
  const addable: ComboboxOption[] = [
    ...(value.includes(HOUSE_STORE_ID) ? [] : [{ value: HOUSE_STORE_ID, label: t('salesReps.shop.cesto', 'Cesto Shop (own catalogue)') }]),
    ...shops.filter((s) => !value.includes(s.id)).map((s) => ({ value: s.id, label: s.name })),
  ];
  const noneLeft = !isLoading && addable.length === 0;
  return (
    <Combobox
      value=""
      onChange={(next) => { if (next) onAdd(next); }}
      options={addable}
      disabled={disabled || isLoading || noneLeft}
      placeholder={noneLeft ? t('salesReps.shop.allAdded', 'Every shop is already theirs') : t('salesReps.shop.pick', 'Add a shop')}
      ariaLabel={t('salesReps.shop.pick', 'Add a shop')}
      searchable
      searchPlaceholder={t('salesReps.shop.search', 'Search shops…')}
      menuPortal
      menuMinWidth={260}
    />
  );
}

/**
 * The shops picked, as chips with a remove each, and a menu to add one more.
 * `value` holds ids — 'cesto' for Cesto's own. `known` is what is assigned
 * now, so a shop switched off since still shows by name, flagged, and can be
 * taken off. With `preview`, only that many chips show and a "+N more" chip
 * calls `onSeeAll` (the profile card, 2026-10-29: the rest are in its dialog).
 */
export function RepShopsField({ value, onChange, disabled, known = [], preview, onSeeAll }: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  known?: SalesRepStore[];
  preview?: number;
  onSeeAll?: () => void;
}) {
  const { t } = useTranslation();
  const { shops } = usePickableShops();
  const cesto = t('salesReps.shop.cesto', 'Cesto Shop (own catalogue)');
  const nameOf = (id: string) => (id === HOUSE_STORE_ID
    ? cesto
    : known.find((k) => k.id === id)?.name ?? shops.find((s) => s.id === id)?.name ?? '…');
  const isOff = (id: string) => known.find((k) => k.id === id)?.sellable === false;
  const shown = preview !== undefined && onSeeAll ? value.slice(0, preview) : value;
  const rest = value.length - shown.length;

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {shown.map((id) => (
            <li
              key={id}
              className={`inline-flex items-center gap-1.5 h-8 pl-3 pr-1 max-w-full rounded-full border text-[13px] font-semibold font-display ${
                isOff(id) ? 'border-danger/30 bg-danger-bg text-danger' : 'border-border bg-surface-cream text-ink'
              }`}
            >
              <span className={`truncate ${isOff(id) ? 'line-through' : ''}`}>{nameOf(id)}</span>
              {isOff(id) && (
                <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide">{t('salesReps.shop.unavailableBadge', 'Unavailable')}</span>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(value.filter((v) => v !== id))}
                aria-label={t('salesReps.shop.remove', 'Remove {{shop}}', { shop: nameOf(id) })}
                className="shrink-0 w-9 h-9 -my-1.5 -mr-1.5 sm:my-0 sm:mr-0 sm:w-6 sm:h-6 rounded-full flex items-center justify-center hover:bg-card disabled:opacity-40"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </li>
          ))}
          {rest > 0 && (
            <li>
              <button
                type="button"
                onClick={onSeeAll}
                className="inline-flex items-center h-8 px-3 rounded-full border border-dashed border-brand/40 text-[13px] font-semibold font-display text-brand hover:bg-brand-mist/40"
              >
                {t('salesReps.shop.more', '+{{count}} more', { count: rest })}
              </button>
            </li>
          )}
        </ul>
      )}
      <AddShopPicker value={value} onAdd={(id) => onChange([...value, id])} disabled={disabled} />
    </div>
  );
}

/** For a table cell: the shops, and products assigned by hand — or why the rep cannot sell. */
export function RepShopsBadge({ stores, assigned = 0 }: { stores: SalesRepStore[] | undefined; assigned?: number }) {
  const { t } = useTranslation();
  if (stores === undefined) return <span className="text-muted">—</span>;
  const products = assigned > 0 && (
    <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[11px] font-bold font-display bg-brand-mist/40 text-brand">
      {stores.length === 0
        ? t('salesReps.shop.productsOnly', { count: assigned, defaultValue: '{{count}} products' })
        : t('salesReps.shop.plusProducts', { count: assigned, defaultValue: '+{{count}} products' })}
    </span>
  );
  if (stores.length === 0 && assigned > 0) return products;
  if (stores.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-warning-bg text-warning">
        <AlertTriangle size={11} strokeWidth={2.25} />
        {t('salesReps.shop.none', 'No shop')}
      </span>
    );
  }
  const shown = stores.slice(0, 2);
  const rest = stores.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
      {shown.map((s, i) => (
        <span key={s.id} className={`truncate ${s.sellable ? 'text-ink' : 'text-muted line-through'}`}>
          {s.name}{i < shown.length - 1 || rest > 0 ? ',' : ''}
        </span>
      ))}
      {rest > 0 && <span className="shrink-0 text-muted">{t('salesReps.shop.more', '+{{count}} more', { count: rest })}</span>}
      {stores.some((s) => !s.sellable) && (
        <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-danger-bg text-danger">
          {t('salesReps.shop.unavailableBadge', 'Unavailable')}
        </span>
      )}
      {products}
    </span>
  );
}

/** The rep profile's card: which shops, and — for a super admin — changing them. */
export function RepShopCard({ userId, name, stores, canEdit, assignedProducts = 0 }: {
  userId: string;
  name: string;
  stores: SalesRepStore[] | undefined;
  canEdit: boolean;
  /** Products assigned to them by hand: with some, no shop is not a stop. */
  assignedProducts?: number;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const update = useUpdateSalesRep();
  const [allOpen, setAllOpen] = useState(false);
  const value = (stores ?? []).map((s) => s.id);
  const { shops } = usePickableShops();
  const nameOf = (id: string) => (id === HOUSE_STORE_ID
    ? t('salesReps.shop.cesto', 'Cesto Shop (own catalogue)')
    : stores?.find((s) => s.id === id)?.name ?? shops.find((s) => s.id === id)?.name ?? '');

  const change = (next: string[]) => {
    const added = next.find((id) => !value.includes(id));
    const removed = value.find((id) => !next.includes(id));
    update.mutate({ userId, store_ids: next }, {
      onSuccess: () => toast.success(next.length === 0
        ? t('salesReps.shop.cleared', '{{name}} has no shop now', { name })
        : added
          ? t('salesReps.shop.saved', '{{name}} now also sells from {{shop}}', { name, shop: nameOf(added) })
          : t('salesReps.shop.removed', '{{name}} no longer sells from {{shop}}', { name, shop: removed ? nameOf(removed) : '' })),
      onError: (e) => toast.error(t('salesReps.shop.failed', 'Could not change their shops'), e instanceof Error ? e.message : String(e)),
    });
  };

  const off = (stores ?? []).filter((s) => !s.sellable);
  // Products assigned by hand still sell without a shop (lib/repStore).
  const problem = stores === undefined
    ? null
    : stores.length === 0
      ? assignedProducts > 0
        ? t('salesReps.shop.noneButProducts', 'No shop — they sell only the products assigned to them.')
        : t('salesReps.shop.noneHint', 'They cannot build orders until you assign one.')
      : off.length === stores.length && assignedProducts === 0
        ? t('salesReps.shop.allUnavailableHint', 'None of their shops can be sold from right now. They cannot build orders until you assign another.')
        : off.length > 0
          ? t('salesReps.shop.unavailableHint', '{{shops}}: switched off, suspended or being deleted, so their products are left out.', { shops: off.map((s) => s.name).join(', ') })
          : null;

  return (
    <section className="bg-card rounded-xl border border-border/60 shadow-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold font-display text-ink">
          <Store size={16} strokeWidth={1.75} className="text-brand" />
          {t('salesReps.shop.label', 'Shops')}
        </h2>
        {stores !== undefined && stores.length > 0 && (
          <span className="min-w-6 h-6 px-1.5 rounded-full bg-surface-cream text-xs font-bold font-display text-gray inline-flex items-center justify-center tabular-nums">
            {stores.length}
          </span>
        )}
      </div>
      <p className="text-[12px] text-muted mt-1">
        {t('salesReps.shop.hint', 'They see and sell only these shops\' active products. The order is still Cesto\'s.')}
      </p>
      {problem && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-warning-bg px-2.5 py-2 text-[12.5px] font-semibold text-warning">
          <AlertTriangle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
          {problem}
        </p>
      )}
      <div className="mt-3">
        {canEdit ? (
          <RepShopsField value={value} onChange={change} disabled={update.isPending} known={stores} preview={PREVIEW} onSeeAll={() => setAllOpen(true)} />
        ) : (
          <p className="text-sm font-semibold font-display text-ink">
            <RepShopsBadge stores={stores} />
          </p>
        )}
      </div>
      {/* Every shop, one per row, with what each gives them (user, 2026-10-29). */}
      {stores !== undefined && stores.length > 0 && (
        <button
          type="button"
          onClick={() => setAllOpen(true)}
          className="mt-3 w-full h-11 rounded-xl border-2 border-border hover:border-brand bg-card text-sm font-semibold font-display text-brand inline-flex items-center justify-center gap-2 transition-colors"
        >
          <List size={16} strokeWidth={1.75} />
          {t('salesReps.shop.seeAll', 'See all ({{count}})', { count: stores.length })}
        </button>
      )}
      {allOpen && stores !== undefined && (
        <RepShopsDialog
          name={name}
          stores={stores}
          canEdit={canEdit}
          pending={update.isPending}
          onChange={change}
          onClose={() => setAllOpen(false)}
        />
      )}
    </section>
  );
}

/** Chips the profile card shows before "+N more": Cesto's own and three shops fit two lines. */
const PREVIEW = 4;

const REASONS: Record<NonNullable<SalesRepStore['unavailable']>, [string, string]> = {
  inactive: ['salesReps.shop.reason.inactive', 'Switched off: its products are left out'],
  suspended: ['salesReps.shop.reason.suspended', 'Suspended: its products are left out'],
  deleting: ['salesReps.shop.reason.deleting', 'Being deleted: its products are left out'],
  deleted: ['salesReps.shop.reason.deleted', 'Deleted: its products are left out'],
};

/**
 * Every shop a rep sells from, one per row: its logo, how many active
 * products it gives them (or why it gives none now), and — for a super
 * admin — remove, plus the menu to add one. Each change saves at once, as on
 * the card.
 */
function RepShopsDialog({ name, stores, canEdit, pending, onChange, onClose }: {
  name: string;
  stores: SalesRepStore[];
  canEdit: boolean;
  pending: boolean;
  onChange: (next: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { shops } = usePickableShops();
  const [query, setQuery] = useState('');
  const value = stores.map((s) => s.id);
  const q = query.trim().toLowerCase();
  const cesto = t('salesReps.shop.cesto', 'Cesto Shop (own catalogue)');
  const rows = stores
    .map((s) => ({ ...s, label: s.id === HOUSE_STORE_ID ? cesto : s.name, live: shops.find((x) => x.id === s.id) }))
    .filter((s) => !q || s.label.toLowerCase().includes(q));

  // Escape closes — unless the add menu took it first to close itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('salesReps.shop.allTitle', '{{name}}\'s shops', { name })}
        className="bg-card w-full sm:max-w-lg max-h-[94vh] sm:max-h-[86vh] rounded-t-2xl sm:rounded-2xl shadow-modal flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 py-4 border-b border-border flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-start gap-2 text-lg leading-snug font-bold font-display text-ink">
              <span className="min-w-0 break-words">{t('salesReps.shop.allTitle', '{{name}}\'s shops', { name })}</span>
              <span className="shrink-0 min-w-6 h-6 px-1.5 rounded-full bg-surface-cream text-xs font-bold font-display text-gray inline-flex items-center justify-center tabular-nums">
                {stores.length}
              </span>
            </h3>
            <p className="text-xs text-muted mt-0.5">
              {t('salesReps.shop.hint', 'They see and sell only these shops\' active products. The order is still Cesto\'s.')}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close', 'Close')} className="shrink-0 p-1.5 rounded-lg hover:bg-surface-linen">
            <X size={18} strokeWidth={1.75} className="text-muted" />
          </button>
        </div>

        {(canEdit || stores.length > 6) && (
          <div className="shrink-0 px-5 pt-4 space-y-2">
            {canEdit && <AddShopPicker value={value} onAdd={(id) => onChange([...value, id])} disabled={pending} />}
            {stores.length > 6 && (
              <div className="relative">
                <Search size={15} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('salesReps.shop.searchTheirs', 'Search their shops…')}
                  aria-label={t('salesReps.shop.searchTheirs', 'Search their shops…')}
                  className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-card text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {stores.length === 0 ? (
            <div className="py-8 text-center">
              <span className="mx-auto w-12 h-12 rounded-xl bg-warning-bg text-warning flex items-center justify-center">
                <Store size={22} strokeWidth={1.75} />
              </span>
              <p className="mt-3 text-sm font-bold font-display text-ink">{t('salesReps.shop.none', 'No shop')}</p>
              <p className="mt-1 text-[13px] text-muted">{t('salesReps.shop.noneHint', 'They cannot build orders until you assign one.')}</p>
            </div>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted">{t('salesReps.shop.noMatch', 'None of their shops matches “{{q}}”.', { q: query.trim() })}</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {rows.map((s) => {
                const house = s.id === HOUSE_STORE_ID;
                const reason = s.unavailable ? REASONS[s.unavailable] : null;
                // Sellable, but nothing in it to sell yet.
                const empty = !reason && s.live?.products === 0;
                return (
                  <li key={s.id} className="flex items-center gap-3 py-2.5">
                    <span
                      className="shrink-0 w-10 h-10 rounded-lg border border-border/70 bg-surface-cream flex items-center justify-center overflow-hidden"
                      style={!house && s.logo_url && s.live?.logo_bg ? { backgroundColor: s.live.logo_bg } : undefined}
                    >
                      {house ? (
                        <CestoLogo size={22} />
                      ) : s.logo_url ? (
                        <img src={resolveImageUrl(s.logo_url, 'logo')} alt="" className={`w-full h-full object-contain ${reason ? 'opacity-40 grayscale' : ''}`} />
                      ) : (
                        <Store size={18} strokeWidth={1.75} className="text-muted" />
                      )}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className={`block truncate text-sm font-semibold font-display ${reason ? 'text-muted line-through' : 'text-ink'}`}>{s.label}</span>
                      <span className={`block truncate text-[12px] ${reason ? 'text-danger font-semibold' : empty ? 'text-warning font-semibold' : 'text-muted'}`}>
                        {reason
                          ? t(reason[0], reason[1])
                          : house
                            ? t('salesReps.shop.houseLine', 'Products with no partner shop')
                            : empty
                              ? t('salesReps.shop.noActiveProducts', 'No active products yet')
                              : s.live
                                ? t('salesReps.shop.activeProducts', { count: s.live.products, defaultValue: '{{count}} active products' })
                                : ' '}
                      </span>
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => onChange(value.filter((v) => v !== s.id))}
                        aria-label={t('salesReps.shop.remove', 'Remove {{shop}}', { shop: s.label })}
                        className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-muted hover:text-danger hover:bg-danger-bg disabled:opacity-40"
                      >
                        <X size={16} strokeWidth={1.75} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 px-5 py-3 border-t border-border flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-border text-sm font-semibold font-display text-ink hover:bg-surface-linen"
          >
            {t('common.close', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
}
