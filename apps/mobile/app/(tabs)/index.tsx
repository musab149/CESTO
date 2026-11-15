import { View, Text, ScrollView, Pressable, Image, FlatList, Dimensions, ActivityIndicator, TextInput, StyleSheet, RefreshControl } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, Sparkles, Truck, ShieldCheck, Clock, Tag, Megaphone, Star, Flame, Search, Headphones, RotateCcw, Wallet, LayoutGrid } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  useBanners, useCategories, useSponsoredProducts,
  useInfiniteProducts, useProducts, resolveImageUrl,
  usePromoGrid, useAdsBanner, useTopShops, useBrandsList,
  useShopByOrigin, useOriginCounts,
  defaultPromoGrid, defaultAdsBanner, defaultTopShops,
  useSubmitSupportTicket,
} from '@grocery-app/shared';
import type {
  Product, Category, Banner,
  PromoTile, AdsBannerSection, TopBrand, TopShop, OriginCard,
} from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import { dedupeById } from '../../src/lib/dedupe';
import { useLanguageStore } from '../../src/stores/languageStore';
import { deliveryLabel } from '../../src/lib/deliveryCopy';
import { useAppContent } from '@grocery-app/shared';
import { useToast } from '../../src/components/Toast';
import ProductCard from '../../src/components/ProductCard';
import Skeleton from '../../src/components/Skeleton';
import AppHeader from '../../src/components/AppHeader';

/* Category emoji palette — fallback tints when admin hasn't uploaded a
   category icon. Same six tints as web HomePage. */
const CATEGORY_PALETTES: { tint: string; emoji: string }[] = [
  { tint: '#FEF3D1', emoji: '🌾' },
  { tint: '#E9F4DC', emoji: '🫘' },
  { tint: '#DCFCE7', emoji: '🌶️' },
  { tint: '#FAE4E0', emoji: '🥫' },
  { tint: '#DCE6FD', emoji: '🍚' },
  { tint: '#FEF3D1', emoji: '🧂' },
];

/* Testimonials — same three voices as web Feedback section. */
const TESTIMONIALS = [
  {
    initials: 'PM', name_en: 'Priya M.', name_es: 'Priya M.', city: 'Madrid', rating: 5,
    quote_en: 'The best desi grocery store in Madrid. My mum finally gets her Tilda basmati without leaving the house.',
    quote_es: 'La mejor tienda desi de Madrid. Mi madre por fin consigue su Tilda basmati sin salir de casa.',
    accent: '#DCE6FD',
  },
  {
    initials: 'AK', name_en: 'Ahmed K.', name_es: 'Ahmed K.', city: 'Barcelona', rating: 5,
    quote_en: 'Same-day delivery, authentic spices, fair prices. Cesto changed how I cook every week.',
    quote_es: 'Entrega el mismo día, especias auténticas, precios justos. Cesto cambió cómo cocino cada semana.',
    accent: '#E9F4DC',
  },
  {
    initials: 'LR', name_en: 'Laura R.', name_es: 'Laura R.', city: 'Valencia', rating: 4,
    quote_en: 'Found ingredients I have been searching for since moving from Lima. The rashan packs are a lifesaver.',
    quote_es: 'Encontré ingredientes que buscaba desde mudarme de Lima. Los packs rashan son un salvavidas.',
    accent: '#FAE4E0',
  },
] as const;

/* Brand promo cards — three static cards rendered under the Top Brands logo
   row. Mirrors web BRAND_PROMOS exactly. */
type BrandPromo = {
  title_en: string; title_es: string;
  subtitle_en: string; subtitle_es: string;
  bg: string; accent: string; haloTint: string;
  Icon: LucideIcon;
  link: string;
};
const BRAND_PROMOS: BrandPromo[] = [
  {
    title_en: 'Taste the Tradition', title_es: 'Saborea la tradición',
    subtitle_en: 'Authentic spices from trusted brands',
    subtitle_es: 'Especias auténticas de marcas de confianza',
    bg: '#EEF7DC', accent: '#4F9A2E', haloTint: '#D6ECB1',
    Icon: Flame, link: '/(tabs)/categories',
  },
  {
    title_en: 'Special Offers On Bestsellers', title_es: 'Ofertas en los más vendidos',
    subtitle_en: 'Up to 30% off on premium products',
    subtitle_es: 'Hasta 30% en productos premium',
    bg: '#FFF1E1', accent: '#E27226', haloTint: '#FCD9B0',
    Icon: Tag, link: '/(tabs)/categories',
  },
  {
    title_en: 'Quality You Can Trust', title_es: 'Calidad en la que confiar',
    subtitle_en: '100% original products from top brands',
    subtitle_es: 'Productos 100% originales de marcas top',
    bg: '#E5F0FB', accent: '#2479C9', haloTint: '#C2DBF4',
    Icon: ShieldCheck, link: '/(tabs)/categories',
  },
];

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/* ──────────────────────────────────────────────────────────
   parseBackground — CSS background strings from the admin
   home-sections config can be solid hex (#0F172A) or
   `linear-gradient(<angle>deg, <hex> <stop>%, ...)`. RN
   doesn't speak CSS, so we parse to either:
     - { kind: 'solid', color }
     - { kind: 'gradient', colors, locations? }
   Diagonal angles all collapse to top-left → bottom-right.
   ────────────────────────────────────────────────────────── */
type ParsedBg =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; colors: string[]; locations?: number[] };

