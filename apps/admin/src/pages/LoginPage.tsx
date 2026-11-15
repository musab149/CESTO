import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAdminAuthStore } from '@/stores/authStore';
import { TextField, PasswordField } from '@/components/form';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';

interface LoginForm {
  email: string;
  password: string;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAdminAuthStore((s) => s.login);
  const { t } = useTranslation();
  const messages = useValidationMessages();

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      email:    r.email(),
      // Admin password is checked server-side; require non-empty here.
      password: z.string().min(1, messages.required),
    });
  }, [messages]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { email: '', password: '' },
  });

  const [submitError, setSubmitError] = useState(false);

  const onSubmit = async (values: LoginForm) => {
    setSubmitError(false);
    const res = await login(values.email, values.password);
    if (res.ok) navigate('/');
    else setSubmitError(true);
  };

  return (
    <div className="min-h-screen bg-surface-linen flex items-center justify-center px-4">
      <div className="bg-card rounded-2xl shadow-float p-8 w-full max-w-md">
        {/* Logo & Title */}
        <div className="flex flex-col items-center mb-8">
          <img
            src="/cesto-icon.png"
            alt="Cesto"
            className="w-14 h-14 rounded-2xl shadow-card mb-4"
            draggable={false}
          />
          <h1 className="text-2xl font-bold font-display text-ink">{t('auth.title')}</h1>
          <p className="text-sm text-ink/60 mt-1 font-body">{t('auth.subtitle')}</p>
        </div>

        {submitError && (
          <div className="mb-4 rounded-lg bg-danger-bg border border-danger/20 px-4 py-3 text-sm text-danger font-display">
            {t('auth.error')}
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <TextField
            label={t('auth.email')}
            type="email"
            placeholder="name@cestoshop.com"
            autoComplete="email"
            leadingIcon={<Mail size={18} strokeWidth={1.75} />}
            error={errors.email?.message}
            {...register('email')}
          />

          <PasswordField
            label={t('auth.password')}
            placeholder="••••••••"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full h-[52px] rounded-xl bg-brand hover:bg-brand-mid text-white font-display font-semibold text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <span className="inline-block h-5 w-5 border-2 border-white/30 border-t-card rounded-full animate-spin" />
            ) : (
              <>
                <LogIn size={18} strokeWidth={1.75} />
                {t('auth.signIn')}
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
