import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { User, Mail, Phone, ArrowRight, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';
import GoogleAuthButton from '@/components/GoogleAuthButton';
import { TextField, PasswordField, Checkbox } from '@/components/form';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';

interface RegisterForm {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirm: string;
  terms: boolean;
}

function getPasswordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  return score as 0 | 1 | 2 | 3;
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { t } = useLanguageStore();
  const register = useAuthStore((s) => s.register);
  const messages = useValidationMessages();

  const schema = useMemo(() => {
    const r = rules(messages);
    return z
      .object({
        name:     r.name({ min: 2, max: 80 }),
        email:    r.email(),
        phone:    r.phoneIntl(),
        password: r.password({ min: 8, strong: true }),
        confirm:  z.string().min(1, messages.required),
        terms:    r.mustBeTrue(),
      })
      .refine((v) => v.password === v.confirm, {
        path: ['confirm'],
        message: messages.passwordMatch,
      });
  }, [messages]);

  const {
    register: rhfRegister,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(schema) as unknown as Resolver<RegisterForm>,
    mode: 'onBlur',
    defaultValues: {
      name: '', email: '', phone: '', password: '', confirm: '', terms: false,
    },
  });

  const password = watch('password');
  const confirm  = watch('confirm');
  const strength = useMemo(() => getPasswordStrength(password ?? ''), [password]);
  const strengthLabel = [null, t('auth.password_strength.weak'), t('auth.password_strength.medium'), t('auth.password_strength.strong')][strength];
  const strengthColor = ['bg-border', 'bg-danger', 'bg-amber', 'bg-brand'][strength];
  const strengthTextColor = ['text-muted', 'text-danger', 'text-amber-deep', 'text-brand'][strength];

  const [submitError, setSubmitError] = useState<string | null>(null);

  const onSubmit = async (values: RegisterForm) => {
    setSubmitError(null);
    const res = await register({
      name: values.name,
      email: values.email,
      phone: values.phone,
      password: values.password,
    });
    if (!res.ok) {
      setSubmitError(res.error || t('auth.login.invalid'));
      return;
    }
    navigate('/', { replace: true });
  };

  return (
    <div className="w-full max-w-[460px]">
      {/* Heading */}
      <h1
        className="font-display text-[28px] lg:text-[32px] text-ink leading-[1.1] tracking-tight mb-2"
        style={{ fontWeight: 600 }}
      >
        {t('auth.register.title')}
      </h1>
      <p className="text-[14.5px] text-gray font-body mb-7">{t('auth.register.subtitle')}</p>

      {submitError && (
        <div className="flex items-center gap-3 bg-danger-bg border border-danger/20 rounded-xl px-4 py-3 mb-5 animate-in fade-in slide-in-from-top-1">
          <AlertCircle size={18} strokeWidth={2} className="text-danger shrink-0" />
          <p className="text-sm font-bold font-ui text-danger">{submitError}</p>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <TextField
          label={t('auth.register.name')}
          autoComplete="name"
          placeholder={t('auth.register.name_placeholder')}
          leadingIcon={<User size={18} strokeWidth={1.75} />}
          error={errors.name?.message}
          {...rhfRegister('name')}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField
            label={t('auth.register.email')}
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            leadingIcon={<Mail size={18} strokeWidth={1.75} />}
            error={errors.email?.message}
            {...rhfRegister('email')}
          />
          <TextField
            label={t('auth.register.phone')}
            type="tel"
            autoComplete="tel"
            placeholder={t('auth.register.phone_placeholder')}
            leadingIcon={<Phone size={18} strokeWidth={1.75} />}
            error={errors.phone?.message}
            {...rhfRegister('phone')}
          />
        </div>

        {/* Password + strength meter */}
        <div>
          <PasswordField
            label={t('auth.register.password')}
            autoComplete="new-password"
            placeholder={t('auth.register.password_placeholder')}
            error={errors.password?.message}
            {...rhfRegister('password')}
          />
          {password && !errors.password && (
            <div className="flex items-center gap-3 mt-2.5">
              <div className="flex gap-1 flex-1">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-all ${i <= strength ? strengthColor : 'bg-border'}`}
                  />
                ))}
              </div>
              {strengthLabel && (
                <span className={`text-[11px] font-bold font-ui ${strengthTextColor}`}>
                  {strengthLabel}
                </span>
              )}
            </div>
          )}
        </div>

        <PasswordField
          label={t('auth.register.confirm')}
          autoComplete="new-password"
          error={errors.confirm?.message}
          success={!!confirm && !errors.confirm && password === confirm}
          {...rhfRegister('confirm')}
        />

        <Checkbox
          label={t('auth.register.terms')}
          error={errors.terms?.message}
          className="mt-1"
          {...rhfRegister('terms')}
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="group relative w-full h-[52px] bg-brand text-white rounded-full text-[14px] font-bold font-ui hover:bg-brand-deepest active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed mt-2"
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
              {t('auth.register.submit')}
              <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </>
          )}
        </button>
      </form>

      <div className="flex items-center gap-4 my-6">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted font-body uppercase tracking-wider">{t('auth.or_continue')}</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <GoogleAuthButton
        onSuccess={() => navigate('/', { replace: true })}
        onError={(msg) => setSubmitError(msg)}
      />

      <div className="text-center text-sm font-body text-gray mt-6">
        {t('auth.register.have_account')}{' '}
        <Link to="/login" className="text-brand font-bold hover:text-brand-ink hover:underline font-ui">
          {t('auth.register.signin')}
        </Link>
      </div>
    </div>
  );
}
