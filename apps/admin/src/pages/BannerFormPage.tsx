import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGoBack } from '@/lib/useGoBack';
import { useTranslation } from 'react-i18next';
import {
  ArrowRight,
  Link as LinkIcon, Monitor, Save, Smartphone, Upload, X,
} from 'lucide-react';
import {
  useAdminBanners,
  useCreateBanner,
  useUpdateBanner,
  adminUploads,
  resolveImageUrl,
} from '@grocery-app/shared';
import type { Banner } from '@grocery-app/shared';
import { useToast } from '@/components/Toast';
import BackLink from '@/components/BackLink';
import { z } from 'zod';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';

// ── Form state ────────────────────────────────────────────

type Lang = 'en' | 'es';
type Device = 'desktop' | 'mobile';

interface BannerForm {
  eyebrow_en: string;
  eyebrow_es: string;
  title_en: string;
  title_es: string;
  subtitle_en: string;
  subtitle_es: string;
  cta_en: string;
  cta_es: string;
  show_eyebrow: boolean;
  background: string;
  text_theme: 'light' | 'dark';
  image_desktop: string;
  image_mobile: string;
  link_type: string;
  link_target: string;
  display_order: string;
  active_from: string;
  active_until: string;
  is_active: boolean;
}

const emptyForm: BannerForm = {
  eyebrow_en: '',
  eyebrow_es: '',
  title_en: '',
  title_es: '',
  subtitle_en: '',
  subtitle_es: '',
  cta_en: '',
  cta_es: '',
  show_eyebrow: false,
  background: '',
  text_theme: 'dark',
  image_desktop: '',
  image_mobile: '',
  link_type: 'none',
  link_target: '',
  display_order: '1',
  active_from: '',
  active_until: '',
  is_active: true,
};

function bannerToForm(b: Banner): BannerForm {
  return {
    eyebrow_en: b.eyebrow_en ?? '',
    eyebrow_es: b.eyebrow_es ?? '',
    title_en: b.title_en ?? '',
    title_es: b.title_es ?? '',
    subtitle_en: b.subtitle_en ?? '',
    subtitle_es: b.subtitle_es ?? '',
    cta_en: b.cta_en ?? '',
    cta_es: b.cta_es ?? '',
    show_eyebrow: b.show_eyebrow ?? false,
    background: b.background ?? '',
    text_theme: (b.text_theme as 'light' | 'dark') ?? 'dark',
    image_desktop: b.image_desktop,
    image_mobile: b.image_mobile,
    link_type: b.link_type ?? 'none',
    link_target: b.link_target ?? '',
    display_order: String(b.display_order),
    active_from: b.active_from ? b.active_from.slice(0, 10) : '',
    active_until: b.active_until ? b.active_until.slice(0, 10) : '',
    is_active: b.is_active,
  };
}

// ── Component ──────────────────────────────────────────────

