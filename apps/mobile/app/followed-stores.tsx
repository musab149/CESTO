import { View, Text, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ArrowLeft, Store as StoreIcon } from 'lucide-react-native';
import { useMyFollowedStores, useToggleFollowStore, type Store } from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import { useAuthStore } from '../src/stores/authStore';
import { useToast } from '../src/components/Toast';
import StoreHeroCard from '../src/components/StoreHeroCard';

/**
 * The stores this customer follows.
 *
 * Web surfaces following only as a button on the store card — there is no
 * "my followed stores" page there, so the list itself has nowhere to live.
 * On mobile the profile tab is where every other saved thing already lives
 * (orders, favourites, addresses), so it belongs beside them.
 *
 * Unfollowing from here removes the row on the next refetch, which is the
 * behaviour people expect from a saved list.
 */
export default function FollowedStoresScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const toast = useToast();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const t = (en: string, es: string) => (lang === 'en' ? en : es);

  const { data, isLoading } = useMyFollowedStores(isAuthenticated);
  const toggleFollow = useToggleFollowStore();

  const stores = useMemo(
    () => (data ?? []) as Array<Store & { products_count?: number }>,
    [data],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View
        style={{
          height: 56, flexDirection: 'row', alignItems: 'center', gap: 12,
          paddingHorizontal: 16, backgroundColor: colors.surface.white,
          borderBottomWidth: 1, borderBottomColor: colors.border,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, alignItems: 'center', justifyContent: 'center' }}
        >
          <ArrowLeft size={20} color={colors.ink} strokeWidth={2} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink }}>
          {t('Stores I Follow', 'Tiendas que sigo')}
        </Text>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brand.DEFAULT} />
        </View>
      ) : (
        <FlatList
          data={stores}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <StoreHeroCard
              store={item}
              lang={lang}
              // Everything on this screen is followed by definition.
              isFollowed
              followPending={toggleFollow.isPending}
              onFollow={() => toggleFollow.mutate({ slug: item.slug, follow: false })}
              onShare={() => toast.info(t('Share', 'Compartir'), `${item.name} · cestoshop.com/stores/${item.slug}`)}
              onPress={() => router.push({ pathname: '/store/[slug]', params: { slug: item.slug } })}
            />
          )}
          ListEmptyComponent={
            <View style={{ paddingVertical: 70, alignItems: 'center', paddingHorizontal: 30 }}>
              <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: colors.surface.cream, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                <StoreIcon size={28} color={colors.muted} strokeWidth={1.5} />
              </View>
              <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 4 }}>
                {t('No stores yet', 'Aún sin tiendas')}
              </Text>
              <Text style={{ fontSize: 13.5, color: colors.muted, textAlign: 'center', marginBottom: 16 }}>
                {t(
                  'Follow a store and it will show up here, so you can get back to it quickly.',
                  'Sigue una tienda y aparecerá aquí, para volver a ella rápido.',
                )}
              </Text>
              <Pressable
                onPress={() => router.push('/stores')}
                style={{ height: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#fff' }}>
                  {t('Browse stores', 'Explorar tiendas')}
                </Text>
              </Pressable>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
