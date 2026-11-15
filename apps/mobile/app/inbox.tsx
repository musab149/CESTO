import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Bell,
  Package,
  CheckCircle2,
  Truck,
  XCircle,
  CheckCheck,
  Tag,
  Megaphone,
} from 'lucide-react-native';
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  type AppNotification,
  type NotificationType,
} from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';

interface TypeStyle {
  Icon: typeof Bell;
  bg: string;
  fg: string;
}

const TYPE_STYLE: Record<NotificationType, TypeStyle> = {
  order_confirmed:  { Icon: CheckCircle2, bg: colors.brand.mist,   fg: colors.brand.DEFAULT },
  order_preparing:  { Icon: Package,      bg: colors.brand.mist,   fg: colors.brand.DEFAULT },
  order_on_the_way: { Icon: Truck,        bg: colors.amber.mist,   fg: colors.amber.deep },
  order_delivered:  { Icon: CheckCircle2, bg: colors.brand.mist,   fg: colors.brand.DEFAULT },
  order_cancelled:  { Icon: XCircle,      bg: colors.dangerBg,     fg: colors.danger },
  promo_banner:     { Icon: Tag,          bg: colors.amber.mist,   fg: colors.amber.deep },
  admin_new_order:        { Icon: Megaphone, bg: colors.surface.linen, fg: colors.muted },
  admin_low_stock:        { Icon: Megaphone, bg: colors.surface.linen, fg: colors.muted },
  admin_new_customer:     { Icon: Megaphone, bg: colors.surface.linen, fg: colors.muted },
  admin_subscription_paused: { Icon: Megaphone, bg: colors.surface.linen, fg: colors.muted },
  admin_broadcast:        { Icon: Megaphone, bg: colors.brand.mist, fg: colors.brand.DEFAULT },
  admin_quotation_request: { Icon: Megaphone, bg: colors.surface.linen, fg: colors.muted },
  admin_home_grocery_request: { Icon: Megaphone, bg: colors.surface.linen, fg: colors.muted },
  home_grocery_approved: { Icon: CheckCircle2, bg: colors.brand.mist, fg: colors.brand.DEFAULT },
  home_grocery_rejected: { Icon: XCircle,      bg: colors.surface.linen, fg: colors.muted },
  order_placed:     { Icon: Package,      bg: colors.brand.mist,   fg: colors.brand.DEFAULT },
  // Partner dashboard types — not in the customer inbox.
  partner_new_order:       { Icon: Megaphone, bg: colors.surface.linen, fg: colors.muted },
  partner_draft_order:     { Icon: Megaphone, bg: colors.surface.linen, fg: colors.muted },
  partner_order_edited:    { Icon: Megaphone, bg: colors.surface.linen, fg: colors.muted },
  partner_order_cancelled: { Icon: Megaphone, bg: colors.surface.linen, fg: colors.muted },
};

function timeAgo(iso: string, lang: 'es' | 'en'): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(diffMs / 60_000));
  if (mins < 60)  return lang === 'es' ? `hace ${mins} min` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return lang === 'es' ? `hace ${hours} h` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  return lang === 'es' ? `hace ${days} d` : `${days}d ago`;
}

export default function InboxScreen() {
  const router = useRouter();
  const { lang } = useLanguageStore();
  const { data, isLoading } = useNotifications({ limit: 50 });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const notifications: AppNotification[] = data?.items ?? [];
  const unreadCount = notifications.filter((n) => !n.read).length;

  const handlePress = (n: AppNotification) => {
    if (!n.read) markRead.mutate(n.id);
    if (n.deeplink) router.push(n.deeplink as never);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {lang === 'es' ? 'Notificaciones' : 'Notifications'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading && notifications.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.brand.DEFAULT} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, backgroundColor: colors.brand.mist, justifyContent: 'center', alignItems: 'center', marginBottom: 20 }}>
            <Bell size={36} color={colors.brand.DEFAULT} strokeWidth={1.5} />
          </View>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, marginBottom: 6, textAlign: 'center' }}>
            {lang === 'es' ? 'Sin notificaciones' : 'No notifications'}
          </Text>
          <Text style={{ fontSize: 14, color: colors.gray, textAlign: 'center', lineHeight: 20 }}>
            {lang === 'es'
              ? 'Aquí verás las actualizaciones de tus pedidos.'
              : 'Order updates will show up here.'}
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
          {/* Mark all read */}
          {unreadCount > 0 && (
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 12 }}>
              <Pressable
                onPress={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, opacity: markAllRead.isPending ? 0.5 : 1 }}
              >
                <CheckCheck size={15} color={colors.brand.DEFAULT} strokeWidth={1.75} />
                <Text style={{ fontSize: 13, fontWeight: '600', color: colors.brand.DEFAULT }}>
                  {lang === 'es' ? 'Marcar todas como leídas' : 'Mark all as read'}
                </Text>
              </Pressable>
            </View>
          )}

          <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 10 }}>
            {notifications.map((n) => {
              const style = TYPE_STYLE[n.type] ?? TYPE_STYLE.promo_banner;
              const { Icon, bg, fg } = style;
              return (
                <Pressable
                  key={n.id}
                  onPress={() => handlePress(n)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 12,
                    padding: 14,
                    borderRadius: 14,
                    backgroundColor: n.read ? colors.surface.cream : colors.brand.whisper,
                    borderWidth: 1,
                    borderColor: n.read ? 'rgba(226,232,240,0.7)' : colors.brand.soft,
                  }}
                >
                  <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: bg, justifyContent: 'center', alignItems: 'center' }}>
                    <Icon size={20} color={fg} strokeWidth={1.75} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
                      {lang === 'es' ? n.title_es : n.title_en}
                    </Text>
                    <Text style={{ fontSize: 13, color: colors.gray, marginTop: 2, lineHeight: 18 }}>
                      {lang === 'es' ? n.body_es : n.body_en}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>
                      {timeAgo(n.created_at, lang)}
                    </Text>
                  </View>
                  {!n.read && (
                    <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: colors.brand.DEFAULT, marginTop: 4 }} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
