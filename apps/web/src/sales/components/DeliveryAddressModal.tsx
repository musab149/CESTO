import { useEffect, useState } from 'react';
import { MapPin, Plus, Loader2, Check } from 'lucide-react';
import { useAddSalesClientAddress, type SalesAddress as Address } from '@grocery-app/shared';
import { usePortT } from '../lib/portT';
import { Button, Dialog } from './Dialog';

/**
 * Where this order is delivered.
 *
 * Ported verbatim from apps/admin/src/components/DeliveryAddressModal.tsx.
 * The only change is which endpoint saves the address — the rep's own,
 * which refuses a client outside their book.
 *
 * A dialog rather than a list folded into the client card, for two reasons.
 *
 * The card could only ever CHOOSE, and choosing is the half of the job that is
 * usually already done — most clients have exactly one address, so opening a
 * list of one and picking the row that was selected anyway looks like a button
 * that does nothing. The half that was missing is ADDING one, and a form has
 * nowhere to live in a card that has to stay four lines tall.
 *
 * And an order cannot be written without an address: `address_id` is NOT NULL.
 * A client with none is not an edge case to degrade politely for, it is a dead
 * end, and the only previous way out of it was to leave for the customer's
 * page — which throws the basket away, since it lives in component state.
 *
 * So the dialog does both, and the empty case opens straight into the form
 * instead of showing an empty list above a button that reveals it.
 */
