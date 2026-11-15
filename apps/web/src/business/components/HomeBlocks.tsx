import { ArrowRight, Building2 } from 'lucide-react';
import { useBizT } from '../lib/i18n';

/*
 * The business's own profile card on its home (2026-10-31): who it is to
 * Cesto, one tap from its profile. The intro is the first of the home's own
 * banners now (components/home/BannerCarousel) and logistics has its street
 * (components/home/Logistics).
 */

// ─── Their business profile ───────────────────────────────────────────────

export function ProfileCard({ company, taxId, contact, email, phone, since, loading, onOpen, className = '' }: {
  company: string; taxId: string; contact: string; email: string; phone: string; since: string;
  loading: boolean; onOpen: () => void; className?: string;
}) {
  const t = useBizT();
  const field = (label: string, value: string, mono = false) => (
    <span className="min-w-0">
      <span className="block text-[12px] text-muted">{label}</span>
      {loading ? (
        <span className="skeleton block h-4 w-24 mt-1" />
      ) : (
        <span className={`block text-[13.5px] text-ink truncate mt-0.5 ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
      )}
    </span>
  );
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group w-full text-left bg-card rounded-2xl border border-border shadow-card p-4 sm:p-5 flex flex-col active:scale-[0.995] transition-transform ${className}`}
    >
      <span className="flex items-center gap-3">
        <span className="w-11 h-11 rounded-xl bg-brand-whisper text-brand ring-1 ring-inset ring-brand-mist flex items-center justify-center shrink-0">
          <Building2 size={21} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold font-display text-gray">{t('biz.nav.account')}</span>
          {loading ? (
            <span className="skeleton block h-5 w-40 mt-1" />
          ) : (
            <span className="block text-[18px] font-bold font-display text-ink leading-tight truncate">{company || '—'}</span>
          )}
        </span>
        <span className="w-8 h-8 rounded-full bg-brand-whisper text-brand flex items-center justify-center shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true">
          <ArrowRight size={16} strokeWidth={2.25} />
        </span>
      </span>
      <span className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {field(t('biz.acc.taxId'), taxId, true)}
        {field(t('biz.acc.contact'), contact)}
        {field(t('biz.acc.email'), email)}
        {field(t('biz.acc.phone'), phone)}
      </span>
      <span className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-3 text-[12.5px]">
        <span className="text-gray truncate">{since}</span>
        <span className="font-semibold font-display text-brand whitespace-nowrap">{t('biz.home.profileOpen')}</span>
      </span>
    </button>
  );
}
