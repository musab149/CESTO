/**
 * Origin card art — full-card SVG illustrations used when the admin hasn't
 * uploaded a custom landmark image. Each illustration is themed to the
 * origin slug (Pakistan → Minar tower, India → India Gate, Africa → baobab,
 * etc.) and takes the card's bg + accent colours so it blends with whatever
 * palette the admin picked. A generic warm-landscape fallback covers any
 * origin slug we haven't designed a specific illustration for.
 *
 * Style cues: warm gradient background with layered silhouettes in two or
 * three opacity tiers, ground line near the lower third so the title/count
 * text stays legible without a hard scrim.
 */

import type { FC } from 'react';

interface ArtProps {
  /** Card background colour — used as the top of the gradient. */
  bg: string;
  /** Card accent colour — drives the silhouettes. */
  accent: string;
  /** Optional Tailwind classes (typically `absolute inset-0 w-full h-full`). */
  className?: string;
}

// Shared canvas — slightly taller than wide to match the customer card.
const VIEW_BOX = '0 0 200 280';

/**
 * Internal helper that paints the common warm-gradient background. Each
 * specific art component adds its own silhouettes on top. The gradient runs
 * from bg (top) to a 50%-opacity wash of accent (bottom), so dark accents
 * darken the lower third and pastel accents stay subtle.
 */
function GradientBg({ bg, accent, idSuffix }: { bg: string; accent: string; idSuffix: string }) {
  const gradId = `origin-bg-${idSuffix}`;
  return (
    <>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={bg} />
          <stop offset="55%" stopColor={bg} />
          <stop offset="100%" stopColor={accent} stopOpacity="0.45" />
        </linearGradient>
      </defs>
      <rect width="200" height="280" fill={`url(#${gradId})`} />
    </>
  );
}

/**
 * Generic warm-landscape — savanna feel with a baobab silhouette, smaller
 * acacia trees and rolling foreground shrubs. Used as the default art when
 * we don't have a specific illustration for the origin slug. Closely matches
 * the reference art the user attached.
 */
const GenericLandscapeArt: FC<ArtProps> = ({ bg, accent, className }) => (
  <svg viewBox={VIEW_BOX} className={className} preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <GradientBg bg={bg} accent={accent} idSuffix="landscape" />
    {/* Distant rolling hills */}
    <path d="M0,200 Q40,180 80,195 T160,190 T200,200 L200,210 L0,210 Z" fill={accent} opacity="0.18" />
    {/* Smaller right-side acacia */}
    <g fill={accent} opacity="0.65">
      <rect x="158" y="170" width="3" height="32" />
      <ellipse cx="159.5" cy="170" rx="14" ry="8" />
      <ellipse cx="150" cy="166" rx="10" ry="6" />
      <ellipse cx="168" cy="166" rx="10" ry="6" />
    </g>
    {/* Smaller left-side acacia */}
    <g fill={accent} opacity="0.55">
      <rect x="36" y="178" width="3" height="26" />
      <ellipse cx="37.5" cy="178" rx="12" ry="7" />
      <ellipse cx="30" cy="174" rx="8" ry="5" />
      <ellipse cx="45" cy="174" rx="8" ry="5" />
    </g>
    {/* Central baobab */}
    <g fill={accent}>
      {/* Trunk with flared base */}
      <path d="M88,210 Q86,168 95,150 L105,150 Q114,168 112,210 Z" />
      {/* Canopy clusters */}
      <ellipse cx="100" cy="135" rx="38" ry="18" />
      <ellipse cx="74" cy="138" rx="20" ry="13" />
      <ellipse cx="126" cy="138" rx="20" ry="13" />
      <ellipse cx="100" cy="118" rx="28" ry="14" />
    </g>
    {/* Foreground shrubs */}
    <g fill={accent} opacity="0.55">
      <ellipse cx="20" cy="216" rx="20" ry="6" />
      <ellipse cx="60" cy="220" rx="14" ry="5" />
      <ellipse cx="140" cy="220" rx="16" ry="5" />
      <ellipse cx="184" cy="218" rx="18" ry="6" />
    </g>
    {/* Soft ground band */}
    <rect x="0" y="220" width="200" height="60" fill={accent} opacity="0.12" />
  </svg>
);

/**
 * Pakistan — Minar-e-Pakistan tower silhouette with side hills.
 */
