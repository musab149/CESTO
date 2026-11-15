import { ArrowRight, Sparkles, Truck } from 'lucide-react';
import type { PromoTile, PromoGridConfig } from '@grocery-app/shared';

/**
 * Pixel-mirror of the customer web PromoGrid (apps/web/src/pages/HomePage.tsx).
 * Driven by the live form state so the admin sees their edits in real time.
 *
 * Layout (md+):
 *   ┌────────────┬─────────────┐
 *   │            │  wide tile  │
 *   │  feature   ├──────┬──────┤
 *   │            │ comp │ comp │
 *   └────────────┴──────┴──────┘
 *
 * The tiles are read by index after sorting on display_order — keep one
 * `feature`, one `wide`, two `compact` tiles for the layout to look right.
 */
interface Props {
  config: PromoGridConfig;
  lang: 'en' | 'es';
  /** When true the tiles are non-interactive (true for the admin preview). */
  staticMode?: boolean;
}

function pickText(tile: PromoTile, field: 'eyebrow' | 'title' | 'description' | 'cta', lang: 'en' | 'es') {
  const key = `${field}_${lang}` as const;
  return (tile[key] as string | null) ?? '';
}

function textColorClass(theme: 'light' | 'dark') {
  return theme === 'light' ? 'text-white' : 'text-ink';
}
function mutedColorClass(theme: 'light' | 'dark') {
  return theme === 'light' ? 'text-white/80' : 'text-gray';
}


function FeatureTile({ tile, lang }: { tile: PromoTile; lang: 'en' | 'es' }) {
  const hasImage = !!tile.image_url;
  const textShadow = hasImage && tile.text_theme === 'light'
    ? { textShadow: '0 1px 12px rgba(0,0,0,0.55)' }
    : undefined;
  return (
    <div
      className="relative overflow-hidden rounded-lg text-left p-8 md:p-10 min-h-[360px] flex flex-col justify-between"
      style={{ background: tile.background }}
    >
      {tile.image_url && (
        <img
          src={tile.image_url}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      <div className="relative">
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-[0.16em] bg-white/90 px-3 py-1 rounded-full text-brand-ink">
          <Sparkles size={11} strokeWidth={2.5} />
          {pickText(tile, 'eyebrow', lang)}
        </span>
        <h3
          className={`font-display text-[28px] md:text-[36px] mt-4 leading-[1.05] tracking-tight ${textColorClass(tile.text_theme)}`}
          style={{ fontWeight: 500, ...textShadow }}
        >
          {pickText(tile, 'title', lang)}
        </h3>
        {pickText(tile, 'description', lang) && (
          <p className={`text-[14px] font-body mt-3 max-w-md leading-relaxed ${mutedColorClass(tile.text_theme)}`} style={textShadow}>
            {pickText(tile, 'description', lang)}
          </p>
        )}
      </div>
      <span className="relative inline-flex w-fit items-center gap-2 mt-6 h-11 px-6 rounded-full text-white text-[13.5px] font-bold font-ui bg-brand">
        {pickText(tile, 'cta', lang)}
        <ArrowRight size={15} strokeWidth={2.5} />
      </span>
    </div>
  );
}

function WideTile({ tile, lang }: { tile: PromoTile; lang: 'en' | 'es' }) {
  const hasImage = !!tile.image_url;
  const textShadow = hasImage && tile.text_theme === 'light'
    ? { textShadow: '0 1px 10px rgba(0,0,0,0.55)' }
    : undefined;
  return (
    <div
      className="relative overflow-hidden rounded-lg text-left p-6 flex items-center justify-between min-h-[170px]"
      style={{ background: tile.background }}
    >
      {tile.image_url && (
        <img src={tile.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}
      <div className="relative flex-1 min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-brand-ink" style={textShadow}>
          {pickText(tile, 'eyebrow', lang)}
        </p>
        <h4
          className={`font-display text-[20px] md:text-[22px] mt-2 leading-tight tracking-tight ${textColorClass(tile.text_theme)}`}
          style={{ fontWeight: 500, ...textShadow }}
        >
          {pickText(tile, 'title', lang)}
        </h4>
        <span className="text-[13px] font-bold mt-3 inline-flex items-center gap-1.5 text-brand" style={textShadow}>
          {pickText(tile, 'cta', lang)}
          <ArrowRight size={13} strokeWidth={2.5} />
        </span>
      </div>
      {!tile.image_url && (
        <Truck size={56} strokeWidth={1.4} className="relative text-brand opacity-50 ml-3 shrink-0" />
      )}
    </div>
  );
}

function CompactTile({ tile, lang }: { tile: PromoTile; lang: 'en' | 'es' }) {
  const hasImage = !!tile.image_url;
  const textShadow = hasImage && tile.text_theme === 'light'
    ? { textShadow: '0 1px 10px rgba(0,0,0,0.55)' }
    : undefined;
  return (
    <div
      className="relative overflow-hidden rounded-lg text-left p-5 flex flex-col justify-between min-h-[170px]"
      style={{ background: tile.background }}
    >
      {tile.image_url && (
        <img src={tile.image_url} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}
      <div className="relative">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand" style={textShadow}>
          {pickText(tile, 'eyebrow', lang)}
        </p>
        <h4
          className={`font-display text-[18px] mt-1.5 leading-tight tracking-tight ${textColorClass(tile.text_theme)}`}
          style={{ fontWeight: 500, ...textShadow }}
        >
          {pickText(tile, 'title', lang)}
        </h4>
      </div>
      <span className="relative text-[12px] font-bold inline-flex items-center gap-1 text-brand" style={textShadow}>
        {pickText(tile, 'cta', lang)}
        <ArrowRight size={12} strokeWidth={2.5} />
      </span>
    </div>
  );
}

export default function PromoGridPreview({ config, lang, staticMode = true }: Props) {
  const tiles = [...config.tiles].sort((a, b) => a.display_order - b.display_order);
  const feature = tiles.find((t) => t.variant === 'feature') ?? tiles[0];
  const wide = tiles.find((t) => t.variant === 'wide') ?? tiles[1];
  const compacts = tiles.filter((t) => t.variant === 'compact').slice(0, 2);
  while (compacts.length < 2) compacts.push(tiles[2 + compacts.length] ?? tiles[0]);

  const wrap = (key: string, node: React.ReactNode) =>
    staticMode ? <div key={key}>{node}</div> : <button key={key}>{node}</button>;

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {wrap('f', <FeatureTile tile={feature} lang={lang} />)}
      <div className="grid grid-rows-[1fr_1fr] gap-4">
        {wrap('w', <WideTile tile={wide} lang={lang} />)}
        <div className="grid grid-cols-2 gap-4">
          {wrap('c0', <CompactTile tile={compacts[0]} lang={lang} />)}
          {wrap('c1', <CompactTile tile={compacts[1]} lang={lang} />)}
        </div>
      </div>
    </section>
  );
}
