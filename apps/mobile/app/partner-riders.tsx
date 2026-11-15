import { useState } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, Modal, ActivityIndicator,
  RefreshControl, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft, Plus, X, Bike, Car, Truck, AlertTriangle, Trash2, Phone,
} from 'lucide-react-native';
import {
  usePartnerRiders, useCreatePartnerRider, useUpdatePartnerRider, useDeletePartnerRider,
  type Rider, type PartnerRiderPayload,
} from '@grocery-app/shared';
import { colors } from '@/constants/colors';
import { usePartnerT } from '@/partner/lib/i18n';
import { useToast } from '@/components/Toast';
import Skeleton from '@/components/Skeleton';
import { useDialog } from '@/components/AppDialog';

/**
 * Riders — the smallest surface in partner mode, and the one most likely to be
 * used standing up.
 *
 * The list shows everyone including inactive riders, dimmed. Web filters them
 * out by default behind a toggle; here they stay visible because the usual
 * reason to open this screen is to reactivate someone who is back today, and
 * a rider hidden behind a filter reads as deleted.
 */

type VehicleType = PartnerRiderPayload['vehicle_type'];

const VEHICLES: VehicleType[] = ['moto', 'bicicleta', 'coche'];

const VEHICLE_ICON: Record<VehicleType, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  moto: Truck,
  bicicleta: Bike,
  coche: Car,
};

export default function PartnerRiders() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const dialog = useDialog();
  const t = usePartnerT();
  const toast = useToast();

  // activeOnly omitted on purpose — see the note above.
  const riders = usePartnerRiders({});
  const create = useCreatePartnerRider();
  const update = useUpdatePartnerRider();
  const remove = useDeletePartnerRider();

  const [editing, setEditing] = useState<Rider | 'new' | null>(null);

  const list = riders.data ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.linen }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 12, paddingTop: insets.top + 10, paddingBottom: 12,
        backgroundColor: colors.surface.cream, borderBottomWidth: 1, borderBottomColor: colors.border,
      }}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
          <ArrowLeft size={21} color={colors.ink} strokeWidth={2} />
        </Pressable>
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: colors.ink }}>{t('riders.title')}</Text>
        <Pressable
          onPress={() => setEditing('new')}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 5,
            height: 38, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.brand.DEFAULT,
          }}
        >
          <Plus size={15} color="#FFFFFF" strokeWidth={2.5} />
          <Text style={{ fontSize: 13, fontWeight: '700', color: '#FFFFFF' }}>{t('riders.add')}</Text>
        </Pressable>
      </View>

      {riders.isError ? (
        <Centered>
          <AlertTriangle size={22} color={colors.danger} strokeWidth={2} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{t('riders.loadFailed')}</Text>
          <Primary label={t('riders.retry')} onPress={() => void riders.refetch()} />
        </Centered>
      ) : riders.isLoading ? (
        <View style={{ padding: 16, gap: 10 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={64} borderRadius={12} />)}
        </View>
      ) : list.length === 0 ? (
        <Centered>
          <Truck size={26} color={colors.muted} strokeWidth={1.75} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>{t('riders.empty')}</Text>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', maxWidth: 260 }}>
            {t('riders.emptyHint')}
          </Text>
          <Primary label={t('riders.add')} onPress={() => setEditing('new')} />
        </Centered>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(r) => r.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={riders.isRefetching} onRefresh={() => void riders.refetch()} tintColor={colors.brand.DEFAULT} />
          }
          renderItem={({ item }) => {
            const Icon = VEHICLE_ICON[item.vehicle_type as VehicleType] ?? Truck;
            return (
              <Pressable
                onPress={() => setEditing(item)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  backgroundColor: colors.surface.cream, borderRadius: 12, padding: 14,
                  borderWidth: 1, borderColor: colors.border,
                  opacity: item.is_active ? 1 : 0.55,
                }}
              >
                <View style={{
                  width: 40, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center',
                  backgroundColor: item.is_active ? colors.brand.mist : colors.surface.sand,
                }}>
                  <Icon size={18} color={item.is_active ? colors.brand.DEFAULT : colors.muted} strokeWidth={1.75} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 14.5, fontWeight: '600', color: colors.ink }}>{item.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Phone size={11} color={colors.muted} strokeWidth={2} />
                    <Text style={{ fontSize: 12, color: colors.muted, fontFamily: 'JetBrainsMono' }}>{item.phone}</Text>
                  </View>
                </View>
                {!item.is_active && (
                  <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.surface.sand }}>
                    <Text style={{ fontSize: 10, fontWeight: '700', color: colors.muted }}>{t('riders.inactive')}</Text>
                  </View>
                )}
              </Pressable>
            );
          }}
        />
      )}

      <RiderSheet
        key={editing === 'new' ? 'new' : editing?.id ?? 'closed'}
        subject={editing}
        t={t}
        busy={create.isPending || update.isPending || remove.isPending}
        onClose={() => setEditing(null)}
        onSave={(payload) => {
          const done = {
            onSuccess: () => { setEditing(null); toast.success(t('riders.saved')); },
            onError: () => toast.error(t('riders.saveFailed')),
          };
          if (editing === 'new') create.mutate(payload, done);
          else if (editing) update.mutate({ id: editing.id, payload }, done);
        }}
        onDelete={() => {
          if (editing === 'new' || !editing) return;
          dialog.confirm({
            icon: Trash2,
            title: t('riders.delete'),
            message: t('riders.deleteConfirm'),
            cancelLabel: t('riders.cancel'),
            confirmLabel: t('riders.delete'),
            onConfirm: () => remove.mutate(editing.id, {
              onSuccess: () => { setEditing(null); toast.success(t('riders.deleted')); },
              onError: () => toast.error(t('riders.deleteFailed')),
            }),
          });
        }}
      />
    </View>
  );
}

