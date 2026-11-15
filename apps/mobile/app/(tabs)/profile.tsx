import { View, Text, ScrollView, Pressable, Image, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useIsPartner } from '@/partner/usePartnerAccess';
import { useState } from 'react';
import {
  LayoutDashboard,
  MapPin,
  Globe,
  Bell,
  HelpCircle,
  Briefcase,
  MessageCircle,
  MessagesSquare,
  Info,
  ChevronRight,
  LogOut,
  User,
  Package,
  Sparkles,
  ShoppingBasket,
  Star,
  ArrowRight,
  Shield,
  KeyRound,
  Heart,
  Pencil,
  FileText,
  Tag,
  Store,
  ExternalLink,
} from 'lucide-react-native';
import { colors } from '../../src/constants/colors';
import { useLanguageStore } from '../../src/stores/languageStore';
import { useAuthStore } from '../../src/stores/authStore';
import { useRashanSubscriptions, useOrders, resolveImageUrl } from '@grocery-app/shared';
import PricingModeSheet from '../../src/components/PricingModeSheet';
import { useIsBusinessCustomer, useIsB2bPricing } from '../../src/lib/priceTone';
import {
  BUSINESS_LINKS, SUPPORT_URLS, type BusinessLink,
} from '../../src/constants/webLinks';
import AppHeader from '../../src/components/AppHeader';

interface MenuItem {
  icon: typeof MapPin;
  label_en: string;
  label_es: string;
  hint_en: string;
  hint_es: string;
  tone: 'mint' | 'dune' | 'sand' | 'amber' | 'sage';
  onPress: () => void;
  /** Leaves the app for the browser. Swaps the chevron so the row does not
   *  promise in-app navigation it is not going to do. */
  external?: boolean;
}

const toneBg: Record<string, string> = {
  mint: colors.surface.mint,
  dune: colors.surface.dune,
  sand: colors.surface.sand,
  sage: colors.surface.sage,
  amber: colors.amber.mist,
};

const toneFg: Record<string, string> = {
  mint: colors.brand.deepest,
  dune: colors.charcoal,
  sand: colors.charcoal,
  sage: colors.brand.deepest,
  amber: colors.amber.deep,
};

