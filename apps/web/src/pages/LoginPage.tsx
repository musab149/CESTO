import { useMemo, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, ArrowRight, AlertCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';
import GoogleAuthButton from '@/components/GoogleAuthButton';
import { TextField, PasswordField, Checkbox } from '@/components/form';
import { useValidationMessages } from '@/lib/validation/messages';
import { rules } from '@/lib/validation/rules';

interface LoginForm {
  email: string;
  password: string;
  remember: boolean;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguageStore();
  const login = useAuthStore((s) => s.login);
  const messages = useValidationMessages();

  const schema = useMemo(() => {
    const r = rules(messages);
    return z.object({
      email: r.email(),
      // Login uses a min-length sanity check, NOT the strength rule — legacy
      // accounts may have shorter or weaker passwords than the new policy
      // requires for registration. Server is the authority here.
      password: z.string().min(1, messages.required),
      remember: z.boolean(),
    });
  }, [messages]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: { email: '', password: '', remember: true },
  });

  const [submitError, setSubmitError] = useState<string | null>(null);
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  /**
   * Read off the store rather than the login response: login() has already
   * written the User, and `is_sales_rep` rides on it.
   */
  const signedInAsRep = (): boolean => !!useAuthStore.getState().user?.is_sales_rep;

  /**
   * Where this account belongs once it is signed in.
   *
   * A sales rep goes to /sales and nowhere else — including when `from` names
   * a storefront page, because a rep following a shared product link is still
   * staff and CustomerOnlyRoute would bounce them there anyway. Sending them
   * straight to their own surface spares them the round trip.
   */
  const landing = (): string => {
    if (signedInAsRep()) return '/sales';
    // A business buyer shops in its own panel (2026-10-29): a panel page they
    // were sent from is kept; anything else lands on its front page, rather
    // than taking a round trip through the shop guard.
    if (useAuthStore.getState().user?.is_business) return from.startsWith('/business') ? from : '/business';
    return from;
  };

  const onSubmit = async (values: LoginForm) => {
    setSubmitError(null);
    const res = await login(values.email, values.password);
    if (!res.ok) {
      setSubmitError(t('auth.login.invalid'));
      return;
    }
    // Admin-issued temp password (partner approval, etc.) → force change
    // before the user reaches any authenticated surface. The `from` value
    // rides through as `?next=` so once they've rotated, they land where
    // they meant to go.
    // A rep's temp password is handled by SalesProtectedRoute, which sends
    // them to /sales/change-password in their own chrome. Routing them through
    // the customer rotate screen here would undo that.
    //
    // Asked as "is this a rep", NOT as "is the destination /sales": a rep who
    // was bounced to /login from their own app arrives with `from` ALREADY set
    // to /sales, so comparing the two answered yes on the most ordinary path
    // there is and sent them to the storefront anyway.
    if (res.must_change_password && !signedInAsRep() && useAuthStore.getState().user?.is_business) {
      // In the business panel's own screen, not the shop's (routeAccess).
      navigate('/business/change-password', { replace: true, state: { from: landing() } });
      return;
    }
    if (res.must_change_password && !signedInAsRep()) {
      const q = from && from !== '/' ? `?next=${encodeURIComponent(from)}` : '';
      navigate(`/profile/change-password${q}`, { replace: true });
      return;
    }
    navigate(landing(), { replace: true });
  };

  return (
    <div className="w-full max-w-[440px]">
      {/* Heading */}
      <h1
        className="font-display text-[28px] lg:text-[32px] text-ink leading-[1.1] tracking-tight mb-2"
        style={{ fontWeight: 600 }}
      >
        {t('auth.login.title')}
      </h1>
      <p className="text-[14.5px] text-gray font-body mb-8">{t('auth.login.subtitle')}</p>

      {/* Submit error banner — credentials rejected by server */}
      {submitError && (
        <div className="flex items-start gap-3 bg-danger-bg border border-danger/20 rounded-xl px-4 py-3 mb-5 animate-in fade-in slide-in-from-top-1">
          <AlertCircle size={18} strokeWidth={2} className="text-danger shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold font-ui text-danger">{submitError}</p>
            <p className="text-xs text-danger/80 font-body mt-0.5">{t('auth.login.demo_hint')}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <TextField
          label={t('auth.login.email')}
          type="email"
          autoComplete="email"
          placeholder={t('auth.login.email_placeholder')}
          leadingIcon={<Mail size={18} strokeWidth={1.75} />}
          error={errors.email?.message}
          {...register('email')}
        />

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="block text-[13px] font-semibold text-charcoal font-display">
              {t('auth.login.password')}
            </span>
            <button
              type="button"
              onClick={() => navigate('/forgot-password')}
              className="text-[12px] font-semibold text-brand hover:text-brand-mid hover:underline font-display"
            >
              {t('auth.login.forgot')}
            </button>
          </div>
          <PasswordField
            autoComplete="current-password"
            placeholder={t('auth.login.password_placeholder')}
            error={errors.password?.message}
            {...register('password')}
          />
        </div>

        <Checkbox
          label={t('auth.remember_me')}
          className="-mt-1"
          {...register('remember')}
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="group relative w-full h-[52px] bg-brand text-white rounded-full text-[14px] font-bold font-ui hover:bg-brand-deepest active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-brand overflow-hidden"
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
              {t('auth.login.submit')}
              <ArrowRight size={18} className="group-hover:translate-x-0.5 transition-transform" />
            </>
          )}
        </button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-4 my-7">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted font-body uppercase tracking-wider">{t('auth.or_continue')}</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <GoogleAuthButton
        onSuccess={() => navigate(landing(), { replace: true })}
        onError={(msg) => setSubmitError(msg)}
      />

      <div className="text-center text-sm font-body text-gray mt-8">
        {t('auth.login.no_account')}{' '}
        <Link to="/register" className="text-brand font-bold hover:text-brand-ink hover:underline font-ui">
          {t('auth.login.signup')}
        </Link>
      </div>
    </div>
  );
}
