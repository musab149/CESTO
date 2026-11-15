import { useId, useRef } from 'react';
import { ArrowRight, Clock, Globe2, LayoutGrid, MapPin, PackageCheck, Store, Tag } from 'lucide-react';
import { resolveImageUrl, type ShopHours } from '@grocery-app/shared';
import { useSalesT } from '../../lib/i18n';
import { clock, todayHours } from '../../lib/shopHours';
import { Skeleton } from '../Skeleton';
import { BROWSE_KINDS, HOUSE_TINT, tintOf, useCountLine, useImage, type BrowseKind, type Tint } from './data';
import { logoPlate } from '@/lib/logoPlate';

/*
 * The Catálogo's ways in (2026-10-28, user: "change the catalogue to
 * something like this for reps... If they select store then the store cards
 * will show and then they select the store and then they go to that one...
 * Similarly if they select the category... Similarly for origin and brands").
 *
 * Four tabs as four big buttons, as the mockup draws them, and under each its
 * own kind of card — each shaped by what the office actually uploads for it:
 *   · a shop: its banner (5:2), its name, today's hours, "Ver tienda";
 *   · a category: its square photo, the name under it;
 *   · an origin: a tall picture, or a tint with a globe while it has none;
 *   · a brand: its logo on its own background.
 * A card without its picture never shows an empty box: a tint in one of the
 * panel's families, picked by the row's id so it keeps its colour. A picture
 * that fails to load counts as none.
 */


const KIND_ICON: Record<BrowseKind, React.ElementType> = { stores: Store, categories: LayoutGrid, origins: MapPin, brands: Tag };