function getInitials(name: string) {
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/* ───────── Guest card ───────── */
function GuestHero() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  return (
    <LinearGradient
      colors={[colors.surface.dune, colors.surface.linen, colors.surface.mint]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: 8, padding: 24, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)', marginBottom: 20 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.8)', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
        <Sparkles size={11} color={colors.brand.DEFAULT} strokeWidth={2.5} />
        <Text style={{ fontSize: 10, fontWeight: '700', color: colors.ink, letterSpacing: 2 }}>
          {lang === 'en' ? 'WELCOME' : 'BIENVENIDO'}
        </Text>
      </View>
      <Text style={{ fontSize: 26, fontWeight: '700', color: colors.ink, lineHeight: 32, letterSpacing: -0.6 }}>
        {lang === 'en' ? 'Join Cesto for faster\ncheckout and rewards' : 'Únete a Cesto para pagos\nmás rápidos y recompensas'}
      </Text>
      <Text style={{ fontSize: 13, color: colors.gray, marginTop: 8, lineHeight: 19 }}>
        {lang === 'en'
          ? 'Save addresses, track orders and build your monthly rashan pack.'
          : 'Guarda direcciones, sigue pedidos y crea tu pack mensual de rashan.'}
      </Text>
      <Pressable
        onPress={() => router.push('/(auth)/login')}
        style={({ pressed }) => ({
          marginTop: 18,
          height: 52,
          borderRadius: 14,
          backgroundColor: colors.ink,
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'row',
          gap: 8,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>
          {lang === 'en' ? 'Log in or Sign up' : 'Iniciar sesión o Registrarse'}
        </Text>
        <ArrowRight size={15} color="#fff" strokeWidth={2.5} />
      </Pressable>
    </LinearGradient>
  );
}

/* ───────── Member hero card ───────── */
function MemberHero({ name, email, avatarUrl }: { name: string; email: string | null; avatarUrl?: string | null }) {
  const { lang } = useLanguageStore();
  const router = useRouter();
  return (
    <LinearGradient
      colors={[colors.brand.deepest, colors.brand.DEFAULT, colors.brand.mid]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: 8, padding: 22, marginBottom: 16, overflow: 'hidden' }}
    >
      {/* Decorative circles */}
      <View style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: 'rgba(255,255,255,0.08)' }} />
      <View style={{ position: 'absolute', bottom: -30, left: -30, width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.06)' }} />

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' }}>
          <Star size={10} color="#fff" fill="#fff" strokeWidth={2} />
          <Text style={{ fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 1.5 }}>
            {lang === 'en' ? 'CESTO MEMBER' : 'MIEMBRO CESTO'}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push('/edit-profile' as never)}
          hitSlop={6}
          style={({ pressed }) => ({
            flexDirection: 'row', alignItems: 'center', gap: 5,
            paddingHorizontal: 10, paddingVertical: 6,
            borderRadius: 999,
            backgroundColor: pressed ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.16)',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
          })}
        >
          <Pencil size={10} color="#fff" strokeWidth={2.25} />
          <Text style={{ fontSize: 10.5, fontWeight: '800', color: '#fff', letterSpacing: 0.4 }}>
            {lang === 'en' ? 'Edit' : 'Editar'}
          </Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{
          width: 64, height: 64, borderRadius: 32,
          backgroundColor: 'rgba(255,255,255,0.95)',
          justifyContent: 'center', alignItems: 'center',
          borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)',
          overflow: 'hidden',
        }}>
          {avatarUrl ? (
            <Image source={{ uri: resolveImageUrl(avatarUrl, 'logo') }} style={{ width: 64, height: 64 }} />
          ) : (
            <Text style={{ fontSize: 22, fontWeight: '700', color: colors.brand.deepest }}>
              {getInitials(name)}
            </Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 20, fontWeight: '700', color: '#fff', letterSpacing: -0.4 }}>
            {name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 2 }}>
            {email}
          </Text>
        </View>
      </View>
    </LinearGradient>
  );
}

/* ───────── Stats row ───────── */
function StatsRow({ orders, hasSubscription }: { orders: number | null; hasSubscription: boolean }) {
  const { lang } = useLanguageStore();
  return (
    <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
      <View style={{ flex: 1, backgroundColor: colors.surface.cream, borderRadius: 8, padding: 14, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)' }}>
        <Package size={18} color={colors.brand.deepest} strokeWidth={1.75} />
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink, marginTop: 8 }}>{orders ?? '—'}</Text>
        <Text style={{ fontSize: 11, color: colors.gray, marginTop: 2 }}>
          {lang === 'en' ? 'Orders' : 'Pedidos'}
        </Text>
      </View>
      <View style={{ flex: 1, backgroundColor: colors.surface.cream, borderRadius: 8, padding: 14, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)' }}>
        <ShoppingBasket size={18} color={hasSubscription ? colors.brand.DEFAULT : colors.muted} strokeWidth={1.75} />
        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 10, letterSpacing: -0.3 }}>
          {hasSubscription
            ? (lang === 'en' ? 'Active' : 'Activa')
            : (lang === 'en' ? 'Not set' : 'Sin activar')}
        </Text>
        <Text style={{ fontSize: 11, color: colors.gray, marginTop: 2 }}>
          {lang === 'en' ? 'Rashan plan' : 'Plan rashan'}
        </Text>
      </View>
      <View style={{ flex: 1, backgroundColor: colors.surface.cream, borderRadius: 8, padding: 14, borderWidth: 1, borderColor: 'rgba(226,232,240,0.7)' }}>
        <Shield size={18} color={colors.amber.deep} strokeWidth={1.75} />
        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink, marginTop: 10, letterSpacing: -0.3 }}>
          {lang === 'en' ? 'Verified' : 'Verificado'}
        </Text>
        <Text style={{ fontSize: 11, color: colors.gray, marginTop: 2 }}>
          {lang === 'en' ? 'Account' : 'Cuenta'}
        </Text>
      </View>
    </View>
  );
}

