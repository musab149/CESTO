import { Fragment } from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import {
  BadgeCheck, Clock, ShoppingBasket, Bike, Plus, Check, Share2,
} from 'lucide-react-native';
import { resolveImageUrl, useStoreSettings, type Store, type ShopHours } from '@grocery-app/shared';
import { colors } from '../constants/colors';
import { deliveryLabel } from '../lib/deliveryCopy';

/**
 * The rich store card, mirroring web's StoreHeroCard: cover band with delivery
 * and product-count pills, a blue band carrying the name, and a nested white
 * card of info cells above Follow / Share — only the ones the system can
 * actually answer, so the count varies.
 *
 * Shared by the stores directory and the followed-stores list so the two
 * cannot drift.
 */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function formatHourLabel(hhmm: string): string {
  const [hRaw, mRaw] = hhmm.split(':');
  const h = Number(hRaw);
  const m = Number(mRaw);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
}

function todaysOpenLabel(hours: ShopHours | null): string | null {
  if (!hours) return null;
  const day = (hours as Record<string, { open: string; closed?: boolean } | undefined>)[DAY_KEYS[new Date().getDay()]];
  if (!day || day.closed) return null;
  return formatHourLabel(day.open);
}


/**
 * The card used to print five cells, three of them invented: a €5 minimum
 * order (there is no minimum), a €2.50 delivery fee, and "free over €50" —
 * which contradicted the real admin setting on every shop it was shown for.
 * A fourth, distance, was hardcoded null and always rendered an em dash.
 *
 * Only what the system actually knows is shown now. Delivery and free-over
 * are platform-wide settings, not per-shop columns, so they come from
 * useStoreSettings; each cell disappears when there is nothing true to put
 * in it, which is why the row builds a list rather than laying out a fixed
 * five. When Prisma grows real per-store min_order_amount / delivery_fee,
 * add them here as cells of their own.
 */
type Cell = { Icon: typeof Clock; value: string; label: string };

const formatCount = (n: number) =>
  n >= 1000 ? `${n / 1000 >= 10 ? Math.round(n / 1000) : (n / 1000).toFixed(1).replace(/\.0$/, '')}K` : `${n}`;

/* ───────── Rich store card — web's StoreHeroCard ───────── */

function InfoCell({ Icon, value, label }: { Icon: typeof Clock; value: string; label: string }) {
  return (
    <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 4, paddingVertical: 2, alignItems: 'center' }}>
      <Icon size={13} color={colors.brand.DEFAULT} strokeWidth={2} />
      <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: '700', color: colors.ink, marginTop: 2 }}>{value}</Text>
      <Text numberOfLines={1} style={{ fontSize: 9, color: colors.muted, marginTop: 1 }}>{label}</Text>
    </View>
  );
}

export default function StoreHeroCard({
  store, lang, isFollowed, followPending, onFollow, onShare, onPress,
}: {
  store: Store & { products_count?: number; _count?: { products: number } };
  lang: 'en' | 'es';
  isFollowed: boolean;
  followPending?: boolean;
  onFollow: () => void;
  onShare: () => void;
  onPress: () => void;
}) {
  const t = (en: string, es: string) => (lang === 'en' ? en : es);
  const cover = store.cover_url ? resolveImageUrl(store.cover_url, 'hero') : null;
  const productCount = store.products_count ?? store._count?.products ?? 0;
  const opensAt = todaysOpenLabel(store.shop_hours);
  const { data: settings } = useStoreSettings();

  const money = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2)}€`;

  const cells: Cell[] = [];
  if (opensAt) cells.push({ Icon: Clock, value: opensAt, label: t('Open From', 'Abre') });
  // In distance mode there is no single fee to quote — it is worked out from
  // the address at checkout, so quoting one here would be a guess.
  if (settings && settings.deliveryPricingMode !== 'distance' && settings.deliveryFee > 0) {
    cells.push({ Icon: Bike, value: money(settings.deliveryFee), label: t('Delivery', 'Envío') });
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: '#fff', borderRadius: 16, borderWidth: 1,
        borderColor: colors.border, overflow: 'hidden', marginBottom: 12,
        opacity: pressed ? 0.95 : 1,
      })}
    >
      {/* Cover — h-28 on web below sm, matching the storefront's own band. */}
      <View style={{ height: 112, backgroundColor: store.logo_bg || colors.brand.whisper }}>
        {cover && <Image source={{ uri: cover }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />}

        <View style={{ position: 'absolute', top: 8, left: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 999, paddingLeft: 6, paddingRight: 8, paddingVertical: 2 }}>
          <Clock size={10} color={colors.brand.DEFAULT} strokeWidth={2.25} />
          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.ink }}>{deliveryLabel(store.fast_delivery, lang)}</Text>
        </View>

        <View style={{ position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.95)', borderRadius: 999, paddingLeft: 6, paddingRight: 8, paddingVertical: 2 }}>
          <ShoppingBasket size={10} color={colors.brand.DEFAULT} strokeWidth={2.25} />
          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.ink }}>
            {formatCount(productCount)}+ {t('products', 'productos')}
          </Text>
        </View>
      </View>

      {/* Blue band — name, then the nested white card. */}
      <View style={{ backgroundColor: colors.brand.DEFAULT, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 10, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, fontWeight: '700', color: '#fff' }}>
            {store.name}
          </Text>
          {store.is_verified && <BadgeCheck size={16} color="#fff" strokeWidth={2} />}
        </View>

        <View style={{ backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 6, gap: 6 }}>
          {cells.length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
              {cells.map((cell, i) => (
                <Fragment key={cell.label}>
                  {i > 0 && <View style={{ width: 1, backgroundColor: colors.border }} />}
                  <InfoCell Icon={cell.Icon} value={cell.value} label={cell.label} />
                </Fragment>
              ))}
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Pressable
              onPress={(e) => { e.stopPropagation(); onFollow(); }}
              disabled={followPending}
              style={{
                flex: 1, height: 36, borderRadius: 8,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                backgroundColor: isFollowed ? colors.brand.mist : colors.brand.DEFAULT,
                borderWidth: isFollowed ? 1 : 0, borderColor: colors.brand.soft,
                opacity: followPending ? 0.7 : 1,
              }}
            >
              {isFollowed
                ? <Check size={13} color={colors.brand.DEFAULT} strokeWidth={2.5} />
                : <Plus size={13} color="#fff" strokeWidth={2.5} />}
              <Text style={{ fontSize: 12, fontWeight: '700', color: isFollowed ? colors.brand.DEFAULT : '#fff' }}>
                {isFollowed ? t('Following', 'Siguiendo') : t('Follow Store', 'Seguir tienda')}
              </Text>
            </Pressable>

            <Pressable
              onPress={(e) => { e.stopPropagation(); onShare(); }}
              style={{
                flex: 1, height: 36, borderRadius: 8,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                backgroundColor: '#fff', borderWidth: 1, borderColor: colors.brand.soft,
              }}
            >
              <Share2 size={13} color={colors.brand.DEFAULT} strokeWidth={2.5} />
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.brand.DEFAULT }}>
                {t('Share Store', 'Compartir')}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
