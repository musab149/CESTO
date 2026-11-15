import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronDown, Plus } from 'lucide-react';
import type { BusinessLogistics, LogisticsIcon } from '@grocery-app/shared';
import { useBizT } from '../../lib/i18n';
import { pick, type Lang } from '../../lib/homeLook';
import type { MapApi, MapPlace, Season } from './SpainMap';

// The map is its own lazy chunk: a device that can't run it never downloads it.
const SpainMap = lazy(() => import('./SpainMap'));

/*
 * The business home's story — the scroll brain over SpainMap.tsx (2026-10-31, user:
 * "as we scroll the text heading and subheading shows in the left bottom
 * without any cards in a better fonts explaining the story and on that map
 * the area related to that story gets highlighted"; low-poly restyle
 * 2026-11-01; then "this map should cover the whole space and everything
 * should be floated above it… the top section blue we don't need").
 *
 * The map is the page's background now: a fixed layer, portalled into the
 * host BusinessHomePage puts first, so the wordmark, the order bar and the
 * header pills float above it. This component's own
 * section is just scroll space; the page's scroll through it becomes one
 * number the camera flies with. The chapter's words stay pinned bottom-left
 * as bare type — a condensed display heading (Archivo, loaded only here)
 * over a warm haze, no card, the season chip beside the counter. Each
 * chapter is sent to a place by its admin icon (store → the partner shops,
 * clock → the depot, truck → the road, receipt → the network), between the
 * whole of Spain and the buyer's shop, where the last words carry Crear
 * pedido. Reduced motion (or no WebGL) gets the words as a plain run of text
 * on the sky, with the home's blocks below them (BusinessHomePage).
 *
 * Every step carries Crear pedido / Ver catálogo, and past the last step the
 * story keeps going for one more stretch: scrolling through it fades the page
 * into the catalogue's own canvas and opens the catalogue (user, 2026-11-01:
 * "on the last step when we scroll it should directly take us to catalogue
 * page"). It only arms once the visitor has been above that stretch during
 * this visit, so a restored scroll position can never bounce anyone away.
 *
 * Phones (2026-11-01, user: "the animation is not working properly with
 * scroll on mobile"): the canvas stands on a stage one LARGE viewport tall
 * (100vh), so the address bar collapsing never resizes — and so never
 * rebuilds — the 3D canvas mid-swipe; the scroll is measured against that
 * same stable height; the words change when the CAMERA reaches a chapter
 * (SpainMap's onChapter), not the instant the finger crosses it; and a
 * chapter gets a little more scroll on a phone, where one flick goes far.
 */

interface Chapter { title: string; body: string; icon?: LogisticsIcon }

const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75,800;100,500;100,600&display=swap';
let fontAsked = false;
const askFont = () => {
  if (fontAsked) return;
  fontAsked = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_HREF;
  document.head.appendChild(link);
};

const PLACE_BY_ICON: Partial<Record<LogisticsIcon, MapPlace>> = {
  store: 'stores', package: 'depot', clock: 'depot', calendar: 'depot', shield: 'depot', phone: 'depot',
  truck: 'road', map: 'road', euro: 'network', receipt: 'network',
};
const ROTATION: MapPlace[] = ['depot', 'stores', 'road', 'south', 'network'];
const seasonNow = (): Season => {
  const m = new Date().getMonth();
  return m === 11 || m < 2 ? 'winter' : m < 5 ? 'spring' : m < 8 ? 'summer' : 'autumn';
};