const PakistanArt: FC<ArtProps> = ({ bg, accent, className }) => (
  <svg viewBox={VIEW_BOX} className={className} preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <GradientBg bg={bg} accent={accent} idSuffix="pakistan" />
    {/* Distant hills */}
    <path d="M0,210 Q30,192 60,210 Z" fill={accent} opacity="0.35" />
    <path d="M140,210 Q170,192 200,210 Z" fill={accent} opacity="0.35" />
    <g fill={accent}>
      {/* Wide base */}
      <rect x="70" y="200" width="60" height="14" />
      <rect x="80" y="190" width="40" height="10" />
      {/* Main column */}
      <rect x="94" y="100" width="12" height="92" />
      {/* Balcony rings */}
      <rect x="84" y="160" width="32" height="4" />
      <rect x="88" y="135" width="24" height="3" />
      {/* Dome */}
      <circle cx="100" cy="92" r="8" />
      {/* Finial */}
      <rect x="99" y="64" width="2" height="20" />
    </g>
    <rect x="0" y="214" width="200" height="66" fill={accent} opacity="0.14" />
  </svg>
);

/**
 * India — India Gate-style arch with side pillars and palms.
 */
const IndiaArt: FC<ArtProps> = ({ bg, accent, className }) => (
  <svg viewBox={VIEW_BOX} className={className} preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <GradientBg bg={bg} accent={accent} idSuffix="india" />
    {/* Palms on sides */}
    <g fill={accent} opacity="0.6">
      <rect x="22" y="160" width="3" height="55" />
      <path d="M23,160 Q5,140 0,150 Q8,158 23,162 Z" />
      <path d="M23,160 Q40,140 48,150 Q40,158 23,162 Z" />
      <rect x="174" y="160" width="3" height="55" />
      <path d="M175,160 Q193,140 200,150 Q190,158 175,162 Z" />
      <path d="M175,160 Q158,140 152,150 Q160,158 175,162 Z" />
    </g>
    {/* Main arch */}
    <g fill={accent}>
      <path d="M70,215 L70,140 Q70,90 100,90 Q130,90 130,140 L130,215 L116,215 L116,150 Q116,108 100,108 Q84,108 84,150 L84,215 Z" />
      {/* Crown */}
      <rect x="84" y="80" width="32" height="6" />
      <rect x="92" y="68" width="16" height="10" />
      <rect x="99" y="56" width="2" height="14" />
    </g>
    <rect x="0" y="216" width="200" height="64" fill={accent} opacity="0.16" />
  </svg>
);

/**
 * Bangladesh — National Martyrs' Memorial: stacked triangular spires.
 */
const BangladeshArt: FC<ArtProps> = ({ bg, accent, className }) => (
  <svg viewBox={VIEW_BOX} className={className} preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <GradientBg bg={bg} accent={accent} idSuffix="bd" />
    {/* Reflecting pool hint */}
    <ellipse cx="100" cy="218" rx="60" ry="6" fill={accent} opacity="0.22" />
    {/* Trapezoid base */}
    <path d="M60,200 L140,200 L124,180 L76,180 Z" fill={accent} />
    {/* Layered spires */}
    <polygon points="100,90 120,200 80,200" fill={accent} />
    <polygon points="100,100 113,200 87,200" fill={accent} opacity="0.78" />
    <polygon points="100,114 106,200 94,200" fill={accent} opacity="0.55" />
    <rect x="0" y="216" width="200" height="64" fill={accent} opacity="0.14" />
  </svg>
);

/**
 * Arabic — Mosque with central dome, side domes and twin minarets.
 */
