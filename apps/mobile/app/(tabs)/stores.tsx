import {
  View, Text, Pressable, FlatList, TextInput, ActivityIndicator, Image, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Search, X, Store as StoreIcon } from 'lucide-react-native';
import {
  useStores, useStoresHero, defaultStoresHero, useToggleFollowStore,
  useMyFollowedStores, resolveImageUrl, type Store,
} from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import AppHeader from '../../src/components/AppHeader';
import StoreHeroCard from '../../src/components/StoreHeroCard';
import { useLanguageStore } from '../../src/stores/languageStore';
import { useAuthStore } from '../../src/stores/authStore';
import { useToast } from '../../src/components/Toast';

/**
 * Store directory — mirrors web's /stores at its mobile breakpoint.
 *
 * Same order as web: hero, search, segmented sort, filter chips, then a
 * single-column grid of the rich store card. Web's grid is `grid-cols-1`
 * below sm, so one card per row is already the responsive layout rather than
 * a mobile-only decision.
 */

type SortKey = 'popular' | 'rating' | 'newest' | 'name';
type BusinessType = '' | 'verified' | 'community';
type ServiceType = '' | 'fast';

/* ───────── Screen ───────── */

export default function StoresScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const toast = useToast();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const t = (en: string, es: string) => (lang === 'en' ? en : es);

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [sort, setSort] = useState<SortKey>('popular');
  const [origin, setOrigin] = useState('');
  const [businessType, setBusinessType] = useState<BusinessType>('');
  const [serviceType, setServiceType] = useState<ServiceType>('');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const { data: heroConfig } = useStoresHero();
  const hero = heroConfig ?? defaultStoresHero;
  const heroImage = hero.image_url ? resolveImageUrl(hero.image_url, 'banner') : null;
  const heroDark = hero.text_theme === 'dark';

  const { data, isLoading } = useStores({
    q: debouncedQ || undefined,
    origin: origin || undefined,
    sort,
    limit: 40,
  });

  const { data: followed } = useMyFollowedStores(isAuthenticated);
  const followedIds = useMemo(
    () => new Set((followed ?? []).map((s) => s.id)),
    [followed],
  );
  const toggleFollow = useToggleFollowStore();

  const rawStores = (data?.items ?? []) as Array<Store & { products_count?: number }>;

  // Business/service type have no API params — web filters them client-side
  // over the loaded page and documents it. Same here so the two agree.
  const stores = useMemo(() => {
    let list = rawStores;
    if (businessType === 'verified') list = list.filter((s) => s.is_verified);
    if (businessType === 'community') list = list.filter((s) => !s.is_verified);
    if (serviceType === 'fast') list = list.filter((s) => s.fast_delivery);
    return list;
  }, [rawStores, businessType, serviceType]);

  const originOptions = useMemo(
    () => Array.from(new Set(rawStores.map((s) => s.origin).filter((o): o is string => !!o))),
    [rawStores],
  );

  const isFiltered = !!q || !!origin || !!businessType || !!serviceType || sort !== 'popular';
  const clearAll = () => {
    setQ(''); setOrigin(''); setSort('popular');
    setBusinessType(''); setServiceType('');
  };

  const onFollow = (store: Store) => {
    if (!isAuthenticated) {
      toast.info(
        t('Sign in required', 'Inicia sesión'),
        t('Log in to follow stores.', 'Inicia sesión para seguir tiendas.'),
      );
      router.push('/login');
      return;
    }
    toggleFollow.mutate({ slug: store.slug, follow: !followedIds.has(store.id) });
  };

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: 'popular', label: t('Popular', 'Popular') },
    { value: 'rating', label: t('Top rated', 'Mejor valoradas') },
    { value: 'newest', label: t('Newest', 'Recientes') },
    { value: 'name', label: 'A–Z' },
  ];

  return (
    <SafeAreaView edges={[]} style={{ flex: 1, backgroundColor: colors.surface.linen }}>
      {/* No page-title row here, unlike the other tabs: the hero directly
          below is the admin-editable stores-hero and already carries the
          screen's title and count. Web's /stores does the same. */}
      <AppHeader />

      <FlatList
        data={stores}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            {/* Hero — admin-editable stores-hero section, same as web. */}
            <View
              style={{
                borderRadius: 20, borderWidth: 1, borderColor: colors.border,
                overflow: 'hidden', marginBottom: 12,
                backgroundColor: heroImage ? colors.brand.whisper : colors.brand.whisper,
              }}
            >
              {heroImage && (
                <Image source={{ uri: heroImage }} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" />
              )}
              <View style={{ paddingHorizontal: 20, paddingVertical: 22 }}>
                <Text style={{ fontSize: 24, fontWeight: '700', color: heroDark ? colors.ink : '#fff', letterSpacing: -0.4 }}>
                  {lang === 'en' ? hero.title_en : hero.title_es}
                </Text>
                <Text style={{ fontSize: 13, marginTop: 5, lineHeight: 18, color: heroDark ? colors.gray : 'rgba(255,255,255,0.9)' }}>
                  {lang === 'en' ? hero.subtitle_en : hero.subtitle_es}
                </Text>
                {(data?.total ?? 0) > 0 && (
                  <Text style={{ fontSize: 12.5, marginTop: 12, color: heroDark ? colors.gray : 'rgba(255,255,255,0.9)' }}>
                    <Text style={{ fontWeight: '700', color: heroDark ? colors.ink : '#fff' }}>{data?.total}</Text>
                    {' '}{t((data?.total ?? 0) === 1 ? 'store' : 'stores', (data?.total ?? 0) === 1 ? 'tienda' : 'tiendas')}
                  </Text>
                )}
              </View>
            </View>

            {/* Search */}
            <View
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                height: 44, paddingHorizontal: 14, borderRadius: 12, marginBottom: 10,
                backgroundColor: '#fff', borderWidth: 1, borderColor: colors.border,
              }}
            >
              <Search size={16} color={colors.muted} strokeWidth={2} />
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder={t('Search stores', 'Buscar tiendas')}
                placeholderTextColor={colors.muted}
                style={{ flex: 1, fontSize: 14, color: colors.ink }}
                returnKeyType="search"
              />
              {q.length > 0 && (
                <Pressable onPress={() => setQ('')} hitSlop={8}>
                  <X size={15} color={colors.muted} strokeWidth={2.5} />
                </Pressable>
              )}
            </View>

            {/* Segmented sort — four fixed options, all readable at once. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 2 }}
              style={{ backgroundColor: colors.surface.sand, borderRadius: 12, padding: 3, marginBottom: 10, flexGrow: 0 }}
            >
              {sortOptions.map((o) => {
                const active = sort === o.value;
                return (
                  <Pressable
                    key={o.value}
                    onPress={() => setSort(o.value)}
                    style={{
                      height: 38, paddingHorizontal: 14, borderRadius: 9,
                      alignItems: 'center', justifyContent: 'center',
                      backgroundColor: active ? '#fff' : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 12.5, fontWeight: '600', color: active ? colors.ink : colors.gray }}>
                      {o.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Filter chips — origin · business type · service type. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
              style={{ marginBottom: 12, flexGrow: 0 }}
            >
              <FilterChip
                label={origin || t('All Origin', 'Origen')}
                active={!!origin}
                options={[{ value: '', label: t('All Origin', 'Todos los orígenes') }, ...originOptions.map((o) => ({ value: o, label: o }))]}
                onSelect={setOrigin}
              />
              <FilterChip
                label={
                  businessType === 'verified' ? t('Verified partners', 'Socios verificados')
                    : businessType === 'community' ? t('Community stores', 'Tiendas comunitarias')
                      : t('Business Type', 'Tipo de negocio')
                }
                active={!!businessType}
                options={[
                  { value: '', label: t('All types', 'Todos los tipos') },
                  { value: 'verified', label: t('Verified partners', 'Socios verificados') },
                  { value: 'community', label: t('Community stores', 'Tiendas comunitarias') },
                ]}
                onSelect={(v) => setBusinessType(v as BusinessType)}
              />
              <FilterChip
                label={serviceType === 'fast' ? t('Fast delivery', 'Entrega rápida') : t('Service Type', 'Tipo de servicio')}
                active={!!serviceType}
                options={[
                  { value: '', label: t('Any service', 'Cualquier servicio') },
                  { value: 'fast', label: t('Fast delivery', 'Entrega rápida') },
                ]}
                onSelect={(v) => setServiceType(v as ServiceType)}
              />
            </ScrollView>

            {/* Result line — web shows this only while filtered. */}
            {!isLoading && isFiltered && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <Text style={{ fontSize: 12.5, color: colors.gray }}>
                  <Text style={{ fontWeight: '700', color: colors.ink }}>{stores.length}</Text>
                  {' '}{t(`of ${rawStores.length} stores`, `de ${rawStores.length} tiendas`)}
                </Text>
                <Pressable onPress={clearAll} hitSlop={8}>
                  <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.brand.DEFAULT }}>
                    {t('Clear filters', 'Limpiar filtros')}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <StoreHeroCard
            store={item}
            lang={lang}
            isFollowed={followedIds.has(item.id)}
            followPending={toggleFollow.isPending}
            onFollow={() => onFollow(item)}
            onShare={() => toast.info(t('Share', 'Compartir'), `${item.name} · cestoshop.com/stores/${item.slug}`)}
            onPress={() => router.push({ pathname: '/store/[slug]', params: { slug: item.slug } })}
          />
        )}
        ListEmptyComponent={
          isLoading ? (
            <View style={{ paddingVertical: 60, alignItems: 'center' }}>
              <ActivityIndicator color={colors.brand.DEFAULT} />
            </View>
          ) : (
            <View style={{ paddingVertical: 60, alignItems: 'center', paddingHorizontal: 24 }}>
              <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: colors.surface.cream, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <StoreIcon size={28} color={colors.muted} strokeWidth={1.5} />
              </View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 4 }}>
                {t('No stores match', 'Sin resultados')}
              </Text>
              <Text style={{ fontSize: 13.5, color: colors.muted, textAlign: 'center', marginBottom: 16 }}>
                {t('Try clearing filters or searching for a different name.', 'Prueba a borrar los filtros o buscar otro nombre.')}
              </Text>
              <Pressable
                onPress={clearAll}
                style={{ height: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>
                  {t('Clear filters', 'Borrar filtros')}
                </Text>
              </Pressable>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
}

/**
 * Dropdown chip. Web renders a native <select> styled as a chip; RN has no
 * equivalent, so the options expand inline underneath — same information,
 * same one-tap cost, without pulling in a picker dependency.
 */
function FilterChip({
  label, active, options, onSelect,
}: {
  label: string;
  active: boolean;
  options: { value: string; label: string }[];
  onSelect: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={{
          height: 38, paddingHorizontal: 14, borderRadius: 999,
          alignItems: 'center', justifyContent: 'center',
          borderWidth: 1,
          borderColor: active ? colors.brand.DEFAULT : colors.border,
          backgroundColor: active ? colors.brand.mist : '#fff',
        }}
      >
        <Text numberOfLines={1} style={{ fontSize: 12.5, fontWeight: '600', color: active ? colors.brand.deepest : colors.ink }}>
          {label}
        </Text>
      </Pressable>

      {open && (
        <View
          style={{
            marginTop: 6, backgroundColor: '#fff', borderRadius: 12,
            borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
          }}
        >
          {options.map((o) => (
            <Pressable
              key={o.value}
              onPress={() => { onSelect(o.value); setOpen(false); }}
              style={{ paddingHorizontal: 14, paddingVertical: 10 }}
            >
              <Text style={{ fontSize: 13, color: colors.ink }}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
