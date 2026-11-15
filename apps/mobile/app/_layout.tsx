import { useEffect, useRef, useState } from 'react';
import { Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertOctagon, RefreshCw } from 'lucide-react-native';
import { Stack, router, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryCache, MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { ApiError } from '@grocery-app/shared';
import { refreshPushTokenIfGranted } from '@/components/PushPermissionSheet';
import {
  useFonts,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  DMSans_800ExtraBold,
} from '@expo-google-fonts/dm-sans';
import { bootstrapApi } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import Splash from '@/components/Splash';
import { ToastProvider } from '@/components/Toast';
import BlockedAccountSheet from '@/components/BlockedAccountSheet';
import { DialogProvider } from '@/components/AppDialog';
import MaintenanceBanner from '@/components/MaintenanceBanner';
import { colors } from '@/constants/colors';

/**
 * Expo Router auto-mounts this as the route-level error boundary. Any uncaught
 * render exception in a screen surfaces here instead of crashing to a blank
 * white view. The `retry` callback re-mounts the offending subtree.
 */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const reference = `ERR-${Date.now().toString(36).toUpperCase()}`;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top', 'bottom']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <View
          style={{
            width: 80, height: 80, borderRadius: 24,
            backgroundColor: colors.dangerBg,
            alignItems: 'center', justifyContent: 'center',
            marginBottom: 20,
          }}
        >
          <AlertOctagon size={32} color={colors.danger} strokeWidth={1.75} />
        </View>

        <View
          style={{
            backgroundColor: colors.danger,
            paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999,
            marginBottom: 14,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 10.5, fontWeight: '800', letterSpacing: 1.5 }}>
            ERROR 500
          </Text>
        </View>

        <Text style={{ fontSize: 24, fontWeight: '800', color: colors.ink, textAlign: 'center', marginBottom: 10 }}>
          Something broke
        </Text>
        <Text style={{ fontSize: 14, lineHeight: 20, color: colors.gray, textAlign: 'center', maxWidth: 320, marginBottom: 16 }}>
          The app hit an unexpected error. Try again — if it keeps happening, share the reference code below with support.
        </Text>

        <View
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            backgroundColor: colors.surface.cream,
            borderWidth: 1, borderColor: colors.border,
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
            marginBottom: 28,
          }}
        >
          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.gray, letterSpacing: 1.2 }}>REF</Text>
          <Text style={{ fontSize: 12, color: colors.ink, fontFamily: 'monospace' }}>{reference}</Text>
        </View>

        <Pressable
          onPress={retry}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            height: 52, paddingHorizontal: 24, borderRadius: 12,
            backgroundColor: colors.brand.DEFAULT,
          }}
        >
          <RefreshCw size={16} color="#fff" strokeWidth={1.75} />
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Try again</Text>
        </Pressable>

        {__DEV__ && (
          <Text style={{ marginTop: 24, fontSize: 11, color: colors.muted, textAlign: 'center', maxWidth: 320 }}>
            {error.message}
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}

// Set DM Sans as the default React Native <Text> font so existing screens that
// don't explicitly opt into a font family pick it up. Runs once at module load.
const TextAny = Text as unknown as { defaultProps?: { style?: unknown } };
TextAny.defaultProps = TextAny.defaultProps || {};
TextAny.defaultProps.style = [
  { fontFamily: 'DMSans_400Regular' },
  (TextAny.defaultProps as any).style,
];

/**
 * 5xx responses are server outages — bounce to /server-error with a generated
 * reference instead of letting screens render half-broken loading states.
 * Per-query onError still fires first, so callers can still handle their own.
 */
function redirectOnServerError(err: unknown, opts: { isQuery: boolean }) {
  if (!(err instanceof ApiError)) return;
  // 403 is not a server fault, and /server-error tells the customer to retry —
  // exactly the wrong advice when the answer is "this isn't yours to open".
  // 401 is deliberately not handled here: the api client's onUnauthorized
  // already force-logs-out and clears the cache.
  //
  // QUERIES ONLY. On a GET, 403 does mean "not yours to open", and bouncing to
  // /forbidden is right. On a MUTATION it usually means the server refused
  // this particular action for a reason it just explained in the message —
  // "you can review a product once it has been delivered to you" — and
  // throwing the customer onto an access-denied screen loses both the
  // explanation and whatever they had typed. Mutations surface their own 403.
  if (err.status === 403) {
    if (opts.isQuery) router.push('/forbidden');
    return;
  }
  if (err.status >= 500 && err.status < 600) {
    const ref = `ERR-${Date.now().toString(36).toUpperCase()}`;
    router.push({ pathname: '/server-error', params: { ref } });
  }
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  queryCache: new QueryCache({ onError: (err) => redirectOnServerError(err, { isQuery: true }) }),
  mutationCache: new MutationCache({ onError: (err) => redirectOnServerError(err, { isQuery: false }) }),
});

