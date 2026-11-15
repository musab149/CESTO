import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search, MessageCircle, ArrowUpRight, Sparkles, Package, CreditCard,
  RotateCcw, ShoppingBag, FileText, Lock, Store, FolderOpen, HelpCircle,
  Truck, ShieldCheck, Wallet, Settings, Edit3, Smile, type LucideIcon,
  LifeBuoy,
} from 'lucide-react';
import { useHelpCenter } from '@grocery-app/shared';
import type { HelpCategory } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';

/* ─────────────────────────────────────────────────────────
   "Concierge corner" Help Center
   Editorial, type-led, asymmetric. Categories stack as
   numbered editorial sections (01 — title, intro, 2-col
   article list, faded icon anchor) instead of a Walmart
   3-col bordered card grid.
   ───────────────────────────────────────────────────────── */

const ICON_MAP: Record<string, LucideIcon> = {
  Sparkles, Package, CreditCard, RotateCcw, ShoppingBag,
  FileText, Lock, Store, FolderOpen, HelpCircle, Truck,
  ShieldCheck, Wallet, MessageCircle, Settings, Edit3, Smile,
};

function iconFor(name: string | null | undefined): LucideIcon {
  if (name && ICON_MAP[name]) return ICON_MAP[name];
  return FolderOpen;
}

/* Hand-drawn concierge scene — open notebook, plant, "?" speech bubble,
   handwritten note. Matches the editorial illustration style used on
   the Rashan landing hero. */
function ConciergeArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 360 320" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      {/* soft warm wash */}
      <defs>
        <radialGradient id="hcGlow" cx="55%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#E8F5EC" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="200" cy="160" rx="160" ry="120" fill="url(#hcGlow)" />

      {/* desk surface — warm dune ellipse */}
      <ellipse cx="190" cy="270" rx="160" ry="22" fill="#EFEAE1" />

      {/* opened notebook (left) */}
      <g>
        <path d="M 50 198 L 196 188 L 196 268 L 50 278 Z" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2" strokeLinejoin="round" />
        <path d="M 50 198 L 122 192 L 122 274 L 50 278 Z" fill="#FAFBF8" stroke="#0F172A" strokeWidth="2" strokeLinejoin="round" />
        <path d="M 122 192 L 196 188 L 196 268 L 122 274 Z" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2" strokeLinejoin="round" />
        {/* ruled lines */}
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={`l${i}`} x1={60} y1={214 + i * 12} x2={114} y2={210 + i * 12} stroke="#DCE6FD" strokeWidth="1.5" />
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={`r${i}`} x1={132} y1={210 + i * 12} x2={186} y2={206 + i * 12} stroke="#DCE6FD" strokeWidth="1.5" />
        ))}
        {/* spiral binding */}
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <circle key={i} cx={122 + (i % 2) * 0.4} cy={198 + i * 11} r="2.4" fill="none" stroke="#0F172A" strokeWidth="1.5" />
        ))}
      </g>

      {/* question speech bubble (top right) */}
      <g className="float-soft">
        <path d="M 220 60 Q 220 38, 246 38 L 320 38 Q 346 38, 346 60 L 346 110 Q 346 132, 320 132 L 268 132 L 248 152 L 254 132 Q 220 130, 220 110 Z"
              fill="#054EE8" stroke="#022B91" strokeWidth="2" strokeLinejoin="round" />
        <text x="283" y="100" fontSize="44" fontWeight="800" fill="#FFFFFF" textAnchor="middle" fontFamily="'DM Sans', sans-serif">?</text>
      </g>

      {/* mint pen, diagonal */}
      <g transform="rotate(-22 220 230)">
        <rect x="180" y="226" width="92" height="10" rx="5" fill="#7FC646" stroke="#0F172A" strokeWidth="1.8" />
        <polygon points="272,226 286,231 272,236" fill="#5FA133" stroke="#0F172A" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="182" cy="231" r="3.2" fill="#0F172A" />
      </g>

      {/* small potted plant (right) */}
      <g>
        <path d="M 286 240 Q 286 210, 296 196 Q 304 210, 302 240" fill="#7FC646" stroke="#0F172A" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M 302 240 Q 304 218, 314 206 Q 316 222, 312 240" fill="#98D265" stroke="#0F172A" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M 296 240 L 288 268 L 318 268 L 312 240 Z" fill="#EFEAE1" stroke="#0F172A" strokeWidth="1.8" strokeLinejoin="round" />
      </g>

      {/* handwritten "hola!" */}
      <g fill="#054EE8" fontFamily="'Caveat', 'Patrick Hand', 'Comic Sans MS', cursive" fontStyle="italic">
        <text x="40" y="80" fontSize="36" fontWeight="700" transform="rotate(-6 40 80)">hola!</text>
        <path d="M 78 90 q 14 16, 32 18" fill="none" stroke="#054EE8" strokeWidth="2" strokeLinecap="round" />
        <polygon points="108,108 116,106 112,114" fill="#054EE8" />
      </g>

      {/* warmth ticks */}
      <g stroke="#054EE8" strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M 28 32 l 8 8 M 36 32 l -8 8" opacity="0.5" />
        <path d="M 330 200 l 8 8 M 338 200 l -8 8" opacity="0.5" />
      </g>
    </svg>
  );
}

