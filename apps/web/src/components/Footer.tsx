import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Truck, Leaf, ChevronDown, ArrowUp,
} from 'lucide-react';
import { useStoreSettings } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useCookieConsentStore } from '@/stores/cookieConsentStore';

/* ───────────────────────────────────────────────────────
   Carrefour-style footer
   - Top white band: SEO paragraph + 2 feature badges
   - Main 5-column link grid on light surface
   - Bottom dark band: copyright + socials + brand
   Every link in the columns and the SEO paragraph goes to a real route
   in apps/web/src/App.tsx — items pointing at features that don't exist
   were trimmed instead of left as dead chrome.
   ─────────────────────────────────────────────────────── */

const SVG = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 fill-current">{children}</svg>
);
const XIcon = () => (
  <SVG><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></SVG>
);
const YoutubeIcon = () => (
  <SVG><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.016 3.016 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.016 3.016 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></SVG>
);
const FacebookIcon = () => (
  <SVG><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></SVG>
);
const LinkedinIcon = () => (
  <SVG><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.063 2.063 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></SVG>
);
const InstagramIcon = () => (
  <SVG><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" /></SVG>
);
const PinterestIcon = () => (
  <SVG><path d="M12 0a12 12 0 00-4.373 23.178c-.105-.937-.2-2.376.041-3.4.219-.937 1.406-5.957 1.406-5.957s-.359-.719-.359-1.781c0-1.668.967-2.914 2.171-2.914 1.024 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.137.893 2.739a.36.36 0 01.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146A12 12 0 1012 0z" /></SVG>
);

const PayBadge = ({ label, bg, fg }: { label: string; bg: string; fg: string }) => (
  <span
    className="inline-flex items-center justify-center h-7 px-2.5 rounded text-[10px] font-extrabold font-ui tracking-wide"
    style={{ background: bg, color: fg }}
  >
    {label}
  </span>
);