const ArabicArt: FC<ArtProps> = ({ bg, accent, className }) => (
  <svg viewBox={VIEW_BOX} className={className} preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <GradientBg bg={bg} accent={accent} idSuffix="arabic" />
    {/* Sand dunes */}
    <path d="M0,205 Q60,188 120,200 T200,198 L200,212 L0,212 Z" fill={accent} opacity="0.3" />
    <g fill={accent}>
      {/* Main building */}
      <rect x="44" y="160" width="112" height="46" />
      {/* Central dome */}
      <path d="M64,160 Q64,118 100,118 Q136,118 136,160 Z" />
      {/* Crescent */}
      <rect x="99" y="98" width="2" height="14" />
      <circle cx="100" cy="94" r="3.5" />
      {/* Side domes */}
      <path d="M48,168 Q48,148 60,148 Q72,148 72,168 Z" />
      <path d="M128,168 Q128,148 140,148 Q152,148 152,168 Z" />
      {/* Left minaret */}
      <rect x="22" y="98" width="8" height="108" />
      <rect x="18" y="146" width="16" height="4" />
      <path d="M21,98 Q21,80 26,80 Q31,80 31,98 Z" />
      {/* Right minaret */}
      <rect x="170" y="98" width="8" height="108" />
      <rect x="166" y="146" width="16" height="4" />
      <path d="M169,98 Q169,80 174,80 Q179,80 179,98 Z" />
    </g>
    <rect x="0" y="208" width="200" height="72" fill={accent} opacity="0.12" />
  </svg>
);

/**
 * Latino — Christ the Redeemer on Sugarloaf-style hill.
 */
const LatinoArt: FC<ArtProps> = ({ bg, accent, className }) => (
  <svg viewBox={VIEW_BOX} className={className} preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <GradientBg bg={bg} accent={accent} idSuffix="latino" />
    {/* Background hills */}
    <path d="M0,210 Q60,180 120,210 T200,210 Z" fill={accent} opacity="0.22" />
    {/* Foreground hill */}
    <path d="M0,212 Q60,150 100,150 Q140,150 200,212 Z" fill={accent} opacity="0.4" />
    {/* Pedestal */}
    <rect x="94" y="124" width="12" height="20" fill={accent} />
    {/* Body */}
    <path d="M96,80 L104,80 L108,124 L92,124 Z" fill={accent} />
    {/* Arms */}
    <rect x="68" y="86" width="64" height="6" fill={accent} />
    <circle cx="68" cy="89" r="3.5" fill={accent} />
    <circle cx="132" cy="89" r="3.5" fill={accent} />
    {/* Head */}
    <circle cx="100" cy="72" r="6" fill={accent} />
  </svg>
);

/**
 * Africa — baobab tree silhouette. The illustration the reference art is
 * closest to; renders nearly identically to GenericLandscapeArt but with a
 * lone, larger central tree and no smaller acacias.
 */
const AfricaArt: FC<ArtProps> = ({ bg, accent, className }) => (
  <svg viewBox={VIEW_BOX} className={className} preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <GradientBg bg={bg} accent={accent} idSuffix="africa" />
    <path d="M0,210 Q60,196 120,210 T200,208 L200,218 L0,218 Z" fill={accent} opacity="0.22" />
    <g fill={accent}>
      <path d="M82,214 Q78,150 92,128 L108,128 Q122,150 118,214 Z" />
      <ellipse cx="100" cy="110" rx="46" ry="20" />
      <ellipse cx="66" cy="115" rx="22" ry="13" />
      <ellipse cx="134" cy="115" rx="22" ry="13" />
      <ellipse cx="100" cy="88" rx="32" ry="14" />
    </g>
    <g fill={accent} opacity="0.55">
      <ellipse cx="20" cy="220" rx="22" ry="6" />
      <ellipse cx="180" cy="220" rx="22" ry="6" />
    </g>
  </svg>
);

/**
 * España — bull silhouette with stylised sun. Standalone tribute that
 * Spanish customers will read instantly.
 */
const SpainArt: FC<ArtProps> = ({ bg, accent, className }) => (
  <svg viewBox={VIEW_BOX} className={className} preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <GradientBg bg={bg} accent={accent} idSuffix="spain" />
    {/* Sun */}
    <circle cx="158" cy="76" r="22" fill={accent} opacity="0.55" />
    {/* Ground / hills */}
    <path d="M0,210 Q60,188 130,205 T200,210 L200,222 L0,222 Z" fill={accent} opacity="0.3" />
    {/* Bull silhouette — block-y, expressive */}
    <g fill={accent}>
      {/* Body */}
      <path d="M40,180 Q42,150 70,148 L132,148 Q160,148 160,176 L160,200 L150,200 L150,210 L138,210 L138,200 L60,200 L60,210 L48,210 L48,200 L40,200 Z" />
      {/* Head */}
      <path d="M152,148 Q170,144 178,150 L182,154 L188,150 Q186,158 178,162 L168,162 Q160,164 152,160 Z" />
      {/* Horns */}
      <path d="M178,150 L186,138 L188,150 Z" />
      <path d="M170,148 L162,134 L168,148 Z" />
      {/* Tail */}
      <path d="M40,180 Q30,180 30,196 L34,196 L34,184 L40,184 Z" />
    </g>
  </svg>
);

