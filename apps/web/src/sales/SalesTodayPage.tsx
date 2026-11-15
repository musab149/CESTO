import { useNavigate } from 'react-router-dom';
import {
  ShoppingCart, Wallet, AlertTriangle, ChevronRight, CalendarDays, CalendarClock, History,
  Store, Receipt, PackageCheck, Truck, TrendingUp,
} from 'lucide-react';
import { repStoresOf, useSalesEarnings, useSalesMe, useSalesOrders } from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useSalesT } from './lib/i18n';
import { useAuthStore } from '@/stores/authStore';
import { money, shortDate } from './lib/format';
import { dayLabel } from './lib/periods';
import { assignedOf, listNames, splitShops } from './lib/shops';
import { Skeleton } from './components/Skeleton';
import EmptyState from './components/EmptyState';
import SalesStatusBadge from './components/SalesStatusBadge';
import ShopIllustration from './components/ShopIllustration';
import { Avatar, Card, CardHeader, CardLink, ListSkeleton } from './components/ui';
import { StatsCard } from './components/StatsCard';
import { MonthCard, MonthSalesCard } from './components/MonthCards';

/**
 * The rep's dashboard (redesigned 2026-10-26 from the user's mockup, then
 * rebuilt as a bento the same day at the user's request).
 *
 * One grid of tiles, every heading inside its tile:
 *
 *   ┌──── greeting (not on a phone) ────┐┌──── sales this month ────┐
 *   │                                   │┌─ expenses ─┐┌ net profit ┐
 *   ┌ today: orders │ sold ┃ since they started: orders │ clients ┐
 *   ┌──────── recent orders ───┐┌─ your earnings ────┐
 *   │                          │└─ your shops ───────┘
 *
 * On a phone the same tiles stack — the counts two by two — in page order,
 * the earnings below the orders (user, 2026-10-26); the shops live in the
 * Cuenta sheet there.
 *
 * Sales this month are live. The earnings card (2026-10-28) is what each
 * order earns them once approved — this month's, what waits for approval,
 * and what is owed (API lib/repEarnings).
 */