/* ── pieces ─────────────────────────────────────────────── */

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 }}>{children}</View>;
}

function Primary({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ minHeight: 44, paddingHorizontal: 20, borderRadius: 12, backgroundColor: colors.brand.DEFAULT, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>{label}</Text>
    </Pressable>
  );
}

/**
 * Add and edit share one sheet. The form is four fields; two screens would
 * have been two copies of the same validation.
 *
 * Remounted per subject via a key on the parent, so opening a different rider
 * refills the fields instead of showing the previous one's values.
 */
function RiderSheet({
  subject, t, busy, onClose, onSave, onDelete,
}: {
  subject: Rider | 'new' | null;
  t: (k: string) => string;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: PartnerRiderPayload) => void;
  onDelete: () => void;
}) {
  const existing = subject !== 'new' && subject !== null ? subject : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');
  const [vehicle, setVehicle] = useState<VehicleType>((existing?.vehicle_type as VehicleType) ?? 'moto');
  const [isActive, setIsActive] = useState(existing?.is_active ?? true);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!name.trim()) { setError(t('riders.needName')); return; }
    if (!phone.trim()) { setError(t('riders.needPhone')); return; }
    setError(null);
    onSave({ name: name.trim(), phone: phone.trim(), vehicle_type: vehicle, is_active: isActive });
  }

  return (
    <Modal visible={subject !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' }} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{
          backgroundColor: colors.surface.cream,
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: 20, paddingBottom: 32, gap: 14,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>
              {existing ? t('riders.edit') : t('riders.add')}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}><X size={19} color={colors.muted} strokeWidth={2} /></Pressable>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.gray }}>{t('riders.name')}</Text>
            <Input value={name} onChangeText={setName} />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.gray }}>{t('riders.phone')}</Text>
            <Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          </View>

          <View style={{ gap: 8 }}>
            <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.gray }}>{t('riders.vehicle')}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {VEHICLES.map((v) => {
                const Icon = VEHICLE_ICON[v];
                const on = v === vehicle;
                return (
                  <Pressable
                    key={v}
                    onPress={() => setVehicle(v)}
                    style={{
                      flex: 1, minHeight: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 4,
                      backgroundColor: on ? colors.brand.mist : colors.surface.linen,
                      borderWidth: 1, borderColor: on ? colors.brand.DEFAULT : colors.border,
                    }}
                  >
                    <Icon size={18} color={on ? colors.brand.DEFAULT : colors.gray} strokeWidth={1.75} />
                    <Text style={{ fontSize: 11.5, fontWeight: on ? '700' : '500', color: on ? colors.brand.deepest : colors.gray }}>
                      {t(`riders.vehicle.${v}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable
            onPress={() => setIsActive((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 }}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{t('riders.active')}</Text>
              <Text style={{ fontSize: 11.5, color: colors.muted, lineHeight: 15 }}>{t('riders.activeHint')}</Text>
            </View>
            <View style={{
              width: 46, height: 28, borderRadius: 999, padding: 3,
              backgroundColor: isActive ? colors.brand.DEFAULT : colors.border,
              alignItems: isActive ? 'flex-end' : 'flex-start',
            }}>
              <View style={{ width: 22, height: 22, borderRadius: 999, backgroundColor: '#FFFFFF' }} />
            </View>
          </Pressable>

          {error && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.dangerBg }}>
              <AlertTriangle size={15} color={colors.danger} strokeWidth={2} />
              <Text style={{ flex: 1, fontSize: 12.5, color: colors.danger }}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={submit}
            disabled={busy}
            style={{
              minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              backgroundColor: busy ? colors.brand.light : colors.brand.DEFAULT,
            }}
          >
            {busy
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>{t('riders.save')}</Text>}
          </Pressable>

          {existing && (
            <Pressable
              onPress={onDelete}
              disabled={busy}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 }}
            >
              <Trash2 size={15} color={colors.danger} strokeWidth={2} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.danger }}>{t('riders.delete')}</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Input({
  value, onChangeText, keyboardType,
}: { value: string; onChangeText: (v: string) => void; keyboardType?: 'phone-pad' }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      keyboardType={keyboardType}
      style={{
        borderWidth: 1, borderColor: colors.border, borderRadius: 10,
        paddingHorizontal: 12, minHeight: 46,
        fontSize: 14, color: colors.ink, backgroundColor: colors.surface.linen,
      }}
    />
  );
}
