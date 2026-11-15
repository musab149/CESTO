import { useEffect, useMemo, useState } from 'react';
import { EMAIL_INPUT_PROPS, lowercaseEmail } from '@/lib/emailField';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft, Mail, Phone, MessageSquare, Send, CheckCircle2, Loader2,
  Sparkles, Clock, AlertCircle,
} from 'lucide-react';
import { useSubmitSupportTicket, useStoreSettings } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';
import { WHATSAPP_NUMBER } from '@/lib/contact';

const SUPPORT_EMAIL_FALLBACK    = 'support.cesto@gmail.com';
const SUPPORT_PHONE_FALLBACK    = '+34 602 848 222';

interface ContactForm {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

export default function ContactPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { lang } = useLanguageStore();
  const user = useAuthStore((s) => s.user);
  const submit = useSubmitSupportTicket();
  const messages = useValidationMessages();
  const { data: settings } = useStoreSettings();
  const SUPPORT_EMAIL = settings?.contactEmail?.trim() || SUPPORT_EMAIL_FALLBACK;
  const SUPPORT_PHONE = settings?.contactPhone?.trim() || SUPPORT_PHONE_FALLBACK;

  const source = (searchParams.get('source') || 'contact_form').slice(0, 40);

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      name:    r.name({ min: 2, max: 100 }),
      email:   r.email(),
      phone:   r.phoneIntlOptional(),
      subject: r.shortText(200),
      message: z.string().trim().min(10, messages.tooShort(10)).max(4000, messages.tooLong(4000)),
    });
  }, [messages]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ContactForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { name: '', email: '', phone: '', subject: '', message: '' },
  });

  // Pre-fill from logged-in user (best-effort).
  useEffect(() => {
    if (!user) return;
    if (user.name)  setValue('name', user.name, { shouldValidate: false });
    if (user.email) setValue('email', user.email, { shouldValidate: false });
    if (user.phone) setValue('phone', user.phone, { shouldValidate: false });
  }, [user, setValue]);

  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const message = watch('message') ?? '';

  const TXT = {
    eyebrow: lang === 'es' ? 'SOPORTE CESTO · MOSTRADOR EN VIVO' : 'CESTO SUPPORT · LIVE DESK',
    h1:      lang === 'es' ? 'Habla con un humano.' : 'Talk to a human.',
    lede:    lang === 'es'
      ? 'Personas reales, respondiendo en español, inglés o urdu.'
      : 'Real people, replying in Spanish, English or Urdu.',
    back:    lang === 'es' ? 'Volver al centro de ayuda' : 'Back to help center',
    channelsTitle: lang === 'es' ? 'O contáctanos directamente' : 'Or reach us directly',
    formTitle:    lang === 'es' ? 'Envíanos un mensaje' : 'Send us a message',
    formHelp:     lang === 'es' ? 'Responderemos al correo que nos des — no hace falta esperar en esta página.' : "We'll reply to the email you give us — no need to wait on this page.",
    nameLabel:    lang === 'es' ? 'Tu nombre' : 'Your name',
    namePh:       lang === 'es' ? 'María García' : 'Jane Doe',
    emailLabel:   lang === 'es' ? 'Correo electrónico' : 'Email address',
    emailPh:      lang === 'es' ? 'tu@ejemplo.com' : 'you@example.com',
    phoneLabel:   lang === 'es' ? 'Teléfono (opcional)' : 'Phone (optional)',
    phonePh:      '+34 6XX XXX XXX',
    subjectLabel: lang === 'es' ? 'Asunto' : 'Subject',
    subjectPh:    lang === 'es' ? 'Resumen breve de lo que ocurre' : "Short summary of what's going on",
    bodyLabel:    lang === 'es' ? 'Mensaje' : 'Message',
    bodyPh:       lang === 'es' ? 'Cuéntanos qué pasó. Incluye el número de pedido si es relevante.' : 'Tell us what happened. Include your order number if relevant.',
    sendBtn:      lang === 'es' ? 'Enviar mensaje' : 'Send message',
    sending:      lang === 'es' ? 'Enviando…' : 'Sending…',
    sentTitle:    lang === 'es' ? 'Mensaje recibido' : 'Message received',
    sentBody:     lang === 'es'
      ? 'Responderemos a {{email}}. Revisa tu bandeja de entrada (y el spam, por si acaso).'
      : "We'll reply to {{email}}. Watch your inbox (and the spam folder, just in case).",
    sentAgain:    lang === 'es' ? 'Enviar otro mensaje' : 'Send another message',
    serverErr:    lang === 'es' ? 'No pudimos enviar tu mensaje — por favor inténtalo de nuevo o escríbenos directamente.' : "We couldn't send your message — please try again or email us directly.",
  };

  const onSubmit = async (values: ContactForm) => {
    setSubmitError(null);
    try {
      await submit.mutateAsync({
        name:    values.name,
        email:   values.email,
        phone:   values.phone || null,
        subject: values.subject,
        body:    values.message,
        source,
        language: lang,
      });
      setSentEmail(values.email);
      setSent(true);
      reset({ name: values.name, email: values.email, phone: values.phone, subject: '', message: '' });
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : TXT.serverErr);
    }
  };

  // Shared input visual — preserved as-is from the original page so the
  // contact form keeps its lighter style (h-11, bg-surface-linen) instead of
  // the 52px auth-input style.
  const baseInput =
    'w-full h-11 px-4 rounded-lg border bg-surface-linen text-[14px] font-body text-ink placeholder:text-muted focus:bg-card focus:outline-none transition-colors';
  const ringFor = (hasErr: boolean) =>
    hasErr ? 'border-danger focus:border-danger' : 'border-border focus:border-brand';

  if (sent) {
    return (
      <div className="bg-surface-linen min-h-screen">
        <div className="max-w-[760px] mx-auto px-6 lg:px-10 py-16 lg:py-24 text-center rise-in">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-amber-mist border border-amber-mid mb-6">
            <CheckCircle2 size={36} strokeWidth={1.75} className="text-amber-deep" />
          </div>
          <h1 className="font-display text-[32px] md:text-[42px] text-ink tracking-tight leading-[1.05]" style={{ fontWeight: 700 }}>
            {TXT.sentTitle}
          </h1>
          <p className="text-[15.5px] md:text-[17px] text-gray font-body mt-4 leading-relaxed max-w-[520px] mx-auto">
            {TXT.sentBody.replace('{{email}}', sentEmail)}
          </p>
          <div className="mt-8 flex items-center justify-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => { setSent(false); setSubmitError(null); }}
              className="inline-flex items-center gap-2 h-12 px-5 rounded-full border-2 border-border bg-card text-ink text-[13.5px] font-bold font-ui hover:border-brand hover:text-brand transition-colors"
            >
              <Send size={14} strokeWidth={2} />
              {TXT.sentAgain}
            </button>
            <Link
              to="/help"
              className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-brand text-white text-[13.5px] font-bold font-ui hover:bg-brand-deepest transition-colors shadow-brand"
            >
              {TXT.back}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-linen min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden bg-surface-mint">
        <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-brand-mist/60 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 right-1/4 w-[480px] h-[480px] rounded-full bg-amber-mist/60 blur-3xl pointer-events-none" />

        <div className="relative max-w-[1100px] mx-auto px-6 lg:px-10 pt-12 pb-10 lg:pt-16 lg:pb-12">
          <button onClick={() => navigate('/help')} className="rise-in inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray hover:text-brand font-ui transition-colors mb-6">
            <ArrowLeft size={13} strokeWidth={2} />
            {TXT.back}
          </button>

          <div className="max-w-[680px]">
            <div className="rise-in-1">
              <span className="inline-flex items-center gap-2 bg-white/80 backdrop-blur text-brand text-[10.5px] font-bold tracking-[0.18em] uppercase px-3 py-1.5 rounded-full font-ui border border-brand-mist">
                <Sparkles size={11} strokeWidth={2.5} />
                {TXT.eyebrow}
              </span>
            </div>
            <h1 className="rise-in-2 font-display text-[40px] md:text-[56px] lg:text-[64px] text-ink mt-5 leading-[0.98] tracking-tight" style={{ fontWeight: 700 }}>
              {TXT.h1}
            </h1>
            <p className="rise-in-3 text-[15.5px] md:text-[17px] text-gray font-body mt-5 leading-relaxed max-w-[600px]">{TXT.lede}</p>
            <div className="rise-in-4 mt-5 inline-flex items-center gap-2 text-[12.5px] font-ui text-amber-deep">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-deep animate-pulse" />
              <Clock size={13} strokeWidth={2} />
              {lang === 'es' ? 'Respuesta promedio: 2h 40min' : 'Average reply time: 2h 40min'}
            </div>
          </div>
        </div>

        <svg viewBox="0 0 1440 60" preserveAspectRatio="none" className="block w-full h-[60px] relative -mb-px text-surface-linen">
          <path d="M 0 60 Q 360 0, 720 30 T 1440 12 L 1440 60 Z" fill="currentColor" />
        </svg>
      </section>

      {/* Form + side channels */}
      <div className="max-w-[1100px] mx-auto px-6 lg:px-10 pt-10 pb-20 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10 items-start">
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-card rise-in"
          noValidate
        >
          <h2 className="font-display text-[22px] md:text-[26px] text-ink tracking-tight leading-tight" style={{ fontWeight: 700 }}>
            {TXT.formTitle}
          </h2>
          <p className="text-[13.5px] text-gray font-body mt-1.5">{TXT.formHelp}</p>

          <div className="mt-7 grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label={`${TXT.nameLabel} *`}
              error={errors.name?.message}
            >
              <input type="text" autoComplete="name" placeholder={TXT.namePh} className={`${baseInput} ${ringFor(!!errors.name)}`} {...register('name')} />
            </Field>
            <Field label={`${TXT.emailLabel} *`} error={errors.email?.message}>
              <input type="email" autoComplete="email" {...EMAIL_INPUT_PROPS} placeholder={TXT.emailPh} className={`${baseInput} ${ringFor(!!errors.email)}`} {...lowercaseEmail(register('email'))} />
            </Field>
          </div>

          <Field label={TXT.phoneLabel} error={errors.phone?.message} className="mt-4">
            <input type="tel" autoComplete="tel" placeholder={TXT.phonePh} className={`${baseInput} ${ringFor(!!errors.phone)} max-w-[320px]`} {...register('phone')} />
          </Field>

          <Field label={`${TXT.subjectLabel} *`} error={errors.subject?.message} className="mt-4">
            <input type="text" maxLength={200} placeholder={TXT.subjectPh} className={`${baseInput} ${ringFor(!!errors.subject)}`} {...register('subject')} />
          </Field>

          <Field label={`${TXT.bodyLabel} *`} error={errors.message?.message} className="mt-4">
            <textarea
              rows={7}
              maxLength={4000}
              placeholder={TXT.bodyPh}
              className={`w-full p-4 rounded-lg border bg-surface-linen text-[14px] font-body text-ink placeholder:text-muted focus:bg-card focus:outline-none transition-colors resize-y leading-relaxed ${ringFor(!!errors.message)}`}
              {...register('message')}
            />
            <p className="mt-1.5 text-right text-[11px] font-mono text-muted">{message.length} / 4000</p>
          </Field>

          {submitError && (
            <div className="mt-4 px-4 py-3 rounded-lg bg-danger-bg border border-danger/30 text-[13px] text-danger font-body flex items-start gap-2">
              <AlertCircle size={14} strokeWidth={2} className="shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-4 flex-wrap">
            <p className="text-[11.5px] font-ui text-muted">
              {lang === 'es' ? 'Al enviar, aceptas que respondamos al correo indicado.' : 'By sending, you agree we may reply to the email you provided.'}
            </p>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 h-12 px-6 rounded-full bg-brand text-white text-[13.5px] font-bold font-ui hover:bg-brand-deepest transition-colors shadow-brand disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={14} strokeWidth={2.25} className="animate-spin" />
                  {TXT.sending}
                </>
              ) : (
                <>
                  <Send size={14} strokeWidth={2} />
                  {TXT.sendBtn}
                </>
              )}
            </button>
          </div>
        </form>

        {/* Alternate channels — unchanged */}
        <aside className="space-y-4 rise-in-2">
          <p className="text-[10.5px] font-bold tracking-[0.18em] uppercase text-gray font-ui">{TXT.channelsTitle}</p>

          <a href={`mailto:${SUPPORT_EMAIL}`} className="group block p-5 rounded-2xl bg-card border border-border hover:border-brand hover:shadow-card-hover transition-all">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-whisper flex items-center justify-center shrink-0 group-hover:bg-brand group-hover:text-white text-brand transition-colors">
                <Mail size={18} strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-muted font-ui">Email</p>
                <p className="text-[14px] font-semibold font-display text-ink mt-0.5 truncate">{SUPPORT_EMAIL}</p>
                <p className="text-[12px] text-gray font-body mt-1">{lang === 'es' ? 'Respuesta en menos de 4h' : 'Reply within 4h'}</p>
              </div>
            </div>
          </a>

          <a href={`tel:${SUPPORT_PHONE.replace(/\s/g, '')}`} className="group block p-5 rounded-2xl bg-card border border-border hover:border-brand hover:shadow-card-hover transition-all">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-brand-whisper flex items-center justify-center shrink-0 group-hover:bg-brand group-hover:text-white text-brand transition-colors">
                <Phone size={18} strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-muted font-ui">{lang === 'es' ? 'Teléfono' : 'Phone'}</p>
                <p className="text-[14px] font-semibold font-display text-ink mt-0.5 font-mono">{SUPPORT_PHONE}</p>
                <p className="text-[12px] text-gray font-body mt-1">{lang === 'es' ? 'Lun–Sáb · 9 AM–9 PM' : 'Mon–Sat · 9 AM–9 PM'}</p>
              </div>
            </div>
          </a>

          <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" className="group block p-5 rounded-2xl bg-surface-mint border border-amber-mist hover:border-amber-deep hover:shadow-card-hover transition-all">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-mist flex items-center justify-center shrink-0 group-hover:bg-amber-deep group-hover:text-white text-amber-deep transition-colors">
                <MessageSquare size={18} strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <p className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-amber-deep font-ui">WhatsApp</p>
                <p className="text-[14px] font-semibold font-display text-ink mt-0.5">{lang === 'es' ? 'Chatea con nosotros' : 'Chat with us'}</p>
                <p className="text-[12px] text-gray font-body mt-1">{lang === 'es' ? 'La respuesta más rápida' : 'Fastest reply'}</p>
              </div>
            </div>
          </a>
        </aside>
      </div>
    </div>
  );
}

/* Small wrapper to keep the contact page's inline label+error pattern DRY. */
function Field({
  label, error, children, className,
}: {
  label: string; error?: string; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[12.5px] font-semibold font-ui text-ink mb-1.5">{label}</label>
      {children}
      {error && (
        <p role="alert" className="flex items-start gap-1.5 mt-1.5 text-[12px] text-danger font-ui font-medium">
          <AlertCircle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
