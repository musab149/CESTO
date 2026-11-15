import { useRef } from 'react';
import { useActiveTabInView } from '@/lib/useActiveTabInView';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, UserPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import CustomersPage from './CustomersPage';
import RidersPage from './RidersPage';
import StaffPage from './StaffPage';
import SalesRepsPage from './SalesRepsPage';
import LeadDirectoryPage from './LeadDirectoryPage';
import HomeGroceryDirectoryPage from './HomeGroceryDirectoryPage';
import QuotationsPage from './QuotationsPage';
import { useAdminMe } from '@grocery-app/shared';
import type { AdminUserSegment } from '@grocery-app/shared';

type TabKey = 'customers' | 'rashan' | 'b2b' | 'quotations' | 'partners' | 'riders' | 'salesreps' | 'staff';

/**
 * Everyone with an account, in one place — the same move the orders page made.
 *
 * They were in four corners of the sidebar: customers under OPERATIONS, B2B
 * customers under B2B, riders back under OPERATIONS, and staff accounts
 * nowhere at all, because the only way to add a colleague was a SQL client.
 *
 * UNLIKE ORDERS, THESE ARE NOT ONE TABLE. Customers, B2B and partners are all
 * `User` rows and differ only by a where clause, so they share a table the
 * way the order books do. Riders and staff are their own tables with their own
 * columns, so each renders its own list under a shared tab bar. One place to
 * look is the point; pretending four schemas are one would not have helped
 * anybody.
 */
const TABS: Array<{
  key: TabKey;
  labelKey: string;
  fallback: string;
  segment?: AdminUserSegment;
}> = [
  { key: 'customers', labelKey: 'users.tabs.customers', fallback: 'Customers', segment: 'customers' },
  // Home Grocery (once "rashan") is a trade, not a billing mode: a rep
  // opening an account at someone's door and a household approved from the
  // website form are the same customer to whoever runs the rounds. Requests
  // and subscribers in one list, like B2B — see HomeGroceryDirectoryPage.
  // Excluded from Customers, because a customer listed twice is a customer
  // counted twice. The key stays `rashan` so existing links keep working.
  { key: 'rashan',    labelKey: 'users.tabs.rashan',    fallback: 'Home Grocery', segment: 'rashan' },
  // Leads AND accounts, in one list — see B2bDirectoryPage. A separate leads
  // tab was still two places: approving moved a row from one to the other and
  // left the approved lead sitting in a queue with nothing left to do to it.
  { key: 'b2b',       labelKey: 'users.tabs.b2b',       fallback: 'B2B' },
  // Same shape as B2B: applications to sell on Cesto, and the partners they
  // become. Approving one also creates their store.
  // A price somebody asked for on a product page. Not an account and not an
  // order yet — it sits with B2B because that is what it is trying to become.
  { key: 'quotations', labelKey: 'users.tabs.quotations', fallback: 'Quotations' },
  { key: 'partners',  labelKey: 'users.tabs.partners',  fallback: 'Vendors' },
  { key: 'riders',    labelKey: 'users.tabs.riders',    fallback: 'Riders' },
  { key: 'salesreps', labelKey: 'users.tabs.salesreps', fallback: 'Sales reps' },
  { key: 'staff',     labelKey: 'users.tabs.staff',     fallback: 'Our Staff' },
];

