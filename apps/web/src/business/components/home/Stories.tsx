import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ChevronLeft, ChevronRight, Megaphone, Tag, X } from 'lucide-react';
import { resolveImageUrl, type BusinessHomeTone } from '@grocery-app/shared';
import { useBusinessSeenStore } from '@/stores/businessSeenStore';
import { useBizT } from '../../lib/i18n';
import type { Story } from '../../lib/stories';
import { CANVAS, TAG_TONE, dayParts, pick, type Lang } from '../../lib/homeLook';

/*
 * A story, full screen (2026-10-31): Cesto's announcements on the business
 * home open here one by one (components/home/Announcements), as the statuses
 * every buyer here already reads on WhatsApp. It moves on by itself; tapping
 * the left third goes back, the rest forward, holding pauses, Esc closes, a
 * computer has arrows. Opening one marks it seen (stores/businessSeenStore).
 * Always dark — a photo's frame, the same in either theme.
 */

const toneOf = (s: Story): BusinessHomeTone => (s.kind === 'promo' ? s.item.tone : TAG_TONE[s.item.tag]) ?? 'blue';

// ─── The viewer ───────────────────────────────────────────────────────────

const PROMO_MS = 6000;
const NOTE_MS = 7000;

export function StoryViewer({ stories, start, lang, onOpen, onClose }: {
  stories: Story[]; start: number; lang: Lang; onOpen: (link: string) => void; onClose: () => void;
}) {
  const t = useBizT();
  const markSeen = useBusinessSeenStore((s) => s.markSeen);
  const [index, setIndex] = useState(start);
  const [paused, setPaused] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const held = useRef<number | null>(null);
  const story = stories[index];

  const next = () => (index < stories.length - 1 ? setIndex(index + 1) : onClose());
  const prev = () => setIndex(Math.max(0, index - 1));

  // Opening a story is seeing it.
  useEffect(() => { markSeen(story.id); }, [story.id, markSeen]);

  // The page stays still behind it; focus starts on Close; keys move or close.
  useEffect(() => {
    const body = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => { document.body.style.overflow = body; };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // A tap moves; a press held past a moment pauses until it lets go.
  const down = () => { held.current = window.setTimeout(() => setPaused(true), 220); };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    if (held.current) window.clearTimeout(held.current);
    if (paused) { setPaused(false); return; }
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX - r.left < r.width / 3) prev(); else next();
  };

  const tone = toneOf(story);
  const title = pick(story.item, 'title', lang);
  const body = pick(story.item, 'body', lang);
  const img = story.kind === 'promo' ? story.item.image_url : null;
  const badge = story.kind === 'promo' ? pick(story.item, 'badge', lang) : '';
  const link = story.kind === 'promo' ? story.item.link : '';
  const ms = story.kind === 'promo' ? PROMO_MS : NOTE_MS;

  return createPortal(
    <div className="sales-app fixed inset-0 z-[80] bg-veil/95 flex items-center justify-center" role="dialog" aria-modal="true" aria-label={t('biz.notes.title')}>
      <div className="relative w-full h-full md:w-[420px] md:h-[min(780px,92vh)] md:rounded-3xl overflow-hidden text-white biz-story-in shadow-[0_30px_80px_-20px_rgba(0,0,0,0.6)]">
        {/* the canvas */}
        <div key={story.id} className={`absolute inset-0 bg-gradient-to-br ${CANVAS[tone]} biz-story-swap`}>
          {img && <img src={resolveImageUrl(img, 'banner')} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />}
          <span aria-hidden="true" className={`absolute inset-0 ${img ? 'bg-[linear-gradient(to_top,rgba(0,0,0,0.9)_0%,rgba(0,0,0,0.72)_32%,rgba(0,0,0,0.12)_62%,rgba(0,0,0,0.38)_100%)]' : 'bg-gradient-to-t from-black/30 to-transparent'}`} />
        </div>

        {/* the timer: one bar a story */}
        <div className="pointer-events-none absolute top-0 inset-x-0 z-20 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] flex gap-1">
          {stories.map((s, i) => (
            <span key={s.id} className="flex-1 h-[3px] rounded-full bg-white/30 overflow-hidden">
              {i < index && <span className="block h-full w-full bg-white" />}
              {i === index && (
                <span
                  key={`${s.id}-${index}`}
                  className="biz-story-fill block h-full w-full bg-white"
                  style={{ animationDuration: `${ms}ms`, animationPlayState: paused ? 'paused' : 'running' }}
                  onAnimationEnd={next}
                />
              )}
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute top-0 inset-x-0 z-20 px-3 pt-[max(1.6rem,calc(env(safe-area-inset-top)+0.85rem))] flex items-center gap-2">
          <img src="/cesto-icon.png" alt="" className="w-8 h-8 rounded-full ring-2 ring-white/40" draggable={false} />
          <span className="text-[13.5px] font-semibold font-display">Cesto</span>
          {paused && <span className="text-[12px] text-white/70">· {t('biz.stories.paused')}</span>}
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={t('biz.stories.close')}
            className="pointer-events-auto ml-auto w-10 h-10 rounded-full bg-black/25 hover:bg-black/40 flex items-center justify-center"
          >
            <X size={20} strokeWidth={2} />
          </button>
        </div>

        {/* tap zones: back on the left third, on everywhere else; hold to pause */}
        <div
          className="absolute inset-0 z-10 select-none"
          onPointerDown={down}
          onPointerUp={up}
          onPointerLeave={() => { if (held.current) window.clearTimeout(held.current); setPaused(false); }}
          onContextMenu={(e) => e.preventDefault()}
        />

        {/* the words */}
        <div key={`w-${story.id}`} className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] biz-story-rise ${img ? '' : 'top-0 flex flex-col justify-center'}`}>
          {!img && (
            <span className="mb-6 w-20 h-20 rounded-3xl bg-white/15 ring-1 ring-inset ring-white/25 flex flex-col items-center justify-center">
              {story.kind === 'note' && story.item.date ? (
                <>
                  <span className="text-[30px] font-bold font-display tabular-nums leading-none">{dayParts(story.item.date, lang).day}</span>
                  <span className="mt-1 text-[13px] font-semibold font-display leading-none">{dayParts(story.item.date, lang).month}</span>
                </>
              ) : story.kind === 'promo' ? <Tag size={34} strokeWidth={1.6} /> : <Megaphone size={34} strokeWidth={1.6} />}
            </span>
          )}
          <span className="self-start inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-white/20 backdrop-blur text-[12.5px] font-semibold font-display">
            {story.kind === 'promo' ? (badge || t('biz.stories.promo')) : t(`biz.home.tag.${story.item.tag}`)}
          </span>
          <h3 className="mt-3 text-[28px] sm:text-[30px] font-bold font-display leading-[1.08] tracking-[-0.02em]">{title}</h3>
          {body && <p className="mt-2.5 text-[15.5px] leading-relaxed text-white/85 whitespace-pre-line">{body}</p>}
          {link && (
            <button
              type="button"
              onClick={() => { onClose(); onOpen(link); }}
              className="pointer-events-auto mt-6 w-full h-[52px] rounded-xl bg-white text-brand text-[15px] font-semibold font-display inline-flex items-center justify-center gap-2 active:scale-[0.99] transition-transform"
            >
              {t('biz.home.promoOpen')}
              <ArrowRight size={18} strokeWidth={2} />
            </button>
          )}
        </div>

      </div>

      {/* A computer has arrows too, beside the story rather than over its words. */}
      <button type="button" onClick={prev} disabled={index === 0} aria-label={t('biz.stories.prev')}
        className="hidden md:flex absolute left-[calc(50%-268px)] top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white items-center justify-center disabled:opacity-0">
        <ChevronLeft size={22} strokeWidth={2} />
      </button>
      <button type="button" onClick={next} aria-label={t('biz.stories.next')}
        className="hidden md:flex absolute right-[calc(50%-268px)] top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white items-center justify-center">
        <ChevronRight size={22} strokeWidth={2} />
      </button>
    </div>,
    document.body,
  );
}
