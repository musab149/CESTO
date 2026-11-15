/**
 * Dedicated Shop-by-Origin discovery page. Reached from the home row's
 * "See more" CTA. Same visual language as the home tile, surfaced as a full
 * 3-column grid with a polished hero. Tapping a tile routes to /browse with
 * the origin filter pre-applied.
 */
import {
  View, Text, Pressable, ScrollView, Image, StyleSheet, ActivityIndicator,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, Globe2, Search, X, SearchX, Check, RefreshCw,
} from 'lucide-react-native';
import { useMemo, useState, useCallback } from 'react';
import {
  useOriginsList, useOriginCounts, resolveImageUrl,
} from '@grocery-app/shared';
import type { OriginCard } from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import {
  filterAndSortOrigins, isOriginFilterActive, type OriginSort,
} from '../src/lib/originFilter';

/** Tiles per row, and the gap between them. Three-up on a 360pt screen leaves
 *  each tile about 104pt wide, which is what the tile below is sized for. */
const COLUMNS = 3;
const GRID_GAP = 8;

function formatOriginCount(n: number): string {
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

/** Pill shared by the sort options and the stocked-only toggle. */
function FilterChip({
  label, active, onPress, icon,
}: { label: string; active: boolean; onPress: () => void; icon?: React.ReactNode }) {
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

function OriginTile({
  card, count, lang, onPress,
}: { card: OriginCard; count: number; lang: 'en' | 'es'; onPress: () => void }) {
  const image = card.image_url ? resolveImageUrl(card.image_url, 'tile') : null;
  const label = lang === 'en' ? card.label_en : card.label_es;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        aspectRatio: 4 / 5,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: card.bg_color,
        justifyContent: 'flex-end',
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      {image ? (
        <Image source={{ uri: image }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={{ position: 'absolute', top: 8, left: 10 }}>
          <Text style={{
            fontSize: 46, fontWeight: '900', color: card.accent_color,
            letterSpacing: -2, lineHeight: 48,
          }}>
            {card.key.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      <LinearGradient
        colors={[card.bg_color, withAlpha(card.bg_color, 0.9), withAlpha(card.bg_color, 0)] as [string, string, string]}
        locations={[0, 0.45, 1]}
        start={{ x: 0, y: 1 }} end={{ x: 0, y: 0 }}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '58%' }}
      />
      {/* Three-up leaves roughly 104pt of tile, so the caption stacks and the
          arrow disc is gone — at that width it was taking a third of the row
          to repeat what tapping the card already does. The label gets two
          lines rather than an ellipsis, because the names that overflow are
          the real ones ("Reino Unido"), not edge cases. */}
      <View style={{ padding: 10 }}>
        <Text style={{
          fontSize: 12.5, fontWeight: '700', color: colors.ink,
          letterSpacing: -0.2, lineHeight: 15,
        }} numberOfLines={2}>
          {label}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            fontSize: 10, color: 'rgba(15,23,42,0.55)', marginTop: 2, fontWeight: '500',
          }}
        >
          {formatOriginCount(count)} {lang === 'en' ? 'products' : 'productos'}
        </Text>
      </View>
    </Pressable>
  );
}

export default function OriginsScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const t = (en: string, es: string) => (lang === 'en' ? en : es);
  // Origins table, not the curated home_sections blob — same move web made.
  const { data: originsData, isLoading, isError, refetch } = useOriginsList();
  const { data: countsData } = useOriginCounts();

  const counts = countsData ?? [];
  const countByOrigin = useMemo(
    () => new Map<string, number>(counts.map((c) => [c.key.toLowerCase(), c.product_count])),
    [counts],
  );

  // Every active origin, including ones with 0 products — the home rail shows
  // the curated "has-products" subset, this screen shows the full list.
  // Adapted to the existing OriginCard contract so the tile stays untouched;
  // null colours fall back to the design-system defaults web uses.
  const cards = useMemo<OriginCard[]>(
    () =>
      // No is_active filter — GET /api/origins selects only active rows and
      // omits the column, so checking it here matched nothing. Same trap as
      // the brands screen.
      (originsData ?? [])
        .map((o) => ({
          key: o.key.toLowerCase(),
          label_es: o.label_es,
          label_en: o.label_en,
          bg_color: o.bg_color ?? '#F5F0E8',
          accent_color: o.accent_color ?? '#7A7A7A',
          image_url: o.image_url,
          link: o.link ?? `/browse?origin=${encodeURIComponent(o.key)}`,
          is_active: true,
          display_order: o.sort_order,
        }))
        .sort((a, b) => a.display_order - b.display_order),
    [originsData],
  );

  const totalProducts = cards.reduce(
    (sum, c) => sum + (countByOrigin.get(c.key) ?? 0),
    0,
  );

  // ── Filter state ──────────────────────────────────────────
  // Component state rather than the URL, unlike web: there is no address bar
  // to share here and Back leaves the screen rather than stepping filters.
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<OriginSort>('featured');
  const [hideEmpty, setHideEmpty] = useState(false);

  const countOf = useCallback(
    (c: OriginCard) => countByOrigin.get(c.key) ?? 0,
    [countByOrigin],
  );

  const isFiltered = isOriginFilterActive({ q, sort, hideEmpty });
  const clearAll = () => { setQ(''); setSort('featured'); setHideEmpty(false); };

  const visible = useMemo(
    () => filterAndSortOrigins(cards, { q, sort, hideEmpty, lang, countOf }),
    [cards, q, sort, hideEmpty, lang, countOf],
  );

  const sortOptions: { value: OriginSort; label: string }[] = [
    { value: 'featured',   label: t('Featured', 'Destacados') },
    { value: 'name_asc',   label: 'A–Z' },
    { value: 'count_desc', label: t('Most products', 'Más productos') },
  ];

  // Chunk tiles into rows for the manual 3-col grid so the gap math stays
  // explicit and a short last row aligns left like the rest of the grid
  // (FlatList numColumns would centre it).
  const rows = useMemo(() => {
    const out: OriginCard[][] = [];
    for (let i = 0; i < visible.length; i += COLUMNS) out.push(visible.slice(i, i + COLUMNS));
    return out;
  }, [visible]);

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
            {lang === 'en' ? 'Discover' : 'Descubre'}
          </Text>
          <Text style={{
            fontSize: 16, fontWeight: '700', color: colors.ink, letterSpacing: -0.3,
          }} numberOfLines={1}>
            {lang === 'en' ? 'Shop by origin' : 'Compra por origen'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
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
            {/* Soft decorative blob anchored bottom-right */}
            <View style={{
              position: 'absolute', right: -50, bottom: -60,
              width: 200, height: 200, borderRadius: 100,
              backgroundColor: withAlpha(colors.brand.DEFAULT, 0.06),
            }} />
            <View style={{ position: 'absolute', right: 18, bottom: 18, opacity: 0.32 }}>
              <Globe2 size={72} color={colors.brand.DEFAULT} strokeWidth={1.25} />
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
                  {lang === 'en' ? 'Discover' : 'Descubre'}
                </Text>
              </View>
              <Text style={{
                fontSize: 28, fontWeight: '800', color: colors.ink,
                letterSpacing: -0.8, marginTop: 12, lineHeight: 32,
              }}>
                {lang === 'en' ? 'Shop by origin' : 'Compra por origen'}
              </Text>
              <Text style={{
                fontSize: 14, color: colors.gray, marginTop: 8,
                lineHeight: 20, maxWidth: 280,
              }}>
                {lang === 'en'
                  ? 'Authentic pantry staples, spices and snacks from kitchens around the world.'
                  : 'Productos auténticos, especias y snacks de cocinas de todo el mundo.'}
              </Text>
              {cards.length > 0 && (
                <View style={{
                  flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 14,
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: colors.ink }}>
                      {cards.length}
                    </Text>
                    <Text style={{ fontSize: 11.5, color: colors.gray }}>
                      {lang === 'en' ? 'regions' : 'regiones'}
                    </Text>
                  </View>
                  <View style={{ width: 1, height: 10, backgroundColor: colors.border }} />
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: colors.ink }}>
                      {formatOriginCount(totalProducts)}
                    </Text>
                    <Text style={{ fontSize: 11.5, color: colors.gray }}>
                      {lang === 'en' ? 'products' : 'productos'}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ── Toolbar ──────────────────────────────── */}
        {cards.length > 0 && (
          <View style={{ paddingTop: 16, gap: 10 }}>
            {/* Search — matches both language labels, so "spain" finds
                España whichever language the app is in. */}
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
                  placeholder={t('Search origins', 'Buscar orígenes')}
                  placeholderTextColor={colors.muted}
                  accessibilityLabel={t('Search origins', 'Buscar orígenes')}
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

            {/* Sort + stocked-only on one scrolling row, so they never wrap
                onto a second line on a narrow screen. */}
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
                  {` ${visible.length === 1 ? t('origin', 'origen') : t('origins', 'orígenes')}`}
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
        <View style={{ padding: 16, paddingTop: 14, gap: GRID_GAP }}>
          {isLoading ? (
            <View style={{ paddingVertical: 60, alignItems: 'center' }}>
              <ActivityIndicator color={colors.brand.DEFAULT} />
            </View>
          ) : isError ? (
            /* A failed request used to fall through to "No origins yet", which
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
                {t('Could not load origins', 'No se pudieron cargar los orígenes')}
              </Text>
              <Text style={{
                fontSize: 13, color: colors.gray, marginTop: 6, textAlign: 'center',
              }}>
                {t('Check your connection and try again.', 'Revisa tu conexión e inténtalo de nuevo.')}
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
          ) : cards.length > 0 && visible.length === 0 ? (
            /* Filtered to nothing — a different state from "no origins yet",
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
                {t('No origins match', 'Ningún origen coincide')}
              </Text>
              <Text style={{
                fontSize: 13, color: colors.gray, marginTop: 6, textAlign: 'center',
              }}>
                {t('Try a different spelling, or clear the filters to see everything.', 'Prueba otra ortografía, o limpia los filtros para verlo todo.')}
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
          ) : rows.length === 0 ? (
            <View style={{
              borderRadius: 24, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border,
              backgroundColor: '#fff', padding: 32, alignItems: 'center',
            }}>
              <View style={{
                width: 56, height: 56, borderRadius: 28,
                backgroundColor: colors.brand.mist,
                alignItems: 'center', justifyContent: 'center', marginBottom: 12,
              }}>
                <Globe2 size={26} color={colors.brand.DEFAULT} strokeWidth={1.75} />
              </View>
              <Text style={{
                fontSize: 17, fontWeight: '700', color: colors.ink, letterSpacing: -0.3,
              }}>
                {lang === 'en' ? 'No origins yet' : 'Sin orígenes aún'}
              </Text>
              <Text style={{
                fontSize: 13, color: colors.gray, marginTop: 6, textAlign: 'center',
              }}>
                {lang === 'en'
                  ? 'Origins will appear here once the catalogue is set up.'
                  : 'Los orígenes aparecerán aquí cuando se configure el catálogo.'}
              </Text>
            </View>
          ) : (
            rows.map((row, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: GRID_GAP }}>
                {row.map((card) => (
                  <OriginTile
                    key={card.key}
                    card={card}
                    count={countByOrigin.get(card.key) ?? 0}
                    lang={lang}
                    onPress={() => router.push(`/browse?origin=${card.key}` as never)}
                  />
                ))}
                {/* One spacer per empty slot — the tiles are flex: 1, so a
                    short last row would otherwise stretch to fill the width. */}
                {Array.from({ length: COLUMNS - row.length }, (_, k) => (
                  <View key={`pad-${k}`} style={{ flex: 1 }} />
                ))}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
