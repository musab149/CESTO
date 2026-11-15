import { useState } from 'react';
import {
  View, Text, FlatList, Pressable, RefreshControl, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  Users, Repeat, MapPin, Phone, Package, ChevronDown, AlertTriangle,
} from 'lucide-react-native';
import {
  usePartnerRashanSubscriptions, usePartnerRashanPacks,
  type PartnerSubscriptionRow, type RashanSubStatus,
} from '@grocery-app/shared';
import { colors } from '@/constants/colors';
import { usePartnerT } from '@/partner/lib/i18n';
import Skeleton from '@/components/Skeleton';
import {
  PartnerHeader, SearchField, FilterChips, PickerSheet, Pager,
  Centered, PrimaryButton, StatusPill,
} from '@/partner/components/ui';

/**
 * Who is subscribed to this store's packs.
 *
 * Read-only, and deliberately so — web's page says it best: pausing,
 * rescheduling and cancelling belong to the customer, and a partner silently
 * pausing someone's groceries would be a support incident, not a feature.
 * What a partner wants from this screen is demand: who, to what, how often,
 * and what it is worth.
 *
 * The fulfilment side lives on the deliveries screen; a row here links across
 * to it rather than duplicating the queue.
 */

const PAGE_SIZE = 20;

const STATUSES = ['all', 'active', 'paused', 'cancelled'] as const;
type StatusFilter = (typeof STATUSES)[number];

const PILL: Record<RashanSubStatus, { bg: string; fg: string }> = {
  active:    { bg: colors.successBg,     fg: colors.success },
  paused:    { bg: colors.amber.mist,    fg: colors.amber.deep },
  cancelled: { bg: colors.surface.sand,  fg: colors.muted },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

function money(n: number): string {
  return Number(n).toFixed(2).replace('.', ',') + ' €';
}

export default function PartnerRashanSubscribers() {
  const router = useRouter();
  const t = usePartnerT();

  const [status, setStatus] = useState<StatusFilter>('active');
  const [packId, setPackId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [packSheet, setPackSheet] = useState(false);

  const packs = usePartnerRashanPacks();
  const subs = usePartnerRashanSubscriptions({
    status: status === 'all' ? undefined : status,
    packId: packId || undefined,
    q: q.trim() || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const rows = subs.data?.items ?? [];
  const total = subs.data?.total ?? 0;
  const totalPages = subs.data?.totalPages ?? 1;
  const filtered = status !== 'active' || !!packId || !!q.trim();

  // Any filter change resets to page 1 — a narrower filter can otherwise
  // strand you on a page that no longer exists.
  function reset<T>(setter: (v: T) => void) {
    return (v: T) => { setter(v); setPage(1); };
  }

  // Recurring value from what is actually on this page, and labelled as such.
  // Calling a page-local sum "MRR" would be a lie once paginated — same
  // caveat web carries.
  const pageValue = rows
    .filter((r) => r.status === 'active')
    .reduce((sum, r) => sum + Number(r.total_per_cycle), 0);

  const activePack = packs.data?.find((p) => p.id === packId) ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.linen }}>
      <PartnerHeader
        title={t('rashanSubs.title')}
        subtitle={subs.data ? t('rashanSubs.count').replace('{{n}}', String(total)) : null}
        onBack={() => router.back()}
      >
        <SearchField value={q} onChangeText={reset(setQ)} placeholder={t('rashanSubs.searchPlaceholder')} />
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Pressable
            onPress={() => setPackSheet(true)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              minHeight: 34, paddingHorizontal: 12, borderRadius: 999,
              backgroundColor: packId ? colors.brand.mist : colors.surface.linen,
              borderWidth: 1, borderColor: packId ? colors.brand.DEFAULT : colors.border,
            }}
          >
            <Text
              style={{ fontSize: 12.5, fontWeight: packId ? '700' : '500', color: packId ? colors.brand.deepest : colors.gray, maxWidth: 150 }}
              numberOfLines={1}
            >
              {activePack ? activePack.name_es : t('rashanSubs.allPacks')}
            </Text>
            <ChevronDown size={13} color={packId ? colors.brand.DEFAULT : colors.muted} strokeWidth={2} />
          </Pressable>
        </View>
        <FilterChips
          options={STATUSES}
          value={status}
          labelFor={(s) => t(`rashanSubs.status.${s}`)}
          onChange={reset(setStatus)}
        />
      </PartnerHeader>

      {pageValue > 0 && (
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
          paddingVertical: 10, paddingHorizontal: 16,
          backgroundColor: colors.brand.whisper, borderBottomWidth: 1, borderBottomColor: colors.border,
        }}>
          <Repeat size={13} color={colors.brand.DEFAULT} strokeWidth={1.75} />
          <Text style={{ fontSize: 12.5, color: colors.gray }}>{t('rashanSubs.pageValue')}</Text>
          <Text style={{ fontSize: 13.5, fontWeight: '700', color: colors.ink }}>{money(pageValue)}</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>{t('rashanSubs.perCycle')}</Text>
        </View>
      )}

      {subs.isError ? (
        <Centered>
          <AlertTriangle size={22} color={colors.danger} strokeWidth={2} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{t('rashanSubs.loadFailed')}</Text>
          <PrimaryButton label={t('rashanSubs.retry')} onPress={() => void subs.refetch()} />
        </Centered>
      ) : subs.isLoading ? (
        <View style={{ padding: 16, gap: 10 }}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={128} borderRadius={12} />)}
        </View>
      ) : rows.length === 0 ? (
        <Centered>
          <Users size={26} color={colors.muted} strokeWidth={1.75} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>{t('rashanSubs.empty')}</Text>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', maxWidth: 280, lineHeight: 18 }}>
            {filtered ? t('rashanSubs.emptyFiltered') : t('rashanSubs.emptyHint')}
          </Text>
        </Centered>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={subs.isRefetching} onRefresh={() => void subs.refetch()} tintColor={colors.brand.DEFAULT} />
          }
          ListFooterComponent={<Pager page={page} totalPages={totalPages} onChange={setPage} />}
          renderItem={({ item }) => <SubscriberCard row={item} t={t} />}
        />
      )}

      <PickerSheet
        visible={packSheet}
        title={t('rashanSubs.filterByPack')}
        selectedKey={packId || '__all__'}
        options={[
          { key: '__all__', label: t('rashanSubs.allPacks') },
          ...(packs.data ?? []).map((p) => ({ key: p.id, label: p.name_es })),
        ]}
        emptyLabel={t('rashanSubs.noPacks')}
        onClose={() => setPackSheet(false)}
        onPick={(key) => { setPackSheet(false); reset(setPackId)(key === '__all__' ? '' : key); }}
      />
    </View>
  );
}

