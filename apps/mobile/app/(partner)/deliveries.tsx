import { useState } from 'react';
import {
  View, Text, FlatList, Pressable, TextInput, Modal, ActivityIndicator,
  RefreshControl, Linking, KeyboardAvoidingView, Platform,
} from 'react-native';
import {
  CalendarDays, Calendar, MapPin, Phone, Truck, AlertTriangle, X, ChevronDown,
} from 'lucide-react-native';
import {
  usePartnerRashanDeliveries, useSetPartnerDeliveryStatus,
  useAssignPartnerDeliveryRider, usePartnerRiders,
  type PartnerDeliveryRow, type SubDeliveryStatus,
} from '@grocery-app/shared';
import { colors } from '@/constants/colors';
import { usePartnerT } from '@/partner/lib/i18n';
import { useToast } from '@/components/Toast';
import Skeleton from '@/components/Skeleton';
import {
  PartnerTabBar, SearchField, FilterChips, PickerSheet, Pager,
  Centered, PrimaryButton, StatusPill,
} from '@/partner/components/ui';

/**
 * The partner's rashan delivery queue — every cycle due from a subscription
 * to one of their packs, and the rider on it.
 *
 * Web presents this as a nine-column table with two dropdowns per row. That
 * does not survive a phone, and the phone is where this screen actually gets
 * used: standing in the shop working through what is due today. So each
 * delivery is a card, and the two things you do to one — move it forward, put
 * someone on it — are a single tap each, opening a sheet rather than a menu
 * that would sit under the thumb.
 *
 * ALLOWED_TRANSITIONS mirrors the server's map, as web's copy does. The server
 * stays authoritative; this exists so the sheet only offers moves that will
 * actually be accepted.
 */

const PAGE_SIZE = 20;

const FILTERS: ('all' | SubDeliveryStatus)[] = [
  'all', 'scheduled', 'awaiting_confirmation', 'confirmed',
  'preparing', 'on_the_way', 'delivered', 'skipped', 'failed',
];

const ALLOWED_TRANSITIONS: Record<SubDeliveryStatus, SubDeliveryStatus[]> = {
  scheduled:             ['awaiting_confirmation', 'confirmed', 'skipped'],
  awaiting_confirmation: ['confirmed', 'skipped'],
  confirmed:             ['preparing', 'skipped'],
  preparing:             ['on_the_way', 'failed'],
  on_the_way:            ['delivered', 'failed'],
  delivered:             [],
  skipped:               [],
  failed:                [],
};

/** Pill colours per status. Mirrors web's STATUS_PILL. */
const PILL: Record<SubDeliveryStatus, { bg: string; fg: string }> = {
  scheduled:             { bg: colors.surface.linen, fg: colors.charcoal },
  awaiting_confirmation: { bg: colors.infoBg,        fg: colors.info },
  confirmed:             { bg: colors.infoBg,        fg: colors.info },
  preparing:             { bg: colors.amber.mist,    fg: colors.amber.deep },
  on_the_way:            { bg: colors.amber.mist,    fg: colors.amber.deep },
  delivered:             { bg: colors.successBg,     fg: colors.success },
  skipped:               { bg: colors.surface.linen, fg: colors.muted },
  failed:                { bg: colors.dangerBg,      fg: colors.danger },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

/** Today and tomorrow are what the queue is usually about, so they get a word
 *  rather than a date the reader has to compare against a mental calendar. */
function dayLabel(iso: string, t: (k: string) => string): string | null {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000,
  );
  if (days === 0) return t('rashanDeliveries.today');
  if (days === 1) return t('rashanDeliveries.tomorrow');
  if (days < 0) return t('rashanDeliveries.overdue');
  return null;
}

