import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, Stack } from 'expo-router';
import { ArrowLeft, ChevronRight, Heart, Trash2 } from 'lucide-react-native';
import { useMemo } from 'react';
import { useProductsByIds } from '@grocery-app/shared';
import ProductCard from '../src/components/ProductCard';
import { ProductGridSkeleton } from '../src/components/Skeleton';
import { colors } from '../src/constants/colors';
import { useFavoritesStore } from '../src/stores/favoritesStore';
import { useLanguageStore } from '../src/stores/languageStore';
import { useToast } from '../src/components/Toast';

export default function FavoritesScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const toast = useToast();

  const favoriteIds = useFavoritesStore((s) => s.productIds);
  const clear = useFavoritesStore((s) => s.clear);

  // Fetch exactly the favourited products. This used to pull a 200-row page of
  // the whole catalogue and filter it client-side, so a favourite outside those
  // 200 rows silently vanished from the list — the same bug web hit and fixed.
  // The hook preserves the caller's order and disables itself on an empty list.
  const { data: favoriteProducts, isLoading } = useProductsByIds(favoriteIds);

  const favorites = useMemo(() => favoriteProducts ?? [], [favoriteProducts]);

  function handleClear() {
    clear();
    toast.success(
      lang === 'en' ? 'Favourites cleared' : 'Favoritos eliminados',
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface.cream }}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={{ width: 40, height: 40, borderRadius: 8, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={2} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: colors.ink, letterSpacing: -0.3 }}>
          {lang === 'en' ? 'My favourites' : 'Mis favoritos'}
        </Text>
        {favoriteIds.length > 0 && (
          <Pressable onPress={handleClear} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 32, borderRadius: 999, borderWidth: 1, borderColor: colors.border }}>
            <Trash2 size={13} color={colors.gray} strokeWidth={1.75} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: colors.gray, letterSpacing: -0.2 }}>
              {lang === 'en' ? 'Clear' : 'Vaciar'}
            </Text>
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Subtitle */}
        <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12 }}>
          <Text style={{ fontSize: 13, color: colors.muted, letterSpacing: -0.2 }}>
            {favoriteIds.length === 0
              ? (lang === 'en' ? 'Save products you love to find them faster.' : 'Guarda los productos que te gustan para encontrarlos más rápido.')
              : `${favoriteIds.length} ${
                  favoriteIds.length === 1
                    ? (lang === 'en' ? 'product saved' : 'producto guardado')
                    : (lang === 'en' ? 'products saved' : 'productos guardados')
                }`}
          </Text>
        </View>

        {isLoading && favoriteIds.length > 0 ? (
          <ProductGridSkeleton count={4} />
        ) : favoriteIds.length === 0 ? (
          <View style={{ marginHorizontal: 20, marginTop: 12, padding: 32, borderRadius: 8, backgroundColor: colors.surface.cream, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', alignItems: 'center' }}>
            <View style={{ width: 72, height: 72, borderRadius: 999, backgroundColor: colors.dangerBg, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
              <Heart size={28} color={colors.danger} strokeWidth={1.75} />
            </View>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, letterSpacing: -0.3, marginBottom: 6 }}>
              {lang === 'en' ? 'No favourites yet' : 'Aún no tienes favoritos'}
            </Text>
            <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', lineHeight: 18, marginBottom: 20, maxWidth: 280 }}>
              {lang === 'en'
                ? 'Tap the heart on any product to save it here for later.'
                : 'Toca el corazón en cualquier producto para guardarlo aquí.'}
            </Text>
            <Pressable
              onPress={() => router.push('/(tabs)/categories')}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 22, borderRadius: 999, backgroundColor: pressed ? colors.brand.mid : colors.brand.deepest })}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff', letterSpacing: -0.2 }}>
                {lang === 'en' ? 'Browse products' : 'Explorar productos'}
              </Text>
              <ChevronRight size={14} color="#fff" strokeWidth={2.5} />
            </Pressable>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14 }}>
            {favorites.map((item) => (
              <View key={item.id} style={{ width: '50%', padding: 6 }}>
                <ProductCard product={item} />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
