import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Truck, Pencil, Trash2, X, Bike, Car, ToggleLeft, ToggleRight,
  AlertTriangle, Phone, Search,
} from 'lucide-react';
import { z } from 'zod';
import {
  usePartnerRiders,
  useCreatePartnerRider,
  useUpdatePartnerRider,
  useDeletePartnerRider,
  type PartnerRiderPayload,
} from '@grocery-app/shared';
import { useValidationMessages } from './lib/validation-messages';

/**
 * Partner-scoped rider roster. Mirror of admin's RidersPage but partner-
 * scoped through /api/partner/riders (server forces store_id from JWT).
 * Riders here are your own delivery staff — customer web + order detail
 * picks from this list when assigning a rider.
 */

type Vehicle = 'moto' | 'bicicleta' | 'coche';

interface RiderRow {
  id: string;
  name: string;
  phone: string;
  vehicle_type: Vehicle;
  is_active: boolean;
  is_test?: boolean;
  _count?: { orders?: number };
}

interface RiderForm {
  name: string;
  phone: string;
  vehicle_type: Vehicle;
  is_active: boolean;
}

const emptyForm: RiderForm = {
  name: '',
  phone: '',
  vehicle_type: 'moto',
  is_active: true,
};

const VEHICLE_LABEL: Record<Vehicle, string> = {
  moto:      'Motorbike',
  bicicleta: 'Bicycle',
  coche:     'Car',
};

const VEHICLE_ICON: Record<Vehicle, typeof Truck> = {
  moto:      Truck,
  bicicleta: Bike,
  coche:     Car,
};

