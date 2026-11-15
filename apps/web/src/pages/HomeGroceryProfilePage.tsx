import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, CalendarDays, ChevronRight, ClipboardList, Clock, Info, MapPin, Repeat, ShoppingBasket, Users,
} from 'lucide-react';
import {
  useAddresses, useHomeGroceryPlan, useCreateHomeGroceryPlan, useMyHomeGrocery, useUpdatePlanSettings,
  type HomeGroceryPlan, type HomeGroceryPlanView, type PlanAddress, type PlanUpcoming,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useCartStore } from '@/stores/cartStore';
import { useToast } from '@/components/Toast';
import ReorderButton from '@/components/ReorderButton';
import HopBasket from '@/components/home-grocery/HopBasket';
import PlanSettingsForm, { type PlanSettingsValue } from '@/components/home-grocery/plan/PlanSettingsForm';
import PlanHistory from '@/components/home-grocery/plan/PlanHistory';
import OpenOrders from '@/components/home-grocery/OpenOrders';
import ChangeSlotDialog from '@/components/home-grocery/plan/ChangeSlotDialog';
import {
  FREQ_LABELS, PLAN_COPY, WEEKDAYS, windowLine, type Lang, type PlanCopy,
} from '@/components/home-grocery/planCopy';

/* ═══════════════════════════════════════════════════════
   /profile/home-grocery — a household's Home Grocery: its orders and its
   delivery information. Where the Home Grocery tab takes a household
   (homeGroceryRouteAccess) and where its profile row leads.

   There is no plan to run (2026-10-23). A household shops like anyone else,
   its cart is its grocery list, and every order it places — or staff or its
   rep place for it — is a Home Grocery order with a day and a part of the
   day. What it told us in its request is its delivery information, which
   suggests that day and time. Nobody is reminded.

   Two tabs: its orders (the list, what is under way, everything before —
   each to open, change while it can, or repeat) and its delivery
   information. The account-page frame the rest of the site uses:
   breadcrumb, title row with the main action, tabs, then the work on the
   left with a sticky column on the right.
   ═══════════════════════════════════════════════════════ */

type Tab = 'orders' | 'details';
const TABS: Tab[] = ['orders', 'details'];
// Tab names an older link may carry (the screens of 2026-10-21 → 23).
const OLD_TABS: Record<string, Tab> = { overview: 'orders', history: 'orders', items: 'orders', settings: 'details' };

const errorText = (e: unknown) => (e instanceof Error ? e.message : null);

/* ─── Frame ────────────────────────────────────────────── */

function Shell({ c, children }: { c: PlanCopy; children: React.ReactNode }) {
  return (
    <div className="bg-surface-linen min-h-screen pb-24">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm font-body text-muted mb-5">
          <Link to="/" className="hover:text-brand transition-colors">{c.home}</Link>
          <ChevronRight size={14} />
          <Link to="/profile" className="hover:text-brand transition-colors">{c.profile}</Link>
          <ChevronRight size={14} />
          <span className="text-ink font-semibold">{c.myPlan}</span>
        </nav>
        {children}
      </div>
    </div>
  );
}

/** "Ir a comprar": to the shop, where whatever they add goes on their list. */
function NewOrderButton({ c, className = '' }: { c: PlanCopy; className?: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/')}
      className={`min-h-[52px] px-6 rounded-xl bg-brand text-white text-[15px] font-bold font-display inline-flex items-center justify-center gap-2 hover:bg-brand-mid transition-colors ${className}`}>
      <ShoppingBasket size={18} strokeWidth={2} /> {c.newOrder}
    </button>
  );
}

/** Their preferred day and part of the day, in a few words — or nothing. */
function preferenceWords(plan: HomeGroceryPlan, lang: Lang): string | null {
  const day = plan.preferred_weekday ? WEEKDAYS.find((d) => d.id === plan.preferred_weekday)?.long[lang] : null;
  if (!day && !plan.preferred_window) return null;
  const when = windowLine(plan.preferred_window, lang).toLowerCase();
  return day ? `${day.charAt(0).toUpperCase()}${day.slice(1)}, ${when}` : windowLine(plan.preferred_window, lang);
}