function parseBackground(bg: string | null | undefined): ParsedBg {
  const fallback: ParsedBg = { kind: 'solid', color: '#FFFFFF' };
  if (!bg) return fallback;
  const trimmed = bg.trim();

  if (trimmed.toLowerCase().startsWith('linear-gradient')) {
    const inner = trimmed.slice(trimmed.indexOf('(') + 1, trimmed.lastIndexOf(')'));
    const parts = splitGradientParts(inner);
    // First part is the angle ("135deg") — we ignore the value and just go
    // top-left → bottom-right. That's "good enough" for the diagonal
    // gradients used in the admin defaults.
    const stops = parts.slice(parts[0]?.toLowerCase().includes('deg') ? 1 : 0);
    const cols: string[] = [];
    const locs: number[] = [];
    for (const stop of stops) {
      const m = stop.match(/(#[0-9a-f]{3,8}|rgba?\([^)]+\))\s*(\d+(?:\.\d+)?)%?\s*$/i);
      if (m) {
        cols.push(m[1]);
        locs.push(parseFloat(m[2]) / 100);
      } else {
        const colorOnly = stop.match(/(#[0-9a-f]{3,8}|rgba?\([^)]+\))/i);
        if (colorOnly) {
          cols.push(colorOnly[1]);
          locs.push(NaN);
        }
      }
    }
    if (cols.length >= 2) {
      const allValid = locs.every((l) => !Number.isNaN(l));
      return allValid
        ? { kind: 'gradient', colors: cols, locations: locs }
        : { kind: 'gradient', colors: cols };
    }
    return fallback;
  }

  return { kind: 'solid', color: trimmed };
}

/** Split a gradient's inner part list on commas, ignoring commas inside
 *  parenthesised colour functions like rgba(0,0,0,0.5). */
function splitGradientParts(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/** Fill the parent with a solid color or a top-left→bottom-right gradient. */
function BackgroundFill({ bg }: { bg: string | null | undefined }) {
  const parsed = parseBackground(bg);
  if (parsed.kind === 'gradient') {
    return (
      <LinearGradient
        colors={parsed.colors as [string, string, ...string[]]}
        locations={parsed.locations as [number, number, ...number[]] | undefined}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    );
  }
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: parsed.color }]} />;
}

/** "#054EE8" + 0.5 → "rgba(5,78,232,0.5)". Returns the input unchanged for
 *  rgba inputs we don't need to alpha-blend. */
function withAlpha(hex: string, a: number): string {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (full.length !== 6) return hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/* ──────────────────────────────────────────────────────────
   SectionHeader — same chrome as web (title + optional "see more")
   ────────────────────────────────────────────────────────── */
function SectionHeader({ title, subtitle, seeMore, onSeeMore, eyebrow }: {
  title: string; subtitle?: string; seeMore?: string; onSeeMore?: () => void; eyebrow?: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 10 }}>
      <View style={{ flex: 1 }}>
        {eyebrow && (
          <Text style={{ fontSize: 10, letterSpacing: 1.5, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', marginBottom: 2 }}>
            {eyebrow}
          </Text>
        )}
        <Text style={{ fontSize: 22, fontWeight: '600', color: colors.ink, letterSpacing: -0.6 }}>{title}</Text>
        {subtitle && <Text style={{ fontSize: 12, color: colors.gray, marginTop: 2 }}>{subtitle}</Text>}
      </View>
      {onSeeMore && (
        <Pressable
          onPress={onSeeMore}
          hitSlop={6}
          accessibilityLabel={seeMore}
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            backgroundColor: colors.brand.DEFAULT,
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: 12,
          }}
        >
          <ArrowRight size={16} color="#fff" strokeWidth={2.5} />
        </Pressable>
      )}
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   HeroCarousel — admin banners with web-style fallback slides
   ────────────────────────────────────────────────────────── */
interface HeroSlide {
  /** Kept for parity with web's alt text; not rendered on this screen. */
  title: string;
  cta: string;
  link: string; image: string | null; bg: string;
  theme?: 'light' | 'dark';
  linkType?: Banner['link_type']; linkTarget?: string | null;
}


function HeroCarousel({ banners }: { banners: Banner[] }) {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const [active, setActive] = useState(0);
  const listRef = useRef<FlatList<HeroSlide>>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  /**
   * No banners configured -> render nothing (see below).
   *
   * Three hard-coded fallback slides used to live here carrying marketing
   * copy. The banner is artwork plus a CTA now, and these had no artwork, so
   * they degraded to a blank card with a lone button — which says less than
   * showing nothing. Only the background they supplied is still needed, for a
   * real banner saved without one.
   */
  const DEFAULT_BG = '#FFFFFF';

  const slides: HeroSlide[] = useMemo(() => {
    const pickLang = (en: string | null | undefined, es: string | null | undefined) =>
      lang === 'en' ? (en?.trim() || es?.trim() || '') : (es?.trim() || en?.trim() || '');
    return banners.map((b) => ({
      title: pickLang(b.title_en, b.title_es),
      cta: pickLang(b.cta_en, b.cta_es) || (lang === 'en' ? 'Shop now' : 'Comprar ahora'),
      link: '',
      // `?? ` alone was wrong: it only falls through on null/undefined, so a
      // banner saved with image_mobile = '' rendered NO artwork at all rather
      // than falling back to the desktop upload. Web has always used a trim
      // check here; this matches it.
      //
      // 'banner' (the 1600px master), not 'hero' (800px). The card is now
      // full-bleed 2:1, which on a large phone at 3x is ~1170 device px — 800
      // would be a 1.4x upscale. That mattered little when the banner was
      // artwork behind an overlay, but the copy now lives IN the artwork, so
      // soft text is soft messaging. These masters are 56-84 KB.
      image: resolveImageUrl(
        b.image_mobile?.trim() ? b.image_mobile : b.image_desktop,
        'banner',
      ),
      bg: b.background?.trim() || DEFAULT_BG,
      theme: b.text_theme ?? 'dark',
      linkType: b.link_type,
      linkTarget: b.link_target,
    }));
  }, [banners, lang]);

  // Each slide takes the full screen width so `pagingEnabled` snaps cleanly
  // to one card at a time. The 20px outer gutter is applied as padding
  // INSIDE each slide, so neighbouring cards stay fully off-screen.
  const slideWidth = SCREEN_WIDTH;

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setActive((c) => {
        const next = (c + 1) % slides.length;
        listRef.current?.scrollToOffset({ offset: next * slideWidth, animated: true });
        return next;
      });
    }, 7000);
  }, [slides.length, slideWidth]);

  useEffect(() => { startTimer(); return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, [startTimer]);

  // Nothing configured, nothing to show. After every hook so hook order stays
  // stable, and before the FlatList, which would otherwise render an empty
  // carousel with a single dot under it.
  if (slides.length === 0) return null;

  function onSlidePress(s: HeroSlide) {
    if (s.linkType === 'category' && s.linkTarget) {
      router.push(`/category/${s.linkTarget}`);
    } else if (s.linkType === 'product' && s.linkTarget) {
      router.push(`/product/${s.linkTarget}`);
    } else if (s.link) {
      router.push(s.link as never);
    }
  }

  return (
    <View style={{ marginTop: 18 }}>
      <FlatList
        ref={listRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          const idx = Math.round(e.nativeEvent.contentOffset.x / slideWidth);
          setActive(idx);
          startTimer();
        }}
        keyExtractor={(_, i) => `hero-${i}`}
        renderItem={({ item }) => {
          // Copy (eyebrow / title / subtitle) is no longer rendered — the
          // banner is the artwork plus a single CTA, matching web. The fields
          // are still fetched, so admin-entered copy is not lost. The
          // light/dark theme colours went with them: the CTA is brand-filled
          // at every theme, so nothing left depends on it.
          const ctaBg = colors.brand.DEFAULT;
          const ctaTextColor = '#FFFFFF';
          return (
            <View style={{ width: SCREEN_WIDTH, paddingHorizontal: 20 }}>
              <Pressable
                onPress={() => onSlidePress(item)}
                style={{
                  // 2:1, to match the artwork admins actually upload for
                  // mobile — the three live banners are 1600x800 and 1536x1024.
                  //
                  // This was minHeight: 120, which on a ~375pt screen is a
                  // 3.1:1 box. resizeMode="cover" then cropped a 2:1 image top
                  // and bottom and showed roughly its middle third, so the
                  // mobile banner looked like it was not being used at all.
                  // Web has never had this problem: its mobile height (190px
                  // at ~375 wide) is already almost exactly 2:1.
                  //
                  // aspectRatio rather than a fixed height so it holds on any
                  // screen width, and so every slide is identical — the
                  // carousel would jump between slides of different heights.
                  width: '100%', aspectRatio: 2,
                  borderRadius: 12, overflow: 'hidden',
                  backgroundColor: item.bg, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
                }}
              >
                {item.image && (
                  <Image source={{ uri: item.image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                )}
                {/* CTA pinned bottom-left over the artwork. The card's own
                    aspectRatio sets the height now, so this just fills it. */}
                <View style={{ padding: 14, flex: 1, justifyContent: 'flex-end', alignItems: 'flex-start' }}>
                  {item.cta ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 14, borderRadius: 999, backgroundColor: ctaBg }}>
                      <Text style={{ fontSize: 11.5, fontWeight: '700', color: ctaTextColor, letterSpacing: -0.2 }}>{item.cta}</Text>
                      <ArrowRight size={12} color={ctaTextColor} strokeWidth={2.5} />
                    </View>
                  ) : null}
                </View>
              </Pressable>
            </View>
          );
        }}
      />
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 5, marginTop: 12 }}>
        {slides.map((_, i) => (
          <View key={i} style={{ width: i === active ? 22 : 6, height: 6, borderRadius: 3, backgroundColor: i === active ? colors.ink : colors.border }} />
        ))}
      </View>
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   1 · NEW PRODUCTS — horizontal carousel of just-landed items
   ────────────────────────────────────────────────────────── */
function NewProducts({ products }: { products: Product[] }) {
  const router = useRouter();
  const { lang } = useLanguageStore();
  if (products.length === 0) return null;
  return (
    <View>
      <SectionHeader
        title={lang === 'en' ? 'New products' : 'Nuevos productos'}
        subtitle={lang === 'en' ? 'Just landed in store' : 'Recién llegados a la tienda'}
        seeMore={lang === 'en' ? 'See all' : 'Ver todo'}
        onSeeMore={() => router.push('/(tabs)/categories')}
      />
      <FlatList
        data={products.slice(0, 10)}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ width: 170 }}>
            <ProductCard product={item} />
          </View>
        )}
      />
    </View>
  );
}

function PopularProducts({ products }: { products: Product[] }) {
  const router = useRouter();
  const { lang } = useLanguageStore();
  if (products.length === 0) return null;
  return (
    <View>
      <SectionHeader
        title={lang === 'en' ? 'Popular products' : 'Productos populares'}
        subtitle={lang === 'en' ? 'What shoppers are picking up right now' : 'Lo que los clientes eligen ahora'}
        seeMore={lang === 'en' ? 'See all' : 'Ver todo'}
        onSeeMore={() => router.push('/(tabs)/categories')}
      />
      <FlatList
        data={products.slice(0, 10)}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ width: 170 }}>
            <ProductCard product={item} />
          </View>
        )}
      />
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   2 · PROMO GRID — admin-driven feature + wide + 2× compact
   ────────────────────────────────────────────────────────── */
function tileText(tile: PromoTile, field: 'eyebrow' | 'title' | 'description' | 'cta', lang: 'en' | 'es'): string {
  const key = `${field}_${lang}` as const;
  return (tile[key] as string | null) ?? '';
}

