/**
 * Dedicated brand-discovery page. Reached from the home row's "See more"
 * CTA on Top Brands. Same visual language as the home chip row, but the
 * tiles are larger, get product counts, and surface every active brand
 * the admin has saved. Tapping a tile routes to /browse with the brand
 * filter pre-applied.
 *
 * Discovery controls mirror web's BrandsPage feature-for-feature: search,
 * A–Z, three sorts, a stocked-only toggle, recently-viewed and a clear-all.
 * Two deliberate divergences, both because this is a phone:
 *   · filter state is component state, not the URL — there is no address bar
 *     to share, and Back leaves the screen rather than stepping filters;
 *   · the A–Z rail filters instead of scroll-jumping — a sticky spine has
 *     nowhere to live beside a 2-up grid on a 390pt screen.
 */
import {
  View, Text, Pressable, ScrollView, Image, StyleSheet, ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, Sparkles, Tag, Search, X, SearchX, Clock, Check, RefreshCw,
} from 'lucide-react-native';
import { useMemo, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  useBrandsList, useBrandCounts, resolveImageUrl,
} from '@grocery-app/shared';
import type { TopBrand } from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import {
  ALPHABET, RECENT_BRANDS_KEY,
  filterAndSortBrands, groupByInitial, initialOf, isBrandFilterActive,
  monogram, nextRecentBrands, parseRecentBrands,
  type BrandSort,
} from '../src/lib/brandFilter';

function formatBrandCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K+`;
  }
  return `${n}+`;
}

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

/**
 * Pair tiles into rows for the manual 2-col grid (keeps left-alignment on an
 * odd last tile, which numColumns would centre).
 */
function pairRows(list: TopBrand[]): TopBrand[][] {
  const out: TopBrand[][] = [];
  for (let i = 0; i < list.length; i += 2) out.push(list.slice(i, i + 2));
  return out;
}

function BrandTile({
  brand, count, onPress,
}: { brand: TopBrand; count: number; onPress: () => void }) {
  const logo = brand.image_url ? resolveImageUrl(brand.image_url, 'logo') : null;
  const bg = brand.bg_color || '#FFFFFF';
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={brand.name}
      style={({ pressed }) => ({
        flex: 1,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <View style={{
        position: 'relative',
        height: 124, borderRadius: 18,
        borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
        backgroundColor: bg,
        alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}>
        {logo ? (
          // Fills the tile edge to edge, same as the home rail: `cover` plus
          // absolute positioning and no padding on the container, so the image
          // reaches the rounded border instead of floating inside it. This
          // crops — an image with the brand name close to its own border will
          // lose letters, and `contain` is the way back.
          <Image
            source={{ uri: logo }}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }}
            resizeMode="cover"
          />
        ) : (
          <Text style={{
            fontSize: 13, fontWeight: '700', color: withAlpha(colors.ink, 0.35),
            letterSpacing: 1.4, textTransform: 'uppercase', textAlign: 'center',
            paddingHorizontal: 16,
          }}>
            {brand.name}
          </Text>
        )}

        {/* Floating product count pill — only when there's stock. Mirrors
            the web tile so the card stays informational without needing a
            separate caption row. Now that the image runs under it rather than
            sitting in a padded well, the pill is opaque enough to stay legible
            over arbitrary artwork. */}
        {count > 0 && (
          <View style={{
            position: 'absolute', top: 8, right: 8,
            flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 8, paddingVertical: 3,
            borderRadius: 999,
            backgroundColor: 'rgba(255,255,255,0.94)',
            borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)',
          }}>
            <Text style={{
              fontSize: 10.5, fontWeight: '800', color: colors.ink,
            }}>
              {formatBrandCount(count)}
            </Text>
            <Text style={{ fontSize: 9.5, color: colors.gray }}>
              productos
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

/** Pill shared by the sort options and the stocked-only toggle. */
function FilterChip({
  label, active, onPress, icon,
}: { label: string; active: boolean; onPress: () => void; icon?: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 5,
        height: 34, paddingHorizontal: 12, borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? colors.brand.DEFAULT : colors.border,
        backgroundColor: active ? colors.brand.mist : colors.surface.white,
      }}
    >
      {icon}
      <Text style={{
        fontSize: 12.5, fontWeight: '700',
        color: active ? colors.brand.deepest : colors.gray,
      }}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function BrandsScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const t = (en: string, es: string) => (lang === 'en' ? en : es);
  // Reads the brands table rather than the curated home_sections blob. Web
  // moved over already, so the two apps were showing different brand lists —
  // the blob only ever held the handful an admin pinned to the home rail,
  // while this screen claims to show every brand.
  const { data: brandsData, isLoading, isError, refetch } = useBrandsList();
  const { data: countsData } = useBrandCounts();

  const counts = countsData ?? [];

  // Keyed case-insensitively: admin's display capitalisation does not have to
  // match Product.brand for a count to surface.
  const countByBrand = useMemo(
    () => new Map<string, number>(counts.map((c) => [c.name.toLowerCase(), c.product_count])),
    [counts],
  );

  // Adapt the Brand row to the tile's existing TopBrand contract, exactly as
  // web's BrandsPage does, so BrandTile below stays untouched.
  //
  // There is deliberately no is_active filter. GET /api/brands already selects
  // `where is_active: true` and does NOT return the column, so filtering on it
  // here matched nothing and emptied the entire screen. The shared Brand type
  // marks the field optional because admin's richer payload reuses it, which
  // is why this type-checked all the way through.
  const brands = useMemo<TopBrand[]>(
    () =>
      (brandsData ?? [])
        .map((b) => ({
          name: b.name,
          image_url: b.logo_url,
          bg_color: b.logo_bg ?? undefined,
          link: b.link ?? `/browse?brand=${encodeURIComponent(b.name)}`,
          is_active: true,
          display_order: b.sort_order,
        }))
        .sort((a, b) => a.display_order - b.display_order),
    [brandsData],
  );

  const totalProducts = brands.reduce(
    (sum, b) => sum + (countByBrand.get(b.name.toLowerCase()) ?? 0),
    0,
  );

  // ── Filter state ──────────────────────────────────────────
  const [q, setQ] = useState('');
  const [letter, setLetter] = useState('');
  const [sort, setSort] = useState<BrandSort>('featured');
  const [hideEmpty, setHideEmpty] = useState(false);

  const countOf = useCallback(
    (b: TopBrand) => countByBrand.get(b.name.toLowerCase()) ?? 0,
    [countByBrand],
  );

  const isFiltered = isBrandFilterActive({ q, letter, sort, hideEmpty });
  const clearAll = () => { setQ(''); setLetter(''); setSort('featured'); setHideEmpty(false); };

  const visible = useMemo(
    () => filterAndSortBrands(brands, { q, letter, sort, hideEmpty, countOf }),
    [brands, q, letter, sort, hideEmpty, countOf],
  );

  // Which letters the rail offers. Computed WITHOUT the letter filter applied,
  // unlike web — there the rail is a scroll-jump so deriving it from the
  // visible list is harmless, but here it filters, and deriving it from
  // `visible` would grey out the other 26 the moment you picked one.
  const enabledInitials = useMemo(() => {
    const list = filterAndSortBrands(brands, { q, hideEmpty, countOf });
    return new Set(list.map((b) => initialOf(b.name)));
  }, [brands, q, hideEmpty, countOf]);

  // ── Recently viewed ───────────────────────────────────────
  // Grocery shopping is repeat behaviour: the brand wanted today is usually
  // one opened last week.
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(RECENT_BRANDS_KEY)
      .then((raw) => { if (alive) setRecent(parseRecentBrands(raw)); })
      .catch(() => { /* first run, or storage unavailable — rail stays hidden */ });
    return () => { alive = false; };
  }, []);

  const openBrand = useCallback((b: TopBrand) => {
    const next = nextRecentBrands(recent, b.name);
    setRecent(next);
    AsyncStorage.setItem(RECENT_BRANDS_KEY, JSON.stringify(next)).catch(() => {});
    router.push(`/browse?brand=${encodeURIComponent(b.name)}` as never);
  }, [recent, router]);

  const recentBrands = recent
    .map((n) => brands.find((b) => b.name === n))
    .filter((b): b is TopBrand => !!b);

  // Letter headings are tied to the A–Z sort: headings over a list ordered by
  // product count would be a lie about the order.
  const grouped = sort === 'name_asc';
  const groups = useMemo(
    () => (grouped ? groupByInitial(visible) : []),
    [visible, grouped],
  );

  const sortOptions: { value: BrandSort; label: string }[] = [
    { value: 'featured',   label: t('Featured', 'Destacadas') },
    { value: 'name_asc',   label: 'A–Z' },
    { value: 'count_desc', label: t('Most products', 'Más productos') },
  ];

  const renderRows = (list: TopBrand[]) =>
    pairRows(list).map((row, i) => (
      <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
        {row.map((brand) => (
          <BrandTile
            key={brand.name}
            brand={brand}
            count={countOf(brand)}
            onPress={() => openBrand(brand)}
          />
        ))}
        {row.length === 1 && <View style={{ flex: 1 }} />}
      </View>
    ));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      {/* ── Header bar ───────────────────────────────────────── */}
      <View style={{
        height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
        backgroundColor: colors.surface.white, borderBottomWidth: 1, borderBottomColor: colors.border,
        gap: 12,
      }}>
        <Pressable
          onPress={() => router.back()}
          style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: colors.surface.cream,
            justifyContent: 'center', alignItems: 'center',
          }}
        >
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{
            fontSize: 10, letterSpacing: 1.5, color: colors.muted,
            fontWeight: '700', textTransform: 'uppercase',
          }}>
            {t('Explore', 'Explora')}
          </Text>
          <Text style={{
            fontSize: 16, fontWeight: '700', color: colors.ink, letterSpacing: -0.3,
          }} numberOfLines={1}>
            {t('All brands', 'Todas las marcas')}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Hero ─────────────────────────────────────────────── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <View style={{
            position: 'relative', overflow: 'hidden', borderRadius: 24,
            borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)',
            backgroundColor: '#fff', padding: 20,
          }}>
            <LinearGradient
              colors={[colors.brand.whisper, '#FFFFFF', withAlpha(colors.brand.mist, 0.6)]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={{
              position: 'absolute', right: -50, bottom: -60,
              width: 200, height: 200, borderRadius: 100,
              backgroundColor: withAlpha(colors.brand.DEFAULT, 0.06),
            }} />
            <View style={{ position: 'absolute', right: 18, bottom: 18, opacity: 0.32 }}>
              <Sparkles size={68} color={colors.brand.DEFAULT} strokeWidth={1.25} />
            </View>

            <View style={{ position: 'relative' }}>
              <View style={{
                alignSelf: 'flex-start',
                backgroundColor: colors.brand.mist,
                paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999,
              }}>
                <Text style={{
                  fontSize: 10, fontWeight: '700', color: colors.brand.DEFAULT,
                  letterSpacing: 1.5, textTransform: 'uppercase',
                }}>
                  {t('Explore', 'Explora')}
                </Text>
              </View>
              <Text style={{
                fontSize: 28, fontWeight: '800', color: colors.ink,
                letterSpacing: -0.8, marginTop: 12, lineHeight: 32,
              }}>
                {t('All brands', 'Todas las marcas')}
              </Text>
              <Text style={{
                fontSize: 14, color: colors.gray, marginTop: 8,
                lineHeight: 20, maxWidth: 280,
              }}>
                {t(
                  'The trusted names behind your pantry. Tap one to see every product we stock.',
                  'Las marcas de confianza detrás de tu despensa. Toca una para ver todos sus productos.',
                )}
              </Text>
              {brands.length > 0 && (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 14,
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: colors.ink }}>
                      {brands.length}
                    </Text>
                    <Text style={{ fontSize: 11.5, color: colors.gray }}>
                      {t('brands', 'marcas')}
                    </Text>
                  </View>
                  {totalProducts > 0 && (
                    <>
                      <View style={{ width: 1, height: 10, backgroundColor: colors.border }} />
                      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: colors.ink }}>
                          {formatBrandCount(totalProducts)}
                        </Text>
                        <Text style={{ fontSize: 11.5, color: colors.gray }}>
                          {t('products', 'productos')}
                        </Text>
                      </View>
                    </>
                  )}
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ── Toolbar ──────────────────────────────────────────── */}
        {brands.length > 0 && (
          <View style={{ paddingTop: 16, gap: 10 }}>
            {/* Search */}
            <View style={{ paddingHorizontal: 16 }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                height: 46, paddingHorizontal: 12, borderRadius: 14,
                borderWidth: 1, borderColor: q ? colors.brand.DEFAULT : colors.border,
                backgroundColor: colors.surface.white,
              }}>
                <Search
                  size={17}
                  color={q ? colors.brand.DEFAULT : colors.muted}
                  strokeWidth={1.75}
                />
                <TextInput
                  value={q}
                  onChangeText={setQ}
                  placeholder={t('Search brands', 'Buscar marcas')}
                  placeholderTextColor={colors.muted}
                  accessibilityLabel={t('Search brands', 'Buscar marcas')}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="search"
                  style={{ flex: 1, fontSize: 14, color: colors.ink, padding: 0 }}
                />
                {!!q && (
                  <Pressable
                    onPress={() => setQ('')}
                    hitSlop={10}
                    accessibilityLabel={t('Clear search', 'Borrar búsqueda')}
                    style={{
                      width: 22, height: 22, borderRadius: 11,
                      backgroundColor: colors.surface.sand,
                      alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <X size={13} color={colors.gray} strokeWidth={2.25} />
                  </Pressable>
                )}
              </View>
            </View>

            {/* Sort + stocked-only. One scrolling row so it never wraps onto a
                second line on a narrow screen. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
            >
              {sortOptions.map((o) => (
                <FilterChip
                  key={o.value}
                  label={o.label}
                  active={sort === o.value}
                  onPress={() => setSort(o.value)}
                />
              ))}
              <View style={{
                width: 1, height: 20, backgroundColor: colors.border, alignSelf: 'center',
              }} />
              <FilterChip
                label={t('In stock only', 'Solo con stock')}
                active={hideEmpty}
                onPress={() => setHideEmpty((v) => !v)}
                icon={hideEmpty
                  ? <Check size={13} color={colors.brand.deepest} strokeWidth={2.5} />
                  : undefined}
              />
            </ScrollView>

            {/* A–Z. Tapping the active letter clears it, so the filter is
                reversible without hunting for the clear-all. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 4 }}
            >
              {ALPHABET.map((L) => {
                const has = enabledInitials.has(L);
                const active = letter === L;
                return (
                  <Pressable
                    key={L}
                    disabled={!has}
                    onPress={() => setLetter(active ? '' : L)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: !has }}
                    style={{
                      minWidth: 30, height: 30, borderRadius: 9,
                      alignItems: 'center', justifyContent: 'center',
                      paddingHorizontal: 4,
                      backgroundColor: active ? colors.brand.DEFAULT : colors.surface.white,
                      borderWidth: 1,
                      borderColor: active ? colors.brand.DEFAULT : colors.border,
                      opacity: has ? 1 : 0.4,
                    }}
                  >
                    <Text style={{
                      fontSize: 12, fontWeight: '700',
                      color: active ? '#fff' : has ? colors.gray : colors.muted,
                    }}>
                      {L}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Recently viewed — only rendered once there is history, so it
                never sits empty. */}
            {recentBrands.length > 0 && (
              <View style={{ paddingHorizontal: 16 }}>
                <View style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  paddingLeft: 12, paddingRight: 6, paddingVertical: 8,
                  borderRadius: 14, borderWidth: 1, borderColor: colors.border,
                  backgroundColor: colors.surface.white,
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Clock size={12} color={colors.muted} strokeWidth={2.25} />
                    <Text style={{
                      fontSize: 10, fontWeight: '800', color: colors.muted,
                      letterSpacing: 1.2, textTransform: 'uppercase',
                    }}>
                      {t('Recent', 'Vistas')}
                    </Text>
                  </View>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 6, paddingRight: 6 }}
                  >
                    {recentBrands.map((b) => (
                      <Pressable
                        key={b.name}
                        onPress={() => openBrand(b)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 6,
                          paddingLeft: 4, paddingRight: 10, paddingVertical: 4,
                          borderRadius: 999, backgroundColor: colors.surface.sand,
                        }}
                      >
                        <View style={{
                          width: 22, height: 22, borderRadius: 11,
                          alignItems: 'center', justifyContent: 'center',
                          backgroundColor: b.bg_color || colors.border,
                        }}>
                          <Text style={{
                            fontSize: 9, fontWeight: '800',
                            color: withAlpha(colors.ink, 0.5),
                          }}>
                            {monogram(b.name)}
                          </Text>
                        </View>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: colors.charcoal }}>
                          {b.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </View>
            )}

            {/* Result line — only while filtering, so the default view stays
                clean. */}
            {isFiltered && (
              <View style={{
                paddingHorizontal: 16, flexDirection: 'row',
                alignItems: 'center', justifyContent: 'space-between',
              }}>
                <Text
                  accessibilityLiveRegion="polite"
                  style={{ fontSize: 12.5, color: colors.gray }}
                >
                  <Text style={{ fontWeight: '800', color: colors.ink }}>{visible.length}</Text>
                  {` ${visible.length === 1 ? t('brand', 'marca') : t('brands', 'marcas')}`}
                </Text>
                <Pressable onPress={clearAll} hitSlop={8}>
                  <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.brand.DEFAULT }}>
                    {t('Clear all', 'Limpiar todo')}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* ── Grid ─────────────────────────────────────────────── */}
        <View style={{ padding: 16, paddingTop: 14, gap: 14 }}>
          {isLoading ? (
            <View style={{ paddingVertical: 60, alignItems: 'center' }}>
              <ActivityIndicator color={colors.brand.DEFAULT} />
            </View>
          ) : isError ? (
            /* A failed request used to fall through to "No brands yet", which
               reads as an empty catalogue rather than a network problem and
               hides the fact that a retry would fix it. */
            <View style={{
              borderRadius: 24, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border,
              backgroundColor: '#fff', padding: 32, alignItems: 'center',
            }}>
              <View style={{
                width: 56, height: 56, borderRadius: 28,
                backgroundColor: colors.brand.mist,
                alignItems: 'center', justifyContent: 'center', marginBottom: 12,
              }}>
                <RefreshCw size={26} color={colors.brand.DEFAULT} strokeWidth={1.75} />
              </View>
              <Text style={{
                fontSize: 17, fontWeight: '700', color: colors.ink, letterSpacing: -0.3,
              }}>
                {t('Could not load brands', 'No se pudieron cargar las marcas')}
              </Text>
              <Text style={{
                fontSize: 13, color: colors.gray, marginTop: 6, textAlign: 'center',
              }}>
                {t(
                  'Check your connection and try again.',
                  'Revisa tu conexión e inténtalo de nuevo.',
                )}
              </Text>
              <Pressable
                onPress={() => refetch()}
                style={{
                  marginTop: 16, height: 44, paddingHorizontal: 20,
                  borderRadius: 12, backgroundColor: colors.brand.DEFAULT,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#fff' }}>
                  {t('Try again', 'Reintentar')}
                </Text>
              </Pressable>
            </View>
          ) : brands.length === 0 ? (
            <View style={{
              borderRadius: 24, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border,
              backgroundColor: '#fff', padding: 32, alignItems: 'center',
            }}>
              <View style={{
                width: 56, height: 56, borderRadius: 28,
                backgroundColor: colors.brand.mist,
                alignItems: 'center', justifyContent: 'center', marginBottom: 12,
              }}>
                <Tag size={26} color={colors.brand.DEFAULT} strokeWidth={1.75} />
              </View>
              <Text style={{
                fontSize: 17, fontWeight: '700', color: colors.ink, letterSpacing: -0.3,
              }}>
                {t('No brands yet', 'Sin marcas aún')}
              </Text>
              <Text style={{
                fontSize: 13, color: colors.gray, marginTop: 6, textAlign: 'center',
              }}>
                {t(
                  'Brands will appear here once the catalogue is set up.',
                  'Las marcas aparecerán aquí cuando se configure el catálogo.',
                )}
              </Text>
            </View>
          ) : visible.length === 0 ? (
            /* Filtered to nothing — a different state from "no brands yet",
               and the way out is the CTA rather than undoing filters one at
               a time. */
            <View style={{
              borderRadius: 24, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border,
              backgroundColor: '#fff', padding: 32, alignItems: 'center',
            }}>
              <View style={{
                width: 56, height: 56, borderRadius: 28,
                backgroundColor: colors.brand.mist,
                alignItems: 'center', justifyContent: 'center', marginBottom: 12,
              }}>
                <SearchX size={26} color={colors.brand.DEFAULT} strokeWidth={1.75} />
              </View>
              <Text style={{
                fontSize: 17, fontWeight: '700', color: colors.ink, letterSpacing: -0.3,
              }}>
                {t('No brands match', 'Ninguna marca coincide')}
              </Text>
              <Text style={{
                fontSize: 13, color: colors.gray, marginTop: 6, textAlign: 'center',
              }}>
                {t(
                  'Try a different spelling, or clear the filters to see everything.',
                  'Prueba otra ortografía, o limpia los filtros para verlo todo.',
                )}
              </Text>
              <Pressable
                onPress={clearAll}
                style={{
                  marginTop: 16, height: 44, paddingHorizontal: 20,
                  borderRadius: 12, backgroundColor: colors.brand.DEFAULT,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#fff' }}>
                  {t('Clear filters', 'Limpiar filtros')}
                </Text>
              </Pressable>
            </View>
          ) : grouped ? (
            groups.map((g) => (
              <View key={g.letter} style={{ gap: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{
                    fontSize: 13, fontWeight: '800', color: colors.ink, letterSpacing: 0.5,
                  }}>
                    {g.letter}
                  </Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
                </View>
                {renderRows(g.brands)}
              </View>
            ))
          ) : (
            renderRows(visible)
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
