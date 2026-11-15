import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Loader2, MapPin, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import {
  useAddresses, useCreateAddress, useDeleteAddress, useSetDefaultAddress, useUpdateAddress, type AddressInput,
} from '@grocery-app/shared';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';
import BackLink from '@/sales/components/BackLink';
import { Card, PageHeader, ListSkeleton } from '@/sales/components/ui';
import EmptyState from '@/sales/components/EmptyState';
import { Dialog } from '@/sales/components/Dialog';
import ConfirmModal from '@/sales/components/ConfirmModal';
import { useToast } from '@/sales/components/Toast';
import { TextField, Textarea } from '@/sales/components/form';
import { useBizT } from './lib/i18n';

/**
 * Where the business's orders go (2026-10-29): the shop's address book
 * (pages/AddressesPage, the same validation — Spanish postcodes, a phone the
 * rider can call) in the panel. Opened from checkout, it goes back there once
 * an address is saved.
 */

interface FormData {
  contact_name: string;
  contact_phone: string;
  street_line_1: string;
  street_line_2: string;
  postcode: string;
  city: string;
  province: string;
  delivery_notes: string;
}
const EMPTY: FormData = { contact_name: '', contact_phone: '', street_line_1: '', street_line_2: '', postcode: '', city: '', province: '', delivery_notes: '' };

