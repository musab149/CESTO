import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Building2, Mail, Phone, ShoppingCart, KeyRound, Copy, Check, Loader2, MessageCircle, ChevronRight,
  ShieldOff, MapPin, Package, Tag, UserRound, AlertTriangle, Wallet, CalendarDays, Handshake,
} from 'lucide-react';
import {
  salesT, apiErrorCode, CLIENT_HAS_OWN_LOGIN, resolveImageUrl,
  useSalesClient, useSalesClientDiscounts, useSalesOrders, useIssueSalesClientCredentials,
  type SalesClient, type SalesClientCredentials, type SalesLang,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useSalesT } from './lib/i18n';
import { money, shortDate } from './lib/format';
import { useGoBack } from './lib/useGoBack';
import BackLink from './components/BackLink';
import EmptyState from './components/EmptyState';
import Pagination from './components/Pagination';
import SalesStatusBadge from './components/SalesStatusBadge';
import { Skeleton } from './components/Skeleton';
import ClientOwnerChip from './components/ClientOwnerChip';
import { CardHeader } from './components/ui';
import { Button, Dialog } from './components/Dialog';

/**
 * A client's profile, for the rep who serves them (user, 2026-10-26: "The rep
 * should be able to see the client profile … just like on admin panel …
 * create credentials and copy with one click … and send them to client").
 *
 * Admin's customer page, cut to what a rep can act on: who they are and how
 * to reach them, their shop login, the orders THIS rep placed for them (the
 * only ones a rep can open), the prices agreed with them, their details and
 * addresses. Staff-only acts — blocking, deleting, reassigning — stay in admin.
 *
 * THE LOGIN is the one thing a rep does here. A new temporary password is
 * issued, shown once and handed over: copied field by field, copied as a
 * ready-written message in the CLIENT's language, or opened in WhatsApp to
 * their number. Only while the client has not chosen their own — the API
 * refuses otherwise, and the card says where they go instead.
 *
 * SOMEBODY ELSE'S CLIENT (2026-10-28): one they found by email or ordered for
 * opens here too (API lib/repClients). The header says whose, in a word, and
 * that ordering for them leaves them so; there is no login card — a shop
 * login is for their own rep or the office to give.
 */

type Lang = 'es' | 'en';
type T = (key: string, vars?: Record<string, string | number>) => string;

const longDate = (iso: string, lang: Lang) =>
  new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

function initialsOf(name: string): string {
  return name.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
}

