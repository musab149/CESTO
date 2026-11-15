import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, MapPin, Plus, Pencil, Trash2, Star, X } from 'lucide-react';
import {
  useAddresses,
  useCreateAddress,
  useUpdateAddress,
  useDeleteAddress,
  useSetDefaultAddress,
  type AddressInput,
  ApiError,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { TextField, Textarea } from '@/components/form';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';

interface AddressFormData {
  contact_name: string;
  contact_phone: string;
  street_line_1: string;
  street_line_2: string;
  postcode: string;
  city: string;
  province: string;
  delivery_notes: string;
}

const emptyForm: AddressFormData = {
  contact_name: '',
  contact_phone: '',
  street_line_1: '',
  street_line_2: '',
  postcode: '',
  city: '',
  province: '',
  delivery_notes: '',
};

export default function AddressesPage() {
  const navigate = useNavigate();
  const { t, lang } = useLanguageStore();
  // This page's own words, in the shopper's language. Everything here used to
  // be English on a Spanish-first site.
  const L = (en: string, es: string) => (lang === 'en' ? en : es);
  const messages = useValidationMessages();

  const { data: addresses, isLoading } = useAddresses();
  const create = useCreateAddress();
  const update = useUpdateAddress();
  const remove = useDeleteAddress();
  const setDefault = useSetDefaultAddress();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<{ text: string; plan: boolean } | null>(null);

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      contact_name:  r.name({ min: 2, max: 100 }),
      contact_phone: r.phoneIntl(),
      street_line_1: r.shortText(200),
      street_line_2: z.string().trim().max(200, messages.tooLong(200)).optional().or(z.literal('')),
      postcode:      r.postcode(),
      city:          r.name({ min: 2, max: 80 }),
      province:      r.name({ min: 2, max: 80 }),
      delivery_notes: z.string().trim().max(200, messages.tooLong(200)).optional().or(z.literal('')),
    });
  }, [messages]);

  const form = useForm<AddressFormData>({
    // Cast: zodResolver's inferred output type differs from AddressFormData
    // because zod optional fields become `string | undefined` while RHF
    // types keep them as `string`. Runtime behaviour is identical.
    resolver: zodResolver(schema) as unknown as Resolver<AddressFormData>,
    mode: 'onBlur',
    defaultValues: emptyForm,
  });
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = form;

  function openAdd(prefill?: Partial<AddressFormData>) {
    setEditingId(null);
    reset({ ...emptyForm, ...prefill });
    setSubmitError(null);
    setShowForm(true);
  }

  // Arriving from "Save as delivery address" in the location picker: open the
  // form already carrying the street, city and postcode the geocoder found,
  // so the customer fills in the contact details rather than retyping an
  // address the browser just resolved.
  const routeState = useLocation().state as { prefill?: Partial<AddressFormData> } | null;
  const prefillDone = useRef(false);
  useEffect(() => {
    if (prefillDone.current || !routeState?.prefill) return;
    prefillDone.current = true;
    openAdd(routeState.prefill);
    // Drop the state so a refresh, or a back-navigation onto this entry,
    // does not reopen a form the customer already dismissed.
    navigate('/addresses', { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeState]);

  function openEdit(id: string) {
    const a = addresses?.find((x) => x.id === id);
    if (!a) return;
    setEditingId(id);
    reset({
      contact_name: a.contact_name,
      contact_phone: a.contact_phone,
      street_line_1: a.street_line_1,
      street_line_2: a.street_line_2 ?? '',
      postcode: a.postcode,
      city: a.city,
      province: a.province,
      delivery_notes: a.delivery_notes ?? '',
    });
    setSubmitError(null);
    setShowForm(true);
  }

  const onSubmit = async (values: AddressFormData) => {
    setSubmitError(null);
    const payload: AddressInput = {
      contact_name: values.contact_name,
      contact_phone: values.contact_phone,
      street_line_1: values.street_line_1,
      street_line_2: values.street_line_2 || undefined,
      postcode: values.postcode,
      city: values.city,
      province: values.province,
      delivery_notes: values.delivery_notes || undefined,
    };
    try {
      if (editingId) await update.mutateAsync({ id: editingId, input: payload });
      else await create.mutateAsync(payload);
      setShowForm(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : L('Save failed', 'No se ha podido guardar'));
    }
  };

  /**
   * A refused delete used to close the dialog and leave the address in the
   * list with no word as to why. The one refusal a shopper meets is the
   * address their Home Grocery plan delivers to — said in their language,
   * with the way out.
   */
  async function handleDelete() {
    if (!deleteConfirm) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(deleteConfirm);
      setDeleteConfirm(null);
    } catch (err) {
      const plan = err instanceof ApiError && err.status === 409;
      setDeleteError({
        plan,
        text: plan
          ? L('Your Home Grocery delivers to this address. Choose another one in your delivery information first.',
            'Tu compra del hogar se entrega en esta dirección. Elige antes otra en tus datos de entrega.')
          : err instanceof Error && err.message ? err.message : L('It could not be deleted. Try again.', 'No se ha podido eliminar. Inténtalo de nuevo.'),
      });
    }
  }
  const closeDelete = () => { setDeleteConfirm(null); setDeleteError(null); };

  return (
    <div className="max-w-[1000px] mx-auto px-6 lg:px-10 py-8">
      <button
        onClick={() => navigate('/profile')}
        className="flex items-center gap-2 text-sm font-semibold text-muted hover:text-brand transition-colors mb-6"
      >
        <ArrowLeft size={16} />
        {t('common.back') || L('Back', 'Volver')}
      </button>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-ink font-display">{t('profile.my_addresses') || L('My addresses', 'Mis direcciones')}</h1>
          <p className="text-sm text-muted mt-1 font-body">
            {(addresses?.length ?? 0)} {(addresses?.length ?? 0) === 1 ? L('address', 'dirección') : L('addresses', 'direcciones')}
          </p>
        </div>
        <button
          onClick={() => openAdd()}
          className="h-12 px-5 bg-brand text-white rounded-xl text-sm font-bold font-display hover:bg-brand-mid transition-colors flex items-center gap-2"
        >
          <Plus size={16} strokeWidth={2} />
          {L('Add address', 'Añadir dirección')}
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-40 bg-surface-cream rounded-lg animate-pulse" />
          ))}
        </div>
      ) : !addresses || addresses.length === 0 ? (
        <div className="flex flex-col items-center py-20">
          <div className="w-24 h-24 bg-surface-cream rounded-full flex items-center justify-center mb-6">
            <MapPin size={32} strokeWidth={1.5} className="text-muted" />
          </div>
          <h2 className="text-xl font-extrabold text-ink font-display text-center mb-2">{L('No addresses yet', 'Aún no tienes direcciones')}</h2>
          <p className="text-sm text-gray font-body text-center mb-6 max-w-sm">
            {L('Add your first delivery address to checkout faster.', 'Añade tu primera dirección de entrega para pagar más rápido.')}
          </p>
          <button
            onClick={() => openAdd()}
            className="h-12 px-6 bg-brand text-white rounded-xl text-sm font-bold font-display hover:bg-brand-mid transition-colors flex items-center gap-2"
          >
            <Plus size={16} strokeWidth={2} />
            {L('Add address', 'Añadir dirección')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {addresses.map((a) => (
            <div key={a.id} className="bg-surface-white border border-border/60 rounded-lg p-5 relative">
              {a.is_default && (
                <span className="absolute top-4 right-4 inline-flex items-center gap-1 text-[11px] font-bold font-display bg-brand-mist text-brand px-2.5 py-1 rounded-full">
                  <Star size={11} strokeWidth={2.5} fill="currentColor" />
                  {L('Default', 'Principal')}
                </span>
              )}
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-surface-linen flex items-center justify-center shrink-0">
                  <MapPin size={18} strokeWidth={1.75} className="text-brand" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-ink font-display truncate">{a.contact_name}</h3>
                  <p className="text-xs text-muted font-mono">{a.contact_phone}</p>
                </div>
              </div>
              <p className="text-sm text-charcoal font-body leading-relaxed">
                {a.street_line_1}
                {a.street_line_2 && <>, {a.street_line_2}</>}
                <br />
                {a.postcode} {a.city}, {a.province}
                <br />
                España
              </p>
              {a.delivery_notes && (
                <p className="text-xs text-muted font-body italic mt-2">"{a.delivery_notes}"</p>
              )}
              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border/60">
                {!a.is_default && (
                  <button
                    onClick={() => setDefault.mutate(a.id)}
                    disabled={setDefault.isPending}
                    className="text-xs font-semibold font-display text-brand hover:text-brand-mid transition-colors disabled:opacity-50"
                  >
                    {L('Set as default', 'Usar como principal')}
                  </button>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button onClick={() => openEdit(a.id)} className="w-9 h-9 rounded-lg hover:bg-surface-linen flex items-center justify-center transition-colors" title={L('Edit', 'Editar')} aria-label={L('Edit', 'Editar')}>
                    <Pencil size={14} strokeWidth={1.75} className="text-muted" />
                  </button>
                  <button onClick={() => { setDeleteError(null); setDeleteConfirm(a.id); }} className="w-9 h-9 rounded-lg hover:bg-danger-bg flex items-center justify-center transition-colors" title={L('Delete', 'Eliminar')} aria-label={L('Delete', 'Eliminar')}>
                    <Trash2 size={14} strokeWidth={1.75} className="text-danger" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form side panel */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/50 animate-fade-in"
          onClick={() => setShowForm(false)}
        >
          <div
            className="bg-card shadow-modal w-full max-w-md h-full overflow-y-auto animate-slide-in-right flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-border sticky top-0 bg-card z-10">
              <h3 className="text-xl font-extrabold text-ink font-display">{editingId ? L('Edit address', 'Editar dirección') : L('New address', 'Nueva dirección')}</h3>
              <button
                onClick={() => setShowForm(false)}
                className="p-1.5 rounded-lg hover:bg-surface-linen transition-colors"
                aria-label={L('Close', 'Cerrar')}
              >
                <X size={18} strokeWidth={1.75} className="text-muted" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3 px-6 py-6 flex-1" noValidate>
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label={L('Contact name', 'Nombre de contacto')}
                  autoComplete="name"
                  error={errors.contact_name?.message}
                  {...register('contact_name')}
                />
                <TextField
                  label={L('Phone', 'Teléfono')}
                  type="tel"
                  autoComplete="tel"
                  placeholder="612345678"
                  error={errors.contact_phone?.message}
                  {...register('contact_phone')}
                />
              </div>

              <TextField
                label={L('Street address', 'Calle y número')}
                autoComplete="address-line1"
                error={errors.street_line_1?.message}
                {...register('street_line_1')}
              />

              <TextField
                label={L('Apt, suite, etc. (optional)', 'Piso, puerta, etc. (opcional)')}
                autoComplete="address-line2"
                error={errors.street_line_2?.message}
                {...register('street_line_2')}
              />

              {/* A plain field. This was a dropdown listing only the
                  postcodes inside a delivery zone, because an address outside
                  one was refused at checkout. Nothing restricts a postcode
                  now — we deliver anywhere in Spain — so any valid one is
                  accepted. */}
              <TextField
                label={L('Postcode', 'Código postal')}
                autoComplete="postal-code"
                inputMode="numeric"
                maxLength={5}
                placeholder="28013"
                error={errors.postcode?.message}
                {...register('postcode')}
              />

              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label={L('City', 'Ciudad')}
                  autoComplete="address-level2"
                  error={errors.city?.message}
                  {...register('city')}
                />
                <TextField
                  label={L('Province', 'Provincia')}
                  autoComplete="address-level1"
                  error={errors.province?.message}
                  {...register('province')}
                />
              </div>

              <div>
                <label className="block text-[13px] font-semibold text-charcoal font-display mb-2">{L('Country', 'País')}</label>
                <div className="w-full h-11 px-4 bg-surface-linen border-2 border-border rounded-xl text-sm font-display text-muted flex items-center justify-between">
                  <span>España</span>
                  <span className="text-[11px] font-body">{L('Spain only for now', 'De momento, solo España')}</span>
                </div>
              </div>

              <Textarea
                label={L('Delivery notes (optional)', 'Notas para la entrega (opcional)')}
                rows={3}
                error={errors.delivery_notes?.message}
                {...register('delivery_notes')}
              />

              {submitError && <p className="text-sm text-danger font-body">{submitError}</p>}

              <div className="flex gap-3 justify-end mt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors"
                >
                  {L('Cancel', 'Cancelar')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="h-11 px-5 rounded-xl text-sm font-semibold font-display bg-brand text-white hover:bg-brand-mid transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? '…' : editingId ? L('Save', 'Guardar') : L('Create', 'Crear')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeDelete}>
          <div className="bg-card rounded-lg p-6 shadow-modal w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold font-display text-ink mb-2">{L('Delete address?', '¿Eliminar esta dirección?')}</h3>
            <p className="text-sm text-gray font-body mb-5">{L("This can't be undone.", 'No se puede deshacer.')}</p>
            {deleteError && (
              <div role="alert" className="mb-5 rounded-lg bg-danger-bg border border-danger/20 px-3 py-2.5">
                <p className="text-[13px] text-danger font-body">{deleteError.text}</p>
                {deleteError.plan && (
                  <button
                    type="button"
                    onClick={() => navigate('/profile/home-grocery?tab=details')}
                    className="mt-1.5 text-[13px] font-bold text-brand hover:text-brand-mid font-display"
                  >
                    {L('Change my delivery information', 'Cambiar mis datos de entrega')}
                  </button>
                )}
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={closeDelete}
                className="h-11 px-5 rounded-xl text-sm font-semibold font-display border-2 border-border text-gray hover:bg-surface-linen transition-colors"
              >
                {deleteError ? L('Close', 'Cerrar') : L('Cancel', 'Cancelar')}
              </button>
              {!deleteError && (
                <button
                  onClick={handleDelete}
                  disabled={remove.isPending}
                  className="h-11 px-5 rounded-xl text-sm font-semibold font-display bg-danger text-white hover:bg-danger/90 transition-colors disabled:opacity-50"
                >
                  {remove.isPending ? '…' : L('Delete', 'Eliminar')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
