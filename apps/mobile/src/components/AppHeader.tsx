/**
 * App bar — the app's port of web's Tier 1 header at mobile width.
 *
 * Two rows on brand blue, matching the site: a control row (menu, mark,
 * search, actions) over a location row. The header owns the status-bar inset
 * itself, so the blue reaches the top of the screen; the four screens that
 * render it therefore drop the `top` edge from their SafeAreaView.
 *
 * Differences from web's mobile header, both deliberate:
 *   · The bell stays. Web drops everything but the cart at mobile width, but
 *     it has no push notifications to surface — here the unread badge is the
 *     only place an unread order update is visible.
 *   · Favourites left the bar. Web moved it into the drawer at mobile width
 *     for room, and this row now carries a menu button and a location row it
 *     did not before; "My favourites" sits in the drawer's You section.
 */
import { View, Text, Pressable, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import {
  ShoppingBag, Bell, Search, Menu, MapPin, ChevronDown,
} from 'lucide-react-native';
import { useAddresses } from '@grocery-app/shared';
import { colors } from '../constants/colors';
import { useLanguageStore } from '../stores/languageStore';
import { useCartStore } from '../stores/cartStore';
import { useFavoritesStore } from '../stores/favoritesStore';
import { useUnreadCount } from '../stores/notificationStore';
import { useLocationStore } from '../stores/locationStore';
import SideNavDrawer from './SideNavDrawer';

interface AppHeaderProps {
  /** When false, omit the embedded search pill. Use on screens that render
   *  their own dedicated search bar. Defaults to true so existing callers
   *  keep their current chrome. */
  showSearch?: boolean;
  /** When false, drop the location row and keep the control row only. */
  showLocation?: boolean;
}

/** Circular action button on the blue field. */
function HeaderAction({
  onPress, badge, badgeColor, children, accessibilityLabel,
}: {
  onPress: () => void;
  badge?: number;
  badgeColor?: string;
  children: React.ReactNode;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={{
        width: 36, height: 36, borderRadius: 18,
        backgroundColor: 'rgba(255,255,255,0.10)',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
        alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <View
          style={{
            position: 'absolute', top: -4, right: -4,
            minWidth: 17, height: 17, borderRadius: 9,
            backgroundColor: badgeColor ?? colors.amber.deep,
            alignItems: 'center', justifyContent: 'center',
            paddingHorizontal: 4,
            borderWidth: 2, borderColor: colors.brand.DEFAULT,
          }}
        >
          <Text style={{ fontSize: 9, fontWeight: '800', color: '#fff' }}>{badge}</Text>
        </View>
      )}
    </Pressable>
  );
}

export default function AppHeader({
  showSearch = true, showLocation = true,
}: AppHeaderProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, lang } = useLanguageStore();
  const itemCount = useCartStore((s) => s.getItemCount());
  const unreadCount = useUnreadCount();
  const [navOpen, setNavOpen] = useState(false);

  // Favourites no longer has a button here, but the store is still what the
  // drawer badges — subscribing keeps that count live while the drawer is up.
  useFavoritesStore((s) => s.productIds.length);

  const { data: addresses = [] } = useAddresses();
  const defaultAddress = addresses.find((a) => a.is_default) ?? addresses[0];
  const location = useLocationStore((s) => s.location);
  const status = useLocationStore((s) => s.status);
  const requestLocation = useLocationStore((s) => s.requestLocation);

  useEffect(() => {
    requestLocation().catch(() => {
      /* store already captured the error */
    });
  }, [requestLocation]);

  // "Your area", web's wording. It names where we think the customer is so
  // they can turn it into a saved address — it does not scope the catalogue
  // and must not read as a delivery boundary, because there is none.
  const areaLabel = lang === 'en' ? 'Your area' : 'Tu zona';
  // Precedence kept from the pill this replaces: live/manual location, then
  // the default address, then a prompt.
  const areaValue = location
    ? `${location.city ?? 'Madrid'} · ${location.postcode || '—'}`
    : defaultAddress
      ? `${defaultAddress.city} · ${defaultAddress.postcode || '—'}`
      : status === 'requesting'
        ? (lang === 'en' ? 'Locating…' : 'Localizando…')
        : (lang === 'en' ? 'Set your location' : 'Elegir ubicación');

  return (
    <View style={{ backgroundColor: colors.brand.DEFAULT, paddingTop: insets.top }}>
      {/* RN keeps a stack of StatusBar entries and applies the last mounted,
       *  restoring the previous on unmount — so this reverts to the root
       *  layout's dark-on-linen the moment a non-header screen takes over. */}
      <StatusBar style="light" backgroundColor={colors.brand.DEFAULT} />

      {/* ── Control row ──────────────────────────────────── */}
      <View
        style={{
          height: 60,
          paddingHorizontal: 12,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {/* Menu — the drawer's trigger, in web's position. */}
        <Pressable
          onPress={() => setNavOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t('nav.open_menu')}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: 'rgba(255,255,255,0.10)',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Menu size={18} color="#fff" strokeWidth={2.25} />
        </Pressable>

        {/* Cesto C-mark — back to the top of the shop, as on web. The drawer
         *  moved to the menu button beside it. */}
        <Pressable
          onPress={() => router.push('/(tabs)' as never)}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityLabel="Cesto"
          style={{ width: 38, height: 38, borderRadius: 12, overflow: 'hidden' }}
        >
          <Image
            source={require('../../assets/cesto-icon-c-1.png')}
            style={{ width: 40, height: 40, marginLeft: -1, marginTop: -1 }}
            resizeMode="cover"
          />
        </Pressable>

        {/* Search — white pill with the blue submit disc, web's shape. The
         *  real input lives on the search tab, so this is a tap target. */}
        {showSearch ? (
          <Pressable
            onPress={() => router.push('/(tabs)/search')}
            accessibilityRole="search"
            style={{
              flex: 1,
              height: 42,
              backgroundColor: '#fff',
              borderRadius: 999,
              paddingLeft: 14,
              paddingRight: 4,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Text
              style={{ flex: 1, fontSize: 13, color: colors.muted, letterSpacing: -0.2 }}
              numberOfLines={1}
            >
              {t('home.search')}
            </Text>
            <View
              style={{
                width: 34, height: 34, borderRadius: 17,
                backgroundColor: colors.brand.DEFAULT,
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Search size={16} color="#fff" strokeWidth={2.25} />
            </View>
          </Pressable>
        ) : (
          <View style={{ flex: 1 }} />
        )}

        <HeaderAction
          onPress={() => router.push('/inbox')}
          badge={unreadCount}
          badgeColor={colors.amber.deep}
          accessibilityLabel={lang === 'en' ? 'Notifications' : 'Notificaciones'}
        >
          <Bell size={16} color="#fff" strokeWidth={2} />
        </HeaderAction>

        <HeaderAction
          onPress={() => router.push('/cart')}
          badge={itemCount}
          badgeColor={colors.amber.deep}
          accessibilityLabel={lang === 'en' ? 'Cart' : 'Carrito'}
        >
          <ShoppingBag size={16} color="#fff" strokeWidth={2} />
        </HeaderAction>
      </View>

      {/* ── Location row ─────────────────────────────────── */}
      {showLocation && (
        <>
          <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.14)' }} />
          <Pressable
            onPress={() => router.push('/addresses' as never)}
            accessibilityRole="button"
            accessibilityLabel={`${areaLabel} — ${areaValue}`}
            style={({ pressed }) => ({
              height: 46,
              paddingHorizontal: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: pressed ? 'rgba(255,255,255,0.08)' : 'transparent',
            })}
          >
            <View
              style={{
                width: 32, height: 32, borderRadius: 16,
                backgroundColor: 'rgba(255,255,255,0.15)',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <MapPin size={16} color="#fff" strokeWidth={2.25} />
            </View>
            {/* Question on the left, current answer on the right — the label
             *  is the prompt, not a caption stacked over the value. */}
            <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#fff' }}>
              {areaLabel}
            </Text>
            <View style={{
              marginLeft: 'auto', flexDirection: 'row', alignItems: 'center',
              gap: 4, minWidth: 0, flexShrink: 1,
            }}>
              <Text
                numberOfLines={1}
                style={{ fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.9)' }}
              >
                {areaValue}
              </Text>
              <ChevronDown size={16} color="#fff" strokeWidth={2.25} />
            </View>
          </Pressable>
        </>
      )}

      {/* Lives here rather than in a layout so every screen that already
       *  renders the header gets the drawer with it. It is a Modal, so it
       *  escapes this row's bounds. */}
      <SideNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
    </View>
  );
}
