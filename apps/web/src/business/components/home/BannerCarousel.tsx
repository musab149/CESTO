import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { resolveImageUrl } from '@grocery-app/shared';
import { useBizT } from '../../lib/i18n';
import { prefersLessMotion } from '../../lib/homeLook';

/*
 * The banner ads at the top of the business home (2026-10-31, user: "the
 * carousel will be images"). Each banner is the image the team uploads in
 * Admin → Business home — a wide strip for a computer (4:1, user: "the
 * height of these banners is too much that it covered the whole screen"),
 * a 16:9 one for a phone or a small tablet — filling the frame, with nothing
 * of ours over it (user: "in these banners we will only have the images…
 * that will be uploaded by the admin"). A tap opens its link.
 *
 * A strip of banners that slides: it follows a finger or the mouse while
 * dragged and settles on the nearest; arrows show on hover on a computer;
 * the dots under it jump, the current one filling as its banner plays. It
 * waits while pointed at, focused or dragged, and has a pause button
 * (anything that moves by itself for more than five seconds needs one).
 * Reduced motion: it does not play by itself.
 */

export interface HeroSlide {
  id: string;
  link: string;
  image: string;
  imageMobile: string | null;
}

const SLIDE_MS = 6000;

export function BannerCarousel({ slides, onOpen }: { slides: HeroSlide[]; onOpen: (link: string) => void }) {
  const t = useBizT();
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const [stopped, setStopped] = useState(() => prefersLessMotion());
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number; w: number; moved: boolean; dx: number } | null>(null);
  // The click that ends a drag is not a tap on the banner.
  const dragged = useRef(false);
  const n = slides.length;
  const many = n > 1;
  const at = ((index % n) + n) % n;
  const paused = stopped || hover || drag !== null;

  const go = (i: number) => setIndex(((i % n) + n) % n);
  const next = () => go(at + 1);
  const prev = () => go(at - 1);

  // Dragging: the strip follows; let go past a fifth of a banner and it moves on.
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!many || (e.pointerType === 'mouse' && e.button !== 0)) return;
    start.current = { x: e.clientX, y: e.clientY, w: e.currentTarget.getBoundingClientRect().width, moved: false, dx: 0 };
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!s.moved && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(e.clientY - s.y)) {
      s.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    if (s.moved) { s.dx = dx; setDrag(dx); }
  };
  const onUp = () => {
    const s = start.current;
    start.current = null;
    // The distance from the ref: a quick flick can end before the last move has drawn.
    if (!s || !s.moved) { setDrag(null); return; }
    if (Math.abs(s.dx) > s.w / 5) { if (s.dx < 0) next(); else prev(); }
    setDrag(null);
    dragged.current = true;
    window.setTimeout(() => { dragged.current = false; }, 0);
  };

  return (
    <section
      role="region"
      aria-roledescription="carousel"
      aria-label={t('biz.banners.label')}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      onKeyDown={(e) => { if (e.key === 'ArrowRight') next(); else if (e.key === 'ArrowLeft') prev(); }}
      className="group/banners relative"
    >
      <div
        className="relative overflow-hidden rounded-2xl border border-border bg-surface-cream shadow-card touch-pan-y select-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div
          className={`flex ${drag === null ? 'transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none' : ''}`}
          style={{ transform: `translateX(calc(${-at * 100}% + ${drag ?? 0}px))` }}
        >
          {slides.map((s, i) => {
            const on = i === at;
            const Tag = s.link ? 'button' : 'div';
            return (
              <Tag
                key={s.id}
                {...(s.link ? { type: 'button' as const, onClick: () => { if (!dragged.current) onOpen(s.link); } } : {})}
                role="group"
                aria-roledescription="slide"
                aria-label={`${t('biz.banners.label')} ${i + 1} / ${n}`}
                aria-hidden={!on}
                inert={!on}
                className="relative shrink-0 w-full aspect-[16/9] md:aspect-[4/1] text-left block"
              >
                <picture className="absolute inset-0">
                  {s.imageMobile && <source media="(max-width: 767px)" srcSet={resolveImageUrl(s.imageMobile, 'banner')} />}
                  <img
                    src={resolveImageUrl(s.image, 'banner')}
                    alt=""
                    draggable={false}
                    loading={i === 0 ? 'eager' : 'lazy'}
                    className="w-full h-full object-cover"
                  />
                </picture>
              </Tag>
            );
          })}
        </div>

        {/* arrows: on a computer, while pointing at the banners */}
        {many && (
          <>
            <button
              type="button"
              onClick={prev}
              aria-label={t('biz.stories.prev')}
              className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-card/95 text-ink shadow-card-hover items-center justify-center opacity-0 group-hover/banners:opacity-100 focus-visible:opacity-100 hover:text-brand transition-opacity"
            >
              <ChevronLeft size={20} strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={next}
              aria-label={t('biz.stories.next')}
              className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-card/95 text-ink shadow-card-hover items-center justify-center opacity-0 group-hover/banners:opacity-100 focus-visible:opacity-100 hover:text-brand transition-opacity"
            >
              <ChevronRight size={20} strokeWidth={2} />
            </button>
          </>
        )}
      </div>

      {/* the dots: the current one fills as its banner plays; pause beside them */}
      {many && (
        <div className="mt-3 flex items-center justify-center gap-2">
          {slides.map((s, i) => (
            <button key={s.id} type="button" onClick={() => go(i)} aria-label={t('biz.banners.goTo', { n: i + 1 })} aria-current={i === at} className="group py-1.5">
              <span className={`block h-1.5 rounded-full overflow-hidden transition-[width,background-color] duration-300 ${i === at ? 'w-7 bg-white/30' : 'w-1.5 bg-white/40 group-hover:bg-white/70'}`}>
                {i === at && (
                  <span
                    key={`${s.id}-${index}`}
                    className="biz-story-fill block h-full w-full bg-white"
                    style={{ animationDuration: `${SLIDE_MS}ms`, animationPlayState: paused ? 'paused' : 'running' }}
                    onAnimationEnd={next}
                  />
                )}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setStopped((v) => !v)}
            aria-label={t(stopped ? 'biz.banners.play' : 'biz.banners.pause')}
            className="ml-1 w-7 h-7 rounded-full text-white/80 hover:text-white hover:bg-white/15 flex items-center justify-center transition-colors"
          >
            {stopped ? <Play size={12} strokeWidth={2.25} /> : <Pause size={12} strokeWidth={2.25} />}
          </button>
        </div>
      )}
    </section>
  );
}
