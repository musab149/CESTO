import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Plus, Pencil, Bike, Car, Phone, MessageCircle, Trash2,
  X, Truck, Search, Users, CheckCircle2, XCircle, PackageCheck,
  ToggleLeft, ToggleRight, ChevronRight,
} from 'lucide-react';
import {
  useAdminRiders,
  useCreateRider,
  useUpdateRider,
  useDeleteRider,
  useAdminOrders,
  useRiderSubDeliveries,
} from '@grocery-app/shared';
import type { Rider } from '@grocery-app/shared';
import { TableSkeleton } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';
import ConfirmModal from '@/components/ConfirmModal';
import Pagination from '@/components/Pagination';

const PAGE_SIZE = 20;

type VehicleType = 'moto' | 'bicicleta' | 'coche';
type StatusFilter = 'all' | 'active' | 'inactive';
type VehicleFilter = 'all' | VehicleType;

type RiderRow = Rider & { _count?: { orders: number; subscription_deliveries?: number } };

function VehicleIcon({ type, className = '', size = 18 }: { type: VehicleType; className?: string; size?: number }) {
  switch (type) {
    case 'bicicleta': return <Bike size={size} strokeWidth={1.75} className={className} />;
    case 'coche':     return <Car  size={size} strokeWidth={1.75} className={className} />;
    case 'moto':
    default:          return <Truck size={size} strokeWidth={1.75} className={className} />;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface RiderFormData {
  name: string;
  phone: string;
  vehicle_type: VehicleType;
  is_active: boolean;
}

const EMPTY_FORM: RiderFormData = { name: '', phone: '', vehicle_type: 'moto', is_active: true };

const PHONE_REGEX = /^\+?\d{6,15}$/;

function StatCard({ icon, label, value, tone = 'default' }: {
  icon: React.ReactNode; label: string; value: number;
  tone?: 'default' | 'success' | 'danger' | 'brand';
}) {
  const tones: Record<string, string> = {
    default: 'bg-surface-cream text-ink/70',
    success: 'bg-success-bg text-success',
    danger:  'bg-danger-bg text-danger',
    brand:   'bg-brand/10 text-brand',
  };
  return (
    <div className="bg-card rounded-xl border border-border p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tones[tone]}`}>{icon}</div>
      <div>
        <div className="text-xs font-display text-ink/60">{label}</div>
        <div className="text-xl font-bold font-display text-ink leading-tight">{value}</div>
      </div>
    </div>
  );
}

function Toast({ msg, tone }: { msg: string; tone: 'success' | 'danger' }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60]">
      <div className={`px-4 py-2.5 rounded-xl shadow-modal font-display text-sm font-semibold ${
        tone === 'success' ? 'bg-success text-white' : 'bg-danger text-white'
      }`}>{msg}</div>
    </div>
  );
}

