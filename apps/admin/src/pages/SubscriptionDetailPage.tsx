import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useGoBack } from '@/lib/useGoBack';
import { Phone, Mail, MapPin, Calendar, Package, Save, Pause, Play, XCircle, Bell, Repeat, Users, CreditCard, CheckCircle2, Clock, Truck, SkipForward, AlertTriangle } from 'lucide-react';
import {
  useAdminSubscription,
  useAdminUpdateSubscription,
  useAdminRiders,
  useAssignSubDeliveryRider,
  resolveImageUrl,
} from '@grocery-app/shared';
import type { RashanSubStatus, SubDeliveryStatus } from '@grocery-app/shared';
import { useTranslation } from 'react-i18next';
import BackLink from '@/components/BackLink';

const SUB_STATUS_PILL: Record<RashanSubStatus, string> = {
  active: 'bg-success-bg text-success',
  paused: 'bg-amber-mist text-amber-deep',
  cancelled: 'bg-danger-bg text-danger',
};

const DELIVERY_STATUS_PILL: Record<SubDeliveryStatus, string> = {
  scheduled: 'bg-surface-linen text-charcoal',
  awaiting_confirmation: 'bg-info-bg text-info',
  confirmed: 'bg-info-bg text-info',
  preparing: 'bg-amber-mist text-amber-deep',
  on_the_way: 'bg-amber-mist text-amber-deep',
  delivered: 'bg-success-bg text-success',
  skipped: 'bg-surface-linen text-muted',
  failed: 'bg-danger-bg text-danger',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function SubscriptionDetailPage() {
  const { t } = useTranslation();
  // Route param is named :subscriptionId in App.tsx
  const { subscriptionId: id } = useParams<{ subscriptionId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const { data: sub, isLoading, error: subError, refetch } = useAdminSubscription(id);
  const { data: riders = [] } = useAdminRiders(true);
  const assignRider = useAssignSubDeliveryRider();
  const updateSub = useAdminUpdateSubscription();

  const [adminNotes, setAdminNotes] = useState('');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (sub) setAdminNotes(sub.admin_notes ?? '');
  }, [sub]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-muted font-display text-sm">Loading subscription…</p>
      </div>
    );
  }

  // Same fix as OrderDetailPage: an errored react-query has isLoading false
  // and data undefined, so folding the two together rendered "Loading…"
  // forever on a 500 and made a server error look like a slow page.
  if (subError || !sub) {
    const message = subError instanceof Error ? subError.message : null;
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-center px-6">
        <XCircle size={32} strokeWidth={1.75} className="text-danger" />
        <p className="text-ink font-display font-semibold">
          {subError ? "Couldn't load this subscription" : 'Subscription not found'}
        </p>
        {message && (
          <p className="text-xs text-muted font-body max-w-md break-words">{message}</p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={() => refetch()}
            className="h-10 px-4 rounded-lg bg-ink text-card text-sm font-display font-semibold hover:bg-ink/90 transition-colors"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => navigate('/rashan/subscriptions')}
            className="h-10 px-4 rounded-lg border border-border bg-card text-sm font-display font-semibold text-ink hover:bg-surface-cream transition-colors"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  async function setStatus(status: RashanSubStatus) {
    if (!sub) return;
    try {
      await updateSub.mutateAsync({ id: sub.id, payload: { status } });
    } catch (err) { console.error(err); }
  }

  async function toggleNeedsConfirm() {
    if (!sub) return;
    try {
      await updateSub.mutateAsync({ id: sub.id, payload: { needs_confirmation: !sub.needs_confirmation } });
    } catch (err) { console.error(err); }
  }

  async function saveNotes() {
    if (!sub) return;
    try {
      await updateSub.mutateAsync({ id: sub.id, payload: { admin_notes: adminNotes } });
      setSavedAt(Date.now());
    } catch (err) { console.error(err); }
  }

  return (
    <div>
      <BackLink
        label={t('common.backToSubscriptions', 'Back to subscriptions')}
        onClick={() => goBack('/subscriptions')}
        className="mb-6"
      />

      <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">
            {sub.pack?.name_en ?? sub.pack_slug ?? 'Custom pack'}
          </h1>
          <p className="text-sm text-muted mt-1">
            {sub.user.name} · {sub.frequency.replace(/_/g, ' ')} · €{Number(sub.total_per_cycle).toFixed(2)}/cycle
          </p>
        </div>
        <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-bold font-display uppercase tracking-wider ${SUB_STATUS_PILL[sub.status]}`}>
          {t(`subscriptions.status.${sub.status}`, sub.status)}
        </span>
      </div>

      {/* Live "Next delivery" banner — at-a-glance state of the active cycle */}
      <NextDeliveryBanner sub={sub} />

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Items + Deliveries */}
        <div className="lg:col-span-2 space-y-6">
          {/* Items */}
          <section className="bg-card rounded-xl border border-border p-5">
            <h2 className="text-base font-bold font-display text-ink mb-4">Items in this pack</h2>
            <div className="divide-y divide-border/50">
              {(sub.items_resolved ?? []).map((it) => {
                const lineTotal = Number(it.variant?.price ?? 0) * it.quantity;
                return (
                  <div key={it.variant_id} className="flex items-center gap-3 py-3">
                    <div className="w-12 h-12 rounded-lg bg-surface-cream overflow-hidden flex items-center justify-center shrink-0 border border-border/40">
                      {it.product?.image_url ? (
                        <img src={resolveImageUrl(it.product.image_url, 'thumb')} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Package size={16} className="text-muted" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-ink font-display truncate">
                        {it.product?.name_es ?? it.product_id.slice(0, 8)}
                      </p>
                      <p className="text-xs text-muted font-mono">
                        {it.variant?.name_es ?? it.variant_id.slice(0, 8)}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-brand-mist text-brand text-xs font-bold font-display">×{it.quantity}</span>
                    <span className="w-20 text-right text-sm font-bold text-ink font-display">€{lineTotal.toFixed(2)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Deliveries timeline */}
          <section className="bg-card rounded-xl border border-border p-5">
            <h2 className="text-base font-bold font-display text-ink mb-4">Delivery history</h2>
            {sub.deliveries.length === 0 ? (
              <p className="text-sm text-muted font-body">No deliveries yet.</p>
            ) : (
              <>
              {/* ON A PHONE (2026-11-05): a list — six columns scrolled sideways
                  inside the card and took the rider select, the one thing to
                  do here, out of sight. Same select, same handler, same locked
                  states; the table from sm. */}
              <ul className="sm:hidden divide-y divide-border/40">
                {sub.deliveries.map((d) => {
                  const isLocked = ['delivered', 'skipped', 'failed'].includes(d.status);
                  return (
                    <li key={d.id} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold font-display text-ink whitespace-nowrap">{formatDate(d.scheduled_date)}</span>
                        <span className="ml-auto text-sm font-semibold font-display text-ink tabular-nums shrink-0">€{Number(d.total).toFixed(2)}</span>
                      </div>
                      <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold font-display uppercase ${DELIVERY_STATUS_PILL[d.status]}`}>{d.status.replace(/_/g, ' ')}</span>
                        <span className="text-[11.5px] text-muted font-display">
                          Items {d.item_count}
                          {'  ·  '}Order{' '}
                          <span className="font-mono">{d.order?.order_number ?? (d.order_id ? d.order_id.slice(0, 8) : '—')}</span>
                        </span>
                      </div>
                      <div className="mt-2">
                        {isLocked ? (
                          <p className="text-xs font-display text-charcoal">
                            Rider: {d.rider ? d.rider.name : <span className="text-muted">Unassigned</span>}
                          </p>
                        ) : (
                          <select
                            value={d.rider_id ?? ''}
                            onChange={(e) =>
                              assignRider.mutate({ id: d.id, riderId: e.target.value || null })
                            }
                            disabled={assignRider.isPending}
                            aria-label="Rider"
                            className="w-full h-10 px-2 rounded-lg bg-surface-cream border border-border text-xs font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
                          >
                            <option value="">— Unassigned —</option>
                            {riders.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name} · {r.vehicle_type}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              <div className="hidden sm:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-cream">
                      <th className="text-left text-xs font-semibold text-gray uppercase px-3 py-2 font-display">Date</th>
                      <th className="text-left text-xs font-semibold text-gray uppercase px-3 py-2 font-display">Status</th>
                      <th className="text-left text-xs font-semibold text-gray uppercase px-3 py-2 font-display">Items</th>
                      <th className="text-right text-xs font-semibold text-gray uppercase px-3 py-2 font-display">Total</th>
                      <th className="text-left text-xs font-semibold text-gray uppercase px-3 py-2 font-display">Rider</th>
                      <th className="text-left text-xs font-semibold text-gray uppercase px-3 py-2 font-display">Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sub.deliveries.map((d) => {
                      const isLocked = ['delivered', 'skipped', 'failed'].includes(d.status);
                      return (
                        <tr key={d.id} className="border-t border-border/40">
                          <td className="px-3 py-2.5 font-display text-ink">{formatDate(d.scheduled_date)}</td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold font-display uppercase ${DELIVERY_STATUS_PILL[d.status]}`}>{d.status.replace(/_/g, ' ')}</span>
                          </td>
                          <td className="px-3 py-2.5 font-display text-gray">{d.item_count}</td>
                          <td className="px-3 py-2.5 font-display text-ink text-right">€{Number(d.total).toFixed(2)}</td>
                          <td className="px-3 py-2.5">
                            {isLocked ? (
                              <span className="text-xs font-display text-charcoal">
                                {d.rider ? d.rider.name : <span className="text-muted">Unassigned</span>}
                              </span>
                            ) : (
                              <select
                                value={d.rider_id ?? ''}
                                onChange={(e) =>
                                  assignRider.mutate({ id: d.id, riderId: e.target.value || null })
                                }
                                disabled={assignRider.isPending}
                                className="h-8 px-2 rounded-md bg-surface-cream border border-border text-xs font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 disabled:opacity-50"
                              >
                                <option value="">— Unassigned —</option>
                                {riders.map((r) => (
                                  <option key={r.id} value={r.id}>
                                    {r.name} · {r.vehicle_type}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-muted">
                            {d.order?.order_number ?? (d.order_id ? d.order_id.slice(0, 8) : '—')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </section>

          {/* Admin notes */}
          <section className="bg-card rounded-xl border border-border p-5">
            <h2 className="text-base font-bold font-display text-ink mb-3">Admin notes</h2>
            <textarea
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              rows={3}
              placeholder="Internal notes about this subscription…"
              className="w-full p-3 bg-surface-cream border border-border rounded-lg text-sm font-body text-ink resize-none focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <div className="flex items-center justify-between mt-3">
              {savedAt && <span className="text-xs text-success font-display">Saved.</span>}
              <button
                onClick={saveNotes}
                disabled={updateSub.isPending}
                className="ml-auto h-9 px-3 rounded-lg bg-brand text-white text-xs font-bold font-display hover:bg-brand-mid inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Save size={13} strokeWidth={2} /> Save
              </button>
            </div>
          </section>
        </div>

        {/* Right: actions + customer */}
        <aside className="space-y-6">
          {/* Actions */}
          <section className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-bold font-display text-ink uppercase tracking-wider mb-4">Manage</h3>
            <div className="space-y-2">
              {sub.status === 'active' ? (
                <button onClick={() => setStatus('paused')} disabled={updateSub.isPending} className="w-full h-10 px-4 rounded-lg border-2 border-amber text-amber-deep text-sm font-bold font-display hover:bg-amber-mist transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50">
                  <Pause size={14} strokeWidth={2} /> Pause subscription
                </button>
              ) : sub.status === 'paused' ? (
                <button onClick={() => setStatus('active')} disabled={updateSub.isPending} className="w-full h-10 px-4 rounded-lg border-2 border-success text-success text-sm font-bold font-display hover:bg-success-bg transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50">
                  <Play size={14} strokeWidth={2} /> Resume
                </button>
              ) : null}

              {sub.status !== 'cancelled' && (
                <button onClick={() => setStatus('cancelled')} disabled={updateSub.isPending} className="w-full h-10 px-4 rounded-lg border-2 border-danger text-danger text-sm font-bold font-display hover:bg-danger-bg transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50">
                  <XCircle size={14} strokeWidth={2} /> Cancel
                </button>
              )}

              <button onClick={toggleNeedsConfirm} disabled={updateSub.isPending} className="w-full h-10 px-4 rounded-lg border border-border text-charcoal text-sm font-semibold font-display hover:bg-surface-linen transition-colors inline-flex items-center justify-center gap-2 disabled:opacity-50">
                <Bell size={14} strokeWidth={2} /> {sub.needs_confirmation ? 'Mark confirmed' : 'Flag awaiting'}
              </button>
            </div>
          </section>

          {/* Customer */}
          <section className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-bold font-display text-ink uppercase tracking-wider mb-4">Customer</h3>
            <div className="space-y-3 text-sm">
              <p className="font-bold text-ink font-display">{sub.user.name}</p>
              {sub.user.phone && <p className="flex items-center gap-2 text-gray font-mono"><Phone size={13} /> {sub.user.phone}</p>}
              {sub.user.email && <p className="flex items-center gap-2 text-gray font-body"><Mail size={13} /> {sub.user.email}</p>}
            </div>
            {/* 36px tall to a thumb (py-2.5), still 12px under the phone/email
                and nothing below it moved: the padding is paid back in margin. */}
            <button onClick={() => navigate(`/customers/${sub.user.id}`)} className="mt-0.5 -mb-2.5 py-2.5 px-1 -mx-1 text-xs font-bold text-brand hover:text-brand-mid">
              View customer profile →
            </button>
          </section>

          {/* Address */}
          <section className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-sm font-bold font-display text-ink uppercase tracking-wider mb-4 flex items-center gap-2"><MapPin size={14} /> Address</h3>
            <p className="text-sm font-bold text-ink font-display">{sub.address.contact_name}</p>
            <p className="text-xs text-gray font-mono">{sub.address.contact_phone}</p>
            <p className="text-sm text-charcoal font-body mt-2 leading-relaxed">
              {sub.address.street_line_1}
              {sub.address.street_line_2 && <>, {sub.address.street_line_2}</>}
              <br />
              {sub.address.postcode} {sub.address.city}
            </p>
          </section>

          {/* Settings */}
          <section className="bg-card rounded-xl border border-border p-5 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-gray font-display flex items-center gap-2"><Repeat size={13} /> Frequency</span>
              <span className="font-bold text-ink font-display">{sub.frequency.replace(/_/g, ' ')}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray font-display flex items-center gap-2"><Users size={13} /> Household</span>
              <span className="font-bold text-ink font-display">{sub.household}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray font-display flex items-center gap-2"><CreditCard size={13} /> Payment</span>
              <span className="font-bold text-ink font-display">{sub.payment_method}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray font-display flex items-center gap-2"><Calendar size={13} /> Created</span>
              <span className="font-bold text-ink font-display">{formatDate(sub.created_at)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray font-display">Cycles done</span>
              <span className="font-bold text-ink font-display">{sub.cycles_completed}</span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ─── Next-delivery hero banner ─────────────────────── */

interface NextDeliveryBannerProps {
  sub: {
    status: 'active' | 'paused' | 'cancelled';
    needs_confirmation: boolean;
    deliveries: Array<{
      id: string;
      scheduled_date: string;
      status: SubDeliveryStatus;
      total: number;
      delivered_at: string | null;
    }>;
  };
}

function NextDeliveryBanner({ sub }: NextDeliveryBannerProps) {
  // Find the next *open* delivery, then fall back to the latest closed one.
  const next = sub.deliveries.find((d) =>
    ['scheduled', 'awaiting_confirmation', 'confirmed', 'preparing', 'on_the_way'].includes(d.status),
  );
  const lastClosed = !next
    ? [...sub.deliveries].reverse().find((d) => ['delivered', 'skipped', 'failed'].includes(d.status))
    : null;
  const target = next ?? lastClosed;
  if (!target) return null;

  const meta = bannerMeta(target.status);
  const Icon = meta.icon;
  const date = new Date(target.scheduled_date).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const daysUntil = Math.round(
    (new Date(target.scheduled_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  const dayHint =
    daysUntil < -1 ? `${Math.abs(daysUntil)} days ago` :
    daysUntil === -1 ? 'yesterday' :
    daysUntil === 0 ? 'today' :
    daysUntil === 1 ? 'tomorrow' :
    `in ${daysUntil} days`;

  return (
    <div
      className={`rounded-2xl border-2 p-5 mb-8 flex items-start gap-4 ${meta.containerCls}`}
      role="status"
    >
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${meta.iconCls}`}>
        <Icon size={20} strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className={`text-xs font-bold uppercase tracking-wider ${meta.eyebrowCls}`}>
            {meta.eyebrow}
          </p>
          {target.status === 'confirmed' && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-success uppercase tracking-wider bg-white/60 rounded-full px-2 py-0.5">
              <CheckCircle2 size={10} strokeWidth={2.5} />
              Customer locked it in
            </span>
          )}
        </div>
        <p className="text-base font-bold text-ink font-display mt-1">
          {meta.title}
        </p>
        <p className="text-sm text-charcoal font-body mt-0.5">
          {date} <span className="text-muted">· {dayHint}</span>
          {target.delivered_at && (
            <span className="text-muted"> · delivered at {new Date(target.delivered_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
          )}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[11px] uppercase tracking-wider text-muted font-display font-bold">Total</p>
        <p className="text-lg font-bold text-ink font-display">€{Number(target.total).toFixed(2)}</p>
      </div>
    </div>
  );
}

function bannerMeta(status: SubDeliveryStatus) {
  switch (status) {
    case 'awaiting_confirmation':
      return {
        icon: Bell,
        eyebrow: 'Awaiting customer confirmation',
        title: 'Customer hasn\'t responded yet',
        containerCls: 'bg-info-bg/60 border-info/30',
        iconCls: 'bg-info text-white',
        eyebrowCls: 'text-info',
      };
    case 'confirmed':
      return {
        icon: CheckCircle2,
        eyebrow: 'Confirmed by customer',
        title: 'Ready to prepare and ship',
        containerCls: 'bg-success-bg/60 border-success/30',
        iconCls: 'bg-success text-white',
        eyebrowCls: 'text-success',
      };
    case 'scheduled':
      return {
        icon: Clock,
        eyebrow: 'Next delivery scheduled',
        title: 'On the calendar — no action needed yet',
        containerCls: 'bg-surface-cream border-border',
        iconCls: 'bg-charcoal text-card',
        eyebrowCls: 'text-charcoal',
      };
    case 'preparing':
      return {
        icon: Package,
        eyebrow: 'Preparing',
        title: 'Order being assembled',
        containerCls: 'bg-amber-mist/60 border-amber/30',
        iconCls: 'bg-amber-deep text-white',
        eyebrowCls: 'text-amber-deep',
      };
    case 'on_the_way':
      return {
        icon: Truck,
        eyebrow: 'On the way',
        title: 'Out for delivery',
        containerCls: 'bg-amber-mist/60 border-amber/30',
        iconCls: 'bg-amber-deep text-white',
        eyebrowCls: 'text-amber-deep',
      };
    case 'delivered':
      return {
        icon: CheckCircle2,
        eyebrow: 'Last delivery',
        title: 'Delivered',
        containerCls: 'bg-success-bg/60 border-success/30',
        iconCls: 'bg-success text-white',
        eyebrowCls: 'text-success',
      };
    case 'skipped':
      return {
        icon: SkipForward,
        eyebrow: 'Last cycle',
        title: 'Customer skipped this delivery',
        containerCls: 'bg-surface-cream border-border',
        iconCls: 'bg-muted text-white',
        eyebrowCls: 'text-muted',
      };
    case 'failed':
      return {
        icon: AlertTriangle,
        eyebrow: 'Failed delivery',
        title: 'Last attempt did not complete',
        containerCls: 'bg-danger-bg/60 border-danger/30',
        iconCls: 'bg-danger text-white',
        eyebrowCls: 'text-danger',
      };
  }
}
