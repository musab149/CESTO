import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Search } from 'lucide-react';
import { useAdminLeads, type B2bLeadStatus } from '@grocery-app/shared';
import { TableSkeleton } from '@/components/Skeleton';
import EmptyState from '@/components/EmptyState';

const STATUS_TONE: Record<string, string> = {
  new: 'bg-amber-mist text-amber-deep',
  contacted: 'bg-info-bg text-info',
  qualified: 'bg-brand-mist text-brand',
  closed: 'bg-success-bg text-success',
  archived: 'bg-surface-linen text-muted',
};

/**
 * Requests for a price on a product.
 *
 * A quotation is NOT an order and is not stored as one: it is a B2bLead with
 * a product, a quantity and somebody to answer. It sits beside the orders
 * because that is what it is trying to become — the same reason a lead sits
 * beside the account it turns into — but it keeps its own columns, because an
 * order has lines and a total and a quotation has neither yet.
 */
export default function QuotationsPage() {
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useAdminLeads({ type: 'quotation', limit: 200 });

  const term = search.trim().toLowerCase();
  const rows = (data?.items ?? []).filter((l) => !term
    || l.name.toLowerCase().includes(term)
    || (l.company ?? '').toLowerCase().includes(term)
    || (l.quote_product_name ?? '').toLowerCase().includes(term));

  const fmt = (v: string | null | undefined) => (v
    ? new Date(v).toLocaleDateString(i18n.language === 'en' ? 'en-GB' : 'es-ES',
      { day: '2-digit', month: 'short', year: 'numeric' })
    : '—');

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[240px] max-w-sm">
          <Search size={16} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('quotations.search', 'Search by product, name or company…')}
            className="w-full h-10 bg-surface-cream border border-border rounded-lg pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
          />
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={4} cols={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<FileText size={22} strokeWidth={1.75} />}
          title={t('quotations.emptyTitle', 'No quotation requests')}
          description={t('quotations.emptyBody', 'Requests from a product page appear here, with the product and quantity asked for.')}
        />
      ) : (
        <>
        {/* ON A PHONE (2026-11-05): a list — the table needed 760px and hid
            who asked, the email and the status off to the right. Nothing to
            tap: a quotation row has no page and no action, here or in the
            table. The table from sm. */}
        <ul className="sm:hidden bg-card rounded-xl border border-border divide-y divide-border">
          {rows.map((l) => (
            <li key={l.id} className="px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold font-display text-ink truncate">
                  {l.quote_product_name || '—'}
                </span>
                <span className="ml-auto text-[11.5px] text-muted shrink-0">
                  {t('quotations.qty', 'Qty')}{' '}
                  <span className="text-sm font-semibold text-ink tabular-nums">{l.quote_quantity ?? '—'}</span>
                </span>
              </div>
              <p className="text-[13px] text-ink truncate mt-0.5">
                {l.name}
                {l.company ? <span className="text-gray">{'  ·  '}{l.company}</span> : null}
              </p>
              {l.email && (
                <p className="text-[12.5px] text-muted truncate mt-0.5">{l.email}</p>
              )}
              <div className="flex items-center gap-2 mt-1.5">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide ${
                  STATUS_TONE[l.status] ?? 'bg-surface-linen text-muted'
                }`}>
                  {t(`b2bDirectory.status.${l.status}`, l.status as B2bLeadStatus)}
                </span>
                <span className="text-[11.5px] text-muted">{fmt(l.created_at)}</span>
              </div>
            </li>
          ))}
        </ul>

        <div className="hidden sm:block bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="bg-surface-cream">
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('quotations.product', 'Product')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('quotations.qty', 'Qty')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.name')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('b2bDirectory.company', 'Company')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.email')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.registered')}</th>
                <th className="text-left text-xs font-semibold text-gray uppercase px-4 py-3 font-display">{t('customers.table.status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-t border-border hover:bg-brand-mist/30 transition">
                  <td className="px-4 py-3 text-sm font-medium text-ink">
                    {l.quote_product_name || '—'}
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold text-ink tabular-nums">
                    {l.quote_quantity ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-ink">{l.name}</td>
                  <td className="px-4 py-3 text-sm text-gray">{l.company || '—'}</td>
                  <td className="px-4 py-3 text-sm font-mono text-gray">{l.email || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray whitespace-nowrap">{fmt(l.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide ${
                      STATUS_TONE[l.status] ?? 'bg-surface-linen text-muted'
                    }`}>
                      {t(`b2bDirectory.status.${l.status}`, l.status as B2bLeadStatus)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