export default function UsersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Riders and Staff own their create forms; they register the opener here so
  // the button can live beside the heading like every other tab's.
  const createRef = useRef<(() => void) | null>(null);

  // In the URL so a tab is linkable and survives a reload, same as the order
  // books.
  const tabKey = searchParams.get('tab') ?? 'customers';
  const tab = TABS.find((x) => x.key === tabKey) ?? TABS[0];
  const tabStrip = useRef<HTMLDivElement>(null);
  useActiveTabInView(tabStrip, tab.key);

  /**
   * The add button for this tab, or nothing.
   *
   * `modal` says the tab owns its own dialog and registered it through
   * `registerCreate`; false means a page of its own to navigate to.
   */
  const { data: me } = useAdminMe();
  const isSuperAdmin = me?.role === 'super_admin';

  const ADD: Partial<Record<string, { label: string; modal: boolean }>> = {
    customers: { label: t('clients.newTitle', 'New client'), modal: false },
    rashan:    { label: t('clients.newTitle', 'New client'), modal: false },
    b2b:       { label: t('clients.newTitle', 'New client'), modal: false },
    riders:    { label: t('riders.newRider'), modal: true },
    /**
     * Give somebody a store — a new one or one with no partner — without an
     * application. Any admin, as approving an application is.
     */
    partners:  { label: t('partners.add', 'Add partner'), modal: true },
    /**
     * Both of these mint a LOGIN, so their routes are super_admin-only and
     * the button has to be too — an ops admin pressing it got a 403 from a
     * dialog they had already filled in.
     *
     * `staff` was like that before sales reps existed; it is included here
     * because it is the same button, the same reason and the same line, and
     * gating one of the pair while leaving the other dead would read as
     * arbitrary.
     */
    ...(isSuperAdmin ? {
      staff:     { label: t('staff.add', 'Add staff'), modal: true },
      salesreps: { label: t('salesReps.add', 'Add sales rep'), modal: true },
    } : {}),
  };
  const addAction = ADD[tab.key];

  const changeTab = (key: TabKey) => {
    const params = new URLSearchParams(searchParams);
    if (key === 'customers') params.delete('tab');
    else params.set('tab', key);
    // Paging and search belong to the list being left.
    params.delete('page');
    params.delete('q');
    // An open request drawer belongs to the Home Grocery tab.
    params.delete('request');
    setSearchParams(params, { replace: true });
  };

  return (
    <div>
      {/* The primary action belongs beside the title, not stranded below the
          tab bar — the children used to own it, and once this page took the
          heading it read as a loose button in the middle of the screen.
          Riders and Staff keep their own, because adding one of those is a
          different act with a different form. */}
      {/* ONE table, not three parallel chains.
          What this button does, what it says and which icon it wears used to be
          three separate conditionals over the same tab key, and adding Sales
          reps updated the first and not the other two — so the button opened
          the rep dialog while reading "New client". Stated once, a new tab
          either appears here or has no button at all; it cannot acquire
          somebody else's label by falling through.

          Partners are added here too (2026-10-31): an approved application
          still makes one, and the office can also give somebody a store
          directly — the Vendors tab's own dialog. */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold font-display text-ink">
            {t('users.title', 'Users')}
          </h1>
          <p className="text-sm text-muted mt-1">
            {t('users.subtitle', 'Everyone with an account — customers, vendors, riders and staff')}
          </p>
        </div>
        {addAction && (
        <button
          type="button"
          onClick={() => {
            // A customer is a four-step form on its own page; every other kind
            // is a modal the tab already owns.
            if (addAction.modal) createRef.current?.();
            else navigate('/customers/new');
          }}
          className="min-h-[44px] px-5 rounded-xl bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm inline-flex items-center justify-center gap-2 shrink-0"
        >
          {addAction.modal
            ? <Plus size={16} strokeWidth={2} />
            : <UserPlus size={16} strokeWidth={2} />}
          {addAction.label}
        </button>
        )}
      </div>

      {/* Partners overlap Customers and B2B on purpose: owning a store is a
          separate fact from how you buy, so a partner who also shops here is
          in both. Only the three User tabs can overlap — riders and staff are
          different tables entirely. */}
      <div ref={tabStrip} className="tab-strip flex flex-wrap items-center gap-1 mb-5 border-b border-border">
        {TABS.map((x) => (
          <button
            key={x.key}
            type="button"
            data-active={tab.key === x.key}
            onClick={() => changeTab(x.key)}
            className={`relative -mb-px px-4 h-10 text-sm font-semibold font-display transition ${
              tab.key === x.key
                ? 'text-brand border-b-2 border-brand'
                : 'text-muted hover:text-ink border-b-2 border-transparent'
            }`}
          >
            {t(x.labelKey, x.fallback)}
          </button>
        ))}
      </div>

      {tab.key === 'quotations'
        ? <QuotationsPage />
        : tab.key === 'salesreps'
          ? <SalesRepsPage registerCreate={(fn) => { createRef.current = fn; }} />
          : tab.key === 'riders'
            ? <RidersPage embedded registerCreate={(fn) => { createRef.current = fn; }} />
            : tab.key === 'staff'
              ? <StaffPage registerCreate={(fn) => { createRef.current = fn; }} />
            : tab.key === 'rashan'
            ? <HomeGroceryDirectoryPage />
            : tab.key === 'b2b'
            ? (
              <LeadDirectoryPage
                leadType="business"
                segment="b2b"
                approvalMode="approve-business"
                secondColumnKey="b2bDirectory.company" secondColumnFallback="Company"
                accountBadgeKey="b2bDirectory.client" accountBadgeFallback="Client"
                searchKey="b2bDirectory.search" searchFallback="Search by name, company or email…"
                emptyTitleKey="b2bDirectory.emptyTitle" emptyTitleFallback="No wholesale accounts yet"
                emptyBodyKey="b2bDirectory.emptyBody" emptyBodyFallback="Approved B2B leads and wholesale clients both appear here."
              />
            )
            : tab.key === 'partners'
              ? (
                <LeadDirectoryPage
                  registerCreate={(fn) => { createRef.current = fn; }}
                  leadType="partner_store"
                  segment="partner"
                  approvalMode="approve"
                  secondColumnKey="partners.store" secondColumnFallback="Store"
                  accountBadgeKey="partners.badge" accountBadgeFallback="Partner"
                  searchKey="partners.search" searchFallback="Search by name, store or email…"
                  emptyTitleKey="partners.emptyTitle" emptyTitleFallback="No partners yet"
                  emptyBodyKey="partners.emptyBody" emptyBodyFallback="Shops applying to sell on Cesto appear here, and stay as partners once approved."
                />
              )
              : <CustomersPage embedded segment={tab.segment} />}
    </div>
  );
}
