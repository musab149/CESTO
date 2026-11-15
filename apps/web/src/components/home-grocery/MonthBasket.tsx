import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { HomeGroceryCopy, Lang } from './copy';

/* ═══════════════════════════════════════════════════════
   LA CESTA DEL MES — the hero's illustration.

   "Cesto" is a basket, so the month's staples go into one: atta, basmati,
   coriander at the back; masala, ghee, dal and chai in front. They drop in
   one after another on first paint, then a tag swings in to say whose
   basket it is. Changing "how many of you" refills it — motion that answers
   the visitor, not decoration.

   Drawn, not photographed. It used to borrow catalogue photos by search,
   which left empty boxes and broken images wherever the catalogue differed
   (a fresh database, staging). A drawing is the same everywhere and costs
   no requests.

   Layout rule: every label sits ABOVE the rim (y 258). Back row labels end
   by y 200, before the front row's tops begin.
   ═══════════════════════════════════════════════════════ */

function monthName(lang: Lang): string {
  return new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { month: 'long' });
}

// `--i` orders the lift-out at the end of a cycle; the delay, the drop-in.
const delay = (i: number) => ({ animationDelay: `${120 + i * 120}ms`, '--i': i } as React.CSSProperties);

/**
 * THE BASKET LOOPS. It used to fill once on first paint and then sit still —
 * over in under two seconds, which on a phone is usually before anyone is
 * looking. Now, once full, it holds, the staples lift out, and it refills.
 *
 * Driven by a cycle counter rather than an infinite CSS animation: the
 * staples are re-keyed on each cycle, so the drop-in is exactly the first
 * one every time, and `is-leaving` swaps in the lift-out between them.
 * With reduced motion nothing loops — the basket is simply full.
 */
const HOLD_MS = 5200;  // from the first staple falling to the lift-out
const LEAVE_MS = 850;  // the lift-out, staggered across the seven staples

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

const FRONT = 'M86 270 L354 270 L328 374 Q325 386 312 386 L128 386 Q115 386 112 374 Z';