export default function HelpCenterPage() {
  const navigate = useNavigate();
  const { lang } = useLanguageStore();
  const { data: categories, isLoading } = useHelpCenter();
  const [query, setQuery] = useState('');

  const TXT = {
    eyebrow_en: 'CESTO HELP DESK · CONCIERGE',
    eyebrow_es: 'MOSTRADOR DE AYUDA · CONSERJERÍA',
    h1_en: 'How can we help you today?',
    h1_es: '¿En qué te ayudamos hoy?',
    lede_en: "Real answers, written by the Cesto team. Search, browse, or talk to a human — whichever way you prefer.",
    lede_es: 'Respuestas reales, escritas por el equipo de Cesto. Busca, navega o habla con un humano — como prefieras.',
    searchPh_en: 'Search — try "where\'s my order?" or "return"',
    searchPh_es: 'Busca — prueba "¿dónde está mi pedido?" o "devolución"',
    popularLabel_en: 'Most asked',
    popularLabel_es: 'Más consultados',
    popular_en: [
      { label: 'Track my order',   slug: 'order-tracking' },
      { label: 'Modify or cancel', slug: 'modify-cancel-orders' },
      { label: 'Request a refund', slug: 'refund-process' },
      { label: 'Payment methods',  slug: 'payment-methods' },
      { label: 'Delivery slots',   slug: 'home-delivery-services' },
    ],
    popular_es: [
      { label: 'Seguir mi pedido',  slug: 'order-tracking' },
      { label: 'Modificar o cancelar', slug: 'modify-cancel-orders' },
      { label: 'Solicitar reembolso', slug: 'refund-process' },
      { label: 'Métodos de pago',     slug: 'payment-methods' },
      { label: 'Franjas de entrega',  slug: 'home-delivery-services' },
    ],
    sectionsEyebrow_en: 'BROWSE BY TOPIC',
    sectionsEyebrow_es: 'NAVEGA POR TEMA',
    sectionsTitle_en: 'Eight shelves of how-tos, written for humans.',
    sectionsTitle_es: 'Ocho estantes de cómo-se-hace, escritos para humanos.',
    noMatch_en: 'No articles match — try a different keyword, or talk to the team.',
    noMatch_es: 'No hay coincidencias — prueba otra palabra o habla con el equipo.',
    ctaTitle_en: "Can't find what you need?",
    ctaTitle_es: '¿No encuentras lo que buscas?',
    ctaBody_en: "Our team replies in Spanish, English or Urdu. Tell us what's on your mind.",
    ctaBody_es: 'Nuestro equipo responde en español, inglés o urdu. Cuéntanos qué necesitas.',
    ctaBtn_en: 'Talk to a human',
    ctaBtn_es: 'Hablar con un humano',
  };

  // Only what is published: an article nobody has written answers 404 by its link.
  const listed = new Set((categories ?? []).flatMap((c) => (c.articles ?? []).map((a) => a.slug)));
  const popular = (lang === 'es' ? TXT.popular_es : TXT.popular_en).filter((p) => listed.has(p.slug));
  const nothingPublished = !isLoading && listed.size === 0;
  const titleOf = (c: HelpCategory) => (lang === 'es' ? c.title_es : c.title_en) || c.slug;

  /* One-line per-category intro keyed by slug (kept here, not in the DB, so
     the editorial voice stays consistent even after admin edits.) */
  const INTRO: Record<string, { en: string; es: string }> = {
    'about-cesto':         { en: 'Who we are, how we work, where we\'re heading.',                 es: 'Quiénes somos, cómo trabajamos, hacia dónde vamos.' },
    'orders-delivery':     { en: 'Tracking, changes, slots, missing items — every order question.', es: 'Seguimiento, cambios, franjas, faltantes — todo sobre tu pedido.' },
    'account-payments':    { en: 'Sign-in help, payment methods, invoices, regional settings.',     es: 'Inicio de sesión, métodos de pago, facturas y ajustes.' },
    'returns-refunds':     { en: 'When something isn\'t right, here\'s exactly how to fix it.',      es: 'Cuando algo no sale bien, así lo solucionamos.' },
    'shopping-with-cesto': { en: 'Wishlist, gifts, promotions, food safety — the full playbook.',    es: 'Favoritos, regalos, promos, seguridad alimentaria — la guía completa.' },
    'terms-conditions':    { en: 'Plain-language summaries of the rules of the road.',              es: 'Las reglas del juego, en lenguaje claro.' },
    'policies-guidelines': { en: 'Privacy, accessibility, community standards and data care.',       es: 'Privacidad, accesibilidad, comunidad y datos.' },
    'marketplace':         { en: 'Sell with Cesto: listing rules, performance, dispute support.',   es: 'Vende con Cesto: reglas, rendimiento y soporte de disputas.' },
  };

  const filteredCategories = useMemo(() => {
    if (!categories) return [];
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((c) => ({
        ...c,
        articles: (c.articles ?? []).filter((a) => {
          const ttl = (lang === 'es' ? a.title_es : a.title_en).toLowerCase();
          return ttl.includes(q);
        }),
      }))
      .filter((c) => (c.articles?.length ?? 0) > 0 || titleOf(c).toLowerCase().includes(q));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, query, lang]);

  return (
    <div className="bg-surface-linen min-h-screen">
      {/* ════════════════════════════════════════════════════════
         HERO — asymmetric mint band with concierge illustration
         ════════════════════════════════════════════════════════ */}
      <section className="relative overflow-hidden">
        {/* warm wash background */}
        <div className="absolute inset-0 bg-surface-mint pointer-events-none" />
        <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-brand-mist/60 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 right-1/3 w-[480px] h-[480px] rounded-full bg-amber-mist/50 blur-3xl pointer-events-none" />

        <div className="relative max-w-[1280px] mx-auto px-6 lg:px-10 pt-14 pb-16 lg:pt-20 lg:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10 items-center">
            {/* Left: greeting + search */}
            <div className="max-w-[640px]">
              <div className="rise-in">
                <span className="inline-flex items-center gap-2 bg-white/80 backdrop-blur text-brand text-[10.5px] font-bold tracking-[0.18em] uppercase px-3 py-1.5 rounded-full font-ui border border-brand-mist">
                  <Sparkles size={11} strokeWidth={2.5} />
                  {lang === 'es' ? TXT.eyebrow_es : TXT.eyebrow_en}
                </span>
              </div>

              <h1
                className="rise-in-1 font-display text-[40px] md:text-[56px] lg:text-[64px] text-ink mt-5 leading-[0.98] tracking-tight"
                style={{ fontWeight: 700 }}
              >
                {lang === 'es' ? TXT.h1_es : TXT.h1_en}
              </h1>

              <p className="rise-in-2 text-[15.5px] md:text-[17px] text-gray font-body mt-5 leading-relaxed max-w-[560px]">
                {nothingPublished
                  ? (lang === 'es'
                    ? 'Estamos escribiendo estas guías. Mientras tanto, las preguntas frecuentes responden a lo más habitual, y nuestro equipo a todo lo demás.'
                    : "We're still writing these guides. In the meantime, the FAQ answers the most common questions, and our team everything else.")
                  : (lang === 'es' ? TXT.lede_es : TXT.lede_en)}
              </p>

              {nothingPublished ? (
                <div className="rise-in-3 mt-7 flex flex-wrap items-center gap-3">
                  <Link to="/faq" className="h-[52px] px-6 rounded-xl bg-brand hover:bg-brand-deepest text-white text-[14px] font-bold font-ui inline-flex items-center gap-2 transition-colors">
                    <LifeBuoy size={18} strokeWidth={1.75} />
                    {lang === 'es' ? 'Ver preguntas frecuentes' : 'See the FAQ'}
                  </Link>
                  <Link to="/contact" className="h-[52px] px-6 rounded-xl bg-card border border-border text-ink text-[14px] font-bold font-ui inline-flex items-center gap-2 hover:border-brand hover:text-brand transition-colors">
                    <MessageCircle size={18} strokeWidth={1.75} />
                    {lang === 'es' ? 'Escríbenos' : 'Contact us'}
                  </Link>
                </div>
              ) : (
              <>
              {/* big search */}
              <div className="rise-in-3 mt-7 relative max-w-[560px]">
                <div className="relative">
                  <Search size={18} strokeWidth={1.75} className="absolute left-5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={lang === 'es' ? TXT.searchPh_es : TXT.searchPh_en}
                    className="w-full h-[60px] pl-14 pr-32 rounded-full border border-border bg-card text-[15px] font-body text-ink placeholder:text-muted shadow-card focus:border-brand focus:outline-none transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => { /* search is live as you type */ }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-12 px-6 rounded-full bg-brand hover:bg-brand-deepest text-white text-[13.5px] font-bold font-ui inline-flex items-center gap-1.5 transition-colors shadow-brand"
                  >
                    {lang === 'es' ? 'Buscar' : 'Search'}
                  </button>
                </div>
              </div>

              {/* popular chips */}
              {popular.length > 0 && (
              <div className="rise-in-4 mt-6">
                <p className="text-[11px] font-bold tracking-[0.14em] uppercase text-gray font-ui mb-2.5">
                  {lang === 'es' ? TXT.popularLabel_es : TXT.popularLabel_en}
                </p>
                <div className="flex flex-wrap gap-2">
                  {popular.map((p) => (
                    <button
                      key={p.slug}
                      onClick={() => navigate(`/help/${p.slug}`)}
                      className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-card border border-border text-[13px] font-semibold font-ui text-ink hover:border-brand hover:text-brand hover:bg-brand-whisper transition-colors"
                    >
                      {p.label}
                      <ArrowUpRight size={12} strokeWidth={2.25} className="opacity-60" />
                    </button>
                  ))}
                </div>
              </div>
              )}
              </>
              )}
            </div>

            {/* Right: illustration */}
            <div className="hidden lg:block">
              <ConciergeArt className="w-full h-[340px]" />
            </div>
          </div>
        </div>

        {/* Hand-drawn divider sweep into next section */}
        <svg viewBox="0 0 1440 60" preserveAspectRatio="none" className="block w-full h-[60px] relative -mb-px text-surface-linen">
          <path d="M 0 60 Q 360 0, 720 30 T 1440 12 L 1440 60 Z" fill="currentColor" />
        </svg>
      </section>

      {/* ════════════════════════════════════════════════════════
         CATEGORIES — numbered editorial sections
         ════════════════════════════════════════════════════════ */}
      {!nothingPublished && (
      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pt-12 lg:pt-16 pb-20">
        {/* section heading */}
        <div className="mb-12 lg:mb-16 max-w-[760px]">
          <span className="text-[11px] font-bold tracking-[0.18em] uppercase text-brand font-ui">
            {lang === 'es' ? TXT.sectionsEyebrow_es : TXT.sectionsEyebrow_en}
          </span>
          <h2 className="font-display text-[28px] md:text-[36px] text-ink tracking-tight mt-3 leading-[1.05]" style={{ fontWeight: 700 }}>
            {lang === 'es' ? TXT.sectionsTitle_es : TXT.sectionsTitle_en}
          </h2>
        </div>

        {isLoading ? (
          <div className="space-y-12">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="grid grid-cols-1 lg:grid-cols-[80px_1fr] gap-6">
                <div className="h-8 w-12 bg-surface-cream rounded skeleton" />
                <div className="space-y-3">
                  <div className="h-10 w-3/4 bg-surface-cream rounded skeleton" />
                  <div className="h-4 w-1/2 bg-surface-cream rounded skeleton" />
                  <div className="grid grid-cols-2 gap-3 mt-6">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <div key={j} className="h-6 bg-surface-cream rounded skeleton" />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : filteredCategories.length === 0 ? (
          <div className="bg-card border border-border rounded-2xl p-12 text-center">
            <p className="text-[15px] text-gray font-body">
              {lang === 'es' ? TXT.noMatch_es : TXT.noMatch_en}
            </p>
          </div>
        ) : (
          <div className="space-y-6 lg:space-y-8">
            {filteredCategories.map((cat, idx) => {
              const Icon = iconFor(cat.icon);
              const arts = cat.articles ?? [];
              const intro = INTRO[cat.slug]?.[lang === 'es' ? 'es' : 'en'];
              const num = String(idx + 1).padStart(2, '0');

              return (
                <article
                  key={cat.id}
                  id={cat.slug}
                  className="group relative grid grid-cols-1 lg:grid-cols-[88px_1fr_auto] gap-x-6 gap-y-5 pb-6 lg:pb-8 border-b border-border last:border-b-0 last:pb-0"
                >
                  {/* number eyebrow */}
                  <div className="lg:pt-2">
                    <div className="flex lg:flex-col items-baseline lg:items-start gap-3 lg:gap-1.5">
                      <span className="font-mono text-[15px] font-bold text-brand tracking-tight">
                        {num}
                      </span>
                      <div className="hidden lg:block h-px w-10 bg-brand/30 mt-1" />
                    </div>
                  </div>

                  {/* main column: title + articles */}
                  <div className="min-w-0">
                    <h3
                      className="font-display text-[26px] md:text-[32px] text-ink tracking-tight leading-[1.05]"
                      style={{ fontWeight: 700 }}
                    >
                      {titleOf(cat)}
                    </h3>
                    {intro && (
                      <p className="text-[14.5px] text-gray font-body mt-2 leading-relaxed max-w-[640px]">
                        {intro}
                      </p>
                    )}

                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2.5 mt-6">
                      {arts.map((a) => {
                        const title = lang === 'es' ? a.title_es : a.title_en;
                        return (
                          <li key={a.id}>
                            <Link
                              to={`/help/${a.slug}`}
                              className="group/link inline-flex items-baseline gap-2 text-[14.5px] text-ink font-body leading-snug hover:text-brand transition-colors"
                            >
                              <span className="text-brand/30 group-hover/link:text-brand transition-colors font-mono text-[10px] translate-y-[1px]">
                                →
                              </span>
                              <span className="bg-[length:0%_1px] bg-no-repeat bg-bottom group-hover/link:bg-[length:100%_1px] transition-[background-size] duration-300"
                                    style={{ backgroundImage: 'linear-gradient(currentColor, currentColor)' }}>
                                {title}
                              </span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  {/* faded icon anchor (desktop only) */}
                  <div className="hidden lg:flex items-start justify-end pt-1">
                    <div className="relative w-16 h-16 rounded-2xl bg-brand-whisper border border-brand-mist flex items-center justify-center transition-transform group-hover:rotate-[-3deg] group-hover:scale-105 duration-300">
                      <Icon size={26} strokeWidth={1.5} className="text-brand" />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      )}

      {/* ════════════════════════════════════════════════════════
         CTA — warm contact callout
         ════════════════════════════════════════════════════════ */}
      <section className="max-w-[1280px] mx-auto px-6 lg:px-10 pb-20">
        <div className="relative overflow-hidden rounded-3xl bg-brand text-white p-8 md:p-12 lg:p-14">
          {/* decorative blobs */}
          <div className="absolute -top-24 -right-24 w-[320px] h-[320px] rounded-full bg-brand-mid/40 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-[280px] h-[280px] rounded-full bg-amber/20 blur-3xl pointer-events-none" />
          {/* dotted grid texture */}
          <div
            className="absolute inset-0 opacity-[0.08] pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(circle, #FFFFFF 1px, transparent 1px)', backgroundSize: '20px 20px' }}
          />

          <div className="relative grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 md:gap-10 items-center">
            <div>
              <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.18em] uppercase text-amber-mid font-ui">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-mid animate-pulse" />
                {lang === 'es' ? 'En vivo · responde un humano' : 'Live · a human replies'}
              </span>
              <h3
                className="font-display text-[28px] md:text-[36px] tracking-tight mt-3 leading-[1.05]"
                style={{ fontWeight: 700 }}
              >
                {lang === 'es' ? TXT.ctaTitle_es : TXT.ctaTitle_en}
              </h3>
              <p className="text-[15px] text-white/80 font-body mt-3 max-w-[520px] leading-relaxed">
                {lang === 'es' ? TXT.ctaBody_es : TXT.ctaBody_en}
              </p>
            </div>
            <button
              onClick={() => navigate('/contact?source=help_center')}
              className="inline-flex items-center gap-2 h-[56px] px-7 rounded-full bg-card text-brand text-[14px] font-bold font-ui hover:bg-amber hover:text-on-accent transition-colors shadow-modal"
            >
              <MessageCircle size={16} strokeWidth={2} />
              {lang === 'es' ? TXT.ctaBtn_es : TXT.ctaBtn_en}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
