import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, AtSign, Users, UserPlus, ChevronRight, Phone } from 'lucide-react';
import { useSalesClients } from '@grocery-app/shared';
import { useSalesT } from '../lib/i18n';
import { usePortT } from '../lib/portT';
import { FULL_EMAIL } from '../lib/clientOwner';
import ClientOwnerChip from './ClientOwnerChip';
import EmailFinder from './EmailFinder';
import { Avatar, ListSkeleton, SearchInput } from './ui';
import { Button, Dialog } from './Dialog';

/**
 * Who is this order for — asked as a dialog, before anything else exists.
 *
 * The one screen on this surface with no admin counterpart, and the reason it
 * exists is the difference between the two: admin reaches order creation from
 * a customer's own page, so the customer is already decided. A rep reaches it
 * from a button on their orders list, having chosen nobody — and the client
 * cannot be deferred, because every price on the next screen depends on them.
 *
 * A DIALOG, NOT A PAGE. It is a question standing between the rep and the
 * screen they asked for, which is what a dialog is; a page implied they had
 * arrived somewhere, when nothing behind it existed yet. Dismissing it returns
 * to the list they came from rather than stranding them on an empty builder.
 *
 * BOTH ANSWERS ARE OFFERED. "Pick one" and "there isn't one yet" are equally
 * likely when a rep is standing in a shop that has never ordered before, and
 * a search box alone answers only the first — the second was reachable only by
 * searching for nothing and finding the empty state's button. Creating a
 * client ends by returning here with them selected, so the loop closes without
 * the rep having to remember what they were doing.
 *
 * In the panel's dialog shell (components/Dialog), with the client rows of
 * the Mis clientes list.
 *
 * SOMEBODY ELSE'S CLIENT TOO (2026-10-28). The list holds the rep's own and
 * their others (found by email, or ordered for, each tagged whose), and a
 * third way in turns the dialog into the email finder (EmailFinder): any
 * client of Cesto by their whole email, ordered for without becoming the
 * rep's. A whole email typed into the search that matches nobody offers it.
 */