/**
 * Copy, with the old way as a fallback: `navigator.clipboard` exists only on
 * a secure origin, and a rep on the office wifi may be on plain http.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  document.body.removeChild(area);
  return ok;
}

/** wa.me wants the full international number, digits only. */
function whatsappUrl(phone: string, countryCode: string | null | undefined, text?: string): string {
  const raw = phone.trim();
  const digits = raw.startsWith('+') || raw.startsWith('00')
    ? raw.replace(/^00/, '').replace(/\D/g, '')
    : `${(countryCode || '+34').replace(/\D/g, '')}${raw.replace(/\D/g, '')}`;
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export default function SalesClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const t = useSalesT();
  const lang = useLanguageStore((s) => s.lang) as Lang;
  const navigate = useNavigate();
  const goBack = useGoBack();
  const { data: client, isLoading, isError } = useSalesClient(clientId);
  const [credOpen, setCredOpen] = useState(false);

  const back = () => goBack('/sales/clients');

  if (isLoading) {
    return (
      <div className="space-y-3 md:space-y-3.5 2xl:space-y-4" aria-busy="true">
        <Skeleton className="h-36 rounded-xl" />
        <div className="grid gap-3 md:gap-3.5 2xl:gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }
  if (isError || !client) {
    return (
      <div className="max-w-xl">
        <BackLink label={t('sales.nav.clients')} onClick={back} />
        <div className="bg-card rounded-2xl border border-border/80 shadow-card">
          <EmptyState
            icon={<UserRound size={28} strokeWidth={1.75} className="text-muted" />}
            title={t('sales.client.notFoundTitle')}
            description={t('sales.client.notFoundBody')}
            action={{ label: t('sales.nav.clients'), onClick: () => navigate('/sales/clients') }}
          />
        </div>
      </div>
    );
  }

  const company = client.business_profile?.company ?? null;
  const title = company ?? client.name;
  const blocked = client.status === 'blocked';
  // An older API says nothing: their own, as everything was then.
  const other = client.relation === 'other';
  const startOrder = () => navigate(`/sales/orders/new?client=${client.id}`);

  return (
    <div>
      <BackLink label={t('sales.nav.clients')} title={title} onClick={back} />

      {/* ── Who, how to reach them, and the act ── */}
      <header className="bg-card rounded-2xl border border-border shadow-card mb-3 md:mb-3.5 2xl:mb-4 overflow-hidden">
        <div className="p-4 sm:p-5 flex items-start gap-3.5 sm:gap-4">
          <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center shrink-0 text-lg sm:text-xl font-bold font-display ${
            blocked ? 'bg-danger-bg text-danger' : 'bg-brand-whisper text-brand ring-1 ring-inset ring-brand-mist'
          }`} aria-hidden="true">
            {client.is_business ? <Building2 size={26} strokeWidth={1.75} /> : initialsOf(client.name)}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold font-display text-ink leading-tight break-words">{title}</h1>
            {company && <p className="text-[14px] text-gray mt-0.5">{client.name}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-semibold font-display ${
                client.is_business ? 'bg-brand-whisper text-brand' : 'bg-surface-sand text-gray'
              }`}>
                {client.is_business ? t('sales.clients.business') : t('sales.clients.retail')}
                {client.is_business && client.pricing_mode === 'b2b' && ` · ${t('sales.client.wholesale')}`}
              </span>
              {other && <ClientOwnerChip relation={client.relation} owner={client.owner} />}
              {blocked && (
                <span className="inline-flex items-center gap-1 h-6 px-2.5 rounded-full text-[12px] font-semibold font-display bg-danger-bg text-danger">
                  <ShieldOff size={12} strokeWidth={2} />
                  {t('sales.clients.blocked')}
                </span>
              )}
            </div>
            {(client.email || client.phone) && (
              <div className="mt-2.5 flex flex-col sm:flex-row sm:flex-wrap gap-x-5 gap-y-1">
                {client.email && (
                  <a href={`mailto:${client.email}`} className="min-w-0 inline-flex items-center gap-1.5 text-[13.5px] text-gray hover:text-brand">
                    <Mail size={14} strokeWidth={1.75} className="text-muted shrink-0" />
                    <span className="truncate">{client.email}</span>
                  </a>
                )}
                {client.phone && (
                  <a href={`tel:${client.phone}`} className="inline-flex items-center gap-1.5 text-[13.5px] font-mono text-gray hover:text-brand">
                    <Phone size={14} strokeWidth={1.75} className="text-muted shrink-0" />
                    {client.phone}
                  </a>
                )}
              </div>
            )}
          </div>
          {!blocked && (
            <button
              type="button"
              onClick={startOrder}
              className="hidden sm:inline-flex h-11 px-5 rounded-xl bg-brand hover:bg-brand-mid text-white text-sm font-semibold font-display items-center gap-2 shrink-0 transition-colors"
            >
              <ShoppingCart size={17} strokeWidth={1.75} />
              {t('sales.clients.startOrder')}
            </button>
          )}
        </div>
        {/* Whose they are and what that means — said once, at the top. */}
        {other && (
          <p className="border-t border-border bg-surface-cream px-4 sm:px-5 py-2.5 flex items-start gap-2 text-[13px] text-charcoal leading-snug">
            <Handshake size={16} strokeWidth={1.75} className="text-brand shrink-0 mt-px" />
            {t(`sales.client.other.${client.owner ?? 'shop'}`)}
          </p>
        )}
        {/* On a phone the acts are the card's foot, under the thumb. */}
        {(!blocked || client.phone) && (
          <div className="sm:hidden border-t border-border p-3 flex gap-2">
            {client.phone && (
              <>
                <a
                  href={`tel:${client.phone}`}
                  aria-label={t('sales.clients.call', { name: title })}
                  className="w-[52px] h-[52px] rounded-xl border border-border bg-card text-brand flex items-center justify-center shrink-0 active:bg-surface-cream"
                >
                  <Phone size={19} strokeWidth={1.75} />
                </a>
                <a
                  href={whatsappUrl(client.phone, client.phone_country_code)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="WhatsApp"
                  className="w-[52px] h-[52px] rounded-xl border border-border bg-card text-success flex items-center justify-center shrink-0 active:bg-surface-cream"
                >
                  <MessageCircle size={19} strokeWidth={1.75} />
                </a>
              </>
            )}
            {!blocked && (
              <button
                type="button"
                onClick={startOrder}
                className="flex-1 min-h-[52px] rounded-xl bg-brand active:bg-brand-mid text-white text-[15px] font-semibold font-display inline-flex items-center justify-center gap-2"
              >
                <ShoppingCart size={18} strokeWidth={1.75} />
                {t('sales.clients.startOrder')}
              </button>
            )}
          </div>
        )}
      </header>

      {/*
        Two columns from lg — what they bought on the left, who they are on the
        right. On a phone ONE column in the order a rep reaches for things: the
        login first (the reason this page exists), then their orders, then the
        reference cards. The column wrappers are `display: contents` below lg
        so each card takes its own `order` in a single flex column.
      */}
      <div className="flex flex-col gap-3 md:gap-3.5 2xl:gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
        <div className="contents lg:block lg:space-y-3.5 2xl:space-y-4 lg:col-start-2 lg:row-start-1">
          {!other && (
            <div className="order-1 lg:order-none">
              <AccessCard client={client} t={t} onIssue={() => setCredOpen(true)} />
            </div>
          )}
          <div className="order-5 lg:order-none">
            <DetailsCard client={client} lang={lang} t={t} />
          </div>
          <div className="order-6 lg:order-none">
            <AddressesCard client={client} t={t} />
          </div>
        </div>
        <div className="contents lg:block lg:space-y-3.5 2xl:space-y-4 lg:col-start-1 lg:row-start-1 lg:min-w-0">
          <div className="order-2 lg:order-none">
            <StatsStrip client={client} lang={lang} t={t} />
          </div>
          <div className="order-3 lg:order-none">
            <OrdersCard clientId={client.id} blocked={blocked} lang={lang} t={t} onStart={startOrder} />
          </div>
          <div className="order-4 lg:order-none">
            <AgreedPricesCard clientId={client.id} lang={lang} t={t} />
          </div>
        </div>
      </div>

      {credOpen && <CredentialsSheet client={client} t={t} onClose={() => setCredOpen(false)} />}
    </div>
  );
}

function Card({ title, icon: Icon, action, children }: {
  title: string; icon?: React.ElementType; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="bg-card rounded-2xl border border-border shadow-card overflow-hidden">
      <CardHeader title={title} icon={Icon} action={action} divider={false} className="pb-3" />
      {children}
    </section>
  );
}

function CopyButton({ value, label, t, big = false }: { value: string; label?: string; t: T; big?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const id = setTimeout(() => setState('idle'), 2200);
    return () => clearTimeout(id);
  }, [state]);
  const copy = async () => setState((await copyText(value)) ? 'copied' : 'failed');
  if (big) {
    return (
      <button
        type="button"
        onClick={copy}
        className={`w-full min-h-[52px] rounded-xl text-[15px] font-semibold font-display inline-flex items-center justify-center gap-2 transition-colors ${
          state === 'copied' ? 'bg-success text-white' : 'bg-brand hover:bg-brand-mid text-white'
        }`}
      >
        {state === 'copied' ? <Check size={18} strokeWidth={2.5} /> : <Copy size={18} strokeWidth={1.75} />}
        {state === 'copied' ? t('sales.client.cred.messageCopied') : label}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`${t('sales.client.cred.copy')}${label ? ` ${label}` : ''}`}
      className={`h-10 px-3 rounded-lg border-2 text-[13px] font-semibold font-display inline-flex items-center gap-1.5 shrink-0 transition-colors ${
        state === 'copied' ? 'border-success text-success' : state === 'failed' ? 'border-danger text-danger' : 'border-border text-ink hover:border-brand'
      }`}
    >
      {state === 'copied' ? <Check size={15} strokeWidth={2.5} /> : <Copy size={15} strokeWidth={1.75} />}
      {state === 'copied' ? t('sales.client.cred.copied') : t('sales.client.cred.copy')}
    </button>
  );
}

/** Their shop login: who they sign in as, how, and the way to give them one. */
function AccessCard({ client, t, onIssue }: { client: SalesClient; t: T; onIssue: () => void }) {
  const blocked = client.status === 'blocked';
  const access = client.access;
  const can = !!client.email && !blocked && (access === 'none' || access === 'temporary');
  const line = !client.email ? { tone: 'warning', text: t('sales.client.access.noEmail') }
    : blocked ? { tone: 'danger', text: t('sales.client.access.blocked') }
      : access === 'own' ? { tone: 'success', text: t('sales.client.access.own') }
        : access === 'temporary' ? { tone: 'info', text: t('sales.client.access.temporary') }
          : access === 'none' ? { tone: 'warning', text: t('sales.client.access.none') }
            : null;
  const dot: Record<string, string> = { warning: 'bg-warning', danger: 'bg-danger', success: 'bg-success', info: 'bg-info' };
  return (
    <Card title={t('sales.client.access.title')} icon={KeyRound}>
      <div className="px-4 pb-4 space-y-3">
        {client.email && (
          <div>
            <p className="text-[12px] font-semibold font-display text-muted">{t('sales.client.access.user')}</p>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate rounded-lg bg-surface-linen border border-border px-3 h-10 leading-10 text-[13.5px] text-ink font-mono">
                {client.email}
              </code>
              <CopyButton value={client.email} t={t} />
            </div>
          </div>
        )}
        {line && (
          <p className="flex items-start gap-2 text-[13.5px] text-ink">
            <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${dot[line.tone]}`} aria-hidden="true" />
            <span>{line.text}</span>
          </p>
        )}
        {access === 'own' && !blocked && (
          <p className="text-[12.5px] text-muted">{t('sales.client.access.ownHint')}</p>
        )}
        {can && (
          <button
            type="button"
            onClick={onIssue}
            className="w-full min-h-[52px] rounded-xl bg-brand hover:bg-brand-mid text-white text-[15px] font-semibold font-display inline-flex items-center justify-center gap-2 transition-colors"
          >
            <KeyRound size={18} strokeWidth={1.75} />
            {access === 'temporary' ? t('sales.client.access.recreate') : t('sales.client.access.create')}
          </button>
        )}
      </div>
    </Card>
  );
}

/**
 * Issue the login, then hand it over. Asks first — issuing kills whatever
 * temporary password they had and signs them out — then shows the pair, the
 * message in THEIR language and a WhatsApp link to their number. Stays open
 * on success: the password is the point, and it cannot be read back later.
 */
function CredentialsSheet({ client, t, onClose }: { client: SalesClient; t: T; onClose: () => void }) {
  const issue = useIssueSalesClientCredentials();
  const [issued, setIssued] = useState<SalesClientCredentials | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [asked, setAsked] = useState<boolean | null>(null);

  const run = (sendEmail: boolean) => {
    setFailure(null);
    setAsked(sendEmail);
    issue.mutate({ clientId: client.id, sendEmail }, {
      onSuccess: (r) => setIssued(r),
      onError: (err) => setFailure(apiErrorCode(err) === CLIENT_HAS_OWN_LOGIN
        ? t('sales.client.cred.ownRefused')
        : (err instanceof Error && err.message) || t('sales.client.cred.failed')),
    });
  };

  // The message goes to the client, so it is in their language, not the app's.
  const clientLang: SalesLang = client.preferred_language === 'en' ? 'en' : 'es';
  const message = issued
    ? salesT(clientLang, 'sales.client.cred.msg', {
      name: client.name.split(' ')[0] || client.name,
      url: issued.login_url,
      email: issued.login_email,
      password: issued.temp_password,
    })
    : '';
  const name = client.business_profile?.company ?? client.name;

  return (
    <Dialog
      onClose={onClose}
      ariaLabel={t('sales.client.access.title')}
      icon={issued ? Check : KeyRound}
      tone={issued ? 'success' : 'brand'}
      title={issued ? t('sales.client.cred.doneTitle', { name }) : t('sales.client.cred.askTitle', { name })}
      subtitle={issued
        ? t('sales.client.cred.doneHint')
        : client.access === 'temporary' ? t('sales.client.cred.askTemporary') : t('sales.client.cred.askNone')}
      footer={issued ? (
        <Button variant="secondary" className="w-full" onClick={onClose}>{t('sales.client.cred.done')}</Button>
      ) : undefined}
      bodyClassName="px-5 py-4"
    >
          {failure && (
            <p className="mb-3 flex items-start gap-2 rounded-lg bg-danger-bg px-3 py-2 text-[13px] font-semibold font-display text-danger">
              <AlertTriangle size={15} strokeWidth={2} className="shrink-0 mt-0.5" />
              <span>{failure}</span>
            </p>
          )}

          {!issued ? (
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={() => run(false)}
                disabled={issue.isPending}
                className="w-full min-h-[52px] rounded-xl bg-brand hover:bg-brand-mid disabled:opacity-60 text-white text-[15px] font-semibold font-display inline-flex items-center justify-center gap-2 transition-colors"
              >
                {issue.isPending && asked === false ? <Loader2 size={18} strokeWidth={2} className="animate-spin" /> : <KeyRound size={18} strokeWidth={1.75} />}
                {t('sales.client.cred.show')}
              </button>
              <button
                type="button"
                onClick={() => run(true)}
                disabled={issue.isPending}
                className="w-full min-h-[52px] rounded-xl border border-border bg-card hover:border-brand/50 disabled:opacity-60 text-ink text-[15px] font-semibold font-display inline-flex items-center justify-center gap-2 transition-colors"
              >
                {issue.isPending && asked === true ? <Loader2 size={18} strokeWidth={2} className="animate-spin" /> : <Mail size={18} strokeWidth={1.75} />}
                {t('sales.client.cred.email')}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-brand/25 bg-brand-whisper/60 p-3 space-y-2.5">
                {[
                  { label: t('sales.client.access.user'), value: issued.login_email },
                  { label: t('sales.client.cred.password'), value: issued.temp_password },
                ].map((row) => (
                  <div key={row.label}>
                    <p className="text-[12px] font-semibold font-display text-gray">{row.label}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <code className="flex-1 min-w-0 truncate rounded-lg bg-card border border-border px-3 h-10 leading-10 text-[15px] text-ink font-mono select-all">
                        {row.value}
                      </code>
                      <CopyButton value={row.value} label={row.label} t={t} />
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-[12px] font-semibold font-display text-gray">{t('sales.client.cred.message')}</p>
                <p className="mt-1 rounded-lg bg-surface-linen border border-border px-3 py-2.5 text-[13px] font-body text-ink whitespace-pre-line select-all break-words">
                  {message}
                </p>
              </div>

              <div className="space-y-2">
                <CopyButton value={message} label={t('sales.client.cred.copyMessage')} t={t} big />
                {client.phone && (
                  <a
                    href={whatsappUrl(client.phone, client.phone_country_code, message)}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full min-h-[52px] rounded-xl border border-success/40 text-success hover:bg-success-bg text-[15px] font-semibold font-display inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    <MessageCircle size={18} strokeWidth={1.75} />
                    {t('sales.client.cred.whatsapp')}
                  </a>
                )}
              </div>

              {asked && (
                <p className={`flex items-start gap-1.5 text-[13px] font-display ${issued.email_sent ? 'text-success' : 'text-warning'}`}>
                  {issued.email_sent ? <Check size={15} strokeWidth={2.5} className="shrink-0 mt-0.5" /> : <AlertTriangle size={15} strokeWidth={2} className="shrink-0 mt-0.5" />}
                  {issued.email_sent ? t('sales.client.cred.emailed', { email: issued.login_email }) : t('sales.client.cred.emailFailed')}
                </p>
              )}
            </div>
          )}
    </Dialog>
  );
}

function StatsStrip({ client, lang, t }: { client: SalesClient; lang: Lang; t: T }) {
  const s = client.stats;
  if (!s) return null;
  const tiles = [
    { label: t('sales.client.stats.orders'), value: String(s.orders), icon: ShoppingCart },
    { label: t('sales.client.stats.spent'), value: money(s.spent), icon: Wallet },
    { label: t('sales.client.stats.last'), value: s.last_order_at ? shortDate(s.last_order_at, lang) : '—', icon: CalendarDays },
  ];
  return (
    <section className="bg-card rounded-2xl border border-border shadow-card overflow-hidden">
      <div className="grid grid-cols-3 divide-x divide-border">
        {tiles.map((x) => (
          <div key={x.label} className="px-3 sm:px-5 py-4 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-brand-whisper text-brand flex items-center justify-center">
              <x.icon size={18} strokeWidth={1.75} />
            </span>
            <p className="mt-3 text-[12.5px] sm:text-[13px] font-semibold font-display text-gray truncate">{x.label}</p>
            <p className="text-[18px] sm:text-[24px] font-bold font-display text-ink tabular-nums truncate mt-1 leading-tight">{x.value}</p>
          </div>
        ))}
      </div>
      <p className="border-t border-border bg-surface-cream px-4 sm:px-5 py-2.5 text-[12px] text-muted">{t('sales.client.stats.hint')}</p>
    </section>
  );
}

function OrdersCard({ clientId, blocked, lang, t, onStart }: {
  clientId: string; blocked: boolean; lang: Lang; t: T; onStart: () => void;
}) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSalesOrders({ client: clientId, page, limit: 10 });
  const rows = data?.items ?? [];
  return (
    <Card title={t('sales.client.orders.title')} icon={ShoppingCart}>
      {isLoading ? (
        <div className="px-4 pb-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ShoppingCart size={28} strokeWidth={1.75} className="text-muted" />}
          title={t('sales.client.orders.emptyTitle')}
          description={t('sales.client.orders.emptyBody')}
          action={blocked ? undefined : { label: t('sales.clients.startOrder'), onClick: onStart }}
        />
      ) : (
        <>
          <ul className="divide-y divide-border border-t border-border">
            {rows.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/sales/orders/${o.id}`)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-surface-cream active:bg-surface-cream transition-colors"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13.5px] font-mono font-semibold text-ink">{o.order_number}</span>
                      <SalesStatusBadge status={o.status} />
                    </span>
                    <span className="block text-[12.5px] text-muted mt-0.5">
                      {shortDate(o.created_at, lang)}
                      {' · '}
                      {t(o.item_count === 1 ? 'sales.newOrder.items_one' : 'sales.newOrder.items_other', { count: o.item_count })}
                    </span>
                  </span>
                  <span className="text-[15px] font-bold font-display text-ink tabular-nums shrink-0">{money(o.total)}</span>
                  <ChevronRight size={17} strokeWidth={1.75} className="text-muted shrink-0" />
                </button>
              </li>
            ))}
          </ul>
          {(data?.totalPages ?? 1) > 1 && (
            <div className="border-t border-border px-4 py-2">
              <Pagination page={page} totalPages={data!.totalPages} onPageChange={setPage} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function AgreedPricesCard({ clientId, lang, t }: { clientId: string; lang: Lang; t: T }) {
  const { data: rows } = useSalesClientDiscounts(clientId);
  if (!rows || rows.length === 0) return null;
  const nameOf = (x: { name_es: string; name_en: string }) => (lang === 'en' && x.name_en) || x.name_es;
  return (
    <Card title={t('sales.client.prices.title')} icon={Tag}>
      <p className="px-4 -mt-1 pb-2 text-[12.5px] text-muted">{t('sales.client.prices.hint')}</p>
      <ul className="divide-y divide-border border-t border-border">
        {rows.map((r) => (
          <li key={r.variant_id} className="px-4 py-3 flex items-center gap-3">
            <span className="w-11 h-11 rounded-lg bg-surface-linen border border-border overflow-hidden flex items-center justify-center shrink-0">
              {r.product.image_url
                ? <img src={resolveImageUrl(r.product.image_url)} alt="" className="w-full h-full object-contain" draggable={false} />
                : <Package size={17} strokeWidth={1.75} className="text-muted" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold font-display text-ink truncate">{nameOf(r.product)}</span>
              <span className="block text-[12.5px] text-muted truncate">{nameOf(r.variant)}</span>
            </span>
            <span className="text-right shrink-0">
              <span className="block text-[12px] text-muted line-through tabular-nums">{money(r.price)}</span>
              <span className="block text-[15px] font-bold font-display text-brand tabular-nums">{money(r.customer_price)}</span>
              <span className="block text-[11.5px] font-semibold text-success">{t('sales.client.prices.off', { amount: money(r.amount) })}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function DetailsCard({ client, lang, t }: { client: SalesClient; lang: Lang; t: T }) {
  const company = client.business_profile;
  const hg = client.home_grocery;
  const rows: { label: string; value: React.ReactNode }[] = [
    {
      label: t('sales.client.details.type'),
      value: client.is_business
        ? `${t('sales.clients.business')}${client.pricing_mode === 'b2b' ? ` · ${t('sales.client.wholesale')}` : ''}`
        : t('sales.clients.retail'),
    },
    ...(company ? [{ label: t('sales.client.details.company'), value: company.company }] : []),
    ...(company ? [{ label: t('sales.client.details.contact'), value: client.name }] : []),
    ...(client.tax_id ? [{ label: t('sales.client.details.taxId'), value: <span className="font-mono">{client.tax_id}</span> }] : []),
    // Set by the office (2026-11-04); the rep sees it because their orders
    // for this client are charged it.
    ...(client.recargo_equivalencia ? [{ label: t('sales.client.details.recargo'), value: t('sales.client.details.recargoOn') }] : []),
    ...(company?.contact_phone ? [{ label: t('sales.client.details.contactPhone'), value: <a href={`tel:${company.contact_phone}`} className="font-mono hover:text-brand">{company.contact_phone}</a> }] : []),
    ...(client.preferred_language ? [{ label: t('sales.client.details.language'), value: client.preferred_language === 'en' ? 'English' : 'Español' }] : []),
    ...(client.created_at ? [{ label: t('sales.client.details.since'), value: longDate(client.created_at, lang) }] : []),
    ...(client.relation === 'other' ? [{
      label: t('sales.client.details.whose'),
      value: t(`sales.clients.owner.${client.owner ?? 'shop'}`),
    }] : client.opened_by_me !== undefined ? [{
      label: t('sales.client.details.openedBy'),
      value: client.opened_by_me ? t('sales.client.details.openedByMe') : t('sales.client.details.openedByOther'),
    }] : []),
    ...(client.found_at ? [{ label: t('sales.client.details.foundOn'), value: longDate(client.found_at, lang) }] : []),
    ...(hg ? [{
      label: t('sales.client.details.homeGrocery'),
      value: hg.status === 'active'
        ? t('sales.client.details.hgActive', { date: shortDate(hg.next_due, lang) })
        : t('sales.client.details.hgPaused'),
    }] : []),
  ];
  return (
    <Card title={t('sales.client.details.title')} icon={UserRound}>
      <dl className="px-4 pb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13.5px]">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-muted font-display">{r.label}</dt>
            <dd className="text-ink font-semibold font-display min-w-0 break-words">{r.value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function AddressesCard({ client, t }: { client: SalesClient; t: T }) {
  return (
    <Card title={t('sales.client.addresses.title')} icon={MapPin}>
      {client.addresses.length === 0 ? (
        <p className="px-4 pb-4 text-[13.5px] text-muted">{t('sales.client.addresses.none')}</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {client.addresses.map((a) => (
            <li key={a.id} className="px-4 py-3 text-[13.5px]">
              <p className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold font-display text-ink">{a.label || a.contact_name}</span>
                {a.is_default && (
                  <span className="inline-flex px-1.5 py-0.5 rounded-md bg-brand-mist text-brand text-[11px] font-semibold font-display">
                    {t('sales.client.addresses.default')}
                  </span>
                )}
              </p>
              <p className="text-gray mt-0.5">{a.street_line_1}{a.street_line_2 ? `, ${a.street_line_2}` : ''}</p>
              <p className="text-gray"><span className="font-mono">{a.postcode}</span> {a.city}{a.province && a.province !== a.city ? `, ${a.province}` : ''}</p>
              {a.label && <p className="text-muted mt-0.5">{a.contact_name} · <span className="font-mono">{a.contact_phone}</span></p>}
              {!a.label && a.contact_phone && <p className="text-muted mt-0.5 font-mono">{a.contact_phone}</p>}
              {a.delivery_notes && <p className="text-muted mt-0.5 italic">{a.delivery_notes}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
