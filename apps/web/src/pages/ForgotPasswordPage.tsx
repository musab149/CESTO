import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, ArrowLeft, ArrowRight, CheckCircle2, Inbox, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';
import { TextField } from '@/components/form';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';

interface ForgotForm {
  email: string;
}

export default function ForgotPasswordPage() {
  const { t } = useLanguageStore();
  const navigate = useNavigate();
  const forgotPassword = useAuthStore((s) => s.forgotPassword);
  const messages = useValidationMessages();

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({ email: r.email() });
  }, [messages]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    getValues,
  } = useForm<ForgotForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { email: '' },
  });

  const [sent, setSent] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const sentEmail = getValues('email');

  const onSubmit = async (values: ForgotForm) => {
    setSubmitError(null);
    const result = await forgotPassword(values.email);
    if (result.ok) {
      setSent(true);
    } else if (result.status === 404) {
      setSubmitError(t('auth.forgot.not_found'));
    } else if (result.status === 429) {
      setSubmitError(t('auth.forgot.rate_limited'));
    } else {
      setSubmitError(result.error ?? t('auth.forgot.error_generic'));
    }
  };

  return (
    <div className="w-full max-w-[440px]">
      {!sent ? (
        <>
          <div className="w-16 h-16 rounded-lg bg-brand-mist border border-brand-soft/40 flex items-center justify-center mb-6">
            <Mail size={28} strokeWidth={1.75} className="text-brand" />
          </div>

          <h1 className="font-display text-[28px] lg:text-[32px] text-ink leading-[1.1] tracking-tight mb-2" style={{ fontWeight: 600 }}>
            {t('auth.forgot.title')}
          </h1>
          <p className="text-[14.5px] text-gray font-body mb-8 leading-relaxed">
            {t('auth.forgot.subtitle')}
          </p>

          {submitError && (
            <div className="flex items-start gap-3 bg-danger-bg border border-danger/20 rounded-xl px-4 py-3 mb-5 animate-in fade-in slide-in-from-top-1">
              <AlertCircle size={18} strokeWidth={2} className="text-danger shrink-0 mt-0.5" />
              <p className="text-sm font-bold font-ui text-danger">{submitError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
            <TextField
              label={t('auth.login.email')}
              type="email"
              autoComplete="email"
              placeholder={t('auth.login.email_placeholder')}
              leadingIcon={<Mail size={18} strokeWidth={1.75} />}
              autoFocus
              error={errors.email?.message}
              {...register('email')}
            />

            <button
              type="submit"
              disabled={isSubmitting}
              className="group w-full h-[54px] bg-brand text-white rounded-full text-[14px] font-bold font-ui hover:bg-brand-deepest active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  {t('common.loading')}
                </>
              ) : (
                <>
                  {t('auth.forgot.submit')}
                  <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </form>
        </>
      ) : (
        <div className="flex flex-col animate-in fade-in zoom-in-95 duration-300">
          <div className="relative w-24 h-24 mb-6">
            <div className="absolute inset-0 bg-brand-mist rounded-full animate-ping opacity-30" />
            <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-brand-mist to-brand-whisper border-2 border-brand/20 flex items-center justify-center">
              <CheckCircle2 size={44} strokeWidth={2} className="text-brand" />
            </div>
          </div>

          <h1 className="font-display text-[28px] lg:text-[32px] text-ink leading-[1.1] tracking-tight mb-3" style={{ fontWeight: 600 }}>
            {t('auth.forgot.sent_title')}
          </h1>
          <p className="text-[14.5px] text-gray font-body mb-6 leading-relaxed">
            {t('auth.forgot.sent_desc').replace('{email}', sentEmail)}
          </p>

          <div className="flex items-start gap-3 bg-brand-whisper border border-brand-mist rounded-xl px-4 py-4 mb-7">
            <Inbox size={18} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-bold text-ink font-ui mb-0.5">Check your inbox</p>
              <p className="text-xs text-gray font-body leading-relaxed">
                It may take up to 2 minutes to arrive. Don't forget to check your spam folder.
              </p>
            </div>
          </div>

          <button
            onClick={() => navigate('/login')}
            className="w-full h-[54px] bg-brand text-white rounded-full text-[14px] font-bold font-ui hover:bg-brand-deepest active:scale-[0.98] transition-all flex items-center justify-center gap-2"
          >
            <ArrowLeft size={18} />
            {t('auth.forgot.back')}
          </button>

          <button
            onClick={() => { setSent(false); reset(); }}
            className="w-full h-11 text-sm font-bold font-ui text-muted hover:text-ink transition-colors mt-3"
          >
            Try another email
          </button>
        </div>
      )}

      {!sent && (
        <div className="text-center mt-7">
          <Link to="/login" className="inline-flex items-center gap-2 text-sm text-brand font-bold hover:text-brand-ink hover:underline font-ui">
            <ArrowLeft size={14} />
            {t('auth.forgot.back')}
          </Link>
        </div>
      )}
    </div>
  );
}
