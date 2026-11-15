import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Eye, Globe, Maximize2, Minimize2, RotateCcw, Save,
  LayoutGrid, Megaphone, X, Tag as TagIcon,
  MapPin, Store as StoreIcon,
} from 'lucide-react';
import {
  useAdminPromoGrid,
  useUpdatePromoGrid,
  useResetPromoGrid,
  useAdminAdsBanner,
  useUpdateAdsBanner,
  useResetAdsBanner,
  useAdminStoresHero,
  useUpdateStoresHero,
  useResetStoresHero,
  defaultPromoGrid,
  defaultAdsBanner,
  defaultStoresHero,
  type PromoGridConfig,
  type PromoTile,
  type AdsBannerConfig,
  type AdsBannerSection,
  type StoresHeroConfig,
  resolveImageUrl,
} from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import PromoGridPreview from '@/components/home-preview/PromoGridPreview';
import AdsBannerPreview from '@/components/home-preview/AdsBannerPreview';
import ImageUploadField from '@/components/home-preview/ImageUploadField';

// ─── Tab shell ───────────────────────────────────────────────────────────

type Tab = 'promo-grid' | 'ads-banner' | 'top-brands' | 'shop-by-origin' | 'stores-hero';
type Lang = 'en' | 'es';

const VALID_TABS: readonly Tab[] = ['promo-grid', 'ads-banner', 'top-brands', 'shop-by-origin', 'stores-hero'];

function isTab(v: string | null): v is Tab {
  return v !== null && (VALID_TABS as readonly string[]).includes(v);
}

