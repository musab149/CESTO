import { View, Text, Pressable, TextInput, FlatList, ScrollView, Keyboard, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Search, X, Clock, Flame } from 'lucide-react-native';
import { useState, useRef, useEffect } from 'react';
import { useInfiniteSearch, useCategories, useFeaturedProducts } from '@grocery-app/shared';
import { colors } from '../../src/constants/colors';
import { useLanguageStore } from '../../src/stores/languageStore';
import ProductCard from '../../src/components/ProductCard';
import { ProductGridSkeleton } from '../../src/components/Skeleton';

const recentSearches = [
  { id: 'rs-1', term_es: 'Arroz basmati', term_en: 'Basmati rice' },
  { id: 'rs-2', term_es: 'Ghee', term_en: 'Ghee' },
  { id: 'rs-3', term_es: 'Garam masala', term_en: 'Garam masala' },
];

export default function SearchScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const timeout = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(timeout);
  }, [query]);

  // Paged rather than a single 60-row call: the old query capped results at
  // whatever fit on page one, so result 61 onward was simply unreachable on
  // mobile. Web already loads more the same way.
  const {
    data: searchPages, isFetching,
    fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteSearch(debounced, { limit: 30 });
  const { data: categories = [] } = useCategories();
  // Trending row only loads while the user is on the idle state — mirrors web
  // which renders the same useFeaturedProducts list before any query is typed.
  const { data: trendingProducts = [] } = useFeaturedProducts(8);
  const filteredProducts = (searchPages?.pages ?? []).flatMap((p) => p.products ?? []);
  const popularCategories = categories.slice(0, 4);

  const handleRecentTap = (term: string) => setQuery(term);
  const handleCategoryTap = (catId: string) => router.push(`/category/${catId}`);
  const clearSearch = () => { setQuery(''); inputRef.current?.focus(); };

  const hasQuery = debounced.length > 0;
  const hasResults = filteredProducts.length > 0;

  const renderIdleContent = () => (
    <ScrollView
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
      contentContainerStyle={{ paddingTop: 20, paddingBottom: 24 }}
    >
      <View style={{ paddingHorizontal: 16 }}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink, marginBottom: 12 }}>
          {lang === 'es' ? 'Búsquedas recientes' : 'Recent searches'}
        </Text>
        {recentSearches.map((item) => {
          const term = lang === 'es' ? item.term_es : item.term_en;
          return (
            <Pressable
              key={item.id}
              onPress={() => handleRecentTap(term)}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
                borderBottomWidth: 1, borderBottomColor: colors.border,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Clock size={16} color={colors.muted} strokeWidth={1.75} />
              <Text style={{ fontSize: 14, color: colors.ink, marginLeft: 12, flex: 1 }}>
                {term}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Trending — what web's idle state surfaces too. */}
      {trendingProducts.length > 0 && (
        <View style={{ marginTop: 28 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, marginBottom: 12 }}>
            <Flame size={16} color={colors.warning} strokeWidth={2} />
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>
              {lang === 'es' ? 'Tendencias' : 'Trending now'}
            </Text>
          </View>
          <FlatList
            data={trendingProducts}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <View style={{ width: 160 }}>
                <ProductCard product={item} />
              </View>
            )}
          />
        </View>
      )}

      {popularCategories.length > 0 && (
        <View style={{ paddingHorizontal: 16, marginTop: 28 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink, marginBottom: 12 }}>
            {lang === 'es' ? 'Categorías populares' : 'Popular categories'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {popularCategories.map((cat) => {
              const name = lang === 'es' ? cat.name_es : cat.name_en;
              return (
                <Pressable
                  key={cat.id}
                  onPress={() => handleCategoryTap(cat.id)}
                  style={({ pressed }) => ({
                    backgroundColor: pressed ? colors.brand.mist : colors.surface.cream,
                    borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10,
                    borderWidth: 1, borderColor: colors.border,
                  })}
                >
                  <Text style={{ fontSize: 13, fontWeight: '500', color: colors.ink }}>{name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </ScrollView>
  );

  const renderNoResults = () => (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, paddingTop: 80 }}>
      <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
        <Search size={32} color={colors.muted} strokeWidth={1.75} />
      </View>
      <Text style={{ fontSize: 18, fontWeight: '600', color: colors.ink, textAlign: 'center', marginBottom: 6 }}>
        {lang === 'es' ? 'Sin resultados' : 'No results'}
      </Text>
      <Text style={{ fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 }}>
        {lang === 'es' ? 'Intenta con otro término de búsqueda' : 'Try a different search term'}
      </Text>
    </View>
  );

  const renderResults = () => (
    <FlatList
      data={filteredProducts}
      renderItem={({ item }) => (
        // Home's grid wrapper, so every product grid in the app sizes its
        // cards the same way.
        <View style={{ width: '50%', padding: 6 }}>
          <ProductCard product={item} />
        </View>
      )}
      keyExtractor={(item) => item.id}
      numColumns={2}
      contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 12, paddingBottom: 24 }}
      showsVerticalScrollIndicator={false}
      keyboardDismissMode="on-drag"
      onEndReachedThreshold={0.4}
      onEndReached={() => {
        if (hasNextPage && !isFetchingNextPage) fetchNextPage();
      }}
      ListFooterComponent={
        isFetchingNextPage ? (
          <View style={{ paddingVertical: 20 }}>
            <ActivityIndicator color={colors.brand.DEFAULT} />
          </View>
        ) : null
      }
    />
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface.linen }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, gap: 10 }}>
        <View style={{ flex: 1, height: 44, backgroundColor: colors.surface.white, borderRadius: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 }}>
          <Search size={18} color={colors.muted} strokeWidth={1.75} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            placeholder={lang === 'es' ? 'Buscar productos...' : 'Search products...'}
            placeholderTextColor={colors.muted}
            style={{ flex: 1, fontSize: 15, color: colors.ink, marginLeft: 8, paddingVertical: 0 }}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={clearSearch} hitSlop={8}>
              <X size={18} color={colors.muted} strokeWidth={1.75} />
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={() => { Keyboard.dismiss(); setQuery(''); router.back(); }}
          hitSlop={8}
        >
          <Text style={{ fontSize: 15, fontWeight: '500', color: colors.brand.DEFAULT }}>
            {lang === 'es' ? 'Cancelar' : 'Cancel'}
          </Text>
        </Pressable>
      </View>

      {!hasQuery && renderIdleContent()}
      {hasQuery && isFetching && !hasResults && <ProductGridSkeleton count={4} />}
      {hasQuery && hasResults && renderResults()}
      {hasQuery && !isFetching && !hasResults && renderNoResults()}
    </SafeAreaView>
  );
}