/** The four tabs: icon over name on a phone, side by side from md. */
export function BrowseTabs({ value, onChange }: { value: BrowseKind; onChange: (k: BrowseKind) => void }) {
  const t = useSalesT();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // Arrow keys move between tabs, as a tab list does.
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + BROWSE_KINDS.length) % BROWSE_KINDS.length;
    onChange(BROWSE_KINDS[next]);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={t('sales.catalogue.browseBy')} className="grid grid-cols-4 gap-2 sm:gap-2.5 md:max-w-[720px]">
      {BROWSE_KINDS.map((k, i) => {
        const on = value === k;
        const Icon = KIND_ICON[k];
        return (
          <button
            key={k}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="tab"
            id={`catalogue-tab-${k}`}
            aria-selected={on}
            aria-controls="catalogue-panel"
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(k)}
            onKeyDown={(e) => onKey(e, i)}
            className={`min-w-0 h-[76px] md:h-[52px] px-1.5 rounded-2xl flex flex-col md:flex-row items-center justify-center gap-1.5 md:gap-2.5 text-[13px] md:text-[14.5px] font-semibold font-display transition-[background-color,border-color,color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              on
                ? 'bg-brand text-white shadow-[0_10px_24px_-12px_rgba(5,78,232,0.75)]'
                : 'bg-card border border-border text-ink shadow-card hover:border-brand/40'
            }`}
          >
            <Icon size={23} strokeWidth={1.75} className={`shrink-0 md:w-5 md:h-5 ${on ? 'text-white' : 'text-brand'}`} />
            <span className="max-w-full truncate">{t(`sales.catalogue.kind.${k}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Tints for a card without its picture ──────────────────

const LIFT = 'transition-[box-shadow,border-color,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-card-hover motion-reduce:transition-none motion-reduce:hover:translate-y-0';
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand';

// ─── Shops ─────────────────────────────────────────────────
//
// Polished 2026-10-28 (user: "Store needs to be polished right now they dont
// look that good"). Without a cover every shop had been the same heavy blue
// slab with the same icon, and a solid blue button under each: placeholders,
// all shouting. Now a shop is told apart at a glance — its banner or, without
// one, a striped awning in its own tint; its logo, or its initials, on a tile
// that sits over the banner's edge; its name large. Under a hairline, today's
// hours and a quieter "Ver tienda" that fills in blue as the card is pointed at.

/** Today's hours as a line: open, opening later, or closed — in Madrid. */
export function HoursLine({ hours, className = '' }: { hours: ShopHours | null | undefined; className?: string }) {
  const t = useSalesT();
  const h = todayHours(hours);
  if (!h) return null;
  const text = h.state === 'open' ? t('sales.catalogue.hours.openUntil', { time: clock(h.close) })
    : h.state === 'before' ? t('sales.catalogue.hours.opensAt', { time: clock(h.open) })
      : h.state === 'after' ? t('sales.catalogue.hours.closedNow')
        : t('sales.catalogue.hours.closedToday');
  const tone = h.state === 'open' ? 'text-st-emerald-fg' : h.state === 'before' ? 'text-brand' : 'text-muted';
  return (
    <span className={`inline-flex items-start gap-1.5 min-w-0 ${tone} ${className}`}>
      <Clock size={14} strokeWidth={2} className="shrink-0 mt-px" />
      <span>{text}</span>
    </span>
  );
}

/** A shop's striped awning along the top of its banner, scalloped at the edge. */
function Awning({ stripe }: { stripe: string }) {
  const id = `awning${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg className="absolute inset-x-0 top-0 w-full h-[30px] drop-shadow-[0_2px_2px_rgba(13,27,46,0.10)]" aria-hidden="true">
      <defs>
        <pattern id={id} width="32" height="30" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="16" height="20" className={stripe} />
          <circle cx="8" cy="20" r="8" className={stripe} />
          <rect x="16" y="0" width="16" height="20" className="fill-card" />
          <circle cx="24" cy="20" r="8" className="fill-card" />
        </pattern>
      </defs>
      <rect width="100%" height="30" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * A shop's banner: its cover, or — while it has none, or it fails to load —
 * an awning in the shop's own tint over a soft wash, a storefront drawn faint
 * in the corner. `className` sizes it; `bareClassName`, when given, sizes the
 * awning instead — a header with nothing to show need not stand as tall.
 */
export function ShopBanner({ cover: coverUrl, tint, className = 'aspect-[5/2]', bareClassName, zoom = false }: {
  cover?: string | null; tint: Tint; className?: string; bareClassName?: string; zoom?: boolean;
}) {
  const [cover, coverFailed] = useImage(coverUrl);
  if (cover) {
    return (
      <span className={`sales-photo relative block overflow-hidden bg-surface-cream ${className}`}>
        <img
          src={resolveImageUrl(cover, 'banner')}
          alt=""
          className={`absolute inset-0 w-full h-full object-cover ${zoom ? 'transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none' : ''}`}
          loading="lazy"
          draggable={false}
          onError={coverFailed}
        />
      </span>
    );
  }
  return (
    <span className={`relative block overflow-hidden ${tint.well} ${bareClassName ?? className}`}>
      <Awning stripe={tint.stripe} />
      <Store size={150} strokeWidth={1} className={`pointer-events-none absolute -right-5 -bottom-9 opacity-[0.14] ${tint.fg}`} aria-hidden="true" />
    </span>
  );
}

/** "Shaikh Cash & Carry" → "SC": what a shop with no logo shows on its tile. */
function initialsOf(name: string): string {
  const words = name.split(/[\s&,.()/-]+/).filter((w) => w && !/^(de|del|la|el|los|las|y|and|the|sl|s\.l\.)$/i.test(w));
  return (words.slice(0, 2).map((w) => w[0]).join('') || name.slice(0, 1)).toUpperCase();
}

/**
 * A shop's mark on its tile: its logo on the background the office picked
 * for it, Cesto's own mark for Cesto's catalogue, or its initials on its tint.
 * It sits in the row under the banner, level with the name — on a card and,
 * larger, on the shop's own page.
 */
export function ShopMark({ name, logo: logoUrl, logoBg, tint, house = false, icon: Icon, size = 'md' }: {
  name: string; logo?: string | null; logoBg?: string | null; tint: Tint; house?: boolean;
  /** Not a shop: an icon instead of initials. */
  icon?: React.ElementType;
  size?: 'md' | 'lg';
}) {
  const [logo, logoFailed] = useImage(house ? null : logoUrl);
  const box = size === 'lg'
    ? 'w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-[18px]'
    : 'w-[52px] h-[52px] rounded-[14px]';
  const letters = size === 'lg' ? 'text-[22px] sm:text-[25px]' : 'text-[18px]';
  return (
    <span
      className={`relative shrink-0 border border-border overflow-hidden flex items-center justify-center ${box} ${logo ? `sales-photo ${logoPlate(logoBg).className}` : house ? 'sales-photo' : tint.well}`}
      style={logo ? logoPlate(logoBg).style : house ? { backgroundColor: '#FFFFFF' } : undefined}
    >
      {house ? <img src="/cesto-icon.png" alt="" className="w-full h-full object-cover" draggable={false} />
        // The logo fills its tile (user, 2026-10-28: "the logo should be set
        // to cover the whole space"), as Cesto's own mark does.
        : logo ? <img src={resolveImageUrl(logo, 'logo')} alt="" className="w-full h-full object-cover" loading="lazy" draggable={false} onError={logoFailed} />
          : Icon ? <Icon size={size === 'lg' ? 34 : 23} strokeWidth={1.75} className={tint.fg} />
            : <span className={`font-display font-black tracking-[-0.03em] leading-none ${letters} ${tint.fg}`} aria-hidden="true">{initialsOf(name)}</span>}
    </span>
  );
}

/**
 * A shop's card: its banner, with today's hours on a chip in its corner, and
 * under it ONE row — its mark over the banner's edge, its name and count, and
 * a round arrow (user, 2026-10-28, of a footer holding a lone button:
 * "consuming unnecessary space and making the card look bad"). Every card's
 * row is the same, so a row of cards stands level without stretching. The
 * whole card is the button.
 */
export function StoreCard({ id, name, cover, logo, logoBg, hours, count, house = false, onOpen }: {
  id: string; name: string; cover?: string | null; logo?: string | null; logoBg?: string | null;
  hours?: ShopHours | null; count?: number; house?: boolean; onOpen: () => void;
}) {
  const t = useSalesT();
  const tint = house ? HOUSE_TINT : tintOf(id);
  return (
    <ShopCardShell onOpen={onOpen}>
      <span className="relative block">
        <ShopBanner cover={cover} tint={tint} zoom />
        {todayHours(hours) && <BannerChip><HoursLine hours={hours} /></BannerChip>}
      </span>
      <ShopCardRow
        name={name}
        count={count}
        mark={<ShopMark name={name} logo={logo} logoBg={logoBg} tint={tint} house={house} />}
        cta={t('sales.catalogue.visitStore')}
      />
    </ShopCardShell>
  );
}

/** The products assigned to them by hand, from any shop — a card beside their shops, in the same shape. */
export function AssignedCard({ count, onOpen }: { count: number; onOpen: () => void }) {
  const t = useSalesT();
  return (
    <ShopCardShell onOpen={onOpen}>
      {/* Not a shop, so no awning: the wash, and the parcel drawn faint. */}
      <span className={`relative block overflow-hidden aspect-[5/2] ${HOUSE_TINT.well}`}>
        <PackageCheck size={150} strokeWidth={1} className={`pointer-events-none absolute -right-5 -bottom-9 opacity-[0.14] ${HOUSE_TINT.fg}`} aria-hidden="true" />
        <BannerChip><span className="text-gray">{t('sales.catalogue.assignedShort')}</span></BannerChip>
      </span>
      <ShopCardRow
        name={t('sales.catalogue.assignedTitle')}
        count={count}
        mark={<ShopMark name="" tint={HOUSE_TINT} icon={PackageCheck} />}
        cta={t('sales.catalogue.seeProducts')}
      />
    </ShopCardShell>
  );
}

/**
 * A small label in the banner's bottom-right corner, clear of the mark on the
 * left. Outside the photo's light frame, so it takes the panel's own colours
 * in both themes.
 */
function BannerChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="absolute right-3 bottom-3 max-w-[calc(100%-7rem)] h-7 px-2.5 rounded-full bg-card/90 backdrop-blur-sm shadow-card inline-flex items-center text-[12px] font-semibold font-display whitespace-nowrap overflow-hidden">
      {children}
    </span>
  );
}

function ShopCardShell({ onOpen, children }: { onOpen: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group w-full h-full min-w-0 text-left flex flex-col rounded-2xl bg-card border border-border shadow-card overflow-hidden hover:border-brand/25 ${LIFT} ${FOCUS}`}
    >
      {children}
    </button>
  );
}

/**
 * The one row under the banner: the mark, the name and count, and a round
 * arrow — the panel's sign that a tile opens something, filling in as the
 * card is pointed at — all on one centre line (user, 2026-10-28: a mark half
 * over the banner beside a name below it "are not aligned with each other and
 * making the balance out of the design"). "Ver tienda" is said to a screen
 * reader; the eye has the arrow and the whole card to tap.
 */
function ShopCardRow({ name, count, mark, cta }: { name: string; count?: number; mark: React.ReactNode; cta: string }) {
  const countLine = useCountLine();
  return (
    <span className="flex items-center gap-3 px-4 py-3.5">
      {mark}
      <span className="min-w-0 flex-1">
        <span className="block text-[16.5px] font-bold font-display text-ink leading-tight tracking-[-0.01em] truncate">{name}</span>
        {count !== undefined && <span className="block mt-1 text-[12.5px] font-medium font-display text-gray tabular-nums">{countLine(count)}</span>}
      </span>
      <span className="shrink-0 w-10 h-10 rounded-full bg-brand-whisper text-brand inline-flex items-center justify-center transition-colors duration-200 group-hover:bg-brand group-hover:text-white motion-reduce:transition-none">
        <span className="sr-only">{cta}</span>
        <ArrowRight size={17} strokeWidth={2.25} className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
      </span>
    </span>
  );
}

export const STORE_GRID = 'grid gap-3 md:gap-3.5 2xl:gap-4 sm:grid-cols-2 xl:grid-cols-3';

export function StoreCardSkeleton() {
  return (
    <div className="rounded-2xl bg-card border border-border shadow-card overflow-hidden">
      <Skeleton className="aspect-[5/2] rounded-none" />
      <div className="px-4 py-3.5 flex items-center gap-3">
        <Skeleton className="w-[52px] h-[52px] rounded-[14px] shrink-0" />
        <div className="flex-1"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/2 mt-2" /></div>
        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
      </div>
    </div>
  );
}

// ─── Categories and brands: square tiles ───────────────────

export const TILE_GRID = 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-x-3 gap-y-4 md:gap-x-3.5';

/**
 * A category, as the shop shows it: its square photo, the name under it in
 * two lines at most, and how many products are behind it.
 */
export function CategoryTile({ id, name, image: imageUrl, count, onOpen }: {
  id: string; name: string; image?: string | null; count?: number; onOpen: () => void;
}) {
  const countLine = useCountLine();
  const tint = tintOf(id);
  const [image, imageFailed] = useImage(imageUrl);
  return (
    <button type="button" onClick={onOpen} className="group w-full min-w-0 flex flex-col text-center focus-visible:outline-none">
      <span className={`relative block aspect-square rounded-2xl overflow-hidden ring-1 ring-inset ring-border group-hover:-translate-y-0.5 group-hover:shadow-card-hover group-focus-visible:ring-2 group-focus-visible:ring-brand transition-[box-shadow,transform] duration-200 ease-out motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 ${
        image ? 'sales-photo bg-surface-cream' : tint.well
      }`}>
        {image
          ? <img src={resolveImageUrl(image, 'tile')} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none" loading="lazy" draggable={false} onError={imageFailed} />
          : <span className={`absolute inset-0 flex items-center justify-center text-[clamp(28px,9vw,40px)] font-black font-display leading-none ${tint.fg}`} aria-hidden="true">{name.trim().slice(0, 1).toUpperCase()}</span>}
      </span>
      <span className="mt-2 px-0.5 text-[13px] sm:text-[13.5px] font-semibold font-display text-ink leading-snug line-clamp-2 break-words">{name}</span>
      {count !== undefined && <span className="mt-0.5 text-[11.5px] text-muted tabular-nums">{countLine(count)}</span>}
    </button>
  );
}

/**
 * A brand: its logo on its own background, the name and the count under it.
 * A 16:9 tile — the logos' own shape — not a square (user, 2026-10-28:
 * "reduce the height of the brand cards a little so it looks like a
 * rectangle", then "reduce even more").
 */
export function BrandTile({ name, logo: logoUrl, logoBg, count, onOpen }: {
  name: string; logo?: string | null; logoBg?: string | null; count?: number; onOpen: () => void;
}) {
  const countLine = useCountLine();
  const [logo, logoFailed] = useImage(logoUrl);
  return (
    <button type="button" onClick={onOpen} className="group w-full min-w-0 flex flex-col text-center focus-visible:outline-none">
      {/* The office picks a logo's background for its logo: it stays, in
          both themes, as a product photo does. */}
      <span
        className={`${logoPlate(logoBg).className} sales-photo relative block aspect-[16/9] rounded-2xl overflow-hidden ring-1 ring-inset ring-border group-hover:-translate-y-0.5 group-hover:shadow-card-hover group-focus-visible:ring-2 group-focus-visible:ring-brand transition-[box-shadow,transform] duration-200 ease-out motion-reduce:transition-none motion-reduce:group-hover:translate-y-0`}
        style={logoPlate(logoBg).style}
      >
        {logo
          ? <img src={resolveImageUrl(logo, 'tile')} alt="" className="absolute inset-0 w-full h-full object-contain px-[12%] py-[10%] transition-transform duration-500 ease-out group-hover:scale-[1.05] motion-reduce:transition-none" loading="lazy" draggable={false} onError={logoFailed} />
          : <span className="absolute inset-0 flex items-center justify-center p-2 text-[14px] font-bold font-display text-ink leading-tight break-words line-clamp-3" aria-hidden="true">{name}</span>}
      </span>
      <span className="mt-2 px-0.5 text-[13px] font-semibold font-display text-ink leading-snug truncate">{name}</span>
      {count !== undefined && <span className="mt-0.5 text-[11.5px] text-muted tabular-nums">{countLine(count)}</span>}
    </button>
  );
}

export function TileSkeleton({ wide = false }: { wide?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <Skeleton className={`w-full rounded-2xl ${wide ? 'aspect-[16/9]' : 'aspect-square'}`} />
      <Skeleton className="h-3.5 w-3/4 mt-2.5" />
      <Skeleton className="h-3 w-1/2 mt-1.5" />
    </div>
  );
}

// ─── Origins: tall cards ───────────────────────────────────

export const ORIGIN_GRID = 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3 md:gap-3.5';

/**
 * Where products come from. Its picture is tall (the one on production is
 * 335×597), so the card is too; the name sits at the foot, white over a
 * shade on a picture, ink on a tint.
 */
export function OriginCard({ id, label, image: imageUrl, count, onOpen }: {
  id: string; label: string; image?: string | null; count?: number; onOpen: () => void;
}) {
  const countLine = useCountLine();
  const tint = tintOf(id);
  const [image, imageFailed] = useImage(imageUrl);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group relative block w-full min-w-0 aspect-square md:aspect-[4/5] rounded-2xl overflow-hidden text-left ring-1 ring-inset ring-border shadow-card ${LIFT} ${FOCUS} ${image ? 'bg-veil' : tint.well}`}
    >
      {image ? (
        <>
          <img src={resolveImageUrl(image, 'tile')} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none" loading="lazy" draggable={false} onError={imageFailed} />
          <span className="absolute inset-0 bg-gradient-to-t from-veil/85 via-veil/25 to-transparent" aria-hidden="true" />
        </>
      ) : (
        <Globe2 size={170} strokeWidth={1} className={`pointer-events-none absolute -right-8 -bottom-8 opacity-[0.16] ${tint.fg}`} aria-hidden="true" />
      )}
      <span className={`absolute top-3 left-3 w-9 h-9 rounded-xl flex items-center justify-center ${image ? 'bg-white/90 text-brand backdrop-blur-sm' : `bg-card ${tint.fg} shadow-card`}`}>
        <MapPin size={18} strokeWidth={1.75} />
      </span>
      <span className="absolute inset-x-0 bottom-0 p-3.5 md:p-4">
        <span className={`block text-[19px] md:text-[21px] font-bold font-display leading-tight tracking-[-0.01em] break-words ${image ? 'text-white' : 'text-ink'}`}>{label}</span>
        {count !== undefined && (
          <span className={`block mt-0.5 text-[12.5px] font-medium font-display tabular-nums ${image ? 'text-white/80' : 'text-gray'}`}>{countLine(count)}</span>
        )}
      </span>
    </button>
  );
}

export function OriginSkeleton() {
  return <Skeleton className="aspect-square md:aspect-[4/5] rounded-2xl" />;
}