function navigateTile(router: ReturnType<typeof useRouter>, link: string) {
  if (!link) return;
  // Web routes start with `/` (e.g. /rashan, /categories, /login). On mobile
  // they map onto the (tabs) routes or auth/feature routes.
  const map: Record<string, string> = {
    '/rashan': '/(tabs)/rashan',
    '/categories': '/(tabs)/categories',
    '/login': '/(auth)/login',
  };
  const [base, qs] = link.split('?');
  // /categories with a filter (?origin / ?brand / ?sponsored) is a filtered
  // product slice — route to the dedicated browse screen that reads those
  // query params instead of dumping into the bare categories tab.
  if (base === '/categories' && qs && /(^|&)(origin|brand|sponsored)=/.test(qs)) {
    router.push(`/browse?${qs}` as never);
    return;
  }
  const target = map[base] ?? base;
  router.push((qs ? `${target}?${qs}` : target) as never);
}

function PromoFeatureTile({ tile, lang }: { tile: PromoTile; lang: 'en' | 'es' }) {
  const router = useRouter();
  const hasImage = !!tile.image_url;
  const accent = colors.brand.DEFAULT;
  const isLight = tile.text_theme === 'light';
  const textColor = isLight ? '#FFFFFF' : colors.ink;
  const mutedColor = isLight ? 'rgba(255,255,255,0.85)' : colors.gray;
  return (
    <Pressable
      onPress={() => navigateTile(router, tile.link)}
      style={({ pressed }) => ({
        borderRadius: 12, overflow: 'hidden', minHeight: 240, padding: 22,
        justifyContent: 'space-between',
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <BackgroundFill bg={tile.background} />
      {hasImage && (
        <>
          <Image source={{ uri: tile.image_url! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        </>
      )}
      <View>
        <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.9)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 }}>
          <Sparkles size={11} color={accent} strokeWidth={2.5} />
          <Text style={{ fontSize: 10, fontWeight: '700', color: accent, letterSpacing: 1.6, textTransform: 'uppercase' }}>
            {tileText(tile, 'eyebrow', lang)}
          </Text>
        </View>
        <Text style={{ fontSize: 26, fontWeight: '600', color: textColor, marginTop: 14, lineHeight: 30, letterSpacing: -0.7 }}>
          {tileText(tile, 'title', lang)}
        </Text>
        {!!tileText(tile, 'description', lang) && (
          <Text style={{ fontSize: 13, color: mutedColor, marginTop: 8, lineHeight: 18 }} numberOfLines={3}>
            {tileText(tile, 'description', lang)}
          </Text>
        )}
      </View>
      <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16, height: 40, paddingHorizontal: 18, borderRadius: 999, backgroundColor: accent }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff', letterSpacing: -0.2 }}>
          {tileText(tile, 'cta', lang)}
        </Text>
        <ArrowRight size={14} color="#fff" strokeWidth={2.5} />
      </View>
    </Pressable>
  );
}

function PromoWideTile({ tile, lang }: { tile: PromoTile; lang: 'en' | 'es' }) {
  const router = useRouter();
  const hasImage = !!tile.image_url;
  const accent = colors.brand.DEFAULT;
  const isLight = tile.text_theme === 'light';
  const textColor = isLight ? '#FFFFFF' : colors.ink;
  return (
    <Pressable
      onPress={() => navigateTile(router, tile.link)}
      style={({ pressed }) => ({
        borderRadius: 12, overflow: 'hidden', minHeight: 130, padding: 18,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <BackgroundFill bg={tile.background} />
      {hasImage && (
        <>
          <Image source={{ uri: tile.image_url! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        </>
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 10.5, fontWeight: '700', color: accent, letterSpacing: 1.8, textTransform: 'uppercase' }}>
          {tileText(tile, 'eyebrow', lang)}
        </Text>
        <Text style={{ fontSize: 19, fontWeight: '500', color: textColor, marginTop: 6, letterSpacing: -0.4, lineHeight: 23 }}>
          {tileText(tile, 'title', lang)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: accent }}>
            {tileText(tile, 'cta', lang)}
          </Text>
          <ArrowRight size={12} color={accent} strokeWidth={2.5} />
        </View>
      </View>
      {!hasImage && (
        <Truck size={48} color={colors.brand.DEFAULT} strokeWidth={1.4} style={{ opacity: 0.5, marginLeft: 12 }} />
      )}
    </Pressable>
  );
}

function PromoCompactTile({ tile, lang }: { tile: PromoTile; lang: 'en' | 'es' }) {
  const router = useRouter();
  const hasImage = !!tile.image_url;
  const accent = colors.amber.deep;
  const isLight = tile.text_theme === 'light';
  const textColor = isLight ? '#FFFFFF' : colors.ink;
  return (
    <Pressable
      onPress={() => navigateTile(router, tile.link)}
      style={({ pressed }) => ({
        flex: 1, borderRadius: 12, overflow: 'hidden', minHeight: 140, padding: 16,
        justifyContent: 'space-between',
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <BackgroundFill bg={tile.background} />
      {hasImage && (
        <>
          <Image source={{ uri: tile.image_url! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        </>
      )}
      <View>
        <Text style={{ fontSize: 10, fontWeight: '700', color: accent, letterSpacing: 1.4, textTransform: 'uppercase' }}>
          {tileText(tile, 'eyebrow', lang)}
        </Text>
        <Text style={{ fontSize: 16, fontWeight: '500', color: textColor, marginTop: 6, lineHeight: 20, letterSpacing: -0.3 }}>
          {tileText(tile, 'title', lang)}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: accent }}>
          {tileText(tile, 'cta', lang)}
        </Text>
        <ArrowRight size={11} color={accent} strokeWidth={2.5} />
      </View>
    </Pressable>
  );
}

function PromoGrid() {
  const { lang } = useLanguageStore();
  const { data } = usePromoGrid();
  const config = data ?? defaultPromoGrid;
  const tiles = config.tiles.filter((t) => t.is_active).sort((a, b) => a.display_order - b.display_order);
  const feature = tiles.find((t) => t.variant === 'feature') ?? tiles[0];
  const wide = tiles.find((t) => t.variant === 'wide');
  const compacts = tiles.filter((t) => t.variant === 'compact').slice(0, 2);
  if (!feature) return null;

  return (
    <View style={{ paddingHorizontal: 20, gap: 12 }}>
      <PromoFeatureTile tile={feature} lang={lang} />
      {wide && <PromoWideTile tile={wide} lang={lang} />}
      {compacts.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          {compacts.map((c) => <PromoCompactTile key={c.id} tile={c} lang={lang} />)}
        </View>
      )}
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   3 · FEATURED CATEGORIES — image-forward category tiles
   ────────────────────────────────────────────────────────── */
function FeaturedCategories({ categories, hideHeader = false }: { categories: Category[]; hideHeader?: boolean }) {
  const router = useRouter();
  const { lang } = useLanguageStore();
  if (categories.length === 0) return null;
  return (
    <View>
      {!hideHeader && (
        <SectionHeader
          title={lang === 'en' ? 'Featured Categories' : 'Categorías destacadas'}
          subtitle={lang === 'en' ? 'Shop from our most popular categories' : 'Compra de nuestras categorías más populares'}
          seeMore={lang === 'en' ? 'View all' : 'Ver todas'}
          onSeeMore={() => router.push('/(tabs)/categories')}
        />
      )}
      {/* Visual spacing between tiles is this gap PLUS the 8px of slack from
          each card being 84 wide around a 76 tile — 26px all in, which read as
          a rail of loose icons rather than a row. The card stays 84 so a
          longer category name still has room before it truncates. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
        {categories.slice(0, 15).map((cat, i) => {
          const palette = CATEGORY_PALETTES[i % CATEGORY_PALETTES.length];
          const icon = resolveImageUrl(cat.icon_url, 'tile');
          return (
            <Pressable
              key={cat.id}
              onPress={() => router.push(`/category/${cat.id}`)}
              style={({ pressed }) => ({ width: 84, alignItems: 'center', transform: [{ scale: pressed ? 0.97 : 1 }] })}
            >
              <View style={{ width: 76, height: 76, borderRadius: 16, backgroundColor: palette.tint, alignItems: 'center', justifyContent: 'center', marginBottom: 8, overflow: 'hidden', borderWidth: 1, borderColor: colors.border }}>
                {icon ? (
                  <Image source={{ uri: icon }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
                ) : (
                  <Text style={{ fontSize: 30 }}>{palette.emoji}</Text>
                )}
              </View>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.ink, letterSpacing: -0.2, textAlign: 'center', lineHeight: 15 }} numberOfLines={1} ellipsizeMode="tail">
                {lang === 'es' ? cat.name_es : cat.name_en}
              </Text>
            </Pressable>
          );
        })}

        {/* Trailing card, the one thing web's rail had that this did not.
            Built from the same box rather than reusing the tile above: it
            needs a grid glyph on a brand-tinted ground instead of a category
            image, but every dimension matches so it reads as the last card
            in the row rather than an afterthought. */}
        <Pressable
          onPress={() => router.push('/(tabs)/categories')}
          accessibilityRole="button"
          accessibilityLabel={lang === 'en' ? 'All categories' : 'Todas las categorías'}
          style={({ pressed }) => ({ width: 84, alignItems: 'center', transform: [{ scale: pressed ? 0.97 : 1 }] })}
        >
          <View style={{
            width: 76, height: 76, borderRadius: 16, backgroundColor: colors.brand.whisper,
            alignItems: 'center', justifyContent: 'center', marginBottom: 8,
            borderWidth: 1, borderColor: colors.brand.mist,
          }}>
            <LayoutGrid size={26} color={colors.brand.DEFAULT} strokeWidth={1.75} />
          </View>
          <Text
            style={{ fontSize: 12.5, fontWeight: '600', color: colors.brand.DEFAULT, letterSpacing: -0.2, textAlign: 'center', lineHeight: 15 }}
            numberOfLines={1}
          >
            {lang === 'en' ? 'See all' : 'Ver todas'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

/**
 * Placeholder for the rail above.
 *
 * It matters more here than it would lower down the page: the rail is now the
 * first thing under the app bar, and `useCategories` resolves after the first
 * paint. Rendering nothing meant the carousel drew at the top and was then
 * shoved down when the categories arrived — a jump on every cold start.
 *
 * Every dimension is copied from the real tile (84 wide around a 76 box, 8
 * gap) so the swap is invisible rather than merely quick.
 */
function CategoryRailSkeleton() {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEnabled={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={{ width: 84, alignItems: 'center' }}>
          <Skeleton width={76} height={76} borderRadius={16} style={{ marginBottom: 8 }} />
          <Skeleton width={56} height={11} borderRadius={4} />
        </View>
      ))}
    </ScrollView>
  );
}

/* ──────────────────────────────────────────────────────────
   5 · SPONSORED PICKS
   ────────────────────────────────────────────────────────── */
function SponsoredProducts({ products }: { products: Product[] }) {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const sponsored = products.slice(0, 8);
  if (sponsored.length === 0) return null;
  return (
    <View>
      <SectionHeader
        title={lang === 'en' ? 'Sponsored picks' : 'Patrocinados'}
        subtitle={lang === 'en' ? 'Brands we partner with' : 'Marcas con las que colaboramos'}
        seeMore={lang === 'en' ? 'See more' : 'Ver más'}
        onSeeMore={() => router.push('/(tabs)/categories')}
      />
      <FlatList
        data={sponsored}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ width: 170 }}>
            <Text style={{ fontSize: 9.5, fontWeight: '700', color: colors.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>
              {lang === 'en' ? 'Sponsored' : 'Patrocinado'}
            </Text>
            <ProductCard product={item} />
          </View>
        )}
      />
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   6 · ADS BANNER — admin-driven hero + side card
   ────────────────────────────────────────────────────────── */
function sectionText(section: AdsBannerSection, field: 'eyebrow' | 'title' | 'description' | 'cta', lang: 'en' | 'es'): string {
  return (section as unknown as Record<string, string>)[`${field}_${lang}`] ?? '';
}

function AdsBannerHero({ hero, lang }: { hero: AdsBannerSection; lang: 'en' | 'es' }) {
  const router = useRouter();
  const hasImage = !!hero.image_url;
  const isLight = hero.text_theme === 'light';
  const textColor = isLight ? '#FFFFFF' : colors.ink;
  const mutedColor = isLight ? 'rgba(255,255,255,0.85)' : colors.gray;
  const eyebrowBg = isLight ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.85)';
  const eyebrowColor = isLight ? '#FFFFFF' : colors.brand.deepest;
  const ctaBg = isLight ? '#FFFFFF' : colors.brand.DEFAULT;
  const ctaText = isLight ? colors.brand.deepest : '#FFFFFF';
  return (
    <Pressable
      onPress={() => navigateTile(router, hero.link || '/categories?sponsored=1')}
      style={({ pressed }) => ({
        borderRadius: 12, overflow: 'hidden', minHeight: 190, padding: 22,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <BackgroundFill bg={hero.background} />
      {hasImage && (
        <>
          <Image source={{ uri: hero.image_url! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        </>
      )}
      <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: eyebrowBg, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 }}>
        <Megaphone size={11} color={eyebrowColor} strokeWidth={2.5} />
        <Text style={{ fontSize: 10, fontWeight: '700', color: eyebrowColor, letterSpacing: 1.6, textTransform: 'uppercase' }}>
          {sectionText(hero, 'eyebrow', lang)}
        </Text>
      </View>
      <Text style={{ fontSize: 24, fontWeight: '500', color: textColor, marginTop: 14, lineHeight: 28, letterSpacing: -0.6, maxWidth: '85%' }}>
        {sectionText(hero, 'title', lang)}
      </Text>
      {!!sectionText(hero, 'description', lang) && (
        <Text style={{ fontSize: 13, color: mutedColor, marginTop: 6, lineHeight: 18, maxWidth: '85%' }} numberOfLines={3}>
          {sectionText(hero, 'description', lang)}
        </Text>
      )}
      <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, height: 40, paddingHorizontal: 18, borderRadius: 999, backgroundColor: ctaBg }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: ctaText, letterSpacing: -0.2 }}>
          {sectionText(hero, 'cta', lang)}
        </Text>
        <ArrowRight size={14} color={ctaText} strokeWidth={2.5} />
      </View>
    </Pressable>
  );
}

function AdsBannerSide({ side, lang, fallbackProduct }: { side: AdsBannerSection; lang: 'en' | 'es'; fallbackProduct?: Product }) {
  const router = useRouter();
  const hasImage = !!side.image_url;
  const isLight = side.text_theme === 'light';
  const textColor = isLight ? '#FFFFFF' : colors.ink;
  const mutedColor = isLight ? 'rgba(255,255,255,0.75)' : 'rgba(15,23,42,0.7)';
  const accent = colors.danger;
  const ctaColor = colors.brand.DEFAULT;
  const target = side.link || (fallbackProduct ? `/product/${fallbackProduct.id}` : '/(tabs)/categories');
  return (
    <Pressable
      onPress={() => {
        if (target.startsWith('/product/')) {
          router.push(target as never);
        } else {
          navigateTile(router, target);
        }
      }}
      style={({ pressed }) => ({
        borderRadius: 12, overflow: 'hidden', minHeight: 140, padding: 18,
        justifyContent: 'space-between',
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <BackgroundFill bg={side.background} />
      {hasImage && (
        <>
          <Image source={{ uri: side.image_url! }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        </>
      )}
      <View>
        <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.85)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 }}>
          <Tag size={10} color={accent} strokeWidth={2.5} />
          <Text style={{ fontSize: 10, fontWeight: '700', color: accent, letterSpacing: 1.4, textTransform: 'uppercase' }}>
            {sectionText(side, 'eyebrow', lang)}
          </Text>
        </View>
        <Text style={{ fontSize: 18, fontWeight: '600', color: textColor, marginTop: 10, letterSpacing: -0.3 }}>
          {sectionText(side, 'title', lang)}
        </Text>
        <Text style={{ fontSize: 12, color: mutedColor, marginTop: 2 }} numberOfLines={2}>
          {sectionText(side, 'description', lang) ||
            (fallbackProduct ? (lang === 'en' ? fallbackProduct.name_en : fallbackProduct.name_es) : '')}
        </Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: ctaColor }}>
          {sectionText(side, 'cta', lang)}
        </Text>
        <ArrowRight size={11} color={ctaColor} strokeWidth={2.5} />
      </View>
    </Pressable>
  );
}

function AdsBanner({ products }: { products: Product[] }) {
  const { lang } = useLanguageStore();
  const { data } = useAdsBanner();
  const config = data ?? defaultAdsBanner;
  const adProduct = products[2] ?? products[0];
  return (
    <View style={{ paddingHorizontal: 20, gap: 12 }}>
      <AdsBannerHero hero={config.hero} lang={lang} />
      <AdsBannerSide side={config.side} lang={lang} fallbackProduct={adProduct} />
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   6b · TOP BRANDS — admin-managed logo row + 3 promo cards
   ────────────────────────────────────────────────────────── */
function BrandLogoCard({ brand, onPress }: { brand: TopBrand; onPress: () => void }) {
  const logo = brand.image_url ? resolveImageUrl(brand.image_url, 'logo') : null;
  const bg = brand.bg_color || '#FFFFFF';
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: '100%', height: 76, borderRadius: 14,
        borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', backgroundColor: bg,
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      {logo ? (
        // Fills the tile edge to edge — `cover` plus absolute positioning, and
        // no padding on the Pressable, so the image reaches the rounded border
        // instead of floating inside it. This crops: anything taller or wider
        // than the tile loses its edges, so an image with the brand name close
        // to its border will clip. `contain` is the option if that starts
        // happening.
        <Image
          source={{ uri: logo }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
          resizeMode="cover"
        />
      ) : (
        <Text style={{ fontSize: 11, fontWeight: '700', color: colors.muted, letterSpacing: 1.2, textTransform: 'uppercase' }}>
          {brand.name}
        </Text>
      )}
    </Pressable>
  );
}

function BrandPromoCard({ promo, lang, onPress }: { promo: BrandPromo; lang: 'en' | 'es'; onPress: () => void }) {
  const { Icon } = promo;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        borderRadius: 16, padding: 20, minHeight: 140, backgroundColor: promo.bg,
        flexDirection: 'row', alignItems: 'center', gap: 14,
        transform: [{ scale: pressed ? 0.99 : 1 }],
      })}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, letterSpacing: -0.5, lineHeight: 22 }}>
          {lang === 'en' ? promo.title_en : promo.title_es}
        </Text>
        <Text style={{ fontSize: 12.5, color: colors.gray, marginTop: 6, lineHeight: 17 }}>
          {lang === 'en' ? promo.subtitle_en : promo.subtitle_es}
        </Text>
        <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, height: 32, paddingHorizontal: 14, borderRadius: 999, backgroundColor: promo.accent }}>
          <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#fff' }}>
            {lang === 'en' ? 'Shop Now' : 'Comprar'}
          </Text>
          <ArrowRight size={11} color="#fff" strokeWidth={2.5} />
        </View>
      </View>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: promo.haloTint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={34} color={promo.accent} strokeWidth={1.75} />
      </View>
    </Pressable>
  );
}

function TopBrands() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  // Brands moved from a home_sections JSON blob to their own table on
  // 2026-07-13 and web's rail followed. This one did not, so the site and the
  // app could list different brands: the blob only holds what an admin pinned,
  // while /api/brands returns every active row in sort_order. Adapted to the
  // existing TopBrand shape so BrandLogoCard stays untouched.
  const { data: brandsData } = useBrandsList();
  const brands: TopBrand[] = (brandsData ?? [])
    .slice(0, 16)
    .map((b) => ({
      name: b.name,
      image_url: b.logo_url,
      bg_color: b.logo_bg ?? undefined,
      link: b.link ?? `/browse?brand=${encodeURIComponent(b.name)}`,
      is_active: true,
      display_order: b.sort_order,
    }));
  if (brands.length === 0) return null;

  // Two horizontally-sliding rows, which is exactly what web renders at phone
  // width. The old wrap grid was fine for 9 logos but would run several
  // screens tall at 16.
  const rows = [
    brands.filter((_, i) => i % 2 === 0),
    brands.filter((_, i) => i % 2 === 1),
  ].filter((row) => row.length > 0);

  return (
    <View>
      <SectionHeader
        title={lang === 'en' ? 'Top Brands' : 'Marcas top'}
        seeMore={lang === 'en' ? 'See more' : 'Ver más'}
        onSeeMore={() => router.push('/brands')}
      />
      <View style={{ gap: 10 }}>
        {rows.map((row, i) => (
          <FlatList
            key={i}
            data={row}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
            keyExtractor={(item) => item.name}
            renderItem={({ item }) => (
              <View style={{ width: 108 }}>
                <BrandLogoCard
                  brand={item}
                  onPress={() => navigateTile(router, item.link)}
                />
              </View>
            )}
          />
        ))}
      </View>
      {/* HIDDEN on web 2026-07-30 — the three hardcoded promo cards ("Taste
          the Tradition", "Special Offers On Bestsellers", "Quality You Can
          Trust"). They were invented copy, not admin-managed: the discounts
          and claims came from nowhere and nobody could change them without a
          release. BRAND_PROMOS and BrandPromoCard are left defined above, so
          restoring is uncommenting this block — but do it on web too, or the
          two homepages diverge again. The admin-managed logo row above is
          unaffected.
      <View style={{ paddingHorizontal: 20, gap: 10 }}>
        {BRAND_PROMOS.map((promo) => (
          <BrandPromoCard
            key={promo.title_en}
            promo={promo}
            lang={lang}
            onPress={() => router.push(promo.link as never)}
          />
        ))}
      </View>
      */}
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   6c · ETHNIC / SHOP BY ORIGIN — full-card colored tiles
   Web uses landmark SVG art (OriginCardArt); on RN we render
   a clean colored card with a giant slug initial as the
   visual anchor until OriginCardArt is ported. Counts come
   from useOriginCounts() so numbers match web.
   ────────────────────────────────────────────────────────── */
function formatOriginCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K+`;
  }
  return `${n}+`;
}

function OriginCardTile({ card, count, lang, onPress }: { card: OriginCard; count: number; lang: 'en' | 'es'; onPress: () => void }) {
  const image = card.image_url ? resolveImageUrl(card.image_url, 'tile') : null;
  const label = lang === 'en' ? card.label_en : card.label_es;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: 168, aspectRatio: 5 / 6, borderRadius: 20, overflow: 'hidden',
        backgroundColor: card.bg_color, justifyContent: 'flex-end',
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      {image ? (
        <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        // No art ported yet — render a giant slug monogram in the accent
        // colour, anchored top-left, as a clean visual stand-in.
        <View style={{ position: 'absolute', top: 16, left: 16 }}>
          <Text style={{ fontSize: 72, fontWeight: '900', color: card.accent_color, letterSpacing: -3, lineHeight: 72 }}>
            {card.key.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      <LinearGradient
        colors={[card.bg_color, withAlpha(card.bg_color, 0.9), withAlpha(card.bg_color, 0)] as [string, string, string]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 1 }} end={{ x: 0, y: 0 }}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', padding: 14, gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, letterSpacing: -0.3 }} numberOfLines={1}>
            {label}
          </Text>
          <Text style={{ fontSize: 11.5, color: 'rgba(15,23,42,0.55)', marginTop: 2 }}>
            {formatOriginCount(count)} {lang === 'en' ? 'products' : 'productos'}
          </Text>
        </View>
        <ArrowRight size={18} color="rgba(15,23,42,0.8)" strokeWidth={2.5} />
      </View>
    </Pressable>
  );
}

function EthnicSection() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const { data: originConfig } = useShopByOrigin();
  const { data: countsData } = useOriginCounts();
  const counts = countsData ?? [];

  // Admin's saved cards are the source of truth — no auto-discovery from the
  // product catalogue. We additionally drop any active card whose origin has
  // zero matching products so taps from the home row never land on an empty
  // results page.
  const countByOrigin = useMemo(
    () => new Map<string, number>(counts.map((c) => [c.key.toLowerCase(), c.product_count])),
    [counts],
  );
  const cards = useMemo<OriginCard[]>(
    () =>
      (originConfig?.cards ?? [])
        .filter((c) => c.is_active)
        .map((c) => ({ ...c, key: c.key.toLowerCase() }))
        .filter((c) => (countByOrigin.get(c.key) ?? 0) > 0)
        .sort((a, b) => a.display_order - b.display_order),
    [originConfig, countByOrigin],
  );

  if (cards.length === 0) return null;

  return (
    <View>
      <SectionHeader
        title={lang === 'en' ? 'Shop by origin' : 'Compra por origen'}
        seeMore={lang === 'en' ? 'See more' : 'Ver más'}
        onSeeMore={() => router.push('/origins')}
      />
      <FlatList
        data={cards}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <OriginCardTile
            card={item}
            count={countByOrigin.get(item.key.toLowerCase()) ?? 0}
            lang={lang}
            onPress={() => navigateTile(router, item.link || `/categories?origin=${item.key}`)}
          />
        )}
      />
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   6d · TOP SHOPS — partner shop cards
   ────────────────────────────────────────────────────────── */
function formatShopCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K+`;
  }
  return `${n}+`;
}

