import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, KeyRound, Link2Off, Users } from 'lucide-react';
import { useAdminMe, useUnlinkStorePartner, type AdminStorePartner } from '@grocery-app/shared';
import EmptyState from '@/components/EmptyState';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import LinkPartnerDialog from './LinkPartnerDialog';
import PartnerCredentialsDialog from './PartnerCredentialsDialog';

/**
 * Who manages this store — the store page's Partner tab (2026-10-31).
 *
 * With nobody: say so and offer to give it to somebody (LinkPartnerDialog, the
 * store already chosen). With somebody: who, how they sign in — the thing
 * support is asked about most ("they never got in") — and the three things to
 * do about them: send their login again, open their account, or (super_admin,
 * as the route is) take the store away.
 *
 * Unlinking takes away EVERY partner of the store, which is what the route
 * does; it says so, and that their account, orders and products all stay.
 */
export default function StorePartnerPanel({ storeId, storeName, partners, unavailable }: {
  storeId: string;
  storeName: string;
  /** Undefined on an API from before partners were sent: nothing to show yet. */
  partners: AdminStorePartner[] | undefined;
  /** Why nobody can be linked right now (deleted, or about to be), if so. */
  unavailable: string | null;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: me } = useAdminMe();
  const isSuperAdmin = me?.role === 'super_admin';
  const unlink = useUnlinkStorePartner();

  const [linkOpen, setLinkOpen] = useState(false);
  const [resendFor, setResendFor] = useState<AdminStorePartner | null>(null);
  const [unlinkOpen, setUnlinkOpen] = useState(false);

  const date = (v: string) => new Date(v).toLocaleDateString(i18n.language === 'en' ? 'en-GB' : 'es-ES', { day: '2-digit', month: 'short', year: 'numeric' });

  if (!partners) {
    return (
      <div className="bg-card rounded-2xl border border-border shadow-card p-5 text-sm text-gray font-body">
        {t('partners.panel.unknown', 'Who manages this store is shown once the server is updated.')}
      </div>
    );
  }

  const doUnlink = () => {
    unlink.mutate(storeId, {
      onSuccess: () => {
        setUnlinkOpen(false);
        toast.success(
          t('partners.panel.unlinked', 'Partner unlinked'),
          t('partners.panel.unlinkedBody', '{{store}} has no partner now. Their account, its products and its orders all stay.', { store: storeName }),
        );
      },
      onError: (e) => toast.error(t('partners.panel.unlinkFailed', 'Could not unlink'), e instanceof Error ? e.message : String(e)),
    });
  };

  return (
    <div className="bg-card rounded-2xl border border-border shadow-card">
      <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-border">
        <h2 className="text-base font-bold font-display text-ink">{t('partners.panel.title', 'Who manages this store')}</h2>
        <p className="text-[13px] font-body text-gray mt-0.5">
          {t('partners.panel.subtitle', 'A partner signs in to Cesto Shop and manages the store from "Manage store": its products, its orders and its details.')}
        </p>
      </div>

      {partners.length === 0 ? (
        <div className="px-5">
          <EmptyState
            icon={<Users size={28} strokeWidth={1.75} className="text-muted" />}
            title={t('partners.panel.emptyTitle', 'Nobody manages this store yet')}
            description={unavailable ?? t('partners.panel.emptyBody', 'Give it to somebody — a customer who already has an account, or a new one — and they become its partner.')}
            action={unavailable ? undefined : { label: t('partners.panel.link', 'Link a partner'), onClick: () => setLinkOpen(true) }}
          />
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border">
            {partners.map((p) => (
              <li key={p.user_id} className="px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className="w-11 h-11 rounded-full bg-brand-mist text-brand grid place-items-center shrink-0 text-sm font-bold font-display">
                    {initials(p.name)}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-bold font-display text-ink truncate">{p.name}</span>
                      <Chip tone="brand">{p.role === 'owner' ? t('partners.panel.owner', 'Owner') : t('partners.panel.manager', 'Manager')}</Chip>
                      {!p.is_active && <Chip tone="muted">{t('partners.panel.roleOff', 'Access switched off')}</Chip>}
                      {p.status === 'blocked' && <Chip tone="danger">{t('customers.blocked', 'Blocked')}</Chip>}
                    </div>
                    <p className="text-[13px] font-mono text-gray truncate mt-0.5">{p.email ?? '—'}</p>
                    <p className="text-[12px] font-body text-muted mt-0.5">
                      <AccessLine access={p.access} />
                      {' · '}
                      {t('partners.panel.since', 'Partner since {{date}}', { date: date(p.linked_at) })}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end shrink-0">
                  {p.email && p.status !== 'blocked' && (
                    <button
                      type="button"
                      onClick={() => setResendFor(p)}
                      className="h-10 px-3.5 rounded-xl border-2 border-border text-[13px] font-semibold font-display text-ink hover:border-brand transition-colors inline-flex items-center gap-1.5"
                    >
                      <KeyRound size={15} strokeWidth={1.75} />
                      {t('partners.panel.resend', 'Send login again')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => navigate(`/customers/${p.user_id}`)}
                    className="h-10 px-3.5 rounded-xl border-2 border-border text-[13px] font-semibold font-display text-ink hover:border-brand transition-colors inline-flex items-center gap-1.5"
                  >
                    <ExternalLink size={15} strokeWidth={1.75} />
                    {t('partners.panel.account', 'Their account')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {isSuperAdmin && (
            <div className="px-5 sm:px-6 py-4 border-t border-border flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12.5px] font-body text-gray max-w-md">
                {t('partners.panel.unlinkHint', 'To give this store to somebody else, unlink its partner first.')}
              </p>
              <button
                type="button"
                onClick={() => setUnlinkOpen(true)}
                className="h-10 px-3.5 rounded-xl border-2 border-danger/30 text-[13px] font-semibold font-display text-danger hover:bg-danger-bg transition-colors inline-flex items-center gap-1.5"
              >
                <Link2Off size={15} strokeWidth={1.75} />
                {partners.length > 1 ? t('partners.panel.unlinkAll', 'Unlink partners') : t('partners.panel.unlinkOne', 'Unlink partner')}
              </button>
            </div>
          )}
        </>
      )}

      <LinkPartnerDialog open={linkOpen} store={{ id: storeId, name: storeName }} onClose={() => setLinkOpen(false)} />
      <PartnerCredentialsDialog
        partner={resendFor && { id: resendFor.user_id, name: resendFor.name, email: resendFor.email }}
        onClose={() => setResendFor(null)}
      />
      <ConfirmModal
        open={unlinkOpen}
        danger
        title={t('partners.panel.unlinkTitle', 'Unlink {{store}}’s partner?', { store: storeName })}
        message={t('partners.panel.unlinkBody', '{{names}} will no longer be able to manage {{store}}. Their account stays and they can still shop; the store keeps its products and orders. You can give the store to somebody again afterwards.', {
          names: partners.map((p) => p.name).join(', '),
          store: storeName,
        })}
        confirmLabel={unlink.isPending ? t('partners.panel.unlinking', 'Unlinking…') : t('partners.panel.unlinkConfirm', 'Unlink')}
        confirmDisabled={unlink.isPending}
        onConfirm={doUnlink}
        onCancel={() => setUnlinkOpen(false)}
      />
    </div>
  );
}

/** How they sign in, in words: the first thing support needs when "they cannot get in". */
function AccessLine({ access }: { access: AdminStorePartner['access'] }) {
  const { t } = useTranslation();
  if (access === 'own') return <>{t('partners.panel.accessOwn', 'Signs in with their own password')}</>;
  if (access === 'temporary') return <span className="text-warning">{t('partners.panel.accessTemp', 'Has not signed in yet (temporary password)')}</span>;
  return <span className="text-warning">{t('partners.panel.accessNone', 'No password yet — send them a login')}</span>;
}

function Chip({ tone, children }: { tone: 'brand' | 'muted' | 'danger'; children: React.ReactNode }) {
  const cls = tone === 'brand' ? 'bg-brand-mist text-brand' : tone === 'danger' ? 'bg-danger-bg text-danger' : 'bg-surface-linen text-muted';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide ${cls}`}>{children}</span>;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';
}