export default function DeliveryAddressModal({
  open, userId, addresses, selectedId, defaultContactName, defaultContactPhone,
  onSelect, onClose,
}: {
  open: boolean;
  userId: string;
  addresses: Address[];
  selectedId: string;
  /** Prefills the form — a rep typing an address should not retype the
   *  client's own name and number to get it saved. */
  defaultContactName?: string | null;
  defaultContactPhone?: string | null;
  onSelect: (addressId: string) => void;
  onClose: () => void;
}) {
  const t = usePortT();
  const createAddress = useAddSalesClientAddress();

  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    contact_name: '', contact_phone: '', street_line_1: '', street_line_2: '',
    postcode: '', city: '', province: '',
  });

  // Reopening starts clean, and a client with nothing saved lands straight in
  // the form: there is no list for them to look at first.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setAdding(addresses.length === 0);
    setForm({
      contact_name: defaultContactName ?? '',
      contact_phone: defaultContactPhone ?? '',
      street_line_1: '', street_line_2: '', postcode: '', city: '', province: '',
    });
  }, [open, addresses.length, defaultContactName, defaultContactPhone]);

  if (!open) return null;

  // Address.postcode is VarChar(5) and the server checks it, so the button is
  // disabled on the same rule rather than letting the round trip say no.
  const postcodeOk = /^\d{5}$/.test(form.postcode.trim());
  const canSave = form.contact_name.trim() !== ''
    && form.contact_phone.trim().length >= 6
    && form.street_line_1.trim() !== ''
    && postcodeOk
    && form.city.trim() !== ''
    && form.province.trim() !== ''
    && !createAddress.isPending;

  const save = async () => {
    if (!canSave) return;
    setError(null);
    try {
      const created = await createAddress.mutateAsync({
        clientId: userId,
        address: {
          contact_name: form.contact_name.trim(),
          contact_phone: form.contact_phone.trim(),
          street_line_1: form.street_line_1.trim(),
          ...(form.street_line_2.trim() ? { street_line_2: form.street_line_2.trim() } : {}),
          postcode: form.postcode.trim(),
          city: form.city.trim(),
          province: form.province.trim(),
        },
      });
      // Saved AND chosen. Saving an address on this screen has exactly one
      // purpose, so making the rep then pick it out of a list is a step that
      // only exists because the code is in two halves.
      onSelect(created.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const field = (
    key: keyof typeof form,
    label: string,
    opts: { placeholder?: string; inputMode?: 'numeric' | 'tel'; maxLength?: number } = {},
  ) => (
    <label className="block min-w-0">
      <span className="block text-[12.5px] font-display font-medium text-gray mb-1">{label}</span>
      <input
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        placeholder={opts.placeholder}
        inputMode={opts.inputMode}
        maxLength={opts.maxLength}
        className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
      />
    </label>
  );

  return (
    <Dialog
      onClose={onClose}
      closeLabel={t('common.close', 'Close')}
      icon={MapPin}
      title={t('orderCreate.deliverTo', 'Deliver to')}
      bodyClassName="px-5 py-4 space-y-2.5"
      footer={adding ? (
        <div className="flex gap-2.5">
          {addresses.length > 0 && (
            <Button variant="secondary" className="flex-1" onClick={() => setAdding(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
          )}
          <Button className="flex-1" onClick={save} disabled={!canSave}>
            {createAddress.isPending
              ? <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />
              : <Check size={16} strokeWidth={2.5} />}
            {t('orderCreate.addr.saveAndUse', 'Save and use')}
          </Button>
        </div>
      ) : undefined}
    >
          {addresses.length === 0 && !adding && (
            <p className="text-sm text-muted">
              {t('orderCreate.noAddressDialog', 'This client has no address saved. Add one to place the order.')}
            </p>
          )}

          {addresses.map((a) => {
            const active = a.id === selectedId;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => { onSelect(a.id); onClose(); }}
                className={`w-full text-left rounded-xl border p-3.5 transition-colors ${
                  active ? 'border-brand ring-1 ring-brand bg-brand-whisper/60' : 'border-border hover:border-brand/40'
                }`}
              >
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink leading-snug">
                      {a.street_line_1}{a.street_line_2 ? `, ${a.street_line_2}` : ''}
                    </span>
                    <span className="block text-xs text-muted mt-0.5">
                      {a.postcode} {a.city}, {a.province}
                      {a.is_default && (
                        <span className="ml-1.5 text-brand font-semibold">
                          {t('orderCreate.defaultAddress', 'default')}
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted mt-0.5 font-mono truncate">
                      {a.contact_name} · {a.contact_phone}
                    </span>
                  </span>
                  {active && <Check size={16} strokeWidth={2.5} className="text-brand shrink-0 mt-0.5" />}
                </span>
              </button>
            );
          })}

          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="w-full h-11 rounded-xl border-2 border-dashed border-border hover:border-brand hover:text-brand text-sm font-semibold font-display text-gray inline-flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus size={16} strokeWidth={2.5} />
              {t('orderCreate.addAddress', 'Add address')}
            </button>
          ) : (
            <div className="rounded-xl border border-border bg-surface-cream/60 p-3.5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {field('contact_name', t('orderCreate.addr.contactName', 'Contact name'))}
                {field('contact_phone', t('orderCreate.addr.contactPhone', 'Phone'), { inputMode: 'tel' })}
              </div>
              {field('street_line_1', t('orderCreate.addr.street', 'Street'))}
              {field('street_line_2', t('orderCreate.addr.street2', 'Flat, floor (optional)'))}
              <div className="grid grid-cols-3 gap-3">
                <label className="block min-w-0">
                  <span className="block text-[12.5px] font-display font-medium text-gray mb-1">
                    {t('orderCreate.addr.postcode', 'Postcode')}
                  </span>
                  <input
                    value={form.postcode}
                    onChange={(e) => setForm((f) => ({ ...f, postcode: e.target.value.replace(/\D/g, '') }))}
                    inputMode="numeric"
                    maxLength={5}
                    placeholder="28001"
                    className={`w-full h-10 px-3 rounded-lg border bg-card text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 ${
                      form.postcode !== '' && !postcodeOk ? 'border-danger' : 'border-border'
                    }`}
                  />
                </label>
                {field('city', t('orderCreate.addr.city', 'City'))}
                {field('province', t('orderCreate.addr.province', 'Province'))}
              </div>
              {form.postcode !== '' && !postcodeOk && (
                <p className="text-xs text-danger">
                  {t('orderCreate.addr.postcodeRule', 'A Spanish postcode is five digits.')}
                </p>
              )}
              {error && <p className="text-xs text-danger">{error}</p>}
            </div>
          )}
    </Dialog>
  );
}
