import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, MapPin, Plus, Star, Trash2, FileText, Pencil } from 'lucide-react-native';
import {
  useAddresses,
  useDeleteAddress,
  useSetDefaultAddress,
  type Address,
} from '@grocery-app/shared';
import { colors } from '../src/constants/colors';
import { useLanguageStore } from '../src/stores/languageStore';
import { useAuthStore } from '../src/stores/authStore';
import { useDialog } from '../src/components/AppDialog';

export default function AddressesScreen() {
  // This bar is absolutely positioned at bottom: 0, and from SDK 54 the app
  // draws behind the system navigation, so bottom: 0 is UNDER it. The old
  // hardcoded `paddingBottom: 34` was an iPhone home-indicator guess: it
  // happened to fit there and left the button half-hidden behind Android's
  // three-button bar, which is 48dp.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const dialog = useDialog();
  const { lang } = useLanguageStore();
  const { isAuthenticated } = useAuthStore();

  const { data: addresses = [], isLoading } = useAddresses();
  const deleteMutation = useDeleteAddress();
  const setDefaultMutation = useSetDefaultAddress();

  const openCreate = () => router.push('/address-form?id=new');
  const openEdit = (a: Address) => router.push(`/address-form?id=${a.id}`);

  const confirmDelete = (id: string) => {
    dialog.confirm({
      icon: Trash2,
      title: lang === 'es' ? 'Eliminar dirección' : 'Delete address',
      message: lang === 'es'
        ? 'Esta dirección se quitará de tu cuenta.'
        : 'This address will be removed from your account.',
      cancelLabel: lang === 'es' ? 'Cancelar' : 'Cancel',
      confirmLabel: lang === 'es' ? 'Eliminar' : 'Delete',
      onConfirm: () => deleteMutation.mutate(id),
    });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.linen }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center' }}>
          <ArrowLeft size={20} color={colors.ink} strokeWidth={1.75} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center' }}>
          {lang === 'es' ? 'Mis Direcciones' : 'My Addresses'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {!isAuthenticated ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.surface.cream, justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
            <MapPin size={36} color={colors.muted} strokeWidth={1.5} />
          </View>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, textAlign: 'center', marginBottom: 8 }}>
            {lang === 'es' ? 'Inicia sesión para ver tus direcciones' : 'Log in to view your addresses'}
          </Text>
          <Text style={{ fontSize: 14, color: colors.gray, textAlign: 'center', lineHeight: 20 }}>
            {lang === 'es' ? 'Guarda y gestiona tus direcciones de entrega' : 'Save and manage your delivery addresses'}
          </Text>
          <Pressable
            onPress={() => router.push('/(auth)/login')}
            style={({ pressed }) => ({
              height: 52, borderRadius: 12, backgroundColor: pressed ? colors.brand.mid : colors.brand.DEFAULT,
              justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32, marginTop: 20,
            })}
          >
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>
              {lang === 'es' ? 'Iniciar Sesión' : 'Log In'}
            </Text>
          </Pressable>
        </View>
      ) : isLoading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={colors.brand.DEFAULT} />
        </View>
      ) : (
        <>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 16, paddingBottom: 100 + insets.bottom }}>
            <View style={{ backgroundColor: colors.brand.whisper, borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: colors.brand.mist }}>
              <Text style={{ fontSize: 13, color: colors.brand.DEFAULT, lineHeight: 18 }}>
                {lang === 'es'
                  ? 'Gestiona tus direcciones de entrega. La dirección predeterminada se usará en el checkout.'
                  : 'Manage your delivery addresses. The default address will be used at checkout.'}
              </Text>
            </View>

            {addresses.length === 0 && (
              <View style={{ alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24 }}>
                <View
                  style={{
                    width: 72, height: 72, borderRadius: 36,
                    backgroundColor: colors.surface.cream,
                    borderWidth: 1, borderColor: colors.border,
                    justifyContent: 'center', alignItems: 'center', marginBottom: 16,
                  }}
                >
                  <MapPin size={28} color={colors.muted} strokeWidth={1.5} />
                </View>
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 4 }}>
                  {lang === 'es' ? 'Sin direcciones guardadas' : 'No saved addresses'}
                </Text>
                <Text style={{ fontSize: 13, color: colors.gray, textAlign: 'center', lineHeight: 18 }}>
                  {lang === 'es'
                    ? 'Añade tu primera dirección para empezar a recibir pedidos.'
                    : 'Add your first address to start receiving orders.'}
                </Text>
              </View>
            )}

            {addresses.map((addr) => (
              <AddressCard
                key={addr.id}
                addr={addr}
                lang={lang}
                onPress={() => openEdit(addr)}
                onSetDefault={() => setDefaultMutation.mutate(addr.id)}
                onDelete={() => confirmDelete(addr.id)}
                settingDefault={setDefaultMutation.isPending}
              />
            ))}
          </ScrollView>

          <View style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            backgroundColor: colors.surface.linen,
            paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 16),
            borderTopWidth: 1, borderTopColor: colors.border,
          }}>
            <Pressable
              onPress={openCreate}
              style={({ pressed }) => ({
                height: 54, borderRadius: 12,
                backgroundColor: pressed ? colors.brand.mid : colors.brand.DEFAULT,
                justifyContent: 'center', alignItems: 'center',
                flexDirection: 'row', gap: 8,
              })}
            >
              <Plus size={20} color="#fff" strokeWidth={2.5} />
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#fff' }}>
                {lang === 'es' ? 'Añadir Dirección' : 'Add Address'}
              </Text>
            </Pressable>
          </View>
        </>
      )}

    </SafeAreaView>
  );
}

