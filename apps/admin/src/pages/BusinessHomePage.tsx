import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAdminBusinessHome, useUpdateBusinessHome, useResetBusinessHome, useAdminMe,
  ANNOUNCEMENT_TAGS, BUSINESS_HOME_TONES, LOGISTICS_ICONS,
  type AnnouncementTag, type BusinessHomeContent, type BusinessHomeTone, type LogisticsIcon,
} from '@grocery-app/shared';
import {
  ArrowDown, ArrowUp, CalendarDays, Image as ImageIcon, Megaphone, Plus, RotateCcw, Tag, Trash2, Truck,
} from 'lucide-react';
import { TextField, Select, Checkbox } from '@/components/form';
import BilingualRow from '@/components/BilingualRow';
import ImageUploadField from '@/components/home-preview/ImageUploadField';
import { TableSkeleton } from '@/components/Skeleton';
import ConfirmModal from '@/components/ConfirmModal';

/**
 * Admin → Business home (2026-10-31).
 *
 * The home of a business's panel (cestoshop.com/business): an intro,
 * promotions, Cesto logistics, an ads banner and Cesto's announcements — B2B's
 * own, separate from the shop's Home Sections (user: "B2B's own, edited in
 * admin"). Saved whole, like App content; the panel picks changes up within
 * a few minutes.
 *
 * Every text is bilingual and both languages are required wherever one is: a
 * missing translation shows as an empty line to whoever reads the other one.
 */

type TabId = 'banners' | 'promotions' | 'logistics' | 'announcements';

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12)).slice(0, 36);

