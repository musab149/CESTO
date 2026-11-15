import { useEffect, useMemo, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useBackLinkSlot } from '@/components/BackLinkSlot';

/**
 * The way back, said out loud.
 *
 * Admin had four of these: a bordered square, a cream square, a white square
 * and, on four pages, a text link — all icon-only except the last, all
 * slightly different sizes. An unlabelled arrow is the worst of them on a
 * phone, where there is no page chrome around it to say what it goes back to
 * and no hover to reveal a title.
 *
 * So: one component, always labelled. The label is the destination, not the
 * word "back" — "Volver a clientes" tells you where you land, which is the
 * only thing worth the horizontal space it costs.
 *
 * WHERE IT DRAWS depends on the width, and the page does not have to care.
 * Below lg it renders here, above the page title. From lg it hands itself to
 * the layout instead (see BackLinkSlot) and appears in the top bar, which has
 * room going spare while the reading column does not.
 */
export default function BackLink({
  label, onClick, className = '', onDark = false, title,
}: {
  label: string;
  onClick: () => void;
  /** Drawn beside the link in the layout bar. See BackTarget.title. */
  title?: string;
  /** Spacing only — callers own the gap to whatever follows. */
  className?: string;
  /**
   * Sitting on a coloured bar rather than on the page. Muted grey on brand
   * blue fails contrast and reads as disabled, so the link inverts instead.
   */
  onDark?: boolean;
}) {
  const { claim, release } = useBackLinkSlot();
  // Identity for this instance, so a sibling's unmount cannot clear it.
  const owner = useMemo(() => Symbol('back-link'), []);

  // The handler is almost always an inline arrow, so a new identity every
  // render. Holding it in a ref keeps the effect keyed on the label alone,
  // instead of registering and unregistering on every parent render.
  const handler = useRef(onClick);
  handler.current = onClick;

  useEffect(() => {
    claim(owner, { label, title, onClick: () => handler.current() });
    return () => release(owner);
  }, [label, title, claim, release, owner]);

  return (
    <button
      type="button"
      onClick={onClick}
      // py-2.5/-my-2.5: a 40px-tall thumb target (the text alone is 20px)
      // without moving anything on the page (phone audit, 2026-11-05).
      className={`lg:hidden inline-flex items-center gap-1.5 py-2.5 -my-2.5 text-[13px] font-semibold transition-colors ${
        onDark ? 'text-white/85 hover:text-white' : 'text-muted hover:text-brand'
      } ${className}`}
    >
      <ArrowLeft className="w-4 h-4 shrink-0" strokeWidth={2} />
      <span className="truncate">{label}</span>
    </button>
  );
}
