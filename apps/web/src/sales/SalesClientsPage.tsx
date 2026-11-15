import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AtSign, UserPlus, Users, ShoppingCart, Phone, ChevronRight, SearchX } from 'lucide-react';
import { useSalesClients, type SalesClientListItem } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useSalesT } from './lib/i18n';
import { usePortT } from './lib/portT';
import { shortDate } from './lib/format';
import { FULL_EMAIL } from './lib/clientOwner';
import EmptyState from './components/EmptyState';
import ClientOwnerChip from './components/ClientOwnerChip';
import EmailFinder from './components/EmailFinder';
import { Button, Dialog } from './components/Dialog';
import { Avatar, Card, ListSkeleton, PageHeader, SearchInput, Segmented } from './components/ui';

/** Client, phone, type (or whose), orders, since, and the order button — from lg. */
const COLS = 'lg:grid lg:grid-cols-[minmax(0,1fr)_140px_150px_90px_110px_164px] lg:gap-4 lg:items-center';

type Tab = 'own' | 'other';

/**
 * A rep's clients (redesigned 2026-10-26; two tabs and the email finder
 * 2026-10-28).
 *
 * One card: the two tabs and the search in its header, then the clients — a
 * business by its trading name over the person to ask for, a person by name.
 * On a desk they line up into a table; on a phone each is a row with the two
 * things a rep does with one, ring them or start their order, as round
 * buttons at its end.
 *
 *   Mis clientes    the accounts they opened.
 *   Otros clientes  somebody else's — another rep's, the office's, the
 *                   shop's — that they found by email or ordered for. They
 *                   can order for them; the client stays whoever's it was
 *                   (API lib/repClients). Each says whose, in a word.
 *
 * "Buscar por email" reaches ANY client of Cesto by their whole email (user:
 * "the rep should be able to search any client or user by using their email
 * address"). The search box only ever looks inside the tab; when what is
 * typed is a whole email with no match, it offers the finder for it.
 *
 * Search is debounced rather than submitted: a rep has a name half-spoken and
 * types while listening, so waiting for Enter wastes the pause.
 */
