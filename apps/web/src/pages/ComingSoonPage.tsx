import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';

interface Props {
  /** Icon shown inside the hero badge. */
  icon: LucideIcon;
  /** Tier-2 nav label used in <title> and headline. Provide both locales. */
  title: { es: string; en: string };
  /** Sub-headline that explains what the section will be. */
  subtitle: { es: string; en: string };
  /** Optional accent tint applied to the badge + chip. Defaults to brand green. */
  accent?: 'brand' | 'amber' | 'leaf';
}

const COPY = {
  es: {
    badge: 'PRÓXIMAMENTE',
    body: 'Estamos cocinando algo muy bueno. Te avisaremos en cuanto esté disponible.',
    notifyTitle: '¿Quieres ser de los primeros?',
    notifyBody: 'Activa las notificaciones desde tu perfil y te avisaremos al lanzamiento.',
    back: 'Volver',
    explore: 'Mientras tanto, explorar catálogo',
  },
  en: {
    badge: 'COMING SOON',
    body: "We're cooking up something good. We'll let you know the moment it's live.",
    notifyTitle: 'Want to be first?',
    notifyBody: "Turn on notifications from your profile and we'll ping you at launch.",
    back: 'Back',
    explore: 'Browse the catalogue while you wait',
  },
} as const;

const ACCENT_CLASSES: Record<NonNullable<Props['accent']>, { badge: string; chip: string; ring: string }> = {
  brand: {
    badge: 'bg-brand-mist text-brand',
    chip:  'bg-brand text-white',
    ring:  'ring-brand/30',
  },
  amber: {
    badge: 'bg-amber-mist text-amber-deep',
    chip:  'bg-amber-deep text-white',
    ring:  'ring-amber/30',
  },
  leaf: {
    badge: 'bg-success-bg text-success',
    chip:  'bg-success text-white',
    ring:  'ring-success/30',
  },
};

export default function ComingSoonPage({ icon: Icon, title, subtitle, accent = 'brand' }: Props) {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const t = COPY[lang];
  const tone = ACCENT_CLASSES[accent];

  return (
    <div className="max-w-[1100px] mx-auto px-4 lg:px-6 py-10">
      {/* Back link */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-[13px] font-ui font-medium text-gray hover:text-ink transition-colors mb-6"
      >
        <ArrowLeft size={15} strokeWidth={2} />
        {t.back}
      </button>

      {/* Hero */}
      <section className="bg-card border border-border rounded-2xl shadow-card overflow-hidden">
        <div className="px-6 sm:px-10 py-10 sm:py-14 flex flex-col items-center text-center">
          <div className={`w-20 h-20 rounded-2xl ${tone.badge} flex items-center justify-center mb-5 ring-8 ${tone.ring}`}>
            <Icon size={32} strokeWidth={1.75} />
          </div>

          <span className={`inline-flex items-center gap-1.5 ${tone.chip} px-3 py-1 rounded-full text-[10.5px] font-extrabold font-ui tracking-[0.18em] mb-4`}>
            <Sparkles size={11} strokeWidth={2.5} />
            {t.badge}
          </span>

          <h1 className="text-3xl sm:text-4xl font-display font-bold text-ink leading-tight mb-3">
            {title[lang]}
          </h1>
          <p className="max-w-[540px] text-[14.5px] text-gray font-body leading-relaxed mb-2">
            {subtitle[lang]}
          </p>
          <p className="max-w-[540px] text-[13.5px] text-muted font-body leading-relaxed">
            {t.body}
          </p>
        </div>

        <div className="bg-surface-cream border-t border-border px-6 sm:px-10 py-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-card flex items-center justify-center shrink-0 border border-border">
            <Bell size={18} strokeWidth={1.75} className="text-ink" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13.5px] font-ui font-semibold text-ink">{t.notifyTitle}</p>
            <p className="text-[12.5px] text-gray font-body mt-0.5">{t.notifyBody}</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/categories')}
            className="h-11 px-5 rounded-xl text-[13px] font-ui font-semibold bg-brand text-white hover:bg-brand-deepest transition-colors shrink-0"
          >
            {t.explore}
          </button>
        </div>
      </section>
    </div>
  );
}
