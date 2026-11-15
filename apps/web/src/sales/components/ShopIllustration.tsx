/**
 * The dashboard hero's picture: a Cesto shop with its striped awning and its
 * "C" sign, parcels at the door and the van that delivers what a rep sells —
 * the rep's day in one drawing (user's mockup, 2026-10-26).
 *
 * Inline SVG in the brand palette rather than a bitmap: it scales from a phone
 * to the desktop banner without a download, and it is decoration, so it is
 * hidden from screen readers.
 */
const BRAND = '#054EE8';
const NAVY = '#022B91';
const LIGHT = '#7AA1F6';
const SOFT = '#B6CBFA';
const MIST = '#DCE6FD';
const WHISPER = '#F0F4FE';
const LEAF = '#7FC646';
const LEAF_DEEP = '#5FA133';

/** The awning: eight stripes, each ending in a scallop. */
function Awning({ x, y, width, height }: { x: number; y: number; width: number; height: number }) {
  const n = 8;
  const w = width / n;
  return (
    <g>
      {Array.from({ length: n }).map((_, i) => {
        const fill = i % 2 === 0 ? BRAND : '#FFFFFF';
        const sx = x + i * w;
        return (
          <g key={i}>
            <rect x={sx} y={y} width={w} height={height} fill={fill} />
            <path d={`M ${sx} ${y + height} a ${w / 2} ${w / 2.4} 0 0 0 ${w} 0 Z`} fill={fill} />
          </g>
        );
      })}
      {/* The awning's lip, so the white stripes still read against the wall. */}
      <rect x={x} y={y} width={width} height={2.5} fill={NAVY} />
    </g>
  );
}

export default function ShopIllustration({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 160" className={className} aria-hidden="true" focusable="false">
      {/* Sky */}
      <g fill="#FFFFFF">
        <ellipse cx="56" cy="30" rx="21" ry="8" opacity="0.95" />
        <ellipse cx="69" cy="24" rx="13" ry="9" opacity="0.95" />
        <ellipse cx="206" cy="20" rx="19" ry="7" opacity="0.9" />
        <ellipse cx="217" cy="15" rx="10" ry="7" opacity="0.9" />
      </g>

      {/* Ground */}
      <ellipse cx="136" cy="147" rx="104" ry="8" fill={BRAND} opacity="0.08" />

      {/* Tree */}
      <rect x="38" y="112" width="5" height="32" rx="2" fill="#9A6B45" />
      <circle cx="40" cy="103" r="16" fill={LEAF} />
      <circle cx="29" cy="113" r="11" fill={LEAF_DEEP} />
      <circle cx="51" cy="114" r="11" fill={LEAF_DEEP} />
      <circle cx="44" cy="96" r="7" fill="#98D265" />

      {/* The shop: side wall for depth, roof, facade */}
      <polygon points="176,58 195,48 195,130 176,142" fill={SOFT} />
      <polygon points="58,48 178,48 197,38 78,38" fill={NAVY} />
      <rect x="58" y="48" width="120" height="9" fill={NAVY} />
      <rect x="64" y="57" width="112" height="85" fill="#FFFFFF" />

      {/* The sign on the roof: Cesto's C */}
      <rect x="107" y="15" width="27" height="27" rx="7" fill={BRAND} />
      <rect x="107" y="15" width="27" height="27" rx="7" fill="none" stroke="#FFFFFF" strokeWidth="2" />
      <path d="M 126.5 23.8 A 7 7 0 1 0 126.5 33.2" fill="none" stroke="#FFFFFF" strokeWidth="3.6" strokeLinecap="round" />
      <circle cx="127" cy="33" r="1.9" fill={LEAF} />

      <Awning x={58} y={57} width={124} height={15} />

      {/* Window, with something on the shelf */}
      <rect x="73" y="88" width="42" height="32" rx="3" fill={MIST} />
      <rect x="73" y="88" width="42" height="32" rx="3" fill="none" stroke={SOFT} strokeWidth="2" />
      <rect x="93" y="88" width="2" height="32" fill={SOFT} />
      <rect x="76" y="109" width="36" height="2" fill={SOFT} />
      <rect x="78" y="100" width="5" height="9" rx="1" fill={LEAF} />
      <rect x="85" y="102" width="5" height="7" rx="1" fill="#F59E0B" />
      <rect x="98" y="99" width="5" height="10" rx="1" fill={BRAND} />
      <rect x="105" y="102" width="5" height="7" rx="1" fill="#EF4444" />

      {/* Door */}
      <rect x="124" y="84" width="40" height="58" rx="3" fill={BRAND} />
      <rect x="130" y="90" width="28" height="22" rx="2" fill={LIGHT} />
      <circle cx="157" cy="122" r="2.2" fill="#FFFFFF" />

      {/* Step */}
      <rect x="60" y="141" width="118" height="4" rx="1.5" fill={MIST} />

      {/* Parcels waiting at the door */}
      <rect x="94" y="124" width="20" height="17" rx="1.5" fill="#E8C28A" />
      <rect x="103" y="124" width="2.5" height="17" fill="#D4A35F" />
      <rect x="99" y="113" width="13" height="11" rx="1.5" fill="#F0D2A0" />
      <rect x="104.5" y="113" width="2" height="11" fill="#D9B07A" />

      {/* The van */}
      <g transform="translate(170 104)">
        <rect x="0" y="6" width="44" height="30" rx="5" fill="#FFFFFF" stroke={MIST} strokeWidth="1.5" />
        <path d="M 40 12 h 9 a 6 6 0 0 1 5.4 3.4 l 4.2 8.6 a 6 6 0 0 1 0.6 2.6 V 32 a 4 4 0 0 1 -4 4 H 40 Z" fill={WHISPER} stroke={MIST} strokeWidth="1.5" />
        <path d="M 44 15 h 5.5 a 2 2 0 0 1 1.8 1.1 l 3.3 6.6 H 44 Z" fill={LIGHT} />
        <rect x="0" y="25" width="59" height="4" fill={BRAND} />
        <rect x="9" y="11" width="12" height="12" rx="3" fill={BRAND} />
        <path d="M 18 14.6 A 3.2 3.2 0 1 0 18 19.4" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="13" cy="37" r="6.5" fill={NAVY} />
        <circle cx="13" cy="37" r="2.6" fill={SOFT} />
        <circle cx="47" cy="37" r="6.5" fill={NAVY} />
        <circle cx="47" cy="37" r="2.6" fill={SOFT} />
      </g>

      {/* A bush by the van */}
      <circle cx="160" cy="141" r="6" fill={LEAF} />
      <circle cx="166" cy="143" r="4.5" fill={LEAF_DEEP} />
    </svg>
  );
}