export default function PartnerRidersPage() {
  const { data: riders = [], isLoading } = usePartnerRiders();
  const createRider = useCreatePartnerRider();
  const updateRider = useUpdatePartnerRider();
  const deleteRider = useDeletePartnerRider();
  const messages = useValidationMessages();

  const [q, setQ] = useState('');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RiderForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'name' | 'phone', string>>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const riderSchema = useMemo(() => z.object({
    name:  z.string().trim().min(2, messages.tooShort(2)).max(80, messages.tooLong(80)),
    phone: z.string().trim().min(7, messages.phoneInvalidIntl).max(40),
  }), [messages]);

  useEffect(() => { if (!showModal) { setError(null); setFieldErrors({}); } }, [showModal]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (riders as unknown as RiderRow[]).filter((r) => {
      if (filterActive === 'active' && !r.is_active) return false;
      if (filterActive === 'inactive' && r.is_active) return false;
      if (!needle) return true;
      return r.name.toLowerCase().includes(needle) || r.phone.toLowerCase().includes(needle);
    });
  }, [riders, q, filterActive]);

  function openAdd() { setEditingId(null); setForm(emptyForm); setShowModal(true); }
  function openEdit(r: RiderRow) {
    setEditingId(r.id);
    setForm({ name: r.name, phone: r.phone, vehicle_type: r.vehicle_type, is_active: r.is_active });
    setShowModal(true);
  }
  function handleClose() { setShowModal(false); setEditingId(null); setForm(emptyForm); }

  async function handleSave() {
    setError(null);
    const parsed = riderSchema.safeParse(form);
    if (!parsed.success) {
      const next: typeof fieldErrors = {};
      for (const issue of parsed.error.issues) {
        const k = issue.path[0] as keyof typeof fieldErrors;
        if (k && !next[k]) next[k] = issue.message;
      }
      setFieldErrors(next);
      return;
    }
    setFieldErrors({});
    const payload: PartnerRiderPayload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      vehicle_type: form.vehicle_type,
      is_active: form.is_active,
    };
    try {
      if (editingId) await updateRider.mutateAsync({ id: editingId, payload });
      else await createRider.mutateAsync(payload);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function toggleActive(r: RiderRow) {
    try {
      await updateRider.mutateAsync({
        id: r.id,
        payload: { name: r.name, phone: r.phone, vehicle_type: r.vehicle_type, is_active: !r.is_active },
      });
    } catch { /* surfaced elsewhere */ }
  }

  async function handleDelete() {
    if (!deleteConfirm) return;
    setDeleteError(null);
    try {
      await deleteRider.mutateAsync(deleteConfirm.id);
      setDeleteConfirm(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const inputClass = 'w-full h-11 px-4 bg-surface-cream border border-border rounded-lg text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition';
  const labelClass = 'block text-sm font-semibold text-ink mb-1.5';

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 bg-surface-cream rounded animate-pulse" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 bg-surface-cream rounded-xl animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-0">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-ink inline-flex items-center gap-2">
            <Truck size={22} strokeWidth={1.75} />
            Riders
            <span className="text-base font-normal text-muted ml-2">({riders.length})</span>
          </h1>
          <p className="text-sm text-muted font-body mt-1">
            Your delivery staff. Riders show up on the order detail page for assignment — pick one on an active order to hand off dispatch.
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="h-[52px] px-5 bg-brand text-white rounded-xl text-sm font-semibold hover:bg-brand-mid transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" strokeWidth={1.75} />
          New rider
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={filterActive}
          onChange={(e) => setFilterActive(e.target.value as 'all' | 'active' | 'inactive')}
          className="h-10 bg-surface-cream border border-border rounded-lg px-3 text-sm text-ink cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="all">All riders</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or phone…"
            className="w-full h-10 bg-surface-cream border border-border rounded-lg pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-border p-12 text-center">
          <Truck className="w-10 h-10 text-muted mx-auto mb-2" strokeWidth={1.5} />
          <p className="text-sm text-ink font-semibold mb-1">
            {q || filterActive !== 'all' ? 'No riders match this filter.' : 'No riders yet'}
          </p>
          <p className="text-xs text-muted font-body mb-4">
            {q || filterActive !== 'all'
              ? 'Clear the search or switch to "All riders".'
              : 'Add your delivery staff so you can assign them to orders.'}
          </p>
          {!q && filterActive === 'all' && (
            <button
              type="button"
              onClick={openAdd}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-mid transition"
            >
              <Plus size={16} strokeWidth={1.75} />
              Add rider
            </button>
          )}
        </div>
      ) : (
        <>
        {/* Mobile: card per rider. Phone and the active toggle are the two
            things a partner reaches for on a phone, so both stay one tap away
            rather than behind a horizontal scroll. */}
        <div className="md:hidden space-y-2.5">
          {filtered.map((r) => {
            const VIcon = VEHICLE_ICON[r.vehicle_type];
            const initials = r.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
            return (
              <div key={r.id} className="bg-white rounded-xl border border-border p-3.5">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-sm shrink-0">
                    {initials || '?'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold text-ink truncate">{r.name}</p>
                    <a
                      href={`tel:${r.phone}`}
                      className="inline-flex items-center gap-1.5 text-[13px] font-mono text-ink/80 hover:text-brand mt-0.5"
                    >
                      <Phone size={12} strokeWidth={1.75} className="text-muted" />
                      {r.phone}
                    </a>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleActive(r)}
                    className="shrink-0"
                    aria-label={r.is_active ? `Deactivate ${r.name}` : `Activate ${r.name}`}
                  >
                    {r.is_active
                      ? <ToggleRight size={28} strokeWidth={1.75} className="text-brand" />
                      : <ToggleLeft size={28} strokeWidth={1.75} className="text-ink/30" />}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-border/60">
                  <div className="flex items-center gap-3 text-[12.5px] text-gray min-w-0">
                    <span className="inline-flex items-center gap-1.5">
                      <VIcon size={13} strokeWidth={1.75} className="text-muted" />
                      {VEHICLE_LABEL[r.vehicle_type]}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{r._count?.orders ?? 0} orders</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => openEdit(r)}
                      className="w-9 h-9 rounded-lg bg-surface-cream active:bg-brand-mist flex items-center justify-center"
                      aria-label={`Edit ${r.name}`}
                    >
                      <Pencil className="w-4 h-4 text-ink" strokeWidth={1.75} />
                    </button>
                    <button
                      onClick={() => { setDeleteConfirm({ id: r.id, name: r.name }); setDeleteError(null); }}
                      className="w-9 h-9 rounded-lg active:bg-danger-bg flex items-center justify-center"
                      aria-label={`Delete ${r.name}`}
                    >
                      <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="hidden md:block bg-white rounded-xl border border-border overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="bg-surface-cream">
                {['Rider', 'Phone', 'Vehicle', 'Orders', 'Status', ''].map((h) => (
                  <th key={h} className="text-left text-xs font-semibold text-gray uppercase px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const VIcon = VEHICLE_ICON[r.vehicle_type];
                const initials = r.name.split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
                return (
                  <tr key={r.id} className="border-t border-border hover:bg-brand-mist/30 transition">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-brand/10 text-brand flex items-center justify-center font-bold text-sm shrink-0">
                          {initials || '?'}
                        </div>
                        <span className="text-sm font-semibold text-ink">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`tel:${r.phone}`}
                        className="inline-flex items-center gap-1.5 text-sm font-mono text-ink hover:text-brand transition-colors"
                      >
                        <Phone size={13} strokeWidth={1.75} className="text-muted" />
                        {r.phone}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-sm text-gray">
                        <VIcon size={14} strokeWidth={1.75} className="text-muted" />
                        {VEHICLE_LABEL[r.vehicle_type]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray">
                      {r._count?.orders ?? 0}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => toggleActive(r)}
                        title={r.is_active ? 'Deactivate' : 'Activate'}
                      >
                        {r.is_active
                          ? <ToggleRight size={26} strokeWidth={1.75} className="text-brand" />
                          : <ToggleLeft size={26} strokeWidth={1.75} className="text-ink/30" />}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openEdit(r)}
                          className="w-9 h-9 rounded-lg bg-surface-cream hover:bg-brand-mist flex items-center justify-center transition"
                          title="Edit rider"
                        >
                          <Pencil className="w-4 h-4 text-ink" strokeWidth={1.75} />
                        </button>
                        <button
                          onClick={() => { setDeleteConfirm({ id: r.id, name: r.name }); setDeleteError(null); }}
                          className="w-9 h-9 rounded-lg hover:bg-danger-bg flex items-center justify-center transition"
                          title="Delete rider"
                        >
                          <Trash2 className="w-4 h-4 text-danger" strokeWidth={1.75} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {/* Rider modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={handleClose}>
          <div className="bg-white rounded-2xl p-6 shadow-modal w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold font-display text-ink">{editingId ? 'Edit rider' : 'New rider'}</h3>
              <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-surface-linen transition-colors">
                <X size={18} strokeWidth={1.75} className="text-muted" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Ahmed Khan"
                  className={inputClass}
                />
                {fieldErrors.name && <p className="mt-1 text-xs text-danger">{fieldErrors.name}</p>}
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+34 600 000 000"
                  className={`${inputClass} font-mono`}
                />
                {fieldErrors.phone && <p className="mt-1 text-xs text-danger">{fieldErrors.phone}</p>}
              </div>
              <div>
                <label className={labelClass}>Vehicle</label>
                <select
                  value={form.vehicle_type}
                  onChange={(e) => setForm({ ...form, vehicle_type: e.target.value as Vehicle })}
                  className={`${inputClass} cursor-pointer`}
                >
                  <option value="moto">Motorbike</option>
                  <option value="bicicleta">Bicycle</option>
                  <option value="coche">Car</option>
                </select>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="w-4 h-4 accent-brand"
                />
                <span className="text-sm text-ink">Active — can be assigned to orders.</span>
              </label>
              {error && (
                <div className="bg-danger-bg border border-danger/30 rounded-lg px-3 py-2 text-sm text-danger font-body">{error}</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={handleClose}
                className="h-11 px-5 rounded-xl border-2 border-border text-gray text-sm font-semibold hover:bg-surface-linen transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={createRider.isPending || updateRider.isPending}
                className="h-11 px-6 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-mid transition disabled:opacity-50"
              >
                {createRider.isPending || updateRider.isPending ? '…' : editingId ? 'Save changes' : 'Add rider'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-2xl p-6 shadow-modal w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-danger-bg flex items-center justify-center shrink-0">
                <AlertTriangle size={20} strokeWidth={1.75} className="text-danger" />
              </div>
              <div>
                <h3 className="text-lg font-bold font-display text-ink">Delete rider?</h3>
                <p className="text-sm text-muted mt-0.5">
                  <span className="font-semibold text-ink">{deleteConfirm.name}</span> — past orders they delivered stay in your history; you just can't assign new ones to them.
                </p>
              </div>
            </div>
            {deleteError && (
              <p className="text-sm text-danger bg-danger-bg rounded-lg p-3 mb-3">{deleteError}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 h-11 rounded-xl border-2 border-border text-gray text-sm font-semibold hover:bg-surface-linen transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteRider.isPending}
                className="flex-1 h-11 rounded-xl bg-danger text-white text-sm font-semibold hover:bg-danger/90 transition disabled:opacity-50"
              >
                {deleteRider.isPending ? '…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