/** Today in Spain, the calendar the panel drops past announcements by. */
const madridToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** One item of a list: its name, then show/hide, move and remove. */
function ItemCard({ title, badge, active, onActive, activeLabel, onUp, onDown, onRemove, children }: {
  title: string;
  badge?: string;
  active?: boolean;
  onActive?: (on: boolean) => void;
  activeLabel?: string;
  onUp?: () => void;
  onDown?: () => void;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  // 36px on a phone, 32px from sm (2026-11-05).
  const iconBtn = 'w-9 h-9 sm:w-8 sm:h-8 shrink-0 rounded-lg border border-border text-gray hover:bg-surface-linen hover:text-ink inline-flex items-center justify-center disabled:opacity-30 disabled:pointer-events-none';
  return (
    <div className={`bg-card rounded-xl border border-border p-5 space-y-3 ${active === false ? 'opacity-75' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold font-display text-ink">{title}</h3>
        {badge && <span className="h-6 px-2 rounded-full bg-surface-linen text-[11.5px] font-semibold font-display text-gray inline-flex items-center">{badge}</span>}
        <span className="flex-1" />
        {/* The label is 20px tall; padding with a matching negative margin
            makes it a 36px tap without moving anything (2026-11-05). */}
        {onActive && <Checkbox className="[&>label]:py-2 [&>label]:-my-2" label={activeLabel ?? t('businessHome.show')} checked={!!active} onChange={(e) => onActive(e.target.checked)} />}
        {(onUp || onDown) && (
          <>
            <button type="button" className={iconBtn} onClick={onUp} disabled={!onUp} aria-label={t('businessHome.moveUp')}><ArrowUp className="w-4 h-4" strokeWidth={1.75} /></button>
            <button type="button" className={iconBtn} onClick={onDown} disabled={!onDown} aria-label={t('businessHome.moveDown')}><ArrowDown className="w-4 h-4" strokeWidth={1.75} /></button>
          </>
        )}
        {onRemove && (
          <button type="button" className={`${iconBtn} hover:text-danger`} onClick={onRemove} aria-label={t('businessHome.remove')}>
            <Trash2 className="w-4 h-4" strokeWidth={1.75} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-dashed border-border text-sm font-semibold font-display text-gray hover:bg-surface-linen"
    >
      <Plus className="w-4 h-4" strokeWidth={1.75} /> {label}
    </button>
  );
}

/** Swaps item i with its neighbour; the list is mutated in a clone by `edit`. */
function move<T>(list: T[], i: number, by: -1 | 1) {
  const j = i + by;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

export default function BusinessHomePage() {
  const { data, isLoading } = useAdminBusinessHome();
  if (isLoading || !data) return <TableSkeleton />;
  return <Editor initial={data} />;
}

/** Starts from what was loaded; a save keeps the draft, a reset replaces it with what the server restored. */
function Editor({ initial }: { initial: BusinessHomeContent }) {
  const { t } = useTranslation();
  const update = useUpdateBusinessHome();
  const reset = useResetBusinessHome();
  const { data: me } = useAdminMe();
  const isSuperAdmin = me?.role === 'super_admin';

  const [tab, setTab] = useState<TabId>('banners');
  const [draft, setDraft] = useState<BusinessHomeContent>(() => structuredClone(initial));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  /** Mutates a clone, so a failed save leaves the loaded copy untouched. */
  const edit = (fn: (d: BusinessHomeContent) => void) => {
    setDraft((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setSaved(false);
  };

  const onSave = () => {
    setError(null);
    update.mutate(draft, {
      onSuccess: () => setSaved(true),
      // The API names the field it refused (a missing translation, a title too
      // long for its card); show that rather than a generic failure.
      onError: (err) => setError(err instanceof Error ? err.message : t('businessHome.saveFailed')),
    });
  };

  const toneOptions = BUSINESS_HOME_TONES.map((v) => ({ value: v, label: t(`businessHome.tones.${v}`) }));
  const linkHint = t('businessHome.linkHint');
  const today = madridToday();

  const tabs: { id: TabId; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'banners', label: t('businessHome.tabs.banners'), icon: ImageIcon, count: draft.banners.length },
    { id: 'promotions', label: t('businessHome.tabs.promotions'), icon: Tag, count: draft.promotions.length },
    { id: 'logistics', label: t('businessHome.tabs.logistics'), icon: Truck },
    { id: 'announcements', label: t('businessHome.tabs.announcements'), icon: Megaphone, count: draft.announcements.length },
  ];

  return (
    <div>
      {/* On a phone (2026-11-05) Reset and Save share the row under the
          title, each half — not two odd-width buttons hugging the left. */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[240px]">
          <h1 className="text-2xl font-extrabold font-display text-ink">{t('businessHome.title')}</h1>
          <p className="text-sm font-body text-gray mt-1">{t('businessHome.subtitle')}</p>
        </div>
        {saved && (
          <span className="inline-flex items-center bg-success-bg text-success border border-success/30 rounded-full px-4 h-10 text-sm font-display font-semibold">
            {t('businessHome.saved')}
          </span>
        )}
        {error && (
          <span className="inline-flex items-center bg-danger-bg text-danger border border-danger/30 rounded-full px-4 min-h-10 py-2 text-sm font-display font-semibold max-w-full">
            {error}
          </span>
        )}
        {isSuperAdmin && (
          <button
            type="button"
            onClick={() => setResetOpen(true)}
            className="flex-1 sm:flex-none h-11 px-4 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors inline-flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-4 h-4" strokeWidth={1.75} /> {t('businessHome.reset')}
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={update.isPending}
          className="flex-1 sm:flex-none h-11 px-6 rounded-xl text-sm font-bold font-display bg-brand text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {update.isPending ? t('businessHome.saving') : t('businessHome.save')}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[224px_1fr] gap-6 items-start">
        <nav className="tab-strip bg-card rounded-xl border border-border p-2 flex lg:flex-col gap-1 overflow-x-auto">
          {tabs.map((tb) => {
            const Icon = tb.icon;
            const active = tab === tb.id;
            return (
              <button
                key={tb.id}
                type="button"
                onClick={() => setTab(tb.id)}
                className={`flex items-center gap-2 px-3 h-10 rounded-lg text-sm font-semibold font-display whitespace-nowrap transition-colors ${
                  active ? 'bg-brand text-white' : 'text-gray hover:bg-surface-linen'
                }`}
              >
                <Icon className="w-4 h-4" strokeWidth={1.75} />
                <span className="flex-1 text-left">{tb.label}</span>
                {tb.count !== undefined && tb.count > 0 && (
                  <span className={`min-w-[20px] h-5 px-1.5 rounded-full text-[11px] tabular-nums inline-flex items-center justify-center ${active ? 'bg-white/20' : 'bg-surface-linen'}`}>{tb.count}</span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="space-y-4">
          {/* ── Promotions ── */}
          {tab === 'promotions' && (
            <>
              <p className="text-sm font-body text-gray">{t('businessHome.promotionsHint')}</p>
              {draft.promotions.map((p, i) => (
                <ItemCard
                  key={p.id}
                  title={`${t('businessHome.promotion')} ${i + 1}`}
                  active={p.is_active}
                  onActive={(on) => edit((d) => { d.promotions[i].is_active = on; })}
                  onUp={i > 0 ? () => edit((d) => move(d.promotions, i, -1)) : undefined}
                  onDown={i < draft.promotions.length - 1 ? () => edit((d) => move(d.promotions, i, 1)) : undefined}
                  onRemove={() => edit((d) => { d.promotions.splice(i, 1); })}
                >
                  <BilingualRow
                    label={t('businessHome.heading')} max={60}
                    es={p.title_es} en={p.title_en}
                    onEs={(v) => edit((d) => { d.promotions[i].title_es = v; })}
                    onEn={(v) => edit((d) => { d.promotions[i].title_en = v; })}
                  />
                  <BilingualRow
                    label={t('businessHome.body')} long max={160}
                    es={p.body_es} en={p.body_en}
                    onEs={(v) => edit((d) => { d.promotions[i].body_es = v; })}
                    onEn={(v) => edit((d) => { d.promotions[i].body_en = v; })}
                  />
                  <BilingualRow
                    label={t('businessHome.badge')} max={16}
                    es={p.badge_es} en={p.badge_en}
                    onEs={(v) => edit((d) => { d.promotions[i].badge_es = v; })}
                    onEn={(v) => edit((d) => { d.promotions[i].badge_en = v; })}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField label={t('businessHome.link')} hint={linkHint} value={p.link} maxLength={500} onChange={(e) => edit((d) => { d.promotions[i].link = e.target.value; })} />
                    <Select label={t('businessHome.tone')} hint={t('businessHome.toneHint')} value={p.tone} options={toneOptions} onChange={(e) => edit((d) => { d.promotions[i].tone = e.target.value as BusinessHomeTone; })} />
                  </div>
                  <ImageUploadField label={t('businessHome.image')} value={p.image_url} onChange={(v) => edit((d) => { d.promotions[i].image_url = v; })} />
                </ItemCard>
              ))}
              {draft.promotions.length < 8 && (
                <AddButton
                  label={t('businessHome.addPromotion')}
                  onClick={() => edit((d) => {
                    d.promotions.push({ id: newId(), title_es: '', title_en: '', body_es: '', body_en: '', badge_es: '', badge_en: '', image_url: null, tone: 'blue', link: '/business/catalogue', is_active: true });
                  })}
                />
              )}
            </>
          )}

          {/* ── Cesto logistics ── */}
          {tab === 'logistics' && (
            <>
              <ItemCard
                title={t('businessHome.tabs.logistics')}
                active={draft.logistics.is_active}
                onActive={(on) => edit((d) => { d.logistics.is_active = on; })}
              >
                <p className="text-[12.5px] font-body text-muted -mt-1">{t('businessHome.logisticsHint')}</p>
                <BilingualRow
                  label={t('businessHome.heading')} max={60}
                  es={draft.logistics.title_es} en={draft.logistics.title_en}
                  onEs={(v) => edit((d) => { d.logistics.title_es = v; })}
                  onEn={(v) => edit((d) => { d.logistics.title_en = v; })}
                />
                <BilingualRow
                  label={t('businessHome.body')} long max={240}
                  es={draft.logistics.body_es} en={draft.logistics.body_en}
                  onEs={(v) => edit((d) => { d.logistics.body_es = v; })}
                  onEn={(v) => edit((d) => { d.logistics.body_en = v; })}
                />
              </ItemCard>
              {draft.logistics.points.map((pt, i) => (
                <ItemCard
                  key={pt.id}
                  title={`${t('businessHome.point')} ${i + 1}`}
                  onUp={i > 0 ? () => edit((d) => move(d.logistics.points, i, -1)) : undefined}
                  onDown={i < draft.logistics.points.length - 1 ? () => edit((d) => move(d.logistics.points, i, 1)) : undefined}
                  onRemove={() => edit((d) => { d.logistics.points.splice(i, 1); })}
                >
                  <Select
                    label={t('businessHome.icon')}
                    value={pt.icon}
                    options={LOGISTICS_ICONS.map((v) => ({ value: v, label: t(`businessHome.icons.${v}`) }))}
                    onChange={(e) => edit((d) => { d.logistics.points[i].icon = e.target.value as LogisticsIcon; })}
                  />
                  <BilingualRow
                    label={t('businessHome.heading')} max={50}
                    es={pt.title_es} en={pt.title_en}
                    onEs={(v) => edit((d) => { d.logistics.points[i].title_es = v; })}
                    onEn={(v) => edit((d) => { d.logistics.points[i].title_en = v; })}
                  />
                  <BilingualRow
                    label={t('businessHome.body')} long max={200}
                    es={pt.body_es} en={pt.body_en}
                    onEs={(v) => edit((d) => { d.logistics.points[i].body_es = v; })}
                    onEn={(v) => edit((d) => { d.logistics.points[i].body_en = v; })}
                  />
                </ItemCard>
              ))}
              {draft.logistics.points.length < 6 && (
                <AddButton
                  label={t('businessHome.addPoint')}
                  onClick={() => edit((d) => { d.logistics.points.push({ id: newId(), icon: 'truck', title_es: '', title_en: '', body_es: '', body_en: '' }); })}
                />
              )}
            </>
          )}

          {/* ── Banners ── */}
          {tab === 'banners' && (
            <>
              <p className="text-sm font-body text-gray">{t('businessHome.bannersHint')}</p>
              {draft.banners.map((bn, i) => (
                <ItemCard
                  key={bn.id}
                  title={`${t('businessHome.banner')} ${i + 1}`}
                  active={bn.is_active}
                  onActive={(on) => edit((d) => { d.banners[i].is_active = on; })}
                  onUp={i > 0 ? () => edit((d) => move(d.banners, i, -1)) : undefined}
                  onDown={i < draft.banners.length - 1 ? () => edit((d) => move(d.banners, i, 1)) : undefined}
                  onRemove={() => edit((d) => { d.banners.splice(i, 1); })}
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <ImageUploadField label={`${t('businessHome.imageWide')} *`} helperText={t('businessHome.imageWideHint')} value={bn.image_url} onChange={(v) => edit((d) => { d.banners[i].image_url = v; })} />
                    <ImageUploadField label={t('businessHome.imagePhone')} helperText={t('businessHome.imagePhoneHint')} value={bn.image_mobile_url} onChange={(v) => edit((d) => { d.banners[i].image_mobile_url = v; })} />
                  </div>
                  <TextField label={t('businessHome.link')} hint={linkHint} value={bn.link} maxLength={500} onChange={(e) => edit((d) => { d.banners[i].link = e.target.value; })} />
                </ItemCard>
              ))}
              {draft.banners.length < 6 && (
                <AddButton
                  label={t('businessHome.addBanner')}
                  onClick={() => edit((d) => {
                    d.banners.push({ id: newId(), is_active: true, link: '/business/catalogue', image_url: null, image_mobile_url: null });
                  })}
                />
              )}
            </>
          )}

          {/* ── Announcements ── */}
          {tab === 'announcements' && (
            <>
              <p className="text-sm font-body text-gray">{t('businessHome.announcementsHint')}</p>
              {draft.announcements.map((a, i) => (
                <ItemCard
                  key={a.id}
                  title={`${t('businessHome.announcement')} ${i + 1}`}
                  badge={a.date && a.date < today ? t('businessHome.past') : undefined}
                  active={a.is_active}
                  onActive={(on) => edit((d) => { d.announcements[i].is_active = on; })}
                  onUp={i > 0 ? () => edit((d) => move(d.announcements, i, -1)) : undefined}
                  onDown={i < draft.announcements.length - 1 ? () => edit((d) => move(d.announcements, i, 1)) : undefined}
                  onRemove={() => edit((d) => { d.announcements.splice(i, 1); })}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField
                      type="date"
                      label={t('businessHome.date')}
                      hint={t('businessHome.dateHint')}
                      value={a.date ?? ''}
                      leadingIcon={<CalendarDays className="w-4 h-4" strokeWidth={1.75} />}
                      onChange={(e) => edit((d) => { d.announcements[i].date = e.target.value || null; })}
                    />
                    <Select
                      label={t('businessHome.kind')}
                      value={a.tag}
                      options={ANNOUNCEMENT_TAGS.map((v) => ({ value: v, label: t(`businessHome.tags.${v}`) }))}
                      onChange={(e) => edit((d) => { d.announcements[i].tag = e.target.value as AnnouncementTag; })}
                    />
                  </div>
                  <BilingualRow
                    label={t('businessHome.heading')} max={80}
                    es={a.title_es} en={a.title_en}
                    onEs={(v) => edit((d) => { d.announcements[i].title_es = v; })}
                    onEn={(v) => edit((d) => { d.announcements[i].title_en = v; })}
                  />
                  <BilingualRow
                    label={t('businessHome.body')} long max={300}
                    es={a.body_es} en={a.body_en}
                    onEs={(v) => edit((d) => { d.announcements[i].body_es = v; })}
                    onEn={(v) => edit((d) => { d.announcements[i].body_en = v; })}
                  />
                </ItemCard>
              ))}
              {draft.announcements.length < 20 && (
                <AddButton
                  label={t('businessHome.addAnnouncement')}
                  onClick={() => edit((d) => {
                    d.announcements.push({ id: newId(), date: null, tag: 'news', title_es: '', title_en: '', body_es: '', body_en: '', is_active: true });
                  })}
                />
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmModal
        open={resetOpen}
        danger
        title={t('businessHome.resetTitle')}
        message={t('businessHome.resetMessage')}
        confirmLabel={t('businessHome.reset')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setResetOpen(false);
          reset.mutate(undefined, { onSuccess: (fresh) => { setDraft(structuredClone(fresh)); setError(null); setSaved(true); } });
        }}
        onCancel={() => setResetOpen(false)}
      />
    </div>
  );
}
