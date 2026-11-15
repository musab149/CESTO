import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Modal, View, Text, Pressable, ScrollView, Image, Animated, Dimensions,
  Easing, Linking, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  X, ChevronRight, ExternalLink, Store as StoreIcon, Truck, ShoppingBasket,
  Users, Grid3X3, Monitor, KeyRound, ShoppingBag,
} from 'lucide-react-native';
import { colors } from '@/constants/colors';
import { useAuthStore } from '@/stores/authStore';
import { usePartnerT } from '@/partner/lib/i18n';
import { usePartnerStore } from '@/partner/usePartnerAccess';
import { useDialog } from '@/components/AppDialog';

/**
 * Partner mode's navigation drawer — the destinations that do not earn a tab.
 *
 * This replaced a "More" tab. A tab is a place you go; these are ways through
 * to somewhere else, and spending a quarter of the bar on a menu cost partner
 * mode its fourth real destination. The drawer takes the customer side's
 * shape (SideNavDrawer) deliberately: same slide, same brand header, same row
 * treatment, so the two modes do not feel like two different apps.
 *
 * Grouped as web's sidebar groups them, minus anything now reachable from the
 * bar. Deliveries is a tab and so is absent here — a destination in two places
 * teaches people to distrust both.
 */

const SCREEN_WIDTH = Dimensions.get('window').width;
const PANEL_WIDTH = Math.min(340, SCREEN_WIDTH * 0.86);

const WEB_DASHBOARD = 'https://www.cestoshop.com/partner/dashboard';

