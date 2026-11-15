import { useId } from 'react';

/**
 * Home Grocery's mark in the navigation: a basket that hops — up, a squash
 * on landing, a little bounce, a rest — on a loop (hg-hop in app.css). It
 * replaced a sparkle emoji: Cesto is a basket, and the motion is what draws
 * the eye to the one link marked NEW. Still with reduced motion.
 */
export default function HopBasket({ size, className = '' }: { size: number; className?: string }) {
  // Two of these can be on a page (the pill and the phone menu), and a mask
  // id must be unique in the document.
  const slots = `hop-basket-${useId().replace(/:/g, '')}`;
  return (
    <span aria-hidden="true" className={`hg-hop inline-flex shrink-0 ${className}`}>
      {/* A FILLED basket in the colour of the text it sits in: green on the
          plain pill, white on the selected one. Drawn rather than taken from
          Lucide, whose basket is outline-only. Same shape as the Home Grocery
          page's big basket — arched handle, rim, woven body — with the slots
          cut through, so whatever is behind shows in them. */}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
        <defs>
          <mask id={slots}>
            <rect width="24" height="24" fill="#fff" />
            <rect x="8.1" y="14" width="1.5" height="4.6" rx="0.75" fill="#000" />
            <rect x="11.25" y="14" width="1.5" height="4.6" rx="0.75" fill="#000" />
            <rect x="14.4" y="14" width="1.5" height="4.6" rx="0.75" fill="#000" />
          </mask>
        </defs>
        <path d="M6.6 10.2 C6.6 3.9 17.4 3.9 17.4 10.2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        <g mask={`url(#${slots})`}>
          <rect x="2" y="9.2" width="20" height="3.6" rx="1.8" />
          <path d="M3.7 12.4 H20.3 L18.9 19.3 Q18.55 21 16.85 21 H7.15 Q5.45 21 5.1 19.3 Z" />
        </g>
      </svg>
    </span>
  );
}