export default function MonthBasket({ c, lang, household }: {
  c: HomeGroceryCopy;
  lang: Lang;
  household: number;
}) {
  const [cycle, setCycle] = useState(0);
  const [leaving, setLeaving] = useState(false);

  // A new household size restarts the cycle too, through the same keys.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const leave = window.setTimeout(() => setLeaving(true), HOLD_MS);
    const refill = window.setTimeout(() => {
      setLeaving(false);
      setCycle((n) => n + 1);
    }, HOLD_MS + LEAVE_MS);
    return () => { window.clearTimeout(leave); window.clearTimeout(refill); };
  }, [cycle, household]);

  return (
    <figure className={`hg-basket relative w-full max-w-[460px] mx-auto ${leaving ? 'is-leaving' : ''}`}>
      <svg viewBox="0 0 440 420" className="w-full h-auto overflow-visible" role="img" aria-label={c.basketLabel}>
        <defs>
          <clipPath id="hg-basket-front"><path d={FRONT} /></clipPath>
        </defs>

        {/* Ground: a soft halo and a few seeds of colour. */}
        <circle cx="220" cy="240" r="180" fill="#FFFFFF" opacity="0.6" />
        <circle cx="58" cy="122" r="5" fill="#7FC646" />
        <circle cx="388" cy="84" r="4" fill="#7FC646" opacity="0.8" />
        <circle cx="404" cy="206" r="7" fill="none" stroke="#B6CBFA" strokeWidth="2.5" />
        <circle cx="40" cy="300" r="8" fill="none" stroke="#B6CBFA" strokeWidth="2.5" />
        <ellipse cx="220" cy="400" rx="142" ry="12" fill="#0F172A" opacity="0.08" />

        {/* Behind the staples: the handle and the inside of the basket. */}
        <path d="M112 274 C 100 -36, 340 -36, 328 274" fill="none" stroke="#C4893F" strokeWidth="13" strokeLinecap="round" />
        <path d="M112 274 C 100 -36, 340 -36, 328 274" fill="none" stroke="#E7B977" strokeWidth="4" strokeLinecap="round" opacity="0.8" />
        <rect x="90" y="256" width="260" height="30" rx="8" fill="#A86E2C" />

        {/* The staples, in the order they land. Re-keyed on the household
            size, so changing it refills the basket. */}
        <g key={`${household}-${cycle}`}>
          {/* Coriander, at the back between the sack and the rice. */}
          <g className="hg-drop" style={delay(0)}>
            <path d="M214 300 C 213 240, 208 196, 204 158 M224 300 C 226 236, 230 196, 236 148 M219 300 C 219 244, 220 210, 220 172" stroke="#4E8F2A" strokeWidth="3" fill="none" strokeLinecap="round" />
            <ellipse cx="202" cy="150" rx="14" ry="9" fill="#7FC646" transform="rotate(-25 202 150)" />
            <ellipse cx="238" cy="140" rx="14" ry="9" fill="#98D265" transform="rotate(20 238 140)" />
            <ellipse cx="220" cy="164" rx="12" ry="8" fill="#5FA133" />
            <ellipse cx="194" cy="168" rx="10" ry="7" fill="#98D265" transform="rotate(-40 194 168)" />
            <ellipse cx="244" cy="162" rx="10" ry="7" fill="#7FC646" transform="rotate(35 244 162)" />
          </g>

          {/* Atta sack. */}
          <g className="hg-drop" style={delay(1)}>
            <path d="M100 134 Q96 125 105 120 L177 120 Q186 125 182 134 L189 312 L93 312 Z" fill="#F1E4CC" />
            <path d="M162 121 L177 120 Q186 125 182 134 L189 312 L170 312 Z" fill="#E4D2B2" />
            <rect x="97" y="108" width="88" height="16" rx="5" fill="#E2CDA8" />
            <path d="M101 116 L109 110 L117 116 L125 110 L133 116 L141 110 L149 116 L157 110 L165 116 L173 110 L181 116" fill="none" stroke="#C9B08A" strokeWidth="2" strokeLinejoin="round" />
            <rect x="106" y="144" width="70" height="52" rx="9" fill="#5FA133" />
            <text x="141" y="168" textAnchor="middle" fontSize="16" fontWeight="800" fill="#FFFFFF" fontFamily="inherit" letterSpacing="1">ATTA</text>
            <text x="141" y="186" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#E9F4DC" fontFamily="inherit">10 kg</text>
          </g>

          {/* Basmati bag. */}
          <g className="hg-drop" style={delay(2)}>
            <rect x="254" y="94" width="90" height="218" rx="12" fill="#FFFFFF" stroke="#DCE6FD" strokeWidth="2" />
            <path d="M254 106 Q254 94 266 94 L332 94 Q344 94 344 106 L344 122 L254 122 Z" fill="#054EE8" />
            <text x="299" y="150" textAnchor="middle" fontSize="12.5" fontWeight="800" fill="#054EE8" fontFamily="inherit" letterSpacing="0.8">BASMATI</text>
            <g fill="#EADFC8">
              <ellipse cx="284" cy="170" rx="7" ry="2.6" transform="rotate(-20 284 170)" />
              <ellipse cx="302" cy="166" rx="7" ry="2.6" transform="rotate(15 302 166)" />
              <ellipse cx="316" cy="178" rx="7" ry="2.6" transform="rotate(-35 316 178)" />
              <ellipse cx="292" cy="182" rx="7" ry="2.6" transform="rotate(30 292 182)" />
              <ellipse cx="306" cy="190" rx="7" ry="2.6" transform="rotate(-10 306 190)" />
            </g>
          </g>

          {/* Masala packet. */}
          <g className="hg-drop" style={delay(3)}>
            <rect x="100" y="206" width="52" height="106" rx="6" fill="#F28C28" />
            <rect x="100" y="206" width="52" height="11" rx="4" fill="#D9731A" />
            <circle cx="126" cy="231" r="11" fill="#B5451B" />
            <circle cx="122" cy="228" r="2" fill="#F5B66B" />
            <circle cx="130" cy="232" r="2" fill="#F5B66B" />
            <circle cx="124" cy="236" r="1.7" fill="#F5B66B" />
            <text x="126" y="254" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#FFFFFF" fontFamily="inherit" letterSpacing="0.6">MASALA</text>
          </g>

          {/* Ghee tin. */}
          <g className="hg-drop" style={delay(4)}>
            <rect x="158" y="196" width="62" height="116" fill="#F2C14E" />
            <ellipse cx="189" cy="196" rx="31" ry="8" fill="#F7D57E" />
            <ellipse cx="189" cy="196" rx="24" ry="5" fill="#E9B43C" />
            <rect x="158" y="214" width="62" height="34" fill="#2F8F4E" />
            <text x="189" y="236" textAnchor="middle" fontSize="13" fontWeight="800" fill="#FFFFFF" fontFamily="inherit" letterSpacing="0.8">GHEE</text>
            <rect x="206" y="196" width="7" height="116" fill="#FFFFFF" opacity="0.18" />
          </g>

          {/* Jar of dal. */}
          <g className="hg-drop" style={delay(5)}>
            <rect x="226" y="204" width="56" height="108" rx="10" fill="#FCEBD3" stroke="#F3C98B" strokeWidth="2" />
            <rect x="231" y="222" width="46" height="90" rx="6" fill="#F29F3D" />
            <g fill="#E07A1F">
              <circle cx="238" cy="252" r="2.3" /><circle cx="252" cy="256" r="2.3" /><circle cx="266" cy="250" r="2.3" />
              <circle cx="244" cy="226" r="2.3" /><circle cx="262" cy="228" r="2.3" />
            </g>
            <rect x="222" y="192" width="64" height="15" rx="5" fill="#7FC646" />
            <rect x="236" y="231" width="36" height="17" rx="4" fill="#FFFFFF" />
            <text x="254" y="243.5" textAnchor="middle" fontSize="10" fontWeight="800" fill="#E07A1F" fontFamily="inherit" letterSpacing="0.6">DAL</text>
          </g>

          {/* Chai. */}
          <g className="hg-drop" style={delay(6)}>
            <rect x="288" y="198" width="56" height="114" rx="6" fill="#D7372F" />
            <rect x="288" y="198" width="56" height="14" rx="5" fill="#B92B24" />
            <text x="316" y="231" textAnchor="middle" fontSize="14" fontWeight="800" fill="#FFFFFF" fontFamily="inherit" letterSpacing="1">CHAI</text>
            <rect x="305" y="240" width="18" height="13" rx="4" fill="#FFFFFF" />
            <path d="M323 243 q7 0 7 5 q0 5 -7 5" fill="none" stroke="#FFFFFF" strokeWidth="2.5" />
          </g>
        </g>

        {/* The basket's front, over the staples, woven. */}
        <path d={FRONT} fill="#E2B26C" />
        <g clipPath="url(#hg-basket-front)">
          {[292, 318, 344, 370].map((y) => (
            <rect key={y} x="80" y={y} width="280" height="5" fill="#C9914A" opacity="0.55" />
          ))}
          {Array.from({ length: 13 }, (_, i) => 98 + i * 21).map((x, i) => (
            <rect key={x} x={x} y={i % 2 ? 276 : 302} width="4" height="18" rx="2" fill="#F0C98C" opacity="0.7" />
          ))}
        </g>
        <rect x="78" y="258" width="284" height="22" rx="11" fill="#C4893F" />
        <rect x="92" y="262" width="256" height="4" rx="2" fill="#E7B977" opacity="0.75" />

        {/* The brand on the basket — a cesto, after all. */}
        <rect x="150" y="300" width="104" height="36" rx="18" fill="#FFFFFF" opacity="0.95" />
        <text x="202" y="324" textAnchor="middle" fontSize="18" fontWeight="800" fill="#054EE8" fontFamily="inherit" letterSpacing="-0.3">Cesto</text>
      </svg>

      {/* The tag — whose basket, for how many. Hangs off the basket's lower
          right, clear of the staples. Swings in once they have landed, and
          again when the household size changes. */}
      <figcaption
        key={`${household}-${cycle}`}
        className="hg-swing absolute right-[-4%] top-[78%] bg-surface-cream rounded-xl shadow-float border border-border/60 pl-3 pr-4 py-2.5 flex items-center gap-2.5"
        style={{ animationDelay: '1.05s' }}
      >
        <span className="w-7 h-7 rounded-full bg-amber-deep flex items-center justify-center shrink-0" aria-hidden="true">
          <Check size={15} strokeWidth={3} className="text-white" />
        </span>
        <span className="leading-tight whitespace-nowrap">
          <span className="block text-[14px] font-bold text-ink first-letter:uppercase">{c.basketTitle(monthName(lang))}</span>
          <span className="block text-[13px] text-gray tabular-nums">{c.listFor(household)}</span>
        </span>
      </figcaption>
    </figure>
  );
}