export default function PartnerRashanDeliveries() {
  const t = usePartnerT();
  const toast = useToast();

  const [status, setStatus] = useState<'all' | SubDeliveryStatus>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [acting, setActing] = useState<PartnerDeliveryRow | null>(null);
  const [assigning, setAssigning] = useState<PartnerDeliveryRow | null>(null);
  const [failing, setFailing] = useState<PartnerDeliveryRow | null>(null);

  const deliveries = usePartnerRashanDeliveries({
    status: status === 'all' ? undefined : status,
    q: q.trim() || undefined,
    page,
    limit: PAGE_SIZE,
  });
  const riders = usePartnerRiders({ activeOnly: true });
  const setDeliveryStatus = useSetPartnerDeliveryStatus();
  const assignRider = useAssignPartnerDeliveryRider();

  const rows = deliveries.data?.items ?? [];
  const total = deliveries.data?.total ?? 0;
  const totalPages = deliveries.data?.totalPages ?? 1;

  // Any filter change resets to page 1 — a narrower filter can otherwise
  // strand you on a page that no longer exists. Same guard web uses.
  function filterBy(next: 'all' | SubDeliveryStatus) { setStatus(next); setPage(1); }
  function searchFor(next: string) { setQ(next); setPage(1); }

  function runMove(row: PartnerDeliveryRow, next: SubDeliveryStatus, failureReason?: string) {
    setDeliveryStatus.mutate({ id: row.id, status: next, failureReason }, {
      onSuccess: () => toast.success(t(`rashanDeliveries.moved.${next}`)),
      onError: () => toast.error(t('rashanDeliveries.moveFailed')),
    });
  }

  function moveTo(row: PartnerDeliveryRow, next: SubDeliveryStatus) {
    setActing(null);
    // A failure reason is shown to the customer, so it is never sent blank and
    // never sent silently. This used to branch on platform — Alert.prompt on
    // iOS, a sheet on Android, which has no prompt at all — and that left one
    // platform asking for it in the OS's own dialog while the other used ours.
    // Both get the sheet now: same wording, same styling, one code path.
    if (next === 'failed') {
      setFailing(row);
      return;
    }
    runMove(row, next);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface.linen }}>
      <PartnerTabBar title={t('rashanDeliveries.title')} />
      {/* Search and filters stay pinned under the bar; only the queue scrolls.
          On a screen whose job is narrowing a list, the controls should not
          scroll away from it. */}
      <View style={{
        paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, gap: 10,
        backgroundColor: colors.surface.cream,
        borderBottomWidth: 1, borderBottomColor: colors.border,
      }}>
        <SearchField
          value={q}
          onChangeText={searchFor}
          placeholder={t('rashanDeliveries.searchPlaceholder')}
        />
        <FilterChips
          options={FILTERS}
          value={status}
          labelFor={(s) => t(`rashanDeliveries.status.${s}`)}
          onChange={filterBy}
        />
        {/* The count sits with the list it counts, the way products does it,
            rather than stacked over the title as a second line of chrome. */}
        {total > 0 && (
          <Text style={{ fontSize: 12, color: colors.muted }}>
            {t('rashanDeliveries.count').replace('{{n}}', String(total))}
          </Text>
        )}
      </View>

      {deliveries.isError ? (
        <Centered>
          <AlertTriangle size={22} color={colors.danger} strokeWidth={2} />
          <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>{t('rashanDeliveries.loadFailed')}</Text>
          <PrimaryButton label={t('rashanDeliveries.retry')} onPress={() => void deliveries.refetch()} />
        </Centered>
      ) : deliveries.isLoading ? (
        <View style={{ padding: 16, gap: 10 }}>
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} height={132} borderRadius={12} />)}
        </View>
      ) : rows.length === 0 ? (
        <Centered>
          <CalendarDays size={26} color={colors.muted} strokeWidth={1.75} />
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink }}>{t('rashanDeliveries.empty')}</Text>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', maxWidth: 280, lineHeight: 18 }}>
            {status !== 'all' || q.trim()
              ? t('rashanDeliveries.emptyFiltered')
              : t('rashanDeliveries.emptyHint')}
          </Text>
        </Centered>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          refreshControl={
            <RefreshControl refreshing={deliveries.isRefetching} onRefresh={() => void deliveries.refetch()} tintColor={colors.brand.DEFAULT} />
          }
          ListFooterComponent={<Pager page={page} totalPages={totalPages} onChange={setPage} />}
          renderItem={({ item }) => (
            <DeliveryCard
              row={item}
              t={t}
              busy={setDeliveryStatus.isPending || assignRider.isPending}
              onMove={() => setActing(item)}
              onAssign={() => setAssigning(item)}
            />
          )}
        />
      )}

      {/* Move-forward sheet — only the transitions the server will accept. */}
      <PickerSheet
        visible={acting !== null}
        title={t('rashanDeliveries.moveTitle')}
        onClose={() => setActing(null)}
        options={(acting ? ALLOWED_TRANSITIONS[acting.status] : []).map((s) => ({
          key: s,
          label: t(`rashanDeliveries.moveTo.${s}`),
          danger: s === 'failed' || s === 'skipped',
        }))}
        onPick={(key) => { if (acting) moveTo(acting, key as SubDeliveryStatus); }}
      />

      {/* Rider sheet. "Unassigned" is a real choice, not an absence. */}
      <PickerSheet
        visible={assigning !== null}
        title={t('rashanDeliveries.riderTitle')}
        onClose={() => setAssigning(null)}
        selectedKey={assigning?.rider_id ?? '__none__'}
        options={[
          { key: '__none__', label: t('rashanDeliveries.unassigned') },
          ...(riders.data ?? []).map((r) => ({ key: r.id, label: r.name })),
        ]}
        emptyLabel={t('rashanDeliveries.noRiders')}
        onPick={(key) => {
          const row = assigning;
          setAssigning(null);
          if (!row) return;
          assignRider.mutate({ id: row.id, riderId: key === '__none__' ? null : key }, {
            onSuccess: () => toast.success(t('rashanDeliveries.riderSaved')),
            onError: () => toast.error(t('rashanDeliveries.riderFailed')),
          });
        }}
      />

      <FailSheet
        key={failing?.id ?? 'closed'}
        row={failing}
        t={t}
        busy={setDeliveryStatus.isPending}
        onClose={() => setFailing(null)}
        onConfirm={(reason) => {
          const row = failing;
          setFailing(null);
          if (row) runMove(row, 'failed', reason);
        }}
      />
    </View>
  );
}