export default function SalesClientPicker({ onPick, onClose, carry = '' }: {
  onPick: (clientId: string) => void;
  /** Where dismissing goes. The orders list unless the caller knows better —
   *  arriving from the Catálogo, back to the product. */
  onClose?: () => void;
  /** Query string to keep through "new client" (a product waiting to go into
   *  the order, from the Catálogo), so the order it ends on still has it. */
  carry?: string;
}) {
  const t = useSalesT();
  const portT = usePortT();
  const navigate = useNavigate();
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  // Finding somebody else's client by email, instead of the list.
  const [finding, setFinding] = useState<{ email: string; auto: boolean } | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(id);
  }, [typed]);

  const { data, isLoading } = useSalesClients({ q: q || undefined, limit: 50, relation: 'all' });
  const rows = (data?.items ?? [])
    // A blocked client cannot be ordered for — createOrder refuses it — so they
    // are not offered here. The alternative is a built basket refused at the end.
    .filter((c) => c.status !== 'blocked');

  const close = onClose ?? (() => navigate('/sales/orders'));

  return (
    <Dialog
      onClose={close}
      closeLabel={portT('common.close', 'Close')}
      icon={finding ? AtSign : Users}
      title={finding ? t('sales.find.title') : t('sales.newOrder.pickClient')}
      subtitle={finding ? t('sales.find.subtitle') : t('sales.newOrder.pickClientHint')}
      bodyClassName="px-5 py-4 space-y-3"
      footer={(
        <Button variant="secondary" className="w-full" onClick={close}>{portT('common.cancel', 'Cancel')}</Button>
      )}
    >
      {finding ? (
        <>
          <button
            type="button"
            onClick={() => setFinding(null)}
            className="inline-flex items-center gap-1.5 h-8 -ml-1 px-1 rounded-lg text-[13px] font-semibold font-display text-brand hover:bg-brand-whisper transition-colors"
          >
            <ArrowLeft size={15} strokeWidth={2} />
            {t('sales.find.back')}
          </button>
          <EmailFinder
            initialEmail={finding.email}
            autoFind={finding.auto}
            onOrder={onPick}
            onNewClient={(email) => navigate(`/sales/clients/new?${[`email=${encodeURIComponent(email)}`, carry].filter(Boolean).join('&')}`)}
          />
        </>
      ) : (
      <>
      {/* The second answer, offered rather than hidden behind an empty
          search. A shop that has never ordered before is exactly the shop a
          rep is standing in. */}
      <button
        type="button"
        onClick={() => navigate(`/sales/clients/new${carry ? `?${carry}` : ''}`)}
        className="group w-full flex items-center gap-3 rounded-xl border border-dashed border-brand/40 bg-brand-whisper/50 px-3.5 py-3 text-left hover:border-brand hover:bg-brand-whisper transition-colors"
      >
        <span className="w-10 h-10 rounded-xl bg-brand text-white shrink-0 flex items-center justify-center shadow-[0_6px_14px_-8px_rgba(5,78,232,0.8)]">
          <UserPlus size={18} strokeWidth={1.75} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold font-display text-ink">{t('sales.clients.add')}</span>
          <span className="block text-[12.5px] text-muted mt-0.5">{t('sales.newOrder.createThenOrder')}</span>
        </span>
        <ChevronRight size={17} strokeWidth={1.75} className="text-brand shrink-0 transition-transform group-hover:translate-x-0.5" />
      </button>

      <SearchInput value={typed} onChange={setTyped} placeholder={t('sales.clients.search')} autoFocus />
      <button
        type="button"
        onClick={() => setFinding({ email: FULL_EMAIL.test(typed.trim()) ? typed.trim() : '', auto: false })}
        className="inline-flex items-center gap-1.5 h-8 px-1 -ml-1 rounded-lg text-[13px] font-semibold font-display text-brand hover:bg-brand-whisper transition-colors"
      >
        <AtSign size={15} strokeWidth={2} />
        {t('sales.find.pickerLink')}
      </button>

      {isLoading ? (
        <div className="rounded-xl border border-border overflow-hidden"><ListSkeleton rows={3} /></div>
      ) : rows.length === 0 ? (
        /* Not an EmptyState with a CTA: the CTA is already the first thing
           in this dialog, and offering it twice makes the second one read
           as a different action. */
        <div className="py-8 text-center">
          <span className="w-12 h-12 rounded-2xl bg-surface-cream mx-auto mb-3 flex items-center justify-center">
            <Users size={22} strokeWidth={1.75} className="text-muted" />
          </span>
          <p className="text-sm font-semibold font-display text-ink">
            {q ? t('sales.clients.noMatch') : t('sales.clients.empty')}
          </p>
          <p className="text-xs text-gray mt-1 max-w-xs mx-auto">
            {q && FULL_EMAIL.test(q) ? t('sales.find.promptHint') : q ? t('sales.clients.noMatchBody') : t('sales.clients.emptyBody')}
          </p>
          {q && FULL_EMAIL.test(q) && (
            <Button className="mt-4" onClick={() => setFinding({ email: q, auto: true })}>
              <AtSign size={17} strokeWidth={1.75} />
              {t('sales.find.prompt', { email: q })}
            </Button>
          )}
        </div>
      ) : (
        <ul className="rounded-xl border border-border divide-y divide-border overflow-hidden">
          {rows.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onPick(c.id)}
                className="w-full text-left px-3.5 py-3 min-h-[60px] flex items-center gap-3 hover:bg-surface-cream active:bg-brand-whisper transition-colors"
              >
                <Avatar name={c.company ?? c.name} business={c.is_business} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold font-display text-ink truncate">{c.company ?? c.name}</span>
                  {c.company && <span className="block text-[12.5px] text-muted truncate">{c.name}</span>}
                  {c.relation === 'other' && <ClientOwnerChip relation={c.relation} owner={c.owner} className="mt-1" />}
                </span>
                {c.phone && (
                  <span className="hidden sm:inline-flex items-center gap-1 text-[12px] font-mono text-muted shrink-0">
                    <Phone size={12} strokeWidth={1.75} />
                    {c.phone}
                  </span>
                )}
                <ChevronRight size={16} strokeWidth={1.75} className="text-muted shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      )}
      </>
      )}
    </Dialog>
  );
}
