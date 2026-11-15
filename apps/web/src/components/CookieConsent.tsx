import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie, Settings2, X, ShieldCheck, BarChart3, Megaphone, Check } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { usePreviewModeStore } from '@/stores/previewModeStore';
import {
  useCookieConsentStore,
  useConsentDecided,
  type OptionalCookieCategory,
} from '@/stores/cookieConsentStore';

/* ═══════════════════════════════════════════════════════
   Cookie consent — bottom banner + preferences dialog.

   Layout follows the reference: cookie mark on the left, the two
   decisions as pills in the middle, settings gear on the right, and the
   explainer underneath. Palette / type / radii are ours — a cream card on
   the linen canvas rather than a black slab, so it reads as part of the
   shop instead of a browser chrome bar.

   Reject and Accept carry equal visual weight on purpose. Making "reject"
   a faint text link next to a bright "accept" button is the pattern the
   AEPD has been fining for; the two pills are the same size and sit side
   by side, with only the fill distinguishing them.
   ═══════════════════════════════════════════════════════ */

export default function CookieConsent() {
  const { lang } = useLanguageStore();
  const decided = useConsentDecided();
  const settingsOpen = useCookieConsentStore((s) => s.settingsOpen);
  const acceptAll = useCookieConsentStore((s) => s.acceptAll);
  const rejectAll = useCookieConsentStore((s) => s.rejectAll);
  const openSettings = useCookieConsentStore((s) => s.openSettings);
  const isPreview = usePreviewModeStore((s) => s.isPartnerPreview);

  // Slide the banner in a beat after mount. Without it the bar is painted
  // in the first frame and reads as part of the page furniture.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (decided) return;
    const id = window.setTimeout(() => setShown(true), 550);
    return () => window.clearTimeout(id);
  }, [decided]);

  // A partner previewing their own storefront is not a shopper being
  // tracked, and the bar would cover the products they came to check.
  if (isPreview) return null;

  const bannerVisible = !decided;

  return (
    <>
      {bannerVisible && (
        <div
          role="region"
          aria-label={lang === 'en' ? 'Cookie consent' : 'Consentimiento de cookies'}
          className={`fixed inset-x-0 bottom-0 z-[60] px-0 sm:px-4 sm:pb-4 transition-all duration-500 ease-out ${
            shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0 pointer-events-none'
          }`}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="mx-auto w-full sm:max-w-[1040px] bg-surface-cream border-t sm:border border-border rounded-none sm:rounded-2xl shadow-float px-4 sm:px-6 py-4 sm:py-5">
            {/* Row 1 — mark · decisions · settings */}
            <div className="flex items-center gap-3 sm:gap-4">
              {/* Dropped on the narrowest phones so the two decisions keep
                  their full width — the mark is decoration, they are not. */}
              <span
                aria-hidden
                className="hidden min-[380px]:flex shrink-0 w-11 h-11 rounded-full bg-brand-whisper border border-brand-mist items-center justify-center"
              >
                <Cookie size={20} strokeWidth={1.75} className="text-brand" />
              </span>

              <div className="flex-1 flex items-center justify-center gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={rejectAll}
                  className="flex-1 sm:flex-none sm:min-w-[190px] min-h-[52px] px-6 rounded-xl border border-border bg-card text-ink text-[14.5px] font-ui font-bold hover:border-brand hover:bg-brand-whisper hover:text-brand-ink active:scale-[0.99] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-mid focus-visible:ring-offset-2"
                >
                  {lang === 'en' ? 'Reject all' : 'Rechazar todo'}
                </button>
                <button
                  type="button"
                  onClick={acceptAll}
                  className="flex-1 sm:flex-none sm:min-w-[190px] min-h-[52px] px-6 rounded-xl bg-brand text-white text-[14.5px] font-ui font-bold shadow-brand hover:bg-brand-mid active:scale-[0.99] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-mid focus-visible:ring-offset-2"
                >
                  {lang === 'en' ? 'Accept cookies' : 'Aceptar cookies'}
                </button>
              </div>

              <button
                type="button"
                onClick={openSettings}
                aria-label={lang === 'en' ? 'Cookie settings' : 'Configurar cookies'}
                className="shrink-0 w-11 h-11 rounded-full border border-border bg-card flex items-center justify-center text-gray hover:text-brand-ink hover:border-brand hover:bg-brand-whisper transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-mid focus-visible:ring-offset-2"
              >
                <Settings2 size={18} strokeWidth={1.75} />
              </button>
            </div>

            {/* Row 2 — explainer */}
            <p className="mt-3 sm:mt-3.5 text-center text-[12.5px] sm:text-[13px] leading-relaxed font-body text-gray">
              {lang === 'en'
                ? 'We use our own and third-party cookies to keep your session and cart working, remember your preferences, and measure how the shop is used. '
                : 'Usamos cookies propias y de terceros para mantener tu sesión y tu carrito, recordar tus preferencias y medir el uso de la tienda. '}
              <Link
                to="/privacy"
                className="text-brand font-ui font-semibold underline underline-offset-2 hover:text-brand-ink transition-colors"
              >
                {lang === 'en' ? 'Cookie policy' : 'Política de cookies'}
              </Link>
              .
            </p>
          </div>
        </div>
      )}

      {settingsOpen && <CookiePreferences />}
    </>
  );
}

/* ───────────────────────────────────────────────────────
   Preferences — per-category opt in. Reachable from the banner's gear
   and from the footer, so consent can be withdrawn as easily as given.
   ─────────────────────────────────────────────────────── */