bootstrapApi(
  () => {
    useAuthStore.getState().forceLogout();
    queryClient.clear();
  },
  // Blocked mid-session: end it, then leave the reason on the store so the
  // sheet can explain rather than the app simply going quiet.
  (reason) => {
    useAuthStore.getState().forceLogout();
    queryClient.clear();
    useAuthStore.getState().setBlockedNotice(reason ?? '');
  },
);

/**
 * Show incoming push notifications while the app is in the foreground.
 * The OS suppresses the system banner by default when the app is active,
 * which would make users think notifications don't work at all.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Route a tap on a notification to the right screen. The API always sets
 * `data.type`; type-specific fields (order_id, subscription_id, product_id)
 * are folded in. An explicit `data.deeplink` overrides everything so admin
 * broadcasts can point anywhere.
 */
function routeFromNotificationData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  const deeplink = typeof data.deeplink === 'string' ? data.deeplink : null;
  if (deeplink && deeplink.startsWith('/')) {
    router.push(deeplink as never);
    return;
  }
  const type = typeof data.type === 'string' ? data.type : '';
  const orderId = typeof data.order_id === 'string' ? data.order_id : null;
  const subId = typeof data.subscription_id === 'string' ? data.subscription_id : null;
  if (type.startsWith('order_') && orderId) {
    router.push(`/order/${orderId}` as never);
    return;
  }
  if (type === 'admin_subscription_paused' && subId) {
    router.push('/rashan/subscription' as never);
    return;
  }
  // promo_banner, admin_broadcast, or anything else — dump into the inbox.
  router.push('/inbox' as never);
}

