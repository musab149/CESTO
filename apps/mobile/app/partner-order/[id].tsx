import { useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Modal, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft, AlertTriangle, Truck, X, Check, PackageCheck,
} from 'lucide-react-native';
import {
  usePartnerOrder, usePartnerRiders, useUpdatePartnerOrderStatus,
  useAssignPartnerOrderRider, useCancelPartnerOrder, useConfirmPartnerDraftStock,
  type PartnerOrderStatusTarget,
} from '@grocery-app/shared';
import { colors } from '@/constants/colors';
import { orderStatusMeta, CANCELLABLE_STATUSES } from '@/constants/orderStatus';
import { useLanguageStore } from '@/stores/languageStore';
import { usePartnerT } from '@/partner/lib/i18n';
import { useToast } from '@/components/Toast';
import Skeleton from '@/components/Skeleton';

/**
 * Partner order detail — the one screen where a partner changes something.
 *
 * Web puts status buttons, the rider dropdown and cancel in a toolbar across
 * the top. Here the order reads top to bottom and every action lives in one
 * pinned bar at the bottom, within thumb reach. That also means the destructive
 * action (cancel) is never adjacent to the one a partner taps twenty times a
 * day (advance status).
 *
 * Status advance is a single button, not a row of six: the API only accepts a
 * forward move, so the only honest control is "what happens next".
 */

/** What "next" means from each status. Mirrors the API's accepted targets. */
const NEXT_STATUS: Record<string, PartnerOrderStatusTarget | undefined> = {
  pending:    'confirmed',
  confirmed:  'preparing',
  preparing:  'on_the_way',
  on_the_way: 'delivered',
};