export default function BusinessAddressesPage() {
  const t = useBizT();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const messages = useValidationMessages();
  const state = location.state as { from?: string; add?: boolean } | null;
  const from = state?.from;
  const { data: addresses, isLoading } = useAddresses();
  const create = useCreateAddress();
  const update = useUpdateAddress();
  const remove = useDeleteAddress();
  const setDefault = useSetDefaultAddress();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      contact_name: r.name({ min: 2, max: 100 }),
      contact_phone: r.phoneIntl(),
      street_line_1: r.shortText(200),
      street_line_2: z.string().trim().max(200, messages.tooLong(200)).optional().or(z.literal('')),
      postcode: r.postcode(),
      city: r.name({ min: 2, max: 80 }),
      province: r.name({ min: 2, max: 80 }),
      delivery_notes: z.string().trim().max(200, messages.tooLong(200)).optional().or(z.literal('')),
    });
  }, [messages]);
  const form = useForm<FormData>({ resolver: zodResolver(schema) as unknown as Resolver<FormData>, mode: 'onBlur', defaultValues: EMPTY });
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = form;

  const openAdd = () => { setEditingId(null); reset(EMPTY); setSubmitError(null); setOpen(true); };
  const openEdit = (id: string) => {
    const a = addresses?.find((x) => x.id === id);
    if (!a) return;
    setEditingId(id);
    reset({
      contact_name: a.contact_name, contact_phone: a.contact_phone, street_line_1: a.street_line_1, street_line_2: a.street_line_2 ?? '',
      postcode: a.postcode, city: a.city, province: a.province, delivery_notes: a.delivery_notes ?? '',
    });
    setSubmitError(null);
    setOpen(true);
  };

  // Sent here by checkout with nowhere to deliver: the form, open.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || !state?.add || isLoading) return;
    autoOpened.current = true;
    openAdd();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.add, isLoading]);

  const onSubmit = async (v: FormData) => {
    setSubmitError(null);
    const payload: AddressInput = {
      contact_name: v.contact_name, contact_phone: v.contact_phone, street_line_1: v.street_line_1,
      street_line_2: v.street_line_2 || undefined, postcode: v.postcode, city: v.city, province: v.province,
      delivery_notes: v.delivery_notes || undefined,
    };
    try {
      if (editingId) await update.mutateAsync({ id: editingId, input: payload });
      else await create.mutateAsync(payload);
      setOpen(false);
      toast.success(editingId ? t('biz.addr.saved') : t('biz.addr.added'));
      if (from === '/business/checkout' && !editingId) navigate('/business/checkout', { replace: true });
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : t('biz.addr.saveFailed'));
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await remove.mutateAsync(deleting);
      toast.success(t('biz.addr.deleted'));
    } catch (e) {
      toast.error(t('biz.addr.deleteFailed'), e instanceof Error ? e.message : undefined);
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div>
      <BackLink
        label={from === '/business/checkout' ? t('biz.checkout.title') : t('biz.nav.account')}
        title={t('biz.account.addresses')}
        onClick={() => navigate(from ?? '/business/account')}
      />
      <PageHeader
        title={t('biz.account.addresses')}
        subtitle={t('biz.addr.subtitle')}
        actions={(
          <button type="button" onClick={openAdd} className="h-10 px-3.5 rounded-xl bg-brand hover:bg-brand-mid text-white text-[13.5px] font-semibold font-display inline-flex items-center gap-1.5 transition-colors">
            <Plus size={17} strokeWidth={2.25} />{t('biz.addr.add')}
          </button>
        )}
      />

      {isLoading ? (
        <Card><ListSkeleton rows={3} /></Card>
      ) : !addresses?.length ? (
        <Card>
          <EmptyState
            icon={<MapPin size={28} strokeWidth={1.75} className="text-muted" />}
            title={t('biz.addr.emptyTitle')}
            description={t('biz.addr.emptyBody')}
            action={{ label: t('biz.addr.add'), onClick: openAdd }}
          />
        </Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {addresses.map((a) => (
            <li key={a.id}>
              <Card className={`h-full p-4 sm:p-5 flex flex-col ${a.is_default ? 'ring-2 ring-brand/30' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${a.is_default ? 'bg-brand text-white' : 'bg-brand-whisper text-brand'}`}><MapPin size={18} strokeWidth={1.75} /></span>
                  <div className="min-w-0 flex-1">
                    {a.is_default && <span className="inline-flex items-center gap-1 h-5 px-1.5 mb-1 rounded-md bg-brand-whisper text-[11.5px] font-bold font-display text-brand"><Star size={11} fill="currentColor" />{t('biz.addr.default')}</span>}
                    <p className="text-[15px] font-semibold font-display text-ink">{a.street_line_1}</p>
                    {a.street_line_2 && <p className="text-[13px] text-gray">{a.street_line_2}</p>}
                    <p className="text-[13px] text-gray">{[a.postcode, a.city, a.province].filter(Boolean).join(' · ')}</p>
                    <p className="text-[12.5px] text-muted mt-1">{a.contact_name} · {a.contact_phone}</p>
                    {a.delivery_notes && <p className="text-[12.5px] text-muted mt-1 italic">“{a.delivery_notes}”</p>}
                  </div>
                </div>
                <div className="mt-auto pt-3 flex items-center gap-1.5 flex-wrap">
                  {!a.is_default && (
                    <button type="button" onClick={() => setDefault.mutate(a.id)} disabled={setDefault.isPending} className="h-9 px-3 rounded-lg border border-border bg-card text-[13px] font-semibold font-display text-ink hover:border-brand/40 hover:text-brand transition-colors">
                      {t('biz.addr.makeDefault')}
                    </button>
                  )}
                  <button type="button" onClick={() => openEdit(a.id)} aria-label={t('biz.addr.edit')} className="h-9 px-3 rounded-lg text-[13px] font-semibold font-display text-brand hover:bg-brand-whisper inline-flex items-center gap-1.5"><Pencil size={14} />{t('biz.addr.edit')}</button>
                  <button type="button" onClick={() => setDeleting(a.id)} aria-label={t('biz.addr.delete')} className="ml-auto h-9 w-9 rounded-lg text-muted hover:text-danger hover:bg-danger-bg flex items-center justify-center"><Trash2 size={16} strokeWidth={1.75} /></button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <Dialog
          variant="side"
          onClose={() => setOpen(false)}
          icon={MapPin}
          title={editingId ? t('biz.addr.editTitle') : t('biz.addr.addTitle')}
          closeLabel={t('biz.closeMenu')}
          footer={(
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setOpen(false)} className="h-11 px-4 rounded-xl border border-border bg-card text-[14px] font-semibold font-display text-ink hover:bg-surface-cream">{t('biz.cancel')}</button>
              <button type="submit" form="biz-address-form" disabled={isSubmitting} className="h-11 px-5 rounded-xl bg-brand text-white text-[14px] font-semibold font-display hover:bg-brand-mid disabled:opacity-60 inline-flex items-center gap-2">
                {isSubmitting && <Loader2 size={16} className="animate-spin" />}{t('biz.addr.save')}
              </button>
            </div>
          )}
        >
          <form id="biz-address-form" onSubmit={handleSubmit(onSubmit)} className="grid gap-3" noValidate>
            <TextField label={t('biz.addr.contactName')} autoComplete="name" error={errors.contact_name?.message} {...register('contact_name')} />
            <TextField label={t('biz.addr.phone')} type="tel" autoComplete="tel" error={errors.contact_phone?.message} {...register('contact_phone')} />
            <TextField label={t('biz.addr.street')} autoComplete="address-line1" error={errors.street_line_1?.message} {...register('street_line_1')} />
            <TextField label={t('biz.addr.street2')} autoComplete="address-line2" error={errors.street_line_2?.message} {...register('street_line_2')} />
            <div className="grid grid-cols-[120px_1fr] gap-3">
              <TextField label={t('biz.addr.postcode')} inputMode="numeric" autoComplete="postal-code" className="font-mono" error={errors.postcode?.message} {...register('postcode')} />
              <TextField label={t('biz.addr.city')} autoComplete="address-level2" error={errors.city?.message} {...register('city')} />
            </div>
            <TextField label={t('biz.addr.province')} autoComplete="address-level1" error={errors.province?.message} {...register('province')} />
            <Textarea label={t('biz.addr.notes')} rows={3} error={errors.delivery_notes?.message} {...register('delivery_notes')} />
            {submitError && <p role="alert" className="text-[13px] text-danger bg-danger-bg rounded-xl px-3 py-2">{submitError}</p>}
          </form>
        </Dialog>
      )}

      <ConfirmModal
        open={!!deleting}
        danger
        title={t('biz.addr.deleteTitle')}
        message={t('biz.addr.deleteBody')}
        confirmLabel={t('biz.addr.delete')}
        cancelLabel={t('biz.cancel')}
        confirmDisabled={remove.isPending}
        onConfirm={() => void doDelete()}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