/**
 * Japón — Mt. Fuji with rising sun and a torii gate in front.
 */
const JapanArt: FC<ArtProps> = ({ bg, accent, className }) => (
  <svg viewBox={VIEW_BOX} className={className} preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <GradientBg bg={bg} accent={accent} idSuffix="japan" />
    {/* Rising sun */}
    <circle cx="100" cy="84" r="26" fill={accent} opacity="0.55" />
    {/* Mt. Fuji */}
    <g fill={accent}>
      <path d="M30,200 L100,80 L170,200 Z" />
    </g>
    {/* Snow cap */}
    <path d="M86,100 L114,100 L106,90 Q100,84 94,90 Z" fill={bg} opacity="0.9" />
    {/* Torii gate in foreground */}
    <g fill={accent}>
      <rect x="58" y="168" width="6" height="50" />
      <rect x="136" y="168" width="6" height="50" />
      <rect x="50" y="156" width="100" height="6" />
      <rect x="44" y="166" width="112" height="4" />
      <rect x="96" y="162" width="8" height="14" />
    </g>
    <rect x="0" y="216" width="200" height="64" fill={accent} opacity="0.16" />
  </svg>
);

/**
 * Reino Unido — Big Ben tower with a small foreground bridge profile.
 */
const UkArt: FC<ArtProps> = ({ bg, accent, className }) => (
  <svg viewBox={VIEW_BOX} className={className} preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
    <GradientBg bg={bg} accent={accent} idSuffix="uk" />
    {/* Distant skyline */}
    <g fill={accent} opacity="0.3">
      <rect x="10" y="170" width="22" height="40" />
      <rect x="36" y="178" width="18" height="32" />
      <rect x="160" y="172" width="26" height="38" />
      <path d="M170,172 L173,162 L176,172 Z" />
    </g>
    {/* Big Ben tower */}
    <g fill={accent}>
      <rect x="84" y="200" width="32" height="14" />
      <rect x="88" y="184" width="24" height="16" />
      <rect x="92" y="100" width="16" height="84" />
      {/* Clock face */}
      <rect x="88" y="118" width="24" height="20" />
      {/* Roof/spire */}
      <path d="M90,100 L110,100 L106,86 L94,86 Z" />
      <rect x="98" y="74" width="4" height="12" />
      <polygon points="100,60 104,74 96,74" />
    </g>
    {/* Clock face inset detail */}
    <circle cx="100" cy="128" r="6" fill={bg} opacity="0.9" />
    <rect x="0" y="212" width="200" height="68" fill={accent} opacity="0.15" />
  </svg>
);

// ─── Registry ─────────────────────────────────────────────────────────────
// Match by lowercased slug. Common aliases (jp, es, uk variations) point to
// the same illustration so language differences don't drop the art.
const ART_BY_SLUG: Record<string, FC<ArtProps>> = {
  pakistan: PakistanArt,
  india: IndiaArt,
  bangladesh: BangladeshArt,
  arabic: ArabicArt,
  latino: LatinoArt,
  africa: AfricaArt,
  españa: SpainArt,
  espana: SpainArt,
  spain: SpainArt,
  japón: JapanArt,
  japon: JapanArt,
  japan: JapanArt,
  'reino unido': UkArt,
  uk: UkArt,
  'united kingdom': UkArt,
  britain: UkArt,
};

/**
 * Full-card SVG art for an origin slug. Picks a hand-designed illustration
 * when one exists for the slug, otherwise falls back to the warm-landscape
 * generic. Always returns something — there's no null path.
 */
export function OriginCardArt({ slug, bg, accent, className }: { slug: string; bg: string; accent: string; className?: string }) {
  const Art = ART_BY_SLUG[slug.toLowerCase().trim()] ?? GenericLandscapeArt;
  return <Art bg={bg} accent={accent} className={className} />;
}

/** Useful when other UI wants to know whether a slug has bespoke art (vs.
 *  the generic fallback) — e.g. to flag "stock illustration in use". */
export function hasBespokeOriginArt(slug: string): boolean {
  return slug.toLowerCase().trim() in ART_BY_SLUG;
}