export default function SalesTodayPage() {
  const t = useSalesT();
  const lang = useLanguageStore((s) => s.lang);
  const navigate = useNavigate();

  const { data: me, isLoading } = useSalesMe();
  const fullName = useAuthStore((st) => st.user?.name) || me?.user.name || '';
  const firstName = fullName.trim().split(/\s+/)[0] ?? '';
  const { data: recent, isLoading: recentLoading } = useSalesOrders({ limit: 6 });
  const { data: earnings, isLoading: earningsLoading } = useSalesEarnings();
  const owed = Number(earnings?.totals.owed ?? 0);
  const totals = earnings?.totals;

  const stats = me?.stats;
  // The shops they sell from (lib/repStore on the API). Undefined on an API
  // from before shops were assigned, which must not read as "none".
  const shops = repStoresOf(me);
  const { sellable, unavailable } = splitShops(shops);
  // Products assigned to them by hand, from any shop: with some, no shop is no stop.
  const assigned = assignedOf(me);

  const dateOf = (year: boolean) => {
    const d = new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', ...(year ? { year: 'numeric' as const } : {}), timeZone: 'Europe/Madrid',
    });
    return d.charAt(0).toUpperCase() + d.slice(1);
  };
  const monthOrders = stats?.this_month?.orders ?? 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-12 gap-3 md:gap-3.5 2xl:gap-4">
      {/* No shop to sell from is the one thing that stops their day. */}
      {shops !== undefined && sellable.length === 0 && assigned === 0 && (
        <div role="status" className="col-span-2 md:col-span-12 rounded-2xl border border-warning/25 bg-warning-bg px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={20} strokeWidth={1.75} className="text-warning shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold font-display text-ink">
              {unavailable.length === 0
                ? t('sales.today.shopNoneTitle')
                : unavailable.length === 1 ? t('sales.today.shopUnavailableTitle') : t('sales.today.shopsUnavailableTitle')}
            </p>
            <p className="text-[13px] text-gray mt-0.5">
              {unavailable.length === 0
                ? t('sales.today.shopNoneBody')
                : unavailable.length === 1
                  ? t('sales.today.shopUnavailableBody', { name: unavailable[0].name })
                  : t('sales.today.shopsUnavailableBody', { names: listNames(unavailable.map((s) => s.name), lang) })}
            </p>
          </div>
        </div>
      )}

      {/* ── Greeting — a desk and a tablet only (user, 2026-10-28: "on mobile
          responsive we do not need to show that welcome card"); a phone's bar
          already says whose panel it is, and the money comes first. From xl
          the month's money sits beside it as a bento (user: "make these cards
          smaller and in the same row in front of the welcome one"). ── */}
      <section className="hidden md:block md:col-span-12 xl:col-span-7 relative overflow-hidden rounded-2xl border border-brand-mist bg-gradient-to-br from-st-greet-1 via-st-greet-2 to-st-greet-3 md:min-h-[220px]">
        <div className="relative z-10 p-6 md:pr-[46%] lg:p-7 lg:pr-[42%]">
          <h1 className="text-[34px] lg:text-[38px] font-bold font-display text-ink leading-[1.05] tracking-[-0.025em] break-words">
            {firstName ? t('sales.today.hello', { name: firstName }) : t('sales.today.helloAnon')}
          </h1>
          <p className="mt-1.5 text-[15px] lg:text-[16px] text-gray">{t('sales.today.standing')}</p>
          <p className="mt-3 lg:mt-4 flex items-start gap-2 text-[13.5px] font-medium text-charcoal">
            <CalendarDays size={17} strokeWidth={1.75} className="text-brand shrink-0 mt-px" />
            <span>{dateOf(true)}</span>
          </p>
          {owed > 0 && (
            <button
              type="button"
              onClick={() => navigate('/sales/earnings')}
              className="relative mt-3 lg:mt-4 inline-flex items-center gap-1.5 h-9 pl-3 pr-2 whitespace-nowrap rounded-full bg-card border border-brand-mist text-brand text-[13px] font-bold font-display tabular-nums shadow-card hover:border-brand/40 transition-colors"
            >
              <Wallet size={15} strokeWidth={1.75} />
              {t('sales.today.owedPill', { amount: money(owed) })}
              <ChevronRight size={15} strokeWidth={2} />
            </button>
          )}
        </div>
        <ShopIllustration className="absolute right-0 bottom-0 md:w-[44%] md:max-w-[340px] xl:w-[46%]" />
      </section>

      {/* ── The month's money: sales, expenses, net profit (user, 2026-10-28),
          as a bento — sales across the top, the other two side by side under
          it. Beside the greeting from xl; under it, in one row, on a tablet
          and a small laptop; on a phone, first on the page. ── */}
      <div className="col-span-2 md:col-span-12 xl:col-span-5 grid grid-cols-2 md:grid-cols-12 xl:grid-cols-2 gap-3 md:gap-3.5 2xl:gap-4">
        <MonthSalesCard
          className="col-span-2 md:col-span-6 xl:col-span-2"
          revenue={stats?.this_month?.revenue ?? 0}
          orders={monthOrders}
          loading={isLoading}
          onClick={() => navigate('/sales/orders')}
        />
        <MonthCard
          className="md:col-span-3 xl:col-span-1"
          tone="orange"
          icon={Truck}
          label={t('sales.today.expenses')}
          value={money(earnings?.month?.expenses ?? 0)}
          loading={earningsLoading}
          onClick={() => navigate('/sales/earnings')}
        />
        <MonthCard
          className="md:col-span-3 xl:col-span-1"
          tone="green"
          icon={TrendingUp}
          label={t('sales.today.netProfit')}
          value={money(earnings?.month?.net_profit ?? 0)}
          loading={earningsLoading}
          onClick={() => navigate('/sales/earnings')}
        />
      </div>

      {/* ── The counts: today, and since they started — one card in two
          bands (user, 2026-10-28). ── */}
      <StatsCard
        className="col-span-2 md:col-span-12"
        label={t('sales.today.countsLabel')}
        loading={isLoading}
        groups={[
          {
            key: 'today',
            title: t('sales.today.groupToday'),
            icon: CalendarClock,
            note: t('sales.today.sinceMidnight'),
            items: [
              { key: 'orders', tone: 'sky', label: t('sales.today.countOrders'), value: String(stats?.today.orders ?? 0), onClick: () => navigate('/sales/orders') },
              { key: 'sold', tone: 'blue', label: t('sales.today.countSold'), value: money(stats?.today.revenue ?? 0), sub: t('sales.today.soldNote'), onClick: () => navigate('/sales/orders') },
            ],
          },
          {
            key: 'all',
            title: t('sales.today.groupAll'),
            icon: History,
            // The day they became a rep: what the totals are counted from. Never
            // blank — without it the two bands' headers stand at different heights.
            note: me?.rep?.granted_at ? t('sales.today.sinceDate', { date: dayLabel(me.rep.granted_at.slice(0, 10), lang) }) : t('sales.today.sinceStart'),
            items: [
              { key: 'orders', tone: 'violet', label: t('sales.today.countOrders'), value: String(stats?.all_time.orders ?? 0), sub: t('sales.today.allSold', { amount: money(stats?.all_time.revenue ?? 0) }), onClick: () => navigate('/sales/orders') },
              { key: 'clients', tone: 'amber', label: t('sales.today.countClients'), value: String(stats?.clients_opened ?? 0), sub: t('sales.today.clientsOpened'), onClick: () => navigate('/sales/clients') },
            ],
          },
        ]}
      />

      {/* ── Recent orders ── above the earnings on a phone, beside them on a desk */}
      <Card className="col-span-2 md:col-span-8 overflow-hidden">
        <CardHeader
          title={t('sales.today.recent')}
          icon={Receipt}
          action={<CardLink onClick={() => navigate('/sales/orders')}>{t('sales.today.seeAll')}</CardLink>}
        />
        {recentLoading ? (
          <ListSkeleton rows={4} />
        ) : (recent?.items.length ?? 0) === 0 ? (
          <EmptyState
            icon={<ShoppingCart size={28} strokeWidth={1.75} className="text-muted" />}
            title={t('sales.today.noneYet')}
            description={t('sales.today.noneYetBody')}
            action={{ label: t('sales.today.startFirst'), onClick: () => navigate('/sales/orders/new') }}
          />
        ) : (
          <ul className="divide-y divide-border">
            {recent!.items.map((o) => {
              const who = o.client.company ?? o.client.name;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/sales/orders/${o.id}`)}
                    className="w-full min-h-[68px] px-4 sm:px-5 py-3 flex items-center gap-3 text-left hover:bg-surface-cream active:bg-surface-cream transition-colors"
                  >
                    <Avatar name={who} business={!!o.client.company} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold font-display text-ink truncate">{who}</span>
                      <span className="block text-[12.5px] text-muted truncate mt-0.5">
                        <span className="font-mono text-[12px]">{o.order_number}</span>
                        <span aria-hidden="true">{'  ·  '}</span>
                        {shortDate(o.created_at, lang)}
                      </span>
                    </span>
                    <span className="shrink-0 flex flex-col items-end gap-1">
                      <span className="text-[15px] font-bold font-display text-ink tabular-nums">{money(o.total)}</span>
                      <SalesStatusBadge status={o.status} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="col-span-2 md:col-span-4 flex flex-col gap-3 md:gap-3.5 2xl:gap-4">
        {/* ── Their earnings: owed, earned this month, waiting for approval ── */}
        <Card className="overflow-hidden">
          <CardHeader title={t('sales.today.earningsCardTitle')} icon={Wallet} subtitle={t('sales.today.earningsCardHint')} />
          {earningsLoading ? (
            <div className="p-5 space-y-3"><Skeleton className="h-5 w-full" /><Skeleton className="h-5 w-3/4" /><Skeleton className="h-5 w-2/3" /></div>
          ) : (
            <>
              <dl className="px-4 sm:px-5 py-3">
                <div className="flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-[13.5px] text-gray">{t('sales.today.earnedThisMonth')}</dt>
                  <dd className="text-[16px] font-semibold font-display text-success tabular-nums whitespace-nowrap">{money(totals?.this_month ?? 0)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-[13.5px] text-gray">
                    {t('sales.today.awaitingApproval')}
                    {(totals?.awaiting_count ?? 0) > 0 && <span className="text-muted">{' · '}{totals?.awaiting_count}</span>}
                  </dt>
                  <dd className="text-[16px] font-semibold font-display text-ink tabular-nums whitespace-nowrap">{money(totals?.awaiting_approval ?? 0)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 pt-3 mt-1 border-t border-dashed border-border">
                  <dt className="text-[14px] font-semibold font-display text-ink">{owed < 0 ? t('sales.earnings.paidAhead') : t('sales.earnings.due')}</dt>
                  <dd className="text-[20px] font-bold font-display text-brand tabular-nums whitespace-nowrap">{money(Math.abs(owed))}</dd>
                </div>
              </dl>
              <button
                type="button"
                onClick={() => navigate('/sales/earnings')}
                className="w-full h-11 border-t border-border flex items-center justify-center gap-1 text-[13.5px] font-semibold font-display text-brand hover:bg-brand-whisper transition-colors"
              >
                {t('sales.today.earningsOpen')}
                <ChevronRight size={16} strokeWidth={2} />
              </button>
            </>
          )}
        </Card>

        {/* ── Their shops — a desk only; a phone has them in the Cuenta sheet ── */}
        {shops !== undefined && (shops.length > 0 || assigned > 0) && (
          <Card className="hidden md:block">
            <CardHeader title={t('sales.today.shopsTitle')} icon={Store} subtitle={t('sales.today.shopsHint')} />
            <ul className="px-4 sm:px-5 py-4 flex flex-wrap gap-1.5">
              {/* Products assigned by hand, from any shop: one tap to them in the Catálogo. */}
              {assigned > 0 && (
                <li>
                  <button
                    type="button"
                    onClick={() => navigate('/sales/catalogue/stores/assigned')}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-brand-whisper text-brand ring-1 ring-inset ring-brand/15 text-[13px] font-semibold font-display hover:bg-brand-mist transition-colors"
                  >
                    <PackageCheck size={14} strokeWidth={1.75} />
                    {t(`sales.today.assignedChip_${assigned === 1 ? 'one' : 'other'}`, { count: assigned })}
                  </button>
                </li>
              )}
              {sellable.map((s) => (
                <li key={s.id} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-surface-cream border border-border text-charcoal text-[13px] font-semibold font-display">
                  <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden="true" />
                  {s.name}
                </li>
              ))}
              {unavailable.map((s) => (
                <li key={s.id} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-surface-sand text-muted text-[13px] font-semibold font-display line-through decoration-muted/60" title={t('sales.today.shopOff')}>
                  {s.name}
                </li>
              ))}
            </ul>
            {unavailable.length > 0 && (
              <p className="px-5 pb-4 -mt-1 text-[12px] text-gray">{t('sales.today.someUnavailable', { names: listNames(unavailable.map((s) => s.name), lang) })}</p>
            )}
          </Card>
        )}
        {shops !== undefined && sellable.length > 0 && unavailable.length > 0 && (
          <p className="md:hidden flex items-start gap-2 text-[12.5px] text-gray px-1">
            <AlertTriangle size={14} strokeWidth={1.75} className="text-warning shrink-0 mt-0.5" />
            {t('sales.today.someUnavailable', { names: listNames(unavailable.map((s) => s.name), lang) })}
          </p>
        )}
      </div>
    </div>
  );
}