export function MapStory({ logistics, lang, reduced, live, backdrop }: {
  logistics: BusinessLogistics | null;
  lang: Lang;
  reduced: boolean;
  /** the page gave the map its background slot (WebGL and motion allowed) */
  live: boolean;
  /** where the fixed map layer is portalled: first in the page, under everything */
  backdrop: HTMLElement | null;
}) {
  const t = useBizT();
  const navigate = useNavigate();

  const chapters = useMemo<Chapter[]>(() => {
    const points = logistics?.is_active ? logistics.points : [];
    return [
      {
        title: (logistics && pick(logistics, 'title', lang)) || t('biz.map.introTitle'),
        body: (logistics && pick(logistics, 'body', lang)) || t('biz.map.introBody'),
      },
      ...points.map((p) => ({ title: pick(p, 'title', lang), body: pick(p, 'body', lang), icon: p.icon })),
      { title: t('biz.map.arrivedTitle'), body: t('biz.map.arrivedBody') },
    ];
  }, [logistics, lang, t]);
  const N = chapters.length;

  // every chapter flies to a place; never the same place twice in a row
  const places = useMemo<MapPlace[]>(() => {
    const out: MapPlace[] = ['wide'];
    for (let i = 1; i < N - 1; i++) {
      const icon = chapters[i].icon;
      let pl: MapPlace = (icon && PLACE_BY_ICON[icon]) || ROTATION[(i - 1) % ROTATION.length];
      if (pl === out[i - 1]) pl = ROTATION.find((r) => r !== out[i - 1]) ?? pl;
      out.push(pl);
    }
    out.push('delivery');
    return out;
  }, [chapters, N]);

  const plays = live && !reduced;
  // the land opens in today's season; after that the seasons turn by themselves (SpainMap)
  const [season] = useState<Season>(seasonNow);
  const runwayRef = useRef<HTMLElement | null>(null);
  const exitRef = useRef<HTMLDivElement | null>(null);
  const storyRef = useRef<HTMLDivElement | null>(null);
  const fadeRef = useRef<HTMLDivElement | null>(null);
  const cueLabelRef = useRef<HTMLSpanElement | null>(null);
  const cueBarRef = useRef<HTMLSpanElement | null>(null);
  const hintRef = useRef<HTMLDivElement | null>(null);
  const armed = useRef(false);
  const left = useRef(false);
  // read once per render: plain strings only change with the language, so they're safe effect deps
  const openingText = t('biz.map.opening');
  const keepText = t('biz.map.keepScrolling');
  const apiRef = useRef<MapApi | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const lastP = useRef(0);
  const lastInset = useRef(0);
  const [chapter, setChapter] = useState(0);
  const shown = useRef(0);
  const showChapter = useCallback((ch: number) => {
    if (ch !== shown.current) { shown.current = ch; setChapter(ch); }
  }, []);
  // a flick on a phone travels far: give each chapter more room there
  const [perChapter, setPerChapter] = useState(() => (window.innerWidth < 768 ? 140 : 110));
  useEffect(() => {
    const onResize = () => setPerChapter(window.innerWidth < 768 ? 140 : 110);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => { if (plays) askFont(); }, [plays]);

  useEffect(() => {
    if (!plays) return undefined;
    let raf = 0;
    const measureAndApply = () => {
      raf = 0;
      const runway = runwayRef.current;
      if (!runway) return;
      const rect = runway.getBoundingClientRect();
      // the stage is one large viewport (100vh): a stable yardstick the address bar can't move
      const vh = stageRef.current?.offsetHeight || window.innerHeight;
      const span = rect.height - vh;
      const p = span > 0 ? Math.min(1, Math.max(0, -rect.top / span)) : 0;
      lastP.current = p;
      apiRef.current?.apply(p);
      // the header (desktop) and, near the top, the wordmark and order bar float over the map's top
      lastInset.current = Math.max(window.innerWidth >= 1024 ? 56 : 0, rect.top);
      apiRef.current?.setTopInset(lastInset.current);
      // past the last step: the exit stretch. Through it the words go, a line fills, the page
      // fades into the catalogue's own canvas — and at the end the catalogue opens.
      const exit = exitRef.current;
      const exitP = exit ? Math.min(1, Math.max(0, (vh - exit.getBoundingClientRect().top) / exit.offsetHeight)) : 0;
      if (storyRef.current) storyRef.current.style.opacity = String(Math.max(0, 1 - exitP * 1.8));
      if (cueBarRef.current) cueBarRef.current.style.transform = `scaleX(${exitP})`;
      if (cueLabelRef.current) cueLabelRef.current.textContent = exitP > 0.04 ? openingText : keepText;
      if (fadeRef.current) fadeRef.current.style.opacity = String(Math.min(1, Math.max(0, (exitP - 0.45) / 0.55)));
      if (exitP < 0.2) armed.current = true;
      if (armed.current && exitP >= 0.98 && !left.current) {
        left.current = true;
        navigate('/business/catalogue');
        return;
      }
      if (hintRef.current) hintRef.current.style.opacity = String(1 - Math.min(1, p * 22));
      // the words follow the camera (onChapter); until the map is up, they follow the scroll
      if (!apiRef.current) showChapter(Math.min(N - 1, Math.floor(p * N)));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measureAndApply); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    measureAndApply();
    // landing inside the exit stretch (a restored scroll): step back onto the last step instead
    const exit = exitRef.current;
    if (exit && !armed.current) {
      const vh = stageRef.current?.offsetHeight || window.innerHeight;
      const into = vh - exit.getBoundingClientRect().top;
      if (into > 0) window.scrollTo({ top: window.scrollY - into - 4 });
    }
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [N, plays, backdrop, perChapter, showChapter, navigate, openingText, keepText]);

  const ctas = (
    <div className="flex flex-wrap items-center gap-2.5 pointer-events-auto">
      <button
        type="button"
        onClick={() => navigate('/business/catalogue')}
        className="h-12 px-6 rounded-xl bg-brand hover:bg-brand-mid text-white text-[15px] font-semibold font-display inline-flex items-center gap-2 transition-colors"
      >
        <Plus size={19} strokeWidth={2.25} />
        {t('biz.nav.startOrder')}
      </button>
      <button
        type="button"
        onClick={() => navigate('/business/catalogue/all')}
        className="biz-map-ghost h-12 px-5 rounded-xl text-[15px] font-semibold font-display inline-flex items-center gap-2 transition-colors"
      >
        {t('biz.map.browse')}
        <ArrowRight size={18} strokeWidth={2} />
      </button>
    </div>
  );

  if (!plays) {
    // No scene: the words carry it alone, as a quiet run of text on the sky.
    return (
      <section aria-label={t('biz.map.label')} className="w-full max-w-[1600px] mx-auto">
        <div className="py-5 lg:py-8 flex flex-col gap-7 max-w-[680px]">
          {chapters.map((c, i) => (
            <div key={i}>
              <p className="biz-map-count-sky text-[12.5px] tabular-nums">{String(i + 1).padStart(2, '0')} / {String(N).padStart(2, '0')}</p>
              <h2 className="biz-map-title-sky mt-1 text-[32px] lg:text-[42px] leading-[0.95] [text-wrap:balance]">{c.title}</h2>
              {c.body && <p className="mt-2 text-[14.5px] lg:text-[16px] text-white/85 leading-snug max-w-[560px]">{c.body}</p>}
              {i === N - 1 && <div className="mt-4">{ctas}</div>}
            </div>
          ))}
        </div>
      </section>
    );
  }

  const c = chapters[chapter];
  const layer = (
    <div className="fixed inset-0 lg:left-[248px] z-0 overflow-hidden">
      {/* one large viewport tall, pinned to the top: the address bar can only crop it, never resize it */}
      <div ref={stageRef} className="absolute inset-x-0 top-0 h-screen">
      <Suspense fallback={null}>
        <SpainMap
          places={places}
          season={season}
          words={{
            brand: 'cesto',
            stores: t('biz.map.stores'),
            shop: t('biz.map.yourShop'),
            delivered: t('biz.map.delivered'),
            yourOrder: t('biz.map.yourOrder'),
          }}
          register={(api) => {
            apiRef.current = api;
            api?.apply(lastP.current, true);
            api?.setTopInset(lastInset.current);
          }}
          onChapter={showChapter}
        />
      </Suspense>
      </div>

      {/* a warm haze the words stand in, like morning over the meseta — a gradient, not a card */}
      <div aria-hidden="true" className="biz-map-haze absolute bottom-0 left-0 w-full h-[60%] sm:h-[68%] pointer-events-none z-[1]" />

      <div ref={storyRef} className="absolute inset-0 pointer-events-none z-[3]">
        {/* the words, bottom-left, bare — no card; the heading re-keys so each chapter rises in */}
        <div data-map-words className="absolute left-5 right-5 bottom-28 sm:left-10 sm:right-auto sm:bottom-14 lg:left-14 lg:bottom-14 max-w-[720px]">
          <p className="biz-map-count text-[12.5px] tabular-nums">
            {String(chapter + 1).padStart(2, '0')} / {String(N).padStart(2, '0')}
          </p>
          <div key={chapter} className="biz-map-text">
            <h2 className="biz-map-title mt-2.5 text-[42px] sm:text-[58px] lg:text-[72px] leading-[0.92] [text-wrap:balance]">
              {c.title}
            </h2>
            {c.body && (
              <p className="biz-map-sub mt-3 text-[15px] sm:text-[17px] leading-snug max-w-[520px]">
                {c.body}
              </p>
            )}
          </div>
          {/* on every step, and they stay put while the words change */}
          <div className="mt-5">{ctas}</div>
        </div>

        {/* asked once, then it gets out of the way */}
        <div ref={hintRef} className="biz-map-ink absolute inset-x-0 bottom-5 hidden lg:flex flex-col items-center gap-0.5">
          <span className="text-[13px] font-semibold font-display">{t('biz.map.hint')}</span>
          <ChevronDown size={18} strokeWidth={2.5} className="biz-map-nudge" />
        </div>
      </div>

      {/* …and the page fades into the catalogue's own canvas as the exit stretch is scrolled */}
      <div ref={fadeRef} aria-hidden="true" className="bg-surface-linen absolute inset-0 pointer-events-none z-[5]" style={{ opacity: 0 }} />

      {/* on the last step: keep scrolling and the catalogue opens */}
      {chapter === N - 1 && (
        <div data-map-cue className="absolute inset-x-0 top-20 z-[6] flex justify-center pointer-events-none biz-map-text">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-card border border-border shadow-float px-5 py-3">
            <div className="flex items-center gap-1.5 text-ink">
              <span ref={cueLabelRef} className="text-[13.5px] font-semibold font-display">{keepText}</span>
              <ChevronDown size={16} strokeWidth={2.5} className="biz-map-nudge" />
            </div>
            <span className="block w-44 h-1.5 rounded-full bg-[rgba(19,27,69,0.14)] overflow-hidden">
              <span ref={cueBarRef} className="block h-full w-full rounded-full bg-brand origin-left" style={{ transform: 'scaleX(0)' }} />
            </span>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* the story's scroll space: the page scrolls through it, the map flies with it */}
      <section ref={runwayRef} aria-label={t('biz.map.label')} className="relative pointer-events-none" style={{ height: `${N * perChapter}vh` }} />
      {/* one more stretch past the last step: scrolling through it opens the catalogue */}
      <div ref={exitRef} data-map-exit aria-hidden="true" className="pointer-events-none" style={{ height: '70vh' }} />
      {backdrop && createPortal(layer, backdrop)}
    </>
  );
}