export default function RidersPage(
  { embedded, registerCreate }: {
    embedded?: boolean;
    /**
     * Hands this page's "add" action up to whoever drew the heading, so the
     * button can sit beside it. An effect rather than a call during render:
     * assigning to someone else's ref while rendering is a side effect, and
     * this runs after every render so the closure is never stale.
     */
    registerCreate?: (open: () => void) => void;
  } = {},
) {
  const { t } = useTranslation();

  const { data: riders, isLoading } = useAdminRiders();
  const createRider = useCreateRider();
  const updateRider = useUpdateRider();
  const deleteRider = useDeleteRider();

  const [search, setSearch] = useState('');
  const [vehicleFilter, setVehicleFilter] = useState<VehicleFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RiderFormData>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof RiderFormData, string>>>({});

  const [confirmDelete, setConfirmDelete] = useState<RiderRow | null>(null);
  const [blockedDelete, setBlockedDelete] = useState<RiderRow | null>(null);
  const [detailRider, setDetailRider] = useState<RiderRow | null>(null);

  const [toast, setToast] = useState<{ msg: string; tone: 'success' | 'danger' } | null>(null);
  function showToast(msg: string, tone: 'success' | 'danger' = 'success') {
    setToast({ msg, tone });
    window.setTimeout(() => setToast(null), 2200);
  }

  const allRiders = (riders ?? []) as RiderRow[];

  const stats = useMemo(() => {
    const total = allRiders.length;
    const active = allRiders.filter((r) => r.is_active).length;
    const withOrders = allRiders.filter((r) => (r._count?.orders ?? 0) > 0).length;
    return { total, active, inactive: total - active, withOrders };
  }, [allRiders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRiders.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q) && !r.phone.toLowerCase().includes(q)) return false;
      if (vehicleFilter !== 'all' && r.vehicle_type !== vehicleFilter) return false;
      if (statusFilter === 'active' && !r.is_active) return false;
      if (statusFilter === 'inactive' && r.is_active) return false;
      return true;
    });
  }, [allRiders, search, vehicleFilter, statusFilter]);

  const filtersActive = search.trim() !== '' || vehicleFilter !== 'all' || statusFilter !== 'all';

  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, vehicleFilter, statusFilter]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageRiders = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  function getVehicleLabel(type: VehicleType): string { return t(`riders.vehicles.${type}`); }

  function clearFilters() { setSearch(''); setVehicleFilter('all'); setStatusFilter('all'); }

  useEffect(() => { registerCreate?.(openAdd); });

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setShowModal(true);
  }

  function openEdit(rider: Rider) {
    setEditingId(rider.id);
    setForm({
      name: rider.name,
      phone: rider.phone,
      vehicle_type: rider.vehicle_type as VehicleType,
      is_active: rider.is_active,
    });
    setErrors({});
    setShowModal(true);
    setDetailRider(null);
  }

  function validate(): boolean {
    const next: Partial<Record<keyof RiderFormData, string>> = {};
    if (!form.name.trim()) next.name = t('riders.errors.nameRequired');
    const phone = form.phone.trim();
    if (!phone) next.phone = t('riders.errors.phoneRequired');
    else if (!PHONE_REGEX.test(phone)) next.phone = t('riders.errors.phoneInvalid');
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    const payload: Partial<Rider> = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      vehicle_type: form.vehicle_type,
      is_active: form.is_active,
    };
    try {
      if (editingId) {
        await updateRider.mutateAsync({ id: editingId, payload });
        showToast(t('riders.toast.updated'));
      } else {
        await createRider.mutateAsync(payload);
        showToast(t('riders.toast.created'));
      }
      setShowModal(false);
    } catch (err) {
      console.error(err);
      showToast(t('riders.toast.error'), 'danger');
    }
  }

  async function toggleActive(rider: RiderRow) {
    try {
      await updateRider.mutateAsync({ id: rider.id, payload: { is_active: !rider.is_active } });
      showToast(rider.is_active ? t('riders.toast.deactivated') : t('riders.toast.activated'));
    } catch (err) {
      console.error(err);
      showToast(t('riders.toast.error'), 'danger');
    }
  }

  function requestDelete(rider: RiderRow) {
    if ((rider._count?.orders ?? 0) > 0) {
      setBlockedDelete(rider);
      return;
    }
    setConfirmDelete(rider);
  }

  async function confirmDeleteRider() {
    if (!confirmDelete) return;
    try {
      await deleteRider.mutateAsync(confirmDelete.id);
      showToast(t('riders.toast.deleted'));
      if (detailRider?.id === confirmDelete.id) setDetailRider(null);
    } catch (err) {
      console.error(err);
      showToast(t('riders.toast.error'), 'danger');
    } finally {
      setConfirmDelete(null);
    }
  }

  function callRider(phone: string) {
    window.open(`tel:${phone}`, '_self');
  }

  function whatsappRider(phone: string) {
    const clean = phone.replace(/[^\d]/g, '');
    window.open(`https://wa.me/${clean}`, '_blank', 'noopener');
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          {!embedded && (
            <h1 className="text-2xl font-bold font-display text-ink">{t('riders.title')}</h1>
          )}
          {!embedded && <p className="text-sm text-ink/60 mt-0.5">{t('riders.subtitle')}</p>}
        </div>
        {!embedded && (
          <button
            onClick={openAdd}
            className="inline-flex items-center justify-center gap-2 bg-brand hover:bg-brand-mid text-white font-display font-semibold text-sm px-5 h-[52px] rounded-xl transition-colors"
          >
            <Plus size={18} strokeWidth={1.75} />
            {t('riders.newRider')}
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<Users size={20} strokeWidth={1.75} />} label={t('riders.stats.total')} value={stats.total} />
        <StatCard icon={<CheckCircle2 size={20} strokeWidth={1.75} />} label={t('riders.stats.active')} value={stats.active} tone="success" />
        <StatCard icon={<XCircle size={20} strokeWidth={1.75} />} label={t('riders.stats.inactive')} value={stats.inactive} tone="danger" />
        <StatCard icon={<PackageCheck size={20} strokeWidth={1.75} />} label={t('riders.stats.withOrders')} value={stats.withOrders} tone="brand" />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink/40" strokeWidth={1.75} />
          <input
            type="text"
            placeholder={t('riders.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-surface-cream border border-border rounded-lg h-11 pl-10 pr-4 text-sm font-body text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
          />
        </div>
        <select
          value={vehicleFilter}
          onChange={(e) => setVehicleFilter(e.target.value as VehicleFilter)}
          className="bg-surface-cream border border-border rounded-lg h-11 px-4 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
        >
          <option value="all">{t('riders.allVehicles')}</option>
          <option value="moto">{t('riders.vehicles.moto')}</option>
          <option value="bicicleta">{t('riders.vehicles.bicicleta')}</option>
          <option value="coche">{t('riders.vehicles.coche')}</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="bg-surface-cream border border-border rounded-lg h-11 px-4 text-sm font-display text-ink focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
        >
          <option value="all">{t('riders.allStatuses')}</option>
          <option value="active">{t('riders.status.active')}</option>
          <option value="inactive">{t('riders.status.inactive')}</option>
        </select>
        {filtersActive && (
          <button
            onClick={clearFilters}
            className="h-11 px-4 rounded-lg text-sm font-display font-semibold text-ink/70 hover:bg-surface-cream border border-border transition-colors"
          >
            {t('riders.clearFilters')}
          </button>
        )}
      </div>

      {/* Table / states */}
      {isLoading ? (
        <TableSkeleton />
      ) : allRiders.length === 0 ? (
        <EmptyState
          icon={<Truck size={28} strokeWidth={1.75} className="text-muted" />}
          title={t('riders.empty.title')}
          description={t('riders.empty.description')}
          action={{ label: t('riders.empty.action'), onClick: openAdd }}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Search size={28} strokeWidth={1.75} className="text-muted" />}
          title={t('riders.empty.noResults')}
          description={t('riders.empty.noResultsDesc')}
          action={{ label: t('riders.clearFilters'), onClick: clearFilters }}
        />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {/* ON A PHONE (2026-11-05): a list — the table needed 835px and put
              the status, the active orders and all five actions (call,
              WhatsApp, switch on/off, edit, delete) off to the right. Same
              handlers; tapping a rider opens their drawer, as a table row
              does. The table from sm. */}
          <ul className="sm:hidden divide-y divide-border">
            {pageRiders.map((rider) => {
              const activeOrders = rider._count?.orders ?? 0;
              return (
                <li key={rider.id}>
                  <button
                    type="button"
                    onClick={() => setDetailRider(rider)}
                    className="w-full text-left px-4 pt-3 pb-1.5 hover:bg-surface-cream/40 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold font-display text-ink truncate">{rider.name}</span>
                      {rider.is_active ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-success-bg text-success shrink-0">
                          {t('riders.status.active')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-danger-bg text-danger shrink-0">
                          {t('riders.status.inactive')}
                        </span>
                      )}
                      <span className="ml-auto text-[11.5px] text-muted shrink-0">
                        {t('riders.table.activeOrders')}{' '}
                        <span className="text-sm font-semibold text-ink tabular-nums">{activeOrders > 0 ? activeOrders : '—'}</span>
                      </span>
                    </div>
                    <p className="flex items-center gap-1.5 min-w-0 text-[12.5px] text-muted mt-0.5">
                      <VehicleIcon type={rider.vehicle_type as VehicleType} size={14} className="text-muted shrink-0" />
                      <span className="shrink-0">{getVehicleLabel(rider.vehicle_type as VehicleType)}</span>
                      <span aria-hidden="true">{'·'}</span>
                      <span className="font-mono truncate min-w-0">{rider.phone}</span>
                    </p>
                    <p className="text-[11.5px] text-muted mt-1">
                      {t('riders.table.registered')}: {formatDate(rider.created_at)}
                    </p>
                  </button>
                  <div className="flex items-center gap-1 px-3 pb-2.5">
                    <button
                      type="button"
                      onClick={() => callRider(rider.phone)}
                      className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-surface-cream transition-colors text-ink/50 hover:text-ink"
                      title={t('riders.actions.call')}
                      aria-label={t('riders.actions.call')}
                    >
                      <Phone size={18} strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={() => whatsappRider(rider.phone)}
                      className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-surface-cream transition-colors text-ink/50 hover:text-success"
                      title={t('riders.actions.whatsapp')}
                      aria-label={t('riders.actions.whatsapp')}
                    >
                      <MessageCircle size={18} strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(rider)}
                      className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-surface-cream transition-colors"
                      title={rider.is_active ? t('riders.toggleDeactivate') : t('riders.toggleActivate')}
                      aria-label={rider.is_active ? t('riders.toggleDeactivate') : t('riders.toggleActivate')}
                    >
                      {rider.is_active ? (
                        <ToggleRight size={22} strokeWidth={1.75} className="text-brand" />
                      ) : (
                        <ToggleLeft size={22} strokeWidth={1.75} className="text-ink/30" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(rider)}
                      className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-surface-cream transition-colors text-ink/50 hover:text-ink"
                      title={t('common.edit')}
                      aria-label={t('common.edit')}
                    >
                      <Pencil size={18} strokeWidth={1.75} />
                    </button>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => requestDelete(rider)}
                      className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-danger-bg transition-colors text-ink/50 hover:text-danger"
                      title={t('riders.actions.delete')}
                      aria-label={t('riders.actions.delete')}
                    >
                      <Trash2 size={18} strokeWidth={1.75} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-cream text-left">
                  <th className="px-4 py-3 font-semibold font-display text-ink/70">{t('riders.table.name')}</th>
                  <th className="px-4 py-3 font-semibold font-display text-ink/70">{t('riders.table.phone')}</th>
                  <th className="px-4 py-3 font-semibold font-display text-ink/70">{t('riders.table.vehicle')}</th>
                  <th className="px-4 py-3 font-semibold font-display text-ink/70">{t('riders.table.status')}</th>
                  <th className="px-4 py-3 font-semibold font-display text-ink/70">{t('riders.table.activeOrders')}</th>
                  <th className="px-4 py-3 font-semibold font-display text-ink/70">{t('riders.table.registered')}</th>
                  <th className="px-4 py-3 font-semibold font-display text-ink/70 text-right">{t('riders.table.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageRiders.map((rider) => {
                  const activeOrders = rider._count?.orders ?? 0;
                  return (
                    <tr
                      key={rider.id}
                      className="hover:bg-surface-cream/40 transition-colors cursor-pointer"
                      onClick={() => setDetailRider(rider)}
                    >
                      <td className="px-4 py-3 font-display font-medium text-ink">{rider.name}</td>
                      <td className="px-4 py-3 text-ink/70">
                        <span className="inline-flex items-center gap-1.5 font-mono">
                          <Phone size={14} strokeWidth={1.75} className="text-ink/40" />
                          {rider.phone}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-ink/70">
                          <VehicleIcon type={rider.vehicle_type as VehicleType} className="text-ink/50" />
                          {getVehicleLabel(rider.vehicle_type as VehicleType)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {rider.is_active ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-success-bg text-success">
                            {t('riders.status.active')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-danger-bg text-danger">
                            {t('riders.status.inactive')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {activeOrders > 0 ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand/10 text-brand text-xs font-semibold font-display">
                            {activeOrders}
                          </span>
                        ) : (
                          <span className="text-ink/40 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-ink/60 text-sm">{formatDate(rider.created_at)}</td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => callRider(rider.phone)}
                            className="p-2 rounded-lg hover:bg-surface-cream transition-colors text-ink/50 hover:text-ink"
                            title={t('riders.actions.call')}
                          >
                            <Phone size={16} strokeWidth={1.75} />
                          </button>
                          <button
                            onClick={() => whatsappRider(rider.phone)}
                            className="p-2 rounded-lg hover:bg-surface-cream transition-colors text-ink/50 hover:text-success"
                            title={t('riders.actions.whatsapp')}
                          >
                            <MessageCircle size={16} strokeWidth={1.75} />
                          </button>
                          <button
                            onClick={() => toggleActive(rider)}
                            className="p-2 rounded-lg hover:bg-surface-cream transition-colors"
                            title={rider.is_active ? t('riders.toggleDeactivate') : t('riders.toggleActivate')}
                          >
                            {rider.is_active ? (
                              <ToggleRight size={20} strokeWidth={1.75} className="text-brand" />
                            ) : (
                              <ToggleLeft size={20} strokeWidth={1.75} className="text-ink/30" />
                            )}
                          </button>
                          <button
                            onClick={() => openEdit(rider)}
                            className="p-2 rounded-lg hover:bg-surface-cream transition-colors text-ink/50 hover:text-ink"
                            title={t('common.edit')}
                          >
                            <Pencil size={16} strokeWidth={1.75} />
                          </button>
                          <button
                            onClick={() => requestDelete(rider)}
                            className="p-2 rounded-lg hover:bg-danger-bg transition-colors text-ink/50 hover:text-danger"
                            title={t('riders.actions.delete')}
                          >
                            <Trash2 size={16} strokeWidth={1.75} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            totalItems={filtered.length}
            pageSize={PAGE_SIZE}
            className="border-t border-border px-4 py-3"
          />
        </div>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowModal(false)}>
          <div className="bg-card rounded-2xl p-6 shadow-modal w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold font-display text-ink">
                {editingId ? t('riders.modal.editTitle') : t('riders.modal.newTitle')}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-1.5 rounded-lg hover:bg-surface-cream transition-colors text-ink/50 hover:text-ink"
              >
                <X size={20} strokeWidth={1.75} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-semibold text-ink mb-1.5 block font-display">
                  {t('riders.modal.name')}
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('riders.modal.namePlaceholder')}
                  className={`bg-surface-cream border rounded-lg h-11 px-4 text-sm font-display w-full focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand ${
                    errors.name ? 'border-danger' : 'border-border'
                  }`}
                />
                {errors.name && <p className="text-xs text-danger mt-1">{errors.name}</p>}
              </div>

              <div>
                <label className="text-sm font-semibold text-ink mb-1.5 block font-display">
                  {t('riders.modal.phone')}
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+34612345678"
                  className={`bg-surface-cream border rounded-lg h-11 px-4 text-sm font-mono w-full focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand ${
                    errors.phone ? 'border-danger' : 'border-border'
                  }`}
                />
                {errors.phone ? (
                  <p className="text-xs text-danger mt-1">{errors.phone}</p>
                ) : (
                  <p className="text-xs text-ink/50 mt-1">{t('riders.modal.phoneHelp')}</p>
                )}
              </div>

              <div>
                <label className="text-sm font-semibold text-ink mb-1.5 block font-display">
                  {t('riders.modal.vehicleType')}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['moto', 'bicicleta', 'coche'] as VehicleType[]).map((v) => {
                    const selected = form.vehicle_type === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setForm({ ...form, vehicle_type: v })}
                        className={`flex flex-col items-center justify-center gap-1 h-16 rounded-lg border-2 transition-colors ${
                          selected ? 'border-brand bg-brand/5 text-brand' : 'border-border bg-surface-cream text-ink/70 hover:border-ink/20'
                        }`}
                      >
                        <VehicleIcon type={v} size={22} />
                        <span className="text-xs font-semibold font-display">{t(`riders.vehicles.${v}`)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <label className="text-sm font-semibold text-ink font-display">{t('riders.modal.active')}</label>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, is_active: !form.is_active })}
                  className="transition-colors"
                >
                  {form.is_active ? (
                    <ToggleRight size={28} strokeWidth={1.75} className="text-brand" />
                  ) : (
                    <ToggleLeft size={28} strokeWidth={1.75} className="text-ink/30" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 h-[52px] rounded-xl border border-border font-display font-semibold text-sm text-ink/70 hover:bg-surface-cream transition-colors"
              >
                {t('riders.modal.cancel')}
              </button>
              <button
                onClick={handleSave}
                disabled={createRider.isPending || updateRider.isPending}
                className="flex-1 h-[52px] rounded-xl bg-brand hover:bg-brand-mid text-white font-display font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {editingId ? t('riders.modal.save') : t('riders.modal.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      <ConfirmModal
        open={!!confirmDelete}
        title={t('riders.delete.title')}
        message={t('riders.delete.message', { name: confirmDelete?.name ?? '' })}
        confirmLabel={t('riders.delete.confirm')}
        cancelLabel={t('riders.modal.cancel')}
        danger
        onConfirm={confirmDeleteRider}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Blocked delete (rider has active orders) */}
      <ConfirmModal
        open={!!blockedDelete}
        title={t('riders.delete.blockedTitle')}
        message={t('riders.delete.blockedMessage', {
          name: blockedDelete?.name ?? '',
          count: blockedDelete?._count?.orders ?? 0,
        })}
        confirmLabel={t('common.ok', { defaultValue: 'OK' })}
        cancelLabel={t('riders.modal.cancel')}
        onConfirm={() => setBlockedDelete(null)}
        onCancel={() => setBlockedDelete(null)}
      />

      {/* Detail drawer */}
      {detailRider && (
        <RiderDetailDrawer
          rider={detailRider}
          onClose={() => setDetailRider(null)}
          onEdit={() => openEdit(detailRider)}
          onDelete={() => requestDelete(detailRider)}
          onToggle={() => toggleActive(detailRider)}
          onCall={() => callRider(detailRider.phone)}
          onWhatsapp={() => whatsappRider(detailRider.phone)}
        />
      )}

      {toast && <Toast msg={toast.msg} tone={toast.tone} />}
    </div>
  );
}

// ─── Detail Drawer ──────────────────────────────────────────────────────

function RiderDetailDrawer({
  rider, onClose, onEdit, onDelete, onToggle, onCall, onWhatsapp,
}: {
  rider: RiderRow;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
  onCall: () => void;
  onWhatsapp: () => void;
}) {
  const { t } = useTranslation();
  const { data: ordersPage, isLoading } = useAdminOrders({ riderId: rider.id, limit: 10 });
  const orders = ordersPage?.items ?? [];
  const { data: subDeliveries = [], isLoading: subDeliveriesLoading } = useRiderSubDeliveries(rider.id);

  const statusTone: Record<string, string> = {
    pending:               'bg-warning-bg text-warning',
    scheduled:             'bg-surface-cream text-ink/60',
    awaiting_confirmation: 'bg-warning-bg text-warning',
    confirmed:             'bg-info-bg text-info',
    preparing:             'bg-info-bg text-info',
    on_the_way:            'bg-warning-bg text-warning',
    delivered:             'bg-success-bg text-success',
    cancelled:             'bg-danger-bg text-danger',
    skipped:               'bg-surface-cream text-ink/50',
    failed:                'bg-danger-bg text-danger',
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-surface-linen overflow-y-auto shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-5 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-bold font-display text-ink">{t('riders.detail.title')}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface-cream text-ink/60">
            <X size={20} strokeWidth={1.75} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Identity card */}
          <div className="bg-card rounded-xl border border-border p-5">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold font-display text-lg">
                {rider.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-display font-bold text-ink text-lg leading-tight">{rider.name}</div>
                <div className="text-sm text-ink/60 mt-0.5 flex items-center gap-1.5">
                  <VehicleIcon type={rider.vehicle_type as VehicleType} size={14} className="text-ink/40" />
                  {t(`riders.vehicles.${rider.vehicle_type}`)}
                </div>
                <div className="mt-2">
                  {rider.is_active ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-success-bg text-success">
                      {t('riders.status.active')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-danger-bg text-danger">
                      {t('riders.status.inactive')}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 gap-2 mt-5">
              <button
                onClick={onCall}
                className="h-11 rounded-lg border border-border bg-surface-cream hover:bg-card text-ink font-display font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
              >
                <Phone size={16} strokeWidth={1.75} />
                {t('riders.actions.call')}
              </button>
              <button
                onClick={onWhatsapp}
                className="h-11 rounded-lg border border-border bg-surface-cream hover:bg-card text-ink font-display font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
              >
                <MessageCircle size={16} strokeWidth={1.75} className="text-success" />
                {t('riders.actions.whatsapp')}
              </button>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-xs font-display font-semibold text-ink/50 uppercase tracking-wide mb-3">
              {t('riders.detail.summary')}
            </h3>
            <dl className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-ink/60">{t('riders.detail.phone')}</dt>
                <dd className="font-mono text-ink">{rider.phone}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink/60">{t('riders.detail.vehicle')}</dt>
                <dd className="text-ink font-display">{t(`riders.vehicles.${rider.vehicle_type}`)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink/60">{t('riders.detail.activeOrders')}</dt>
                <dd className="text-ink font-display font-semibold">{rider._count?.orders ?? 0}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink/60">Active rashan deliveries</dt>
                <dd className="text-ink font-display font-semibold">{rider._count?.subscription_deliveries ?? 0}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-ink/60">{t('riders.detail.registered')}</dt>
                <dd className="text-ink font-display">{formatDate(rider.created_at)}</dd>
              </div>
            </dl>
          </div>

          {/* Recent orders */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-xs font-display font-semibold text-ink/50 uppercase tracking-wide mb-3">
              {t('riders.detail.recentOrders')}
            </h3>
            {isLoading ? (
              <div className="space-y-2">
                <div className="h-12 bg-surface-cream rounded-lg animate-pulse" />
                <div className="h-12 bg-surface-cream rounded-lg animate-pulse" />
              </div>
            ) : orders.length === 0 ? (
              <p className="text-sm text-ink/50 py-2">{t('riders.detail.noRecentOrders')}</p>
            ) : (
              <ul className="divide-y divide-border -my-2">
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link
                      to={`/orders/${o.id}`}
                      onClick={onClose}
                      className="flex items-center justify-between py-3 hover:bg-surface-cream/40 -mx-2 px-2 rounded-lg transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="font-mono text-sm text-ink">{o.order_number}</div>
                        <div className="text-xs text-ink/50 mt-0.5">{formatDate(o.created_at)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusTone[o.status] ?? 'bg-surface-cream text-ink/60'}`}>
                          {t(`orderDetail.statusLabels.${o.status}`, o.status)}
                        </span>
                        <ChevronRight size={16} strokeWidth={1.75} className="text-ink/30" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Recent rashan deliveries */}
          <div className="bg-card rounded-xl border border-border p-5">
            <h3 className="text-xs font-display font-semibold text-ink/50 uppercase tracking-wide mb-3">
              Recent rashan deliveries
            </h3>
            {subDeliveriesLoading ? (
              <div className="space-y-2">
                <div className="h-12 bg-surface-cream rounded-lg animate-pulse" />
                <div className="h-12 bg-surface-cream rounded-lg animate-pulse" />
              </div>
            ) : subDeliveries.length === 0 ? (
              <p className="text-sm text-ink/50 py-2">No rashan deliveries assigned yet.</p>
            ) : (
              <ul className="divide-y divide-border -my-2">
                {subDeliveries.map((d) => {
                  const packName = d.subscription.pack?.name_es ?? 'Custom pack';
                  return (
                    <li key={d.id}>
                      <Link
                        to={`/rashan/subscriptions/${d.subscription_id}`}
                        onClick={onClose}
                        className="flex items-center justify-between py-3 hover:bg-surface-cream/40 -mx-2 px-2 rounded-lg transition-colors gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-display font-semibold text-ink truncate">
                            {d.subscription.user.name}
                          </div>
                          <div className="text-xs text-ink/50 mt-0.5 truncate">
                            {packName} · {formatDate(d.scheduled_date)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${statusTone[d.status] ?? 'bg-surface-cream text-ink/60'}`}>
                            {d.status.replace(/_/g, ' ')}
                          </span>
                          <ChevronRight size={16} strokeWidth={1.75} className="text-ink/30" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer actions */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={onEdit}
              className="h-11 rounded-lg bg-brand hover:bg-brand-mid text-white font-display font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Pencil size={16} strokeWidth={1.75} />
              {t('riders.actions.edit')}
            </button>
            <button
              onClick={onToggle}
              className="h-11 rounded-lg border border-border bg-card hover:bg-surface-cream text-ink font-display font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
            >
              {rider.is_active ? (
                <>
                  <ToggleLeft size={18} strokeWidth={1.75} />
                  {t('riders.toggleDeactivate')}
                </>
              ) : (
                <>
                  <ToggleRight size={18} strokeWidth={1.75} className="text-brand" />
                  {t('riders.toggleActivate')}
                </>
              )}
            </button>
          </div>
          <button
            onClick={onDelete}
            className="w-full h-11 rounded-lg border border-danger/30 text-danger hover:bg-danger-bg font-display font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
          >
            <Trash2 size={16} strokeWidth={1.75} />
            {t('riders.actions.delete')}
          </button>
        </div>
      </div>
    </div>
  );
}
