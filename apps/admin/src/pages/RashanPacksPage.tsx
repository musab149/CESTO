import { useState, useEffect, useMemo } from 'react';
import {
  Plus, Pencil, Trash2, X, Package, AlertTriangle, ToggleLeft, ToggleRight,
  Search, Check, AlertCircle, ShieldAlert, ShoppingBasket, Users, Minus,
  ExternalLink, Store as StoreIcon, Image as ImageIcon, Tag, Settings2,
} from 'lucide-react';
import { z } from 'zod';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';
import {
  useAdminRashanPacks,
  useCreateRashanPack,
  useUpdateRashanPack,
  useDeleteRashanPack,
  useBlockRashanPack,
  useUnblockRashanPack,
  useAdminProducts,
  resolveImageUrl,
} from '@grocery-app/shared';
import type { RashanPack, RashanPackItem, AdminPackOwner } from '@grocery-app/shared';
import ImageUploadField from '@/components/home-preview/ImageUploadField';

/**
 * RASHAN PACKS (admin)
 *
 * Rebuilt on the partner dashboard's pack screen so the two surfaces behave
 * the same way — same row list, same grouped form, same search-and-step item
 * picker. They edit the same object and there was no reason for one to be a
 * dense two-column grid of inputs and the other a guided form.
 *
 * What stays admin-only: the Cesto/Partner tabs, block/unblock moderation,
 * and the fields a partner does not get (badges, descriptions, an explicit
 * base price, and the is_custom "start from scratch" flag).
 */

interface PackForm {
  slug: string;
  name_es: string; name_en: string;
  tagline_es: string; tagline_en: string;
  description_es: string; description_en: string;
  badge_es: string; badge_en: string;
  cover_url: string | null;
  emoji: string;
  base_price: string;
  estimated_savings_pct: string;
  household_default: string;
  highlights_es: string; highlights_en: string;
  is_custom: boolean;
  is_active: boolean;
  sort_order: string;
  items: RashanPackItem[];
}

const emptyForm: PackForm = {
  slug: '', name_es: '', name_en: '',
  tagline_es: '', tagline_en: '',
  description_es: '', description_en: '',
  badge_es: '', badge_en: '',
  cover_url: null,
  emoji: '🛒',
  base_price: '0', estimated_savings_pct: '8', household_default: '2',
  highlights_es: '', highlights_en: '',
  is_custom: false, is_active: true,
  sort_order: '0',
  items: [],
};

const EMOJI_CHOICES = ['🛒', '🧺', '🍚', '🌾', '🫘', '🧂', '🫒', '🥘', '🍜', '📦'];

function packToForm(p: RashanPack): PackForm {
  return {
    slug: p.slug, name_es: p.name_es, name_en: p.name_en,
    tagline_es: p.tagline_es ?? '', tagline_en: p.tagline_en ?? '',
    description_es: p.description_es ?? '', description_en: p.description_en ?? '',
    badge_es: p.badge_es ?? '', badge_en: p.badge_en ?? '',
    cover_url: p.cover_url ?? null,
    emoji: p.emoji ?? '🛒',
    base_price: String(p.base_price),
    estimated_savings_pct: String(p.estimated_savings_pct),
    household_default: String(p.household_default),
    highlights_es: p.highlights_es.join('\n'),
    highlights_en: p.highlights_en.join('\n'),
    is_custom: p.is_custom, is_active: p.is_active,
    sort_order: String(p.sort_order),
    items: p.items,
  };
}

function packToServerPayload(p: RashanPack) {
  return {
    slug: p.slug, name_es: p.name_es, name_en: p.name_en,
    tagline_es: p.tagline_es, tagline_en: p.tagline_en,
    description_es: p.description_es, description_en: p.description_en,
    badge_es: p.badge_es, badge_en: p.badge_en,
    cover_url: p.cover_url ?? null,
    emoji: p.emoji, base_price: Number(p.base_price),
    estimated_savings_pct: p.estimated_savings_pct,
    household_default: p.household_default,
    highlights_es: p.highlights_es, highlights_en: p.highlights_en,
    items: p.items, is_custom: p.is_custom,
    sort_order: p.sort_order, is_active: p.is_active,
  };
}

/** Grouped section heading, mirroring the partner form. */
function FieldGroup({ title, icon: Icon, children }: {
  title: string; icon: typeof Package; children: React.ReactNode;
}) {
  return (
    <fieldset className="border-t border-border pt-5 first:border-t-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <div className="flex items-center gap-2.5 mb-4">
        <span className="w-8 h-8 rounded-lg bg-brand-mist flex items-center justify-center shrink-0">
          <Icon size={15} strokeWidth={1.75} className="text-brand" />
        </span>
        <h3 className="text-[13px] font-bold font-display text-ink">{title}</h3>
      </div>
      <div className="space-y-4">{children}</div>
    </fieldset>
  );
}

