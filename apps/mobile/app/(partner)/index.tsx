import { useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import {
  AlertTriangle, ChevronRight, CircleCheck, Circle, PackageX, TriangleAlert,
} from 'lucide-react-native';
import {
  usePartnerDashboardStats, usePartnerRecentOrders,
  type PartnerDashboardRange, type PartnerRecentOrder,
} from '@grocery-app/shared';
import { colors } from '@/constants/colors';
import { orderStatusMeta } from '@/constants/orderStatus';
import { useLanguageStore } from '@/stores/languageStore';
import { usePartnerT } from '@/partner/lib/i18n';
import { usePartnerStore } from '@/partner/usePartnerAccess';
import Skeleton from '@/components/Skeleton';
import { PartnerTabBar } from '@/partner/components/ui';

/**
 * Partner "Today" — the landing screen of partner mode.
 *
 * Web's dashboard is 482 lines of stat grid. On a phone the same numbers have
 * to earn their place, so the order is what a shopkeeper opening the app at
 * 8am actually needs: anything wrong with the store, anything waiting on them,
 * then the money, then the catalogue, then the recent orders.
 *
 * "Needs action" leads because it is the only block that is ever urgent.
 * Revenue sits below it: it is the number people like looking at, not the one
 * that changes what they do next.
 */

const RANGES: PartnerDashboardRange[] = ['today', '7d', '30d', 'month', 'year'];

export default function PartnerDashboard() {
  const t = usePartnerT();
  const router = useRouter();
  const store = usePartnerStore();
  const { lang } = useLanguageStore();
  const [range, setRange] = useState<PartnerDashboardRange>('today');

  const stats = usePartnerDashboardStats({ range });
  const recent = usePartnerRecentOrders();

  const refreshing = stats.isRefetching || recent.isRefetching;
  const onRefresh = () => { void stats.refetch(); void recent.refetch(); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.linen }}>
      {/* Store name rather than a generic "Dashboard": a partner who manages a
          shop wants to see the shop, and it confirms which store the numbers
          below belong to. */}
      <PartnerTabBar title={store?.name ?? 'Cesto'} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 16 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand.DEFAULT} />
        }
      >

      {stats.isError ? (
        <ErrorCard message={t('dashboard.loadFailed')} retry={t('dashboard.retry')} onRetry={() => void stats.refetch()} />
      ) : stats.isLoading ? (
        <DashboardSkeleton />
      ) : stats.data ? (
        <>
          {stats.data.storeStatus !== 'live' && (
            <StatusBanner status={stats.data.storeStatus} t={t} />
          )}

          {stats.data.setupDoneCount < stats.data.setupTotalCount && (
            <SetupCard
              setup={stats.data.setup}
              done={stats.data.setupDoneCount}
              total={stats.data.setupTotalCount}
              t={t}
              // Straight to the store editor, not to a menu. Every setup step
              // the card lists — logo, cover, opening hours, delivery area —
              // is a field on that one screen, and routing through a hub was
              // only ever an artefact of More being a tab.
              onPress={() => router.push('/partner-store')}
            />
          )}

          {/* Range chips scroll rather than wrap: five options at readable tap
              size do not fit one phone row, and a wrapped second row of two
              looks like a mistake. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingRight: 8 }}
          >
            {RANGES.map((r) => {
              const on = r === range;
              return (
                <Pressable
                  key={r}
                  onPress={() => setRange(r)}
                  style={{
                    paddingHorizontal: 14, height: 34, borderRadius: 999,
                    alignItems: 'center', justifyContent: 'center',
                    backgroundColor: on ? colors.brand.DEFAULT : colors.surface.cream,
                    borderWidth: 1, borderColor: on ? colors.brand.DEFAULT : colors.border,
                  }}
                >
                  <Text style={{ fontSize: 13, fontWeight: '600', color: on ? '#FFFFFF' : colors.gray }}>
                    {t(`dashboard.range.${r}`)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <MoneyCard
            revenue={stats.data.period.revenue}
            orders={stats.data.period.orders}
            t={t}
          />

          <Section title={t('dashboard.needsAction')}>
            <TileRow>
              <Tile
                value={stats.data.pendingOrders}
                label={t('dashboard.pendingOrders')}
                tone={stats.data.pendingOrders > 0 ? 'warn' : 'calm'}
                onPress={() => router.push('/(partner)/orders')}
              />
              <Tile
                value={stats.data.unassignedOrders}
                label={t('dashboard.unassigned')}
                tone={stats.data.unassignedOrders > 0 ? 'warn' : 'calm'}
                onPress={() => router.push('/(partner)/orders')}
              />
              <Tile
                value={stats.data.activeOrders}
                label={t('dashboard.activeOrders')}
                tone="calm"
                onPress={() => router.push('/(partner)/orders')}
              />
            </TileRow>
          </Section>

          <Section title={t('dashboard.catalogue')}>
            <TileRow>
              <Tile value={stats.data.totalProducts} label={t('dashboard.products')} tone="calm"
                onPress={() => router.push('/(partner)/products')} />
              <Tile value={stats.data.lowStockVariants} label={t('dashboard.lowStock')}
                tone={stats.data.lowStockVariants > 0 ? 'warn' : 'calm'}
                icon={stats.data.lowStockVariants > 0 ? TriangleAlert : undefined}
                onPress={() => router.push('/(partner)/products')} />
              <Tile value={stats.data.outOfStockVariants} label={t('dashboard.outOfStock')}
                tone={stats.data.outOfStockVariants > 0 ? 'bad' : 'calm'}
                icon={stats.data.outOfStockVariants > 0 ? PackageX : undefined}
                onPress={() => router.push('/(partner)/products')} />
            </TileRow>
          </Section>

          <RecentOrders
            orders={recent.data}
            loading={recent.isLoading}
            lang={lang}
            t={t}
            onSeeAll={() => router.push('/(partner)/orders')}
            onOpen={(id) => router.push(`/partner-order/${id}`)}
          />
        </>
      ) : null}
      </ScrollView>
    </View>
  );
}

/* ── pieces ─────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.muted }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** Three tiles across, equal width, so the row reads as one object. */
function TileRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', gap: 8 }}>{children}</View>;
}

function Tile({
  value, label, tone, icon: Icon, onPress,
}: {
  value: number;
  label: string;
  tone: 'calm' | 'warn' | 'bad';
  icon?: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  onPress?: () => void;
}) {
  // Colour carries meaning here, so it is spent only when a number is actually
  // actionable. A zero is good news and stays quiet.
  const fg = tone === 'bad' ? colors.danger : tone === 'warn' ? colors.amber.deep : colors.ink;
  const bg = tone === 'bad' ? colors.dangerBg : tone === 'warn' ? colors.amber.mist : colors.surface.cream;
  const bd = tone === 'calm' ? colors.border : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1, backgroundColor: bg, borderRadius: 12, padding: 12,
        borderWidth: 1, borderColor: bd, gap: 4, minHeight: 78, justifyContent: 'center',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: fg, letterSpacing: -0.6 }}>{value}</Text>
        {Icon ? <Icon size={13} color={fg} strokeWidth={2.25} /> : null}
      </View>
      <Text style={{ fontSize: 11.5, fontWeight: '600', color: tone === 'calm' ? colors.gray : fg, lineHeight: 14 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function MoneyCard({ revenue, orders, t }: { revenue: number; orders: number; t: (k: string) => string }) {
  return (
    <View style={{
      backgroundColor: colors.brand.DEFAULT, borderRadius: 14, padding: 16,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: 11.5, fontWeight: '600', color: 'rgba(255,255,255,0.75)', letterSpacing: 0.4, textTransform: 'uppercase' }}>
          {t('dashboard.revenue')}
        </Text>
        <Text style={{ fontSize: 28, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1 }}>
          {'€'}{Number(revenue ?? 0).toFixed(2)}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: '#FFFFFF' }}>{orders ?? 0}</Text>
        <Text style={{ fontSize: 11.5, fontWeight: '600', color: 'rgba(255,255,255,0.75)' }}>
          {t('dashboard.periodOrders')}
        </Text>
      </View>
    </View>
  );
}

function StatusBanner({ status, t }: { status: 'draft' | 'paused' | 'suspended' | 'live'; t: (k: string) => string }) {
  if (status === 'live') return null;
  const bad = status === 'suspended';
  return (
    <View style={{
      flexDirection: 'row', gap: 10, padding: 14, borderRadius: 12,
      backgroundColor: bad ? colors.dangerBg : colors.amber.mist,
    }}>
      <AlertTriangle size={18} color={bad ? colors.danger : colors.amber.deep} strokeWidth={2} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: '700', color: bad ? colors.danger : colors.amber.deep }}>
          {t(`dashboard.status.${status}`)}
        </Text>
        <Text style={{ fontSize: 12.5, color: colors.gray, lineHeight: 17 }}>
          {t(`dashboard.status.${status}Body`)}
        </Text>
      </View>
    </View>
  );
}

