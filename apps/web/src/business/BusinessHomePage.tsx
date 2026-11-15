import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserRound, WifiOff } from 'lucide-react';
import {
  useBusinessHome, useBusinessMe, useBusinessNewArrivals, useBusinessUsuals, useOrders, useOrdersInProgress,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import { shortDate } from '@/sales/lib/format';
import EmptyState from '@/sales/components/EmptyState';
import { Card } from '@/sales/components/ui';
import { Skeleton } from '@/sales/components/Skeleton';
import { useBizT } from './lib/i18n';
import { useOpenLink } from './lib/links';
import { canWebGL, prefersLessMotion, type Lang } from './lib/homeLook';
import { ProfileCard } from './components/HomeBlocks';
import BusinessBell from './components/BusinessBell';
import { OrderBar } from './components/home/OrderBar';
import { BannerCarousel, type HeroSlide } from './components/home/BannerCarousel';
import { MapStory } from './components/home/MapStory';
import { QuickActions } from './components/home/QuickActions';
import { Announcements } from './components/home/Announcements';
import { PromoBento } from './components/home/PromoBento';
import { ProductRail } from './components/home/ProductRail';
import { ShopsStrip } from './components/home/ShopsStrip';

/**
 * The buyer's home is the map of Spain (2026-11-01, user: "we need to stick
 * with map thing and we can remove others"). The scroll ride, the 4-second
 * film and the plain blocks were tried beside it and dropped.
 *
 *   the map, fixed behind the whole page — MapStory portals it into `backdrop`
 *   ┌ wordmark · bell · account (phones; the sidebar carries the brand on a computer) ┐
 *   ┌ order bar: the orders on their way, live — only while there are some ┐
 *   the story: the admin's logistics points as its chapters, the words
 *   bottom-left, Crear pedido / Ver catálogo on every step; scrolling past
 *   the last step opens the catalogue.
 *
 * A device that can't run the map (no WebGL, or reduced motion) gets the
 * story as plain text on the app's blue sky, and the home's blocks below it.
 */
export default function BusinessHomePage() {
  const t = useBizT();
  const lang = useLanguageStore((s) => s.lang) as Lang;
  const navigate = useNavigate();
  const { data: home } = useBusinessHome();
  // The orders on their way, kept live (it polls): the bar shows them and goes when there are none.
  const { data: active = [] } = useOrdersInProgress();
  const lessMotion = prefersLessMotion();
  const [webgl] = useState(canWebGL);
  const mapLive = !lessMotion && webgl;
  const [backdrop, setBackdrop] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!mapLive) return undefined;
    // the layout's header drops its blue glass while the map is underneath (app.css)
    document.documentElement.dataset.bizHome = 'map';
    return () => { delete document.documentElement.dataset.bizHome; };
  }, [mapLive]);

  return (
    <div className="relative min-w-0">
      {/* Behind the whole page: the map's slot, or the app bar's sky where the map can't run. */}
      {mapLive
        ? <div ref={setBackdrop} />
        : <div className="biz-sky fixed inset-0 pointer-events-none" aria-hidden="true" />}

      {/* Over the map, the page's own layers let the pointer through to it
          wherever they have nothing to offer; their sections stay clickable. */}
      <div className={`relative flex flex-col gap-5 lg:gap-6 ${mapLive ? 'pointer-events-none' : ''}`}>
        <h1 className="sr-only">{t('biz.nav.home')}</h1>

        <div className={`w-full max-w-[1600px] mx-auto flex flex-col gap-4 ${mapLive ? 'pointer-events-auto' : ''}`}>
          {/* On phones this IS the app bar (user: "it will have this one in the
              screenshot") — the layout's own bar stays hidden there, so the
              wordmark rides with the bell and the account square. On a computer
              the sidebar already carries the brand, so the row isn't there at all
              (user, 2026-11-01: "on desktop we don't need this cesto logo"). */}
          <div className="lg:hidden flex items-start justify-between gap-3">
            <SkyMark onMap={mapLive} />
            <div className="lg:hidden flex items-center gap-2 pt-2">
              <BusinessBell />
              <button
                type="button"
                onClick={() => navigate('/business/account')}
                aria-label={t('biz.nav.account')}
                className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-colors ${mapLive ? 'bg-white text-[#131B45] shadow-[0_8px_20px_-8px_rgba(10,20,60,0.45)]' : 'bg-white/15 hover:bg-white/25 active:bg-white/30 text-white'}`}
              >
                <UserRound size={22} strokeWidth={1.9} />
              </button>
            </div>
          </div>
          {active.length > 0 && <OrderBar orders={active} lang={lang} />}
        </div>

        <MapStory logistics={home?.logistics ?? null} lang={lang} reduced={lessMotion} live={mapLive} backdrop={backdrop} />

        {/* The live map ends by opening the catalogue, so nothing waits below it. */}
        {!mapLive && <HomeBlocks lang={lang} inProgress={active.length} />}
      </div>
    </div>
  );
}

/**
 * The home under the text story, where the map can't run: the banners and
 * what to do, Cesto's announcements, the promotions, the rails and the
 * business profile. Its own component, so a home showing the map never
 * fetches what only these blocks read.
 */
function HomeBlocks({ lang, inProgress }: { lang: Lang; inProgress: number }) {
  const t = useBizT();
  const navigate = useNavigate();
  const open = useOpenLink();
  const { data: me, isLoading: meLoading } = useBusinessMe();
  const { data: home, isLoading: homeLoading, isError, refetch } = useBusinessHome();
  const { data: delivered } = useOrders({ status: 'delivered', limit: 1 });
  const { data: usuals, isLoading: usualsLoading } = useBusinessUsuals();
  const { data: fresh, isLoading: freshLoading } = useBusinessNewArrivals();

  const fullName = useAuthStore((s) => s.user?.name) || me?.user.name || '';
  const business = me?.business;
  const notes = home?.announcements ?? [];
  // The banner ads: only the images the team uploads. None uploaded, none shown — no drawn stand-in.
  const slides: HeroSlide[] = (home?.banners ?? []).filter((b) => b.image_url).map((b) => ({
    id: b.id, link: b.link, image: b.image_url!, imageMobile: b.image_mobile_url,
  }));

  return (
    <div className="w-full max-w-[1600px] mx-auto flex flex-col gap-5 lg:gap-6">
      {/* The banners and what to do, with Cesto's announcements beside them on a computer. */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 lg:gap-6">
        <div className={`min-w-0 flex flex-col gap-4 lg:gap-5 ${notes.length > 0 ? 'xl:col-span-8' : 'xl:col-span-12'}`}>
          {homeLoading ? (
            <Skeleton className="aspect-[16/9] md:aspect-[4/1] rounded-2xl" />
          ) : slides.length > 0 ? (
            <BannerCarousel slides={slides} onOpen={open} />
          ) : isError ? (
            <Card>
              <EmptyState
                icon={<WifiOff size={28} strokeWidth={1.75} className="text-muted" />}
                title={t('biz.home.errorTitle')}
                description={t('biz.loadError')}
                action={{ label: t('biz.retry'), onClick: () => { refetch(); } }}
              />
            </Card>
          ) : null}
          <QuickActions lastDeliveredId={delivered?.items?.[0]?.id ?? null} inProgress={inProgress} />
        </div>
        {/* As tall as the banners and actions beside it (h-0 + min-h-full), its list scrolling inside. */}
        {notes.length > 0 && <Announcements className={`xl:col-span-4 ${slides.length > 0 ? 'xl:h-0 xl:min-h-full' : ''}`} items={notes} lang={lang} onOpen={open} />}
      </div>

      {home && home.promotions.length > 0 && <PromoBento promotions={home.promotions} lang={lang} onOpen={open} />}

      <ProductRail
        id="biz-usuals"
        title={t('biz.rail.usuals')}
        subtitle={t('biz.rail.usualsSub')}
        products={usuals ?? []}
        loading={usualsLoading}
        lang={lang}
      />

      <ShopsStrip />

      <ProductRail
        id="biz-new"
        title={t('biz.rail.new')}
        subtitle={t('biz.rail.newSub')}
        products={fresh ?? []}
        loading={freshLoading}
        lang={lang}
        seeAll="/business/catalogue/all?sort=newest"
        seeAllLabel={t('biz.rail.seeAll')}
      />

      <div className="grid grid-cols-1 gap-5 lg:gap-6 xl:grid-cols-12 items-start">
        <ProfileCard
          className="xl:col-span-6"
          company={business?.company ?? ''}
          taxId={me?.user.tax_id || business?.registration_no || ''}
          contact={fullName}
          email={me?.user.email ?? ''}
          phone={business?.contact_phone || me?.user.phone || ''}
          since={business?.approved_at ? t('biz.acc.approved', { date: shortDate(business.approved_at, lang) }) : ''}
          loading={meLoading}
          onOpen={() => navigate('/business/account')}
        />
      </div>
    </div>
  );
}

/**
 * The app's own header, drawn onto the sky: the cesto word (the wordmark
 * asset, cropped to the word and turned white), the leaf, and the brand line.
 * Decorative — the page's heading for readers stays the sr-only "Inicio".
 */
function SkyMark({ onMap = false }: { onMap?: boolean }) {
  // over the map the white mark wears a soft shadow, so it reads on land as well as on sea
  const shade = onMap ? ' drop-shadow(0 2px 10px rgba(5, 20, 70, 0.45))' : '';
  return (
    <div aria-hidden="true" className="select-none pt-1">
      <div className="relative inline-block">
        <div className="relative overflow-hidden" style={{ width: 158, height: 48 }}>
          <img
            src="/cesto-wordmark.png"
            alt=""
            draggable={false}
            className="absolute max-w-none"
            style={{ width: 349, left: -95.5, top: -133.5, filter: `brightness(0) invert(1)${shade}` }}
          />
        </div>
        <svg viewBox="0 0 24 24" className="absolute -right-3.5 -top-2 w-6 h-6" aria-hidden="true">
          <path d="M11.5 14.5 C 6.5 13.5 4.5 9.5 5.5 4.5 C 10.5 5.5 12.5 9.5 11.5 14.5 Z" fill="#4CBB6C" />
          <path d="M13 14.5 C 13 10.8 15.8 8 19.5 8 C 19.5 11.7 16.7 14.5 13 14.5 Z" fill="#2E9E54" />
        </svg>
      </div>
      <p className={`mt-1.5 text-white font-bold font-display text-[15.5px] tracking-[-0.01em] ${onMap ? '[text-shadow:0_1px_8px_rgba(5,20,70,0.5)]' : ''}`}>Shop Smart. Live Better.</p>
    </div>
  );
}