export default function PartnerOrderDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = usePartnerT();
  const { lang } = useLanguageStore();
  const toast = useToast();

  const order = usePartnerOrder(id);
  const riders = usePartnerRiders({ activeOnly: true });

  const advance = useUpdatePartnerOrderStatus();
  const assign = useAssignPartnerOrderRider();
  const cancel = useCancelPartnerOrder();
  const confirmStock = useConfirmPartnerDraftStock();

  const [riderSheet, setRiderSheet] = useState(false);
  const [cancelSheet, setCancelSheet] = useState(false);
  const [reason, setReason] = useState('');

  const busy = advance.isPending || assign.isPending || cancel.isPending || confirmStock.isPending;

  if (order.isLoading) {
    return (
      <Screen onBack={() => router.back()} title={t('orderDetail.title')}>
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2].map((i) => <Skeleton key={i} height={90} borderRadius={12} />)}
        </View>
      </Screen>
    );
  }

  if (order.isError || !order.data) {
    return (
      <Screen onBack={() => router.back()} title={t('orderDetail.title')}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 }}>
          <AlertTriangle size={22} color={colors.danger} strokeWidth={2} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{t('orderDetail.loadFailed')}</Text>
        </View>
      </Screen>
    );
  }

  const o = order.data;
  const meta = orderStatusMeta(o.status);
  const next = NEXT_STATUS[o.status];
  const canCancel = CANCELLABLE_STATUSES.includes(o.status);
  const isDraft = o.status === 'draft';
  const rider = o.rider ?? null;

  const fail = () => toast.error(t('orderDetail.actionFailed'));

  return (
    <Screen onBack={() => router.back()} title={o.order_number} mono>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 14 }}
        refreshControl={
          <RefreshControl refreshing={order.isRefetching} onRefresh={() => void order.refetch()} tintColor={colors.brand.DEFAULT} />
        }
      >
        {/* Status first — it is the question a partner opens this screen to
            answer, and it decides which actions below are even available. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: meta.bg }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: meta.text }}>
              {lang === 'es' ? meta.label_es : meta.label_en}
            </Text>
          </View>
          <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink, marginLeft: 'auto', letterSpacing: -0.5 }}>
            {'€'}{Number(o.total ?? 0).toFixed(2)}
          </Text>
        </View>

        {isDraft && (
          <View style={{ flexDirection: 'row', gap: 10, padding: 14, borderRadius: 12, backgroundColor: colors.amber.mist }}>
            <PackageCheck size={18} color={colors.amber.deep} strokeWidth={2} />
            <Text style={{ flex: 1, fontSize: 12.5, color: colors.gray, lineHeight: 17 }}>
              {t('orderDetail.confirmStockHint')}
            </Text>
          </View>
        )}

        <Card title={t('orderDetail.customer')}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>
            {o.user?.name ?? '—'}
          </Text>
          {o.address_snapshot && (
            <Text style={{ fontSize: 13, color: colors.gray, lineHeight: 19 }}>
              {[
                o.address_snapshot.street_line_1,
                o.address_snapshot.street_line_2,
                o.address_snapshot.postcode,
                o.address_snapshot.city,
              ].filter(Boolean).join(', ')}
            </Text>
          )}
        </Card>

        <Card title={t('orderDetail.rider')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Truck size={17} color={rider ? colors.brand.DEFAULT : colors.muted} strokeWidth={1.75} />
            <Text style={{ flex: 1, fontSize: 14, fontWeight: rider ? '600' : '400', color: rider ? colors.ink : colors.muted }}>
              {rider?.name ?? t('orderDetail.noRider')}
            </Text>
            <Pressable onPress={() => setRiderSheet(true)} hitSlop={8}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: colors.brand.DEFAULT }}>
                {rider ? t('orderDetail.changeRider') : t('orderDetail.assignRider')}
              </Text>
            </Pressable>
          </View>
        </Card>

        <Card title={`${t('orderDetail.items')} (${o.items?.length ?? 0})`}>
          <View style={{ gap: 10 }}>
            {(o.items ?? []).map((it) => (
              <View key={it.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: colors.brand.DEFAULT, minWidth: 26, fontFamily: 'JetBrainsMono' }}>
                  {it.quantity}×
                </Text>
                <Text style={{ flex: 1, fontSize: 13.5, color: colors.ink, lineHeight: 18 }}>
                  {it.product_snapshot?.name_es ?? it.product_snapshot?.name_en ?? '—'}
                </Text>
                <Text style={{ fontSize: 13.5, fontWeight: '600', color: colors.gray }}>
                  {'€'}{Number(it.line_total ?? 0).toFixed(2)}
                </Text>
              </View>
            ))}
          </View>

          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 4 }} />

          <Money label={t('orderDetail.subtotal')} value={Number(o.subtotal ?? 0)} />
          <Money
            label={t('orderDetail.delivery')}
            value={Number(o.delivery_fee ?? 0)}
            free={Number(o.delivery_fee ?? 0) === 0 ? t('orderDetail.free') : undefined}
          />
          <Money label={t('orderDetail.total')} value={Number(o.total ?? 0)} bold />
        </Card>

        {o.customer_notes ? (
          <Card title={t('orderDetail.notes')}>
            <Text style={{ fontSize: 13.5, color: colors.gray, lineHeight: 20 }}>{o.customer_notes}</Text>
          </Card>
        ) : null}
      </ScrollView>

      {/* Actions pinned within thumb reach. Cancel is separated from the
          primary action and rendered as text, not a filled button — it should
          take a deliberate look to find, not a misplaced thumb. */}
      {(next || isDraft || canCancel) && (
        <View style={{
          padding: 16, paddingBottom: 24, gap: 10,
          backgroundColor: colors.surface.cream,
          borderTopWidth: 1, borderTopColor: colors.border,
        }}>
          {isDraft ? (
            <PrimaryButton
              label={t('orderDetail.confirmStock')}
              busy={busy}
              onPress={() => confirmStock.mutate(id, {
                onSuccess: () => toast.success(t('orderDetail.stockConfirmed')),
                onError: fail,
              })}
            />
          ) : next ? (
            <PrimaryButton
              label={t(`orderDetail.advance.${next}`)}
              busy={busy}
              onPress={() => advance.mutate({ id, status: next }, {
                onSuccess: () => toast.success(t('orderDetail.statusUpdated')),
                onError: fail,
              })}
            />
          ) : null}

          {canCancel && (
            <Pressable
              onPress={() => { setReason(''); setCancelSheet(true); }}
              disabled={busy}
              style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.danger }}>
                {t('orderDetail.cancel')}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* ── rider picker ─────────────────────────────── */}
      <Sheet visible={riderSheet} onClose={() => setRiderSheet(false)} title={t('orderDetail.rider')}>
        {riders.isLoading ? (
          <ActivityIndicator color={colors.brand.DEFAULT} style={{ paddingVertical: 20 }} />
        ) : (riders.data ?? []).length === 0 ? (
          <Text style={{ fontSize: 13.5, color: colors.muted, paddingVertical: 16, textAlign: 'center' }}>
            {t('orderDetail.noRiders')}
          </Text>
        ) : (
          <>
            {(riders.data ?? []).map((r) => (
              <Pressable
                key={r.id}
                onPress={() => assign.mutate({ id, riderId: r.id }, {
                  onSuccess: () => { setRiderSheet(false); toast.success(t('orderDetail.riderAssigned')); },
                  onError: () => { setRiderSheet(false); fail(); },
                })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, minHeight: 52 }}
              >
                <Truck size={17} color={colors.gray} strokeWidth={1.75} />
                <Text style={{ flex: 1, fontSize: 14.5, color: colors.ink, fontWeight: '500' }}>{r.name}</Text>
                {rider?.id === r.id && <Check size={17} color={colors.brand.DEFAULT} strokeWidth={2.5} />}
              </Pressable>
            ))}
            {rider && (
              <Pressable
                onPress={() => assign.mutate({ id, riderId: null }, {
                  onSuccess: () => { setRiderSheet(false); toast.success(t('orderDetail.riderAssigned')); },
                  onError: () => { setRiderSheet(false); fail(); },
                })}
                style={{ paddingVertical: 14, minHeight: 52, justifyContent: 'center' }}
              >
                <Text style={{ fontSize: 14, fontWeight: '600', color: colors.danger }}>
                  {t('orderDetail.unassign')}
                </Text>
              </Pressable>
            )}
          </>
        )}
      </Sheet>

      {/* ── cancel, with a required reason ───────────── */}
      <Sheet visible={cancelSheet} onClose={() => setCancelSheet(false)} title={t('orderDetail.cancelTitle')}>
        <Text style={{ fontSize: 13, color: colors.gray, marginBottom: 10 }}>{t('orderDetail.cancelReason')}</Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder={t('orderDetail.cancelPlaceholder')}
          placeholderTextColor={colors.muted}
          multiline
          style={{
            minHeight: 88, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
            padding: 12, fontSize: 14, color: colors.ink, textAlignVertical: 'top',
            backgroundColor: colors.surface.linen,
          }}
        />
        {/* The server requires 5 characters. Saying so up front beats a round
            trip that comes back as a generic failure. */}
        {reason.trim().length > 0 && reason.trim().length < 5 && (
          <Text style={{ fontSize: 12, color: colors.danger, marginTop: 6 }}>
            {t('orderDetail.cancelTooShort')}
          </Text>
        )}
        <View style={{ gap: 8, marginTop: 14 }}>
          <Pressable
            disabled={reason.trim().length < 5 || busy}
            onPress={() => cancel.mutate({ id, reason: reason.trim() }, {
              onSuccess: () => { setCancelSheet(false); toast.success(t('orderDetail.orderCancelled')); },
              onError: () => { setCancelSheet(false); fail(); },
            })}
            style={{
              minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              backgroundColor: reason.trim().length < 5 ? colors.surface.sand : colors.danger,
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: '700', color: reason.trim().length < 5 ? colors.muted : '#FFFFFF' }}>
              {t('orderDetail.cancelConfirm')}
            </Text>
          </Pressable>
          <Pressable onPress={() => setCancelSheet(false)} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.gray }}>{t('orderDetail.cancelBack')}</Text>
          </Pressable>
        </View>
      </Sheet>
    </Screen>
  );
}