/** Title row: what they are, since when, what they told us in two facts, and the main action. */
function Header({ plan, c, lang, since }: { plan: HomeGroceryPlan | null; c: PlanCopy; lang: Lang; since: string | null }) {
  const sinceWords = since
    ? new Date(since).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { month: 'long', year: 'numeric' })
    : null;
  const pref = plan ? preferenceWords(plan, lang) : null;
  return (
    <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
      <div className="flex items-start gap-4 min-w-0">
        <span className="hidden sm:flex w-14 h-14 rounded-2xl bg-success-bg items-center justify-center shrink-0">
          <HopBasket size={34} className="text-success" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[28px] sm:text-3xl font-extrabold text-ink font-display">{c.myPlan}</h1>
          <p className="mt-1.5 text-[15px] text-gray font-body leading-relaxed max-w-[68ch]">
            {sinceWords ? c.memberSince(sinceWords) : c.member}
          </p>
          {plan && (
            <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1.5 text-[14px] text-gray font-ui">
              <li className="inline-flex items-center gap-1.5">
                <Repeat size={15} strokeWidth={1.75} className="text-brand" /> {FREQ_LABELS[plan.frequency][lang]}
              </li>
              {pref && (
                <li className="inline-flex items-center gap-1.5">
                  <CalendarDays size={15} strokeWidth={1.75} className="text-brand" /> {pref}
                </li>
              )}
            </ul>
          )}
        </div>
      </div>
      <NewOrderButton c={c} className="self-start lg:self-auto shrink-0" />
    </div>
  );
}