export default function HomeSectionsPage() {
  // Support `?tab=top-brands` (etc.) so deep-links from elsewhere in the admin
  // — e.g. the "+ Add new brand" flow on the product form — land straight on
  // the right editor. Tab swaps `replace:true` the URL so refreshes stay put
  // without piling extra history entries every click.
  const [searchParams, setSearchParams] = useSearchParams();
  const paramTab = searchParams.get('tab');
  const [tab, _setTab] = useState<Tab>(isTab(paramTab) ? paramTab : 'promo-grid');
  const setTab = (next: Tab) => {
    _setTab(next);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', next);
    setSearchParams(nextParams, { replace: true });
  };
  // If someone navigates back/forward the URL is the source of truth again.
  useEffect(() => {
    if (isTab(paramTab) && paramTab !== tab) _setTab(paramTab);
  }, [paramTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [lang, setLang] = useState<Lang>('en');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">Home Sections</h1>
          <p className="text-sm text-gray font-display mt-1 max-w-xl">
            Edit the marketing blocks on the customer home page. The preview on the right
            mirrors what shoppers will see.
          </p>
        </div>

        {/* Preview language toggle */}
        <div className="inline-flex rounded-lg border border-border overflow-hidden shrink-0">
          {(['en', 'es'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              className={`h-9 sm:h-auto px-3 py-2 text-xs font-semibold font-display flex items-center gap-1.5 ${
                lang === l ? 'bg-ink text-card' : 'bg-card text-gray hover:bg-surface-linen'
              }`}
            >
              <Globe size={12} strokeWidth={2.25} /> {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Section tabs — one sideways-scrolling line on a phone (.tab-strip,
          2026-11-05): the five tabs need ~700px and pushed the page wide. */}
      <div className="tab-strip border-b border-border flex flex-wrap items-center gap-1">
        <TabButton
          active={tab === 'promo-grid'}
          onClick={() => setTab('promo-grid')}
          icon={<LayoutGrid size={14} strokeWidth={2} />}
          label="Promo Grid"
        />
        <TabButton
          active={tab === 'ads-banner'}
          onClick={() => setTab('ads-banner')}
          icon={<Megaphone size={14} strokeWidth={2} />}
          label="Ads Banner"
        />
        <TabButton
          active={tab === 'top-brands'}
          onClick={() => setTab('top-brands')}
          icon={<TagIcon size={14} strokeWidth={2} />}
          label="Top Brands"
        />
        <TabButton
          active={tab === 'shop-by-origin'}
          onClick={() => setTab('shop-by-origin')}
          icon={<MapPin size={14} strokeWidth={2} />}
          label="Shop by Origin"
        />
        <TabButton
          active={tab === 'stores-hero'}
          onClick={() => setTab('stores-hero')}
          icon={<StoreIcon size={14} strokeWidth={2} />}
          label="Stores Hero"
        />
      </div>

      {tab === 'promo-grid' && <PromoGridEditor lang={lang} onLangChange={setLang} />}
      {tab === 'ads-banner' && <AdsBannerEditor lang={lang} onLangChange={setLang} />}
      {/* Top Brands + Shop by Origin were promoted to first-class tables on
          2026-07-13 and moved to dedicated pages (/brands and /origins). The
          tabs here now show a redirect card so existing bookmarks don't 404. */}
      {tab === 'top-brands' && <MovedNotice to="/brands" title="Top Brands moved" body="Brands are now first-class rows with their own admin page." />}
      {tab === 'shop-by-origin' && <MovedNotice to="/origins" title="Shop by Origin moved" body="Origins are now first-class rows with their own admin page." />}
      {tab === 'stores-hero' && <StoresHeroEditor lang={lang} onLangChange={setLang} />}
    </div>
  );
}

// Placeholder shown on the deprecated Top Brands / Shop by Origin tabs.
// Points admins at the new dedicated pages so a bookmarked URL still lands
// somewhere useful instead of on an empty screen.
function MovedNotice({ to, title, body }: { to: string; title: string; body: string }) {
  const navigate = useNavigate();
  return (
    <div className="bg-card rounded-xl border border-border p-8 text-center">
      <h3 className="text-lg font-bold font-display text-ink mb-1">{title}</h3>
      <p className="text-sm text-muted mb-4">{body}</p>
      <button
        type="button"
        onClick={() => navigate(to)}
        className="inline-flex items-center gap-2 bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm px-5 rounded-xl h-11 transition"
      >
        Open the new page
      </button>
    </div>
  );
}

function TabButton({
  active, onClick, icon, label,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold font-display border-b-2 -mb-px transition-colors ${
        active
          ? 'border-brand text-brand'
          : 'border-transparent text-gray hover:text-ink'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── PromoGrid editor ────────────────────────────────────────────────────

function PromoGridEditor({ lang, onLangChange }: { lang: Lang; onLangChange: (l: Lang) => void }) {
  const { data, error: queryError } = useAdminPromoGrid();
  const update = useUpdatePromoGrid();
  const reset = useResetPromoGrid();
  const toast = useToast();
  // Always start with defaults so the editor + preview render immediately —
  // even if the API is down or the migration hasn't been applied yet.
  const [draft, setDraft] = useState<PromoGridConfig>(defaultPromoGrid);
  const [seeded, setSeeded] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [activeTileId, setActiveTileId] = useState<string>('tile-rashan');
  const [preview, setPreview] = useState<PreviewState>('closed');

  // First successful API response replaces the defaults baseline.
  useEffect(() => {
    if (data && !seeded) {
      setDraft(data);
      setSeeded(true);
    }
  }, [data, seeded]);

  const baseline = data ?? defaultPromoGrid;
  const dirty = useMemo(
    () => JSON.stringify(draft.tiles) !== JSON.stringify(baseline.tiles),
    [draft, baseline],
  );

  const activeTile = draft.tiles.find((t) => t.id === activeTileId) ?? draft.tiles[0];

  function patchTile(id: string, patch: Partial<PromoTile>) {
    setDraft((prev) => ({
      ...prev,
      tiles: prev.tiles.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }

  async function handleSave() {
    try {
      await update.mutateAsync(draft);
      toast.success('Promo grid saved', 'Customer home page is now updated.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Please try again.';
      console.error(err);
      toast.error('Could not save', msg);
    }
  }

  async function handleReset() {
    setConfirmReset(false);
    try {
      const fresh = await reset.mutateAsync();
      setDraft(fresh);
      toast.success('Reset to defaults', 'The original copy is back in place.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Please try again.';
      console.error(err);
      toast.error('Could not reset', msg);
    }
  }

  return (
    <div className="space-y-4">
      {queryError && <ApiErrorBanner error={queryError} />}

      {/* Editor — full width, single column for breathing room */}
      <div className="max-w-2xl space-y-4">
        {/* Tile picker */}
        <div className="bg-surface-cream rounded-xl border border-border p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted font-display mb-2">
            Tile
          </p>
          <div className="grid grid-cols-2 gap-2">
            {draft.tiles
              .slice()
              .sort((a, b) => a.display_order - b.display_order)
              .map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTileId(t.id)}
                  className={`text-left p-2.5 rounded-lg border-2 transition-colors ${
                    t.id === activeTileId
                      ? 'border-brand bg-card'
                      : 'border-transparent bg-card hover:border-border'
                  }`}
                >
                  <div
                    className="w-full h-8 rounded mb-1.5"
                    style={{ background: t.background }}
                  />
                  <p className="text-[11px] font-semibold font-display text-ink truncate">
                    {lang === 'en' ? t.title_en : t.title_es}
                  </p>
                  <p className="text-[11px] text-muted font-display capitalize">
                    {t.variant}
                  </p>
                </button>
              ))}
          </div>
        </div>

        {/* Per-tile form */}
        <TileForm
          tile={activeTile}
          onChange={(patch) => patchTile(activeTile.id, patch)}
        />

        {/* Action row — preview + reset + save */}
        {/* ON A PHONE (2026-11-05): Reset + Show preview side by side, Save
            full width under them — the three in one row needed ~430px. The
            inner group is `contents` there so all three sit in one grid. */}
        <div className="grid grid-cols-2 gap-3 pt-2 sm:flex sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="h-11 sm:h-10 px-3 rounded-lg text-xs font-semibold font-display text-gray border border-border hover:bg-surface-linen transition-colors flex items-center justify-center gap-1.5"
          >
            <RotateCcw size={13} strokeWidth={2} /> Reset to defaults
          </button>
          <div className="contents sm:flex sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={() => setPreview('open')}
              className="h-11 px-4 rounded-xl text-sm font-semibold font-display border-2 border-ink text-ink hover:bg-ink hover:text-card transition-colors flex items-center justify-center gap-2"
            >
              <Eye size={14} strokeWidth={2} /> Show preview
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || update.isPending}
              className="col-span-2 h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={14} strokeWidth={2} />
              {update.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </div>
      </div>

      {/* ─── Full-screen preview overlay ─── */}
      <PreviewOverlay
        open={preview === 'open'}
        title="Promo Grid"
        lang={lang}
        onLangChange={onLangChange}
        onClose={() => setPreview('closed')}
        onMinimize={() => setPreview('minimized')}
      >
        <PromoGridPreview config={draft} lang={lang} />
      </PreviewOverlay>
      <MinimizedPreviewChip
        open={preview === 'minimized'}
        title="Promo Grid"
        onRestore={() => setPreview('open')}
        onClose={() => setPreview('closed')}
      />

      <ConfirmModal
        open={confirmReset}
        title="Reset Promo Grid?"
        message="This restores the four tiles to the original Cesto defaults. Any saved edits are lost."
        confirmLabel="Reset"
        cancelLabel="Cancel"
        danger
        onConfirm={handleReset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

function TileForm({
  tile, onChange,
}: { tile: PromoTile; onChange: (patch: Partial<PromoTile>) => void }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold font-display text-ink">Edit tile</h3>
          <p className="text-[11px] text-muted font-display capitalize">
            {tile.variant} · {tile.id}
          </p>
        </div>
        <ActiveToggle
          value={tile.is_active}
          onChange={(v) => onChange({ is_active: v })}
        />
      </header>

      {/* Bilingual text fields */}
      <BiField
        label="Eyebrow"
        en={tile.eyebrow_en}
        es={tile.eyebrow_es}
        onEn={(v) => onChange({ eyebrow_en: v })}
        onEs={(v) => onChange({ eyebrow_es: v })}
        placeholder="Cesto subscription"
      />
      <BiField
        label="Title"
        en={tile.title_en}
        es={tile.title_es}
        onEn={(v) => onChange({ title_en: v })}
        onEs={(v) => onChange({ title_es: v })}
        placeholder="Rashan saves you 12% every month."
        multiline
      />
      <BiField
        label="Description (optional)"
        en={tile.description_en ?? ''}
        es={tile.description_es ?? ''}
        onEn={(v) => onChange({ description_en: v || null })}
        onEs={(v) => onChange({ description_es: v || null })}
        placeholder="Curated monthly packs delivered on repeat…"
        multiline
      />
      <BiField
        label="Button text"
        en={tile.cta_en}
        es={tile.cta_es}
        onEn={(v) => onChange({ cta_en: v })}
        onEs={(v) => onChange({ cta_es: v })}
        placeholder="Explore Rashan"
      />

      {/* Link */}
      <Field label="Button link">
        <input
          type="text"
          value={tile.link}
          onChange={(e) => onChange({ link: e.target.value })}
          placeholder="/rashan"
          className="w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
        />
      </Field>

      {/* Visual: background + text theme + accent */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Background (CSS)">
          <input
            type="text"
            value={tile.background}
            onChange={(e) => onChange({ background: e.target.value })}
            placeholder="#054EE8 or linear-gradient(…)"
            className="w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-xs font-mono text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
          />
        </Field>
        <Field label="Text theme">
          <select
            value={tile.text_theme}
            onChange={(e) => onChange({ text_theme: e.target.value as 'light' | 'dark' })}
            className="w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
          >
            <option value="dark">Dark text (on light bg)</option>
            <option value="light">Light text (on dark bg)</option>
          </select>
        </Field>
      </div>

      <ImageUploadField
        label="Background image (optional)"
        value={tile.image_url}
        onChange={(v) => onChange({ image_url: v })}
        helperText="When set, the image fills the tile — pick a text theme that stays readable over it."
      />
    </div>
  );
}

// ─── AdsBanner editor ────────────────────────────────────────────────────

function AdsBannerEditor({ lang, onLangChange }: { lang: Lang; onLangChange: (l: Lang) => void }) {
  const { data, error: queryError } = useAdminAdsBanner();
  const update = useUpdateAdsBanner();
  const reset = useResetAdsBanner();
  const toast = useToast();
  const [draft, setDraft] = useState<AdsBannerConfig>(defaultAdsBanner);
  const [seeded, setSeeded] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [activeBlock, setActiveBlock] = useState<'hero' | 'side'>('hero');
  const [preview, setPreview] = useState<PreviewState>('closed');

  useEffect(() => {
    if (data && !seeded) {
      setDraft(data);
      setSeeded(true);
    }
  }, [data, seeded]);

  const baseline = data ?? defaultAdsBanner;
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseline),
    [draft, baseline],
  );

  function patchBlock(block: 'hero' | 'side', patch: Partial<AdsBannerSection>) {
    setDraft((prev) => ({
      ...prev,
      [block]: { ...prev[block], ...patch },
    }));
  }

  async function handleSave() {
    try {
      await update.mutateAsync(draft);
      toast.success('Ads banner saved', 'Customer home page is now updated.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Please try again.';
      console.error(err);
      toast.error('Could not save', msg);
    }
  }

  async function handleReset() {
    setConfirmReset(false);
    try {
      const fresh = await reset.mutateAsync();
      setDraft(fresh);
      toast.success('Reset to defaults', 'The original copy is back in place.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Please try again.';
      console.error(err);
      toast.error('Could not reset', msg);
    }
  }

  const activeSection = draft[activeBlock];

  return (
    <div className="space-y-4">
      {queryError && <ApiErrorBanner error={queryError} />}
      <div className="max-w-2xl space-y-4">
        {/* Block picker */}
        <div className="bg-surface-cream rounded-xl border border-border p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted font-display mb-2">
            Block
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(['hero', 'side'] as const).map((b) => {
              const block = draft[b];
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setActiveBlock(b)}
                  className={`text-left p-2.5 rounded-lg border-2 transition-colors ${
                    b === activeBlock
                      ? 'border-brand bg-card'
                      : 'border-transparent bg-card hover:border-border'
                  }`}
                >
                  <div className="w-full h-8 rounded mb-1.5" style={{ background: block.background }} />
                  <p className="text-[11px] font-semibold font-display text-ink truncate">
                    {lang === 'en' ? block.title_en : block.title_es}
                  </p>
                  <p className="text-[11px] text-muted font-display capitalize">
                    {b === 'hero' ? 'Hero (2 cols)' : 'Side card (1 col)'}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <SectionForm
          section={activeSection}
          blockLabel={activeBlock === 'hero' ? 'Hero block' : 'Side card'}
          onChange={(patch) => patchBlock(activeBlock, patch)}
        />

        {/* ON A PHONE (2026-11-05): Reset + Show preview side by side, Save
            full width under them — the three in one row needed ~430px. The
            inner group is `contents` there so all three sit in one grid. */}
        <div className="grid grid-cols-2 gap-3 pt-2 sm:flex sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="h-11 sm:h-10 px-3 rounded-lg text-xs font-semibold font-display text-gray border border-border hover:bg-surface-linen transition-colors flex items-center justify-center gap-1.5"
          >
            <RotateCcw size={13} strokeWidth={2} /> Reset to defaults
          </button>
          <div className="contents sm:flex sm:items-center sm:gap-3">
            <button
              type="button"
              onClick={() => setPreview('open')}
              className="h-11 px-4 rounded-xl text-sm font-semibold font-display border-2 border-ink text-ink hover:bg-ink hover:text-card transition-colors flex items-center justify-center gap-2"
            >
              <Eye size={14} strokeWidth={2} /> Show preview
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || update.isPending}
              className="col-span-2 h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={14} strokeWidth={2} />
              {update.isPending ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </div>
      </div>

      <PreviewOverlay
        open={preview === 'open'}
        title="Ads Banner"
        lang={lang}
        onLangChange={onLangChange}
        onClose={() => setPreview('closed')}
        onMinimize={() => setPreview('minimized')}
      >
        <AdsBannerPreview config={draft} lang={lang} />
      </PreviewOverlay>
      <MinimizedPreviewChip
        open={preview === 'minimized'}
        title="Ads Banner"
        onRestore={() => setPreview('open')}
        onClose={() => setPreview('closed')}
      />

      <ConfirmModal
        open={confirmReset}
        title="Reset Ads Banner?"
        message="This restores the hero and side card to the original Cesto defaults. Any saved edits are lost."
        confirmLabel="Reset"
        cancelLabel="Cancel"
        danger
        onConfirm={handleReset}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

function SectionForm({
  section, blockLabel, onChange,
}: { section: AdsBannerSection; blockLabel: string; onChange: (patch: Partial<AdsBannerSection>) => void }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-4">
      <h3 className="text-sm font-bold font-display text-ink">{blockLabel}</h3>

      <BiField
        label="Eyebrow"
        en={section.eyebrow_en}
        es={section.eyebrow_es}
        onEn={(v) => onChange({ eyebrow_en: v })}
        onEs={(v) => onChange({ eyebrow_es: v })}
        placeholder="Sponsored"
      />
      <BiField
        label="Title"
        en={section.title_en}
        es={section.title_es}
        onEn={(v) => onChange({ title_en: v })}
        onEs={(v) => onChange({ title_es: v })}
        placeholder="Big brands, small prices."
        multiline
      />
      <BiField
        label="Description"
        en={section.description_en}
        es={section.description_es}
        onEn={(v) => onChange({ description_en: v })}
        onEs={(v) => onChange({ description_es: v })}
        placeholder="Discover handpicked partner products…"
        multiline
      />
      <BiField
        label="Button text"
        en={section.cta_en}
        es={section.cta_es}
        onEn={(v) => onChange({ cta_en: v })}
        onEs={(v) => onChange({ cta_es: v })}
        placeholder="Shop sponsored"
      />

      <Field label="Button link">
        <input
          type="text"
          value={section.link}
          onChange={(e) => onChange({ link: e.target.value })}
          placeholder="/categories?sponsored=1"
          className="w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Background (CSS)">
          <input
            type="text"
            value={section.background}
            onChange={(e) => onChange({ background: e.target.value })}
            placeholder="#054EE8 or linear-gradient(…)"
            className="w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-xs font-mono text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
          />
        </Field>
        <Field label="Text theme">
          <select
            value={section.text_theme}
            onChange={(e) => onChange({ text_theme: e.target.value as 'light' | 'dark' })}
            className="w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
          >
            <option value="dark">Dark text (on light bg)</option>
            <option value="light">Light text (on dark bg)</option>
          </select>
        </Field>
      </div>

      <ImageUploadField
        label="Background image (optional)"
        value={section.image_url}
        onChange={(v) => onChange({ image_url: v })}
        helperText="When set, the image fills the block — pick a text theme that stays readable over it."
      />
    </div>
  );
}

function ApiErrorBanner({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : 'Unknown error';
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border border-warning bg-warning-bg">
      <AlertTriangle size={18} strokeWidth={2} className="text-warning shrink-0 mt-0.5" />
      <div className="text-sm font-display text-ink leading-relaxed">
        <p className="font-semibold">Couldn't load saved sections from the server.</p>
        <p className="text-gray mt-1">
          The editor is showing default content so you can preview and edit, but
          saves won't persist until this is fixed. Most common cause: the
          <code className="font-mono px-1 mx-0.5 bg-white/60 rounded">home_sections</code>
          migration hasn't been applied yet — run <code className="font-mono px-1 mx-0.5 bg-white/60 rounded">npm run api:migrate</code> and restart the API.
        </p>
        <p className="text-[11px] text-muted mt-2 font-mono">{msg}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold font-display text-ink mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function BiField({
  label, en, es, onEn, onEs, placeholder, multiline = false,
}: {
  label: string;
  en: string;
  es: string;
  onEn: (v: string) => void;
  onEs: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const inputCls =
    'w-full bg-surface-cream border border-border rounded-lg px-3 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition';
  return (
    <div>
      <label className="block text-sm font-semibold font-display text-ink mb-1.5">{label}</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted font-display block mb-1">EN</span>
          {multiline ? (
            <textarea
              value={en}
              onChange={(e) => onEn(e.target.value)}
              placeholder={placeholder}
              rows={2}
              className={`${inputCls} py-2 resize-none`}
            />
          ) : (
            <input
              type="text"
              value={en}
              onChange={(e) => onEn(e.target.value)}
              placeholder={placeholder}
              className={`${inputCls} h-10`}
            />
          )}
        </div>
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted font-display block mb-1">ES</span>
          {multiline ? (
            <textarea
              value={es}
              onChange={(e) => onEs(e.target.value)}
              placeholder={placeholder}
              rows={2}
              className={`${inputCls} py-2 resize-none`}
            />
          ) : (
            <input
              type="text"
              value={es}
              onChange={(e) => onEs(e.target.value)}
              placeholder={placeholder}
              className={`${inputCls} h-10`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ActiveToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <span className="text-xs font-semibold font-display text-gray">
        {value ? 'Active' : 'Hidden'}
      </span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        // shrink-0 so the label cannot squeeze it; below sm an invisible
        // ::before makes the tap area 36px tall without changing the look
        // (2026-11-05).
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors before:absolute before:-inset-2 sm:before:hidden ${
          value ? 'bg-brand' : 'bg-border'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-card transition-transform ${
            value ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}

// ─── Preview overlay (full-screen) ───────────────────────────────────────
//
// Three-state lifecycle controlled by the parent editor:
//   - 'closed'    → nothing rendered
//   - 'open'      → full-screen overlay with the customer-home preview
//   - 'minimized' → a floating chip in the bottom-right corner to restore

type PreviewState = 'closed' | 'open' | 'minimized';

interface PreviewOverlayProps {
  open: boolean;
  title: string;
  lang: Lang;
  onLangChange: (l: Lang) => void;
  onClose: () => void;
  onMinimize: () => void;
  children: React.ReactNode;
}

function PreviewOverlay({
  open, title, lang, onLangChange, onClose, onMinimize, children,
}: PreviewOverlayProps) {
  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Lock body scroll while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-veil/45 backdrop-blur-sm">
      {/* Header */}
      <div className="h-14 bg-card border-b border-border px-4 lg:px-6 flex items-center gap-3 shrink-0">
        {/* On a phone (2026-11-05) the subtitle goes and Minimize is
            icon-only (its title names it) so the row fits 390px. */}
        <div className="flex items-center gap-2 min-w-0">
          <Eye size={16} strokeWidth={2} className="text-brand shrink-0" />
          <h3 className="text-sm font-bold font-display text-ink truncate">{title}</h3>
          <span className="hidden sm:inline text-xs text-muted font-display">· customer home preview</span>
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {/* Language toggle */}
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {(['en', 'es'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onLangChange(l)}
                className={`h-9 sm:h-auto px-2.5 py-1.5 text-[11px] font-semibold font-display flex items-center gap-1 ${
                  lang === l ? 'bg-ink text-card' : 'bg-card text-gray hover:bg-surface-linen'
                }`}
              >
                <Globe size={11} strokeWidth={2.25} /> {l.toUpperCase()}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onMinimize}
            className="h-9 w-9 sm:w-auto sm:px-3 rounded-lg text-xs font-semibold font-display text-gray border border-border hover:bg-surface-linen transition-colors flex items-center justify-center gap-1.5"
            title="Minimize (Esc closes)"
          >
            <Minimize2 size={13} strokeWidth={2} /> <span className="hidden sm:inline">Minimize</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3 rounded-lg text-xs font-semibold font-display text-card bg-ink hover:bg-charcoal transition-colors flex items-center gap-1.5"
            title="Close (Esc)"
          >
            <X size={13} strokeWidth={2} /> Close
          </button>
        </div>
      </div>

      {/* Body — mirrors the customer home: same surface, same max-width container */}
      <div className="flex-1 overflow-y-auto bg-surface-linen">
        <div className="max-w-[1500px] mx-auto px-4 lg:px-6 py-8">
          {children}
        </div>
      </div>
    </div>
  );
}

interface MinimizedChipProps {
  open: boolean;
  title: string;
  onRestore: () => void;
  onClose: () => void;
}

function MinimizedPreviewChip({ open, title, onRestore, onClose }: MinimizedChipProps) {
  if (!open) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-1 bg-night rounded-full pl-4 pr-1.5 py-1.5 shadow-modal">
      <button
        type="button"
        onClick={onRestore}
        className="h-9 sm:h-auto text-white text-xs font-semibold font-display flex items-center gap-2 pr-2"
      >
        <Eye size={13} strokeWidth={2} /> {title} preview
        <Maximize2 size={12} strokeWidth={2} className="text-white/70" />
      </button>
      <button
        type="button"
        onClick={onClose}
        className="w-9 h-9 sm:w-7 sm:h-7 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center"
        title="Dismiss"
      >
        <X size={12} strokeWidth={2.25} className="text-white" />
      </button>
    </div>
  );
}

// ─── Stores Hero editor ──────────────────────────────────────────────────
// Simple single-form editor for the panel that sits above the customer
// /stores page search bar. Every visual is admin-editable — background CSS,
// optional cover image, bilingual title + subtitle, and text theme.

const HERO_BG_PRESETS: { label: string; value: string; theme: 'light' | 'dark' }[] = [
  { label: 'Soft blue (default)', theme: 'dark',  value: 'linear-gradient(135deg, #F0F4FE 0%, #FFFFFF 55%, #DCE6FD 100%)' },
  { label: 'Cesto blue',          theme: 'light', value: 'linear-gradient(135deg, #022B91 0%, #054EE8 55%, #2A6AEF 100%)' },
  { label: 'Cream',               theme: 'dark',  value: 'linear-gradient(135deg, #FFF9EC 0%, #FFFFFF 60%, #FFE7B0 100%)' },
  { label: 'Mint',                theme: 'dark',  value: 'linear-gradient(135deg, #E9F4DC 0%, #FFFFFF 60%, #C8E5A5 100%)' },
  { label: 'Solid ink',           theme: 'light', value: '#1A1A1A' },
];

function StoresHeroEditor({ lang, onLangChange }: { lang: Lang; onLangChange: (l: Lang) => void }) {
  const { data, error: queryError } = useAdminStoresHero();
  const update = useUpdateStoresHero();
  const reset = useResetStoresHero();
  const toast = useToast();
  const [draft, setDraft] = useState<StoresHeroConfig>(defaultStoresHero);
  const [seeded, setSeeded] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (data && !seeded) {
      setDraft(data);
      setSeeded(true);
    }
  }, [data, seeded]);

  const baseline = data ?? defaultStoresHero;
  const dirty = useMemo(
    () => JSON.stringify({ ...draft, updated_at: '' }) !== JSON.stringify({ ...baseline, updated_at: '' }),
    [draft, baseline],
  );

  const patch = (p: Partial<StoresHeroConfig>) => setDraft((prev) => ({ ...prev, ...p }));

  async function handleSave() {
    try {
      await update.mutateAsync(draft);
      toast.success('Stores hero saved', 'The /stores page is now updated.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Please try again.';
      console.error(err);
      toast.error('Could not save', msg);
    }
  }

  async function handleReset() {
    setConfirmReset(false);
    try {
      const fresh = await reset.mutateAsync();
      setDraft(fresh);
      toast.success('Reset to defaults', 'Original hero is back in place.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Please try again.';
      console.error(err);
      toast.error('Could not reset', msg);
    }
  }

  const previewImage = draft.image_url ? resolveImageUrl(draft.image_url, 'tile') : null;
  const textCls = draft.text_theme === 'light' ? 'text-white' : 'text-ink';
  const subCls  = draft.text_theme === 'light' ? 'text-white/85' : 'text-gray';

  return (
    <div className="space-y-4">
      {queryError && <ApiErrorBanner error={queryError} />}

      <div className="max-w-2xl space-y-4">
        {/* Live preview — mirrors the customer /stores hero exactly. */}
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted font-display mb-2">
            Preview
          </p>
          <div
            className="relative overflow-hidden rounded-2xl border border-border px-6 py-5"
            style={{ background: draft.background }}
          >
            {previewImage && (
              <img src={previewImage} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
            )}
            <div className="relative">
              <h2 className={`font-display text-[24px] tracking-tight leading-[1.15] ${textCls}`} style={{ fontWeight: 700 }}>
                {lang === 'en' ? draft.title_en : draft.title_es}
              </h2>
              <p className={`font-body text-[13px] mt-1.5 leading-snug ${subCls}`}>
                {lang === 'en' ? draft.subtitle_en : draft.subtitle_es}
              </p>
            </div>
          </div>
        </div>

        {/* Background */}
        <Field label="Background">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {HERO_BG_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => patch({ background: p.value, text_theme: p.theme })}
                  className={`inline-flex items-center gap-2 h-9 sm:h-8 pl-1 pr-3 rounded-full border text-[11px] font-display font-semibold transition-all ${
                    draft.background === p.value
                      ? 'border-brand bg-brand/5 text-ink'
                      : 'border-border bg-card text-gray hover:border-brand/40'
                  }`}
                  title={p.value}
                >
                  <span className="w-6 h-6 rounded-full border border-border/60" style={{ background: p.value }} />
                  {p.label}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={draft.background}
              onChange={(e) => patch({ background: e.target.value })}
              placeholder="hex, gradient, or any CSS background value"
              className="w-full bg-surface-cream border border-border rounded-lg px-3 h-10 text-sm font-mono text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
            />
            <p className="text-[11px] text-muted font-display">
              Accepts any CSS <code>background</code> value — hex like <code>#054EE8</code>, gradients, or <code>url(...)</code>.
            </p>
          </div>
        </Field>

        {/* Cover image */}
        <ImageUploadField
          label="Cover image (optional)"
          helperText="Layered above the background. Use a wide image for best results."
          value={draft.image_url}
          onChange={(v) => patch({ image_url: v })}
        />

        {/* Text theme */}
        <Field label="Text theme">
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {(['dark', 'light'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => patch({ text_theme: t })}
                className={`px-4 h-10 text-xs font-semibold font-display capitalize ${
                  draft.text_theme === t ? 'bg-ink text-card' : 'bg-card text-gray hover:bg-surface-linen'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>

        {/* Copy */}
        <BiField
          label="Title"
          en={draft.title_en}
          es={draft.title_es}
          onEn={(v) => patch({ title_en: v })}
          onEs={(v) => patch({ title_es: v })}
          placeholder="Stores"
        />
        <BiField
          label="Subtitle"
          en={draft.subtitle_en}
          es={draft.subtitle_es}
          onEn={(v) => patch({ subtitle_en: v })}
          onEs={(v) => patch({ subtitle_es: v })}
          placeholder="One short sentence…"
          multiline
        />

        {/* Action row */}
        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-border bg-card text-xs font-semibold font-display text-gray hover:text-ink hover:border-border/80"
            disabled={reset.isPending}
          >
            <RotateCcw size={13} strokeWidth={2} /> Reset to defaults
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || update.isPending}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-brand hover:bg-brand-deepest text-white text-xs font-semibold font-display disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={13} strokeWidth={2} />
            {update.isPending ? 'Saving…' : dirty ? 'Save changes' : 'No changes'}
          </button>
        </div>

        {/* Language toggle for the preview above */}
        <div className="flex items-center gap-2 text-[11px] font-display text-muted">
          <span>Preview language:</span>
          {(['en', 'es'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => onLangChange(l)}
              className={`inline-flex items-center gap-1 px-2 h-9 sm:h-6 rounded border ${
                lang === l ? 'border-brand bg-brand/5 text-ink' : 'border-border bg-card text-gray hover:text-ink'
              }`}
            >
              <Globe size={10} strokeWidth={2.25} /> {l.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <ConfirmModal
        open={confirmReset}
        onCancel={() => setConfirmReset(false)}
        onConfirm={handleReset}
        title="Reset stores hero?"
        message="This restores the original background, title and subtitle. Any custom values will be lost."
        confirmLabel="Reset"
      />
    </div>
  );
}