function CookiePreferences() {
  const { lang } = useLanguageStore();
  const closeSettings = useCookieConsentStore((s) => s.closeSettings);
  const savePrefs = useCookieConsentStore((s) => s.savePrefs);
  const acceptAll = useCookieConsentStore((s) => s.acceptAll);
  const stored = useCookieConsentStore((s) => s.prefs);

  const [draft, setDraft] = useState<Record<OptionalCookieCategory, boolean>>({
    analytics: stored.analytics,
    marketing: stored.marketing,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeSettings]);

  const rows = [
    {
      key: 'necessary' as const,
      icon: ShieldCheck,
      title: lang === 'en' ? 'Strictly necessary' : 'Estrictamente necesarias',
      desc:
        lang === 'en'
          ? 'Sign-in, cart, delivery address and language. The shop cannot work without them, so they are always on.'
          : 'Inicio de sesión, carrito, dirección de entrega e idioma. La tienda no funciona sin ellas, por eso están siempre activas.',
      locked: true,
    },
    {
      key: 'analytics' as const,
      icon: BarChart3,
      title: lang === 'en' ? 'Analytics' : 'Analíticas',
      desc:
        lang === 'en'
          ? 'Which pages and products get used, so we know what to fix. Aggregated, never sold.'
          : 'Qué páginas y productos se usan, para saber qué mejorar. Datos agregados, nunca se venden.',
      locked: false,
    },
    {
      key: 'marketing' as const,
      icon: Megaphone,
      title: lang === 'en' ? 'Marketing' : 'Marketing',
      desc:
        lang === 'en'
          ? 'Lets us show you offers that match what you buy, on Cesto and elsewhere.'
          : 'Nos permite mostrarte ofertas acordes a lo que compras, en Cesto y fuera de Cesto.',
      locked: false,
    },
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center sm:justify-center">
      <div
        className="absolute inset-0 bg-veil/45 backdrop-blur-[2px]"
        onClick={closeSettings}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={lang === 'en' ? 'Cookie settings' : 'Configuración de cookies'}
        className="relative w-full sm:max-w-[520px] max-h-[88vh] sm:max-h-[80vh] bg-surface-cream rounded-t-2xl sm:rounded-2xl shadow-float flex flex-col"
      >
        <div className="shrink-0 flex items-start gap-3 p-4 sm:p-5 border-b border-border">
          <span
            aria-hidden
            className="shrink-0 w-10 h-10 rounded-full bg-brand-whisper border border-brand-mist flex items-center justify-center"
          >
            <Cookie size={18} strokeWidth={1.75} className="text-brand" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[16px] text-ink tracking-tight" style={{ fontWeight: 700 }}>
              {lang === 'en' ? 'Cookie settings' : 'Configuración de cookies'}
            </h2>
            <p className="text-[12px] text-gray font-body mt-0.5">
              {lang === 'en'
                ? 'Choose what you allow. You can change this at any time from the footer.'
                : 'Elige qué permites. Puedes cambiarlo cuando quieras desde el pie de página.'}
            </p>
          </div>
          <button
            type="button"
            onClick={closeSettings}
            aria-label={lang === 'en' ? 'Close' : 'Cerrar'}
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-gray hover:text-ink hover:bg-surface-sand transition-colors"
          >
            <X size={17} strokeWidth={2.25} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-2.5">
          {rows.map((row) => {
            const Icon = row.icon;
            const on = row.locked ? true : draft[row.key as OptionalCookieCategory];
            return (
              <div
                key={row.key}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-3.5"
              >
                <Icon size={18} strokeWidth={1.75} className="shrink-0 mt-0.5 text-brand" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13.5px] font-ui font-bold text-ink">{row.title}</p>
                    {row.locked && (
                      <span className="text-[10px] font-ui font-bold uppercase tracking-[0.12em] text-gray bg-surface-sand border border-border rounded px-1.5 py-0.5">
                        {lang === 'en' ? 'Always on' : 'Siempre activas'}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed font-body text-gray">{row.desc}</p>
                </div>

                <Toggle
                  on={on}
                  locked={row.locked}
                  label={row.title}
                  onChange={(next) =>
                    setDraft((d) => ({ ...d, [row.key as OptionalCookieCategory]: next }))
                  }
                />
              </div>
            );
          })}
        </div>

        <div
          className="shrink-0 flex flex-col-reverse sm:flex-row gap-2.5 p-3 sm:p-4 border-t border-border"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          <button
            type="button"
            onClick={() => savePrefs(draft)}
            className="flex-1 min-h-[52px] px-5 rounded-xl border border-border bg-card text-ink text-[14.5px] font-ui font-bold hover:border-brand hover:bg-brand-whisper hover:text-brand-ink active:scale-[0.99] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-mid focus-visible:ring-offset-2"
          >
            {lang === 'en' ? 'Save my choices' : 'Guardar mi elección'}
          </button>
          <button
            type="button"
            onClick={acceptAll}
            className="flex-1 min-h-[52px] px-5 rounded-xl bg-brand text-white text-[14.5px] font-ui font-bold shadow-brand hover:bg-brand-mid active:scale-[0.99] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-mid focus-visible:ring-offset-2"
          >
            {lang === 'en' ? 'Accept all' : 'Aceptar todo'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  on,
  locked,
  label,
  onChange,
}: {
  on: boolean;
  locked?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={locked}
      onClick={() => !locked && onChange(!on)}
      className={`shrink-0 mt-0.5 relative w-[44px] h-[26px] rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-mid focus-visible:ring-offset-2 ${
        on ? 'bg-brand' : 'bg-surface-sand border border-border'
      } ${locked ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 w-[20px] h-[20px] rounded-full bg-card shadow-card transition-all duration-200 flex items-center justify-center ${
          on ? 'left-[21px]' : 'left-[2px]'
        }`}
      >
        {on && <Check size={12} strokeWidth={3} className="text-brand" />}
      </span>
    </button>
  );
}