function SubscriberCard({ row, t }: { row: PartnerSubscriptionRow; t: (k: string) => string }) {
  const pill = PILL[row.status];

  return (
    <View style={{
      backgroundColor: colors.surface.cream, borderRadius: 12, padding: 14, gap: 10,
      borderWidth: 1, borderColor: colors.border,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: colors.ink }} numberOfLines={1}>
            {row.user.name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text style={{ fontSize: 13 }}>{row.pack?.emoji ?? '🧺'}</Text>
            <Text style={{ flex: 1, fontSize: 12.5, color: colors.gray }} numberOfLines={1}>
              {row.pack?.name_es ?? t('rashanSubs.customPack')}
            </Text>
          </View>
        </View>
        <StatusPill label={t(`rashanSubs.status.${row.status}`)} bg={pill.bg} fg={pill.fg} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Fact label={t('rashanSubs.frequency')} value={t(`rashanSubs.frequency.${row.frequency}`)} />
        <Fact label={t('rashanSubs.household')} value={String(row.household)} icon={Package} />
        <Fact label={t('rashanSubs.cycles')} value={String(row.cycles_completed)} />
      </View>

      <View style={{
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border,
      }}>
        <View style={{ gap: 2 }}>
          <Text style={{ fontSize: 11, color: colors.muted }}>{t('rashanSubs.nextDelivery')}</Text>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }}>
            {row.status === 'active' ? formatDate(row.next_delivery_date) : '—'}
          </Text>
        </View>
        <View style={{ gap: 2, alignItems: 'flex-end' }}>
          <Text style={{ fontSize: 11, color: colors.muted }}>{t('rashanSubs.perCycleLabel')}</Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>
            {money(row.total_per_cycle)}
          </Text>
        </View>
      </View>

      <View style={{ gap: 4 }}>
        {row.user.phone && (
          <Pressable
            onPress={() => void Linking.openURL(`tel:${row.user.phone}`)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            hitSlop={6}
          >
            <Phone size={11} color={colors.muted} strokeWidth={2} />
            <Text style={{ fontSize: 12, color: colors.brand.DEFAULT, fontFamily: 'JetBrainsMono' }}>
              {row.user.phone}
            </Text>
          </Pressable>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <MapPin size={11} color={colors.muted} strokeWidth={2} />
          <Text style={{ flex: 1, fontSize: 12, color: colors.gray }} numberOfLines={1}>
            {row.address.postcode} {row.address.city}
          </Text>
        </View>
      </View>
    </View>
  );
}

function Fact({
  label, value, icon: Icon,
}: {
  label: string;
  value: string;
  icon?: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
}) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ fontSize: 10.5, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {Icon && <Icon size={11} color={colors.gray} strokeWidth={2} />}
        <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.charcoal }}>{value}</Text>
      </View>
    </View>
  );
}