export default function Footer() {
  const navigate = useNavigate();
  const openCookieSettings = useCookieConsentStore((s) => s.openSettings);
  const { lang, setLang } = useLanguageStore();
  const { data: settings } = useStoreSettings();
  const storeName = settings?.storeName?.trim() || 'Cesto';
  const contactEmail = settings?.contactEmail?.trim();
  const contactPhone = settings?.contactPhone?.trim();
  const address = settings?.address?.trim();

  // Each feature badge is a real shortcut: clicking takes you to the page
  // that explains or delivers what the badge promises.
  const features = [
    {
      icon: Truck,
      label_en: 'Delivery and collection of orders',
      label_es: 'Entrega y recogida de pedidos',
      to: '/faq',
    },
    {
      icon: Leaf,
      label_en: 'Guarantee of freshness',
      label_es: 'Garantía de frescura',
      to: '/faq',
    },
  ];

  /* ─ Link columns ─ Every entry has a `to` route that exists in App.tsx;
     anything that pointed to a non-existent page was removed rather than
     left as dead chrome. */

  const col1Links = [
    { en: 'Our brands',                es: 'Nuestras marcas',           to: '/brands' },
    { en: 'Shop by origin',            es: 'Compra por origen',         to: '/origins' },
    { en: 'Become a Cesto partner',    es: 'Conviértete en partner',    to: '/b2b-deals' },
    { en: 'Sell with Cesto (supplier)', es: 'Vende con Cesto (proveedor)', to: '/partner-deals' },
    { en: 'Data protection rights',    es: 'Derechos de protección de datos', to: '/privacy' },
  ];

  const col2Links = [
    { en: 'Help Center',              es: 'Centro de ayuda',         to: '/help' },
    { en: 'Contact',                  es: 'Contacto',                to: '/contact' },
    { en: 'Frequently asked questions', es: 'Preguntas frecuentes',  to: '/faq' },
    { en: 'My orders & invoices',     es: 'Mis pedidos y facturas',  to: '/orders' },
    { en: 'Saved addresses',          es: 'Direcciones guardadas',   to: '/addresses' },
    { en: 'Complaints and claims',    es: 'Reclamaciones',           to: '/contact' },
  ];
  const col2Account = [
    { en: 'My profile',               es: 'Mi perfil',               to: '/profile' },
    { en: 'Favourites',               es: 'Favoritos',               to: '/favorites' },
    { en: 'Sign in',                  es: 'Iniciar sesión',          to: '/login' },
    { en: 'Create account',           es: 'Crear cuenta',            to: '/register' },
  ];

  const col3Links = [
    { en: 'Order status',             es: 'Estado del pedido',       to: '/orders' },
    { en: 'Delivery & returns',       es: 'Entrega y devoluciones',  to: '/faq' },
    { en: 'Guarantee of freshness',   es: 'Garantía de frescura',    to: '/faq' },
    { en: 'Sell on Cesto (supplier)', es: 'Vende en Cesto',          to: '/partner-deals' },
    { en: 'Become a B2B partner',     es: 'Únete como partner B2B',  to: '/b2b-deals' },
    { en: 'Purchase conditions',      es: 'Condiciones de compra',   to: '/terms' },
  ];

  const col4Links = [
    { en: 'Online supermarket offers', es: 'Ofertas del supermercado online', to: '/categories' },
    { en: 'Home Grocery',              es: 'Compra del hogar',                 to: '/rashan' },
    { en: 'Create an account',         es: 'Crear una cuenta',                 to: '/register' },
    { en: 'Shop by category',          es: 'Compra por categoría',             to: '/categories' },
    { en: 'Search products',           es: 'Buscar productos',                 to: '/search' },
  ];

  const TXT = {
    seoHeading_en: 'Cesto Online: your South Asian supermarket, your way — easier and faster than ever',
    seoHeading_es: 'Cesto Online: tu supermercado del sur de Asia, a tu manera — más fácil y rápido que nunca',
    seoBody_en: (
      <>
        Tired of carrying heavy bags? At Cesto.es find authentic spices, basmati rice, fresh produce, chai blends, halal meat and pantry essentials — without leaving the house.{' '}
        <button onClick={() => navigate('/faq')} className="text-brand font-bold hover:underline">Home delivery</button> straight to your door, with a huge range of South Asian and international brands you won't find in every supermarket.{' '}
        Discover the comfort, quality and variety of Cesto Online — buy now.
      </>
    ),
    seoBody_es: (
      <>
        ¿Cansado de cargar bolsas pesadas? En Cesto.es encuentras especias auténticas, arroz basmati, productos frescos, mezclas de chai, carne halal y básicos de despensa sin salir de casa.{' '}
        <button onClick={() => navigate('/faq')} className="text-brand font-bold hover:underline">Entrega a domicilio</button> directamente en tu puerta, con una amplia variedad de marcas del sur de Asia e internacionales que no encontrarás en cualquier supermercado.{' '}
        Descubre la comodidad, la calidad y la variedad de Cesto Online — compra ya.
      </>
    ),
  };

  const FeatureRow = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-4 py-4 border-y border-border/60">
      {features.map((f) => (
        <button
          key={f.label_en}
          onClick={() => navigate(f.to)}
          className="flex items-center gap-3 text-left group"
        >
          <div className="w-9 h-9 rounded-md border border-border/70 bg-card flex items-center justify-center shrink-0 group-hover:border-brand transition-colors">
            <f.icon size={16} strokeWidth={1.75} className="text-brand" />
          </div>
          <span className="text-[12.5px] text-ink group-hover:text-brand font-ui transition-colors">
            {lang === 'en' ? f.label_en : f.label_es}
          </span>
        </button>
      ))}
    </div>
  );

  const linkBtn = 'text-left text-[12.5px] text-ink/75 hover:text-brand hover:underline font-ui leading-tight transition-colors';
  const colHead = 'font-display text-[15px] font-bold text-ink tracking-tight mb-3';
  const subHead = 'font-display text-[13px] font-bold text-ink tracking-tight mt-5 mb-3';

  return (
    <footer className="relative bg-card">

      {/* ════════════════════════════════════════════
          TOP — SEO heading + feature badges
      ════════════════════════════════════════════ */}
      <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-8">
        <h2 className="font-display text-[20px] md:text-[22px] text-ink leading-snug tracking-tight" style={{ fontWeight: 700 }}>
          {lang === 'en' ? TXT.seoHeading_en : TXT.seoHeading_es}
        </h2>
        <p className="mt-3 text-[13.5px] text-ink/75 font-ui leading-relaxed max-w-[1100px]">
          {lang === 'en' ? TXT.seoBody_en : TXT.seoBody_es}
        </p>
        <div className="mt-6">
          <FeatureRow />
        </div>
      </div>

      {/* ════════════════════════════════════════════
          MAIN — 5 column link grid
      ════════════════════════════════════════════ */}
      <div className="bg-surface-sand border-t border-border/60">
        <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-10">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-x-8 gap-y-10">

            {/* COL 1 — Cesto Group */}
            <div>
              <h3 className={colHead}>{lang === 'en' ? 'Cesto Group' : 'Grupo Cesto'}</h3>
              <ul className="flex flex-col gap-2.5">
                {col1Links.map((l) => (
                  <li key={l.en}>
                    <button className={linkBtn} onClick={() => navigate(l.to)}>
                      {lang === 'en' ? l.en : l.es}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* COL 2 — Customer service + account */}
            <div>
              <h3 className={colHead}>{lang === 'en' ? 'Customer Service' : 'Atención al cliente'}</h3>
              <ul className="flex flex-col gap-2.5">
                {col2Links.map((l) => (
                  <li key={l.en}>
                    <button className={linkBtn} onClick={() => navigate(l.to)}>
                      {lang === 'en' ? l.en : l.es}
                    </button>
                  </li>
                ))}
              </ul>

              <h4 className={subHead}>{lang === 'en' ? 'Your account' : 'Tu cuenta'}</h4>
              <ul className="flex flex-col gap-2.5">
                {col2Account.map((l) => (
                  <li key={l.en}>
                    <button className={linkBtn} onClick={() => navigate(l.to)}>
                      {lang === 'en' ? l.en : l.es}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* COL 3 — Cesto.es */}
            <div>
              <h3 className={colHead}>Cesto.es</h3>
              <ul className="flex flex-col gap-2.5">
                {col3Links.map((l) => (
                  <li key={l.en}>
                    <button className={linkBtn} onClick={() => navigate(l.to)}>
                      {lang === 'en' ? l.en : l.es}
                    </button>
                  </li>
                ))}
                <li className="pt-1">
                  <button
                    onClick={() => setLang(lang === 'en' ? 'es' : 'en')}
                    className="text-[12.5px] text-ink hover:text-brand font-ui inline-flex items-center gap-1.5 transition-colors"
                  >
                    {lang === 'en' ? 'Language' : 'Idioma'}:{' '}
                    <span className="font-bold uppercase">{lang === 'en' ? 'ENGLISH' : 'ESPAÑOL'}</span>
                    <ChevronDown size={12} strokeWidth={2} />
                  </button>
                </li>
              </ul>
            </div>

            {/* COL 4 — Offers & campaigns */}
            <div>
              <h3 className={colHead}>{lang === 'en' ? 'Offers and campaigns' : 'Ofertas y campañas'}</h3>
              <ul className="flex flex-col gap-2.5">
                {col4Links.map((l) => (
                  <li key={l.en}>
                    <button className={linkBtn} onClick={() => navigate(l.to)}>
                      {lang === 'en' ? l.en : l.es}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* COL 5 — Cesto Guarantee */}
            <div>
              <h3 className={colHead}>{lang === 'en' ? 'Cesto Guarantee' : 'Garantía Cesto'}</h3>
              <p className="text-[12.5px] text-ink/75 font-ui leading-snug mb-4">
                {lang === 'en' ? 'Maximum security in your purchases' : 'Máxima seguridad en tus compras'}
              </p>
              <div className="flex flex-wrap items-center gap-3 mb-6">
                <span className="inline-flex items-center justify-center h-9 px-3 rounded-md border border-border bg-card text-[10.5px] font-bold font-ui text-ink/75 tracking-wide">CONFIANZA · SSL</span>
                <span className="inline-flex items-center justify-center h-9 px-3 rounded-md border border-border bg-card text-[10.5px] font-bold font-ui text-ink/75 tracking-wide">ADIGITAL</span>
              </div>

              <h4 className={subHead}>{lang === 'en' ? 'Payment Methods' : 'Métodos de pago'}</h4>
              <div className="flex flex-wrap gap-2 mb-6">
                {/* These were VISA / MC / MAESTRO / AMEX / PAYPAL, which
                    claimed things that are not true: PayPal is not accepted at
                    all, and card brand marks imply paying online, which this
                    app has never done. Same class of mistake as the hardcoded
                    privacy policy that said Stripe processed card payments —
                    see LegalDocumentPage. Payment happens at the door, so the
                    footer now says that. */}
                <PayBadge
                  label={lang === 'en' ? 'CASH ON DELIVERY' : 'EFECTIVO AL RECIBIR'}
                  bg="#1F2937" fg="#FFFFFF"
                />
                <PayBadge
                  label={lang === 'en' ? 'CARD ON DELIVERY' : 'TARJETA AL RECIBIR'}
                  bg="#1F2937" fg="#FFFFFF"
                />
              </div>

              <h4 className={subHead}>{lang === 'en' ? 'Awards & honors' : 'Premios y reconocimientos'}</h4>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center h-12 px-3 rounded-md border border-border bg-card text-[11px] font-extrabold font-ui text-ink tracking-wider">R+D+I</span>
                <p className="text-[11.5px] text-ink/70 font-ui leading-snug">
                  {lang === 'en' ? 'Research, development & innovation' : 'Investigación, desarrollo e innovación'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════
            BOTTOM — black band with copyright + socials + brand
        ════════════════════════════════════════════ */}
        <div className="bg-night text-white relative">
          <div className="max-w-[1400px] mx-auto px-6 lg:px-10 py-5 flex flex-col md:flex-row items-center justify-between gap-4">

            {/* Left — copyright + legal */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-ui tracking-wide uppercase">
              <span className="text-white/65">© {storeName}{(contactEmail || contactPhone || address) && ' ·'}</span>
              {contactEmail && (
                <a href={`mailto:${contactEmail}`} className="text-white/65 hover:text-white transition-colors normal-case">
                  {contactEmail}
                </a>
              )}
              {contactPhone && (
                <a href={`tel:${contactPhone.replace(/\s/g, '')}`} className="text-white/65 hover:text-white transition-colors normal-case font-mono">
                  {contactPhone}
                </a>
              )}
              {address && (
                <span className="text-white/65 normal-case">{address}</span>
              )}
              {/* Reopens the consent dialog rather than linking to the policy
                  page — withdrawing consent has to be as easy as giving it,
                  and the policy is one click further in from there. */}
              <button
                onClick={openCookieSettings}
                className="text-white/65 hover:text-white transition-colors"
              >
                {lang === 'en' ? 'Cookie settings' : 'Configurar cookies'}
              </button>
              <button
                onClick={() => navigate('/terms')}
                className="text-white/65 hover:text-white transition-colors"
              >
                {lang === 'en' ? 'Legal Notice' : 'Aviso Legal'}
              </button>
              <button
                onClick={() => navigate('/privacy')}
                className="text-white/65 hover:text-white transition-colors"
              >
                {lang === 'en' ? 'Privacy Policy' : 'Política de Privacidad'}
              </button>
            </div>

            {/* Middle — social icons. We don't have public social profiles
                wired up yet, so the row is kept as visual branding (non-
                interactive spans) instead of buttons that go nowhere. */}
            <div className="flex items-center gap-2">
              {[
                { icon: <YoutubeIcon />, label: 'YouTube' },
                { icon: <FacebookIcon />, label: 'Facebook' },
                { icon: <XIcon />, label: 'X' },
                { icon: <LinkedinIcon />, label: 'LinkedIn' },
                { icon: <PinterestIcon />, label: 'Pinterest' },
                { icon: <InstagramIcon />, label: 'Instagram' },
              ].map((s) => (
                <span
                  key={s.label}
                  aria-hidden
                  className="w-8 h-8 rounded bg-white/8 flex items-center justify-center text-white/70"
                >
                  {s.icon}
                </span>
              ))}
            </div>

            {/* Right — brand */}
            <button onClick={() => navigate('/')} className="flex items-center gap-2.5">
              <span className="font-display text-[16px] text-white tracking-tight" style={{ fontWeight: 600 }}>{storeName}</span>
              <img src="/cesto-icon.png" alt="" className="w-8 h-8 rounded-lg ring-1 ring-white/15" draggable={false} />
            </button>
          </div>

          {/* Back-to-top floating button */}
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label={lang === 'en' ? 'Back to top' : 'Volver arriba'}
            className="absolute right-4 -top-6 w-12 h-12 rounded-full bg-card shadow-float border border-border flex items-center justify-center text-ink hover:bg-brand hover:text-white hover:border-brand transition-colors"
          >
            <ArrowUp size={16} strokeWidth={2.25} />
          </button>
        </div>
      </div>
    </footer>
  );
}