export default function BannerFormPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const toast = useToast();
  const { bannerId } = useParams<{ bannerId: string }>();
  const editing = Boolean(bannerId);

  const { data: banners, isLoading: loadingList } = useAdminBanners();
  const createBanner = useCreateBanner();
  const updateBanner = useUpdateBanner();
  const isSaving = createBanner.isPending || updateBanner.isPending;

  const existing = useMemo(
    () => (editing ? banners?.find((b) => b.id === bannerId) ?? null : null),
    [banners, bannerId, editing],
  );

  const [form, setForm] = useState<BannerForm>(emptyForm);
  const [previewLang, setPreviewLang] = useState<Lang>('es');
  const [previewDevice, setPreviewDevice] = useState<Device>('desktop');
  const seeded = useRef(false);
  const messages = useValidationMessages();
  const [errors, setErrors] = useState<Partial<Record<keyof BannerForm, string>>>({});

  const schema = useMemo(() => {
    const r = rules(messages);
    return z
      .object({
        // Title is optional — the banner falls back to a generic label when blank.
        title_en:      r.optionalShortText(120),
        title_es:      r.optionalShortText(120),
        eyebrow_en:    r.optionalShortText(60),
        eyebrow_es:    r.optionalShortText(60),
        subtitle_en:   r.optionalShortText(200),
        subtitle_es:   r.optionalShortText(200),
        cta_en:        r.optionalShortText(40),
        cta_es:        r.optionalShortText(40),
        background:    z.string().trim(), // free-form CSS — admin's job to get it right
        image_desktop: r.url(),
        image_mobile:  r.url(),
        link_type:     z.string(),
        link_target:   z.string(),
        display_order: z.coerce.number().int().nonnegative(messages.positive),
        active_from:   z.string(),
        active_until:  z.string(),
      })
      .superRefine((data, ctx) => {
        // Cross-field date sanity: active_until must be after active_from when both set.
        if (data.active_from && data.active_until && data.active_until < data.active_from) {
          ctx.addIssue({
            path: ['active_until'],
            code: z.ZodIssueCode.custom,
            message: 'End date must be after start date.',
          });
        }
      });
  }, [messages]);

  useEffect(() => {
    if (!editing) {
      seeded.current = true;
      return;
    }
    if (existing && !seeded.current) {
      setForm(bannerToForm(existing));
      seeded.current = true;
    }
  }, [editing, existing]);

  function update<K extends keyof BannerForm>(field: K, value: BannerForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const next: Partial<Record<keyof BannerForm, string>> = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof BannerForm;
        if (k && !next[k]) next[k] = issue.message;
      }
      setErrors(next);
      toast.error('Please fix the highlighted fields.');
      return;
    }
    setErrors({});
    const orNull = (s: string) => (s.trim() ? s.trim() : null);
    const payload: Partial<Banner> = {
      eyebrow_en: orNull(form.eyebrow_en),
      eyebrow_es: orNull(form.eyebrow_es),
      title_en: form.title_en.trim(),
      title_es: form.title_es.trim(),
      subtitle_en: orNull(form.subtitle_en),
      subtitle_es: orNull(form.subtitle_es),
      cta_en: orNull(form.cta_en),
      cta_es: orNull(form.cta_es),
      show_eyebrow: form.show_eyebrow,
      background: orNull(form.background),
      text_theme: form.text_theme,
      image_desktop: form.image_desktop,
      image_mobile: form.image_mobile,
      link_type: form.link_type === 'none' ? null : (form.link_type as Banner['link_type']),
      link_target: form.link_type === 'none' ? null : (form.link_target || null),
      display_order: parseInt(form.display_order, 10) || 1,
      active_from: form.active_from ? new Date(form.active_from).toISOString() : null,
      active_until: form.active_until ? new Date(form.active_until).toISOString() : null,
      is_active: form.is_active,
    };
    try {
      if (editing && bannerId) {
        await updateBanner.mutateAsync({ id: bannerId, payload });
        toast.success('Banner updated.');
      } else {
        await createBanner.mutateAsync(payload);
        toast.success('Banner created.');
      }
      navigate('/banners');
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      toast.error('Could not save the banner.', msg);
    }
  }

  if (editing && loadingList) {
    return <div className="p-6 text-sm text-muted font-display">Loading…</div>;
  }
  if (editing && !loadingList && !existing) {
    return (
      <div className="p-6 space-y-3">
        <p className="text-sm text-danger font-display">Banner not found.</p>
        <button
          type="button"
          onClick={() => navigate('/banners')}
          className="h-10 px-4 rounded-xl text-sm font-semibold font-display border-2 border-border text-ink hover:bg-surface-linen"
        >
          Back to banners
        </button>
      </div>
    );
  }

  // ON A PHONE (2026-11-05): the page flows and scrolls as one. The fixed
  // height + two scroll areas exist for the side-by-side preview; stacked on
  // a phone they split the screen and left the form a ~200px window. The
  // header stacks too — back link, title, then Cancel / Save side by side —
  // where one row put two 44px buttons beside the title and overflowed.
  return (
    <div className="flex flex-col sm:h-[calc(100vh-7rem)]">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between shrink-0 mb-6">
        <BackLink
          label={t('common.backToBanners', 'Back to banners')}
          onClick={() => goBack('/banners')}
          className="mb-0 sm:mb-3"
        />
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-2xl font-bold font-display text-ink">
              {editing ? 'Edit banner' : 'New banner'}
            </h1>
            <p className="text-[12.5px] text-muted font-display mt-0.5">
              Upload the artwork and set the button. Preview on the right updates as you type.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => navigate('/banners')}
            disabled={isSaving}
            className="flex-1 sm:flex-none h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 sm:flex-none h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid transition flex items-center justify-center gap-2 disabled:opacity-70"
          >
            <Save size={15} strokeWidth={2} />
            {isSaving ? 'Saving…' : editing ? 'Save changes' : 'Create banner'}
          </button>
        </div>
      </div>

      {/* Split: form (scrolls) + preview (stays put) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)] gap-6 flex-1 min-h-0">
        {/* ── FORM (left — own scroll) ── */}
        <div className="space-y-6 sm:overflow-y-auto pr-3 -mr-3 pb-6 min-h-0">
          {/* Content */}
          <section className="bg-card rounded-xl border border-border p-5 space-y-4">
            <SectionTitle title="Content" subtitle="The storefront shows the artwork and this button — nothing else." />
            {/* Every text field except the button label is gone: eyebrow,
                title and subtitle. The home banner renders the image plus a
                single CTA, so none of it had anywhere left to appear.

                The database columns and every existing value are untouched —
                this removes inputs, not data — so nothing is lost if the
                design goes back to carrying copy.

                Dropping the title had two knock-on effects, both handled
                rather than left to rot:
                  - BannersPage labelled each row from title and would have
                    shown "—" for all of them. It now falls back to the button
                    text, then to a positional label, alongside the thumbnail
                    that already identifies the banner visually.
                  - The storefront <img> used title as its alt text. With the
                    copy gone the artwork is decorative and the CTA beside it
                    carries the label, so an empty alt is now the CORRECT
                    accessible pattern rather than a regression. */}
            <BiField
              label="Button text"
              en={form.cta_en}
              es={form.cta_es}
              onEn={(v) => update('cta_en', v)}
              onEs={(v) => update('cta_es', v)}
              placeholder="Shop now"
              errorEn={errors.cta_en}
              errorEs={errors.cta_es}
            />
          </section>

          {/* "Visual style" (background CSS + text theme) removed.
              Text theme chose the colour of the title, subtitle and eyebrow.
              None of those render any more, and the CTA is brand-filled at
              every theme, so the setting could no longer change anything on
              screen.
              Background is the colour behind the artwork. The banner image is
              full-bleed object-cover, so it is only ever visible if an image
              fails to load or has transparency — not worth a form section, and
              the stored value is still honoured as the card's background.
              Both columns remain in the database, untouched. */}

          {/* Imagery */}
          <section className="bg-card rounded-xl border border-border p-5 space-y-4">
            {/* The old advice here was ≥1600×600, which was the storage cap at
                the time — following it produced a banner that looked soft on
                any 2× screen, because it was upscaled to fill the width. The
                cap is 2560 now, so the advice has to ask for more than the
                screen needs, not exactly what it needs. */}
            <SectionTitle
              title="Imagery"
              subtitle="Upload the highest resolution you have — big images are resized down, small ones are not enlarged. Desktop: wide, at least 2560×960. Mobile: portrait, at least 1080×1440. Stored as WebP up to 2560px; 10 MB limit."
            />
            <BannerImageField
              label={t('banners.modal.desktopImage')}
              value={form.image_desktop}
              onChange={(v) => update('image_desktop', v)}
            />
            <BannerImageField
              label={t('banners.modal.mobileImage')}
              value={form.image_mobile}
              onChange={(v) => update('image_mobile', v)}
            />
          </section>

          {/* Link + targeting */}
          <section className="bg-card rounded-xl border border-border p-5 space-y-4">
            <SectionTitle title="Link & targeting" subtitle="Where the banner sends customers and who sees it." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('banners.modal.linkType')}>
                <select
                  value={form.link_type}
                  onChange={(e) => update('link_type', e.target.value)}
                  className="w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
                >
                  <option value="none">{t('banners.modal.none')}</option>
                  <option value="category">{t('banners.modal.category')}</option>
                  <option value="product">{t('banners.modal.product')}</option>
                  <option value="url">URL</option>
                </select>
              </Field>
              <Field label={t('banners.modal.linkTarget')}>
                <input
                  type="text"
                  value={form.link_target}
                  onChange={(e) => update('link_target', e.target.value)}
                  placeholder={t('banners.modal.linkTargetPlaceholder')}
                  disabled={form.link_type === 'none'}
                  className="w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition disabled:opacity-50"
                />
              </Field>
            </div>

          </section>

          {/* Schedule */}
          <section className="bg-card rounded-xl border border-border p-5 space-y-4">
            <SectionTitle title="Schedule & order" subtitle="Optional dates limit when the banner appears." />
            <Field label={t('banners.modal.displayOrder')}>
              <input
                type="number"
                min="1"
                value={form.display_order}
                onChange={(e) => update('display_order', e.target.value)}
                className="w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-body text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
              />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={t('banners.modal.activeFrom')}>
                <input
                  type="date"
                  value={form.active_from}
                  onChange={(e) => update('active_from', e.target.value)}
                  className="w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-body text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
                />
              </Field>
              <Field label={t('banners.modal.activeUntil')}>
                <input
                  type="date"
                  value={form.active_until}
                  onChange={(e) => update('active_until', e.target.value)}
                  className="w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-body text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
                />
              </Field>
            </div>
            <Row label={t('banners.modal.active')} hint="Hidden banners are never shown to customers, regardless of dates.">
              <Toggle value={form.is_active} onChange={(v) => update('is_active', v)} />
            </Row>
          </section>
        </div>

        {/* ── PREVIEW (right — stays put) ── */}
        <aside className="min-h-0 sm:overflow-y-auto">
          <div className="bg-card rounded-xl border border-border overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border bg-surface-cream/50">
              <div className="text-sm font-bold font-display text-ink">Live preview</div>
              <div className="flex items-center gap-2">
                <LangSwitch value={previewLang} onChange={setPreviewLang} />
                <DeviceSwitch value={previewDevice} onChange={setPreviewDevice} />
              </div>
            </div>
            <div className="p-4 bg-surface-linen">
              <BannerPreview form={form} lang={previewLang} device={previewDevice} />
              <p className="mt-3 text-[11px] text-muted font-display text-center">
                This mirrors how the banner appears on the customer home page.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Banner preview (mirrors web HeroCarousel single slide) ───

