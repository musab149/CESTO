import { View, Text, FlatList, Pressable, Image, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import {
  Plus, ShoppingBasket, Users, ShieldAlert, AlertTriangle, ChevronRight,
} from 'lucide-react-native';
import {
  usePartnerRashanPacks, useUpdatePartnerRashanPack, usePartnerStore, resolveImageUrl,
  type PartnerPackRow,
} from '@grocery-app/shared';
import { colors } from '@/constants/colors';
import { usePartnerT } from '@/partner/lib/i18n';
import { useToast } from '@/components/Toast';
import Skeleton from '@/components/Skeleton';
import { PartnerHeader, Centered, PrimaryButton } from '@/partner/components/ui';

/**
 * The store's rashan packs — recurring baskets a customer subscribes to once
 * and receives on a schedule. They appear on Cesto's /rashan rail alongside
 * Cesto's own, and on a Rashan tab on this store's storefront.
 *
 * Packs go live immediately; there is no review queue. Cesto can take one down
 * afterwards, which freezes it: `admin_blocked_at` outranks the Active switch
 * and only Cesto can lift it. A blocked pack therefore shows its state plainly
 * and refuses the toggle rather than offering a switch that silently does
 * nothing.
 */

export default function PartnerRashanPacks() {
  const router = useRouter();
  const t = usePartnerT();
  const toast = useToast();

  const packs = usePartnerRashanPacks();
  const store = usePartnerStore();
  const update = useUpdatePartnerRashanPack();

  const list = packs.data ?? [];

  /** The stored slug carries the store prefix the API added; the payload wants
   *  the bare value back, exactly as web's toggle does. */
  function bareSlug(pack: PartnerPackRow): string {
    const prefix = store.data?.slug ? `${store.data.slug}-` : null;
    return prefix && pack.slug.startsWith(prefix) ? pack.slug.slice(prefix.length) : pack.slug;
  }

  // The API takes a whole pack, not a patch, so flipping one switch means
  // sending everything back unchanged around it. Same shape as web's toggle.
  function toggleActive(pack: PartnerPackRow) {
    if (pack.admin_blocked_at) return;
    update.mutate({
      id: pack.id,
      payload: {
        slug: bareSlug(pack),
        name_es: pack.name_es,
        name_en: pack.name_en,
        tagline_es: pack.tagline_es,
        tagline_en: pack.tagline_en,
        cover_url: pack.cover_url ?? null,
        emoji: pack.emoji,
        base_price: 0,
        estimated_savings_pct: pack.estimated_savings_pct,
        household_default: pack.household_default,
        highlights_es: pack.highlights_es,
        highlights_en: pack.highlights_en,
        items: pack.items,
        sort_order: pack.sort_order,
        is_active: !pack.is_active,
      },
    }, {
      onSuccess: () => toast.success(pack.is_active ? t('packs.paused') : t('packs.resumed')),
      onError: () => toast.error(t('packs.toggleFailed')),
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.linen }}>
      <PartnerHeader
        title={t('packs.title')}
        subtitle={packs.data ? t('packs.count').replace('{{n}}', String(list.length)) : null}
        onBack={() => router.back()}
      />

      {packs.isError ? (
        <Centered>
          <AlertTriangle size={22} color={colors.danger} strokeWidth={2} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{t('packs.loadFailed')}</Text>
          <PrimaryButton label={t('packs.retry')} onPress={() => void packs.refetch()} />
        </Centered>
      ) : packs.isLoading ? (
        <View style={{ padding: 16, gap: 10 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={96} borderRadius={12} />)}
        </View>
      ) : list.length === 0 ? (
        <Centered>
          <ShoppingBasket size={26} color={colors.muted} strokeWidth={1.75} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>{t('packs.empty')}</Text>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', maxWidth: 280, lineHeight: 18 }}>
            {t('packs.emptyHint')}
          </Text>
          <PrimaryButton label={t('packs.add')} onPress={() => router.push('/partner-rashan-pack/new')} />
        </Centered>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 96 }}
          refreshControl={
            <RefreshControl refreshing={packs.isRefetching} onRefresh={() => void packs.refetch()} tintColor={colors.brand.DEFAULT} />
          }
          renderItem={({ item }) => (
            <PackCard
              pack={item}
              t={t}
              busy={update.isPending}
              onOpen={() => router.push(`/partner-rashan-pack/${item.id}`)}
              onToggle={() => toggleActive(item)}
            />
          )}
        />
      )}

      {list.length > 0 && (
        <Pressable
          onPress={() => router.push('/partner-rashan-pack/new')}
          style={{
            position: 'absolute', right: 20, bottom: 28,
            flexDirection: 'row', alignItems: 'center', gap: 6,
            height: 52, paddingHorizontal: 20, borderRadius: 999,
            backgroundColor: colors.brand.DEFAULT,
            shadowColor: '#0F172A', shadowOpacity: 0.2, shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 }, elevation: 5,
          }}
        >
          <Plus size={17} color="#FFFFFF" strokeWidth={2.5} />
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: '#FFFFFF' }}>{t('packs.add')}</Text>
        </Pressable>
      )}
    </View>
  );
}

