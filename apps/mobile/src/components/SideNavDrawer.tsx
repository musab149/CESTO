/**
 * Side navigation drawer — the app's port of web's SideNavDrawer
 * (apps/web/src/layouts/CustomerLayout.tsx, the `lg:hidden` panel behind the
 * hamburger). Same sections, same order, same row vocabulary.
 *
 * Opened from the Cesto mark in the app bar. Web opens it from a hamburger
 * because its logo is a home link; here the tab bar already carries Home, so
 * the mark is free to be the menu affordance and the drawer still lists Home
 * under Shop.
 *
 * Divergences from web, all because of what this app does and does not ship:
 *   · No "Manage store" card — that is the multi-vendor partner dashboard,
 *     which this app leaves out.
 *   · No Bio row in Shop: no route here.
 *   · The Cesto Business rows are external links. Web's Tier 0 trade strip is
 *     desktop-only, so the drawer is its home on a phone — but none of its
 *     three destinations has a screen in this app, so they open the site.
 *   · The panel is a Modal rather than a fixed aside, so Android's back
 *     button closes it for free.
 */
import {
  Modal, View, Text, Pressable, ScrollView, Image, Animated, Dimensions,
  Easing, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  X, ChevronRight, Home, Grid3x3, Globe, Award, Sparkles, ClipboardList,
  Heart, MapPin, User as UserIcon, HelpCircle, MessageCircle, LogOut, Tag,
  Check, ExternalLink, Package, Store,
} from 'lucide-react-native';
import {
  resolveImageUrl, useSetPricingMode, type PricingMode,
} from '@grocery-app/shared';
import { colors } from '../constants/colors';
import { BUSINESS_LINKS } from '../constants/webLinks';
import { useLanguageStore } from '../stores/languageStore';
import { useAuthStore } from '../stores/authStore';
import { useFavoritesStore } from '../stores/favoritesStore';
import { useIsBusinessCustomer } from '../lib/priceTone';

const SCREEN_WIDTH = Dimensions.get('window').width;
const PANEL_WIDTH = Math.min(340, SCREEN_WIDTH * 0.86);

const LANGUAGES = [
  { code: 'es' as const, flag: '🇪🇸', label: 'Español' },
  { code: 'en' as const, flag: '🇬🇧', label: 'English' },
];