function pickLang(en: string | undefined | null, es: string | undefined | null, lang: Lang): string {
  const a = lang === 'en' ? en : es;
  const b = lang === 'en' ? es : en;
  return (a && a.trim()) || (b && b.trim()) || '';
}


function BannerPreview({ form, lang, device }: { form: BannerForm; lang: Lang; device: Device }) {
  const cta = pickLang(form.cta_en, form.cta_es, lang) || (lang === 'en' ? 'Shop now' : 'Comprar ahora');

  // Each surface previews the upload it will actually serve, so an admin can
  // see that the mobile crop works rather than assuming the desktop one stands
  // in for it.
  const image = device === 'desktop' ? form.image_desktop : form.image_mobile;
  const resolved = image ? resolveImageUrl(image, 'banner') : null;

  const bg = form.background?.trim() || '#F5F0E8';
  const isDesktop = device === 'desktop';

  return (
    <div className="mx-auto" style={{ maxWidth: isDesktop ? '100%' : 320 }}>
      <div
        className="relative rounded-lg overflow-hidden border border-border"
        /* Desktop mirrors web's fixed 230px; mobile is 2:1, which is both the
           web card at phone widths and the app card's aspectRatio. */
        style={{ background: bg, height: isDesktop ? 230 : 160 }}
      >
        {resolved
          ? <img src={resolved} alt="" className="absolute inset-0 w-full h-full object-cover" />
          : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[12px] font-display text-muted">
                {lang === 'en'
                  ? `No ${isDesktop ? 'desktop' : 'mobile'} image uploaded`
                  : `Sin imagen ${isDesktop ? 'de escritorio' : 'móvil'}`}
              </span>
            </div>
          )}

        {/* Artwork and a button, bottom-left — the whole of what ships.
            Eyebrow, title and subtitle used to render here and no longer do;
            a preview that shows copy the storefront drops is worse than no
            preview, because it is believed. pb-8 clears the dots below. */}
        <div className="absolute inset-0 flex items-end justify-start px-4 pb-8">
          <div
            className="inline-flex items-center gap-2 h-8 px-4 rounded-full text-[12px] font-bold font-ui"
            style={{ background: '#054EE8', color: '#FFFFFF' }}
          >
            {cta}
            <ArrowRight size={13} strokeWidth={2.5} />
          </div>
        </div>

        {/* Dots only. The real hero dropped its prev/next arrows a while back,
            and the preview was still drawing them. */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 pointer-events-none">
          <span className="w-5 h-1.5 rounded-full bg-card drop-shadow-[0_1px_2px_rgba(15,23,42,0.5)]" />
          <span className="w-1.5 h-1.5 rounded-full bg-white/55 drop-shadow-[0_1px_2px_rgba(15,23,42,0.5)]" />
          <span className="w-1.5 h-1.5 rounded-full bg-white/55 drop-shadow-[0_1px_2px_rgba(15,23,42,0.5)]" />
        </div>
      </div>
    </div>
  );
}


