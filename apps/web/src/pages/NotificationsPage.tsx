import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, BellOff, Settings, ShieldCheck } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useToast } from '@/components/Toast';

const STORAGE_KEY = 'cesto-push-enabled';

type BrowserPermission = 'default' | 'granted' | 'denied' | 'unsupported';

function readBrowserPermission(): BrowserPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as BrowserPermission;
}

function loadPref(): boolean {
  if (typeof localStorage === 'undefined') return true;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? true : raw === 'true';
}

const COPY = {
  es: {
    back: 'Volver',
    heading: 'Notificaciones',
    intro: 'Te avisaremos cuando tu pedido se confirme, esté en preparación, en camino y entregado. Solo lo importante — sin spam.',
    sectionTitle: 'Notificaciones push',
    sectionDesc: 'Recibe avisos en tiempo real sobre el estado de tus pedidos.',
    toggleEnabled: 'Activadas',
    toggleDisabled: 'Desactivadas',
    permissionRequest: 'Activar en el navegador',
    permissionGranted: 'Permiso del navegador concedido',
    permissionDenied: 'Permiso del navegador denegado',
    permissionUnsupported: 'Este navegador no admite notificaciones',
    softPromptTitle: 'Activa las notificaciones en los ajustes de tu navegador',
    softPromptDesc: 'Bloqueaste las notificaciones anteriormente. Para volver a activarlas, abre los ajustes del sitio en tu navegador y permite notificaciones para Cesto.',
    softPromptCta: 'Cómo activarlas',
    softPromptUnsupportedTitle: 'Tu navegador no admite notificaciones',
    softPromptUnsupportedDesc: 'Para recibir avisos al instante, instala la app móvil o usa un navegador compatible (Chrome, Firefox, Edge, Safari).',
    typesTitle: 'Lo que recibirás',
    types: [
      { title: 'Pedido confirmado', desc: 'Te confirmamos la franja de entrega.' },
      { title: 'Pedido en preparación', desc: 'Estamos preparando tu pedido.' },
      { title: 'Pedido en camino', desc: 'Tu repartidor ha salido con tu pedido.' },
      { title: 'Pedido entregado', desc: 'Tu pedido ha llegado.' },
      { title: 'Ofertas y promos', desc: 'Avisos puntuales de descuentos.' },
    ],
    savedToast: 'Preferencia guardada',
    enabledToastTitle: 'Notificaciones activadas',
    enabledToastBody: 'Te avisaremos sobre el estado de tus pedidos.',
    disabledToastTitle: 'Notificaciones desactivadas',
    disabledToastBody: 'Puedes volver a activarlas cuando quieras.',
    privacyNote: 'No vendemos tus datos. Solo enviamos avisos relacionados con tu actividad en Cesto.',
  },
  en: {
    back: 'Back',
    heading: 'Notifications',
    intro: "We'll let you know when your order is confirmed, being prepared, on its way and delivered. Only what matters — no spam.",
    sectionTitle: 'Push notifications',
    sectionDesc: 'Get real-time alerts about your order status.',
    toggleEnabled: 'Enabled',
    toggleDisabled: 'Disabled',
    permissionRequest: 'Enable in browser',
    permissionGranted: 'Browser permission granted',
    permissionDenied: 'Browser permission denied',
    permissionUnsupported: "This browser doesn't support notifications",
    softPromptTitle: 'Enable notifications in your browser settings',
    softPromptDesc: "You blocked notifications previously. To re-enable, open this site's settings in your browser and allow notifications for Cesto.",
    softPromptCta: 'How to enable',
    softPromptUnsupportedTitle: "Your browser doesn't support notifications",
    softPromptUnsupportedDesc: 'To get instant alerts, install the mobile app or use a supported browser (Chrome, Firefox, Edge, Safari).',
    typesTitle: "What you'll receive",
    types: [
      { title: 'Order confirmed', desc: "We've confirmed your delivery slot." },
      { title: 'Order being prepared', desc: 'Your order is being packed.' },
      { title: 'Order on the way', desc: "Your rider has left with your order." },
      { title: 'Order delivered', desc: 'Your order has arrived.' },
      { title: 'Offers & promos', desc: 'Occasional alerts about discounts.' },
    ],
    savedToast: 'Preference saved',
    enabledToastTitle: 'Notifications enabled',
    enabledToastBody: "We'll keep you posted on your order status.",
    disabledToastTitle: 'Notifications disabled',
    disabledToastBody: 'You can turn them back on whenever you like.',
    privacyNote: "We don't sell your data. We only send alerts related to your Cesto activity.",
  },
} as const;

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const t = COPY[lang];
  const toast = useToast();

  const [enabled, setEnabled] = useState<boolean>(true);
  const [permission, setPermission] = useState<BrowserPermission>('default');

  useEffect(() => {
    setEnabled(loadPref());
    setPermission(readBrowserPermission());
  }, []);

  const handleToggle = () => {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem(STORAGE_KEY, String(next));
    if (next) {
      toast.success(t.enabledToastTitle, t.enabledToastBody);
    } else {
      toast.info(t.disabledToastTitle, t.disabledToastBody);
    }
  };

  const handleRequestPermission = async () => {
    if (!('Notification' in window)) return;
    try {
      const result = await Notification.requestPermission();
      setPermission(result as BrowserPermission);
      if (result === 'granted') {
        toast.success(t.permissionGranted);
        setEnabled(true);
        localStorage.setItem(STORAGE_KEY, 'true');
      }
    } catch {
      // Some browsers throw on programmatic request — ignore.
    }
  };

  const showSoftPromptDenied = permission === 'denied';
  const showSoftPromptUnsupported = permission === 'unsupported';
  const showRequestButton = permission === 'default' && enabled;

  return (
    <div className="max-w-[720px] mx-auto px-6 lg:px-10 py-8">
      <button
        onClick={() => navigate('/profile')}
        className="flex items-center gap-2 text-sm font-semibold text-muted hover:text-brand transition-colors mb-6"
      >
        <ArrowLeft size={16} />
        {t.back}
      </button>

      <div className="flex items-center gap-3 mb-2">
        <Bell size={28} className="text-brand" strokeWidth={1.75} />
        <h1 className="text-3xl font-extrabold text-ink font-display">{t.heading}</h1>
      </div>
      <p className="text-sm text-gray font-body mb-8 leading-relaxed">{t.intro}</p>

      {/* Primary toggle card */}
      <section className="bg-card border border-border rounded-lg p-6 mb-5">
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${enabled ? 'bg-brand-mist text-brand' : 'bg-surface-sand text-muted'}`}>
            {enabled ? <Bell size={22} strokeWidth={1.75} /> : <BellOff size={22} strokeWidth={1.75} />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-extrabold text-ink font-display">{t.sectionTitle}</h2>
            <p className="text-xs text-gray font-body mt-1 leading-relaxed">{t.sectionDesc}</p>
            <p className="text-[11px] font-semibold uppercase tracking-wider mt-3 text-muted">
              {enabled ? t.toggleEnabled : t.toggleDisabled}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={handleToggle}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors shrink-0 ${
              enabled ? 'bg-brand' : 'bg-border'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-card shadow-sm transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {showRequestButton && (
          <button
            onClick={handleRequestPermission}
            className="mt-5 w-full h-11 rounded-xl bg-brand text-white font-display font-semibold text-sm hover:bg-brand-mid transition-colors"
          >
            {t.permissionRequest}
          </button>
        )}

        {permission === 'granted' && (
          <div className="mt-5 flex items-center gap-2 text-xs font-semibold text-brand">
            <ShieldCheck size={14} strokeWidth={1.75} />
            {t.permissionGranted}
          </div>
        )}
      </section>

      {/* Soft prompt — permission denied */}
      {showSoftPromptDenied && (
        <div className="bg-amber-mist border border-amber-mid/30 rounded-lg p-5 mb-5 flex items-start gap-3">
          <Settings size={20} strokeWidth={1.75} className="text-amber-deep shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold font-display text-amber-deep">{t.softPromptTitle}</p>
            <p className="text-xs text-charcoal font-body mt-1 leading-relaxed">{t.softPromptDesc}</p>
          </div>
        </div>
      )}

      {/* Unsupported */}
      {showSoftPromptUnsupported && (
        <div className="bg-info-bg border border-info/20 rounded-lg p-5 mb-5 flex items-start gap-3">
          <Settings size={20} strokeWidth={1.75} className="text-info shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold font-display text-info">{t.softPromptUnsupportedTitle}</p>
            <p className="text-xs text-charcoal font-body mt-1 leading-relaxed">{t.softPromptUnsupportedDesc}</p>
          </div>
        </div>
      )}

      {/* Notification types preview */}
      <section className="bg-card border border-border rounded-lg p-6 mb-5">
        <h3 className="text-sm font-extrabold text-ink font-display mb-4">{t.typesTitle}</h3>
        <ul className="flex flex-col gap-3">
          {t.types.map((row) => (
            <li key={row.title} className="flex items-start gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-brand mt-2 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-ink font-display">{row.title}</p>
                <p className="text-xs text-gray font-body">{row.desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[11px] text-muted font-body text-center leading-relaxed">{t.privacyNote}</p>
    </div>
  );
}