/* ── pieces ─────────────────────────────────────────────── */

function DeliveryCard({
  row, t, busy, onMove, onAssign,
}: {
  row: PartnerDeliveryRow;
  t: (k: string) => string;
  busy: boolean;
  onMove: () => void;
  onAssign: () => void;
}) {
  const pill = PILL[row.status];
  const day = dayLabel(row.scheduled_date, t);
  const overdue = day === t('rashanDeliveries.overdue');
  const canMove = ALLOWED_TRANSITIONS[row.status].length > 0;
  const sub = row.subscription;

  return (
    <View style={{
      backgroundColor: colors.surface.cream, borderRadius: 12, padding: 14, gap: 10,
      borderWidth: 1, borderColor: overdue ? colors.danger : colors.border,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Calendar size={13} color={colors.muted} strokeWidth={1.75} />
            <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }}>
              {formatDate(row.scheduled_date)}
            </Text>
            {day && (
              <View style={{
                paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999,
                backgroundColor: overdue ? colors.dangerBg : colors.brand.mist,
              }}>
                <Text style={{ fontSize: 9.5, fontWeight: '700', color: overdue ? colors.danger : colors.brand.deepest }}>
                  {day}
                </Text>
              </View>
            )}
          </View>
          <Text style={{ fontSize: 14.5, fontWeight: '700', color: colors.ink }} numberOfLines={1}>
            {sub.user.name}
          </Text>
          <Text style={{ fontSize: 12.5, color: colors.gray }} numberOfLines={1}>
            {sub.pack?.name_es ?? t('rashanDeliveries.customPack')}
            {'  ·  '}
            {t('rashanDeliveries.items').replace('{{n}}', String(row.item_count))}
            {'  ·  '}
            {Number(row.total).toFixed(2).replace('.', ',')} €
          </Text>
        </View>
        <StatusPill label={t(`rashanDeliveries.status.${row.status}`)} bg={pill.bg} fg={pill.fg} />
      </View>

      <View style={{ gap: 4 }}>
        {sub.user.phone && (
          <Pressable
            onPress={() => void Linking.openURL(`tel:${sub.user.phone}`)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            hitSlop={6}
          >
            <Phone size={11} color={colors.muted} strokeWidth={2} />
            <Text style={{ fontSize: 12, color: colors.brand.DEFAULT, fontFamily: 'JetBrainsMono' }}>
              {sub.user.phone}
            </Text>
          </Pressable>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          <MapPin size={11} color={colors.muted} strokeWidth={2} style={{ marginTop: 2 }} />
          <Text style={{ flex: 1, fontSize: 12, color: colors.gray }} numberOfLines={2}>
            {sub.address.street_line_1}, {sub.address.postcode} {sub.address.city}
          </Text>
        </View>
      </View>

      {row.failure_reason && (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 8, borderRadius: 8, backgroundColor: colors.dangerBg }}>
          <AlertTriangle size={12} color={colors.danger} strokeWidth={2} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, fontSize: 11.5, color: colors.danger }}>{row.failure_reason}</Text>
        </View>
      )}

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          onPress={onAssign}
          disabled={busy}
          style={{
            flex: 1, minHeight: 42, borderRadius: 10, flexDirection: 'row',
            alignItems: 'center', justifyContent: 'center', gap: 6,
            borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface.linen,
            opacity: busy ? 0.5 : 1,
          }}
        >
          <Truck size={14} color={row.rider ? colors.brand.DEFAULT : colors.muted} strokeWidth={1.75} />
          <Text style={{ fontSize: 12.5, fontWeight: '600', color: row.rider ? colors.ink : colors.muted }} numberOfLines={1}>
            {row.rider?.name ?? t('rashanDeliveries.unassigned')}
          </Text>
        </Pressable>
        {canMove && (
          <Pressable
            onPress={onMove}
            disabled={busy}
            style={{
              flex: 1, minHeight: 42, borderRadius: 10, flexDirection: 'row',
              alignItems: 'center', justifyContent: 'center', gap: 6,
              backgroundColor: colors.brand.DEFAULT, opacity: busy ? 0.5 : 1,
            }}
          >
            <Text style={{ fontSize: 12.5, fontWeight: '700', color: '#FFFFFF' }}>
              {t('rashanDeliveries.move')}
            </Text>
            <ChevronDown size={14} color="#FFFFFF" strokeWidth={2.5} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

/**
 * The failure reason is customer-visible, so it gets a real field rather than
 * an OS prompt — on both platforms, so the wording and the styling match.
 * Remounted per subject via a key on the parent so a second failure does not
 * inherit the previous one's text.
 */
function FailSheet({
  row, t, busy, onClose, onConfirm,
}: {
  row: PartnerDeliveryRow | null;
  t: (k: string) => string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  return (
    <Modal visible={row !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' }} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{
          backgroundColor: colors.surface.cream,
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: 20, paddingBottom: 32, gap: 12,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{t('rashanDeliveries.failTitle')}</Text>
            <Pressable onPress={onClose} hitSlop={10}><X size={19} color={colors.muted} strokeWidth={2} /></Pressable>
          </View>
          <Text style={{ fontSize: 12.5, color: colors.muted, lineHeight: 17 }}>{t('rashanDeliveries.failPrompt')}</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            autoFocus
            multiline
            style={{
              borderWidth: 1, borderColor: colors.border, borderRadius: 10,
              paddingHorizontal: 12, paddingTop: 10, minHeight: 80,
              fontSize: 14, color: colors.ink, backgroundColor: colors.surface.linen,
              textAlignVertical: 'top',
            }}
          />
          <Pressable
            onPress={() => { if (reason.trim()) onConfirm(reason.trim()); }}
            disabled={busy || !reason.trim()}
            style={{
              minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
              backgroundColor: !reason.trim() ? colors.surface.sand : colors.danger,
            }}
          >
            {busy
              ? <ActivityIndicator color="#FFFFFF" />
              : (
                <Text style={{ fontSize: 15, fontWeight: '700', color: !reason.trim() ? colors.muted : '#FFFFFF' }}>
                  {t('rashanDeliveries.confirm')}
                </Text>
              )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