function PackCard({
  pack, t, busy, onOpen, onToggle,
}: {
  pack: PartnerPackRow;
  t: (k: string) => string;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const blocked = !!pack.admin_blocked_at;
  const cover = pack.cover_url ? resolveImageUrl(pack.cover_url, 'thumb') : null;
  const subscribers = pack._count?.subscriptions ?? 0;

  return (
    <View style={{
      backgroundColor: colors.surface.cream, borderRadius: 12,
      borderWidth: 1, borderColor: blocked ? colors.danger : colors.border,
      opacity: !blocked && !pack.is_active ? 0.6 : 1,
      overflow: 'hidden',
    }}>
      <Pressable onPress={onOpen} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
        {cover ? (
          <Image source={{ uri: cover }} style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: colors.surface.sand }} />
        ) : (
          <View style={{
            width: 48, height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
            backgroundColor: colors.brand.mist,
          }}>
            <Text style={{ fontSize: 22 }}>{pack.emoji ?? '🧺'}</Text>
          </View>
        )}
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: colors.ink }} numberOfLines={1}>
            {pack.name_es}
          </Text>
          {!!pack.tagline_es && (
            <Text style={{ fontSize: 12, color: colors.muted }} numberOfLines={1}>{pack.tagline_es}</Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <ShoppingBasket size={11} color={colors.muted} strokeWidth={2} />
              <Text style={{ fontSize: 11.5, color: colors.gray }}>
                {t('packs.items').replace('{{n}}', String((pack.items ?? []).length))}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Users size={11} color={colors.muted} strokeWidth={2} />
              <Text style={{ fontSize: 11.5, color: colors.gray }}>
                {t('packs.subscribers').replace('{{n}}', String(subscribers))}
              </Text>
            </View>
          </View>
        </View>
        <ChevronRight size={16} color={colors.muted} strokeWidth={2} />
      </Pressable>

      {blocked ? (
        <View style={{
          flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12,
          backgroundColor: colors.dangerBg, borderTopWidth: 1, borderTopColor: colors.border,
        }}>
          <ShieldAlert size={14} color={colors.danger} strokeWidth={2} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, fontSize: 11.5, color: colors.danger, lineHeight: 16 }}>
            {t('packs.blocked')}
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={onToggle}
          disabled={busy}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            paddingHorizontal: 14, paddingVertical: 10, minHeight: 48,
            borderTopWidth: 1, borderTopColor: colors.border,
          }}
        >
          <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: colors.gray }}>
            {pack.is_active ? t('packs.active') : t('packs.inactive')}
          </Text>
          <View style={{
            width: 46, height: 28, borderRadius: 999, padding: 3,
            backgroundColor: pack.is_active ? colors.brand.DEFAULT : colors.border,
            alignItems: pack.is_active ? 'flex-end' : 'flex-start',
            opacity: busy ? 0.5 : 1,
          }}>
            <View style={{ width: 22, height: 22, borderRadius: 999, backgroundColor: '#FFFFFF' }} />
          </View>
        </Pressable>
      )}
    </View>
  );
}