export default function RootLayout() {
  const [splashDone, setSplashDone] = useState(false);
  const [navReady, setNavReady] = useState(false);
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    DMSans_800ExtraBold,
  });

  const onboardingHydrated = useOnboardingStore((s) => s.hydrated);
  const hasCompletedOnboarding = useOnboardingStore((s) => s.hasCompletedOnboarding);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [authHydrated, setAuthHydrated] = useState(() =>
    useAuthStore.persist.hasHydrated(),
  );

  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => setAuthHydrated(true));
    useAuthStore.getState().hydrate().catch((err) => {
      console.error('Auth hydration failed:', err);
    });
    return unsub;
  }, []);

  // expo-router uses URL-based routing — on cold launch the URL is `/`, which
  // maps to (tabs)/index.tsx. `initialRouteName` on <Stack> only affects the
  // back-stack, not the entry route, so we redirect imperatively while the
  // splash overlay still covers the screen.
  const statesReady = onboardingHydrated && authHydrated;
  // Show onboarding only on first launch for unauthenticated users.
  // Once a user completes onboarding OR logs in, they skip straight to tabs.
  const showOnboarding = !isAuthenticated && !hasCompletedOnboarding;

  // The boot redirect must fire AT MOST ONCE per app session. Without this
  // guard, later state changes (e.g. isAuthenticated flipping after login)
  // would re-trigger the effect and bounce the user back to /onboarding.
  const bootRedirected = useRef(false);

  // Subscribe to NetInfo and bounce in/out of /offline on connectivity changes.
  // Mounted once at the root so it works regardless of which screen is active.
  // Typed as the router's own Href rather than a bare string: `usePathname()`
  // hands back a plain string, but with `typedRoutes` on, `router.replace`
  // only accepts a known route. The value always came from usePathname, so it
  // is a real route — the cast is at the point of capture, not of use.
  const lastOnlinePath = useRef<Parameters<typeof router.replace>[0]>('/');
  const currentPath = usePathname();
  useEffect(() => {
    if (currentPath && currentPath !== '/offline') {
      lastOnlinePath.current = currentPath as Parameters<typeof router.replace>[0];
    }
  }, [currentPath]);

  useEffect(() => {
    if (!navReady) return;
    const unsubscribe = NetInfo.addEventListener((state) => {
      const reachable = state.isConnected !== false && state.isInternetReachable !== false;
      if (!reachable) {
        if (currentPath !== '/offline') router.replace('/offline');
      } else if (currentPath === '/offline') {
        router.replace(lastOnlinePath.current || '/');
      }
    });
    return unsubscribe;
  }, [navReady, currentPath]);

  // Push tap listener — cold-launch tap + warm tap both route through here.
  useEffect(() => {
    if (!navReady) return;

    // Cold launch: if the app was opened by tapping a notification, route
    // to the target as soon as navigation is ready.
    Notifications.getLastNotificationResponseAsync().then((res) => {
      if (res?.notification) {
        const data = res.notification.request.content.data as Record<string, unknown> | undefined;
        routeFromNotificationData(data);
      }
    }).catch(() => { /* best-effort */ });

    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const data = res.notification.request.content.data as Record<string, unknown> | undefined;
      routeFromNotificationData(data);
    });
    return () => sub.remove();
  }, [navReady]);

  // Silently refresh the push token whenever an authenticated session mounts.
  // Handles the case where a user signed in on a new device, or reinstalled.
  useEffect(() => {
    if (!isAuthenticated) return;
    void refreshPushTokenIfGranted();
  }, [isAuthenticated]);

  useEffect(() => {
    if (!navReady || !statesReady) return;
    if (bootRedirected.current) return;
    bootRedirected.current = true;

    if (__DEV__) {
      console.log('[boot] gate', {
        isAuthenticated,
        hasCompletedOnboarding,
        showOnboarding,
      });
    }
    if (showOnboarding) {
      router.replace('/onboarding');
    }
  }, [navReady, statesReady]);

  // Hold the splash until fonts are loaded so the app never flashes the
  // system fallback before swapping to DM Sans.
  if (!fontsLoaded) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <DialogProvider>
          <StatusBar style="dark" backgroundColor={colors.surface.linen} />
          <View style={{ flex: 1, backgroundColor: colors.surface.linen }}>
          {/* Above the Stack so it shows on every screen, exactly like web's
              CustomerLayout. Renders nothing when maintenance mode is off. */}
          <MaintenanceBanner />
          {/* Renders only once the API has refused for a blocked account. */}
          <BlockedAccountSheet />
          <Stack
            screenOptions={{ headerShown: false }}
            screenListeners={{
              state: () => {
                if (!navReady) setNavReady(true);
              },
            }}
          >
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
            <Stack.Screen name="(auth)" options={{ presentation: 'modal' }} />
            <Stack.Screen name="product/[id]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="reviews/[id]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="category/[id]" />
            <Stack.Screen name="cart" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="checkout" />
            <Stack.Screen name="addresses" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="address-form" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="change-password" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="edit-profile" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="language" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="notifications" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="inbox" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="help" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="about" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="privacy" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="terms" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="orders" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="favorites" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="followed-stores" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="store/[slug]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="rashan/pack/[id]" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="rashan/checkout" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="rashan/subscription" options={{ animation: 'slide_from_right' }} />
            <Stack.Screen name="offline" options={{ animation: 'fade', gestureEnabled: false }} />
            <Stack.Screen name="server-error" options={{ animation: 'fade', gestureEnabled: false }} />
          </Stack>
          {!splashDone && <Splash onDone={() => setSplashDone(true)} />}
        </View>
        </DialogProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
