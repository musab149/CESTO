import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  useAdminAppContent, useUpdateAppContent, useResetAppContent, useAdminMe,
  RIBBON_ICONS,
  type AppContent, type RibbonIcon,
} from '@grocery-app/shared';
import { Smartphone, Info, Package, Sparkles, RotateCcw, Plus, Trash2 } from 'lucide-react';
import { Select } from '@/components/form';
import BilingualRow from '@/components/BilingualRow';
import { TableSkeleton } from '@/components/Skeleton';
import ConfirmModal from '@/components/ConfirmModal';

/**
 * Admin → App content.
 *
 * Copy the mobile app renders but does not own: onboarding, About, the Rashan
 * landing page and the home value ribbon. Before this page, editing any of it
 * meant a Play build, an upload and a review wait — and two releases in one
 * week were pure text.
 *
 * Every field is bilingual and both languages are required, because a missing
 * translation does not fail loudly on a phone: it renders as an empty line in
 * whichever language the customer happens to use.
 */

type TabId = 'onboarding' | 'about' | 'rashan' | 'ribbon';

function Card({ title, onRemove, children }: { title: string; onRemove?: () => void; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold font-display text-ink">{title}</h3>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            // py/px with matching negative margins: a 36px tap on a phone
            // without moving anything (2026-11-05).
            className="inline-flex items-center gap-1.5 py-2.5 -my-2.5 px-2 -mx-2 text-xs font-semibold font-display text-danger hover:underline"
          >
            <Trash2 className="w-3.5 h-3.5" strokeWidth={1.75} /> {'—'}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

export default function AppContentPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useAdminAppContent();
  const update = useUpdateAppContent();
  const reset = useResetAppContent();
  const { data: me } = useAdminMe();
  const isSuperAdmin = me?.role === 'super_admin';

  const [tab, setTab] = useState<TabId>('onboarding');
  const [draft, setDraft] = useState<AppContent | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  useEffect(() => { if (data) setDraft(structuredClone(data)); }, [data]);

  if (isLoading || !draft) return <TableSkeleton />;

  /** Mutates a clone, so a failed save leaves the loaded copy untouched. */
  const edit = (fn: (d: AppContent) => void) => {
    setDraft((prev) => {
      if (!prev) return prev;
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
      // The API rejects over-length copy field by field; show what it said
      // rather than a generic failure, since the limits exist for layout.
      onError: (err) => setError(err instanceof Error ? err.message : t('appContent.saveFailed')),
    });
  };

  const tabs: { id: TabId; label: string; icon: typeof Smartphone }[] = [
    { id: 'onboarding', label: t('appContent.tabs.onboarding'), icon: Smartphone },
    { id: 'about', label: t('appContent.tabs.about'), icon: Info },
    { id: 'rashan', label: t('appContent.tabs.rashan'), icon: Package },
    { id: 'ribbon', label: t('appContent.tabs.ribbon'), icon: Sparkles },
  ];

  return (
    <div>
      {/* On a phone (2026-11-05) the title takes its own row and Reset and
          Save share the next, each half — not two odd-width buttons hugging
          the left. */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="w-full sm:w-auto sm:flex-1 sm:min-w-[240px]">
          <h1 className="text-2xl font-extrabold font-display text-ink">{t('appContent.title')}</h1>
          <p className="text-sm font-body text-gray mt-1">{t('appContent.subtitle')}</p>
        </div>
        {saved && (
          <span className="inline-flex items-center bg-success-bg text-success border border-success/30 rounded-full px-4 h-10 text-sm font-display font-semibold">
            {t('appContent.saved')}
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
            <RotateCcw className="w-4 h-4" strokeWidth={1.75} /> {t('appContent.reset')}
          </button>
        )}
        <button
          type="button"
          onClick={onSave}
          disabled={update.isPending}
          className="flex-1 sm:flex-none h-11 px-6 rounded-xl text-sm font-bold font-display bg-brand text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {update.isPending ? t('appContent.saving') : t('appContent.save')}
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
                {tb.label}
              </button>
            );
          })}
        </nav>

        <div className="space-y-4">
          {tab === 'onboarding' && draft.onboarding.slides.map((slide, i) => (
            <Card key={slide.key} title={`${t('appContent.slide')} ${i + 1}`}>
              <BilingualRow
                label={t('appContent.eyebrow')} max={40}
                es={slide.eyebrow_es} en={slide.eyebrow_en}
                onEs={(v) => edit((d) => { d.onboarding.slides[i].eyebrow_es = v; })}
                onEn={(v) => edit((d) => { d.onboarding.slides[i].eyebrow_en = v; })}
              />
              <BilingualRow
                label={t('appContent.headline')} long max={80}
                es={slide.title_es} en={slide.title_en}
                onEs={(v) => edit((d) => { d.onboarding.slides[i].title_es = v; })}
                onEn={(v) => edit((d) => { d.onboarding.slides[i].title_en = v; })}
              />
              <p className="text-[11.5px] font-body text-muted -mt-1">{t('appContent.headlineHint')}</p>
              <BilingualRow
                label={t('appContent.body')} long max={220}
                es={slide.body_es} en={slide.body_en}
                onEs={(v) => edit((d) => { d.onboarding.slides[i].body_es = v; })}
                onEn={(v) => edit((d) => { d.onboarding.slides[i].body_en = v; })}
              />
            </Card>
          ))}

          {tab === 'about' && (
            <>
              <Card title={t('appContent.mission')}>
                <BilingualRow
                  label={t('appContent.mission')} long max={600}
                  es={draft.about.mission_es} en={draft.about.mission_en}
                  onEs={(v) => edit((d) => { d.about.mission_es = v; })}
                  onEn={(v) => edit((d) => { d.about.mission_en = v; })}
                />
              </Card>
              {draft.about.values.map((val, i) => (
                <Card
                  key={i}
                  title={`${t('appContent.value')} ${i + 1}`}
                  onRemove={() => edit((d) => { d.about.values.splice(i, 1); })}
                >
                  <BilingualRow
                    label={t('appContent.heading')} max={60}
                    es={val.title_es} en={val.title_en}
                    onEs={(v) => edit((d) => { d.about.values[i].title_es = v; })}
                    onEn={(v) => edit((d) => { d.about.values[i].title_en = v; })}
                  />
                  <BilingualRow
                    label={t('appContent.body')} long max={240}
                    es={val.body_es} en={val.body_en}
                    onEs={(v) => edit((d) => { d.about.values[i].body_es = v; })}
                    onEn={(v) => edit((d) => { d.about.values[i].body_en = v; })}
                  />
                </Card>
              ))}
              {draft.about.values.length < 8 && (
                <button
                  type="button"
                  onClick={() => edit((d) => { d.about.values.push({ title_es: '', title_en: '', body_es: '', body_en: '' }); })}
                  className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-dashed border-border text-sm font-semibold font-display text-gray hover:bg-surface-linen"
                >
                  <Plus className="w-4 h-4" strokeWidth={1.75} /> {t('appContent.addValue')}
                </button>
              )}
            </>
          )}

          {tab === 'rashan' && (
            <>
              <Card title={t('appContent.hero')}>
                <BilingualRow
                  label={t('appContent.heading')} max={80}
                  es={draft.rashan.hero_title_es} en={draft.rashan.hero_title_en}
                  onEs={(v) => edit((d) => { d.rashan.hero_title_es = v; })}
                  onEn={(v) => edit((d) => { d.rashan.hero_title_en = v; })}
                />
                <BilingualRow
                  label={t('appContent.body')} long max={300}
                  es={draft.rashan.hero_body_es} en={draft.rashan.hero_body_en}
                  onEs={(v) => edit((d) => { d.rashan.hero_body_es = v; })}
                  onEn={(v) => edit((d) => { d.rashan.hero_body_en = v; })}
                />
              </Card>
              {draft.rashan.steps.map((step, i) => (
                <Card
                  key={i}
                  title={`${t('appContent.step')} ${i + 1}`}
                  onRemove={() => edit((d) => { d.rashan.steps.splice(i, 1); })}
                >
                  <BilingualRow
                    label={t('appContent.heading')} max={60}
                    es={step.title_es} en={step.title_en}
                    onEs={(v) => edit((d) => { d.rashan.steps[i].title_es = v; })}
                    onEn={(v) => edit((d) => { d.rashan.steps[i].title_en = v; })}
                  />
                  <BilingualRow
                    label={t('appContent.body')} long max={240}
                    es={step.body_es} en={step.body_en}
                    onEs={(v) => edit((d) => { d.rashan.steps[i].body_es = v; })}
                    onEn={(v) => edit((d) => { d.rashan.steps[i].body_en = v; })}
                  />
                </Card>
              ))}
              {draft.rashan.steps.length < 6 && (
                <button
                  type="button"
                  onClick={() => edit((d) => { d.rashan.steps.push({ title_es: '', title_en: '', body_es: '', body_en: '' }); })}
                  className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-dashed border-border text-sm font-semibold font-display text-gray hover:bg-surface-linen"
                >
                  <Plus className="w-4 h-4" strokeWidth={1.75} /> {t('appContent.addStep')}
                </button>
              )}
              {draft.rashan.faq.map((item, i) => (
                <Card
                  key={i}
                  title={`${t('appContent.question')} ${i + 1}`}
                  onRemove={() => edit((d) => { d.rashan.faq.splice(i, 1); })}
                >
                  <BilingualRow
                    label={t('appContent.question')} max={120}
                    es={item.q_es} en={item.q_en}
                    onEs={(v) => edit((d) => { d.rashan.faq[i].q_es = v; })}
                    onEn={(v) => edit((d) => { d.rashan.faq[i].q_en = v; })}
                  />
                  <BilingualRow
                    label={t('appContent.answer')} long max={600}
                    es={item.a_es} en={item.a_en}
                    onEs={(v) => edit((d) => { d.rashan.faq[i].a_es = v; })}
                    onEn={(v) => edit((d) => { d.rashan.faq[i].a_en = v; })}
                  />
                </Card>
              ))}
              {draft.rashan.faq.length < 12 && (
                <button
                  type="button"
                  onClick={() => edit((d) => { d.rashan.faq.push({ q_es: '', q_en: '', a_es: '', a_en: '' }); })}
                  className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-dashed border-border text-sm font-semibold font-display text-gray hover:bg-surface-linen"
                >
                  <Plus className="w-4 h-4" strokeWidth={1.75} /> {t('appContent.addQuestion')}
                </button>
              )}
            </>
          )}

          {tab === 'ribbon' && (
            <>
              <p className="text-sm font-body text-gray">{t('appContent.ribbonHint')}</p>
              {draft.ribbon.items.map((item, i) => (
                <Card
                  key={i}
                  title={`${t('appContent.tile')} ${i + 1}`}
                  onRemove={() => edit((d) => { d.ribbon.items.splice(i, 1); })}
                >
                  <Select
                    label={t('appContent.icon')}
                    value={item.icon}
                    onChange={(e) => edit((d) => { d.ribbon.items[i].icon = e.target.value as RibbonIcon; })}
                  >
                    {RIBBON_ICONS.map((ic) => <option key={ic} value={ic}>{ic}</option>)}
                  </Select>
                  <BilingualRow
                    label={t('appContent.heading')} max={30}
                    es={item.label_es} en={item.label_en}
                    onEs={(v) => edit((d) => { d.ribbon.items[i].label_es = v; })}
                    onEn={(v) => edit((d) => { d.ribbon.items[i].label_en = v; })}
                  />
                  <BilingualRow
                    label={t('appContent.subtitle2')} max={40}
                    es={item.sub_es} en={item.sub_en}
                    onEs={(v) => edit((d) => { d.ribbon.items[i].sub_es = v; })}
                    onEn={(v) => edit((d) => { d.ribbon.items[i].sub_en = v; })}
                  />
                </Card>
              ))}
              {draft.ribbon.items.length < 4 && (
                <button
                  type="button"
                  onClick={() => edit((d) => { d.ribbon.items.push({ icon: 'truck', label_es: '', label_en: '', sub_es: '', sub_en: '' }); })}
                  className="inline-flex items-center gap-2 h-11 px-4 rounded-xl border-2 border-dashed border-border text-sm font-semibold font-display text-gray hover:bg-surface-linen"
                >
                  <Plus className="w-4 h-4" strokeWidth={1.75} /> {t('appContent.addTile')}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmModal
        open={resetOpen}
        danger
        title={t('appContent.resetTitle')}
        message={t('appContent.resetMessage')}
        confirmLabel={t('appContent.reset')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          setResetOpen(false);
          reset.mutate(undefined, { onSuccess: () => setSaved(true) });
        }}
        onCancel={() => setResetOpen(false)}
      />
    </div>
  );
}