export default function SideNavDrawer({
  open, onClose,
}: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { lang, setLang, t } = useLanguageStore();
  const label = (en: string, es: string) => (lang === 'en' ? en : es);

  const { user, isAuthenticated, logout } = useAuthStore();
  const setUser = useAuthStore((s) => s.setUser);
  const favoritesCount = useFavoritesStore((s) => s.productIds.length);
  const isBusiness = useIsBusinessCustomer();
  const setMode = useSetPricingMode();
  const pricingMode: PricingMode = user?.pricing_mode ?? 'retail';

  // `mounted` outlives `open` by one animation, so the panel slides out
  // instead of vanishing the moment the flag flips.
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

  // Close first, then navigate. The panel is still on screen through its exit
  // animation, so the next screen mounts underneath it rather than after a
  // blank frame.
  const go = (path: string) => { onClose(); router.push(path as never); };

  const openExternal = (url: string) => {
    onClose();
    Linking.openURL(url).catch(() => { /* no browser, or the URL was rejected */ });
  };

  const choosePricing = async (mode: PricingMode) => {
    if (mode === pricingMode || setMode.isPending) return;
    try {
      const updated = await setMode.mutateAsync(mode);
      // The mutation returns the patched user; keep the store and the request
      // header in step rather than waiting for the next hydrate.
      if (updated && typeof updated === 'object' && 'pricing_mode' in updated) {
        setUser({ ...(user ?? {}), ...(updated as object) } as never);
      } else if (user) {
        setUser({ ...user, pricing_mode: mode });
      }
    } catch {
      // The switch simply stays where it was. The profile tab's sheet is the
      // place that reports why, and duplicating a toast from inside a Modal
      // would render it behind the panel anyway.
    }
  };

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : '';
  const avatar = user?.avatar_url ? resolveImageUrl(user.avatar_url, 'logo') : null;

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
        {/* Backdrop */}
        <Animated.View
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15,23,42,0.5)',
            opacity: progress,
          }}
        >
          <Pressable
            style={{ flex: 1 }}
            onPress={onClose}
            accessibilityLabel={label('Close menu', 'Cerrar menú')}
          />
        </Animated.View>

        {/* Panel */}
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
              <View style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <Pressable
                  onPress={() => go('/(tabs)')}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
                >
                  <Image
                    source={require('../../assets/cesto-icon-c-1.png')}
                    style={{ width: 40, height: 40, borderRadius: 12 }}
                    resizeMode="cover"
                  />
                  <Text style={{
                    fontSize: 22, fontWeight: '600', color: '#fff', letterSpacing: -0.5,
                  }}>
                    Cesto
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  accessibilityLabel={label('Close', 'Cerrar')}
                  style={{
                    width: 36, height: 36, borderRadius: 18,
                    backgroundColor: 'rgba(255,255,255,0.15)',
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <X size={17} color="#fff" strokeWidth={2.25} />
                </Pressable>
              </View>

              {/* Account block — signed in vs guest */}
              <View style={{ marginTop: 18 }}>
                {isAuthenticated && user ? (
                  <Pressable
                    onPress={() => go('/(tabs)/profile')}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)',
                      paddingHorizontal: 12, paddingVertical: 10,
                    }}
                  >
                    <View style={{
                      width: 40, height: 40, borderRadius: 20, overflow: 'hidden',
                      backgroundColor: 'rgba(255,255,255,0.18)',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {avatar ? (
                        <Image source={{ uri: avatar }} style={{ width: '100%', height: '100%' }} />
                      ) : (
                        <Text style={{ fontSize: 13, fontWeight: '800', color: '#fff' }}>
                          {initials}
                        </Text>
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        numberOfLines={1}
                        style={{ fontSize: 13.5, fontWeight: '700', color: '#fff' }}
                      >
                        {user.name}
                      </Text>
                      <Text style={{
                        fontSize: 11.5, color: 'rgba(255,255,255,0.7)', marginTop: 2,
                      }}>
                        {label('View profile', 'Ver perfil')}
                      </Text>
                    </View>
                    <ChevronRight size={16} color="rgba(255,255,255,0.8)" strokeWidth={2} />
                  </Pressable>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Pressable
                      onPress={() => go('/(auth)/login')}
                      style={{
                        flex: 1, height: 44, borderRadius: 22, backgroundColor: '#fff',
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Text style={{
                        fontSize: 13, fontWeight: '700', color: colors.brand.DEFAULT,
                      }}>
                        {label('Sign in', 'Iniciar sesión')}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => go('/(auth)/register')}
                      style={{
                        flex: 1, height: 44, borderRadius: 22,
                        borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
                        alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>
                        {label('Sign up', 'Registrarse')}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>

            {/* ── Body ─────────────────────────────────────── */}
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingVertical: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {/* Price mode — businesses only. Above Shop deliberately: it
                  changes every price in the catalogue, so it is a mode, not a
                  destination. */}
              {isBusiness && (
                <DrawerSection title={label('Prices', 'Precios')}>
                  <View style={{ paddingHorizontal: 12 }}>
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', padding: 4,
                      borderRadius: 999, backgroundColor: colors.surface.cream,
                      borderWidth: 1, borderColor: colors.border,
                    }}>
                      {(['retail', 'b2b'] as const).map((m) => {
                        const active = pricingMode === m;
                        return (
                          <Pressable
                            key={m}
                            disabled={setMode.isPending}
                            onPress={() => choosePricing(m)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active, disabled: setMode.isPending }}
                            style={{
                              flex: 1, height: 36, borderRadius: 999,
                              alignItems: 'center', justifyContent: 'center',
                              backgroundColor: active ? colors.brand.DEFAULT : 'transparent',
                              opacity: setMode.isPending ? 0.6 : 1,
                            }}
                          >
                            <Text style={{
                              fontSize: 12.5, fontWeight: '700',
                              color: active ? '#fff' : colors.gray,
                            }}>
                              {m === 'b2b'
                                ? label('Business', 'Empresa')
                                : label('Regular', 'Normal')}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Text style={{
                      fontSize: 11.5, color: colors.muted, marginTop: 6, paddingHorizontal: 4,
                    }}>
                      {pricingMode === 'b2b'
                        ? label('Showing wholesale prices.', 'Mostrando precios mayoristas.')
                        : label('Showing regular prices.', 'Mostrando precios normales.')}
                    </Text>
                  </View>
                </DrawerSection>
              )}

              {/* Cesto Business — web's Tier 0 trade strip is desktop-only, so
                  the drawer is its home on a phone.

                  All three rows leave the app; the website carries the full
                  pitch and the complete application. The app's own cut-down
                  wholesale form is gone — the profile tab lists these same
                  three now, and a lesser second form competing with the real
                  one was worse than no form. */}
              <DrawerSection title="Cesto Business">
                {BUSINESS_LINKS.map((l) => (
                  <DrawerItem
                    key={l.key}
                    icon={l.key === 'wholesale'
                      ? <Tag size={17} color={colors.gray} strokeWidth={1.75} />
                      : l.key === 'supplier'
                        ? <Package size={17} color={colors.gray} strokeWidth={1.75} />
                        : <Store size={17} color={colors.gray} strokeWidth={1.75} />}
                    label={label(l.label_en, l.label_es)}
                    external
                    onPress={() => openExternal(l.url)}
                  />
                ))}
              </DrawerSection>

              {isAuthenticated && (
                <DrawerSection title={label('You', 'Tú')}>
                  <DrawerItem
                    icon={<ClipboardList size={17} color={colors.gray} strokeWidth={1.75} />}
                    label={label('My orders', 'Mis pedidos')}
                    onPress={() => go('/orders')}
                  />
                  <DrawerItem
                    icon={<Heart size={17} color={colors.gray} strokeWidth={1.75} />}
                    label={label('My favourites', 'Mis favoritos')}
                    badge={favoritesCount > 0 ? String(favoritesCount) : undefined}
                    onPress={() => go('/favorites')}
                  />
                  <DrawerItem
                    icon={<MapPin size={17} color={colors.gray} strokeWidth={1.75} />}
                    label={label('Addresses', 'Direcciones')}
                    onPress={() => go('/addresses')}
                  />
                  <DrawerItem
                    icon={<UserIcon size={17} color={colors.gray} strokeWidth={1.75} />}
                    label={label('Account', 'Cuenta')}
                    onPress={() => go('/(tabs)/profile')}
                  />
                </DrawerSection>
              )}

              <DrawerSection title={label('Shop', 'Comprar')}>
                <DrawerItem
                  icon={<Home size={17} color={colors.gray} strokeWidth={1.75} />}
                  label={label('Home', 'Inicio')}
                  onPress={() => go('/(tabs)')}
                />
                <DrawerItem
                  icon={<Grid3x3 size={17} color={colors.gray} strokeWidth={1.75} />}
                  label={label('Categories', 'Categorías')}
                  onPress={() => go('/(tabs)/categories')}
                />
                <DrawerItem
                  icon={<Globe size={17} color={colors.gray} strokeWidth={1.75} />}
                  label={label('Origins', 'Orígenes')}
                  onPress={() => go('/origins')}
                />
                <DrawerItem
                  icon={<Award size={17} color={colors.gray} strokeWidth={1.75} />}
                  label={label('Brands', 'Marcas')}
                  onPress={() => go('/brands')}
                />
                <DrawerItem
                  icon={<Sparkles size={17} color={colors.gray} strokeWidth={1.75} />}
                  label="Rashan"
                  emoji="✨"
                  highlight
                  onPress={() => go('/(tabs)/rashan')}
                />
              </DrawerSection>

              <DrawerSection title={label('Help', 'Ayuda')}>
                <DrawerItem
                  icon={<HelpCircle size={17} color={colors.gray} strokeWidth={1.75} />}
                  label={label('FAQ', 'Preguntas frecuentes')}
                  onPress={() => go('/faq')}
                />
                <DrawerItem
                  icon={<MessageCircle size={17} color={colors.gray} strokeWidth={1.75} />}
                  label={label('Contact support', 'Contactar soporte')}
                  onPress={() => go('/contact')}
                />
              </DrawerSection>

              <DrawerSection title={label('Language', 'Idioma')}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 }}>
                  {LANGUAGES.map((l) => {
                    const active = lang === l.code;
                    return (
                      <Pressable
                        key={l.code}
                        onPress={() => setLang(l.code)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={{
                          flex: 1, height: 40, borderRadius: 999,
                          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                          backgroundColor: active ? colors.brand.DEFAULT : colors.surface.white,
                          borderWidth: 1,
                          borderColor: active ? colors.brand.DEFAULT : colors.border,
                        }}
                      >
                        <Text style={{ fontSize: 15 }}>{l.flag}</Text>
                        <Text style={{
                          fontSize: 12.5, fontWeight: '700',
                          color: active ? '#fff' : colors.ink,
                        }}>
                          {l.label}
                        </Text>
                        {active && <Check size={12} color="#fff" strokeWidth={2.5} />}
                      </Pressable>
                    );
                  })}
                </View>
              </DrawerSection>

              {isAuthenticated && (
                <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4 }}>
                  <Pressable
                    onPress={() => { onClose(); logout(); }}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      height: 46, paddingHorizontal: 12, borderRadius: 14,
                    }}
                  >
                    <LogOut size={17} color={colors.danger} strokeWidth={1.75} />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: colors.danger }}>
                      {label('Logout', 'Cerrar sesión')}
                    </Text>
                  </Pressable>
                </View>
              )}

              {/* A free-delivery teaser sat here. Removed on 2026-09-25 with
                  the feature — there is no threshold to advertise. */}
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
  icon, label, onPress, badge, emoji, highlight, external,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  badge?: string;
  emoji?: string;
  highlight?: boolean;
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
        height: 46, paddingHorizontal: 12, borderRadius: 14,
        backgroundColor: pressed ? colors.surface.white : 'transparent',
      })}
    >
      <View style={{
        width: 28, height: 28, borderRadius: 10,
        backgroundColor: colors.surface.white,
        borderWidth: 1, borderColor: colors.border,
        alignItems: 'center', justifyContent: 'center',
      }}>
        {emoji ? <Text style={{ fontSize: 14 }}>{emoji}</Text> : icon}
      </View>
      <Text
        numberOfLines={1}
        style={{
          flex: 1, fontSize: 13.5, fontWeight: '700',
          color: colors.ink, letterSpacing: -0.2,
        }}
      >
        {label}
      </Text>
      {highlight && (
        <View style={{
          paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
          backgroundColor: colors.amber.DEFAULT,
        }}>
          <Text style={{ fontSize: 9, fontWeight: '800', color: colors.ink, letterSpacing: 1 }}>
            NEW
          </Text>
        </View>
      )}
      {badge && (
        <View style={{
          paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999,
          backgroundColor: colors.brand.mist,
        }}>
          <Text style={{ fontSize: 10.5, fontWeight: '700', color: colors.brand.DEFAULT }}>
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