export default function SalesClientsPage() {
  const t = useSalesT();
  const lang = useLanguageStore((s) => s.lang);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'other' ? 'other' : 'own';
  // The finder, open with an email to look up straight away (from the New
  // client form, or a search that matched nobody) or empty.
  const finding = params.get('find');
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(id);
  }, [typed]);

  const { data, isLoading } = useSalesClients({ q: q || undefined, limit: 50, relation: tab });
  const rows = data?.items ?? [];
  const counts = data?.counts;
  const orders = (n: number) => t(n === 1 ? 'sales.clients.ordersCount_one' : 'sales.clients.ordersCount_other', { count: n });
  const others = tab === 'other';

  const setParam = (key: string, value: string | null) => setParams((p) => {
    const next = new URLSearchParams(p);
    if (value === null) next.delete(key); else next.set(key, value);
    return next;
  }, { replace: key === 'tab' });
  const openFinder = (email = '') => setParam('find', email);
  const qIsEmail = FULL_EMAIL.test(q);

  const typeChip = (business: boolean) => (
    <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-semibold font-display ${
      business ? 'bg-brand-whisper text-brand' : 'bg-surface-sand text-gray'
    }`}>
      {business ? t('sales.clients.business') : t('sales.clients.retail')}
    </span>
  );
  const blockedChip = (
    <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-semibold font-display bg-danger-bg text-danger">
      {t('sales.clients.blocked')}
    </span>
  );
  // What a row of the others says under the name: what they did with them.
  const servedLine = (c: SalesClientListItem) => {
    const mine = c.my_order_count ?? 0;
    return mine > 0
      ? t(mine === 1 ? 'sales.find.myOrders_one' : 'sales.find.myOrders_other', { count: mine })
      : t('sales.clients.foundByEmail');
  };
  // The row's name is its link and stretches over it; these sit above.
  const nameLink = (c: SalesClientListItem, cls: string) => (
    <button
      type="button"
      onClick={() => navigate(`/sales/clients/${c.id}`)}
      aria-label={t('sales.clients.openProfile', { name: c.company ?? c.name })}
      className={`block max-w-full truncate text-left text-[15px] font-semibold font-display text-ink focus:outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-brand/40 ${cls}`}
    >
      {c.company ?? c.name}
    </button>
  );
  const tabLabel = (key: Tab) => `${t(`sales.clients.tabs.${key}`)}${counts ? `  ${counts[key]}` : ''}`;

  return (
    <div>
      <PageHeader
        title={t('sales.clients.titleBoth')}
        subtitle={t('sales.clients.subtitle')}
        actions={(
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => openFinder()}
              aria-label={t('sales.find.title')}
              className="h-11 w-11 sm:w-auto sm:px-4 bg-card border border-border text-ink rounded-xl text-sm font-semibold font-display hover:border-brand/40 hover:text-brand hover:bg-brand-whisper transition-colors inline-flex items-center justify-center gap-2"
            >
              <AtSign size={18} strokeWidth={2} />
              <span className="hidden sm:inline">{t('sales.find.title')}</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('/sales/clients/new')}
              aria-label={t('sales.clients.add')}
              className="h-11 w-11 sm:w-auto sm:px-4 bg-brand text-white rounded-xl text-sm font-semibold font-display hover:bg-brand-mid shadow-[0_8px_18px_-10px_rgba(5,78,232,0.7)] transition-colors inline-flex items-center justify-center gap-2"
            >
              <UserPlus size={18} strokeWidth={2} />
              <span className="hidden sm:inline">{t('sales.clients.add')}</span>
            </button>
          </div>
        )}
      />

      <Card className="overflow-hidden">
        <div className="px-3 sm:px-4 py-3 border-b border-border flex flex-col sm:flex-row sm:items-center gap-2.5">
          <Segmented<Tab>
            label={t('sales.clients.tabs.label')}
            value={tab}
            onChange={(v) => setParam('tab', v === 'other' ? 'other' : null)}
            options={[{ value: 'own', label: tabLabel('own') }, { value: 'other', label: tabLabel('other') }]}
          />
          <SearchInput value={typed} onChange={setTyped} placeholder={t('sales.clients.search')} className="sm:flex-1 lg:max-w-[360px] lg:ml-auto" />
        </div>
        {others && rows.length > 0 && (
          <p className="px-4 sm:px-5 py-2.5 border-b border-border bg-surface-cream text-[12.5px] text-gray leading-snug">{t('sales.clients.otherIntro')}</p>
        )}

        {isLoading ? (
          <ListSkeleton rows={5} />
        ) : rows.length === 0 ? (
          q && qIsEmail ? (
            // A whole email with no match here: it may be anybody's.
            <EmptyState
              icon={<AtSign size={28} strokeWidth={1.75} className="text-muted" />}
              title={t('sales.clients.noMatch')}
              description={t('sales.find.promptHint')}
              action={{ label: t('sales.find.prompt', { email: q }), onClick: () => openFinder(q) }}
            />
          ) : q ? (
            <EmptyState
              icon={<SearchX size={28} strokeWidth={1.75} className="text-muted" />}
              title={t('sales.clients.noMatch')}
              description={t('sales.clients.noMatchBody')}
              action={{ label: t('sales.orders.clearFilters'), onClick: () => setTyped('') }}
            />
          ) : others ? (
            <EmptyState
              icon={<AtSign size={28} strokeWidth={1.75} className="text-muted" />}
              title={t('sales.clients.otherEmptyTitle')}
              description={t('sales.clients.otherEmptyBody')}
              action={{ label: t('sales.find.title'), onClick: () => openFinder() }}
            />
          ) : (
            <EmptyState
              icon={<Users size={28} strokeWidth={1.75} className="text-muted" />}
              title={t('sales.clients.empty')}
              description={t('sales.clients.emptyBody')}
              action={{ label: t('sales.clients.add'), onClick: () => navigate('/sales/clients/new') }}
            />
          )
        ) : (
          <>
            <div className={`hidden ${COLS} px-5 h-10 border-b border-border bg-surface-cream text-[12px] font-semibold font-display text-muted`}>
              <span>{t('sales.clients.table.name')}</span>
              <span>{t('sales.clients.table.contact')}</span>
              <span>{others ? t('sales.clients.table.whose') : t('sales.clients.table.type')}</span>
              <span>{others ? t('sales.clients.table.myOrders') : t('sales.clients.table.orders')}</span>
              <span>{others ? t('sales.clients.table.servedSince') : t('sales.clients.table.since')}</span>
              <span />
            </div>
            <ul className="divide-y divide-border">
              {rows.map((c) => (
                <li key={c.id}>
                  {/* A phone: one row, the actions as round buttons at its end. */}
                  <div className="lg:hidden relative px-4 py-3 min-h-[72px] flex items-center gap-3 active:bg-surface-cream">
                    <Avatar name={c.company ?? c.name} business={c.is_business} />
                    <span className="min-w-0 flex-1">
                      {nameLink(c, '')}
                      <span className="block text-[12.5px] text-muted truncate mt-0.5">
                        {c.company ? `${c.name}  ·  ` : ''}{others ? servedLine(c) : orders(c.order_count)}
                      </span>
                      {(others || c.status === 'blocked') && (
                        <span className="mt-1.5 flex flex-wrap gap-1">
                          {others && <ClientOwnerChip relation={c.relation} owner={c.owner} />}
                          {c.status === 'blocked' && blockedChip}
                        </span>
                      )}
                    </span>
                    {c.phone && (
                      <a
                        href={`tel:${c.phone}`}
                        aria-label={t('sales.clients.call', { name: c.company ?? c.name })}
                        className="relative z-10 w-10 h-10 rounded-full border border-border bg-card text-brand flex items-center justify-center shrink-0 active:bg-brand-whisper"
                      >
                        <Phone size={17} strokeWidth={1.75} />
                      </a>
                    )}
                    {/* A blocked client cannot be ordered for — createOrder
                        refuses it — so the action is not offered. */}
                    {c.status !== 'blocked' && (
                      <button
                        type="button"
                        onClick={() => navigate(`/sales/orders/new?client=${c.id}`)}
                        aria-label={t('sales.clients.startOrder')}
                        className="relative z-10 w-10 h-10 rounded-full bg-brand text-white flex items-center justify-center shrink-0 shadow-[0_6px_14px_-8px_rgba(5,78,232,0.8)] active:bg-brand-mid"
                      >
                        <ShoppingCart size={17} strokeWidth={1.75} />
                      </button>
                    )}
                  </div>

                  {/* A desk: the same client as a table row. */}
                  <div className={`hidden ${COLS} relative px-5 py-3 min-h-[68px] hover:bg-surface-cream transition-colors`}>
                    <span className="min-w-0 flex items-center gap-3">
                      <Avatar name={c.company ?? c.name} business={c.is_business} />
                      <span className="min-w-0">
                        {nameLink(c, '')}
                        {/* The company goes above, so the contact's name goes
                            here — otherwise a shop's row never says who to ask for. */}
                        {c.company && <span className="block text-[12.5px] text-muted truncate">{c.name}</span>}
                      </span>
                    </span>
                    <span className="text-[13.5px] font-mono text-gray truncate">{c.phone || c.email || '—'}</span>
                    <span className="flex flex-wrap gap-1">
                      {others ? <ClientOwnerChip relation={c.relation} owner={c.owner} /> : typeChip(c.is_business)}
                      {c.status === 'blocked' && blockedChip}
                    </span>
                    {/* Their own orders for an other client — not everyone's. */}
                    <span className="text-[14px] font-semibold text-ink tabular-nums">{others ? c.my_order_count ?? 0 : c.order_count}</span>
                    <span className="text-[14px] text-gray whitespace-nowrap">
                      {others ? (c.served_since ? shortDate(c.served_since, lang) : '—') : shortDate(c.created_at, lang)}
                    </span>
                    <span className="flex items-center justify-end gap-1.5">
                      {c.status !== 'blocked' && (
                        <button
                          type="button"
                          onClick={() => navigate(`/sales/orders/new?client=${c.id}`)}
                          className="relative z-10 h-9 px-3 rounded-xl border border-border bg-card text-[13px] font-semibold font-display text-ink whitespace-nowrap hover:text-brand hover:border-brand/40 hover:bg-brand-whisper transition-colors inline-flex items-center gap-1.5"
                        >
                          <ShoppingCart size={15} strokeWidth={1.75} />
                          {t('sales.clients.startOrder')}
                        </button>
                      )}
                      <ChevronRight size={17} strokeWidth={1.75} className="text-muted" />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {finding !== null && (
        <FindDialog
          email={finding}
          onClose={() => setParam('find', null)}
          onOrder={(id) => navigate(`/sales/orders/new?client=${id}`)}
          onOpen={(id) => navigate(`/sales/clients/${id}`)}
          onNewClient={(email) => navigate(`/sales/clients/new?email=${encodeURIComponent(email)}`)}
        />
      )}
    </div>
  );
}

/** "Buscar por email", in the panel's dialog shell. */
function FindDialog({ email, onClose, onOrder, onOpen, onNewClient }: {
  email: string; onClose: () => void;
  onOrder: (id: string) => void; onOpen: (id: string) => void; onNewClient: (email: string) => void;
}) {
  const t = useSalesT();
  const portT = usePortT();
  return (
    <Dialog
      onClose={onClose}
      closeLabel={portT('common.close', 'Close')}
      icon={AtSign}
      title={t('sales.find.title')}
      subtitle={t('sales.find.subtitle')}
      bodyClassName="px-5 py-4"
      footer={<Button variant="secondary" className="w-full" onClick={onClose}>{portT('common.close', 'Close')}</Button>}
    >
      <EmailFinder initialEmail={email} autoFind={!!email} onOrder={onOrder} onOpen={onOpen} onNewClient={onNewClient} />
    </Dialog>
  );
}