// ── Form primitives ───────────────────────────────────────

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header>
      <h2 className="text-sm font-bold font-display text-ink">{title}</h2>
      {subtitle && <p className="text-[12px] text-muted font-display mt-0.5">{subtitle}</p>}
    </header>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold font-display text-ink mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg bg-surface-cream border border-border px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-semibold font-display text-ink">{label}</div>
        {hint && <div className="text-[11px] text-muted font-display mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      // shrink-0 so a long label never squeezes it; below sm an invisible
      // ::before makes the tap area 36px tall without changing the look
      // (2026-11-05).
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors before:absolute before:-inset-x-1 before:-inset-y-1.5 sm:before:hidden ${
        value ? 'bg-brand' : 'bg-border'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-card transition-transform ${
          value ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

function BiField({
  label, en, es, onEn, onEs, placeholder, multiline = false, errorEn, errorEs,
}: {
  label: string;
  en: string;
  es: string;
  onEn: (v: string) => void;
  onEs: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  errorEn?: string;
  errorEs?: string;
}) {
  const inputCls =
    'w-full bg-surface-cream border rounded-lg px-3 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 transition';
  const ring = (err?: string) =>
    err
      ? 'border-danger focus:ring-danger/20 focus:border-danger'
      : 'border-border focus:ring-brand/30 focus:border-brand';
  return (
    <div>
      <label className="block text-sm font-semibold font-display text-ink mb-1.5">{label}</label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted font-display block mb-1">EN</span>
          {multiline ? (
            <textarea value={en} onChange={(e) => onEn(e.target.value)} placeholder={placeholder} rows={2}
              aria-invalid={!!errorEn}
              className={`${inputCls} py-2 resize-none ${ring(errorEn)}`} />
          ) : (
            <input type="text" value={en} onChange={(e) => onEn(e.target.value)} placeholder={placeholder}
              aria-invalid={!!errorEn}
              className={`${inputCls} h-10 ${ring(errorEn)}`} />
          )}
          {errorEn && (
            <p role="alert" className="mt-1 text-[11.5px] text-danger font-display font-medium">{errorEn}</p>
          )}
        </div>
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted font-display block mb-1">ES</span>
          {multiline ? (
            <textarea value={es} onChange={(e) => onEs(e.target.value)} placeholder={placeholder} rows={2}
              aria-invalid={!!errorEs}
              className={`${inputCls} py-2 resize-none ${ring(errorEs)}`} />
          ) : (
            <input type="text" value={es} onChange={(e) => onEs(e.target.value)} placeholder={placeholder}
              aria-invalid={!!errorEs}
              className={`${inputCls} h-10 ${ring(errorEs)}`} />
          )}
          {errorEs && (
            <p role="alert" className="mt-1 text-[11.5px] text-danger font-display font-medium">{errorEs}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function LangSwitch({ value, onChange }: { value: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden text-[11px] font-semibold font-display">
      {(['es', 'en'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          className={`h-9 sm:h-auto px-2.5 py-1 ${value === l ? 'bg-ink text-card' : 'bg-card text-gray hover:bg-surface-linen'}`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function DeviceSwitch({ value, onChange }: { value: Device; onChange: (d: Device) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden text-[11px] font-semibold font-display">
      <button
        type="button"
        onClick={() => onChange('desktop')}
        className={`h-9 sm:h-auto px-2.5 py-1 flex items-center gap-1 ${value === 'desktop' ? 'bg-ink text-card' : 'bg-card text-gray hover:bg-surface-linen'}`}
      >
        <Monitor size={12} strokeWidth={2} /> Desktop
      </button>
      <button
        type="button"
        onClick={() => onChange('mobile')}
        className={`h-9 sm:h-auto px-2.5 py-1 flex items-center gap-1 ${value === 'mobile' ? 'bg-ink text-card' : 'bg-card text-gray hover:bg-surface-linen'}`}
      >
        <Smartphone size={12} strokeWidth={2} /> Mobile
      </button>
    </div>
  );
}

// ── Image picker (URL or upload) ──────────────────────────

function BannerImageField({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'url' | 'file'>('url');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    setError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('File must be an image.');
      return;
    }
    setUploading(true);
    try {
      const res = await adminUploads.uploadImage('banners', file);
      onChange(res.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-sm font-semibold font-display text-ink">{label}</label>
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-[11px] font-semibold font-display">
          <button
            type="button"
            onClick={() => setMode('url')}
            className={`h-9 sm:h-auto px-2.5 py-1 flex items-center gap-1 ${
              mode === 'url' ? 'bg-brand text-white' : 'bg-card text-gray hover:bg-surface-linen'
            }`}
          >
            <LinkIcon size={11} strokeWidth={2.25} /> URL
          </button>
          <button
            type="button"
            onClick={() => setMode('file')}
            className={`h-9 sm:h-auto px-2.5 py-1 flex items-center gap-1 ${
              mode === 'file' ? 'bg-brand text-white' : 'bg-card text-gray hover:bg-surface-linen'
            }`}
          >
            <Upload size={11} strokeWidth={2.25} /> Upload
          </button>
        </div>
      </div>

      {mode === 'url' ? (
        <input
          type="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://..."
          className="w-full bg-surface-cream border border-border rounded-lg h-11 px-4 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
        />
      ) : (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFile(e.dataTransfer.files?.[0] ?? null);
          }}
          className="flex items-center gap-3 bg-surface-cream border border-dashed border-border rounded-lg p-3"
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="h-9 px-3 rounded-lg text-xs font-semibold font-display border-2 border-brand text-brand hover:bg-brand-mist transition flex items-center gap-1.5 shrink-0 disabled:opacity-60 disabled:cursor-wait"
          >
            <Upload size={13} strokeWidth={2} />
            {uploading ? 'Uploading…' : 'Choose file'}
          </button>
          <span className="text-xs text-muted font-display flex-1 truncate">
            {value ? 'Image set · drop another to replace' : 'or drag & drop here'}
          </span>
        </div>
      )}

      {value && (
        <div className="mt-2 flex items-center gap-3">
          <div className="w-14 h-14 rounded-lg overflow-hidden border border-border bg-surface-cream shrink-0">
            <img src={resolveImageUrl(value, 'hero')} alt="" className="w-full h-full object-cover" />
          </div>
          <span className="text-[11px] text-muted font-display flex-1 truncate">{value}</span>
          <button
            type="button"
            onClick={() => onChange('')}
            className="w-9 h-9 sm:w-auto sm:h-auto sm:p-1.5 inline-flex items-center justify-center shrink-0 rounded-lg hover:bg-surface-linen text-muted hover:text-danger transition"
            aria-label="Remove image"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-danger font-display">{error}</p>}
    </div>
  );
}
