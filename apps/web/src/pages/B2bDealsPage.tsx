import { useState, useMemo, useEffect, useRef, forwardRef, type ChangeEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { useForm, useFieldArray, Controller, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useJsApiLoader, Autocomplete, GoogleMap, Marker } from '@react-google-maps/api';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';
import {
  ArrowRight, Briefcase, Factory, Tag, Package, Truck, Warehouse, Globe2,
  Store, RefreshCw, Monitor, ShoppingCart, Rocket, Check, ShieldCheck,
  Wallet, Headphones, LogIn, Mail, Building2, User, Phone, MapPin,
  Link as LinkIcon, FileText, Handshake, X, MessageSquare, Clock, Users,
  Banknote, Plus, Minus, Sparkles, ArrowUpRight, BadgeCheck, CircleDot,
  Boxes, LayoutGrid, Receipt, Trash2, PlusCircle, Search,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLanguageStore } from '@/stores/languageStore';
import { useToast } from '@/components/Toast';
import { useStoreSettings, useSubmitLead } from '@grocery-app/shared';

/* ─────────────────────────────────────────────────────────
   Data — audience, benefits, steps, stats and FAQ tables.
   Kept side-by-side so the JSX downstream stays focused on
   layout and the marketing/legal team can edit copy in one
   place without touching components.
   ───────────────────────────────────────────────────────── */

/**
 * Which of the two B2B funnels this page instance renders.
 *
 *   business      — /b2b-deals. Wholesale BUYER. Applying gets them a Cesto
 *                   account with B2B pricing. No store.
 *   partner_store — /partner-deals. SELLER. Applying gets them a store on
 *                   Cesto.
 *
 * These match B2bLeadType on the wire deliberately. The previous names
 * ('partner' for the buyer page, 'supplier' for the seller page) were the
 * direct cause of buyer applications being fed into the store-creating
 * approval queue for months. Do not reintroduce them.
 */
type Mode = 'partner_store' | 'business';

interface AudienceItem {
  icon: LucideIcon;
  en: string;
  es: string;
  tag_en: string;
  tag_es: string;
}

const PARTNER_STORE_AUDIENCE: AudienceItem[] = [
  { icon: Factory,   en: 'Manufacturer',        es: 'Fabricante',                tag_en: 'Maker',       tag_es: 'Productor' },
  { icon: Tag,       en: 'Brand owner',         es: 'Propietario de marca',      tag_en: 'Brand',       tag_es: 'Marca' },
  { icon: Package,   en: 'Distributor',         es: 'Distribuidor',              tag_en: 'Distribution', tag_es: 'Distribución' },
  { icon: Truck,     en: 'Supplier',            es: 'Proveedor',                 tag_en: 'Supply',      tag_es: 'Suministro' },
  { icon: Warehouse, en: 'Wholesaler',          es: 'Mayorista',                 tag_en: 'Wholesale',   tag_es: 'Mayoreo' },
  { icon: Globe2,    en: 'Importer / Exporter', es: 'Importador / Exportador',   tag_en: 'Trade',       tag_es: 'Comercio' },
];

const BUSINESS_AUDIENCE: AudienceItem[] = [
  { icon: Store,        en: 'Retail shops',       es: 'Tiendas',                   tag_en: 'Retail',     tag_es: 'Minorista' },
  { icon: RefreshCw,    en: 'Resellers',          es: 'Distribuidores',            tag_en: 'Resell',     tag_es: 'Reventa' },
  { icon: Monitor,      en: 'E-commerce sellers', es: 'Vendedores online',         tag_en: 'Online',     tag_es: 'Online' },
  { icon: ShoppingCart, en: 'Supermarkets',       es: 'Supermercados',             tag_en: 'Grocery',    tag_es: 'Súper' },
  { icon: Briefcase,    en: 'Corporate buyers',   es: 'Compradores corporativos',  tag_en: 'Enterprise', tag_es: 'Empresa' },
  { icon: Rocket,       en: 'Startups & SMEs',    es: 'Startups y PYMES',          tag_en: 'Growth',     tag_es: 'Crecimiento' },
];

/* ─────────────────────────────────────────────────────────
   Per-segment detail copy. Keyed by the audience entry's
   English label so the AUDIENCE arrays above stay the single
   source of truth for ordering and icons.
   ───────────────────────────────────────────────────────── */

/** The number the office set in the store settings, as the footer shows it. */
function useSalesPhone(): string | null {
  const { data } = useStoreSettings();
  return data?.contactPhone?.trim() || null;
}

interface AudienceDetail {
  pitch_en: string;
  pitch_es: string;
  fits_en: [string, string, string];
  fits_es: [string, string, string];
}

const AUDIENCE_DETAIL: Record<string, AudienceDetail> = {
  // Supplier segments
  'Manufacturer': {
    pitch_en: 'List what you produce and sell it to shops and businesses on Cesto, at the prices you set.',
    pitch_es: 'Lista lo que fabricas y véndelo a comercios y empresas en Cesto, a los precios que tú fijas.',
    fits_en: ['Your own production', 'Products ready to sell', 'Delivery in Spain'],
    fits_es: ['Producción propia', 'Producto listo para vender', 'Entrega en España'],
  },
  'Brand owner': {
    pitch_en: 'Give your brand its own shop on Cesto, with your logo, your products and your prices.',
    pitch_es: 'Dale a tu marca su propia tienda en Cesto, con tu logo, tus productos y tus precios.',
    fits_en: ['Your own brand', 'A catalogue to show', 'Delivery in Spain'],
    fits_es: ['Marca propia', 'Un catálogo que mostrar', 'Entrega en España'],
  },
  'Distributor': {
    pitch_en: 'Put the brands you carry in one shop, and deliver the orders with your own riders.',
    pitch_es: 'Reúne las marcas que llevas en una tienda y entrega los pedidos con tus propios repartidores.',
    fits_en: ['A warehouse or shop', 'Several brands', 'Your own delivery'],
    fits_es: ['Almacén o tienda', 'Varias marcas', 'Reparto propio'],
  },
  'Supplier': {
    pitch_en: 'Receive orders in one panel: confirm them, prepare them and send them out with your riders.',
    pitch_es: 'Recibe los pedidos en un panel: confírmalos, prepáralos y envíalos con tus repartidores.',
    fits_en: ['Stock ready to sell', 'Clear prices', 'Your own delivery'],
    fits_es: ['Stock listo para vender', 'Precios claros', 'Reparto propio'],
  },
  'Wholesaler': {
    pitch_en: 'Turn your wholesale catalogue into a shop that businesses can order from, without cold calling.',
    pitch_es: 'Convierte tu catálogo mayorista en una tienda donde las empresas pueden pedir, sin llamadas en frío.',
    fits_en: ['A wholesale catalogue', 'Stock kept up to date', 'Your own delivery'],
    fits_es: ['Catálogo mayorista', 'Stock al día', 'Reparto propio'],
  },
  'Importer / Exporter': {
    pitch_en: 'Bring the products you import to shops and businesses in Spain.',
    pitch_es: 'Lleva los productos que importas a comercios y empresas en España.',
    fits_en: ['Imported products', 'Stock in Spain', 'Delivery in Spain'],
    fits_es: ['Producto importado', 'Stock en España', 'Entrega en España'],
  },

  // Partner segments
  'Retail shops': {
    pitch_en: 'Stock your shelves at business prices, from groceries to halal and South Asian specialities, from one account.',
    pitch_es: 'Abastece tus estanterías a precios de empresa, desde alimentación hasta halal y especialidades del sur de Asia, con una sola cuenta.',
    fits_en: ['One shop or several', 'Regular restocking', 'A CIF or NIF'],
    fits_es: ['Una tienda o varias', 'Reposición habitual', 'CIF o NIF'],
  },
  'Resellers': {
    pitch_en: 'Buy what you sell on at business prices, and keep all your orders in one panel.',
    pitch_es: 'Compra lo que revendes a precios de empresa y ten todos tus pedidos en un panel.',
    fits_en: ['A registered business', 'Regular buying', 'Your own customers'],
    fits_es: ['Negocio registrado', 'Compra habitual', 'Clientes propios'],
  },
  'E-commerce sellers': {
    pitch_en: 'Buy stock for your online shop at business prices, and follow each order from one panel.',
    pitch_es: 'Compra stock para tu tienda online a precios de empresa y sigue cada pedido desde un panel.',
    fits_en: ['An online shop', 'A registered business', 'Stock you hold'],
    fits_es: ['Tienda online', 'Negocio registrado', 'Stock propio'],
  },
  'Supermarkets': {
    pitch_en: 'Order for one site or several from one account, each delivery to its own address.',
    pitch_es: 'Pide para un local o varios desde una cuenta, cada entrega en su dirección.',
    fits_en: ['One site or several', 'Regular orders', 'Large quantities'],
    fits_es: ['Uno o varios locales', 'Pedidos habituales', 'Grandes cantidades'],
  },
  'Corporate buyers': {
    pitch_en: 'Order for your company from one account, at business prices and with facturas in its name.',
    pitch_es: 'Pide para tu empresa desde una cuenta, a precios de empresa y con factura a su nombre.',
    fits_en: ['A company account', 'A CIF for facturas', 'Regular orders'],
    fits_es: ['Cuenta de empresa', 'CIF para la factura', 'Pedidos habituales'],
  },
  'Startups & SMEs': {
    pitch_en: 'Start small: no membership fee and no minimum per product. You pay when your order arrives.',
    pitch_es: 'Empieza poco a poco: sin cuota y sin mínimo por producto. Pagas al recibir tu pedido.',
    fits_en: ['A registered business', 'Small or large orders', 'Pay on delivery'],
    fits_es: ['Negocio registrado', 'Pedidos pequeños o grandes', 'Pago al recibir'],
  },
};

interface BenefitItem {
  icon: LucideIcon;
  en: { t: string; d: string };
  es: { t: string; d: string };
}

const PARTNER_STORE_BENEFITS: BenefitItem[] = [
  { icon: Users,       en: { t: 'Reach shops and businesses',  d: 'Approved businesses see your products in their catalogue, at the business prices you set.' },
                       es: { t: 'Llega a comercios y empresas', d: 'Las empresas aprobadas ven tus productos en su catálogo, a los precios de empresa que fijas.' } },
  { icon: Store,       en: { t: 'Your own shop on Cesto',      d: 'A store page with your logo and your products, that customers can follow.' },
                       es: { t: 'Tu propia tienda en Cesto',   d: 'Una página de tienda con tu logo y tus productos, que los clientes pueden seguir.' } },
  { icon: Receipt,     en: { t: 'Orders in one place',         d: 'Orders reach your panel: confirm them, prepare them, change their lines and set the delivery fee.' },
                       es: { t: 'Pedidos en un solo sitio',    d: 'Los pedidos llegan a tu panel: confírmalos, prepáralos, cambia sus líneas y fija el envío.' } },
  { icon: Boxes,       en: { t: 'Your catalogue, your way',    d: 'Add products one at a time or import them in bulk, and spot the duplicates.' },
                       es: { t: 'Tu catálogo, a tu manera',    d: 'Añade productos de uno en uno o impórtalos en bloque, y localiza los duplicados.' } },
  { icon: Truck,       en: { t: 'Your own riders',             d: 'Add your riders and assign each order to one of them.' },
                       es: { t: 'Tus propios repartidores',    d: 'Añade a tus repartidores y asigna cada pedido a uno de ellos.' } },
  { icon: ShieldCheck, en: { t: 'Reviewed accounts',           d: 'Our team reviews every shop and every business that applies.' },
                       es: { t: 'Cuentas revisadas',           d: 'Nuestro equipo revisa cada tienda y cada empresa que lo solicita.' } },
];

const BUSINESS_BENEFITS: BenefitItem[] = [
  { icon: Banknote,    en: { t: 'Business prices',             d: 'A catalogue of wholesale prices, from Cesto and its partner shops.' },
                       es: { t: 'Precios de empresa',          d: 'Un catálogo a precios mayoristas, de Cesto y sus tiendas partner.' } },
  { icon: LayoutGrid,  en: { t: 'One panel for your orders',   d: 'Place your orders, follow them, and change them while they are still being prepared.' },
                       es: { t: 'Un panel para tus pedidos',   d: 'Haz tus pedidos, síguelos y cámbialos mientras se preparan.' } },
  { icon: Store,       en: { t: 'Several shops, one cart',     d: 'Mix products from different shops. Each one prepares and delivers its part.' },
                       es: { t: 'Varias tiendas, un carrito',  d: 'Mezcla productos de distintas tiendas. Cada una prepara y entrega su parte.' } },
  { icon: Receipt,     en: { t: 'Quotes for large quantities', d: 'Need more than usual? Ask us for a quote from the product page.' },
                       es: { t: 'Presupuestos para grandes cantidades', d: '¿Necesitas más de lo habitual? Pídenos presupuesto desde la página del producto.' } },
  { icon: Building2,   en: { t: 'Facturas in your name',       d: 'Your company details on your account, and facturas with your CIF.' },
                       es: { t: 'Facturas a tu nombre',        d: 'Los datos de tu empresa en tu cuenta, y facturas con tu CIF.' } },
  { icon: Wallet,      en: { t: 'Pay on delivery',             d: 'Cash or card when your order arrives. No bank details on the site.' },
                       es: { t: 'Pago al recibir',             d: 'Efectivo o tarjeta al recibir tu pedido. Sin datos bancarios en la web.' } },
];

interface StepItem {
  en: { t: string; d: string };
  es: { t: string; d: string };
}

const PARTNER_STORE_STEPS: StepItem[] = [
  { en: { t: 'Send your application', d: 'Tell us about your business and your shops.' },
    es: { t: 'Envía tu solicitud',    d: 'Cuéntanos sobre tu negocio y tus tiendas.' } },
  { en: { t: 'We review it',          d: 'A person on our team looks at every application.' },
    es: { t: 'La revisamos',          d: 'Una persona del equipo mira cada solicitud.' } },
  { en: { t: 'Access by email',       d: 'Once approved, your login arrives at the email you gave us.' },
    es: { t: 'Acceso por email',      d: 'Una vez aprobada, recibes el acceso en el email que nos diste.' } },
  { en: { t: 'Set up your shop',      d: 'Add your products, your prices and your riders.' },
    es: { t: 'Prepara tu tienda',     d: 'Añade tus productos, tus precios y tus repartidores.' } },
  { en: { t: 'Receive orders',        d: 'Orders reach your panel, and we let you know.' },
    es: { t: 'Recibe pedidos',        d: 'Los pedidos llegan a tu panel, y te avisamos.' } },
];

const BUSINESS_STEPS: StepItem[] = [
  { en: { t: 'Send your application', d: 'Tell us about your business and your shops.' },
    es: { t: 'Envía tu solicitud',    d: 'Cuéntanos sobre tu negocio y tus tiendas.' } },
  { en: { t: 'We review it',          d: 'A person on our team looks at every application.' },
    es: { t: 'La revisamos',          d: 'Una persona del equipo mira cada solicitud.' } },
  { en: { t: 'Access by email',       d: 'Once approved, your login arrives at the email you gave us.' },
    es: { t: 'Acceso por email',      d: 'Una vez aprobada, recibes el acceso en el email que nos diste.' } },
  { en: { t: 'Open your panel',       d: 'See the catalogue at your business prices.' },
    es: { t: 'Abre tu panel',         d: 'Mira el catálogo a tus precios de empresa.' } },
  { en: { t: 'Place your first order', d: 'Add to your cart, confirm, and pay when it arrives.' },
    es: { t: 'Haz tu primer pedido',  d: 'Añade al carrito, confirma y paga al recibirlo.' } },
];

interface FaqItem {
  q_en: string; a_en: string;
  q_es: string; a_es: string;
}

const PARTNER_STORE_FAQ: FaqItem[] = [
  { q_en: 'Is there a listing fee?',
    a_en: 'No. Listing your catalogue on Cesto is free.',
    q_es: '¿Hay coste por listar?',
    a_es: 'No. Listar tu catálogo en Cesto es gratis.' },
  { q_en: 'How fast can I go live?',
    a_en: 'As soon as your application is approved. Bring product photos, prices and a contact email — the rest happens in your dashboard.',
    q_es: '¿En cuánto tiempo entro?',
    a_es: 'En cuanto aprobamos tu solicitud. Trae fotos, precios y un email — el resto se hace en tu panel.' },
  { q_en: 'Who handles the delivery?',
    a_en: 'You do. Cesto sends you the order, and you deliver it with your own riders.',
    q_es: '¿Quién se encarga de la entrega?',
    a_es: 'Tú. Cesto te envía el pedido y tú lo entregas con tus propios repartidores.' },
  { q_en: 'Can I add many products at once?',
    a_en: 'Yes. You can add them one at a time or import them in bulk from your dashboard.',
    q_es: '¿Puedo añadir muchos productos a la vez?',
    a_es: 'Sí. Puedes añadirlos de uno en uno o importarlos en bloque desde tu panel.' },
  { q_en: 'Where can I sell?',
    a_en: 'For now in Spain, within our delivery areas, and in euros.',
    q_es: '¿Dónde puedo vender?',
    a_es: 'Por ahora en España, dentro de nuestras zonas de reparto, y en euros.' },
];

const BUSINESS_FAQ: FaqItem[] = [
  { q_en: 'Is there a membership fee?',
    a_en: 'No. Business accounts are free. The price you see is the wholesale price you pay.',
    q_es: '¿Hay cuota de membresía?',
    a_es: 'No. La cuenta de empresa es gratis. El precio que ves es el precio mayorista que pagas.' },
  { q_en: 'How are partner stores reviewed?',
    a_en: 'Our team reviews every shop that applies, before it can sell on Cesto.',
    q_es: '¿Cómo revisáis a las tiendas partner?',
    a_es: 'Nuestro equipo revisa cada tienda que lo solicita, antes de que pueda vender en Cesto.' },
  { q_en: 'Is there a minimum per product?',
    a_en: 'No. And for large quantities, you can ask us for a quote from the product page.',
    q_es: '¿Hay un mínimo por producto?',
    a_es: 'No. Y para grandes cantidades, puedes pedirnos presupuesto desde la página del producto.' },
  { q_en: 'How do I pay?',
    a_en: 'When your order arrives: cash or card. No bank details are entered on the site.',
    q_es: '¿Cómo pago?',
    a_es: 'Al recibir tu pedido: en efectivo o con tarjeta. No se introduce ningún dato bancario en la web.' },
  { q_en: 'Do you deliver outside Spain?',
    a_en: 'Not for now. We deliver within our delivery areas in Spain.',
    q_es: '¿Entregáis fuera de España?',
    a_es: 'Por ahora no. Repartimos dentro de nuestras zonas de reparto en España.' },
];

const MARQUEE_INDUSTRIES = [
  'Spices & dry goods', 'Beverages', 'Frozen', 'Pantry staples', 'Snacks',
  'Halal meats', 'Personal care', 'Household', 'Bakery', 'Confectionery',
  'Imported brands', 'Private label',
] as const;

const MARQUEE_INDUSTRIES_ES = [
  'Especias y secos', 'Bebidas', 'Congelados', 'Despensa', 'Snacks',
  'Carnes halal', 'Higiene', 'Hogar', 'Panadería', 'Confitería',
  'Marcas importadas', 'Marca propia',
] as const;

/* ─────────────────────────────────────────────────────────
   Primitives
   ───────────────────────────────────────────────────────── */

function SectionEyebrow({ children, tone = 'brand' }: { children: React.ReactNode; tone?: 'brand' | 'amber' }) {
  const cls = tone === 'amber'
    ? 'bg-amber-mist text-amber-deep'
    : 'bg-brand-mist text-brand';
  return (
    <span className={`inline-flex items-center gap-2 ${cls} text-[10.5px] font-bold tracking-[0.16em] uppercase px-3 py-1.5 rounded-full font-ui`}>
      {children}
    </span>
  );
}

function SectionHeader({
  eyebrow, title, subtitle, align = 'center', kicker,
}: { eyebrow: string; title: string; subtitle?: string; align?: 'center' | 'left'; kicker?: string }) {
  const alignCls = align === 'center' ? 'text-center mx-auto items-center' : 'text-left items-start';
  return (
    <div className={`mb-9 max-w-2xl flex flex-col ${alignCls}`}>
      <SectionEyebrow>{eyebrow}</SectionEyebrow>
      <h2 className="font-display text-[26px] md:text-[34px] text-ink tracking-tight mt-4 leading-[1.05]" style={{ fontWeight: 700 }}>
        {title}
      </h2>
      {kicker && (
        <span className="mt-2 text-[12px] font-mono uppercase tracking-[0.18em] text-muted">
          {kicker}
        </span>
      )}
      {subtitle && (
        <p className="text-[14px] md:text-[15px] text-gray font-body mt-3 leading-relaxed max-w-xl">
          {subtitle}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   HERO — picks the path (Partner store or Business). Layered with
   an editorial dashboard preview, a soft grid backdrop, and
   colour orbs that lean into the brand's blue + green accent.
   ───────────────────────────────────────────────────────── */

function Hero({
  mode, onScrollToForm, onOpenContact,
}: {
  mode: Mode;
  onScrollToForm: () => void;
  onOpenContact: (initial?: ContactIntent) => void;
}) {
  const { lang } = useLanguageStore();

  const copy = mode === 'business'
    ? {
        eyebrow_en: 'Cesto for business',
        eyebrow_es: 'Cesto para empresas',
        titleA_en: 'Wholesale without',
        titleB_en: 'the middle layer.',
        titleA_es: 'Mayoreo sin',
        titleB_es: 'intermediarios.',
        subtitle_en: "Get business prices on the catalogue of Cesto and its partner shops, and run your orders from one account — for retail shops, resellers, online sellers, supermarkets and SMEs.",
        subtitle_es: 'Consigue precios de empresa en el catálogo de Cesto y sus tiendas partner, y gestiona tus pedidos desde una sola cuenta — para tiendas, distribuidores, vendedores online, supermercados y PYMES.',
        primary_en: 'Join as a business', primary_es: 'Únete como empresa',
        primaryIcon: Handshake,
        crossHref: '/partner-deals',
        // Cross-link names the OTHER page's CTA, so it has to track it.
        cross_en: 'Looking to sell on Cesto? Join as a partner instead',
        cross_es: '¿Quieres vender en Cesto? Únete como partner',
        pillsEn: ['Reviewed partners', 'Free account', 'Pay on delivery'],
        pillsEs: ['Partners revisados', 'Cuenta gratis', 'Pago al recibir'],
      }
    : {
        eyebrow_en: 'Cesto for partners',
        eyebrow_es: 'Cesto para partners',
        titleA_en: 'Sell your catalogue.',
        titleB_en: 'Reach more shops.',
        titleA_es: 'Vende tu catálogo.',
        titleB_es: 'Llega a más comercios.',
        subtitle_en: 'Show your catalogue to shops and businesses in Spain, and run your products, orders and riders from your partner dashboard.',
        subtitle_es: 'Muestra tu catálogo a comercios y empresas en España, y gestiona tus productos, pedidos y repartidores desde tu panel de partner.',
        primary_en: 'Join as a partner', primary_es: 'Únete como partner',
        primaryIcon: Factory,
        crossHref: '/b2b-deals',
        // Cross-link names the OTHER page's CTA, so it has to track it.
        cross_en: 'Looking to buy on Cesto? Join as a business instead',
        cross_es: '¿Quieres comprar en Cesto? Únete como empresa',
        pillsEn: ['Reviewed buyers', 'Across Spain', 'Free to list'],
        pillsEs: ['Compradores revisados', 'En España', 'Listado gratis'],
      };

  const PrimaryIcon = copy.primaryIcon;
  const pills = lang === 'en' ? copy.pillsEn : copy.pillsEs;

  return (
    <section className="relative overflow-hidden rounded-2xl bg-surface-cream border border-border/70">
      {/* Decorative SVG grid + orbs */}
      <HeroBackdrop />

      <div className="relative px-6 md:px-10 lg:px-14 py-8 md:py-10 lg:py-12 grid lg:grid-cols-[1.05fr_0.95fr] gap-8 lg:gap-12 items-center">
        {/* Left column — copy */}
        <div className="max-w-2xl rise-in">
          <SectionEyebrow>
            <Briefcase size={11} strokeWidth={2.5} />
            {lang === 'en' ? copy.eyebrow_en : copy.eyebrow_es}
          </SectionEyebrow>

          <h1
            className="font-display text-[30px] md:text-[42px] lg:text-[48px] text-ink mt-4 leading-[1.0] tracking-[-0.025em]"
            style={{ fontWeight: 700 }}
          >
            {lang === 'en' ? (
              <>
                {copy.titleA_en}
                <br />
                <span className="relative inline-block">
                  <span className="relative z-10 text-brand">{copy.titleB_en}</span>
                  <span
                    className="absolute left-0 right-0 bottom-1 md:bottom-2 h-3 md:h-4 bg-amber/55 rounded-sm -z-0"
                    aria-hidden
                  />
                </span>
              </>
            ) : (
              <>
                {copy.titleA_es}
                <br />
                <span className="relative inline-block">
                  <span className="relative z-10 text-brand">{copy.titleB_es}</span>
                  <span
                    className="absolute left-0 right-0 bottom-1 md:bottom-2 h-3 md:h-4 bg-amber/55 rounded-sm -z-0"
                    aria-hidden
                  />
                </span>
              </>
            )}
          </h1>

          <p className="text-[13.5px] md:text-[15px] text-gray font-body mt-4 max-w-xl leading-relaxed">
            {lang === 'en' ? copy.subtitle_en : copy.subtitle_es}
          </p>

          {/* Small trust pills */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {pills.map((p) => (
              <span
                key={p}
                className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-card border border-border/70 text-[11.5px] font-bold font-ui text-ink/75"
              >
                <CircleDot size={9} strokeWidth={3} className="text-amber-deep" />
                {p}
              </span>
            ))}
          </div>

          {/* CTAs */}
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <button
              onClick={onScrollToForm}
              className="group inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-brand text-white text-[13.5px] font-bold font-ui hover:bg-brand-deepest transition-all shadow-brand hover:-translate-y-0.5"
            >
              <PrimaryIcon size={15} strokeWidth={2.25} />
              {lang === 'en' ? copy.primary_en : copy.primary_es}
              <ArrowRight size={14} strokeWidth={2.5} className="transition-transform group-hover:translate-x-0.5" />
            </button>
            <a
              href="/login"
              className="inline-flex items-center gap-2 h-12 px-5 rounded-xl border border-border bg-card text-ink text-[13.5px] font-bold font-ui hover:border-brand hover:text-brand transition-colors"
            >
              <LogIn size={14} strokeWidth={2.25} />
              {lang === 'en' ? 'Sign in' : 'Iniciar sesión'}
            </a>
            <button
              type="button"
              onClick={() => onOpenContact()}
              className="inline-flex items-center gap-2 h-12 px-4 rounded-xl bg-transparent text-ink/80 text-[13.5px] font-bold font-ui hover:text-brand transition-colors"
            >
              <Headphones size={14} strokeWidth={2.25} />
              {lang === 'en' ? 'Talk to sales' : 'Hablar con ventas'}
            </button>
          </div>

          {/* Cross-link */}
          <a
            href={copy.crossHref}
            className="group inline-flex items-center gap-1.5 mt-5 text-[12.5px] font-bold text-brand hover:text-brand-ink font-ui transition-colors"
          >
            {lang === 'en' ? copy.cross_en : copy.cross_es}
            <ArrowUpRight size={13} strokeWidth={2.5} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </a>
        </div>

        {/* Right column — illustration */}
        <div className="lg:max-w-[440px] lg:ml-auto w-full rise-in-1">
          <NetworkHub mode={mode} />
        </div>
      </div>
    </section>
  );
}

function HeroBackdrop() {
  // Hand-drawn-feeling backdrop: dotted grid + two large blurred colour
  // orbs (brand blue + green accent) for depth.
  return (
    <>
      {/* Dotted grid */}
      <svg
        className="absolute inset-0 w-full h-full text-brand/[0.07] pointer-events-none"
        aria-hidden
      >
        <defs>
          <pattern id="dotgrid-hero" x="0" y="0" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="currentColor" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dotgrid-hero)" />
      </svg>
      {/* Orbs */}
      <div className="absolute -top-32 -right-24 w-[460px] h-[460px] rounded-full bg-brand-mist/80 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-20 w-[400px] h-[400px] rounded-full bg-amber-mist/80 blur-3xl pointer-events-none" />
      <div className="absolute top-12 left-1/2 -translate-x-1/2 w-[260px] h-[260px] rounded-full bg-cool-mist/40 blur-3xl pointer-events-none" />
    </>
  );
}

/* Network Hub illustration — a brand-blue Cesto centre node connected to
   six audience satellites by animated dashed lines. Mode-aware: partner-store
   page shows the buyer universe orbiting Cesto, partner page shows the
   partner-store universe. Pure SVG + positioned divs — no images. */
function NetworkHub({ mode }: { mode: Mode }) {
  const { lang } = useLanguageStore();
  // Show the OTHER audience — i.e. who you're being connected TO via Cesto.
  const items = mode === 'partner_store' ? BUSINESS_AUDIENCE : PARTNER_STORE_AUDIENCE;

  // Six satellites evenly spaced on a circle starting at the top.
  const positions = [
    { x: 50, y: 12 },
    { x: 84, y: 32 },
    { x: 84, y: 68 },
    { x: 50, y: 88 },
    { x: 16, y: 68 },
    { x: 16, y: 32 },
  ];

  const tagText = mode === 'partner_store'
    ? (lang === 'en' ? 'Connected to reviewed buyers' : 'Compradores revisados conectados')
    : (lang === 'en' ? 'Connected to reviewed partner stores' : 'Tiendas partner revisadas conectadas');

  return (
    <div className="relative w-full max-w-[420px] aspect-square mx-auto">
      <style>{`
        @keyframes b2b-hub-flow {
          to { stroke-dashoffset: -8; }
        }
        .b2b-hub-line {
          stroke-dasharray: 1.4 1.2;
          animation: b2b-hub-flow 3.6s linear infinite;
        }
        @keyframes b2b-hub-pulse {
          0%, 100% { r: 16; opacity: 0.55; }
          50%      { r: 21; opacity: 0;    }
        }
        .b2b-hub-pulse { animation: b2b-hub-pulse 3.2s ease-out infinite; }
        @keyframes b2b-hub-float {
          0%, 100% { transform: translate(-50%, -50%) translateY(0); }
          50%      { transform: translate(-50%, -50%) translateY(-3px); }
        }
        .b2b-hub-sat-0 { animation: b2b-hub-float 5.6s ease-in-out infinite; animation-delay: 0s; }
        .b2b-hub-sat-1 { animation: b2b-hub-float 5.6s ease-in-out infinite; animation-delay: .4s; }
        .b2b-hub-sat-2 { animation: b2b-hub-float 5.6s ease-in-out infinite; animation-delay: .8s; }
        .b2b-hub-sat-3 { animation: b2b-hub-float 5.6s ease-in-out infinite; animation-delay: 1.2s; }
        .b2b-hub-sat-4 { animation: b2b-hub-float 5.6s ease-in-out infinite; animation-delay: 1.6s; }
        .b2b-hub-sat-5 { animation: b2b-hub-float 5.6s ease-in-out infinite; animation-delay: 2.0s; }
      `}</style>

      {/* SVG layer — guide rings + connection lines + pulse */}
      <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full" aria-hidden>
        <defs>
          <radialGradient id="b2b-hub-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%"  stopColor="#DCE6FD" stopOpacity="0.85" />
            <stop offset="55%" stopColor="#F0F4FE" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#F0F4FE" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Soft radial backlight */}
        <circle cx="50" cy="50" r="48" fill="url(#b2b-hub-glow)" />

        {/* Dotted guide rings */}
        <circle cx="50" cy="50" r="42" fill="none" stroke="#CBD5E1" strokeWidth="0.3" strokeDasharray="0.4 1.4" />
        <circle cx="50" cy="50" r="30" fill="none" stroke="#CBD5E1" strokeWidth="0.3" strokeDasharray="0.4 1.4" />

        {/* Connection lines from centre to each satellite */}
        {positions.map((p, i) => (
          <line
            key={`line-${i}`}
            x1="50" y1="50"
            x2={p.x} y2={p.y}
            stroke="#054EE8"
            strokeWidth="0.55"
            strokeOpacity="0.55"
            strokeLinecap="round"
            className="b2b-hub-line"
            style={{ animationDelay: `${i * 0.35}s` }}
          />
        ))}

        {/* Subtle "tick" dot at each line end (under the icon, peeks at edge) */}
        {positions.map((p, i) => (
          <circle key={`tick-${i}`} cx={p.x} cy={p.y} r="1.1" fill="#054EE8" fillOpacity="0.85" />
        ))}

        {/* Pulsing rings from centre */}
        <circle cx="50" cy="50" className="b2b-hub-pulse" fill="none" stroke="#054EE8" strokeWidth="0.4" />
        <circle cx="50" cy="50" className="b2b-hub-pulse" fill="none" stroke="#7FC646" strokeWidth="0.35" style={{ animationDelay: '1.6s' }} />
      </svg>

      {/* Centre hub — Cesto node */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
        <div className="relative">
          {/* Decorative outer rings */}
          <span className="absolute -inset-5 rounded-full border border-brand/15" aria-hidden />
          <span className="absolute -inset-2.5 rounded-full border border-amber/45" aria-hidden />
          {/* Core */}
          <div className="relative w-[104px] h-[104px] rounded-full bg-gradient-to-br from-brand to-brand-deepest flex items-center justify-center text-white shadow-[0_18px_44px_-10px_rgba(5,78,232,0.5)]">
            <img
              src="/cesto-icon.png"
              alt="Cesto"
              className="w-[68px] h-[68px] rounded-xl"
              draggable={false}
            />
          </div>
          {/* Tiny corner accent */}
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber border-2 border-card flex items-center justify-center" aria-hidden>
            <BadgeCheck size={9} strokeWidth={2.75} className="text-ink" />
          </span>
        </div>
      </div>

      {/* Satellite nodes */}
      {items.slice(0, 6).map((a, i) => {
        const p = positions[i];
        const Icon = a.icon;
        const label = lang === 'en' ? a.tag_en : a.tag_es;
        return (
          <div
            key={a.en}
            className={`absolute z-10 b2b-hub-sat-${i}`}
            style={{
              top: `${p.y}%`,
              left: `${p.x}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <div className="flex flex-col items-center gap-1.5">
              <span className="w-[52px] h-[52px] rounded-full bg-card border border-border shadow-card flex items-center justify-center text-brand">
                <Icon size={21} strokeWidth={1.75} />
              </span>
              <span className="text-[10px] font-bold font-ui tracking-[0.04em] text-ink/80 bg-card/85 backdrop-blur-sm px-2 py-0.5 rounded-full border border-border/60 whitespace-nowrap">
                {label}
              </span>
            </div>
          </div>
        );
      })}

      {/* Floating credibility tag */}
      <div className="hidden md:flex absolute -bottom-2 left-1/2 -translate-x-1/2 z-20 items-center gap-1.5 h-8 px-3.5 rounded-full bg-card border border-border shadow-card text-[11px] font-bold font-ui text-ink/80 whitespace-nowrap">
        <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
        {tagText}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   LOGO MARQUEE — soft "trusted across these verticals" strip.
   Pure CSS keyframes (defined inline) keep the page self-
   contained without polluting app.css.
   ───────────────────────────────────────────────────────── */

function LogoMarquee() {
  const { lang } = useLanguageStore();
  const items = lang === 'en' ? MARQUEE_INDUSTRIES : MARQUEE_INDUSTRIES_ES;
  // Double the list so the loop is seamless when translated -50%.
  const loop = [...items, ...items];

  return (
    <section className="relative rounded-2xl bg-card border border-border/70 px-5 md:px-8 py-5 overflow-hidden">
      <style>{`
        @keyframes b2b-marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .b2b-marquee-track {
          animation: b2b-marquee 38s linear infinite;
          width: max-content;
          will-change: transform;
        }
        .b2b-marquee:hover .b2b-marquee-track {
          animation-play-state: paused;
        }
      `}</style>
      <div className="flex items-center gap-5">
        <span className="hidden md:inline-flex items-center gap-2 shrink-0 text-[11px] font-bold tracking-[0.16em] uppercase font-ui text-ink/55">
          <Boxes size={13} strokeWidth={2} className="text-brand" />
          {lang === 'en' ? 'Verticals on Cesto' : 'Verticales en Cesto'}
        </span>
        <div className="relative flex-1 overflow-hidden b2b-marquee">
          {/* Fade masks */}
          <span className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-card to-transparent z-10 pointer-events-none" />
          <span className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-card to-transparent z-10 pointer-events-none" />
          <div className="b2b-marquee-track flex items-center gap-2.5">
            {loop.map((item, i) => (
              <span
                key={`${item}-${i}`}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-surface-linen border border-border/60 text-[12px] font-bold font-ui text-ink/80 whitespace-nowrap"
              >
                <CircleDot size={9} strokeWidth={3} className="text-amber-deep" />
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────
   WHO CAN JOIN — editorial split-canvas: a numbered segment
   index on the left and a large feature panel on the right
   that swaps in tailored copy and a giant watermark icon when
   a segment is selected.
   Falls back to a horizontal scroll-rail on small screens.
   ───────────────────────────────────────────────────────── */

function WhoCanJoin({
  items, mode, onScrollToForm,
}: {
  items: AudienceItem[];
  mode: Mode;
  onScrollToForm: () => void;
}) {
  const { lang } = useLanguageStore();
  const [active, setActive] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const current = items[active];
  const detail = AUDIENCE_DETAIL[current.en];
  const ActiveIcon = current.icon;

  const fits = lang === 'en' ? detail?.fits_en : detail?.fits_es;
  const pitch = lang === 'en' ? detail?.pitch_en : detail?.pitch_es;

  const ctaText = mode === 'partner_store'
    ? (lang === 'en' ? 'List as a ' : 'Lista como ')
    : (lang === 'en' ? 'Join as a ' : 'Únete como ');

  const sideTitle = mode === 'partner_store'
    ? (lang === 'en' ? 'Partner segments' : 'Segmentos de partner')
    : (lang === 'en' ? 'Business segments' : 'Segmentos de empresa');

  const fitsTitle    = lang === 'en' ? 'You fit if you have…' : 'Encajas si tienes…';

  function onKeyDownTab(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = (idx + 1) % items.length;
      setActive(next);
      tabRefs.current[next]?.focus();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = (idx - 1 + items.length) % items.length;
      setActive(prev);
      tabRefs.current[prev]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
      tabRefs.current[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(items.length - 1);
      tabRefs.current[items.length - 1]?.focus();
    }
  }

  return (
    <div className="relative">
      <style>{`
        @keyframes wcj-rise {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes wcj-watermark {
          0%, 100% { transform: rotate(-6deg) translateY(0); }
          50%      { transform: rotate(-6deg) translateY(-6px); }
        }
        .wcj-panel-enter > * { animation: wcj-rise .42s cubic-bezier(.2,.7,.2,1) both; }
        .wcj-panel-enter > *:nth-child(1) { animation-delay: 0s; }
        .wcj-panel-enter > *:nth-child(2) { animation-delay: .04s; }
        .wcj-panel-enter > *:nth-child(3) { animation-delay: .08s; }
        .wcj-panel-enter > *:nth-child(4) { animation-delay: .12s; }
        .wcj-panel-enter > *:nth-child(5) { animation-delay: .16s; }
        .wcj-panel-enter > *:nth-child(6) { animation-delay: .20s; }
        .wcj-watermark { animation: wcj-watermark 9s ease-in-out infinite; }
        .wcj-scroll::-webkit-scrollbar { display: none; }
        .wcj-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div className="grid lg:grid-cols-[300px_1fr] gap-4 md:gap-5">
        {/* ── Segment index ───────────────────────────────── */}
        <div className="relative min-w-0">
          {/* Mobile: horizontal scroll-rail */}
          <div className="lg:hidden -mx-1 wcj-scroll overflow-x-auto">
            <div className="inline-flex gap-2 px-1 pb-2 min-w-full">
              {items.map((a, i) => {
                const isActive = i === active;
                const Icon = a.icon;
                return (
                  <button
                    key={a.en}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setActive(i)}
                    className={`shrink-0 inline-flex items-center gap-2 h-10 pl-2.5 pr-3.5 rounded-full border transition-all ${
                      isActive
                        ? 'bg-brand text-white border-brand shadow-brand'
                        : 'bg-card text-ink border-border hover:border-brand/40'
                    }`}
                  >
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-mono ${
                      isActive ? 'bg-white/15 text-white' : 'bg-brand-mist text-brand'
                    }`}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <Icon size={14} strokeWidth={2} />
                    <span className="text-[12.5px] font-bold font-ui whitespace-nowrap">
                      {lang === 'en' ? a.en : a.es}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Desktop: vertical numbered index */}
          <div className="hidden lg:block">
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-muted">
                {sideTitle}
              </span>
              <span className="font-mono text-[10.5px] text-muted">
                {String(active + 1).padStart(2, '0')} / 06
              </span>
            </div>
            <ul
              role="tablist"
              aria-orientation="vertical"
              aria-label={sideTitle}
              className="relative flex flex-col gap-1.5"
            >
              {items.map((a, i) => {
                const isActive = i === active;
                const Icon = a.icon;
                return (
                  <li key={a.en}>
                    <button
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`wcj-${mode}-panel-${i}`}
                      id={`wcj-${mode}-tab-${i}`}
                      tabIndex={isActive ? 0 : -1}
                      ref={(el) => { tabRefs.current[i] = el; }}
                      onKeyDown={(e) => onKeyDownTab(e, i)}
                      onClick={() => setActive(i)}
                      className={`group relative w-full text-left flex items-center gap-3 pl-4 pr-3.5 py-3 rounded-xl border transition-all ${
                        isActive
                          ? 'bg-card border-brand/40 shadow-card'
                          : 'bg-card/60 border-border/60 hover:bg-card hover:border-border'
                      }`}
                    >
                      {/* Left accent bar */}
                      <span
                        className={`absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full transition-all ${
                          isActive ? 'bg-brand' : 'bg-transparent group-hover:bg-border'
                        }`}
                        aria-hidden
                      />
                      <span className={`font-mono text-[10.5px] w-7 shrink-0 transition-colors ${
                        isActive ? 'text-brand' : 'text-muted'
                      }`}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                        isActive
                          ? 'bg-brand text-white shadow-[0_6px_14px_-6px_rgba(5,78,232,0.55)]'
                          : 'bg-brand-mist text-brand group-hover:bg-brand/10'
                      }`}>
                        <Icon size={17} strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block font-display text-[13.5px] leading-tight tracking-tight transition-colors ${
                          isActive ? 'text-ink' : 'text-ink/85'
                        }`} style={{ fontWeight: 700 }}>
                          {lang === 'en' ? a.en : a.es}
                        </span>
                        <span className="block text-[10.5px] font-mono uppercase tracking-[0.14em] text-muted mt-0.5">
                          {lang === 'en' ? a.tag_en : a.tag_es}
                        </span>
                      </span>
                      <ArrowRight
                        size={14}
                        strokeWidth={2.25}
                        className={`shrink-0 transition-all ${
                          isActive
                            ? 'text-brand translate-x-0 opacity-100'
                            : 'text-muted -translate-x-1 opacity-0 group-hover:opacity-60 group-hover:translate-x-0'
                        }`}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* ── Feature canvas ──────────────────────────────── */}
        <div
          key={current.en}
          role="tabpanel"
          id={`wcj-${mode}-panel-${active}`}
          aria-labelledby={`wcj-${mode}-tab-${active}`}
          className="relative min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-surface-cream via-card to-brand-whisper/60 min-h-[420px]"
        >
          {/* Backdrop layers */}
          <svg
            className="absolute inset-0 w-full h-full text-brand/[0.06] pointer-events-none"
            aria-hidden
          >
            <defs>
              <pattern id={`wcj-dots-${active}`} x="0" y="0" width="22" height="22" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="1" fill="currentColor" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill={`url(#wcj-dots-${active})`} />
          </svg>
          <span className="absolute -top-24 -right-16 w-[360px] h-[360px] rounded-full bg-brand-mist/70 blur-3xl pointer-events-none" aria-hidden />
          <span className="absolute -bottom-24 -left-10 w-[280px] h-[280px] rounded-full bg-amber-mist/70 blur-3xl pointer-events-none" aria-hidden />

          {/* Giant watermark icon */}
          <div
            className="wcj-watermark absolute -right-6 -bottom-12 md:-right-2 md:-bottom-8 text-brand/[0.07] pointer-events-none origin-bottom-right"
            aria-hidden
          >
            <ActiveIcon size={340} strokeWidth={1} />
          </div>

          {/* Corner crosshair accents */}
          <span className="absolute top-4 left-4 w-3 h-3 border-t border-l border-brand/30 pointer-events-none" aria-hidden />
          <span className="absolute top-4 right-4 w-3 h-3 border-t border-r border-brand/30 pointer-events-none" aria-hidden />
          <span className="absolute bottom-4 left-4 w-3 h-3 border-b border-l border-brand/30 pointer-events-none" aria-hidden />
          <span className="absolute bottom-4 right-4 w-3 h-3 border-b border-r border-brand/30 pointer-events-none" aria-hidden />

          <div className="relative p-6 md:p-9 lg:p-10 wcj-panel-enter">
            {/* Chapter row */}
            <div className="flex items-center gap-3">
              <span className="font-display text-[42px] md:text-[54px] leading-none tracking-[-0.04em] text-brand" style={{ fontWeight: 700 }}>
                {String(active + 1).padStart(2, '0')}
              </span>
              <span className="flex flex-col">
                <span className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-muted">
                  {lang === 'en' ? 'segment' : 'segmento'} · {String(active + 1).padStart(2, '0')} / 06
                </span>
                <span className="text-[10.5px] font-mono uppercase tracking-[0.14em] text-brand/80 mt-1">
                  {lang === 'en' ? current.tag_en : current.tag_es}
                </span>
              </span>
              {/* Decorative hairline rule */}
              <span className="hidden md:block flex-1 h-px bg-gradient-to-r from-brand/30 via-border to-transparent ml-2" aria-hidden />
            </div>

            {/* Title */}
            <h3
              className="font-display text-[28px] md:text-[40px] lg:text-[44px] text-ink tracking-[-0.03em] leading-[1.02] mt-4"
              style={{ fontWeight: 700 }}
            >
              {lang === 'en' ? current.en : current.es}
              <span className="text-brand">.</span>
            </h3>

            {/* Pitch */}
            <p className="text-[14px] md:text-[15px] text-gray font-body mt-4 leading-relaxed max-w-xl">
              {pitch}
            </p>

            {/* Fit signals */}
            <div className="mt-7 max-w-xl">
              <span className="text-[10.5px] font-mono uppercase tracking-[0.18em] text-muted">
                {fitsTitle}
              </span>
              <ul className="mt-3 flex flex-wrap gap-2">
                {fits?.map((f) => (
                  <li
                    key={f}
                    className="inline-flex items-center gap-1.5 h-8 pl-2 pr-3.5 rounded-full bg-card border border-border/70 text-[12px] font-bold font-ui text-ink/80"
                  >
                    <span className="w-5 h-5 rounded-full bg-brand-mist text-brand flex items-center justify-center">
                      <Check size={11} strokeWidth={2.75} />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* Bottom row — CTA */}
            <div className="mt-8 flex flex-wrap items-center gap-4 md:gap-5">
              <button
                type="button"
                onClick={onScrollToForm}
                className="group inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-ink text-card text-[12.5px] font-bold font-ui hover:bg-brand hover:text-white transition-colors"
              >
                <ActiveIcon size={14} strokeWidth={2.25} />
                {ctaText}{(lang === 'en' ? current.tag_en : current.tag_es).toLowerCase()}
                <ArrowRight size={13} strokeWidth={2.5} className="transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   BENEFIT CARDS — icon-led feature grid (replaces the older
   checkmark list). Each card carries a title + a 1-line note.
   ───────────────────────────────────────────────────────── */

function BenefitCards({ items }: { items: BenefitItem[] }) {
  const { lang } = useLanguageStore();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 md:gap-4">
      {items.map((b) => {
        const Icon = b.icon;
        const t = lang === 'en' ? b.en.t : b.es.t;
        const d = lang === 'en' ? b.en.d : b.es.d;
        return (
          <div
            key={b.en.t}
            className="group relative overflow-hidden rounded-xl bg-card border border-border/70 hover:border-brand/40 hover:shadow-card transition-all p-5 md:p-6"
          >
            {/* Left border accent strip */}
            <span className="absolute inset-y-0 left-0 w-[3px] bg-transparent group-hover:bg-brand transition-colors" aria-hidden />
            <div className="flex items-start gap-3.5">
              <span className="shrink-0 w-11 h-11 rounded-xl bg-brand-mist text-brand flex items-center justify-center group-hover:scale-105 transition-transform">
                <Icon size={19} strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="font-display text-[15px] text-ink leading-tight tracking-tight" style={{ fontWeight: 700 }}>
                  {t}
                </p>
                <p className="text-[13px] text-gray font-body mt-1.5 leading-snug">
                  {d}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   STEP RAIL — editorial 5-step timeline. Horizontal on
   desktop with a hairline rail, vertical on mobile.
   ───────────────────────────────────────────────────────── */

function StepRail({ steps }: { steps: StepItem[] }) {
  const { lang } = useLanguageStore();
  return (
    <div className="relative">
      {/* Horizontal rail (desktop) */}
      <span
        className="hidden md:block absolute top-[26px] left-[26px] right-[26px] h-px bg-gradient-to-r from-border via-brand/30 to-border"
        aria-hidden
      />
      <ol className="relative grid grid-cols-1 md:grid-cols-5 gap-5 md:gap-3">
        {steps.map((s, i) => (
          <li key={i} className="relative flex md:flex-col gap-4 md:gap-3.5">
            <span className="shrink-0 relative z-10 w-[52px] h-[52px] rounded-xl bg-card border border-border shadow-card flex flex-col items-center justify-center">
              <span className="text-[9.5px] font-mono uppercase tracking-[0.14em] text-muted leading-none">step</span>
              <span className="font-display font-bold text-[16px] text-brand leading-none mt-1">{i + 1}</span>
            </span>
            <div className="min-w-0 md:mt-1">
              <p className="font-display text-[14.5px] text-ink leading-tight tracking-tight" style={{ fontWeight: 700 }}>
                {lang === 'en' ? s.en.t : s.es.t}
              </p>
              <p className="text-[12.5px] text-gray font-body mt-1.5 leading-snug">
                {lang === 'en' ? s.en.d : s.es.d}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   FAQ ACCORDION — common questions with a clean expand state.
   ───────────────────────────────────────────────────────── */

function FaqAccordion({ items }: { items: FaqItem[] }) {
  const { lang } = useLanguageStore();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="rounded-2xl bg-card border border-border/70 overflow-hidden">
      <ul className="divide-y divide-border/70">
        {items.map((it, i) => {
          const isOpen = open === i;
          return (
            <li key={it.q_en}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full flex items-center gap-4 text-left px-5 md:px-7 py-5 hover:bg-surface-linen/70 transition-colors"
                aria-expanded={isOpen}
              >
                <span className="text-[11px] font-mono text-muted w-6 shrink-0">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="flex-1 font-display text-[15px] md:text-[17px] text-ink leading-snug tracking-tight" style={{ fontWeight: 700 }}>
                  {lang === 'en' ? it.q_en : it.q_es}
                </span>
                <span
                  className={`shrink-0 w-9 h-9 rounded-full border border-border flex items-center justify-center transition-all ${
                    isOpen ? 'bg-brand text-white border-brand rotate-180' : 'bg-card text-ink'
                  }`}
                >
                  {isOpen ? <Minus size={15} strokeWidth={2.25} /> : <Plus size={15} strokeWidth={2.25} />}
                </span>
              </button>
              <div
                className={`grid transition-all duration-300 ease-out ${
                  isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="overflow-hidden">
                  <p className="px-5 md:px-7 pb-6 pt-0 pl-[68px] text-[13.5px] md:text-[14px] text-gray font-body leading-relaxed max-w-3xl">
                    {lang === 'en' ? it.a_en : it.a_es}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   CTA BANNER — gradient brand banner, mode-aware copy.
   ───────────────────────────────────────────────────────── */

function CtaBanner({ mode, onScrollToForm }: { mode: Mode; onScrollToForm: () => void }) {
  const { lang } = useLanguageStore();
  const copy = mode === 'partner_store'
    ? {
        title_en: "Ready to put your catalogue in front of Cesto's buyers?",
        title_es: '¿Listo para poner tu catálogo ante los compradores de Cesto?',
        body_en: 'Listing is free, and your orders arrive in one dashboard.',
        body_es: 'Listar es gratis, y tus pedidos llegan a un solo panel.',
        cta_en: 'Create partner account', cta_es: 'Crear cuenta de partner',
      }
    : {
        title_en: 'Open your business account',
        title_es: 'Abre tu cuenta de empresa',
        body_en: 'A free account, business prices and one panel for your orders.',
        body_es: 'Una cuenta gratis, precios de empresa y un panel para tus pedidos.',
        cta_en: 'Create business account', cta_es: 'Crear cuenta de empresa',
      };

  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-hero-1 via-hero-2 to-hero-3 text-white px-6 md:px-10 py-10 md:py-12">
      <div className="absolute -top-24 -right-16 w-[360px] h-[360px] rounded-full bg-white/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-24 -left-12 w-[300px] h-[300px] rounded-full bg-amber/20 blur-3xl pointer-events-none" />
      {/* Subtle grid */}
      <svg className="absolute inset-0 w-full h-full text-white/[0.06] pointer-events-none" aria-hidden>
        <defs>
          <pattern id="cta-grid" x="0" y="0" width="26" height="26" patternUnits="userSpaceOnUse">
            <path d="M 26 0 L 0 0 0 26" stroke="currentColor" strokeWidth="1" fill="none" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#cta-grid)" />
      </svg>

      <div className="relative grid md:grid-cols-[1fr_auto] items-center gap-6 md:gap-8">
        <div className="max-w-xl">
          <span className="inline-flex items-center gap-2 text-[10.5px] font-bold tracking-[0.16em] uppercase font-ui text-amber-mid bg-white/10 border border-white/15 rounded-full px-3 py-1.5">
            <Sparkles size={11} strokeWidth={2.5} />
            {lang === 'en' ? 'Get started' : 'Empieza ya'}
          </span>
          <h2 className="font-display text-[24px] md:text-[34px] tracking-[-0.025em] leading-[1.05] mt-4" style={{ fontWeight: 700 }}>
            {lang === 'en' ? copy.title_en : copy.title_es}
          </h2>
          <p className="text-[14px] md:text-[15px] text-white/85 font-body mt-3 leading-relaxed">
            {lang === 'en' ? copy.body_en : copy.body_es}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 md:justify-end">
          <button
            onClick={onScrollToForm}
            className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-amber text-on-accent text-[13.5px] font-bold font-ui hover:bg-amber-mid transition-colors shadow-lg"
          >
            {lang === 'en' ? copy.cta_en : copy.cta_es}
            <ArrowRight size={14} strokeWidth={2.5} />
          </button>
          <a
            href="/login"
            className="inline-flex items-center gap-2 h-12 px-5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-[13.5px] font-bold font-ui transition-colors border border-white/15"
          >
            <LogIn size={14} strokeWidth={2.25} />
            {lang === 'en' ? 'Sign in' : 'Iniciar sesión'}
          </a>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────
   REGISTRATION FORM — kept lean. Shared submit logic, label/
   copy switches by mode. Now wrapped with a side-panel that
   shows what happens after submission so the form feels less
   like a void.
   ───────────────────────────────────────────────────────── */

interface ShopState {
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  place_id: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
}

interface FormState {
  company: string;
  contact: string;
  email: string;
  phone: string;
  shops: ShopState[];
  business_type: string;
  website: string;
  registration_no: string;
}

const EMPTY_SHOP: ShopState = {
  name: '', address: '', lat: null, lng: null,
  place_id: null, city: null, postcode: null, country: null,
};

const EMPTY_FORM: FormState = {
  company: '', contact: '', email: '', phone: '',
  shops: [{ ...EMPTY_SHOP }],
  business_type: '', website: '', registration_no: '',
};

const GOOGLE_MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_KEY ?? '') as string;
const MAPS_LIBRARIES: ('places')[] = ['places'];

/**
 * Google Maps reports "ApiNotActivatedMapError" / "InvalidKeyMapError" /
 * "RefererNotAllowedMapError" via console.error only — no JS event, no DOM
 * signal we can reliably poll. We wrap console.error once at module load
 * and dispatch a CustomEvent so any mounted ShopsEditor can flip its
 * fallback state. This is intentionally global and idempotent.
 */
const MAPS_ERROR_EVENT = 'b2b-shops:maps-runtime-error';
type MapsHook = { __b2bMapsHooked?: boolean; __b2bMapsErrored?: boolean };
if (typeof window !== 'undefined' && !(window as unknown as MapsHook).__b2bMapsHooked) {
  const w = window as unknown as MapsHook;
  w.__b2bMapsHooked = true;
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      // Check every arg — Google sometimes splits the message across args
      // ("Google Maps JavaScript API error:", "ApiNotActivatedMapError").
      const joined = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
      if (/Google Maps|ApiNotActivatedMapError|InvalidKeyMapError|RefererNotAllowedMapError|BillingNotEnabledMapError/i.test(joined)) {
        w.__b2bMapsErrored = true;
        window.dispatchEvent(new CustomEvent(MAPS_ERROR_EVENT));
      }
    } catch {
      /* never let a logger wrapper throw */
    }
    originalError(...args);
  };
}

/**
 * Pull the city / postcode / country out of a Places result. Google returns
 * the address in structured components; we grep for the types we care about.
 */
function extractComponents(components: google.maps.GeocoderAddressComponent[] | undefined) {
  if (!components) return { city: null, postcode: null, country: null };
  const find = (t: string) => components.find((c) => c.types.includes(t))?.long_name ?? null;
  return {
    city:     find('locality') ?? find('postal_town') ?? find('administrative_area_level_2'),
    postcode: find('postal_code'),
    country:  find('country'),
  };
}

function RegistrationSection({ mode }: { mode: Mode }) {
  const { lang } = useLanguageStore();
  const toast = useToast();
  const submitLead = useSubmitLead();
  const messages = useValidationMessages();

  const businessTypes = mode === 'partner_store'
    ? PARTNER_STORE_AUDIENCE.map((a) => (lang === 'en' ? a.en : a.es))
    : BUSINESS_AUDIENCE.map((a) => (lang === 'en' ? a.en : a.es));

  const schema = useMemo(() => {
    const r = rules(messages);
    // address is the authoritative field. lat/lng come from Places when it
    // works; if Places is unavailable (API not enabled / offline) we still
    // accept a typed address so the form isn't a dead end — admins verify
    // the location manually in that case.
    const shopSchema = z.object({
      name:     z.string().trim().min(2, messages.required).max(120, messages.tooLong(120)),
      address:  z.string().trim().min(3, messages.required).max(300, messages.tooLong(300)),
      lat:      z.number().nullable(),
      lng:      z.number().nullable(),
      place_id: z.string().nullable(),
      city:     z.string().nullable(),
      postcode: z.string().nullable(),
      country:  z.string().nullable(),
    });
    return z.object({
      company:         r.name({ min: 2, max: 120 }),
      contact:         r.name({ min: 2, max: 100 }),
      email:           r.email(),
      // B2B applications come from suppliers/partners worldwide — international
      // format, not Spanish domestic.
      phone:           r.phoneIntl(),
      shops:           z.array(shopSchema).min(1, messages.required).max(20),
      business_type:   z.string().min(1, messages.required),
      website:         r.optionalUrl(),
      registration_no: z.string().trim().max(40, messages.tooLong(40)).optional().or(z.literal('')),
    });
  }, [messages, lang]);

  const {
    register, handleSubmit, reset, control, setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormState>({
    resolver: zodResolver(schema) as unknown as Resolver<FormState>,
    mode: 'onBlur',
    defaultValues: EMPTY_FORM,
  });

  const shopsField = useFieldArray({ control, name: 'shops' });

  const onSubmit = async (values: FormState) => {
    // Persist the shops list AND a legacy `location` summary so the admin
    // list/search (which still queries the flat `location` column) keeps
    // working without a second migration.
    const shops = values.shops.map((s) => ({
      name:     s.name.trim(),
      address:  s.address.trim(),
      lat:      typeof s.lat === 'number' ? s.lat : null,
      lng:      typeof s.lng === 'number' ? s.lng : null,
      place_id: s.place_id ?? null,
      city:     s.city ?? null,
      postcode: s.postcode ?? null,
      country:  s.country ?? null,
    }));
    const primaryLocation = shops[0]?.address ?? null;
    try {
      await submitLead.mutateAsync({
        // `mode` is this page's own presentation flag and is NOT the wire
        // value. mode="business" is the /b2b-deals wholesale-BUYER pitch, so
        // it submits type='business'; mode="partner_store" is /partner-deals,
        // the sell-on-Cesto form, so it submits type='partner_store'.
        // The old code sent `mode` straight through, which is how buyers
        // ended up in the store-creating approval queue. Do not "simplify"
        // this back to `type: mode`.
        type: mode === 'partner_store' ? 'partner_store' : 'business',
        // `source` still records which form furnished the row — unchanged,
        // funnel attribution depends on it.
        source: mode === 'partner_store' ? 'supplier_form' : 'partner_form',
        name: values.contact,
        company: values.company,
        email: values.email,
        phone: values.phone,
        location: primaryLocation,
        business_type: values.business_type,
        website: values.website || null,
        registration_no: values.registration_no || null,
        shops,
        language: lang,
      });
      toast.success(
        lang === 'en' ? 'Application sent' : 'Solicitud enviada',
        lang === 'en'
          ? "We'll write to you by email."
          : 'Te escribiremos por email.',
      );
      reset(EMPTY_FORM);
    } catch (err) {
      toast.error(
        lang === 'en' ? "We couldn't submit your application" : 'No pudimos enviar tu solicitud',
        err instanceof Error ? err.message : (lang === 'en' ? 'Please try again.' : 'Por favor, inténtalo de nuevo.'),
      );
    }
  };

  const salesPhone = useSalesPhone();
  const afterSubmit = lang === 'en'
    ? [
        { Icon: BadgeCheck, t: 'We review it',       d: 'A person on our team checks every application' },
        { Icon: Sparkles,   t: 'Access by email',    d: 'Once approved, your login reaches your inbox' },
        { Icon: Headphones, t: 'Help if you need it', d: 'Write to us and our team helps with setup' },
      ]
    : [
        { Icon: BadgeCheck, t: 'La revisamos',            d: 'Una persona del equipo mira cada solicitud' },
        { Icon: Sparkles,   t: 'Acceso por email',        d: 'Una vez aprobada, recibes el acceso en tu correo' },
        { Icon: Headphones, t: 'Ayuda si la necesitas',   d: 'Escríbenos y el equipo te ayuda con el alta' },
      ];

  return (
    <section className="grid lg:grid-cols-[1.4fr_1fr] gap-6 lg:gap-8 items-start">
      <form
        id="register-form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        // lg gets an extra 32px: the trade strip is pinned there too, so the
        // sticky header is 36 + 72 + 42 = 150px and scroll-mt-32 lands short.
        className="bg-card rounded-2xl border border-border/70 shadow-card p-6 md:p-8 lg:p-10 scroll-mt-32 lg:scroll-mt-40"
      >
        <SectionEyebrow>
          {mode === 'partner_store'
            ? (lang === 'en' ? 'Partner registration' : 'Registro de partner')
            : (lang === 'en' ? 'Business registration' : 'Registro de empresa')}
        </SectionEyebrow>
        <h2 className="font-display text-[24px] md:text-[30px] text-ink tracking-[-0.02em] mt-4 leading-[1.1]" style={{ fontWeight: 700 }}>
          {mode === 'partner_store'
            ? (lang === 'en' ? 'Tell us about your business' : 'Cuéntanos sobre tu negocio')
            : (lang === 'en' ? 'Tell us about your business' : 'Cuéntanos sobre tu negocio')}
        </h2>
        <p className="text-[13.5px] text-gray font-body mt-2.5">
          {lang === 'en'
            ? 'A few details and we review your application. Required fields are marked with *.'
            : 'Unos detalles y revisamos tu solicitud. Los campos obligatorios están marcados con *.'}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <FormField
            icon={Building2}
            label={lang === 'en' ? 'Business / Company name' : 'Nombre de la empresa'}
            required
            placeholder="Acme S.L."
            error={errors.company?.message}
            {...register('company')}
          />
          <FormField
            icon={User}
            label={lang === 'en' ? 'Contact person' : 'Persona de contacto'}
            required
            placeholder={lang === 'en' ? 'Full name' : 'Nombre completo'}
            error={errors.contact?.message}
            {...register('contact')}
          />
          <FormField
            icon={Mail}
            type="email"
            label={lang === 'en' ? 'Email address' : 'Email'}
            required
            placeholder="name@company.com"
            error={errors.email?.message}
            {...register('email')}
          />
          <FormField
            icon={Phone}
            type="tel"
            label={lang === 'en' ? 'Mobile number' : 'Teléfono móvil'}
            required
            placeholder="+34 600 000 000"
            error={errors.phone?.message}
            {...register('phone')}
          />
          <SelectField
            icon={Briefcase}
            label={lang === 'en' ? 'Business type' : 'Tipo de negocio'}
            required
            options={businessTypes}
            placeholder={lang === 'en' ? 'Select one' : 'Selecciona'}
            error={errors.business_type?.message}
            {...register('business_type')}
          />
          <FormField
            icon={LinkIcon}
            type="url"
            label={lang === 'en' ? 'Website (optional)' : 'Sitio web (opcional)'}
            placeholder="https://"
            error={errors.website?.message}
            {...register('website')}
          />
          <FormField
            icon={FileText}
            label={lang === 'en' ? 'Registration number (optional)' : 'CIF / NIF (opcional)'}
            placeholder="B12345678"
            error={errors.registration_no?.message}
            {...register('registration_no')}
          />
        </div>

        <ShopsEditor
          // Cast: RHF's inferred Control generics differ from the strict
          // Control<FormState> our editor asks for — same interop quirk as
          // the sibling forms in this repo. Runtime shape is correct.
          control={control as unknown as import('react-hook-form').Control<FormState>}
          setValue={setValue}
          shopsField={shopsField}
          errors={errors.shops as unknown as Array<Record<string, { message?: string }> | undefined> | undefined}
          rootError={(errors.shops as unknown as { message?: string } | undefined)?.message}
          lang={lang}
        />

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11.5px] text-muted font-ui max-w-md leading-snug">
            {lang === 'en'
              ? "By submitting you agree to our Terms. We'll only contact you about your application."
              : 'Al enviar aceptas nuestros Términos. Solo te contactaremos por tu solicitud.'}
          </p>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-brand text-white text-[13.5px] font-bold font-ui hover:bg-brand-deepest transition-colors shadow-brand disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? (lang === 'en' ? 'Sending…' : 'Enviando…')
              : mode === 'partner_store'
                ? (lang === 'en' ? 'Submit partner application' : 'Enviar solicitud de partner')
                : (lang === 'en' ? 'Submit business application' : 'Enviar solicitud de empresa')}
            <ArrowRight size={14} strokeWidth={2.5} />
          </button>
        </div>
      </form>

      {/* Side panel — what happens next */}
      <aside className="relative rounded-2xl bg-gradient-to-br from-brand-whisper via-surface-cream to-amber-mist/60 border border-border/70 p-6 md:p-7 overflow-hidden lg:sticky lg:top-24">
        <span className="absolute -top-12 -right-10 w-[200px] h-[200px] rounded-full bg-brand-mist/80 blur-3xl pointer-events-none" />
        <SectionEyebrow tone="amber">
          <Clock size={11} strokeWidth={2.5} />
          {lang === 'en' ? 'What happens next' : 'Qué pasa después'}
        </SectionEyebrow>
        <h3 className="font-display text-[20px] md:text-[22px] text-ink tracking-[-0.01em] mt-4 leading-tight" style={{ fontWeight: 700 }}>
          {lang === 'en' ? 'You send it. We review it.' : 'Tú la envías. Nosotros la revisamos.'}
        </h3>

        <ul className="relative mt-6 space-y-5">
          <span className="absolute left-[19px] top-2 bottom-2 w-px bg-border" aria-hidden />
          {afterSubmit.map((s, i) => (
            <li key={s.t} className="relative flex items-start gap-3.5">
              <span className="relative z-10 w-10 h-10 rounded-full bg-card border border-border flex items-center justify-center text-brand shadow-card">
                <s.Icon size={15} strokeWidth={2} />
              </span>
              <div className="min-w-0 pt-1">
                <p className="font-display text-[13.5px] text-ink leading-tight tracking-tight" style={{ fontWeight: 700 }}>
                  <span className="font-mono text-[10.5px] text-muted mr-2">0{i + 1}</span>
                  {s.t}
                </p>
                <p className="text-[12.5px] text-gray font-body mt-1 leading-snug">{s.d}</p>
              </div>
            </li>
          ))}
        </ul>

        {salesPhone && (
        <div className="mt-7 pt-5 border-t border-border/70">
          <p className="text-[11.5px] font-mono uppercase tracking-[0.14em] text-muted">
            {lang === 'en' ? 'Need a human first?' : '¿Hablar antes con alguien?'}
          </p>
          <a
            href={`tel:${salesPhone.replace(/\s/g, '')}`}
            className="mt-2 inline-flex items-center gap-2 text-[14px] font-bold font-display text-ink hover:text-brand transition-colors"
          >
            <Phone size={14} strokeWidth={2.25} className="text-brand" />
            {salesPhone}
          </a>
        </div>
        )}
      </aside>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────
   SHOPS EDITOR — repeatable list of shop locations, each with
   a Google Places Autocomplete input and a small map preview.
   If VITE_GOOGLE_MAPS_KEY is missing we degrade to plain text
   inputs (dev-friendly) so the form still submits.
   ───────────────────────────────────────────────────────── */

type ShopsEditorProps = {
  control: import('react-hook-form').Control<FormState>;
  setValue: import('react-hook-form').UseFormSetValue<FormState>;
  shopsField: ReturnType<typeof useFieldArray<FormState, 'shops'>>;
  errors: Array<Record<string, { message?: string }> | undefined> | undefined;
  rootError: string | undefined;
  lang: 'en' | 'es';
};

function ShopsEditor({ control, setValue, shopsField, errors, rootError, lang }: ShopsEditorProps) {
  const hasKey = GOOGLE_MAPS_KEY.length > 0;
  const { isLoaded, loadError } = useJsApiLoader({
    id: 'b2b-shops-maps',
    googleMapsApiKey: GOOGLE_MAPS_KEY,
    libraries: MAPS_LIBRARIES,
  });

  // Places JS loaded but the API returned an ApiNotActivatedMapError (or
  // similar) at runtime — child field flips this on. Switches every row's
  // autocomplete off and surfaces a clear banner instead of Google's
  // "Oops! Something went wrong." leaking through.
  const [placesRuntimeError, setPlacesRuntimeError] = useState(
    // Check the persistent flag — script errors fire before mount and would
    // otherwise be lost.
    () => typeof window !== 'undefined' && !!(window as unknown as { __b2bMapsErrored?: boolean }).__b2bMapsErrored,
  );
  useEffect(() => {
    const onError = () => setPlacesRuntimeError(true);
    window.addEventListener(MAPS_ERROR_EVENT, onError);
    return () => window.removeEventListener(MAPS_ERROR_EVENT, onError);
  }, []);
  const canUsePlaces = hasKey && isLoaded && !loadError && !placesRuntimeError;

  return (
    <section className="mt-7">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <span className="text-[12px] font-semibold font-ui text-ink inline-flex items-center gap-1.5">
            <Store size={13} strokeWidth={2} className="text-muted" />
            {lang === 'en' ? 'Your shop locations' : 'Ubicaciones de tus tiendas'}
            <span className="text-brand">*</span>
          </span>
          <p className="text-[11.5px] text-muted font-body mt-1 max-w-md leading-snug">
            {lang === 'en'
              ? 'Add every shop or warehouse you operate. Pick each address from the map so we can serve the right zone.'
              : 'Añade cada tienda o almacén. Selecciona cada dirección en el mapa para que asignemos la zona correcta.'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => shopsField.append({ ...EMPTY_SHOP })}
          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-border bg-card text-[12px] font-bold font-ui text-ink hover:border-brand hover:text-brand transition-colors"
        >
          <PlusCircle size={13} strokeWidth={2.25} />
          {lang === 'en' ? 'Add shop' : 'Añadir tienda'}
        </button>
      </div>

      {(loadError || placesRuntimeError) && (
        <div role="alert" className="mb-3 rounded-lg border border-danger/40 bg-danger/5 p-3 text-[12px] text-danger font-ui font-medium">
          {loadError
            ? (lang === 'en'
                ? "We couldn't load Google Maps. Type the address manually — an admin will verify the location."
                : 'No pudimos cargar Google Maps. Escribe la dirección manualmente — un administrador verificará la ubicación.')
            : (lang === 'en'
                ? "Address search is unavailable right now (Google Places API not activated on this key). Type the address manually and an admin will verify the location."
                : 'La búsqueda de direcciones no está disponible (Places API no activada en la clave). Escribe la dirección manualmente y un administrador verificará la ubicación.')}
        </div>
      )}

      <ul className="space-y-4">
        {shopsField.fields.map((field, index) => {
          const rowErrors = errors?.[index];
          const canRemove = shopsField.fields.length > 1;
          return (
            <li
              key={field.id}
              className="relative rounded-xl border border-border bg-surface-linen/60 p-4 md:p-5"
            >
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-[11px] font-mono uppercase tracking-[0.14em] text-muted">
                  {(lang === 'en' ? 'Shop ' : 'Tienda ')}
                  {String(index + 1).padStart(2, '0')}
                </span>
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => shopsField.remove(index)}
                    aria-label={lang === 'en' ? 'Remove shop' : 'Eliminar tienda'}
                    className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-bold font-ui text-danger hover:bg-danger/10 transition-colors"
                  >
                    <Trash2 size={12} strokeWidth={2.25} />
                    {lang === 'en' ? 'Remove' : 'Eliminar'}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Controller
                  control={control}
                  name={`shops.${index}.name` as const}
                  render={({ field: nameField }) => (
                    <FormField
                      icon={Store}
                      label={lang === 'en' ? 'Shop name' : 'Nombre de la tienda'}
                      required
                      placeholder={lang === 'en' ? 'e.g. Malviya Bazar Madrid' : 'ej. Malviya Bazar Madrid'}
                      error={rowErrors?.name?.message}
                      value={nameField.value}
                      onChange={nameField.onChange}
                      onBlur={nameField.onBlur}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name={`shops.${index}.address` as const}
                  render={({ field: addressField }) => (
                    <AddressAutocompleteField
                      lang={lang}
                      value={addressField.value}
                      onChange={addressField.onChange}
                      onBlur={addressField.onBlur}
                      onPlacePicked={(place) => {
                        const opts = { shouldValidate: true, shouldDirty: true };
                        setValue(`shops.${index}.address`,  place.address,  opts);
                        setValue(`shops.${index}.lat`,      place.lat,      opts);
                        setValue(`shops.${index}.lng`,      place.lng,      opts);
                        setValue(`shops.${index}.place_id`, place.place_id, opts);
                        setValue(`shops.${index}.city`,     place.city,     opts);
                        setValue(`shops.${index}.postcode`, place.postcode, opts);
                        setValue(`shops.${index}.country`,  place.country,  opts);
                      }}
                      canUsePlaces={canUsePlaces}
                      onPlacesRuntimeError={() => setPlacesRuntimeError(true)}
                      error={rowErrors?.address?.message}
                    />
                  )}
                />
              </div>

              {/* Mini map preview — always render the map (defaulted to
                  Madrid) once Maps JS is up, and re-center on the picked
                  location. Skip the map entirely when Maps is broken so
                  we don't ship a permanent gray box. */}
              <Controller
                control={control}
                name={`shops.${index}` as const}
                render={({ field: shopField }) => {
                  const s = shopField.value as ShopState;
                  const hasCoords = typeof s.lat === 'number' && typeof s.lng === 'number';
                  const mapUsable = isLoaded && !loadError && !placesRuntimeError;
                  const center = hasCoords
                    ? { lat: s.lat as number, lng: s.lng as number }
                    : { lat: 40.4168, lng: -3.7038 }; // Madrid default
                  return (
                    <div className="mt-4">
                      <div className="h-[180px] rounded-lg overflow-hidden border border-border bg-surface-cream relative">
                        {mapUsable ? (
                          <>
                            <GoogleMap
                              mapContainerStyle={{ width: '100%', height: '100%' }}
                              center={center}
                              zoom={hasCoords ? 15 : 11}
                              options={{
                                disableDefaultUI: true,
                                zoomControl: true,
                                gestureHandling: 'cooperative',
                                clickableIcons: false,
                              }}
                            >
                              {hasCoords && <Marker position={center} />}
                            </GoogleMap>
                            {!hasCoords && (
                              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-2">
                                <span className="inline-flex items-center gap-1.5 bg-card/95 border border-border rounded-full px-2.5 py-1 text-[11px] font-bold font-ui text-ink shadow-card">
                                  <MapPin size={11} strokeWidth={2.25} className="text-brand" />
                                  {lang === 'en'
                                    ? 'Pick an address above to drop a pin'
                                    : 'Elige una dirección arriba para marcar el pin'}
                                </span>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="h-full w-full flex flex-col items-center justify-center text-muted text-[12px] font-ui gap-1 px-4 text-center">
                            <MapPin size={16} strokeWidth={1.75} />
                            <span>
                              {lang === 'en'
                                ? 'Map preview unavailable — the address you type will still be sent.'
                                : 'Vista previa del mapa no disponible — la dirección escrita se enviará igual.'}
                            </span>
                          </div>
                        )}
                      </div>
                      {hasCoords && (s.city || s.postcode || s.country) && (
                        <p className="mt-2 text-[11.5px] text-muted font-mono">
                          {[s.city, s.postcode, s.country].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                  );
                }}
              />
            </li>
          );
        })}
      </ul>

      {rootError && (
        <p role="alert" className="mt-2 text-[12px] text-danger font-ui font-medium">
          {rootError}
        </p>
      )}
    </section>
  );
}

type PickedPlace = {
  address: string;
  lat: number;
  lng: number;
  place_id: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
};

/**
 * When Places API isn't enabled on the Google Cloud project, Google's
 * Autocomplete widget silently overwrites the input's placeholder with
 * "Oops! Something went wrong." and refuses to work. We watch for it via
 * MutationObserver and switch to a clean plain-text fallback + warning.
 */
const PLACES_ERROR_MARKER = 'Oops! Something went wrong';

function AddressAutocompleteField({
  lang, value, onChange, onBlur, onPlacePicked, canUsePlaces, error,
  onPlacesRuntimeError,
}: {
  lang: 'en' | 'es';
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  onPlacePicked: (p: PickedPlace) => void;
  canUsePlaces: boolean;
  error?: string;
  onPlacesRuntimeError: () => void;
}) {
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const defaultPlaceholder = lang === 'en' ? 'Start typing a street, city…' : 'Escribe una calle, ciudad…';

  // Watch for Google hijacking our placeholder (ApiNotActivatedMapError etc.)
  useEffect(() => {
    const el = inputRef.current;
    if (!el || !canUsePlaces) return;
    const check = () => {
      const p = el.placeholder ?? '';
      const v = el.value ?? '';
      if (p.includes(PLACES_ERROR_MARKER) || v.includes(PLACES_ERROR_MARKER)) {
        if (v.includes(PLACES_ERROR_MARKER)) onChange('');
        onPlacesRuntimeError();
      }
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(el, { attributes: true, attributeFilter: ['placeholder', 'value'] });
    return () => observer.disconnect();
  }, [canUsePlaces, onChange, onPlacesRuntimeError]);

  function handlePlaceChanged() {
    const place = autocompleteRef.current?.getPlace();
    if (!place || !place.geometry?.location) return;
    const lat = place.geometry.location.lat();
    const lng = place.geometry.location.lng();
    const parts = extractComponents(place.address_components);
    onPlacePicked({
      address:  place.formatted_address ?? place.name ?? '',
      lat,
      lng,
      place_id: place.place_id ?? null,
      city:     parts.city,
      postcode: parts.postcode,
      country:  parts.country,
    });
  }

  const ring = error
    ? 'border-danger focus:ring-danger/20 focus:border-danger'
    : 'border-border focus:ring-brand/30 focus:border-brand';

  const input = (
    <input
      ref={inputRef}
      type="text"
      placeholder={defaultPlaceholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      aria-invalid={error ? true : undefined}
      className={`w-full bg-card border rounded-xl h-11 pl-9 pr-3.5 text-[13.5px] font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 transition ${ring}`}
    />
  );

  return (
    <label className="block">
      <span className="text-[12px] font-semibold font-ui text-ink mb-1.5 inline-flex items-center gap-1.5">
        <MapPin size={13} strokeWidth={2} className="text-muted" />
        {lang === 'en' ? 'Shop address' : 'Dirección de la tienda'}
        <span className="text-brand">*</span>
      </span>
      <div className="relative">
        <Search size={14} strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        {canUsePlaces ? (
          <Autocomplete
            onLoad={(a) => { autocompleteRef.current = a; }}
            onPlaceChanged={handlePlaceChanged}
            options={{ fields: ['formatted_address', 'geometry', 'place_id', 'address_components', 'name'] }}
          >
            {input}
          </Autocomplete>
        ) : input}
      </div>
      {error && (
        <span role="alert" className="block mt-1 text-[11.5px] text-danger font-ui font-medium">
          {error}
        </span>
      )}
    </label>
  );
}

type FormFieldProps = {
  icon: LucideIcon; label: string; required?: boolean;
  placeholder?: string; type?: string; error?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'className' | 'placeholder'>;

const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  { icon: Icon, label, required, placeholder, type = 'text', error, ...inputProps }, ref,
) {
  /**
   * AN EMAIL FIELD IS A LOWER-CASE FIELD. `users.email` is a plain unique
   * column, so Omar@gmail.com and omar@gmail.com were two different accounts
   * — on 2026-10-10 three people had ended up with two each and b2b clients
   * could not sign in with the address in their own welcome email. The API
   * normalises too and that is the guarantee; this is so the field shows what
   * will be stored. Assigning to e.target.value moves the caret to the end,
   * so it only happens when the text actually changes.
   */
  const isEmail = type === 'email';
  const forwardedChange = inputProps.onChange;
  const handleChange = isEmail
    ? (e: ChangeEvent<HTMLInputElement>) => {
        const lower = e.target.value.toLowerCase();
        if (e.target.value !== lower) e.target.value = lower;
        forwardedChange?.(e);
      }
    : forwardedChange;
  const ring = error
    ? 'border-danger focus:ring-danger/20 focus:border-danger'
    : 'border-border focus:ring-brand/30 focus:border-brand';
  return (
    <label className="block">
      <span className="text-[12px] font-semibold font-ui text-ink mb-1.5 inline-flex items-center gap-1.5">
        <Icon size={13} strokeWidth={2} className="text-muted" />
        {label}
        {required && <span className="text-brand">*</span>}
      </span>
      <input
        ref={ref}
        type={type}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        className={`w-full bg-surface-linen border rounded-xl h-11 px-3.5 text-[13.5px] font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 transition ${ring}`}
        {...(isEmail
          ? { autoCapitalize: 'none' as const, autoCorrect: 'off', spellCheck: false }
          : {})}
        {...inputProps}
        onChange={handleChange}
      />
      {error && (
        <span role="alert" className="block mt-1 text-[11.5px] text-danger font-ui font-medium">
          {error}
        </span>
      )}
    </label>
  );
});

type SelectFieldProps = {
  icon: LucideIcon; label: string; required?: boolean;
  options: string[]; placeholder?: string; error?: string;
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className'>;

const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { icon: Icon, label, required, options, placeholder, error, ...selectProps }, ref,
) {
  const ring = error
    ? 'border-danger focus:ring-danger/20 focus:border-danger'
    : 'border-border focus:ring-brand/30 focus:border-brand';
  return (
    <label className="block">
      <span className="text-[12px] font-semibold font-ui text-ink mb-1.5 inline-flex items-center gap-1.5">
        <Icon size={13} strokeWidth={2} className="text-muted" />
        {label}
        {required && <span className="text-brand">*</span>}
      </span>
      <select
        ref={ref}
        aria-invalid={error ? true : undefined}
        className={`w-full bg-surface-linen border rounded-xl h-11 px-3.5 text-[13.5px] font-ui text-ink focus:outline-none focus:ring-2 transition ${ring}`}
        {...selectProps}
      >
        <option value="" disabled>{placeholder ?? 'Select'}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      {error && (
        <span role="alert" className="block mt-1 text-[11.5px] text-danger font-ui font-medium">
          {error}
        </span>
      )}
    </label>
  );
});

/* ─────────────────────────────────────────────────────────
   PER-MODE CONTENT
   ───────────────────────────────────────────────────────── */

function PartnerStoreContent({ onScrollToForm }: { onScrollToForm: () => void }) {
  const { lang } = useLanguageStore();
  return (
    <div className="flex flex-col gap-14 md:gap-20">
      <section>
        <SectionHeader
          eyebrow={lang === 'en' ? 'Who can join' : 'Quién puede unirse'}
          title={lang === 'en' ? 'Built for the makers and movers' : 'Para quienes fabrican y mueven'}
          kicker={lang === 'en' ? '· 06 segments' : '· 06 segmentos'}
          subtitle={lang === 'en'
            ? "If you make it, source it, ship it or distribute it — there's a Cesto seat for you."
            : 'Si lo fabricas, lo importas, lo distribuyes o lo envías — Cesto es para ti.'}
        />
        <WhoCanJoin items={PARTNER_STORE_AUDIENCE} mode="partner_store" onScrollToForm={onScrollToForm} />
      </section>

      <section>
        <SectionHeader
          align="left"
          eyebrow={lang === 'en' ? 'Benefits' : 'Beneficios'}
          title={lang === 'en' ? 'What you get on day one' : 'Lo que tienes desde el primer día'}
          subtitle={lang === 'en'
            ? 'List your products once and run your shop from one dashboard.'
            : 'Lista tus productos una vez y gestiona tu tienda desde un único panel.'}
        />
        <BenefitCards items={PARTNER_STORE_BENEFITS} />
      </section>

      <section>
        <SectionHeader
          align="left"
          eyebrow={lang === 'en' ? 'Onboarding flow' : 'Cómo es el alta'}
          title={lang === 'en' ? 'From application to first order' : 'De la solicitud al primer pedido'}
          subtitle={lang === 'en'
            ? 'No paperwork-heavy back-and-forth.'
            : 'Sin trámites pesados.'}
        />
        <StepRail steps={PARTNER_STORE_STEPS} />
      </section>

      <RegistrationSection mode="partner_store" />

      <section>
        <SectionHeader
          align="left"
          eyebrow={lang === 'en' ? 'Common questions' : 'Preguntas frecuentes'}
          title={lang === 'en' ? 'Things partners usually ask first' : 'Lo que suelen preguntar los partners'}
        />
        <FaqAccordion items={PARTNER_STORE_FAQ} />
      </section>

      <CtaBanner mode="partner_store" onScrollToForm={onScrollToForm} />
    </div>
  );
}

function BusinessContent({ onScrollToForm }: { onScrollToForm: () => void }) {
  const { lang } = useLanguageStore();
  return (
    <div className="flex flex-col gap-14 md:gap-20">
      <section>
        <SectionHeader
          align="left"
          eyebrow={lang === 'en' ? 'Why join' : 'Por qué unirte'}
          title={lang === 'en' ? 'Wholesale, on your terms' : 'Mayoreo, a tu manera'}
          subtitle={lang === 'en'
            ? 'A business account gives you wholesale prices and one panel for your orders.'
            : 'Con una cuenta de empresa tienes precios mayoristas y un panel para tus pedidos.'}
        />
        <BenefitCards items={BUSINESS_BENEFITS} />
      </section>

      <section>
        <SectionHeader
          eyebrow={lang === 'en' ? 'Who can join' : 'Quién puede unirse'}
          title={lang === 'en' ? 'For every kind of buyer' : 'Para todo tipo de comprador'}
          kicker={lang === 'en' ? '· 06 segments' : '· 06 segmentos'}
          subtitle={lang === 'en'
            ? 'From corner shops to multi-warehouse importers — and everyone sourcing in between.'
            : 'Desde tiendas de barrio hasta importadores con varios almacenes — y todo lo que hay entre medias.'}
        />
        <WhoCanJoin items={BUSINESS_AUDIENCE} mode="business" onScrollToForm={onScrollToForm} />
      </section>

      <section>
        <SectionHeader
          align="left"
          eyebrow={lang === 'en' ? 'How it works' : 'Cómo funciona'}
          title={lang === 'en' ? 'From application to first order' : 'De la solicitud al primer pedido'}
          subtitle={lang === 'en'
            ? "Tell us about your business, and you can order once we've approved it."
            : 'Cuéntanos sobre tu negocio y, en cuanto lo aprobemos, ya puedes pedir.'}
        />
        <StepRail steps={BUSINESS_STEPS} />
      </section>

      <RegistrationSection mode="business" />

      <section>
        <SectionHeader
          align="left"
          eyebrow={lang === 'en' ? 'Common questions' : 'Preguntas frecuentes'}
          title={lang === 'en' ? 'Things businesses usually ask first' : 'Lo que suelen preguntar las empresas'}
        />
        <FaqAccordion items={BUSINESS_FAQ} />
      </section>

      <CtaBanner mode="business" onScrollToForm={onScrollToForm} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   CONTACT SALES — always at the bottom regardless of tab
   ───────────────────────────────────────────────────────── */

function ContactSales({ onOpenContact }: { onOpenContact: (initial?: ContactIntent) => void }) {
  const salesPhone = useSalesPhone();
  const { lang } = useLanguageStore();
  return (
    <section
      id="contact"
      className="relative rounded-2xl border border-border/70 bg-card px-6 md:px-10 py-9 md:py-10 overflow-hidden"
    >
      <span className="absolute -top-16 -right-12 w-[260px] h-[260px] rounded-full bg-amber-mist/70 blur-3xl pointer-events-none" />
      <div className="relative grid lg:grid-cols-[1fr_auto] items-start gap-6 lg:items-center">
        <div className="max-w-2xl">
          <SectionEyebrow tone="amber">
            <Headphones size={11} strokeWidth={2.5} />
            {lang === 'en' ? 'Talk to sales' : 'Habla con ventas'}
          </SectionEyebrow>
          <h2 className="font-display text-[24px] md:text-[30px] text-ink tracking-[-0.02em] mt-4 leading-[1.1]" style={{ fontWeight: 700 }}>
            {lang === 'en'
              ? 'Need help getting started?'
              : '¿Necesitas ayuda para empezar?'}
          </h2>
          <p className="text-[13.5px] md:text-[14.5px] text-gray font-body mt-3 leading-relaxed">
            {lang === 'en'
              ? 'Our team helps suppliers, manufacturers, distributors, resellers and business buyers with signing up.'
              : 'Nuestro equipo ayuda a proveedores, fabricantes, distribuidores, vendedores y compradores con el alta.'}
          </p>
          <div className="flex items-center flex-wrap gap-x-5 gap-y-2 mt-4 text-[12.5px] text-gray font-ui">
            <span className="inline-flex items-center gap-1.5">
              <Globe2 size={13} strokeWidth={2} className="text-brand" />
              {lang === 'en' ? 'EN · ES support' : 'Soporte EN · ES'}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onOpenContact()}
            className="inline-flex items-center gap-2 h-12 px-6 rounded-xl bg-brand text-white text-[13.5px] font-bold font-ui hover:bg-brand-deepest transition-colors shadow-brand"
          >
            <MessageSquare size={14} strokeWidth={2.25} />
            {lang === 'en' ? 'Contact sales team' : 'Hablar con ventas'}
          </button>
          {salesPhone && (
          <a
            href={`tel:${salesPhone.replace(/\s/g, '')}`}
            className="inline-flex items-center gap-2 h-12 px-5 rounded-xl border border-border bg-card text-ink text-[13.5px] font-bold font-ui hover:border-brand hover:text-brand transition-colors"
          >
            <Phone size={14} strokeWidth={2.25} />
            {salesPhone}
          </a>
          )}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────
   CONTACT-SALES MODAL — clean inline lead form.
   ───────────────────────────────────────────────────────── */

type ContactIntent = 'supplier' | 'partner' | 'general';

interface ContactState {
  name: string;
  company: string;
  email: string;
  phone: string;
  intent: ContactIntent;
  message: string;
}

const EMPTY_CONTACT: ContactState = {
  name: '', company: '', email: '', phone: '',
  intent: 'general', message: '',
};

function ContactSalesModal({
  open, onClose, initialIntent,
}: { open: boolean; onClose: () => void; initialIntent?: ContactIntent }) {
  const { lang } = useLanguageStore();
  const toast = useToast();
  const submitLead = useSubmitLead();
  const messages = useValidationMessages();
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      name:    r.name({ min: 2, max: 100 }),
      company: r.name({ min: 2, max: 120 }),
      email:   r.email(),
      phone:   r.phoneIntl(),
      intent:  z.enum(['supplier', 'partner', 'general']),
      message: z.string().trim().min(10, messages.tooShort(10)).max(2000, messages.tooLong(2000)),
    });
  }, [messages]);

  const {
    register, handleSubmit, reset, setValue, watch,
    formState: { errors, isSubmitting },
  } = useForm<ContactState>({
    resolver: zodResolver(schema) as unknown as Resolver<ContactState>,
    mode: 'onBlur',
    defaultValues: EMPTY_CONTACT,
  });

  const intent = watch('intent');

  useEffect(() => {
    if (!open) return;
    reset({ ...EMPTY_CONTACT, intent: initialIntent ?? 'general' });
    const id = window.setTimeout(() => firstFieldRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open, initialIntent, reset]);

  // Keep a tiny `set` helper alive for the intent pill toggle which isn't
  // wired through register(). Cast is because RHF's Path<T>/PathValue<T>
  // generics don't map cleanly to `keyof T`/`T[K]` for object roots.
  const set = <K extends keyof ContactState>(k: K, v: ContactState[K]) =>
    (setValue as (name: K, value: ContactState[K], opts: { shouldValidate: boolean }) => void)(k, v, { shouldValidate: false });
  // Mirror old `form` shape for the few read sites below (intent only).
  const form = { intent } as ContactState;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const intentOptions: { key: ContactIntent; en: string; es: string }[] = [
    { key: 'supplier', en: "I want to sell on Cesto", es: 'Quiero vender en Cesto' },
    { key: 'partner',  en: "I want to buy wholesale", es: 'Quiero comprar al por mayor' },
    { key: 'general',  en: 'Something else',    es: 'Otra consulta' },
  ];

  const onSubmit = async (values: ContactState) => {
    try {
      await submitLead.mutateAsync({
        type: 'contact',
        source: 'sales_modal',
        name: values.name,
        company: values.company,
        email: values.email,
        phone: values.phone,
        intent: values.intent,
        message: values.message,
        language: lang,
      });
      toast.success(
        lang === 'en' ? 'Sent — thanks!' : 'Enviado, ¡gracias!',
        lang === 'en'
          ? "We'll reply by email."
          : 'Te responderemos por email.',
      );
      onClose();
    } catch (err) {
      toast.error(
        lang === 'en' ? "We couldn't send your message" : 'No pudimos enviar tu mensaje',
        err instanceof Error ? err.message : (lang === 'en' ? 'Please try again.' : 'Por favor, inténtalo de nuevo.'),
      );
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-sales-title"
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
    >
      <button
        type="button"
        aria-label={lang === 'en' ? 'Close contact form' : 'Cerrar formulario'}
        onClick={onClose}
        className="absolute inset-0 bg-veil/40 backdrop-blur-sm animate-[fadeIn_120ms_ease-out]"
      />
      <div
        className="relative w-full md:max-w-[560px] max-h-[92vh] bg-card md:rounded-2xl rounded-t-2xl shadow-[0_28px_80px_rgba(15,23,42,0.22)] overflow-hidden flex flex-col"
      >
        <div className="relative bg-gradient-to-br from-brand-whisper via-card to-brand-mist/60 px-6 md:px-8 py-6 border-b border-border/60">
          <div className="absolute -top-10 -right-8 w-[180px] h-[180px] rounded-full bg-brand/[0.06] blur-2xl pointer-events-none" />
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === 'en' ? 'Close' : 'Cerrar'}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-card border border-border hover:border-brand hover:text-brand text-ink flex items-center justify-center transition-colors"
          >
            <X size={16} strokeWidth={2.25} />
          </button>
          <SectionEyebrow>
            <Headphones size={11} strokeWidth={2.5} />
            {lang === 'en' ? 'Talk to sales' : 'Habla con ventas'}
          </SectionEyebrow>
          <h2
            id="contact-sales-title"
            className="font-display text-[22px] md:text-[24px] text-ink tracking-tight mt-3 leading-[1.15]"
            style={{ fontWeight: 700 }}
          >
            {lang === 'en' ? 'Tell us about your business' : 'Cuéntanos sobre tu negocio'}
          </h2>
          <p className="text-[13px] text-gray font-body mt-1.5 leading-snug">
            {lang === 'en'
              ? 'Our team will reply by email.'
              : 'Nuestro equipo te responderá por email.'}
          </p>
        </div>

        <form id="contact-sales-form" onSubmit={handleSubmit(onSubmit)} noValidate className="px-6 md:px-8 py-6 overflow-y-auto flex-1">
          <div>
            <span className="text-[12px] font-semibold font-ui text-ink mb-2 block">
              {lang === 'en' ? "I'm reaching out as…" : 'Contacto como…'}
            </span>
            <div className="inline-flex p-1 rounded-full bg-surface-linen border border-border w-full">
              {intentOptions.map((opt) => {
                const active = form.intent === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => set('intent', opt.key)}
                    className={`flex-1 h-9 px-3 rounded-full text-[12px] font-bold font-ui transition-colors ${
                      active ? 'bg-brand text-white shadow-sm' : 'text-ink/70 hover:text-ink'
                    }`}
                    aria-pressed={active}
                  >
                    {lang === 'en' ? opt.en : opt.es}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
            <FormField
              icon={User}
              label={lang === 'en' ? 'Your name' : 'Tu nombre'}
              required
              placeholder={lang === 'en' ? 'Full name' : 'Nombre completo'}
              error={errors.name?.message}
              {...register('name')}
              ref={(el) => {
                register('name').ref(el);
                firstFieldRef.current = el;
              }}
            />
            <FormField
              icon={Building2}
              label={lang === 'en' ? 'Company' : 'Empresa'}
              required
              placeholder="Acme S.L."
              error={errors.company?.message}
              {...register('company')}
            />
            <FormField
              icon={Mail}
              type="email"
              label={lang === 'en' ? 'Work email' : 'Email de trabajo'}
              required
              placeholder="name@company.com"
              error={errors.email?.message}
              {...register('email')}
            />
            <FormField
              icon={Phone}
              type="tel"
              label={lang === 'en' ? 'Phone' : 'Teléfono'}
              required
              placeholder="+34 600 000 000"
              error={errors.phone?.message}
              {...register('phone')}
            />
          </div>

          <label className="block mt-4">
            <span className="text-[12px] font-semibold font-ui text-ink mb-1.5 inline-flex items-center gap-1.5">
              <MessageSquare size={13} strokeWidth={2} className="text-muted" />
              {lang === 'en' ? 'How can we help?' : '¿Cómo podemos ayudarte?'}
              <span className="text-brand">*</span>
            </span>
            <textarea
              rows={4}
              placeholder={lang === 'en'
                ? "A short description of what you're looking for, expected volumes, regions, etc."
                : 'Cuéntanos brevemente qué buscas: volúmenes esperados, regiones, etc.'}
              aria-invalid={errors.message ? true : undefined}
              className={`w-full bg-surface-linen border rounded-xl px-3.5 py-3 text-[13.5px] font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 transition resize-none ${
                errors.message
                  ? 'border-danger focus:ring-danger/20 focus:border-danger'
                  : 'border-border focus:ring-brand/30 focus:border-brand'
              }`}
              {...register('message')}
            />
            {errors.message?.message && (
              <span role="alert" className="block mt-1 text-[11.5px] text-danger font-ui font-medium">
                {errors.message.message}
              </span>
            )}
          </label>

          <p className="text-[11.5px] text-muted font-ui mt-4 leading-snug">
            {lang === 'en'
              ? 'By submitting you agree we may contact you about your enquiry. We never share your details.'
              : 'Al enviar aceptas que te contactemos sobre tu consulta. Nunca compartimos tus datos.'}
          </p>
        </form>

        <div className="px-6 md:px-8 py-4 border-t border-border/60 bg-surface-linen flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] font-bold font-ui text-gray hover:text-ink transition-colors"
          >
            {lang === 'en' ? 'Cancel' : 'Cancelar'}
          </button>
          <button
            type="submit"
            form="contact-sales-form"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-brand text-white text-[13px] font-bold font-ui hover:bg-brand-deepest transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? (lang === 'en' ? 'Sending…' : 'Enviando…')
              : (lang === 'en' ? 'Send message' : 'Enviar mensaje')}
            <ArrowRight size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   TRUST STRIP — closing band
   ───────────────────────────────────────────────────────── */

const TRUST: { icon: LucideIcon; title_en: string; title_es: string; desc_en: string; desc_es: string }[] = [
  { icon: ShieldCheck, title_en: 'Verified accounts', title_es: 'Cuentas verificadas',
    desc_en: 'Every partner & business is reviewed', desc_es: 'Cada partner y empresa es revisada' },
  { icon: Wallet,      title_en: 'Buyer protection',  title_es: 'Protección al comprador',
    desc_en: 'Clear return & refund policies',        desc_es: 'Devoluciones y reembolsos claros' },
  { icon: Headphones,  title_en: 'A real team',       title_es: 'Un equipo real',
    desc_en: 'Write to us by WhatsApp or email',      desc_es: 'Escríbenos por WhatsApp o email' },
];

function TrustStrip() {
  const { lang } = useLanguageStore();
  return (
    <section className="border-t border-border pt-10">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 md:gap-6">
        {TRUST.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.title_en} className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-brand-mist text-brand flex items-center justify-center shrink-0 mt-0.5">
                <Icon size={18} strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="font-display text-[14px] text-ink leading-tight tracking-tight" style={{ fontWeight: 700 }}>
                  {lang === 'en' ? t.title_en : t.title_es}
                </p>
                <p className="text-[12.5px] text-gray font-ui mt-1 leading-snug">
                  {lang === 'en' ? t.desc_en : t.desc_es}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────
   PAGE
   ───────────────────────────────────────────────────────── */

export default function B2bDealsPage({ mode }: { mode: Mode }) {
  const [contactOpen, setContactOpen] = useState(false);
  const [contactIntent, setContactIntent] = useState<ContactIntent | undefined>(undefined);

  const Content = useMemo(
    () => (mode === 'partner_store' ? PartnerStoreContent : BusinessContent),
    [mode],
  );

  function scrollToForm() {
    document.getElementById('register-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // The navbar's "Join us — Wholesale prices" link lands here with
  // #register-form. React Router owns the URL, so the browser never performs
  // its own fragment scroll — do it once the section has actually mounted.
  const hash = useLocation().hash;
  useEffect(() => {
    if (hash !== '#register-form') return;
    const raf = requestAnimationFrame(() => scrollToForm());
    return () => cancelAnimationFrame(raf);
  }, [hash]);

  function openContact(intent?: ContactIntent) {
    // ContactIntent is a separate vocabulary from Mode: its values are
    // persisted verbatim on B2bLead.intent and were deliberately left
    // un-remapped by 20260727120000, so existing rows stay comparable.
    // This used to read `intent ?? mode` and only compiled because the two
    // unions happened to share members — map explicitly instead.
    const modeIntent: ContactIntent = mode === 'partner_store' ? 'supplier' : 'partner';
    setContactIntent(intent ?? modeIntent);
    setContactOpen(true);
  }

  return (
    <div className="bg-surface-linen min-h-screen overflow-x-clip">
      <div className="max-w-[1500px] mx-auto px-4 lg:px-6 py-6 lg:py-8 flex flex-col gap-10 md:gap-14 min-w-0">
        <Hero mode={mode} onScrollToForm={scrollToForm} onOpenContact={openContact} />
        <LogoMarquee />
        <Content onScrollToForm={scrollToForm} />
        <ContactSales onOpenContact={openContact} />
        <TrustStrip />
      </div>
      <ContactSalesModal
        open={contactOpen}
        initialIntent={contactIntent}
        onClose={() => setContactOpen(false)}
      />
    </div>
  );
}