const SETUP_KEYS = [
  'hasLogo', 'hasCover', 'hasContactEmail', 'hasShopHours',
  'hasProducts', 'hasAddress', 'hasRiders',
] as const;

function SetupCard({
  setup, done, total, t, onPress,
}: {
  setup: Record<string, boolean>;
  done: number; total: number;
  t: (k: string) => string;
  onPress: () => void;
}) {
  const pending = SETUP_KEYS.filter((k) => !setup[k]);
  return (
    <Pressable onPress={onPress} style={{
      backgroundColor: colors.surface.cream, borderRadius: 14, padding: 16,
      borderWidth: 1, borderColor: colors.border, gap: 12,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>{t('dashboard.setup.title')}</Text>
        <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.muted }}>
          {done}/{total} {t('dashboard.setup.done')}
        </Text>
      </View>

      <View style={{ height: 5, borderRadius: 999, backgroundColor: colors.surface.sand, overflow: 'hidden' }}>
        <View style={{ width: `${Math.round((done / Math.max(total, 1)) * 100)}%`, height: '100%', backgroundColor: colors.amber.DEFAULT }} />
      </View>

      {/* Only the unfinished steps are listed. A checklist of seven ticks is
          reassuring once; a list of the three things left is useful daily. */}
      <View style={{ gap: 7 }}>
        {pending.slice(0, 3).map((k) => (
          <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Circle size={14} color={colors.muted} strokeWidth={2} />
            <Text style={{ fontSize: 13, color: colors.gray, flex: 1 }}>{t(`dashboard.setup.${k}`)}</Text>
          </View>
        ))}
        {pending.length > 3 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <CircleCheck size={14} color={'transparent'} strokeWidth={2} />
            <Text style={{ fontSize: 12.5, color: colors.muted }}>+{pending.length - 3}</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function RecentOrders({
  orders, loading, lang, t, onSeeAll, onOpen,
}: {
  orders: PartnerRecentOrder[] | undefined;
  loading: boolean;
  lang: 'en' | 'es';
  t: (k: string) => string;
  onSeeAll: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.muted }}>
          {t('dashboard.recentOrders')}
        </Text>
        <Pressable onPress={onSeeAll} hitSlop={8}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: colors.brand.DEFAULT }}>{t('dashboard.viewAll')}</Text>
        </Pressable>
      </View>

      <View style={{ backgroundColor: colors.surface.cream, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
        {loading ? (
          <View style={{ padding: 16, gap: 12 }}>
            {[0, 1, 2].map((i) => <Skeleton key={i} height={38} />)}
          </View>
        ) : !orders || orders.length === 0 ? (
          <View style={{ padding: 24, alignItems: 'center', gap: 6 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{t('dashboard.noOrders')}</Text>
            <Text style={{ fontSize: 12.5, color: colors.muted, textAlign: 'center' }}>{t('dashboard.noOrdersHint')}</Text>
          </View>
        ) : (
          orders.map((o, i) => {
            const meta = orderStatusMeta(o.status);
            return (
              <Pressable
                key={o.id}
                onPress={() => onOpen(o.id)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14,
                  borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border,
                }}
              >
                <View style={{ flex: 1, gap: 3 }}>
                  <Text style={{ fontSize: 13.5, fontWeight: '700', color: colors.ink }} numberOfLines={1}>
                    {o.user?.name ?? o.order_number}
                  </Text>
                  <Text style={{ fontSize: 11.5, color: colors.muted }}>
                    {o._count.items} {t('dashboard.items')}
                    {o.rider ? ` · ${o.rider.name}` : ` · ${t('dashboard.noRider')}`}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
                    {'€'}{Number(o.total ?? 0).toFixed(2)}
                  </Text>
                  <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: meta.bg }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: meta.text }}>
                      {lang === 'es' ? meta.label_es : meta.label_en}
                    </Text>
                  </View>
                </View>
                <ChevronRight size={16} color={colors.muted} strokeWidth={2} />
              </Pressable>
            );
          })
        )}
      </View>
    </View>
  );
}

function ErrorCard({ message, retry, onRetry }: { message: string; retry: string; onRetry: () => void }) {
  return (
    <View style={{ backgroundColor: colors.surface.cream, borderRadius: 14, padding: 24, alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border }}>
      <AlertTriangle size={22} color={colors.danger} strokeWidth={2} />
      <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink, textAlign: 'center' }}>{message}</Text>
      <Pressable
        onPress={onRetry}
        style={{ minHeight: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>{retry}</Text>
      </Pressable>
    </View>
  );
}

function DashboardSkeleton() {
  return (
    <View style={{ gap: 16 }}>
      <Skeleton height={34} borderRadius={999} width="70%" />
      <Skeleton height={84} borderRadius={14} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[0, 1, 2].map((i) => <View key={i} style={{ flex: 1 }}><Skeleton height={78} borderRadius={12} /></View>)}
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[0, 1, 2].map((i) => <View key={i} style={{ flex: 1 }}><Skeleton height={78} borderRadius={12} /></View>)}
      </View>
      <Skeleton height={180} borderRadius={14} />
    </View>
  );
}