function Tabs({ tab, onTab, c }: { tab: Tab; onTab: (t: Tab) => void; c: PlanCopy }) {
  return (
    <div className="mt-7 border-b border-border">
      <div className="flex gap-7 overflow-x-auto hide-scrollbar" role="tablist">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => onTab(t)}
            className={`h-12 shrink-0 whitespace-nowrap text-[15px] font-semibold font-ui border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-brand text-brand' : 'border-transparent text-gray hover:text-ink'
            }`}>
            {c.tabs[t]}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── Orders ───────────────────────────────────────────── */

/** Their grocery list — the cart — and the two ways on from it. */
function ListCard({ c }: { c: PlanCopy }) {
  const navigate = useNavigate();
  const count = useCartStore((s) => s.items.length);
  return (
    <section className="rounded-lg bg-surface-cream shadow-card border border-border/40 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center gap-4">
      <span className="hidden sm:flex w-12 h-12 rounded-xl bg-brand-whisper text-brand items-center justify-center shrink-0">
        <ClipboardList size={22} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[17px] font-bold text-ink font-display">{c.listCardTitle}</h2>
        <p className="mt-0.5 text-[14px] text-gray font-body">{count > 0 ? c.listCount(count) : c.listEmpty}</p>
      </div>
      {count > 0 ? (
        <div className="flex flex-wrap gap-2.5 shrink-0">
          <button type="button" onClick={() => navigate('/cart')}
            className="min-h-[48px] px-5 rounded-xl border border-border bg-card text-ink text-[14px] font-bold font-display hover:border-brand/40 transition-colors">
            {c.viewList}
          </button>
          <button type="button" onClick={() => navigate('/checkout')}
            className="min-h-[48px] px-5 rounded-xl bg-brand text-white text-[14px] font-bold font-display hover:bg-brand-mid transition-colors">
            {c.placeFromList}
          </button>
        </div>
      ) : (
        <NewOrderButton c={c} className="shrink-0" />
      )}
    </section>
  );
}

/** Nothing under way, inside the orders card: go shopping, or repeat the last order. */
function NoOpenOrders({ view, c }: { view: HomeGroceryPlanView; c: PlanCopy }) {
  // The last one they received — or, failing that, the last one at all.
  const last = view.recent.find((r) => r.status === 'delivered') ?? view.recent[0] ?? null;
  return (
    <div className="px-6 py-10 text-center">
      <span className="mx-auto w-16 h-16 rounded-2xl bg-success-bg flex items-center justify-center">
        <HopBasket size={38} className="text-success" />
      </span>
      <p className="mt-3 text-[15px] text-ink font-body">{c.noOpen}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2.5">
        <NewOrderButton c={c} />
        {last && (
          <ReorderButton
            orderId={last.id}
            label={c.repeatLast}
            className="min-h-[52px] px-6 rounded-xl border border-border bg-card text-ink text-[15px] font-bold font-display inline-flex items-center justify-center gap-2 hover:border-brand/40 transition-colors disabled:opacity-60"
          />
        )}
      </div>
    </div>
  );
}

/** Their delivery information at a glance, with the way to change it. */
function DeliveryCard({ plan, c, lang, onEdit }: { plan: HomeGroceryPlan; c: PlanCopy; lang: Lang; onEdit: () => void }) {
  const day = plan.preferred_weekday ? WEEKDAYS.find((d) => d.id === plan.preferred_weekday)?.long[lang] : null;
  const a = plan.address;
  const rows: Array<{ icon: React.ReactNode; label: string; value: React.ReactNode }> = [
    { icon: <Repeat size={16} strokeWidth={1.75} />, label: c.freqTitle, value: FREQ_LABELS[plan.frequency][lang] },
    { icon: <CalendarDays size={16} strokeWidth={1.75} />, label: c.dayTitle, value: day ? <span className="capitalize">{day}</span> : c.noDay },
    { icon: <Clock size={16} strokeWidth={1.75} />, label: c.windowTitle, value: windowLine(plan.preferred_window, lang) },
    { icon: <Users size={16} strokeWidth={1.75} />, label: c.householdTitle, value: c.householdCount(plan.household) },
    {
      icon: <MapPin size={16} strokeWidth={1.75} />,
      label: c.addressTitle,
      value: a ? <>{a.street_line_1}{a.street_line_2 ? `, ${a.street_line_2}` : ''}<br />{a.postcode} {a.city}</> : c.noAddressSet,
    },
  ];
  return (
    <section className="rounded-lg bg-surface-cream shadow-card border border-border/40 p-5">
      <h2 className="text-[17px] font-bold text-ink font-display">{c.deliveryTitle}</h2>
      <dl className="mt-3 divide-y divide-border/50">
        {rows.map((r) => (
          <div key={r.label} className="flex gap-3 py-3">
            <span className="mt-0.5 text-brand shrink-0">{r.icon}</span>
            <div className="min-w-0">
              <dt className="text-[12.5px] text-gray font-ui">{r.label}</dt>
              <dd className="text-[14px] font-semibold text-ink font-ui">{r.value}</dd>
            </div>
          </div>
        ))}
      </dl>
      <button type="button" onClick={onEdit}
        className="mt-2 w-full min-h-[48px] rounded-xl border border-border bg-card text-ink text-[14px] font-bold font-display hover:border-brand/40 transition-colors">
        {c.editSettings}
      </button>
    </section>
  );
}

function Orders({ view, c, lang, onDetails }: {
  view: HomeGroceryPlanView; c: PlanCopy; lang: Lang; onDetails: () => void;
}) {
  const plan = view.plan!;
  const open = view.open ?? (view.upcoming ? [view.upcoming] : []);
  const [moving, setMoving] = useState<PlanUpcoming | null>(null);

  return (
    <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8 items-start">
      <div className="lg:col-span-2 min-w-0 space-y-6">
        <ListCard c={c} />
        <OpenOrders orders={open} c={c} lang={lang} onChangeSlot={setMoving} empty={<NoOpenOrders view={view} c={c} />} />
        <PlanHistory lang={lang} preview={{ limit: 5, viewAllTo: '/orders' }} />
      </div>

      <aside className="space-y-4 lg:sticky lg:top-[172px] min-w-0">
        <DeliveryCard plan={plan} c={c} lang={lang} onEdit={onDetails} />
        <section className="rounded-lg bg-brand-mist/40 px-5 py-4 flex gap-3">
          <Info size={18} strokeWidth={1.75} className="text-brand shrink-0 mt-0.5" />
          <div>
            <h2 className="text-[14px] font-bold text-ink font-display">{c.howItWorks}</h2>
            <p className="mt-0.5 text-[13px] text-charcoal font-body leading-relaxed">{c.infoBanner}</p>
          </div>
        </section>
      </aside>

      {moving?.scheduled_for && (
        <ChangeSlotDialog
          orderId={moving.id}
          initial={{ scheduled_for: moving.scheduled_for.slice(0, 10), delivery_window: moving.delivery_window ?? null }}
          preferredWeekday={plan.preferred_weekday}
          lang={lang}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────── */

export default function HomeGroceryProfilePage() {
  const { lang } = useLanguageStore();
  const c = PLAN_COPY[lang];
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') ?? '';
  const tab: Tab = (TABS as string[]).includes(raw) ? (raw as Tab) : OLD_TABS[raw] ?? 'orders';
  const go = (t: Tab) => {
    setParams(t === 'orders' ? {} : { tab: t });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const q = useHomeGroceryPlan();
  const { data: mine } = useMyHomeGrocery();
  const { data: rawAddresses = [] } = useAddresses();
  const addresses: PlanAddress[] = useMemo(() => rawAddresses.map((a) => ({
    id: a.id, contact_name: a.contact_name, contact_phone: a.contact_phone, street_line_1: a.street_line_1,
    street_line_2: a.street_line_2, postcode: a.postcode, city: a.city, province: a.province, is_default: a.is_default,
  })), [rawAddresses]);
  const update = useUpdatePlanSettings();
  const create = useCreateHomeGroceryPlan();
  const since = mine?.subscriber?.approved_at ?? q.data?.plan?.created_at ?? null;

  if (q.isLoading) {
    return (
      <Shell c={c}>
        <div className="flex items-start gap-4">
          <div className="hidden sm:block skeleton w-14 h-14 !rounded-2xl" />
          <div className="flex-1">
            <div className="skeleton h-9 w-72" />
            <div className="mt-3 skeleton h-5 w-96 max-w-full" />
          </div>
        </div>
        <div className="mt-8 skeleton h-12 w-full" />
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="skeleton h-[96px] !rounded-lg" />
            <div className="skeleton h-[260px] !rounded-lg" />
          </div>
          <div className="skeleton h-[380px] !rounded-lg" />
        </div>
      </Shell>
    );
  }

  // Only with nothing to show. A refresh that fails while the page is up keeps it there.
  if (!q.data) {
    return (
      <Shell c={c}>
        <div className="mt-6 rounded-lg bg-card border border-border p-10 text-center max-w-xl mx-auto">
          <AlertTriangle size={28} strokeWidth={1.5} className="mx-auto text-muted" />
          <p className="mt-3 text-[15px] text-ink font-body">{c.loadError}</p>
          <button type="button" onClick={() => q.refetch()}
            className="mt-4 min-h-[52px] px-6 rounded-xl bg-brand text-white text-[15px] font-bold font-display hover:bg-brand-mid">
            {c.retry}
          </button>
        </div>
      </Shell>
    );
  }

  const view = q.data;

  // Not a household (yet). A link, never a redirect: /rashan sends a
  // household here, so sending anybody back would let the two bounce.
  if (!view.plan && !view.subscriber) {
    return (
      <Shell c={c}>
        <div className="mt-6 rounded-lg bg-surface-cream shadow-card border border-border/40 p-10 text-center max-w-xl mx-auto">
          <span className="mx-auto w-[84px] h-[84px] rounded-2xl bg-success-bg flex items-center justify-center">
            <HopBasket size={48} className="text-success" />
          </span>
          <h1 className="mt-4 text-[22px] font-bold text-ink font-display">{c.notSubscriberTitle}</h1>
          <p className="mt-2 text-[14px] text-gray font-body max-w-[46ch] mx-auto">{c.notSubscriberBody}</p>
          <Link to="/rashan"
            className="mt-6 inline-flex min-h-[52px] px-7 rounded-xl bg-brand text-white text-[15px] font-bold font-display items-center hover:bg-brand-mid">
            {c.notSubscriberCta}
          </Link>
        </div>
      </Shell>
    );
  }

  // Made from their request on the first read, so this is only for a
  // household that had no saved address then: where and when, and that is all.
  if (!view.plan) {
    const defaultAddress = addresses.find((a) => a.is_default) ?? addresses[0];
    return (
      <Shell c={c}>
        <Header plan={null} c={c} lang={lang} since={since} />
        <p className="mt-6 mb-5 text-[15px] text-gray font-body max-w-[72ch]">{c.setupLead}</p>
        <PlanSettingsForm
          initial={{
            frequency: mine?.subscriber?.frequency ?? 'biweekly',
            preferred_weekday: null,
            preferred_window: null,
            address_id: defaultAddress?.id ?? '',
          }}
          addresses={addresses}
          lang={lang}
          saving={create.isPending}
          submitLabel={create.isPending ? c.setupCreating : c.setupCreate}
          onSubmit={(v) => create.mutate(v, { onSuccess: () => { toast.success(c.settingsSaved); window.scrollTo({ top: 0 }); } })}
          error={errorText(create.error)}
        />
      </Shell>
    );
  }

  const plan = view.plan;

  return (
    <Shell c={c}>
      <Header plan={plan} c={c} lang={lang} since={since} />
      <Tabs tab={tab} onTab={go} c={c} />

      {tab === 'orders' && <Orders view={view} c={c} lang={lang} onDetails={() => go('details')} />}

      {tab === 'details' && (
        <div className="mt-6">
          <p className="mb-5 text-[15px] text-gray font-body max-w-[72ch]">{c.settingsLead}</p>
          <PlanSettingsForm
            key={plan.id}
            initial={{
              frequency: plan.frequency === 'every_6_weeks' ? 'monthly' : plan.frequency,
              preferred_weekday: plan.preferred_weekday,
              preferred_window: plan.preferred_window,
              address_id: plan.address?.id ?? addresses.find((a) => a.is_default)?.id ?? '',
            } satisfies PlanSettingsValue}
            addresses={addresses}
            lang={lang}
            saving={update.isPending}
            submitLabel={c.saveSettings}
            backLabel={c.cancel}
            onBack={() => go('orders')}
            onSubmit={(v) => update.mutate(v, { onSuccess: () => { toast.success(c.settingsSaved); go('orders'); } })}
            error={errorText(update.error)}
          />
        </div>
      )}
    </Shell>
  );
}
