import { forwardRef, useEffect, useMemo, useRef, type ChangeEvent } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { X, User, Building2, Mail, Phone, Hash, MessageSquare, ArrowRight, type LucideIcon } from 'lucide-react';
import { useSubmitLead } from '@grocery-app/shared';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';
import { useLanguageStore } from '@/stores/languageStore';
import { useToast } from '@/components/Toast';

/**
 * Same hand-rolled modal chrome and react-hook-form + zod stack as
 * ContactSalesModal (apps/web/src/pages/B2bDealsPage.tsx) — this codebase
 * has no shared Modal/FormField primitive, so every modal composes its own.
 */

type FormFieldProps = {
  icon: LucideIcon; label: string; required?: boolean;
  placeholder?: string; type?: string; error?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'className' | 'placeholder'>;

const FormField = forwardRef<HTMLInputElement, FormFieldProps>(function FormField(
  { icon: Icon, label, required, placeholder, type = 'text', error, ...inputProps }, ref,
) {
  /**
   * AN EMAIL FIELD IS A LOWER-CASE FIELD. `users.email` is a plain unique
   * column, so Omar@gmail.com and omar@gmail.com were two different accounts
   * — on 2026-10-10 three people had ended up with two each and b2b clients
   * could not sign in with the address in their own welcome email. The API
   * normalises too and that is the guarantee; this is so the field shows what
   * will be stored. Assigning to e.target.value moves the caret to the end,
   * so it only happens when the text actually changes.
   */
  const isEmail = type === 'email';
  const forwardedChange = inputProps.onChange;
  const handleChange = isEmail
    ? (e: ChangeEvent<HTMLInputElement>) => {
        const lower = e.target.value.toLowerCase();
        if (e.target.value !== lower) e.target.value = lower;
        forwardedChange?.(e);
      }
    : forwardedChange;
  const ring = error
    ? 'border-danger focus:ring-danger/20 focus:border-danger'
    : 'border-border focus:ring-brand/30 focus:border-brand';
  return (
    <label className="block">
      <span className="text-[12px] font-semibold font-ui text-ink mb-1.5 inline-flex items-center gap-1.5">
        <Icon size={13} strokeWidth={2} className="text-muted" />
        {label}
        {required && <span className="text-brand">*</span>}
      </span>
      <input
        ref={ref}
        type={type}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        className={`w-full bg-surface-linen border rounded-xl h-11 px-3.5 text-[13.5px] font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 transition ${ring}`}
        {...(isEmail
          ? { autoCapitalize: 'none' as const, autoCorrect: 'off', spellCheck: false }
          : {})}
        {...inputProps}
        onChange={handleChange}
      />
      {error && (
        <span role="alert" className="block mt-1 text-[11.5px] text-danger font-ui font-medium">
          {error}
        </span>
      )}
    </label>
  );
});

interface QuotationFormState {
  name: string;
  company: string;
  email: string;
  phone: string;
  quantity: number;
  note: string;
}

const EMPTY_FORM: QuotationFormState = {
  name: '', company: '', email: '', phone: '', quantity: 1, note: '',
};

interface QuotationRequestModalProps {
  open: boolean;
  onClose: () => void;
  product: { id: string; name: string };
  initialQuantity: number;
}

export default function QuotationRequestModal({
  open, onClose, product, initialQuantity,
}: QuotationRequestModalProps) {
  const { lang } = useLanguageStore();
  const toast = useToast();
  const submitLead = useSubmitLead();
  const messages = useValidationMessages();
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      name:     r.name({ min: 2, max: 100 }),
      company:  r.name({ min: 2, max: 120 }),
      email:    r.email(),
      phone:    r.phoneIntl(),
      quantity: z.coerce.number().int().min(1, messages.required).max(100000),
      note:     r.optionalLongText(2000),
    });
  }, [messages]);

  const {
    register, handleSubmit, reset,
    formState: { errors, isSubmitting },
  } = useForm<QuotationFormState>({
    resolver: zodResolver(schema) as unknown as Resolver<QuotationFormState>,
    mode: 'onBlur',
    defaultValues: EMPTY_FORM,
  });

  useEffect(() => {
    if (!open) return;
    reset({ ...EMPTY_FORM, quantity: initialQuantity });
    const id = window.setTimeout(() => firstFieldRef.current?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open, initialQuantity, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const onSubmit = async (values: QuotationFormState) => {
    try {
      await submitLead.mutateAsync({
        type: 'quotation',
        source: 'product_detail_page',
        name: values.name,
        company: values.company,
        email: values.email,
        phone: values.phone,
        message: values.note.trim() ? values.note.trim() : null,
        quote_product_id: product.id,
        quote_product_name: product.name,
        quote_quantity: values.quantity,
        language: lang,
      });
      toast.success(
        lang === 'en' ? 'Request sent — thanks!' : 'Solicitud enviada, ¡gracias!',
        lang === 'en'
          ? "We'll get back to you with a quote."
          : 'Te enviaremos una cotización.',
      );
      onClose();
    } catch (err) {
      toast.error(
        lang === 'en' ? "We couldn't send your request" : 'No pudimos enviar tu solicitud',
        err instanceof Error ? err.message : (lang === 'en' ? 'Please try again.' : 'Por favor, inténtalo de nuevo.'),
      );
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quotation-request-title"
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
    >
      <button
        type="button"
        aria-label={lang === 'en' ? 'Close quotation form' : 'Cerrar formulario de cotización'}
        onClick={onClose}
        className="absolute inset-0 bg-veil/40 backdrop-blur-sm animate-[fadeIn_120ms_ease-out]"
      />
      <div className="relative w-full md:max-w-[560px] max-h-[92vh] bg-card md:rounded-2xl rounded-t-2xl shadow-[0_28px_80px_rgba(15,23,42,0.22)] overflow-hidden flex flex-col">
        <div className="relative bg-gradient-to-br from-brand-whisper via-card to-brand-mist/60 px-6 md:px-8 py-6 border-b border-border/60">
          <div className="absolute -top-10 -right-8 w-[180px] h-[180px] rounded-full bg-brand/[0.06] blur-2xl pointer-events-none" />
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === 'en' ? 'Close' : 'Cerrar'}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-card border border-border hover:border-brand hover:text-brand text-ink flex items-center justify-center transition-colors"
          >
            <X size={16} strokeWidth={2.25} />
          </button>
          <h2
            id="quotation-request-title"
            className="font-display text-[22px] md:text-[24px] text-ink tracking-tight leading-[1.15]"
            style={{ fontWeight: 700 }}
          >
            Request a Quotation - for bulk Quantity
          </h2>
          <p className="text-[13px] text-gray font-body mt-1.5 leading-snug">
            {product.name}
          </p>
        </div>

        <form id="quotation-request-form" onSubmit={handleSubmit(onSubmit)} noValidate className="px-6 md:px-8 py-6 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              icon={User}
              label={lang === 'en' ? 'Your name' : 'Tu nombre'}
              required
              placeholder={lang === 'en' ? 'Full name' : 'Nombre completo'}
              error={errors.name?.message}
              {...register('name')}
              ref={(el) => {
                register('name').ref(el);
                firstFieldRef.current = el;
              }}
            />
            <FormField
              icon={Building2}
              label={lang === 'en' ? 'Company' : 'Empresa'}
              required
              placeholder="Acme S.L."
              error={errors.company?.message}
              {...register('company')}
            />
            <FormField
              icon={Mail}
              type="email"
              label={lang === 'en' ? 'Work email' : 'Email de trabajo'}
              required
              placeholder="name@company.com"
              error={errors.email?.message}
              {...register('email')}
            />
            <FormField
              icon={Phone}
              type="tel"
              label={lang === 'en' ? 'Phone' : 'Teléfono'}
              required
              placeholder="+34 600 000 000"
              error={errors.phone?.message}
              {...register('phone')}
            />
            <FormField
              icon={Hash}
              type="number"
              min={1}
              label={lang === 'en' ? 'Quantity' : 'Cantidad'}
              required
              error={errors.quantity?.message}
              {...register('quantity')}
            />
          </div>

          <label className="block mt-4">
            <span className="text-[12px] font-semibold font-ui text-ink mb-1.5 inline-flex items-center gap-1.5">
              <MessageSquare size={13} strokeWidth={2} className="text-muted" />
              {lang === 'en' ? 'Note (optional)' : 'Nota (opcional)'}
            </span>
            <textarea
              rows={4}
              placeholder={lang === 'en'
                ? 'Anything else we should know — delivery timing, packaging, etc.'
                : 'Cualquier detalle adicional: plazos de entrega, empaquetado, etc.'}
              aria-invalid={errors.note ? true : undefined}
              className={`w-full bg-surface-linen border rounded-xl px-3.5 py-3 text-[13.5px] font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 transition resize-none ${
                errors.note
                  ? 'border-danger focus:ring-danger/20 focus:border-danger'
                  : 'border-border focus:ring-brand/30 focus:border-brand'
              }`}
              {...register('note')}
            />
            {errors.note?.message && (
              <span role="alert" className="block mt-1 text-[11.5px] text-danger font-ui font-medium">
                {errors.note.message}
              </span>
            )}
          </label>

          <p className="text-[11.5px] text-muted font-ui mt-4 leading-snug">
            {lang === 'en'
              ? 'By submitting you agree we may contact you about this request. We never share your details.'
              : 'Al enviar aceptas que te contactemos sobre esta solicitud. Nunca compartimos tus datos.'}
          </p>
        </form>

        <div className="px-6 md:px-8 py-4 border-t border-border/60 bg-surface-linen flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] font-bold font-ui text-gray hover:text-ink transition-colors"
          >
            {lang === 'en' ? 'Cancel' : 'Cancelar'}
          </button>
          <button
            type="submit"
            form="quotation-request-form"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-brand text-white text-[13px] font-bold font-ui hover:bg-brand-deepest transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? (lang === 'en' ? 'Sending…' : 'Enviando…')
              : (lang === 'en' ? 'Send request' : 'Enviar solicitud')}
            <ArrowRight size={14} strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