/* ───────── Menu row ───────── */
function MenuRow({ item, isLast }: { item: MenuItem; isLast: boolean }) {
  const { lang } = useLanguageStore();
  const Icon = item.icon;
  return (
    <Pressable
      onPress={item.onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: pressed ? colors.surface.linen : 'transparent',
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: colors.border,
      })}
    >
      <View style={{
        width: 40, height: 40, borderRadius: 12,
        backgroundColor: toneBg[item.tone],
        justifyContent: 'center', alignItems: 'center',
        marginRight: 14,
      }}>
        <Icon size={18} color={toneFg[item.tone]} strokeWidth={1.75} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, letterSpacing: -0.2 }}>
          {lang === 'en' ? item.label_en : item.label_es}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
          {lang === 'en' ? item.hint_en : item.hint_es}
        </Text>
      </View>
      {item.external
        ? <ExternalLink size={16} color={colors.muted} strokeWidth={1.75} />
        : <ChevronRight size={17} color={colors.muted} strokeWidth={1.75} />}
    </Pressable>
  );
}

/* ───────── Section heading ───────── */
function SectionHeading({ children }: { children: string }) {
  return (
    <Text style={{
      fontSize: 10,
      fontWeight: '700',
      color: colors.muted,
      letterSpacing: 1.6,
      marginBottom: 8,
      marginLeft: 4,
    }}>
      {children.toUpperCase()}
    </Text>
  );
}