export default function PartnerNavDrawer({
  open, onClose,
}: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const dialog = useDialog();
  const t = usePartnerT();
  const store = usePartnerStore();
  const user = useAuthStore((s) => s.user);

  // `mounted` outlives `open` by one animation so the panel slides out rather
  // than vanishing the moment the flag flips. Same trick SideNavDrawer uses.
  const [mounted, setMounted] = useState(open);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0, duration: 180, easing: Easing.in(Easing.cubic), useNativeDriver: true,
      }).start(({ finished }) => { if (finished) setMounted(false); });
    }
  }, [open, progress]);

  // Close first, then navigate: the panel is still on screen through its exit
  // animation, so the next screen mounts underneath it rather than after a
  // blank frame.
  const go = (path: string) => { onClose(); router.push(path as never); };

  const openWeb = (path: string) => {
    onClose();
    Linking.openURL(path).catch(() => dialog.alert(t('more.desktopOnly'), WEB_DASHBOARD));
  };

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-PANEL_WIDTH, 0],
  });

  return (
    <Modal
      transparent
      visible={mounted}
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1 }}>
        <Animated.View
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15,23,42,0.5)',
            opacity: progress,
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={t('drawer.close')} />
        </Animated.View>

        <Animated.View
          style={{
            position: 'absolute', top: 0, left: 0, bottom: 0,
            width: PANEL_WIDTH,
            backgroundColor: colors.surface.linen,
            transform: [{ translateX }],
            shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20,
            shadowOffset: { width: 4, height: 0 }, elevation: 16,
          }}
          accessibilityViewIsModal
        >
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
            {/* ── Brand header ─────────────────────────────── */}
            <View style={{
              backgroundColor: colors.brand.DEFAULT,
              paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Pressable
                  onPress={() => go('/(partner)')}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}
                >
                  <Image
                    source={require('../../../assets/cesto-icon-c-1.png')}
                    style={{ width: 40, height: 40, borderRadius: 12 }}
                    resizeMode="cover"
                  />
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{ fontSize: 19, fontWeight: '600', color: '#fff', letterSpacing: -0.4 }}
                    >
                      {store?.name ?? 'Cesto'}
                    </Text>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: 'rgba(255,255,255,0.75)', letterSpacing: 0.6 }}>
                      {t('drawer.partnerMode')}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  accessibilityLabel={t('drawer.close')}
                  style={{
                    width: 36, height: 36, borderRadius: 18,
                    backgroundColor: 'rgba(255,255,255,0.15)',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <X size={17} color="#fff" strokeWidth={2.25} />
                </Pressable>
              </View>

              {!!user?.email && (
                <View style={{
                  marginTop: 16, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14,
                  backgroundColor: 'rgba(255,255,255,0.12)',
                }}>
                  <Text style={{ fontSize: 10.5, fontWeight: '700', color: 'rgba(255,255,255,0.7)', letterSpacing: 0.6 }}>
                    {t('more.signedInAs')}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: '#fff', marginTop: 1 }}>
                    {user.email}
                  </Text>
                </View>
              )}
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
              <DrawerSection title={t('more.section.store')}>
                <DrawerItem
                  icon={<StoreIcon size={15} color={colors.gray} strokeWidth={2} />}
                  label={t('nav.store')}
                  onPress={() => go('/partner-store')}
                />
                <DrawerItem
                  icon={<Truck size={15} color={colors.gray} strokeWidth={2} />}
                  label={t('nav.riders')}
                  onPress={() => go('/partner-riders')}
                />
              </DrawerSection>

              {/* Deliveries is absent on purpose — it is a tab now. */}
              <DrawerSection title={t('more.section.rashan')}>
                <DrawerItem
                  icon={<ShoppingBasket size={15} color={colors.gray} strokeWidth={2} />}
                  label={t('packs.title')}
                  onPress={() => go('/partner-rashan-packs')}
                />
                <DrawerItem
                  icon={<Users size={15} color={colors.gray} strokeWidth={2} />}
                  label={t('rashanSubs.title')}
                  onPress={() => go('/partner-rashan-subscribers')}
                />
              </DrawerSection>

              <DrawerSection title={t('more.section.catalogue')}>
                <DrawerItem
                  icon={<Grid3X3 size={15} color={colors.gray} strokeWidth={2} />}
                  label={t('catalogue.title')}
                  onPress={() => go('/partner-catalogue')}
                />
                <DrawerItem
                  icon={<Monitor size={15} color={colors.gray} strokeWidth={2} />}
                  label={t('more.duplicates')}
                  badge={t('more.desktopOnly')}
                  external
                  onPress={() => openWeb(WEB_DASHBOARD.replace('/dashboard', '/products/duplicates'))}
                />
                <DrawerItem
                  icon={<Monitor size={15} color={colors.gray} strokeWidth={2} />}
                  label={t('more.import')}
                  badge={t('more.desktopOnly')}
                  external
                  onPress={() => openWeb(WEB_DASHBOARD.replace('/dashboard', '/products'))}
                />
              </DrawerSection>

              <DrawerSection title={t('more.section.account')}>
                <DrawerItem
                  icon={<KeyRound size={15} color={colors.gray} strokeWidth={2} />}
                  label={t('nav.changePassword')}
                  onPress={() => go('/change-password')}
                />
                <DrawerItem
                  icon={<ShoppingBag size={15} color={colors.gray} strokeWidth={2} />}
                  label={t('nav.exit')}
                  onPress={() => { onClose(); router.replace('/(tabs)' as never); }}
                />
              </DrawerSection>
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ paddingTop: 12, paddingBottom: 4 }}>
      <Text style={{
        paddingHorizontal: 20, paddingBottom: 6,
        fontSize: 10.5, fontWeight: '800', color: colors.muted,
        letterSpacing: 1.6, textTransform: 'uppercase',
      }}>
        {title}
      </Text>
      <View style={{ gap: 2, paddingHorizontal: 8 }}>{children}</View>
    </View>
  );
}

function DrawerItem({
  icon, label, onPress, badge, external,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  badge?: string;
  /** Leaves the app for the browser. Swaps the chevron so the row does not
   *  promise in-app navigation it is not going to do. */
  external?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={external ? 'link' : 'button'}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12,
        minHeight: 46, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14,
        backgroundColor: pressed ? colors.surface.white : 'transparent',
      })}
    >
      <View style={{
        width: 28, height: 28, borderRadius: 10,
        backgroundColor: colors.surface.white,
        borderWidth: 1, borderColor: colors.border,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </View>
      <Text
        numberOfLines={1}
        style={{ flex: 1, fontSize: 13.5, fontWeight: '700', color: colors.ink, letterSpacing: -0.2 }}
      >
        {label}
      </Text>
      {!!badge && (
        <View style={{
          paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
          backgroundColor: colors.surface.sand,
        }}>
          <Text style={{ fontSize: 9, fontWeight: '800', color: colors.muted, letterSpacing: 0.4 }}>
            {badge}
          </Text>
        </View>
      )}
      {external
        ? <ExternalLink size={13} color={colors.muted} strokeWidth={2} />
        : <ChevronRight size={14} color={colors.muted} strokeWidth={2} />}
    </Pressable>
  );
}
