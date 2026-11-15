import { Tabs, Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { LayoutDashboard, ClipboardList, Package, CalendarDays } from 'lucide-react-native';
import { colors } from '@/constants/colors';
import { usePartnerAccess } from '@/partner/usePartnerAccess';
import { usePartnerT } from '@/partner/lib/i18n';
import { useTabBarLayout } from '@/lib/tabBar';

/**
 * Partner mode: its own tab bar, replacing the customer one entirely.
 *
 * Web runs the dashboard off a persistent sidebar with five groups and fifteen
 * destinations. None of that survives the trip to a phone, and sharing the
 * customer tab bar would give every tab two meanings depending on who is
 * looking — a shopkeeper checking orders is in a different job from a shopper.
 * So partner is a separate mode with a separate bar, entered from the profile
 * screen and left through "More".
 *
 * Four tabs, not fifteen: Today / Orders / Products / Deliveries, the four
 * things a shop actually touches in a day. Everything else lives in
 * PartnerNavDrawer behind the app bar's menu button, grouped as web groups it.
 *
 * A "More" tab used to hold that slot. A tab is a place you go, and More was a
 * way through to somewhere else — it cost the bar a real destination to say
 * so. Deliveries took the slot; Packs and Subscribers stayed in the drawer,
 * because the queue is the daily half of rashan and the other two are setup.
 *
 * The gate below mirrors web's PartnerProtectedRoute exactly — same four
 * states, same destinations.
 */
export default function PartnerLayout() {
  const access = usePartnerAccess();
  const t = usePartnerT();
  // Above the redirects on purpose: hooks cannot run after a conditional
  // return, and every branch below this point may bail out early.
  const tabBar = useTabBarLayout();

  if (access.state === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface.linen }}>
        <ActivityIndicator color={colors.brand.DEFAULT} />
      </View>
    );
  }

  // No returnTo: expo-router has no query string to carry one through, and a
  // partner who signs in lands on the storefront and taps through again. Worth
  // revisiting if that proves annoying in testing.
  if (access.state === 'unauthenticated') return <Redirect href="/(auth)/login" />;

  // Signed in, but this account has no store. Back to shopping — partner chrome
  // should not exist for someone who cannot use it.
  if (access.state === 'not-a-partner') return <Redirect href="/(tabs)" />;

  // Admin-issued temporary password. Rotate before any partner screen renders.
  if (access.state === 'must-rotate-password') return <Redirect href="/change-password" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Same edge-to-edge allowance as the customer bar; see useTabBarLayout.
        tabBarHideOnKeyboard: true,
        tabBarShowLabel: tabBar.showLabel,
        tabBarStyle: {
          ...tabBar.style,
          backgroundColor: colors.surface.cream,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
          elevation: 0,
          shadowColor: '#0F172A',
          shadowOpacity: 0.04,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -2 },
        },
        tabBarActiveTintColor: colors.brand.DEFAULT,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontWeight: '600',
          letterSpacing: -0.2,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.today'),
          tabBarIcon: ({ color, size, focused }) => (
            <LayoutDashboard size={size} color={color} strokeWidth={1.75} fill={focused ? color : 'none'} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('nav.orders'),
          tabBarIcon: ({ color, size, focused }) => (
            <ClipboardList size={size} color={color} strokeWidth={1.75} fill={focused ? color : 'none'} />
          ),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: t('nav.products'),
          tabBarIcon: ({ color, size, focused }) => (
            <Package size={size} color={color} strokeWidth={1.75} fill={focused ? color : 'none'} />
          ),
        }}
      />
      <Tabs.Screen
        name="deliveries"
        options={{
          title: t('nav.deliveries'),
          tabBarIcon: ({ color, size, focused }) => (
            <CalendarDays size={size} color={color} strokeWidth={1.75} fill={focused ? color : 'none'} />
          ),
        }}
      />
    </Tabs>
  );
}