/* ───────── Screen ───────── */
export default function ProfileScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const { user, isAuthenticated, logout } = useAuthStore();
  const { data: subscriptions } = useRashanSubscriptions();
  const hasSubscription = !!subscriptions?.find((s) => s.status !== 'cancelled');
  // The tile used to render a hardcoded 3 for everyone. Ask for a single row
  // and read the server's `total` — the page itself is thrown away.
  const isPartner = useIsPartner();
  const { data: ordersPage } = useOrders({ limit: 1 });
  const orderCount = ordersPage?.total ?? null;
  const isBusiness = useIsBusinessCustomer();
  const isB2bPricing = useIsB2bPricing();
  const [pricingSheetOpen, setPricingSheetOpen] = useState(false);

  const activitySection: MenuItem[] = [
    // Partner mode leads the list for the accounts that have it. A shopkeeper
    // opening the app to check orders should not scroll past their own
    // favourites to find the shop. Shown by role, not behind a separate login —
    // a partner IS a customer, and the route's own gate handles the rest,
    // including a temporary password that still needs rotating.
    ...(isPartner ? [{
      icon: LayoutDashboard,
      label_en: 'Partner dashboard', label_es: 'Panel de tienda',
      hint_en: 'Orders, products and your storefront',
      hint_es: 'Pedidos, productos y tu tienda',
      tone: 'mint' as const,
      onPress: () => router.push('/(partner)'),
    }] : []),
    {
      icon: User,
      label_en: 'Edit Profile', label_es: 'Editar Perfil',
      hint_en: 'Name, email, account details', hint_es: 'Nombre, correo, datos de cuenta',
      tone: 'mint',
      onPress: () => router.push('/edit-profile' as never),
    },
    {
      icon: Package,
      label_en: 'My Orders', label_es: 'Mis Pedidos',
      hint_en: 'Track deliveries and reorder', hint_es: 'Seguimiento y volver a pedir',
      tone: 'mint',
      onPress: () => router.push('/orders'),
    },
    {
      icon: Heart,
      label_en: 'My Favourites', label_es: 'Mis Favoritos',
      hint_en: 'Products you have saved', hint_es: 'Productos que has guardado',
      tone: 'amber',
      onPress: () => router.push('/favorites' as never),
    },
    {
      icon: Store,
      label_en: 'Stores I Follow', label_es: 'Tiendas que sigo',
      hint_en: 'Shops you have followed', hint_es: 'Tiendas que sigues',
      tone: 'amber',
      onPress: () => router.push('/followed-stores' as never),
    },
    {
      icon: ShoppingBasket,
      label_en: 'Monthly Rashan', label_es: 'Rashan Mensual',
      hint_en: hasSubscription ? 'Active subscription' : 'Set up auto-delivery',
      hint_es: hasSubscription ? 'Suscripción activa' : 'Activa auto-entrega',
      tone: 'sage',
      onPress: () => router.push(hasSubscription ? '/rashan/subscription' : '/(tabs)/rashan'),
    },
    {
      icon: MapPin,
      label_en: 'My Addresses', label_es: 'Mis Direcciones',
      hint_en: 'Manage delivery locations', hint_es: 'Gestiona direcciones',
      tone: 'dune',
      onPress: () => router.push('/addresses'),
    },
    {
      icon: KeyRound,
      label_en: 'Change Password', label_es: 'Cambiar Contraseña',
      hint_en: 'Update your password', hint_es: 'Actualiza tu contraseña',
      tone: 'sand',
      onPress: () => router.push('/change-password'),
    },
  ];

  const preferencesSection: MenuItem[] = [
    {
      icon: Globe,
      label_en: 'Language', label_es: 'Idioma',
      hint_en: lang === 'en' ? 'English' : 'Inglés',
      hint_es: lang === 'en' ? 'English' : 'Español',
      tone: 'sand',
      onPress: () => router.push('/language'),
    },
    {
      icon: Bell,
      label_en: 'Notifications', label_es: 'Notificaciones',
      hint_en: 'Delivery alerts and offers', hint_es: 'Alertas de entrega y ofertas',
      tone: 'amber',
      onPress: () => router.push('/notifications'),
    },
  ];

  // Icons by link, so the shared BUSINESS_LINKS constant stays free of UI
  // imports. Same mapping the side drawer uses.
  const businessIcon: Record<BusinessLink['key'], typeof Briefcase> = {
    wholesale: Tag,
    supplier: Package,
  };

  // The support rows below leave for the site: the help centre and the legal
  // text should have one copy, not an app copy that quietly falls behind the
  // published one. About Cesto is the exception — web has no /about route.
  const openWeb = (url: string) => () => {
    Linking.openURL(url).catch(() => { /* no browser, or URL rejected */ });
  };

  const supportSection: MenuItem[] = [
    // Price view is a mode, not a destination, so it stays in the app and
    // stays first — and only approved business accounts can switch.
    ...(isBusiness ? [{
      icon: Briefcase,
      label_en: 'Price view', label_es: 'Vista de precios',
      hint_en: isB2bPricing ? 'Showing business prices' : 'Showing retail prices',
      hint_es: isB2bPricing ? 'Mostrando precios de empresa' : 'Mostrando precios de tienda',
      tone: 'mint' as const,
      onPress: () => setPricingSheetOpen(true),
    }] : []),
    // Cesto Business — all three of web's trade destinations, opening the
    // site. This was a single link to a cut-down in-app form, which duplicated
    // the first of them badly and offered no route to the other two at all.
    // That form has been removed.
    ...BUSINESS_LINKS.map((l) => ({
      icon: businessIcon[l.key],
      label_en: l.label_en, label_es: l.label_es,
      hint_en: l.hint_en, hint_es: l.hint_es,
      tone: 'mint' as const,
      external: true,
      onPress: openWeb(l.url),
    })),
    {
      icon: HelpCircle,
      label_en: 'Help centre', label_es: 'Centro de ayuda',
      hint_en: 'Guides and answers', hint_es: 'Guías y respuestas',
      tone: 'mint',
      external: true,
      onPress: openWeb(SUPPORT_URLS.help),
    },
    {
      icon: MessageCircle,
      label_en: 'Contact us', label_es: 'Contacto',
      hint_en: 'Write to our support team', hint_es: 'Escribe a nuestro equipo',
      tone: 'mint',
      external: true,
      onPress: openWeb(SUPPORT_URLS.contact),
    },
    {
      icon: MessagesSquare,
      label_en: 'FAQs', label_es: 'Preguntas frecuentes',
      hint_en: 'Quick answers to common questions', hint_es: 'Respuestas rápidas a dudas comunes',
      tone: 'sage',
      external: true,
      onPress: openWeb(SUPPORT_URLS.faq),
    },
    {
      icon: Info,
      label_en: 'About Cesto', label_es: 'Sobre Cesto',
      hint_en: 'Our story and team', hint_es: 'Nuestra historia',
      tone: 'dune',
      onPress: () => router.push('/about'),
    },
    {
      icon: FileText,
      label_en: 'Privacy Policy', label_es: 'Política de Privacidad',
      hint_en: 'How we handle your data', hint_es: 'Cómo tratamos tus datos',
      tone: 'sage',
      external: true,
      onPress: openWeb(SUPPORT_URLS.privacy),
    },
    {
      icon: Shield,
      label_en: 'Terms of Service', label_es: 'Términos de Uso',
      hint_en: 'Rules for using Cesto', hint_es: 'Normas de uso de Cesto',
      tone: 'sand',
      external: true,
      onPress: openWeb(SUPPORT_URLS.terms),
    },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={[]}>
      <AppHeader />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        {isAuthenticated && user ? (
          <>
            <MemberHero name={user.name} email={user.email} avatarUrl={user.avatar_url} />
            <StatsRow orders={orderCount} hasSubscription={hasSubscription} />
          </>
        ) : (
          <GuestHero />
        )}

        <SectionHeading>{lang === 'en' ? 'Activity' : 'Actividad'}</SectionHeading>
        <View style={{
          backgroundColor: colors.surface.cream,
          borderRadius: 18,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: 'rgba(226,232,240,0.7)',
          marginBottom: 20,
        }}>
          {activitySection.map((item, i) => (
            <MenuRow key={item.label_en} item={item} isLast={i === activitySection.length - 1} />
          ))}
        </View>

        <SectionHeading>{lang === 'en' ? 'Preferences' : 'Preferencias'}</SectionHeading>
        <View style={{
          backgroundColor: colors.surface.cream,
          borderRadius: 18,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: 'rgba(226,232,240,0.7)',
          marginBottom: 20,
        }}>
          {preferencesSection.map((item, i) => (
            <MenuRow key={item.label_en} item={item} isLast={i === preferencesSection.length - 1} />
          ))}
        </View>

        <SectionHeading>{lang === 'en' ? 'Support' : 'Soporte'}</SectionHeading>
        <View style={{
          backgroundColor: colors.surface.cream,
          borderRadius: 18,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: 'rgba(226,232,240,0.7)',
          marginBottom: 20,
        }}>
          {supportSection.map((item, i) => (
            <MenuRow key={item.label_en} item={item} isLast={i === supportSection.length - 1} />
          ))}
        </View>

        {/* Logout */}
        {isAuthenticated && (
          <Pressable
            onPress={logout}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              paddingVertical: 16,
              borderRadius: 14,
              backgroundColor: pressed ? colors.dangerBg : colors.surface.cream,
              borderWidth: 1,
              borderColor: 'rgba(226,232,240,0.7)',
              marginBottom: 16,
            })}
          >
            <LogOut size={16} color={colors.danger} strokeWidth={1.75} />
            <Text style={{ fontSize: 14, fontWeight: '700', color: colors.danger, letterSpacing: -0.2 }}>
              {lang === 'es' ? 'Cerrar Sesión' : 'Log Out'}
            </Text>
          </Pressable>
        )}

        {/* Version footer */}
        <View style={{ alignItems: 'center', marginTop: 8 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: colors.muted, letterSpacing: 1.5 }}>
            CESTO · v1.0.0
          </Text>
          <Text style={{ fontSize: 10, color: colors.muted, marginTop: 4 }}>
            {lang === 'en' ? 'Crafted with care in Madrid' : 'Hecho con cariño en Madrid'}
          </Text>
        </View>
      </ScrollView>
      <PricingModeSheet visible={pricingSheetOpen} onClose={() => setPricingSheetOpen(false)} />
    </SafeAreaView>
  );
}
