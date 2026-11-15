import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, ArrowRight, KeyRound, Check, AlertCircle } from 'lucide-react';
import { useResetPassword } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { PasswordField } from '@/components/form';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';

interface ResetForm {
  newPassword: string;
  confirmPassword: string;
}

export default function ResetPasswordPage() {
  const { t } = useLanguageStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const resetPw = useResetPassword();
  const messages = useValidationMessages();

  const schema = useMemo(() => {
    const r = rules(messages);
    return z
      .object({
        newPassword: r.password({ min: 8, strong: true }),
        confirmPassword: z.string().min(1, messages.required),
      })
      .refine((v) => v.newPassword === v.confirmPassword, {
        path: ['confirmPassword'],
        message: messages.passwordMatch,
      });
  }, [messages]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword');
  const meetsLength = (newPassword?.length ?? 0) >= 8;
  const meetsUpper = /[A-Z]/.test(newPassword ?? '');
  const meetsNumber = /[0-9]/.test(newPassword ?? '');

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (values: ResetForm) => {
    setSubmitError(null);
    try {
      await resetPw.mutateAsync({ token, newPassword: values.newPassword });
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('reset.error_generic'));
    }
  };

  if (!token) {
    return (
      <div className="w-full max-w-[440px]">
        <div className="w-16 h-16 rounded-lg bg-danger-bg flex items-center justify-center mb-6">
          <AlertCircle size={28} strokeWidth={1.75} className="text-danger" />
        </div>
        <h1 className="font-display text-[28px] lg:text-[32px] text-ink leading-[1.1] tracking-tight mb-2" style={{ fontWeight: 600 }}>
          {t('reset.missing_title')}
        </h1>
        <p className="text-[15px] text-gray font-body mb-6">{t('reset.missing_desc')}</p>
        <Link
          to="/forgot-password"
          className="inline-flex items-center justify-center gap-2 h-[52px] w-full bg-brand text-white rounded-full text-[14px] font-bold font-ui hover:bg-brand-deepest transition-colors"
        >
          {t('reset.request_new')}
          <ArrowRight size={18} />
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="w-full max-w-[440px] flex flex-col">
        <div className="relative w-24 h-24 mb-6">
          <div className="absolute inset-0 bg-brand-mist rounded-full animate-ping opacity-30" />
          <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-brand-mist to-brand-whisper border-2 border-brand/20 flex items-center justify-center">
            <Check size={44} strokeWidth={2} className="text-brand" />
          </div>
        </div>
        <h1 className="font-display text-[28px] lg:text-[32px] text-ink leading-[1.1] tracking-tight mb-3" style={{ fontWeight: 600 }}>
          {t('reset.success_title')}
        </h1>
        <p className="text-[15px] text-gray font-body mb-7 leading-relaxed">{t('reset.success_desc')}</p>
        <button
          onClick={() => navigate('/login')}
          className="w-full h-[54px] bg-brand text-white rounded-xl text-[15px] font-bold font-display hover:bg-brand-mid transition-colors flex items-center justify-center gap-2"
        >
          {t('reset.go_to_login')}
          <ArrowRight size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[440px]">
      <div className="w-16 h-16 rounded-lg bg-brand-mist border border-brand-soft/40 flex items-center justify-center mb-6">
        <KeyRound size={28} strokeWidth={1.75} className="text-brand" />
      </div>

      <h1 className="font-display text-[28px] lg:text-[32px] text-ink leading-[1.1] tracking-tight mb-2" style={{ fontWeight: 600 }}>
        {t('reset.title')}
      </h1>
      <p className="text-[15px] text-gray font-body mb-8 leading-relaxed">{t('password.requirements')}</p>

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <div>
          <PasswordField
            label={t('password.new')}
            autoComplete="new-password"
            autoFocus
            hideLockIcon={false}
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
          {newPassword && newPassword.length > 0 && (
            <ul className="mt-2 space-y-1 text-[12px] font-body">
              <Requirement ok={meetsLength} label={t('reset.req_length')} />
              <Requirement ok={meetsUpper} label={t('reset.req_upper')} />
              <Requirement ok={meetsNumber} label={t('reset.req_number')} />
            </ul>
          )}
        </div>

        <PasswordField
          label={t('password.confirm')}
          autoComplete="new-password"
          error={errors.confirmPassword?.message}
          {...register('confirmPassword')}
        />

        {submitError && (
          <div className="bg-danger-bg border border-danger/30 rounded-xl px-4 py-3 flex items-start gap-2">
            <AlertCircle size={16} className="text-danger shrink-0 mt-0.5" />
            <p className="text-sm text-danger font-body">{submitError}</p>
          </div>
        )}

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
              {t('reset.submit')}
              <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </>
          )}
        </button>
      </form>

      <div className="text-center mt-7">
        <Link to="/login" className="inline-flex items-center gap-2 text-sm text-brand font-bold hover:text-brand-ink hover:underline font-ui">
          <ArrowLeft size={14} />
          {t('auth.forgot.back')}
        </Link>
      </div>
    </div>
  );
}

function Requirement({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-1.5 ${ok ? 'text-brand-ink' : 'text-muted'}`}>
      {ok ? <Check size={12} strokeWidth={2.5} /> : <span className="w-1.5 h-1.5 rounded-full bg-muted/40" />}
      {label}
    </li>
  );
}