/* Static fallbacks for fields the TopShop schema doesn't carry yet. Wired
 * here so the card design matches the spec — when the admin schema is
 * extended (banner_url / tagline / tags / delivery range), swap these
 * for `shop.*` lookups. */
const SHOP_CARD_TAGS_EN = ['Grocery', 'Fresh Food', 'Daily Essentials', 'Spices', 'Snacks'];
const SHOP_CARD_TAGS_ES = ['Comestibles', 'Comida fresca', 'Básicos', 'Especias', 'Snacks'];

function TopShopCard({ shop, lang, onPress }: { shop: TopShop; lang: 'en' | 'es'; onPress: () => void }) {
  const logo = shop.logo_url ? resolveImageUrl(shop.logo_url, 'logo') : null;
  const cover = shop.cover_url ? resolveImageUrl(shop.cover_url, 'tile') : null;

  const delivery = deliveryLabel(shop.fast_delivery, lang);
  const reviewsLabel = lang === 'en' ? 'reviews' : 'reseñas';

  const allTags = lang === 'en' ? SHOP_CARD_TAGS_EN : SHOP_CARD_TAGS_ES;
  const visibleTags = allTags.slice(0, 3);

  return (
    <View
      style={{
        width: 290,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: 'rgba(226,232,240,0.7)',
        backgroundColor: '#FFFFFF',
        overflow: 'hidden',
      }}
    >
      {/* ── Banner ───────────────────────────────────────────── */}
      <View style={{ height: 130, position: 'relative' }}>
        <LinearGradient
          colors={['#1F4A29', '#3A7A3B', '#5FA133']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {cover && (
          <Image
            source={{ uri: cover }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        )}
        {/* Subtle vignette so banner copy stays legible */}
        <LinearGradient
          colors={['rgba(0,0,0,0.35)', 'rgba(0,0,0,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 0.7 }}
          style={StyleSheet.absoluteFill}
        />
      </View>

      {/* ── Floating circular logo ──────────────────────────── */}
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: shop.logo_bg || '#FFFFFF',
          borderWidth: 3,
          borderColor: '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'absolute',
          top: 130 - 32,
          left: 16,
          shadowColor: '#0F172A',
          shadowOpacity: 0.12,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 2 },
          elevation: 3,
        }}
      >
        {logo ? (
          <Image source={{ uri: logo }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <Text style={{ fontSize: 16, fontWeight: '800', color: colors.brand.DEFAULT, letterSpacing: 0.5 }}>
            {shop.name
              .split(' ')
              .map((w) => w[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()}
          </Text>
        )}
      </View>

      {/* ── Body ────────────────────────────────────────────── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 40, paddingBottom: 14 }}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink, letterSpacing: -0.4 }} numberOfLines={1}>
          {shop.name}
        </Text>

        {/* Rating + delivery pill */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 }}>
            <Star size={14} color={colors.amber.deep} fill={colors.amber.deep} strokeWidth={2} />
            <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>{shop.rating.toFixed(1)}</Text>
            <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>
              ({formatShopCount(shop.rating_count)} {reviewsLabel})
            </Text>
          </View>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              backgroundColor: colors.amber.mist,
              borderRadius: 999,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Clock size={12} color={colors.amber.deep} strokeWidth={2.25} />
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.amber.deep, letterSpacing: -0.2 }}>
              {delivery}
            </Text>
          </View>
        </View>

        {/* Tag chips */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {visibleTags.map((tag) => (
            <View
              key={tag}
              style={{
                borderRadius: 999,
                borderWidth: 1,
                borderColor: colors.border,
                paddingHorizontal: 10,
                paddingVertical: 4,
                backgroundColor: colors.surface.linen,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: '600', color: colors.gray, letterSpacing: -0.1 }}>
                {tag}
              </Text>
            </View>
          ))}
        </View>

        {/* Action button */}
        <Pressable
          onPress={onPress}
          style={({ pressed }) => ({
            marginTop: 14,
            height: 42,
            borderRadius: 12,
            backgroundColor: colors.brand.DEFAULT,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.2 }}>
            {lang === 'en' ? 'View Shop' : 'Ver tienda'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function TopShops() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const { data } = useTopShops();
  const config = data ?? defaultTopShops;
  const shops = config.shops.filter((s) => s.is_active).sort((a, b) => a.display_order - b.display_order);
  if (shops.length === 0) return null;
  return (
    <View>
      <SectionHeader
        title={lang === 'en' ? 'Top Shops' : 'Tiendas destacadas'}
        seeMore={lang === 'en' ? 'See more' : 'Ver más'}
        onSeeMore={() => router.push('/stores')}
      />
      <FlatList
        data={shops}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TopShopCard
            shop={item}
            lang={lang}
            onPress={() => navigateTile(router, item.link)}
          />
        )}
      />
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   7 · PRICE DROPS — horizontal carousel of discounted items
   ────────────────────────────────────────────────────────── */
function PriceDrops({ products }: { products: Product[] }) {
  const router = useRouter();
  const { lang } = useLanguageStore();
  let deals = products.filter((p) => p.variants?.some((v) => v.compare_at_price != null));
  if (deals.length === 0) deals = products.slice(0, 10);
  deals = deals.slice(0, 10);
  if (deals.length === 0) return null;
  return (
    <View>
      <SectionHeader
        title={lang === 'en' ? 'Price drops' : 'Bajadas de precio'}
        subtitle={lang === 'en' ? 'Lower than last week' : 'Más barato que la semana pasada'}
        seeMore={lang === 'en' ? 'See all' : 'Ver todo'}
        onSeeMore={() => router.push('/(tabs)/categories')}
      />
      <FlatList
        data={deals}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={{ width: 170 }}>
            <ProductCard product={item} />
          </View>
        )}
      />
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   8 · SHOP BY CATEGORY — per-category product rows
   ────────────────────────────────────────────────────────── */
function CategoryRow({ category }: { category: Category }) {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const { data, isLoading } = useProducts({ categoryId: category.id, limit: 6 });
  const products = data?.items ?? [];
  if (!isLoading && products.length === 0) return null;
  return (
    <View style={{ marginBottom: 24 }}>
      <SectionHeader
        title={lang === 'en' ? category.name_en : category.name_es}
        seeMore={lang === 'en' ? 'See all' : 'Ver todo'}
        onSeeMore={() => router.push(`/category/${category.id}`)}
      />
      {isLoading ? (
        <View style={{ paddingVertical: 30, alignItems: 'center' }}>
          <ActivityIndicator color={colors.brand.DEFAULT} />
        </View>
      ) : (
        <FlatList
          data={products.slice(0, 6)}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <View style={{ width: 160 }}>
              <ProductCard product={item} />
            </View>
          )}
        />
      )}
    </View>
  );
}

function ShopByCategory({ categories }: { categories: Category[] }) {
  const withProducts = categories.filter((c) => (c._count?.products ?? 0) > 0);
  const featured = (withProducts.length > 0 ? withProducts : categories).slice(0, 3);
  if (featured.length === 0) return null;
  return (
    <View>
      {featured.map((c) => <CategoryRow key={c.id} category={c} />)}
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   9 · FEEDBACK — rated card + 2 testimonials + compact form
   ────────────────────────────────────────────────────────── */
function StarRow({ rating, size = 12 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 1 }}>
      {Array.from({ length: 5 }).map((_, j) => {
        const filled = j < rating;
        return (
          <Star key={j} size={size} strokeWidth={1.75} color={filled ? colors.amber.deep : colors.border} fill={filled ? colors.amber.deep : 'transparent'} />
        );
      })}
    </View>
  );
}

function TestimonialCard({ t }: { t: typeof TESTIMONIALS[number] }) {
  const { lang } = useLanguageStore();
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', padding: 16, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: t.accent, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>{t.initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink }}>
            {lang === 'en' ? t.name_en : t.name_es}
          </Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{t.city}</Text>
        </View>
        <StarRow rating={t.rating} />
      </View>
      <Text style={{ fontSize: 13, color: 'rgba(15,23,42,0.85)', lineHeight: 18 }}>
        "{lang === 'en' ? t.quote_en : t.quote_es}"
      </Text>
    </View>
  );
}

function Feedback() {
  const { lang } = useLanguageStore();
  const toast = useToast();
  const submit = useSubmitSupportTicket();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState(0);
  const submitting = submit.isPending;

  const onSubmit = async () => {
    if (!name.trim() || !email.trim() || !message.trim() || rating === 0) {
      toast.error(
        lang === 'en' ? 'Please complete every field' : 'Completa todos los campos',
        lang === 'en' ? 'Name, email, rating and message are required.' : 'Nombre, correo, valoración y mensaje son obligatorios.',
      );
      return;
    }
    try {
      await submit.mutateAsync({
        name:    name.trim(),
        email:   email.trim(),
        phone:   null,
        subject: `Homepage feedback — ${rating}★`,
        body:    `Rating: ${rating}/5\n\n${message.trim()}`,
        source:  'home_feedback',
        language: lang,
      });
      toast.success(
        lang === 'en' ? 'Thanks for your feedback!' : '¡Gracias por tu opinión!',
        lang === 'en' ? 'We have received your message.' : 'Hemos recibido tu mensaje.',
      );
      setName(''); setEmail(''); setMessage(''); setRating(0);
    } catch (err) {
      toast.error(
        lang === 'en' ? "We couldn't send your feedback" : 'No pudimos enviar tu opinión',
        err instanceof Error ? err.message : (lang === 'en' ? 'Please try again in a moment.' : 'Inténtalo de nuevo en un momento.'),
      );
    }
  };

  const inputStyle = { height: 44, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff', fontSize: 13, color: colors.ink };

  return (
    <View>
      <SectionHeader
        title={lang === 'en' ? 'Share your feedback' : 'Comparte tu opinión'}
        subtitle={lang === 'en' ? 'Tell us what we got right' : 'Cuéntanos qué hicimos bien'}
      />
      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        <View style={{ backgroundColor: colors.ink, borderRadius: 8, padding: 18 }}>
          <Text style={{ fontSize: 10.5, fontWeight: '700', color: colors.amber.DEFAULT, letterSpacing: 1.4, textTransform: 'uppercase' }}>
            {lang === 'en' ? 'Rated 4.8 / 5' : 'Valorado 4.8 / 5'}
          </Text>
          <Text style={{ fontSize: 22, fontWeight: '500', color: '#fff', marginTop: 8, lineHeight: 26, letterSpacing: -0.5 }}>
            {lang === 'en' ? 'From 2,400+ verified shoppers across Spain.' : 'De más de 2.400 compradores verificados en España.'}
          </Text>
          <View style={{ flexDirection: 'row', gap: 2, marginTop: 10 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} size={14} strokeWidth={1.75} color={colors.amber.DEFAULT} fill={colors.amber.DEFAULT} />
            ))}
          </View>
        </View>

        {TESTIMONIALS.slice(0, 2).map((t, i) => <TestimonialCard key={i} t={t} />)}

        <View style={{ backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', padding: 18, gap: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, letterSpacing: -0.3 }}>
            {lang === 'en' ? 'Have your say' : 'Danos tu opinión'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Pressable key={i} onPress={() => setRating(i + 1)} hitSlop={4}>
                <Star size={26} strokeWidth={1.5} color={i < rating ? colors.amber.deep : colors.border} fill={i < rating ? colors.amber.deep : 'transparent'} />
              </Pressable>
            ))}
          </View>
          <TextInput value={name} onChangeText={setName} placeholder={lang === 'en' ? 'Your name' : 'Tu nombre'} placeholderTextColor={colors.muted} style={inputStyle} />
          <TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor={colors.muted} keyboardType="email-address" autoCapitalize="none" style={inputStyle} />
          <TextInput value={message} onChangeText={setMessage} placeholder={lang === 'en' ? 'Your message' : 'Tu mensaje'} placeholderTextColor={colors.muted} multiline numberOfLines={3} style={{ ...inputStyle, height: 92, paddingTop: 12, textAlignVertical: 'top' }} />
          <Pressable
            onPress={onSubmit}
            disabled={submitting}
            style={({ pressed }) => ({
              alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
              height: 44, paddingHorizontal: 22, borderRadius: 999,
              backgroundColor: pressed ? colors.brand.mid : colors.brand.DEFAULT,
              opacity: submitting ? 0.6 : 1,
            })}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff', letterSpacing: -0.2 }}>
              {submitting ? (lang === 'en' ? 'Sending…' : 'Enviando…') : (lang === 'en' ? 'Send feedback' : 'Enviar opinión')}
            </Text>
            {!submitting && <ArrowRight size={14} color="#fff" strokeWidth={2.5} />}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   10 · VALUE RIBBON
   ────────────────────────────────────────────────────────── */
/** Icon names Admin can choose from, mapped to what this screen can draw. */
const RIBBON_ICON: Record<string, LucideIcon> = {
  truck: Truck, wallet: Wallet, shield: ShieldCheck,
  sparkles: Sparkles, clock: Clock, leaf: Sparkles,
};

function ValueRibbon() {
  const { lang } = useLanguageStore();
  const { data: content } = useAppContent();
  // Three of these four were invented. "Delivery in 60 min · Madrid Centro"
  // is a promise nothing in the system makes or measures, and the terms we
  // publish say the opposite: estimates, not guarantees, across our service
  // areas. "Rated 4.8/5 · Thousands of customers" had no reviews behind it.
  // The free-delivery tile went on 2026-09-25 with the feature itself.
  // Admin -> App content supplies every tile now.
  const remote = content?.ribbon?.items ?? [];
  const items = [
    ...remote.map((it) => ({
      icon: RIBBON_ICON[it.icon] ?? Sparkles,
      label_en: it.label_en, label_es: it.label_es,
      sub_en: it.sub_en, sub_es: it.sub_es,
    })),
  ];
  // Kept as the offline fallback: a first launch with no network should still
  // show the strip rather than a gap where it belongs.
  const bundled = [
    { icon: Wallet, label_en: 'Pay on delivery', label_es: 'Paga al recibir', sub_en: 'Cash or card', sub_es: 'Efectivo o tarjeta' },
    { icon: ShieldCheck, label_en: 'Authentic product', label_es: 'Producto auténtico', sub_en: 'Direct import', sub_es: 'Importación directa' },
    { icon: Sparkles, label_en: 'South Asian groceries', label_es: 'Sabores del sur de Asia', sub_en: 'The brands you know', sub_es: 'Las marcas que conoces' },
  ];
  const tiles = remote.length ? items : bundled;
  return (
    <View style={{ paddingHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {tiles.map((it, i) => {
        const Icon = it.icon;
        return (
          <View key={i} style={{ width: (SCREEN_WIDTH - 40 - 10) / 2, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, backgroundColor: '#fff', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)' }}>
            <View style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center' }}>
              <Icon size={18} color={colors.brand.DEFAULT} strokeWidth={1.75} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.ink }} numberOfLines={1}>
                {lang === 'en' ? it.label_en : it.label_es}
              </Text>
              <Text style={{ fontSize: 10, color: colors.gray, marginTop: 1 }} numberOfLines={1}>
                {lang === 'en' ? it.sub_en : it.sub_es}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   All Products — mobile-only infinite list at the page end
   ────────────────────────────────────────────────────────── */
function AllProducts({ products, isLoading, isFetchingNext, hasNext }: {
  products: Product[]; isLoading: boolean; isFetchingNext: boolean; hasNext: boolean;
}) {
  const { lang } = useLanguageStore();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 14 }}>
        <View>
          <Text style={{ fontSize: 10, letterSpacing: 1.5, color: colors.muted, fontWeight: '700', textTransform: 'uppercase' }}>
            {lang === 'en' ? 'Browse · Everything' : 'Explora · Todo'}
          </Text>
          <Text style={{ fontSize: 22, fontWeight: '600', color: colors.ink, letterSpacing: -0.6, marginTop: 2 }}>
            {lang === 'en' ? 'All products' : 'Todos los productos'}
          </Text>
        </View>
      </View>
      {isLoading && products.length === 0 ? (
        <View style={{ paddingVertical: 40, alignItems: 'center' }}>
          <ActivityIndicator color={colors.brand.DEFAULT} />
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14 }}>
          {products.map((item) => (
            <View key={item.id} style={{ width: '50%', padding: 6 }}>
              <ProductCard product={item} />
            </View>
          ))}
        </View>
      )}
      {isFetchingNext && (
        <View style={{ paddingVertical: 20, alignItems: 'center' }}>
          <ActivityIndicator color={colors.brand.DEFAULT} />
        </View>
      )}
      {!hasNext && products.length > 0 && (
        <Text style={{ textAlign: 'center', fontSize: 11.5, color: colors.muted, letterSpacing: 0.4, marginTop: 16 }}>
          {lang === 'en' ? "You've reached the end" : 'Has llegado al final'}
        </Text>
      )}
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   HomeSearchBar — full-width search pill. Taps navigate to
   the dedicated search tab where the real input lives.
   ────────────────────────────────────────────────────────── */
function HomeSearchBar() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  return (
    <Pressable
      onPress={() => router.push('/(tabs)/search')}
      style={({ pressed }) => ({
        marginHorizontal: 16,
        marginBottom: 14,
        height: 56,
        borderRadius: 999,
        backgroundColor: colors.surface.white,
        borderWidth: 1,
        borderColor: 'rgba(226,232,240,0.7)',
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 18,
        paddingRight: 8,
        gap: 10,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Search size={18} color={colors.muted} strokeWidth={2} />
      <Text
        numberOfLines={1}
        style={{ flex: 1, fontSize: 14, color: colors.muted, letterSpacing: -0.2 }}
      >
        {lang === 'en' ? 'Search for products, brands and more' : 'Busca productos, marcas y más'}
      </Text>
      <View
        style={{
          width: 42, height: 42, borderRadius: 21,
          backgroundColor: colors.brand.DEFAULT,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Search size={18} color="#fff" strokeWidth={2.25} />
      </View>
    </Pressable>
  );
}

/* ──────────────────────────────────────────────────────────
   TrustStrip — 4-up promotional tags below the hero carousel.
   Different content from the existing ValueRibbon at the page
   bottom: focuses on shopping-trust signals (Original / Fast
   Delivery / Easy Returns / 24/7 Support).
   ────────────────────────────────────────────────────────── */
function TrustStrip() {
  const { lang } = useLanguageStore();
  const items = [
    { icon: ShieldCheck, label_en: '100% Original',  label_es: '100% Original',  sub_en: 'Genuine Products',     sub_es: 'Productos Originales' },
    { icon: Truck,       label_en: 'Fast Delivery',  label_es: 'Envío rápido',   sub_en: 'At your doorstep',     sub_es: 'En tu puerta' },
    { icon: RotateCcw,   label_en: 'Easy Returns',   label_es: 'Devoluciones',   sub_en: 'Hassle-free returns',  sub_es: 'Sin complicaciones' },
    { icon: Headphones,  label_en: '24/7 Support',   label_es: 'Soporte 24/7',   sub_en: "We're here to help",   sub_es: 'Estamos aquí' },
  ];
  return (
    <View style={{ paddingHorizontal: 16, flexDirection: 'row', gap: 8 }}>
      {items.map((it, i) => {
        const Icon = it.icon;
        return (
          <View
            key={i}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 12,
              paddingHorizontal: 6,
              borderRadius: 12,
              backgroundColor: colors.surface.white,
              borderWidth: 1,
              borderColor: 'rgba(226,232,240,0.7)',
            }}
          >
            <View
              style={{
                width: 32, height: 32, borderRadius: 8,
                backgroundColor: colors.brand.mist,
                alignItems: 'center', justifyContent: 'center',
                marginBottom: 6,
              }}
            >
              <Icon size={16} color={colors.brand.DEFAULT} strokeWidth={1.75} />
            </View>
            <Text
              numberOfLines={1}
              style={{ fontSize: 10.5, fontWeight: '700', color: colors.ink, textAlign: 'center', letterSpacing: -0.1 }}
            >
              {lang === 'en' ? it.label_en : it.label_es}
            </Text>
            <Text
              numberOfLines={1}
              style={{ fontSize: 9, color: colors.muted, marginTop: 1, textAlign: 'center' }}
            >
              {lang === 'en' ? it.sub_en : it.sub_es}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/* ──────────────────────────────────────────────────────────
   HOME SCREEN — section order mirrors web HomePage exactly,
   plus the mobile-only All Products infinite list at the end.
   ────────────────────────────────────────────────────────── */
export default function HomeScreen() {
  const { data: banners = [] } = useBanners();
  const { data: categories = [], isLoading: categoriesLoading } = useCategories();
  const { data: sponsoredData } = useSponsoredProducts(12);
  // Curated, not inferred — same as web. The rail used to read
  // useFeaturedProducts, so "New products" showed whatever was flagged
  // featured rather than what an admin actually marked as a new arrival.
  const { data: newestData, isLoading: newestLoading } = useProducts({ newArrival: '1', limit: 12 });
  const { data: popularData } = useProducts({ limit: 12, sort: 'popular' });
  const sponsored = sponsoredData ?? [];
  const newest = newestData?.items ?? [];
  const popular = popularData?.items ?? [];

  const {
    data: allProductsPages, fetchNextPage, hasNextPage, isFetchingNextPage,
    isLoading: allProductsLoading,
  } = useInfiniteProducts({ limit: 12, sort: 'name_asc' });
  // Offset pagination over `name_asc` can return the same product on two
  // adjacent pages when rows shift between fetches. Dedup by id so React never
  // sees duplicate keys in the infinite list.
  const allProducts = useMemo(
    () => dedupeById(allProductsPages?.pages.flatMap((page) => page.items) ?? []),
    [allProductsPages],
  );

  // Pull-to-refresh — refetch every active query mounted on this screen
  // (banners, categories, featured/sponsored/infinite products, promo grid,
  // ads, brands, shops, origin counts, etc.).
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({ type: 'active' });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const handleScroll = (e: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    if (distanceFromBottom < 600 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={[]}>
      <AppHeader />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
        onScroll={handleScroll}
        scrollEventThrottle={200}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand.DEFAULT}
            colors={[colors.brand.DEFAULT]}
          />
        }
      >
        {/* The app bar is pinned above this scroller and carries the location
            row itself, so the cream pill that used to sit here is gone.

            The category rail comes FIRST, before the carousel. That is a
            deliberate divergence from web, where the rail follows the hero —
            asked for on 2026-09-26 so the way into the catalogue sits
            directly under the location row and is reachable without scrolling
            past a banner. Do not "restore parity" by swapping these back
            without checking; the order here is the intended one. */}
        <View style={{ marginTop: 10 }}>
          {categoriesLoading ? (
            <CategoryRailSkeleton />
          ) : (
            <FeaturedCategories categories={categories} hideHeader />
          )}
        </View>

        <View style={{ marginTop: 16 }}>
          <HeroCarousel banners={banners} />
        </View>

        {/* Section order below is web's HomePage, one for one. Everything web
            hides is hidden here too — the app was showing seven rails the site
            had already retired, so the two homepages advertised different
            things. Restore any of them by uncommenting BOTH here and on web,
            or they diverge again. */}

        <View style={{ marginTop: 20 }}>
          {newestLoading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator color={colors.brand.DEFAULT} />
            </View>
          ) : (
            <NewProducts products={newest} />
          )}
        </View>

        <View style={{ marginTop: 20 }}><PromoGrid /></View>
        <View style={{ marginTop: 20 }}><SponsoredProducts products={sponsored} /></View>

        {/* HIDDEN on web 2026-07-30 — ads banner (wide hero ad + side ad).
        <View style={{ marginTop: 24 }}><AdsBanner products={featured} /></View>
        */}

        <View style={{ marginTop: 20 }}><TopBrands /></View>
        <View style={{ marginTop: 20 }}><PopularProducts products={popular} /></View>

        {/* HIDDEN on web 2026-07-30 — "Shop by origin". The same content has
            its own screen at /origins, reachable from the category bar.
        <View style={{ marginTop: 20 }}><EthnicSection /></View>
        */}

        {/* HIDDEN on web 2026-07-30 — Top Shops. Stores have their own page
            there; on mobile storefronts are out of scope until multi-vendor.
        <View style={{ marginTop: 20 }}><TopShops /></View>
        */}

        {/* HIDDEN on web 2026-07-31 — price drops and the second
            shop-by-category block.
        <View style={{ marginTop: 20 }}><PriceDrops products={featured} /></View>
        <View style={{ marginTop: 20 }}><ShopByCategory categories={categories} /></View>
        */}

        {/* HIDDEN on web 2026-07-31 — feedback form. Mobile keeps the support
            route: the Contact screen added in P4 is the deliberate way in.
        <View style={{ marginTop: 12 }}><Feedback /></View>
        */}

        {/* HIDDEN on web 2026-07-30 — value ribbon.
        <View style={{ marginTop: 24 }}><ValueRibbon /></View>
        */}
        <View style={{ marginTop: 20 }}>
          <AllProducts
            products={allProducts}
            isLoading={allProductsLoading}
            isFetchingNext={isFetchingNextPage}
            hasNext={!!hasNextPage}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
