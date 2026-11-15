import { Outlet, useNavigate } from 'react-router-dom';
import { Globe, Check, ChevronDown, ArrowLeft, Truck, Sparkles, Wallet } from 'lucide-react';
import { useLanguageStore, type Language } from '@/stores/languageStore';
import { useEffect, useRef, useState } from 'react';
import FloatingActions from '@/components/FloatingActions';
import { useApplyShopTheme, useShopTheme } from '@/lib/shopTheme';

const languages: { code: Language; label: string; flag: string }[] = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];

/* ═══════════════════════════════════════════════════════
   LEFT PANEL — Brand showcase (desktop only)
   ═══════════════════════════════════════════════════════ */
function BrandPanel() {
  const { t } = useLanguageStore();
  const navigate = useNavigate();

  const features = [
    { icon: Truck, title: t('auth.panel.feature1.title'), desc: t('auth.panel.feature1.desc') },
    { icon: Sparkles, title: t('auth.panel.feature2.title'), desc: t('auth.panel.feature2.desc') },
    { icon: Wallet, title: t('auth.panel.feature3.title'), desc: t('auth.panel.feature3.desc') },
  ];

  return (
    <div className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-gradient-to-br from-hero-1 via-hero-2 to-hero-3 text-white p-12 xl:p-16">
      {/* Decorative circles */}
      <div className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full bg-white/5 blur-3xl" />
      <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-amber/20 blur-3xl" />

      {/* Dot pattern */}
      <div
        className="absolute inset-0 opacity-[0.08]"
        style={{
          backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Floating emoji decorations */}
      <span className="absolute top-[12%] right-[18%] text-5xl opacity-25 rotate-12 animate-pulse-slow">🌶️</span>
      <span className="absolute top-[38%] right-[8%] text-4xl opacity-20 -rotate-6">🍚</span>
      <span className="absolute bottom-[22%] right-[22%] text-5xl opacity-25 rotate-6">🫒</span>
      <span className="absolute top-[60%] left-[6%] text-4xl opacity-20 -rotate-12">🌾</span>
      <span className="absolute bottom-[8%] left-[35%] text-4xl opacity-20 rotate-12">🍵</span>

      {/* Logo — clicks back to home */}
      <button
        type="button"
        onClick={() => navigate('/')}
        aria-label="Cesto"
        className="relative z-10 flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-amber rounded-xl"
      >
        <img
          src="/cesto-icon.png"
          alt=""
          className="w-11 h-11 rounded-xl shadow-md ring-1 ring-white/20 group-hover:scale-[1.04] transition-transform"
          draggable={false}
        />
        <span className="font-display text-2xl text-white tracking-tight" style={{ fontWeight: 600 }}>Cesto</span>
      </button>

      {/* Top badge */}
      <div className="relative z-10">
        <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-full px-4 py-2 border border-white/20">
          <Sparkles size={14} strokeWidth={2} className="text-amber-mist" />
          <span className="text-[10.5px] font-bold font-ui uppercase tracking-[0.16em]">
            {t('auth.panel.badge')}
          </span>
        </div>
      </div>

      {/* Center content */}
      <div className="relative z-10 flex flex-col gap-8 py-8">
        <h2 className="font-display text-[34px] xl:text-[42px] leading-[1.05] tracking-tight whitespace-pre-line" style={{ fontWeight: 600 }}>
          {t('auth.panel.headline')}
        </h2>
        <p className="text-[15px] xl:text-[16px] text-white/80 font-body leading-relaxed max-w-md">
          {t('auth.panel.subheadline')}
        </p>

        {/* Feature list */}
        <div className="flex flex-col gap-4 mt-2">
          {features.map((f, i) => (
            <div key={i} className="flex items-start gap-4">
              <div className="w-11 h-11 rounded-xl bg-white/15 backdrop-blur-sm border border-white/20 flex items-center justify-center shrink-0">
                <f.icon size={20} strokeWidth={1.75} className="text-white" />
              </div>
              <div className="flex-1 pt-1">
                <p className="text-[13.5px] font-bold font-ui">{f.title}</p>
                <p className="text-xs text-white/70 font-body mt-0.5 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   MAIN LAYOUT
   ═══════════════════════════════════════════════════════ */
export default function AuthLayout() {
  const navigate = useNavigate();
  // The shop's light or dark, as on every shop page (lib/shopTheme).
  useApplyShopTheme(useShopTheme().resolved);
  const { lang, setLang, t } = useLanguageStore();
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentLang = languages.find((l) => l.code === lang)!;

  return (
    <div className="min-h-screen bg-surface-linen grid grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
      {/* ─── Left: Brand Panel (desktop only) ─── */}
      <BrandPanel />

      {/* ─── Right: Form Area ─── */}
      <div className="relative flex flex-col min-h-screen">
        {/* Top bar: back home + language */}
        <div className="flex items-center justify-between px-6 lg:px-10 pt-6">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-sm font-bold font-ui text-charcoal hover:text-brand transition-colors group"
          >
            <div className="w-9 h-9 rounded-full bg-surface-white border border-border/60 flex items-center justify-center group-hover:border-brand group-hover:bg-brand-mist transition-all">
              <ArrowLeft size={16} strokeWidth={2} />
            </div>
            <span className="hidden sm:inline">{t('auth.back_home')}</span>
          </button>

          {/* Language dropdown */}
          <div className="relative" ref={langRef}>
            <button
              onClick={() => setLangOpen(!langOpen)}
              className="flex items-center gap-1.5 h-9 px-3 rounded-full bg-surface-white border border-border/60 hover:border-brand-soft transition-colors"
            >
              <Globe size={14} strokeWidth={1.75} className="text-charcoal" />
              <span className="text-xs font-bold font-ui text-ink">{currentLang.flag} {lang.toUpperCase()}</span>
              <ChevronDown size={11} className={`text-muted transition-transform ${langOpen ? 'rotate-180' : ''}`} />
            </button>
            {langOpen && (
              <div className="absolute right-0 top-11 z-50 bg-surface-white rounded-xl shadow-float border border-border py-2 min-w-[180px]">
                {languages.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => { setLang(l.code); setLangOpen(false); }}
                    className={`w-full text-left px-4 py-2.5 text-sm font-display flex items-center gap-3 transition-colors ${
                      lang === l.code ? 'text-brand font-semibold bg-brand-mist' : 'text-ink hover:bg-surface-linen'
                    }`}
                  >
                    <span className="text-lg">{l.flag}</span>
                    <span className="flex-1">{l.label}</span>
                    {lang === l.code && <Check size={14} strokeWidth={3} className="text-brand" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Mobile-only logo. Wordmark PNG has heavy internal whitespace, so
            the container stays compact and the image is zoomed to crop the
            padding around the "cesto" mark. */}
        <div className="lg:hidden flex items-center justify-center pt-6">
          <button
            onClick={() => navigate('/')}
            aria-label="Cesto"
            className="group inline-flex items-center justify-center h-16 w-48 overflow-hidden"
          >
            <img
              src="/cesto-wordmark.png"
              alt="Cesto"
              className="h-full w-auto scale-[2.4] group-hover:scale-[2.5] transition-transform"
              draggable={false}
            />
          </button>
        </div>

        {/* Form slot */}
        <main className="flex-1 flex items-center justify-center px-6 py-10 lg:py-12">
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="px-6 lg:px-10 pb-6 text-center">
          <p className="text-xs text-muted font-body">{t('footer.copyright')}</p>
        </footer>
      </div>

      {/* Signing in is where people get stuck, so WhatsApp is here too —
          without a cart or a tab bar to stack with. */}
      <FloatingActions cart={false} tabBar={false} />
    </div>
  );
}