function AddressCard({
  addr,
  lang,
  onPress,
  onSetDefault,
  onDelete,
  settingDefault,
}: {
  addr: Address;
  lang: 'en' | 'es';
  onPress: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
  settingDefault: boolean;
}) {
  const isDefault = addr.is_default;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.surface.cream,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: 'rgba(226,232,240,0.7)',
        marginBottom: 14,
        transform: [{ scale: pressed ? 0.995 : 1 }],
        overflow: 'hidden',
      })}
    >
      <View style={{ padding: 20 }}>
        {/* Eyebrow row: status + floating actions */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, minHeight: 18 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {isDefault ? (
              <>
                <Star size={11} color={colors.brand.DEFAULT} fill={colors.brand.DEFAULT} strokeWidth={2} />
                <Text style={{ fontSize: 10, fontWeight: '800', color: colors.brand.DEFAULT, letterSpacing: 1.6 }}>
                  {lang === 'es' ? 'PREDETERMINADA' : 'DEFAULT'}
                </Text>
              </>
            ) : (
              <Text style={{ fontSize: 10, fontWeight: '800', color: colors.muted, letterSpacing: 1.6 }}>
                {lang === 'es' ? 'DIRECCIÓN' : 'ADDRESS'}
              </Text>
            )}
          </View>

          <View style={{ flexDirection: 'row', gap: 6 }}>
            {!isDefault && (
              <IconAction
                onPress={(e) => { e.stopPropagation?.(); onSetDefault(); }}
                disabled={settingDefault}
                tint="brand"
              >
                <Star size={14} color={colors.brand.DEFAULT} strokeWidth={2} />
              </IconAction>
            )}
            <IconAction
              onPress={(e) => { e.stopPropagation?.(); onPress(); }}
              tint="ink"
            >
              <Pencil size={14} color={colors.ink} strokeWidth={2} />
            </IconAction>
            <IconAction
              onPress={(e) => { e.stopPropagation?.(); onDelete(); }}
              tint="danger"
            >
              <Trash2 size={14} color={colors.danger} strokeWidth={2} />
            </IconAction>
          </View>
        </View>

        {/* Headline: the address itself */}
        <Text
          numberOfLines={2}
          style={{ fontSize: 19, fontWeight: '700', color: colors.ink, lineHeight: 25, letterSpacing: -0.3 }}
        >
          {addr.street_line_1}
          {addr.street_line_2 ? `, ${addr.street_line_2}` : ''}
        </Text>
        <Text style={{ fontSize: 14, color: colors.gray, marginTop: 4, lineHeight: 19 }}>
          {addr.postcode} {addr.city} · {addr.province}
        </Text>

        {/* Hairline */}
        <View style={{ height: 1, backgroundColor: colors.border, opacity: 0.6, marginTop: 16, marginBottom: 14 }} />

        {/* Two-column meta grid */}
        <View style={{ flexDirection: 'row', gap: 16 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 9.5, fontWeight: '800', color: colors.muted, letterSpacing: 1.4, marginBottom: 4 }}>
              {(lang === 'es' ? 'NOMBRE' : 'NAME')}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '600', color: colors.ink }}>
              {addr.contact_name}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 9.5, fontWeight: '800', color: colors.muted, letterSpacing: 1.4, marginBottom: 4 }}>
              {(lang === 'es' ? 'TELÉFONO' : 'PHONE')}
            </Text>
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '600', color: colors.ink }}>
              {addr.contact_phone}
            </Text>
          </View>
        </View>

        {addr.delivery_notes ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 8,
              marginTop: 14,
              backgroundColor: colors.brand.whisper,
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderWidth: 1,
              borderColor: colors.brand.mist,
            }}
          >
            <FileText size={13} color={colors.brand.deepest} strokeWidth={2} style={{ marginTop: 1.5 }} />
            <Text style={{ flex: 1, fontSize: 13, color: colors.charcoal, lineHeight: 18 }}>
              {addr.delivery_notes}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function IconAction({
  children,
  onPress,
  disabled,
  tint,
}: {
  children: React.ReactNode;
  onPress: (e?: any) => void;
  disabled?: boolean;
  tint: 'brand' | 'danger' | 'ink';
}) {
  const pressedBg =
    tint === 'brand' ? colors.brand.mist
      : tint === 'danger' ? colors.dangerBg
        : colors.surface.dune;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => ({
        width: 32, height: 32, borderRadius: 16,
        backgroundColor: pressed ? pressedBg : colors.surface.linen,
        justifyContent: 'center', alignItems: 'center',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {children}
    </Pressable>
  );
}
