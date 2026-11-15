import { useEffect, useRef, useState } from 'react';
import { AtSign, Ban, Info, Search, SearchX, ShoppingCart, UserPlus, UserRound } from 'lucide-react';
import { ApiError, useFindSalesClient, type SalesClientFind } from '@grocery-app/shared';
import { useSalesT } from '../lib/i18n';
import { FULL_EMAIL } from '../lib/clientOwner';
import ClientOwnerChip from './ClientOwnerChip';
import { Button } from './Dialog';
import { Avatar } from './ui';
import { Skeleton } from './Skeleton';

/**
 * Any client of Cesto, by their whole email (2026-10-28, user: "the rep should
 * be able to search any client or user by using their email address... Only if
 * they search via email... perform stuff for them... Like create order for
 * them... But this does not mean that that client will become his client").
 *
 * Asked on purpose — a field and a button, never per keystroke: finding
 * somebody puts them among the rep's others (API lib/repClients), so a half-
 * typed address must not find the wrong account. What comes back says whose
 * they are in a word and what the rep may do: order for them, open their
 * profile — or why not (blocked, a rep's account, their own).
 *
 * Used in the Clients tab's dialog and inside the order screen's picker.
 */
export default function EmailFinder({ initialEmail = '', autoFind = false, onOrder, onOpen, onNewClient }: {
  initialEmail?: string;
  /** Look `initialEmail` up straight away — the rep already typed it elsewhere. */
  autoFind?: boolean;
  onOrder: (clientId: string) => void;
  /** Their profile. Left out in the order screen, which is already on the way to an order. */
  onOpen?: (clientId: string) => void;
  onNewClient?: (email: string) => void;
}) {
  const t = useSalesT();
  const find = useFindSalesClient();
  const { mutate } = find;
  const start = initialEmail.trim().toLowerCase();
  const [email, setEmail] = useState(initialEmail);
  const [touched, setTouched] = useState(false);
  // The email the answer below is for — cleared the moment they type again.
  const [asked, setAsked] = useState<string | null>(autoFind && FULL_EMAIL.test(start) ? start : null);
  const valid = FULL_EMAIL.test(email.trim());

  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (autoFind && FULL_EMAIL.test(start)) mutate(start);
  }, [autoFind, start, mutate]);

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setTouched(true);
    if (!valid) return;
    const e = email.trim().toLowerCase();
    setAsked(e);
    mutate(e);
  };
  const change = (v: string) => {
    setEmail(v);
    if (asked) { setAsked(null); find.reset(); }
  };

  const limited = find.error instanceof ApiError && find.error.status === 429;
  return (
    <div>
      <form onSubmit={submit} noValidate>
        <label htmlFor="find-email" className="block text-[13px] font-semibold font-display text-ink mb-1.5">{t('sales.find.label')}</label>
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <AtSign size={17} strokeWidth={1.75} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
            <input
              id="find-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus={!autoFind}
              value={email}
              onChange={(e) => change(e.target.value)}
              placeholder={t('sales.find.placeholder')}
              aria-invalid={touched && !valid}
              aria-describedby="find-email-hint"
              className={`w-full h-12 pl-10 pr-3 rounded-xl border bg-card text-[15px] text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand/50 ${touched && !valid ? 'border-danger' : 'border-border'}`}
            />
          </div>
          <button
            type="submit"
            disabled={find.isPending}
            className="h-12 px-4 sm:px-5 rounded-xl bg-brand hover:bg-brand-mid disabled:opacity-60 text-white text-[14.5px] font-semibold font-display inline-flex items-center gap-1.5 shrink-0 transition-colors shadow-[0_8px_18px_-10px_rgba(5,78,232,0.7)]"
          >
            <Search size={17} strokeWidth={2} />
            <span className="hidden min-[380px]:inline">{t('sales.find.submit')}</span>
          </button>
        </div>
        <p id="find-email-hint" className={`mt-1.5 text-[12.5px] leading-snug ${touched && !valid ? 'text-danger' : 'text-muted'}`}>
          {touched && !valid ? t('sales.find.invalid') : t('sales.find.hint')}
        </p>
      </form>

      <div aria-live="polite" className="mt-4 empty:mt-0">
        {asked && find.isPending && (
          <div className="rounded-2xl border border-border p-4 flex items-center gap-3" aria-busy="true">
            <Skeleton className="w-11 h-11 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        )}
        {asked && find.isError && (
          <p className="rounded-xl bg-warning-bg ring-1 ring-inset ring-warning/25 px-3.5 py-3 text-[13px] text-ink leading-snug">
            {limited ? t('sales.find.limited') : t('sales.find.failed')}
          </p>
        )}
        {asked && find.data && (
          <Answer answer={find.data} email={asked} onOrder={onOrder} onOpen={onOpen} onNewClient={onNewClient} />
        )}
      </div>
    </div>
  );
}

/** What the search found, and what the rep may do with it. */
function Answer({ answer, email, onOrder, onOpen, onNewClient }: {
  answer: SalesClientFind; email: string;
  onOrder: (id: string) => void; onOpen?: (id: string) => void; onNewClient?: (email: string) => void;
}) {
  const t = useSalesT();

  if (!answer.found) {
    return (
      <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-center">
        <span className="w-12 h-12 rounded-2xl bg-surface-cream mx-auto mb-3 flex items-center justify-center">
          <SearchX size={22} strokeWidth={1.75} className="text-muted" />
        </span>
        <p className="text-[15px] font-semibold font-display text-ink">{t('sales.find.notFoundTitle')}</p>
        <p className="mt-1 text-[13px] text-gray max-w-xs mx-auto leading-snug">{t('sales.find.notFoundBody')}</p>
        <p className="mt-2 text-[12.5px] font-mono text-muted break-all">{email}</p>
        {onNewClient && (
          <Button variant="secondary" className="mt-4" onClick={() => onNewClient(email)}>
            <UserPlus size={17} strokeWidth={1.75} />
            {t('sales.find.newClient')}
          </Button>
        )}
      </div>
    );
  }

  // Found, but nobody to order for — and nothing more is said about them.
  if (answer.unavailable === 'self' || answer.unavailable === 'sales_rep') {
    return (
      <p className="rounded-xl bg-surface-cream px-3.5 py-3 text-[13.5px] text-charcoal flex items-start gap-2 leading-snug">
        <UserRound size={16} strokeWidth={1.75} className="text-muted shrink-0 mt-0.5" />
        {answer.unavailable === 'self' ? t('sales.find.self') : t('sales.find.salesRep')}
      </p>
    );
  }

  const c = answer.client!;
  const blocked = answer.unavailable === 'blocked';
  const own = c.relation === 'own';
  const title = c.company ?? c.name;
  const note = blocked ? t('sales.find.blocked')
    : own ? t('sales.find.ownNote')
      : c.owner === 'shop' ? t('sales.find.shopNote') : t('sales.find.otherNote');
  const orders = c.my_order_count > 0
    ? t(c.my_order_count === 1 ? 'sales.find.myOrders_one' : 'sales.find.myOrders_other', { count: c.my_order_count })
    : t('sales.find.noOrdersYet');

  return (
    <div className="rounded-2xl border border-border overflow-hidden bg-card">
      <div className="p-4 flex items-start gap-3">
        <Avatar name={title} business={c.is_business} />
        <div className="min-w-0 flex-1">
          <p className="text-[15.5px] font-semibold font-display text-ink truncate">{title}</p>
          {c.company && <p className="text-[13px] text-gray truncate">{c.name}</p>}
          <p className="text-[12.5px] text-muted truncate mt-0.5">
            {c.email}{c.phone ? <>{'  ·  '}<span className="font-mono">{c.phone}</span></> : null}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ClientOwnerChip relation={c.relation} owner={c.owner} />
            <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-semibold font-display ${c.is_business ? 'bg-brand-whisper text-brand' : 'bg-surface-sand text-gray'}`}>
              {c.is_business ? t('sales.clients.business') : t('sales.clients.retail')}
            </span>
            {blocked && (
              <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-semibold font-display bg-danger-bg text-danger">
                {t('sales.clients.blocked')}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className={`px-4 py-3 border-t border-border flex items-start gap-2 text-[13px] leading-snug ${blocked ? 'bg-danger-bg/60 text-ink' : 'bg-surface-cream text-charcoal'}`}>
        {blocked
          ? <Ban size={16} strokeWidth={1.75} className="text-danger shrink-0 mt-px" />
          : <Info size={16} strokeWidth={1.75} className="text-brand shrink-0 mt-px" />}
        <span>
          {note}
          {!own && !blocked && <span className="block text-muted mt-0.5">{orders}</span>}
        </span>
      </div>
      {(!blocked || own) && (
        <div className="p-3 border-t border-border flex gap-2">
          {onOpen && (
            <Button variant="secondary" className="flex-1" onClick={() => onOpen(c.id)}>
              {t('sales.find.open')}
            </Button>
          )}
          {!blocked && (
            <Button className="flex-1" onClick={() => onOrder(c.id)}>
              <ShoppingCart size={17} strokeWidth={1.75} />
              {t('sales.clients.startOrder')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