/* ── chrome ─────────────────────────────────────────────── */

function Screen({
  children, onBack, title, mono,
}: {
  children: React.ReactNode; onBack: () => void; title: string; mono?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.linen }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: 12, paddingTop: insets.top + 10, paddingBottom: 12,
        backgroundColor: colors.surface.cream, borderBottomWidth: 1, borderBottomColor: colors.border,
      }}>
        <Pressable onPress={onBack} hitSlop={10} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
          <ArrowLeft size={21} color={colors.ink} strokeWidth={2} />
        </Pressable>
        <Text style={{
          fontSize: mono ? 15 : 17, fontWeight: '700', color: colors.ink,
          fontFamily: mono ? 'JetBrainsMono' : undefined,
        }}>
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: colors.surface.cream, borderRadius: 14, padding: 14,
      borderWidth: 1, borderColor: colors.border, gap: 8,
    }}>
      <Text style={{ fontSize: 11.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: colors.muted }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Money({ label, value, bold, free }: { label: string; value: number; bold?: boolean; free?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ fontSize: bold ? 14.5 : 13, fontWeight: bold ? '700' : '400', color: bold ? colors.ink : colors.gray }}>
        {label}
      </Text>
      <Text style={{ fontSize: bold ? 16 : 13.5, fontWeight: bold ? '700' : '600', color: bold ? colors.ink : colors.gray }}>
        {free ?? `€${value.toFixed(2)}`}
      </Text>
    </View>
  );
}

function PrimaryButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={{
        minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
        backgroundColor: busy ? colors.brand.light : colors.brand.DEFAULT,
      }}
    >
      {busy
        ? <ActivityIndicator color="#FFFFFF" />
        : <Text style={{ fontSize: 15, fontWeight: '700', color: '#FFFFFF' }}>{label}</Text>}
    </Pressable>
  );
}

function Sheet({
  visible, onClose, title, children,
}: {
  visible: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' }} onPress={onClose} />
      <View style={{
        backgroundColor: colors.surface.cream,
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: 20, paddingBottom: 32, gap: 4,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <X size={19} color={colors.muted} strokeWidth={2} />
          </Pressable>
        </View>
        {children}
      </View>
    </Modal>
  );
}