export default function RashanPacksPage() {
  // Cesto's packs and partners' are managed completely differently — ours are
  // editable here, theirs are only moderatable — so they get separate tabs
  // rather than one mixed list where the available actions change per row.
  const [owner, setOwner] = useState<AdminPackOwner>('cesto');
  const { data: packs, isLoading } = useAdminRashanPacks({ owner });
  const blockPack = useBlockRashanPack();
  const unblockPack = useUnblockRashanPack();
  const [blockTarget, setBlockTarget] = useState<{ id: string; name: string } | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [blockError, setBlockError] = useState<string | null>(null);
  const isPartnerTab = owner === 'partner';

  // Only active products — packs should never reference deactivated SKUs.
  const { data: productsPage } = useAdminProducts({ limit: 200, isActive: true });
  const products = useMemo(() => productsPage?.items ?? [], [productsPage]);
  const createPack = useCreateRashanPack();
  const updatePack = useUpdateRashanPack();
  const deletePack = useDeleteRashanPack();

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PackForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'slug' | 'name_es' | 'name_en' | 'base_price' | 'estimated_savings_pct' | 'household_default', string>>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [productQuery, setProductQuery] = useState('');
  const messages = useValidationMessages();

  const packSchema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      slug:                  r.slug(),
      name_es:               r.name({ min: 2, max: 120 }),
      name_en:               r.name({ min: 2, max: 120 }),
      base_price:            z.coerce.number().nonnegative(messages.positive),
      estimated_savings_pct: z.coerce.number().int().min(0).max(100, 'Max 100'),
      household_default:     z.coerce.number().int().min(1, messages.positive),
    });
  }, [messages]);

  useEffect(() => { if (!showModal) { setError(null); setFieldErrors({}); } }, [showModal]);

  useEffect(() => {
    if (!showModal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowModal(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showModal]);

  function openAdd() { setEditingId(null); setForm(emptyForm); setProductQuery(''); setShowModal(true); }
  function openEdit(p: RashanPack) { setEditingId(p.id); setForm(packToForm(p)); setProductQuery(''); setShowModal(true); }

  // Live total from current variant prices, so the effect of adding an item is
  // visible while building rather than after saving.
  const itemsTotal = useMemo(() => form.items.reduce((sum, item) => {
    const product = products.find((p) => p.id === item.product_id);
    const variant = product?.variants?.find((v) => v.id === item.variant_id);
    return sum + Number(variant?.price ?? 0) * item.quantity;
  }, 0), [form.items, products]);

  function addItem(productId: string) {
    const product = products.find((p) => p.id === productId);
    const variant = product?.variants?.find((v) => v.is_default) ?? product?.variants?.[0];
    if (!product || !variant) return;
    if (form.items.some((i) => i.product_id === productId)) return;
    setForm((f) => ({ ...f, items: [...f.items, { product_id: productId, variant_id: variant.id, quantity: 1 }] }));
  }
  function setItemQuantity(productId: string, qty: number) {
    setForm((f) => ({
      ...f,
      items: qty <= 0
        ? f.items.filter((i) => i.product_id !== productId)
        : f.items.map((i) => (i.product_id === productId ? { ...i, quantity: qty } : i)),
    }));
  }
  function setItemVariant(productId: string, variantId: string) {
    setForm((f) => ({
      ...f,
      items: f.items.map((i) => (i.product_id === productId ? { ...i, variant_id: variantId } : i)),
    }));
  }

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    const chosen = new Set(form.items.map((i) => i.product_id));
    return products
      .filter((p) => !chosen.has(p.id))
      .filter((p) => !q
        || (p.name_es ?? '').toLowerCase().includes(q)
        || (p.name_en ?? '').toLowerCase().includes(q)
        || (p.brand ?? '').toLowerCase().includes(q))
      .slice(0, 40);
  }, [products, productQuery, form.items]);

  async function handleSave() {
    setError(null);
    const parsed = packSchema.safeParse(form);
    if (!parsed.success) {
      const next: typeof fieldErrors = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof typeof fieldErrors;
        if (k && !next[k]) next[k] = issue.message;
      }
      setFieldErrors(next);
      return;
    }
    if (form.items.length === 0 && !form.is_custom) {
      setError('Add at least one product, or tick "Custom" if the customer builds this pack from scratch.');
      return;
    }
    setFieldErrors({});
    const payload = {
      slug: form.slug.trim(),
      name_es: form.name_es.trim(),
      name_en: form.name_en.trim(),
      tagline_es: form.tagline_es || null,
      tagline_en: form.tagline_en || null,
      description_es: form.description_es || null,
      description_en: form.description_en || null,
      badge_es: form.badge_es || null,
      badge_en: form.badge_en || null,
      cover_url: form.cover_url,
      emoji: form.emoji || null,
      base_price: parseFloat(form.base_price) || 0,
      estimated_savings_pct: parseInt(form.estimated_savings_pct, 10) || 0,
      household_default: parseInt(form.household_default, 10) || 2,
      highlights_es: form.highlights_es.split('\n').map((s) => s.trim()).filter(Boolean),
      highlights_en: form.highlights_en.split('\n').map((s) => s.trim()).filter(Boolean),
      items: form.items,
      is_custom: form.is_custom,
      sort_order: parseInt(form.sort_order, 10) || 0,
      is_active: form.is_active,
    };
    try {
      if (editingId) await updatePack.mutateAsync({ id: editingId, payload });
      else await createPack.mutateAsync(payload);
      setShowModal(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function toggleActive(p: RashanPack) {
    try {
      await updatePack.mutateAsync({ id: p.id, payload: { ...packToServerPayload(p), is_active: !p.is_active } });
    } catch (err) { console.error(err); }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    setDeleteError(null);
    try {
      await deletePack.mutateAsync(deleteConfirm.id);
      setDeleteConfirm(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const inputClass = 'w-full h-11 px-4 bg-surface-cream border border-border rounded-lg text-sm font-display text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition';
  const labelClass = 'block text-sm font-semibold font-display text-ink mb-1.5';
  const saving = createPack.isPending || updatePack.isPending;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 bg-surface-cream rounded animate-pulse" />
        {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-surface-cream rounded-xl animate-pulse" />)}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink inline-flex items-center gap-2">
            <ShoppingBasket size={22} strokeWidth={1.75} />
            Rashan packs
            <span className="text-base font-normal text-muted ml-1">({(packs ?? []).length})</span>
          </h1>
          <p className="text-sm text-muted mt-1 max-w-2xl">
            {isPartnerTab
              ? 'Packs built by partner stores. They publish instantly — block one to take it down.'
              : "Cesto's own subscription packs. These appear on the Rashan page alongside partners'."}
          </p>
        </div>
        {/* No "New pack" on the partner tab: creating a pack on a partner's
            behalf would put it in their storefront and their delivery queue
            without them ever agreeing to fulfil it. The API refuses too. */}
        {!isPartnerTab && (
          <button onClick={openAdd} className="h-[52px] px-5 bg-brand text-white rounded-xl text-sm font-semibold font-display hover:bg-brand-mid flex items-center gap-2 shrink-0">
            <Plus className="w-4 h-4" strokeWidth={1.75} /> New pack
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 mb-5 border-b border-border">
        {([
          { key: 'cesto',   label: 'Cesto packs' },
          { key: 'partner', label: 'Partner packs' },
        ] as { key: AdminPackOwner; label: string }[]).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setOwner(t.key)}
            className={`relative -mb-px px-4 h-10 text-sm font-semibold font-display transition ${
              owner === t.key
                ? 'text-brand border-b-2 border-brand'
                : 'text-muted hover:text-ink border-b-2 border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {(packs ?? []).length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <Package size={32} strokeWidth={1.5} className="text-muted mx-auto mb-3" />
          <p className="font-display font-semibold text-ink">
            {isPartnerTab ? 'No partner packs yet' : 'No Cesto packs yet'}
          </p>
          <p className="text-sm text-muted mt-1 max-w-md mx-auto">
            {isPartnerTab
              ? 'Partner stores build these from their own dashboard. They appear here as soon as one does.'
              : 'Create a pack template for customers to subscribe to.'}
          </p>
        </div>
      ) : (
        /* Row list, matching the partner dashboard. The old two-column grid of
           boxes made every pack look like a card on the storefront, which is
           not what this screen is for. */
        <div className="space-y-3">
          {(packs ?? []).map((pack) => {
            const p = pack as RashanPack & { _count?: { subscriptions: number } };
            const blocked = !!p.admin_blocked_at;
            const subs = p._count?.subscriptions ?? 0;
            return (
              <div
                key={p.id}
                className={`bg-card border rounded-xl p-4 flex flex-wrap items-center gap-4 ${
                  blocked ? 'border-danger/40' : 'border-border'
                }`}
              >
                <div className="w-14 h-14 rounded-xl bg-brand-mist overflow-hidden flex items-center justify-center text-[28px] shrink-0">
                  {p.cover_url
                    ? <img src={resolveImageUrl(p.cover_url, 'tile')} alt="" className="w-full h-full object-cover" />
                    : (p.emoji ?? '🛒')}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-display font-bold text-ink">{p.name_en}</span>
                    <span className="text-muted text-xs font-normal">/ {p.name_es}</span>
                    {blocked ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-danger-bg text-danger text-[11px] font-bold font-display">
                        <ShieldAlert size={11} strokeWidth={2.25} /> Blocked
                      </span>
                    ) : p.is_active ? (
                      <span className="px-2 py-0.5 rounded-full bg-success-bg text-success text-[11px] font-bold font-display">Live</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-surface-sand text-muted text-[11px] font-bold font-display">Off</span>
                    )}
                    {p.is_custom && (
                      <span className="px-2 py-0.5 rounded-full bg-brand-mist text-brand text-[11px] font-bold font-display">Custom</span>
                    )}
                  </div>
                  <p className="text-xs text-muted font-mono mt-0.5 truncate">/rashan/pack/{p.slug}</p>
                  {p.store && (
                    <p className="text-xs text-cool-deep font-display font-semibold mt-0.5 truncate inline-flex items-center gap-1">
                      <StoreIcon size={11} strokeWidth={2} />
                      {p.store.name}
                      {p.store.status !== 'live' && (
                        <span className="text-muted font-normal">· store {p.store.status}</span>
                      )}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-[12px] font-body text-charcoal flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <Package size={12} strokeWidth={1.75} className="text-muted" />
                      {p.items.length} items
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users size={12} strokeWidth={1.75} className="text-muted" />
                      {subs} subscriber{subs === 1 ? '' : 's'}
                    </span>
                    <span>€{Number(p.base_price).toFixed(2)} base</span>
                    {p.estimated_savings_pct > 0 && (
                      <span className="text-brand-ink font-semibold">−{p.estimated_savings_pct}%</span>
                    )}
                  </div>
                  {blocked && p.admin_block_reason && (
                    <p className="text-[12px] text-danger font-body mt-2 bg-danger-bg rounded-lg px-3 py-2">
                      <strong>Blocked:</strong> {p.admin_block_reason}
                    </p>
                  )}
                </div>

                {/* A row of their own on a phone (2026-11-05): beside the
                    name they left it about 70px, and the slug ran off the card. */}
                <div className="flex items-center justify-end gap-1.5 shrink-0 w-full sm:w-auto">
                  {p.is_active && !blocked && (
                    <a
                      href={`/rashan/pack/${p.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="View as a customer"
                      className="w-9 h-9 rounded-lg hover:bg-surface-cream text-muted hover:text-ink flex items-center justify-center transition-colors"
                    >
                      <ExternalLink size={15} strokeWidth={1.75} />
                    </a>
                  )}
                  {p.store_id ? (
                    // Moderation only. Editing or deleting a partner's own work
                    // from here is data loss, not moderation — the API refuses
                    // both, and blocking hides it just as effectively.
                    blocked ? (
                      <button
                        onClick={() => unblockPack.mutate(p.id)}
                        disabled={unblockPack.isPending}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border-2 border-success text-success text-xs font-bold hover:bg-success-bg disabled:opacity-50"
                      >
                        <Check size={13} strokeWidth={2.5} /> Restore
                      </button>
                    ) : (
                      <button
                        onClick={() => { setBlockTarget({ id: p.id, name: p.name_en }); setBlockReason(''); setBlockError(null); }}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border-2 border-danger text-danger text-xs font-bold hover:bg-danger-bg"
                      >
                        <AlertTriangle size={13} strokeWidth={2} /> Block
                      </button>
                    )
                  ) : (
                    <>
                      <button
                        onClick={() => toggleActive(p)}
                        title={p.is_active ? 'Turn off' : 'Turn on'}
                        className="w-9 h-9 rounded-lg hover:bg-surface-cream flex items-center justify-center transition-colors"
                      >
                        {p.is_active
                          ? <ToggleRight size={20} strokeWidth={1.75} className="text-success" />
                          : <ToggleLeft size={20} strokeWidth={1.75} className="text-muted" />}
                      </button>
                      <button
                        onClick={() => openEdit(p)}
                        title="Edit"
                        className="w-9 h-9 rounded-lg hover:bg-surface-cream text-muted hover:text-ink flex items-center justify-center transition-colors"
                      >
                        <Pencil size={15} strokeWidth={1.75} />
                      </button>
                      <button
                        onClick={() => { setDeleteConfirm({ id: p.id, name: p.name_en }); setDeleteError(null); }}
                        title="Delete"
                        className="w-9 h-9 rounded-lg hover:bg-danger-bg text-muted hover:text-danger flex items-center justify-center transition-colors"
                      >
                        <Trash2 size={15} strokeWidth={1.75} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Create / edit modal ─────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-8 px-4">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setShowModal(false)}
            className="fixed inset-0 bg-veil/40 backdrop-blur-sm"
          />
          <div className="relative w-full max-w-3xl bg-card rounded-2xl shadow-modal">
            <div className="flex items-center justify-between px-4 sm:px-6 py-5 border-b border-border">
              <h3 className="text-lg font-bold font-display text-ink">{editingId ? 'Edit pack' : 'New rashan pack'}</h3>
              <button
                onClick={() => setShowModal(false)}
                aria-label="Close"
                className="w-9 h-9 rounded-full border border-border text-ink hover:border-brand hover:text-brand flex items-center justify-center transition-colors"
              >
                <X size={16} strokeWidth={2.25} />
              </button>
            </div>

            {/* 16px sides on a phone (2026-11-05), 24 from sm. */}
            <div className="px-4 sm:px-6 py-5 space-y-5 max-h-[65vh] overflow-y-auto">
              <FieldGroup title="Names and copy" icon={Tag}>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Name (EN)</label>
                    <input type="text" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} aria-invalid={!!fieldErrors.name_en} className={`${inputClass} ${fieldErrors.name_en ? 'border-danger focus:ring-danger/20' : ''}`} />
                    {fieldErrors.name_en && <p role="alert" className="mt-1 text-[12px] text-danger font-display font-medium"><AlertCircle size={11} strokeWidth={2} className="inline mr-1" />{fieldErrors.name_en}</p>}
                  </div>
                  <div>
                    <label className={labelClass}>Name (ES)</label>
                    <input type="text" value={form.name_es} onChange={(e) => setForm({ ...form, name_es: e.target.value })} aria-invalid={!!fieldErrors.name_es} className={`${inputClass} ${fieldErrors.name_es ? 'border-danger focus:ring-danger/20' : ''}`} />
                    {fieldErrors.name_es && <p role="alert" className="mt-1 text-[12px] text-danger font-display font-medium"><AlertCircle size={11} strokeWidth={2} className="inline mr-1" />{fieldErrors.name_es}</p>}
                  </div>
                  <div>
                    <label className={labelClass}>Short line (EN)</label>
                    <input type="text" value={form.tagline_en} onChange={(e) => setForm({ ...form, tagline_en: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Short line (ES)</label>
                    <input type="text" value={form.tagline_es} onChange={(e) => setForm({ ...form, tagline_es: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Badge (EN)</label>
                    <input type="text" value={form.badge_en} onChange={(e) => setForm({ ...form, badge_en: e.target.value })} className={inputClass} placeholder="BEST VALUE" />
                  </div>
                  <div>
                    <label className={labelClass}>Badge (ES)</label>
                    <input type="text" value={form.badge_es} onChange={(e) => setForm({ ...form, badge_es: e.target.value })} className={inputClass} placeholder="MEJOR PRECIO" />
                  </div>
                  <div>
                    <label className={labelClass}>Description (EN)</label>
                    <textarea rows={3} value={form.description_en} onChange={(e) => setForm({ ...form, description_en: e.target.value })} className="w-full px-4 py-2.5 bg-surface-cream border border-border rounded-lg text-sm font-body text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 resize-y" />
                  </div>
                  <div>
                    <label className={labelClass}>Description (ES)</label>
                    <textarea rows={3} value={form.description_es} onChange={(e) => setForm({ ...form, description_es: e.target.value })} className="w-full px-4 py-2.5 bg-surface-cream border border-border rounded-lg text-sm font-body text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 resize-y" />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Slug (URL key)</label>
                  <input type="text" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })} aria-invalid={!!fieldErrors.slug} className={`${inputClass} font-mono ${fieldErrors.slug ? 'border-danger focus:ring-danger/20' : ''}`} disabled={!!editingId} />
                  {fieldErrors.slug
                    ? <p role="alert" className="mt-1 text-[12px] text-danger font-display font-medium"><AlertCircle size={11} strokeWidth={2} className="inline mr-1" />{fieldErrors.slug}</p>
                    : <p className="text-xs text-muted font-body mt-1.5">{editingId ? 'Fixed after creation — customers may have bookmarked it.' : 'Becomes /rashan/pack/your-slug.'}</p>}
                </div>
              </FieldGroup>

              <FieldGroup title="Look" icon={ImageIcon}>
                <ImageUploadField
                  label="Cover photo"
                  value={form.cover_url}
                  onChange={(next) => setForm({ ...form, cover_url: next })}
                  helperText="Shown on the pack card across the Rashan page. Landscape works best — around 800×450."
                />
                {/* Only offered while there is no cover. Once a photo is set the
                    icon is never rendered, and a picker that changes nothing
                    reads as broken. */}
                {!form.cover_url && (
                  <div>
                    <label className={labelClass}>
                      Icon
                      <span className="ml-2 text-xs font-normal text-muted">used until you add a cover photo</span>
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {EMOJI_CHOICES.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => setForm({ ...form, emoji: e })}
                          className={`w-11 h-11 rounded-lg border-2 text-xl transition-all ${
                            form.emoji === e ? 'border-brand bg-brand-mist' : 'border-border bg-surface-cream hover:border-brand'
                          }`}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </FieldGroup>

              <FieldGroup title="What's in the pack" icon={Package}>
                <div>
                  <span className={labelClass}>
                    Items
                    <span className="ml-2 text-xs font-normal text-muted">
                      {form.items.length} item{form.items.length === 1 ? '' : 's'} · €{itemsTotal.toFixed(2)} per delivery
                    </span>
                  </span>

                  {form.items.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {form.items.map((item) => {
                        const product = products.find((p) => p.id === item.product_id);
                        const variants = product?.variants ?? [];
                        return (
                          // ON A PHONE (2026-11-05): the name on its own line,
                          // size + 36px stepper + remove under it. In one row
                          // the controls needed ~300px and left the name none.
                          <div key={item.product_id} className="flex flex-wrap sm:flex-nowrap items-center gap-2 bg-surface-cream border border-border rounded-lg px-3 py-2">
                            <span className="grow basis-full sm:basis-0 min-w-0 text-sm text-ink truncate">
                              {product?.name_en ?? product?.name_es ?? 'Unknown product'}
                            </span>
                            {variants.length > 1 && (
                              <select
                                value={item.variant_id}
                                onChange={(e) => setItemVariant(item.product_id, e.target.value)}
                                className="flex-1 min-w-0 sm:flex-initial sm:min-w-auto h-9 px-2 bg-card border border-border rounded-lg text-xs text-ink cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/30 max-w-[150px]"
                              >
                                {variants.map((v) => (
                                  <option key={v.id} value={v.id}>{v.name_en} — €{Number(v.price).toFixed(2)}</option>
                                ))}
                              </select>
                            )}
                            <div className="flex items-center gap-1 shrink-0 ml-auto sm:ml-0">
                              <button type="button" onClick={() => setItemQuantity(item.product_id, item.quantity - 1)} className="w-9 h-9 sm:w-7 sm:h-7 rounded-md bg-card border border-border flex items-center justify-center hover:border-brand transition-colors">
                                <Minus size={12} strokeWidth={2.5} />
                              </button>
                              <span className="w-7 text-center text-sm font-bold tabular-nums">{item.quantity}</span>
                              <button type="button" onClick={() => setItemQuantity(item.product_id, item.quantity + 1)} className="w-9 h-9 sm:w-7 sm:h-7 rounded-md bg-card border border-border flex items-center justify-center hover:border-brand transition-colors">
                                <Plus size={12} strokeWidth={2.5} />
                              </button>
                            </div>
                            <button type="button" onClick={() => setItemQuantity(item.product_id, 0)} aria-label="Remove" className="w-9 h-9 sm:w-7 sm:h-7 rounded-md hover:bg-danger-bg text-muted hover:text-danger flex items-center justify-center transition-colors shrink-0">
                              <X size={14} strokeWidth={2.25} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="border border-border rounded-lg overflow-hidden">
                    <div className="relative border-b border-border">
                      <Search size={15} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                      <input
                        value={productQuery}
                        onChange={(e) => setProductQuery(e.target.value)}
                        placeholder="Search products to add"
                        className="w-full h-11 pl-9 pr-3 bg-card text-sm text-ink placeholder:text-muted focus:outline-none"
                      />
                    </div>
                    <div className="max-h-48 overflow-y-auto bg-surface-cream">
                      {filteredProducts.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-muted font-body text-center">
                          {products.length === 0 ? 'No active products to add.' : 'Nothing matches that search.'}
                        </p>
                      ) : filteredProducts.map((p) => {
                        const v = p.variants?.find((x) => x.is_default) ?? p.variants?.[0];
                        const image = p.images?.[0];
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => addItem(p.id)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-brand-mist/40 transition-colors border-b border-border/50 last:border-b-0"
                          >
                            <span className="w-8 h-8 rounded-md bg-card border border-border/40 overflow-hidden flex items-center justify-center shrink-0">
                              {image ? <img src={resolveImageUrl(image.url, 'thumb')} alt="" className="w-full h-full object-cover" /> : <Package size={14} className="text-muted" />}
                            </span>
                            <span className="flex-1 min-w-0 text-sm text-ink truncate">{p.name_en ?? p.name_es}</span>
                            {v && <span className="text-xs text-muted tabular-nums shrink-0">€{Number(v.price).toFixed(2)}</span>}
                            <Plus size={13} strokeWidth={2.5} className="text-brand shrink-0" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Selling points (EN, one per line)</label>
                    <textarea rows={3} value={form.highlights_en} onChange={(e) => setForm({ ...form, highlights_en: e.target.value })} className="w-full px-4 py-2.5 bg-surface-cream border border-border rounded-lg text-sm font-body text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 resize-y" />
                  </div>
                  <div>
                    <label className={labelClass}>Selling points (ES, one per line)</label>
                    <textarea rows={3} value={form.highlights_es} onChange={(e) => setForm({ ...form, highlights_es: e.target.value })} className="w-full px-4 py-2.5 bg-surface-cream border border-border rounded-lg text-sm font-body text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 resize-y" />
                  </div>
                </div>
              </FieldGroup>

              <FieldGroup title="Pricing and placement" icon={Settings2}>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <label className={labelClass}>Base price (€)</label>
                    <input type="number" min="0" step="0.01" value={form.base_price} onChange={(e) => setForm({ ...form, base_price: e.target.value })} aria-invalid={!!fieldErrors.base_price} className={`${inputClass} ${fieldErrors.base_price ? 'border-danger focus:ring-danger/20' : ''}`} />
                    {fieldErrors.base_price && <p role="alert" className="mt-1 text-[12px] text-danger font-display font-medium">{fieldErrors.base_price}</p>}
                  </div>
                  <div>
                    <label className={labelClass}>Savings %</label>
                    <input type="number" min="0" max="100" value={form.estimated_savings_pct} onChange={(e) => setForm({ ...form, estimated_savings_pct: e.target.value })} aria-invalid={!!fieldErrors.estimated_savings_pct} className={`${inputClass} ${fieldErrors.estimated_savings_pct ? 'border-danger focus:ring-danger/20' : ''}`} />
                    {fieldErrors.estimated_savings_pct && <p role="alert" className="mt-1 text-[12px] text-danger font-display font-medium">{fieldErrors.estimated_savings_pct}</p>}
                  </div>
                  <div>
                    <label className={labelClass}>Household size</label>
                    <input type="number" min="1" value={form.household_default} onChange={(e) => setForm({ ...form, household_default: e.target.value })} aria-invalid={!!fieldErrors.household_default} className={`${inputClass} ${fieldErrors.household_default ? 'border-danger focus:ring-danger/20' : ''}`} />
                    {fieldErrors.household_default && <p role="alert" className="mt-1 text-[12px] text-danger font-display font-medium">{fieldErrors.household_default}</p>}
                  </div>
                  <div>
                    <label className={labelClass}>Sort order</label>
                    <input type="number" min="0" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} className={inputClass} />
                  </div>
                </div>

                {/* Switches: shrink-0 so the long "Custom" label cannot
                    squeeze them; below sm an invisible ::before makes each
                    a 36px tap without changing the look (2026-11-05). */}
                <div className="flex flex-wrap items-center gap-6 pt-1">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <button type="button" onClick={() => setForm({ ...form, is_active: !form.is_active })} aria-pressed={form.is_active} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors before:absolute before:-inset-x-1 before:-inset-y-1.5 sm:before:hidden ${form.is_active ? 'bg-brand' : 'bg-border'}`}>
                      <span className={`inline-block h-4 w-4 rounded-full bg-card transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                    <span className="text-sm font-display text-ink">Live</span>
                  </label>
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <button type="button" onClick={() => setForm({ ...form, is_custom: !form.is_custom })} aria-pressed={form.is_custom} className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors before:absolute before:-inset-x-1 before:-inset-y-1.5 sm:before:hidden ${form.is_custom ? 'bg-brand' : 'bg-border'}`}>
                      <span className={`inline-block h-4 w-4 rounded-full bg-card transition-transform ${form.is_custom ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                    <span className="text-sm font-display text-ink">Custom — the customer starts from an empty basket</span>
                  </label>
                </div>
              </FieldGroup>

              {error && (
                <p role="alert" className="flex items-start gap-2 text-sm text-danger font-body bg-danger-bg rounded-lg px-4 py-3">
                  <AlertTriangle size={15} strokeWidth={2} className="shrink-0 mt-0.5" />
                  {error}
                </p>
              )}
            </div>

            <div className="flex gap-3 justify-end px-4 sm:px-6 py-4 border-t border-border bg-surface-cream rounded-b-2xl">
              <button onClick={() => setShowModal(false)} className="h-11 px-5 rounded-xl text-sm font-semibold font-display border border-border bg-card text-ink hover:border-brand hover:text-brand transition-colors">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid disabled:opacity-50 inline-flex items-center gap-2">
                <Check size={15} strokeWidth={2.5} />
                {saving ? 'Saving…' : (editingId ? 'Save changes' : 'Create pack')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block a partner pack — a reason is required, because the partner sees
          it on their own dashboard and "blocked" with no explanation just
          generates a support ticket. */}
      {blockTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setBlockTarget(null)}>
          <div className="bg-card rounded-2xl p-6 shadow-modal w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-danger-bg flex items-center justify-center mb-4">
              <AlertTriangle size={20} strokeWidth={1.75} className="text-danger" />
            </div>
            <h3 className="text-lg font-bold font-display text-ink">Block "{blockTarget.name}"?</h3>
            <p className="text-sm text-muted mt-2">
              It disappears from the Rashan page and the store's own storefront immediately, and the partner
              can't edit it until you restore it. Existing subscriptions keep running.
            </p>
            <label className={`${labelClass} mt-4`}>Reason (the partner sees this)</label>
            <textarea
              rows={3}
              value={blockReason}
              maxLength={500}
              onChange={(e) => setBlockReason(e.target.value)}
              placeholder="e.g. The savings percentage isn't supported by the item prices."
              className="w-full px-4 py-2.5 bg-surface-cream border border-border rounded-lg text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 resize-y"
            />
            {blockError && <p role="alert" className="mt-3 bg-danger-bg text-danger rounded-lg px-4 py-2.5 text-sm font-medium">{blockError}</p>}
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setBlockTarget(null)} className="h-11 px-5 rounded-xl border border-border bg-card text-ink text-sm font-semibold font-display hover:border-brand hover:text-brand">Cancel</button>
              <button
                onClick={async () => {
                  if (!blockReason.trim()) { setBlockError('Give a reason — the partner sees it.'); return; }
                  try {
                    await blockPack.mutateAsync({ id: blockTarget.id, reason: blockReason.trim() });
                    setBlockTarget(null);
                  } catch (err) {
                    setBlockError(err instanceof Error ? err.message : 'Could not block the pack.');
                  }
                }}
                disabled={blockPack.isPending}
                className="h-11 px-5 rounded-xl bg-danger text-white text-sm font-semibold font-display hover:opacity-90 disabled:opacity-60"
              >
                {blockPack.isPending ? 'Blocking…' : 'Block pack'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-card rounded-2xl p-6 shadow-modal w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="w-12 h-12 rounded-full bg-danger-bg flex items-center justify-center mb-4">
              <Trash2 size={20} strokeWidth={1.75} className="text-danger" />
            </div>
            <h3 className="text-lg font-bold font-display text-ink">Delete "{deleteConfirm.name}"?</h3>
            <p className="text-sm text-muted mt-2">
              Only possible while no subscriptions reference this pack. Existing subscriptions keep their own
              item snapshot, so turning it off is usually the safer move.
            </p>
            {deleteError && <p role="alert" className="mt-4 bg-danger-bg text-danger rounded-lg px-4 py-3 text-sm font-medium">{deleteError}</p>}
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => setDeleteConfirm(null)} className="h-11 px-5 rounded-xl text-sm font-semibold font-display border border-border bg-card text-ink hover:border-brand hover:text-brand">Keep it</button>
              <button onClick={handleDelete} disabled={deletePack.isPending} className="h-11 px-5 rounded-xl text-sm font-semibold font-display bg-danger text-white hover:opacity-90 disabled:opacity-50">
                {deletePack.isPending ? 'Deleting…' : 'Delete pack'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
