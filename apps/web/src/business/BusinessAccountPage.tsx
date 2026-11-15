import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, ChevronRight, Globe, KeyRound, Loader2, Lock, LogOut, Mail, MapPin, MessageSquare, Moon, Pencil, Phone, Sun, SunMoon, UserRound } from 'lucide-react';
import { useAddresses, useBusinessMe, useUpdateProfile } from '@grocery-app/shared';
import { useAuthStore } from '@/stores/authStore';
import { useLanguageStore } from '@/stores/languageStore';
import { shortDate } from '@/sales/lib/format';
import { Card, CardHeader, PageHeader } from '@/sales/components/ui';
import { Skeleton } from '@/sales/components/Skeleton';
import { useToast } from '@/sales/components/Toast';
import { useBizT } from './lib/i18n';
import { useBusinessTheme } from './lib/theme';

/**
 * "Mi empresa" (2026-10-29): who the business is and who orders for it, and
 * the account's settings. The business's own details — name, tax number,
 * what it is — were approved by the office and change through it (the shop's
 * rule, pages/ProfilePage), so they are shown, not edited. The person's name
 * can be changed here; the email is the login and is locked (feedback: email
 * is not editable).
 */
export default function BusinessAccountPage() {
  const t = useBizT();
  const navigate = useNavigate();
  const toast = useToast();
  const { lang, setLang } = useLanguageStore();
  const theme = useBusinessTheme();
  const user = useAuthStore((s) => s.user);
  const hydrate = useAuthStore((s) => s.hydrate);
  const logout = useAuthStore((s) => s.logout);
  const { data: me, isLoading } = useBusinessMe();
  const { data: addresses } = useAddresses();
  const updateProfile = useUpdateProfile();
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState('');

  const b = me?.business;
  const defaultAddress = addresses?.find((a) => a.is_default) ?? addresses?.[0];
  const saveName = async () => {
    const v = name.trim();
    if (v.length < 2) { toast.warning(t('biz.acc.nameShort')); return; }
    try {
      await updateProfile.mutateAsync({ name: v });
      await hydrate();
      setEditingName(false);
      toast.success(t('biz.acc.nameSaved'));
    } catch (e) {
      toast.error(t('biz.acc.nameFailed'), e instanceof Error ? e.message : undefined);
    }
  };

  const row = (label: string, value: React.ReactNode, mono = false) => (
    <div className="flex items-baseline justify-between gap-4 py-2.5 border-b border-border last:border-0">
      <dt className="text-[13.5px] text-gray shrink-0">{label}</dt>
      <dd className={`text-[14px] text-ink text-right min-w-0 break-words ${mono ? 'font-mono' : 'font-semibold font-display'}`}>{value || '—'}</dd>
    </div>
  );
  const link = (icon: React.ElementType, label: string, sub: string | null, onClick: () => void) => {
    const Icon = icon;
    return (
      <button type="button" onClick={onClick} className="w-full min-h-[60px] px-4 sm:px-5 flex items-center gap-3 text-left hover:bg-surface-cream transition-colors">
        <span className="w-9 h-9 rounded-xl bg-surface-cream text-gray flex items-center justify-center shrink-0"><Icon size={18} strokeWidth={1.75} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold font-display text-ink">{label}</span>
          {sub && <span className="block text-[12.5px] text-muted truncate">{sub}</span>}
        </span>
        <ChevronRight size={17} strokeWidth={1.75} className="text-muted shrink-0" />
      </button>
    );
  };

  return (
    <div>
      <PageHeader title={t('biz.nav.account')} subtitle={b?.company ?? undefined} />
      <div className="grid lg:grid-cols-2 gap-3 md:gap-4 items-start">
        {/* ── The business ── (min-w-0: a grid column grows to its widest
            line otherwise, and a long email pushed the page sideways) */}
        <Card className="overflow-hidden min-w-0">
          <CardHeader title={t('biz.acc.businessTitle')} icon={Building2} subtitle={b?.approved_at ? t('biz.acc.approved', { date: shortDate(b.approved_at, lang) }) : undefined} />
          {isLoading ? (
            <div className="p-5 space-y-3"><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-2/3" /></div>
          ) : (
            <>
              <dl className="px-4 sm:px-5 py-2">
                {row(t('biz.acc.company'), b?.company)}
                {row(t('biz.acc.taxId'), me?.user.tax_id || b?.registration_no, true)}
                {row(t('biz.acc.type'), b?.business_type)}
                {row(t('biz.acc.location'), b?.location)}
                {row(t('biz.acc.tradePhone'), b?.contact_phone)}
                {b?.website && row(t('biz.acc.website'), <a href={/^https?:\/\//.test(b.website) ? b.website : `https://${b.website}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">{b.website}</a>)}
              </dl>
              <p className="mx-4 sm:mx-5 mb-4 flex items-start gap-2 rounded-xl bg-surface-cream border border-border px-3 py-2.5 text-[12.5px] text-gray">
                <Lock size={14} strokeWidth={1.75} className="shrink-0 mt-px" />
                <span>{t('biz.acc.lockedNote')}{' '}
                  <button type="button" onClick={() => window.open('/contact', '_blank', 'noopener')} className="font-semibold text-brand hover:underline">{t('biz.acc.contactUs')}</button>
                </span>
              </p>
            </>
          )}
        </Card>

        <div className="flex flex-col gap-3 md:gap-4 min-w-0">
          {/* ── Who orders ── */}
          <Card className="overflow-hidden">
            <CardHeader title={t('biz.acc.contactTitle')} icon={UserRound} />
            <dl className="px-4 sm:px-5 py-2">
              <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border">
                <dt className="text-[13.5px] text-gray shrink-0">{t('biz.acc.name')}</dt>
                <dd className="min-w-0 flex-1 flex justify-end">
                  {editingName ? (
                    <span className="flex items-center gap-2 w-full max-w-[320px]">
                      <input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={100} className="flex-1 min-w-0 h-10 rounded-xl border border-border bg-card px-3 text-[14px] text-ink focus:outline-none focus:border-brand" />
                      <button type="button" onClick={() => void saveName()} disabled={updateProfile.isPending} className="h-10 px-3 rounded-xl bg-brand text-white text-[13px] font-semibold font-display hover:bg-brand-mid disabled:opacity-60 inline-flex items-center gap-1">
                        {updateProfile.isPending && <Loader2 size={14} className="animate-spin" />}{t('biz.acc.save')}
                      </button>
                      <button type="button" onClick={() => setEditingName(false)} className="h-10 px-2 text-[13px] font-semibold text-gray hover:text-ink">{t('biz.cancel')}</button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="text-[14px] font-semibold font-display text-ink">{user?.name || me?.user.name || '—'}</span>
                      <button type="button" onClick={() => { setName(user?.name || me?.user.name || ''); setEditingName(true); }} aria-label={t('biz.acc.editName')} className="w-8 h-8 rounded-lg text-brand hover:bg-brand-whisper flex items-center justify-center"><Pencil size={14} /></button>
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5 border-b border-border">
                <dt className="text-[13.5px] text-gray shrink-0 inline-flex items-center gap-1.5"><Mail size={14} strokeWidth={1.75} />{t('biz.acc.email')}</dt>
                <dd className="min-w-0 flex items-center justify-end gap-1.5 text-[14px] text-ink"><span className="truncate">{user?.email ?? me?.user.email ?? '—'}</span><Lock size={13} className="text-muted shrink-0" aria-label={t('biz.acc.locked')} /></dd>
              </div>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-[13.5px] text-gray shrink-0 inline-flex items-center gap-1.5"><Phone size={14} strokeWidth={1.75} />{t('biz.acc.phone')}</dt>
                <dd className="text-[14px] text-ink text-right">{user?.phone ?? me?.user.phone ?? '—'}</dd>
              </div>
            </dl>
          </Card>

          {/* ── Settings ── */}
          <Card className="overflow-hidden divide-y divide-border">
            {link(MapPin, t('biz.account.addresses'), defaultAddress ? `${defaultAddress.street_line_1} · ${defaultAddress.city}` : t('biz.acc.noAddress'), () => navigate('/business/account/addresses'))}
            {link(KeyRound, t('biz.account.changePassword'), null, () => navigate('/business/change-password', { state: { from: '/business/account' } }))}
            <div className="min-h-[60px] px-4 sm:px-5 flex items-center gap-3">
              <span className="w-9 h-9 rounded-xl bg-surface-cream text-gray flex items-center justify-center shrink-0"><Globe size={18} strokeWidth={1.75} /></span>
              <span className="flex-1 min-w-0 truncate text-[15px] font-semibold font-display text-ink">{t('biz.account.language')}</span>
              <span className="inline-flex shrink-0 rounded-xl bg-surface-sand p-1 gap-0.5">
                {(['es', 'en'] as const).map((l) => (
                  <button key={l} type="button" onClick={() => setLang(l)} aria-pressed={lang === l} className={`h-8 px-3 rounded-lg text-xs font-bold font-display transition-colors ${lang === l ? 'bg-card text-ink shadow-card' : 'text-gray hover:text-ink'}`}>{l.toUpperCase()}</button>
                ))}
              </span>
            </div>
            <div className="min-h-[60px] px-4 sm:px-5 flex items-center gap-3">
              <span className="w-9 h-9 rounded-xl bg-surface-cream text-gray flex items-center justify-center shrink-0">
                {theme.choice === 'dark' ? <Moon size={18} strokeWidth={1.75} /> : theme.choice === 'light' ? <Sun size={18} strokeWidth={1.75} /> : <SunMoon size={18} strokeWidth={1.75} />}
              </span>
              <span className="flex-1 min-w-0 truncate text-[15px] font-semibold font-display text-ink">{t('biz.account.theme')}</span>
              <span className="inline-flex shrink-0 rounded-xl bg-surface-sand p-1 gap-0.5" role="group" aria-label={t('biz.account.theme')}>
                {(['light', 'dark', 'system'] as const).map((c) => (
                  <button key={c} type="button" onClick={() => theme.setChoice(c)} aria-pressed={theme.choice === c} className={`h-8 px-2.5 rounded-lg text-xs font-bold font-display transition-colors ${theme.choice === c ? 'bg-card text-ink shadow-card' : 'text-gray hover:text-ink'}`}>{t(`biz.theme.${c}`)}</button>
                ))}
              </span>
            </div>
            {link(MessageSquare, t('biz.account.contact'), t('biz.acc.contactSub'), () => window.open('/contact', '_blank', 'noopener'))}
            <button type="button" onClick={async () => { await logout(); navigate('/login'); }} className="w-full min-h-[60px] px-4 sm:px-5 flex items-center gap-3 text-left text-danger hover:bg-danger-bg/50 transition-colors">
              <span className="w-9 h-9 rounded-xl bg-danger-bg text-danger flex items-center justify-center shrink-0"><LogOut size={18} strokeWidth={1.75} /></span>
              <span className="flex-1 text-[15px] font-semibold font-display">{t('biz.logout')}</span>
            </button>
          </Card>
        </div>
      </div>
    </div>
  );
}
