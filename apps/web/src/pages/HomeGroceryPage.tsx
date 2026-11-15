import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  BellRing, Check, ChevronDown, Info, MessageCircle, PackageCheck,
  PencilLine, ShieldCheck, ShoppingBasket, Wallet,
} from 'lucide-react';
import {
  useBrandsList, useMyHomeGrocery, useRashanSubscriptions, useHomeGroceryPlan, resolveImageUrl,
  homeGroceryRouteAccess, type MyHomeGrocery, type RashanSubscription,
} from '@grocery-app/shared';
import { useLanguageStore } from '@/stores/languageStore';
import { useAuthStore } from '@/stores/authStore';
import { whatsappLink } from '@/lib/contact';
import FridgeNote from '@/components/home-grocery/FridgeNote';
import MonthBasket from '@/components/home-grocery/MonthBasket';
import RequestForm, { type SentRequest } from '@/components/home-grocery/RequestForm';
import Timeline from '@/components/home-grocery/Timeline';
import {
  BRAND_SLUGS, COPY, HOUSEHOLD_CHOICES, type HomeGroceryCopy, type Lang,
} from '@/components/home-grocery/copy';
import { logoPlate } from '@/lib/logoPlate';

/* ═══════════════════════════════════════════════════════
   HOME GROCERY — /rashan

   A household asks once; Cesto's team builds their grocery from then
   on. The page is organised around the thing those households already
   keep — the month's list — and it changes shape with where the
   visitor stands:

     apply       nobody's asked yet (or the last ask was turned down)
     pending     their request is waiting on a person
     loading     a signed-in visitor whose status is still on its way

   An approved household never sees it: /rashan sends them to their Home
   Grocery in their profile (homeGroceryRouteAccess). The URL stays /rashan:
   it is in links people already have.
   ═══════════════════════════════════════════════════════ */

const scrollToApply = () =>
  document.getElementById('apply')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

function formatDate(iso: string, lang: Lang) {
  return new Date(iso).toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

/* ───────── Shared pieces ───────── */

function ServiceName({ c }: { c: HomeGroceryCopy }) {
  return (
    <p className="inline-flex items-center gap-2 text-[15px] font-semibold text-brand-ink">
      <ShoppingBasket size={18} strokeWidth={1.75} className="text-brand" />
      {c.service}
    </p>
  );
}

function WhatsAppLink({ label, message, className = '' }: { label: string; message: string; className?: string }) {
  return (
    <a
      href={whatsappLink(message)}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-2 text-[15px] font-semibold text-brand hover:text-brand-ink underline-offset-4 hover:underline ${className}`}
    >
      <MessageCircle size={18} strokeWidth={1.75} />
      {label}
    </a>
  );
}

/**
 * `artFirst`: when the hero stacks (below lg) the right cell goes ABOVE the
 * text, a little smaller. It used to stack underneath, where it stood between
 * the button and the form the button leads to — so it was hidden on phones
 * altogether (2273c0c). Above the text it greets the visitor and is out of
 * the way, and the household question below it still refills it.
 */
function HeroFrame({ left, right, artFirst = false }: {
  left: React.ReactNode;
  right: React.ReactNode;
  artFirst?: boolean;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-surface-mint">
      <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] items-center gap-10 lg:gap-6 px-5 sm:px-10 lg:px-14 py-9 sm:py-12 lg:py-16">
        <div className="min-w-0">{left}</div>
        <div className={`min-w-0 ${artFirst ? 'order-first lg:order-none w-full max-w-[300px] sm:max-w-[360px] lg:max-w-none mx-auto' : ''}`}>{right}</div>
      </div>
    </section>
  );
}

function SectionTitle({ children, body }: { children: React.ReactNode; body?: string }) {
  return (
    <div className="max-w-xl">
      <h2 className="text-[26px] sm:text-[32px] font-bold text-ink tracking-[-0.02em] leading-[1.1] text-balance">
        {children}
      </h2>
      {body && <p className="text-[16px] text-gray mt-2 leading-relaxed">{body}</p>}
    </div>
  );
}

/* ───────── Heroes ───────── */

function HeroApply({ c, lang, household, setHousehold }: {
  c: HomeGroceryCopy;
  lang: Lang;
  household: number;
  setHousehold: (n: number) => void;
}) {
  return (
    <HeroFrame
      left={
        <>
          <ServiceName c={c} />
          <h1 className="mt-4 text-[34px] sm:text-[46px] lg:text-[54px] font-bold text-ink leading-[1.04] tracking-[-0.03em] text-balance">
            {c.heroTitle.map((line) => (
              <span key={line} className="block">{line}</span>
            ))}
          </h1>
          <p className="mt-5 text-[16px] sm:text-[17px] text-gray leading-relaxed max-w-[46ch]">
            {c.heroBody}
          </p>

          {/* The first question of the form, asked here — it is the easiest
              one, and answering it is what the list on the right responds to. */}
          <div className="mt-8">
            <p id="hg-household-q" className="text-[15px] font-semibold text-ink">{c.householdQuestion}</p>
            <div role="radiogroup" aria-labelledby="hg-household-q" className="mt-3 grid grid-cols-6 sm:flex gap-2 max-w-[400px] sm:max-w-none">
              {HOUSEHOLD_CHOICES.map((n) => {
                const on = household === n;
                return (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setHousehold(n)}
                    className={`sm:min-w-12 h-12 px-0 sm:px-3 rounded-xl border-2 text-[16px] font-bold tabular-nums transition-colors ${
                      on
                        ? 'border-brand bg-brand text-white'
                        : 'border-card bg-card text-ink hover:border-brand-light'
                    }`}
                  >
                    {n === 7 ? '7+' : n}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
            <button
              type="button"
              onClick={scrollToApply}
              className="min-h-[52px] px-7 rounded-xl bg-brand text-white text-[16px] font-bold hover:bg-brand-mid transition-colors"
            >
              {c.startRequest}
            </button>
            <WhatsAppLink label={c.whatsappPrompt} message={c.whatsappMessage} />
          </div>

          <ul className="mt-8 flex flex-col sm:flex-row sm:flex-wrap gap-x-6 gap-y-2.5">
            {c.trust.map((t) => (
              <li key={t} className="flex items-center gap-2 text-[14px] text-charcoal">
                <Check size={16} strokeWidth={2.5} className="text-amber-deep shrink-0" />
                {t}
              </li>
            ))}
          </ul>
        </>
      }
      // On a phone the basket sits above the headline — see HeroFrame.
      artFirst
      right={<MonthBasket c={c} lang={lang} household={household} />}
    />
  );
}

function PaperCard({ title, children, footer }: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative w-full max-w-[420px] mx-auto">
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-xl bg-white/70 border border-card shadow-card rotate-[3deg] translate-x-2 translate-y-1"
      />
      <div className="relative rounded-xl bg-surface-cream shadow-float border border-border/60 px-5 pt-5 pb-4 lg:-rotate-1">
        <p className="text-[18px] font-bold text-ink pb-3 mb-4 border-b border-border">{title}</p>
        {children}
        {footer && <div className="pt-3 mt-4 border-t border-dashed border-border">{footer}</div>}
      </div>
    </div>
  );
}

function HeroPending({ c, lang, mine, email }: {
  c: HomeGroceryCopy;
  lang: Lang;
  mine: MyHomeGrocery;
  email: string | null;
}) {
  const sentOn = formatDate(mine.open_request!.created_at, lang);
  return (
    <HeroFrame
      left={
        <>
          <ServiceName c={c} />
          <h1 className="mt-4 text-[32px] sm:text-[42px] lg:text-[48px] font-bold text-ink leading-[1.06] tracking-[-0.03em] text-balance">
            {c.pendingTitle}
          </h1>
          <p className="mt-5 text-[16px] sm:text-[17px] text-gray leading-relaxed max-w-[46ch]">
            {c.pendingBody(sentOn, email)}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
            <Link
              to="/"
              className="min-h-[52px] px-7 rounded-xl bg-brand text-white text-[16px] font-bold hover:bg-brand-mid transition-colors inline-flex items-center justify-center"
            >
              {c.keepShopping}
            </Link>
            <WhatsAppLink label={c.whatsappPrompt} message={c.whatsappMessage} />
          </div>
        </>
      }
      right={
        <PaperCard title={c.pendingCardTitle}>
          <Timeline
            lang={lang}
            steps={[
              { label: c.timeline[0], state: 'done', meta: sentOn },
              { label: c.timeline[1], state: 'current' },
              { label: c.timeline[2], state: 'todo', meta: email ?? undefined },
            ]}
          />
        </PaperCard>
      }
    />
  );
}

/** Same footprint as the real hero, so nothing jumps when it arrives. */
function HeroSkeleton() {
  return (
    <section className="rounded-2xl bg-surface-mint px-5 sm:px-10 lg:px-14 py-9 sm:py-12 lg:py-16" aria-busy="true">
      <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
        <div className="space-y-4">
          <div className="skeleton h-5 w-40" />
          <div className="skeleton h-12 w-full max-w-[520px]" />
          <div className="skeleton h-12 w-3/4 max-w-[400px]" />
          <div className="skeleton h-5 w-full max-w-[440px] mt-6" />
          <div className="skeleton h-5 w-2/3 max-w-[340px]" />
          <div className="skeleton h-[52px] w-56 !rounded-xl mt-8" />
        </div>
        <div className="skeleton h-[460px] w-full max-w-[420px] mx-auto !rounded-xl" />
      </div>
    </section>
  );
}

/* ───────── Notices ───────── */

function RejectedNotice({ c, reason }: { c: HomeGroceryCopy; reason: string | null }) {
  return (
    <section className="rounded-2xl bg-surface-cream border border-border shadow-card px-5 sm:px-7 py-6 flex flex-col sm:flex-row gap-4 sm:gap-5">
      <span className="w-11 h-11 rounded-full bg-surface-sand flex items-center justify-center shrink-0">
        <Info size={20} strokeWidth={1.75} className="text-charcoal" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[18px] font-bold text-ink">{c.rejectedTitle}</h2>
        {reason && (
          <div className="mt-3 border-l-[3px] border-border pl-4">
            <p className="text-[13px] text-gray">{c.rejectedReason}</p>
            <p className="text-[15px] text-ink leading-relaxed whitespace-pre-wrap mt-0.5">{reason}</p>
          </div>
        )}
        <p className="text-[15px] text-gray mt-3">{c.rejectedAgain}</p>
      </div>
      <button
        type="button"
        onClick={scrollToApply}
        className="self-start sm:self-center min-h-[52px] px-6 rounded-xl bg-brand text-white text-[15px] font-bold hover:bg-brand-mid transition-colors shrink-0"
      >
        {c.rejectedCta}
      </button>
    </section>
  );
}

function LegacyNotice({ c, subs }: { c: HomeGroceryCopy; subs: RashanSubscription[] }) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl bg-surface-cream border border-border px-5 py-4">
      <PackageCheck size={20} strokeWidth={1.75} className="text-brand shrink-0" />
      <p className="text-[15px] text-ink flex-1">
        {subs.length === 1 ? c.legacyOne : c.legacyMany(subs.length)}
      </p>
      <button
        type="button"
        onClick={() => navigate('/rashan/subscription')}
        className="min-h-11 px-5 rounded-xl border-2 border-border text-[14px] font-semibold text-ink hover:border-brand-light transition-colors"
      >
        {c.legacyManage}
      </button>
    </div>
  );
}

/* ───────── Sections ───────── */

function Brands({ c }: { c: HomeGroceryCopy }) {
  const { data } = useBrandsList();
  // Config order, not the API's — the strip leads with the names people
  // recognise first. Brands not carried in this environment drop out.
  const brands = useMemo(() => {
    const bySlug = new Map((data ?? []).map((b) => [b.slug, b]));
    return BRAND_SLUGS.map((s) => bySlug.get(s)).filter((b): b is NonNullable<typeof b> => !!b && !!b.logo_url);
  }, [data]);
  if (brands.length < 4) return null;

  return (
    <section>
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <SectionTitle body={c.brandsBody}>{c.brandsTitle}</SectionTitle>
        <Link to="/brands" className="text-[15px] font-semibold text-brand hover:text-brand-ink underline-offset-4 hover:underline shrink-0">
          {c.brandsAll}
        </Link>
      </div>
      <ul className="mt-7 grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
        {brands.map((b) => (
          <li key={b.id}>
            <Link
              to={b.link ?? `/categories?brand=${encodeURIComponent(b.name)}`}
              className={`${logoPlate(b.logo_bg).className} block aspect-[9/5] rounded-lg border border-border/70 overflow-hidden hover:border-brand-light transition-colors`}
              style={logoPlate(b.logo_bg).style}
            >
              <img
                src={resolveImageUrl(b.logo_url, 'logo')}
                alt={b.name}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                draggable={false}
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const CARE_ICONS = [Wallet, ShieldCheck, BellRing, PencilLine];

/**
 * The three steps of the process, drawn live. Filling in the form IS step
 * one, so it is marked as happening now; once the request is sent, step one
 * is ticked and step two — our review — becomes the current one. Same shape
 * as the status timeline a household follows afterwards.
 */
function ProcessSteps({ c, current }: { c: HomeGroceryCopy; current: 0 | 1 }) {
  return (
    <ol className="mt-6">
      {c.how.map((step, i) => {
        const done = i < current;
        const now = i === current;
        const last = i === c.how.length - 1;
        return (
          <li key={step.title} className={`relative flex gap-4 ${last ? '' : 'pb-7'}`}>
            {!last && (
              <span
                aria-hidden="true"
                className={`absolute left-[18px] top-10 bottom-1 w-0.5 -translate-x-1/2 rounded-full ${done ? 'bg-amber-deep' : 'bg-surface-leaf'}`}
              />
            )}
            <span
              className={`relative w-9 h-9 rounded-full shrink-0 flex items-center justify-center text-[15px] font-bold tabular-nums ${
                done
                  ? 'bg-amber-deep text-white'
                  : now
                    ? 'bg-brand text-white ring-4 ring-brand/15'
                    : 'bg-surface-cream text-gray border-2 border-surface-leaf'
              }`}
            >
              {done ? <Check size={16} strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0 pt-1.5">
              <h4 className={`text-[16px] font-bold leading-snug flex flex-wrap items-center gap-x-2 gap-y-1 ${now || done ? 'text-ink' : 'text-charcoal'}`}>
                {step.title}
                {now && (
                  <span className="inline-flex items-center h-6 px-2 rounded-full bg-brand text-white text-[12px] font-semibold">
                    {c.now}
                  </span>
                )}
              </h4>
              <p className="mt-1 text-[14px] text-gray leading-relaxed">{step.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The four promises. `onMint` swaps the icon ground so it always contrasts. */
function PromiseList({ c, onMint, row }: { c: HomeGroceryCopy; onMint: boolean; row?: boolean }) {
  return (
    <ul className={row ? 'grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-6' : 'space-y-5'}>
      {c.care.map((item, i) => {
        const Icon = CARE_ICONS[i];
        return (
          <li key={item.title} className="flex gap-3.5">
            <span className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
              onMint ? 'bg-surface-cream shadow-card' : 'bg-surface-mint'
            }`}>
              <Icon size={19} strokeWidth={1.75} className="text-amber-deep" />
            </span>
            <div className="min-w-0 pt-0.5">
              <h4 className="text-[15px] font-bold text-ink leading-snug">{item.title}</h4>
              <p className="mt-0.5 text-[14px] text-gray leading-relaxed">{item.body}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The request, right under the hero — the hero's "how many of you" and its
 * button both lead straight into it. One card: the form on the white side,
 * and on the mint side what happens after you press send and what we promise,
 * because that is the moment those answers are needed.
 */
function ApplyCard({ c, lang, household, setHousehold, sent, onSent, signedIn }: {
  c: HomeGroceryCopy;
  lang: Lang;
  household: number;
  setHousehold: (n: number) => void;
  sent: SentRequest | null;
  onSent: (s: SentRequest) => void;
  signedIn: boolean;
}) {
  return (
    // scroll-mt clears the sticky header — 156px on desktop, ~150 on a phone.
    <section
      id="apply"
      className="scroll-mt-[172px] rounded-2xl bg-surface-cream border border-border/60 shadow-card overflow-hidden grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"
    >
      {/* Once sent, the confirmation is shorter than the steps beside it —
          centred in its half rather than leaving a gap below. */}
      <div className={`px-6 sm:px-10 lg:px-12 py-9 sm:py-11 ${sent ? 'lg:flex lg:flex-col lg:justify-center' : ''}`}>
        {sent ? (
          <SentContent c={c} sent={sent} signedIn={signedIn} />
        ) : (
          <>
            <h2 className="text-[26px] sm:text-[32px] font-bold text-ink tracking-[-0.02em] leading-[1.1]">{c.formTitle}</h2>
            <p className="mt-2 text-[16px] text-gray">{c.formBody}</p>
            <div className="mt-8">
              <RequestForm c={c} lang={lang} household={household} onHouseholdChange={setHousehold} onSent={onSent} />
            </div>
          </>
        )}
      </div>
      <aside className="bg-surface-mint px-6 sm:px-10 lg:px-12 py-9 sm:py-11" aria-label={c.howTitle}>
        <h3 className="text-[20px] font-bold text-ink tracking-[-0.01em]">{c.howTitle}</h3>
        <ProcessSteps c={c} current={sent ? 1 : 0} />
        <div className="my-8 h-px bg-surface-leaf" />
        <h3 className="text-[20px] font-bold text-ink tracking-[-0.01em]">{c.careTitle}</h3>
        <div className="mt-5">
          <PromiseList c={c} onMint />
        </div>
      </aside>
    </section>
  );
}

/**
 * The promises on their own, for the in-review page, where there is nothing
 * left to apply for. White, not mint: there it sits right under the mint hero.
 */
function CarePanel({ c }: { c: HomeGroceryCopy }) {
  return (
    <section className="rounded-2xl bg-surface-cream border border-border/60 shadow-card px-6 sm:px-10 lg:px-12 py-9 sm:py-11">
      <h2 className="text-[24px] sm:text-[28px] font-bold text-ink tracking-[-0.02em] leading-tight">{c.careTitle}</h2>
      <p className="mt-1.5 text-[15px] text-gray">{c.careLead}</p>
      <div className="mt-8">
        <PromiseList c={c} onMint={false} row />
      </div>
    </section>
  );
}

/** Takes the form's place once it is sent; the steps beside it move on. */
function SentContent({ c, sent, signedIn }: { c: HomeGroceryCopy; sent: SentRequest; signedIn: boolean }) {
  const echo = [c.summaryPeople(sent.household), sent.frequency];
  return (
    <div>
      <span className="hg-tick w-14 h-14 rounded-full bg-amber-deep flex items-center justify-center">
        <Check size={28} strokeWidth={3} className="text-white" />
      </span>
      <h2 role="status" className="mt-5 text-[28px] sm:text-[32px] font-bold text-ink tracking-[-0.02em] leading-tight">
        {c.sentTitle}
      </h2>
      <p className="mt-2 text-[16px] text-gray leading-relaxed">{c.sentBody(sent.email)}</p>
      {/* What they told us, said back — proof it arrived as they meant it. */}
      <ul className="mt-5 flex flex-wrap gap-1.5" aria-label={c.summaryTitle}>
        {echo.map((item) => (
          <li key={item} className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink bg-amber-mist rounded-md px-2 py-1">
            <Check size={12} strokeWidth={3} className="text-amber-deep" />
            {item}
          </li>
        ))}
      </ul>
      {!signedIn && <p className="mt-6 text-[14px] text-gray leading-relaxed max-w-[52ch]">{c.sentNewAccount}</p>}
      <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
        <Link
          to="/"
          className="min-h-[52px] px-7 rounded-xl bg-brand text-white text-[16px] font-bold hover:bg-brand-mid transition-colors inline-flex items-center justify-center"
        >
          {c.keepShopping}
        </Link>
        <WhatsAppLink label={c.whatsappPrompt} message={c.whatsappMessage} />
      </div>
    </div>
  );
}

/**
 * Questions. The heading used to sit alone in a column of its own above
 * empty space; that column now carries the way out for anyone whose question
 * is not here — WhatsApp, a person replying — and stays in view on wide
 * screens while answers open beside it.
 */
function FAQ({ c }: { c: HomeGroceryCopy }) {
  return (
    <section className="grid lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] gap-6 lg:gap-12 items-start">
      <div className="lg:sticky lg:top-44">
        <h2 className="text-[26px] sm:text-[32px] font-bold text-ink tracking-[-0.02em] leading-[1.1]">{c.faqTitle}</h2>
        <p className="mt-2 text-[16px] text-gray">{c.faqLead}</p>

        <div className="hidden lg:block mt-8">
          <HelpCard c={c} />
        </div>
      </div>

      <div className="rounded-2xl bg-surface-cream border border-border/60 shadow-card divide-y divide-border overflow-hidden">
        {c.faq.map((item, i) => (
          <details key={item.q} className="group" open={i === 0}>
            <summary className="flex items-center justify-between gap-4 px-5 sm:px-7 py-5 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-surface-sand/50 transition-colors">
              <span className="text-[16px] font-semibold text-ink leading-snug">{item.q}</span>
              <span className="w-8 h-8 rounded-full bg-surface-sand text-charcoal group-open:bg-brand group-open:text-white flex items-center justify-center shrink-0 transition-colors">
                <ChevronDown size={18} strokeWidth={2} className="transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <p className="px-5 sm:px-7 pb-6 -mt-1 text-[15px] text-gray leading-relaxed max-w-[62ch]">{item.a}</p>
          </details>
        ))}
      </div>

      {/* On a phone the help card follows the questions — it is what you
          reach for after reading them, not before. */}
      <div className="lg:hidden">
        <HelpCard c={c} />
      </div>
    </section>
  );
}

function HelpCard({ c }: { c: HomeGroceryCopy }) {
  return (
    <div className="rounded-2xl bg-surface-mint px-6 py-6">
      <span className="w-11 h-11 rounded-full bg-surface-cream shadow-card flex items-center justify-center" aria-hidden="true">
        <MessageCircle size={20} strokeWidth={1.75} className="text-amber-deep" />
      </span>
      <h3 className="mt-4 text-[18px] font-bold text-ink">{c.helpTitle}</h3>
      <p className="mt-1 text-[15px] text-gray leading-relaxed">{c.helpBody}</p>
      <a
        href={whatsappLink(c.whatsappMessage)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-5 min-h-[52px] w-full sm:w-auto px-6 rounded-xl bg-surface-cream border-2 border-card text-ink text-[15px] font-bold hover:border-brand-light transition-colors inline-flex items-center justify-center gap-2"
      >
        <MessageCircle size={18} strokeWidth={1.75} className="text-brand" />
        {c.helpCta}
      </a>
      <Link
        to="/faq"
        className="mt-4 block text-[14px] font-semibold text-brand hover:text-brand-ink underline-offset-4 hover:underline"
      >
        {c.helpAll}
      </Link>
    </div>
  );
}

/**
 * The last word, for whoever read to the bottom without applying. The one
 * blue band on the page, so it reads as an ending rather than one more mint
 * panel; its headline is about the list on the fridge, and beside it that
 * list gets crossed off. The reassurances from the hero come back here,
 * next to the button, where the decision is made.
 */
function FinalCTA({ c }: { c: HomeGroceryCopy }) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-brand text-white">
      <span aria-hidden="true" className="absolute -right-32 -top-40 w-[520px] h-[520px] rounded-full bg-brand-mid/45" />
      <span aria-hidden="true" className="absolute -left-24 -bottom-48 w-[380px] h-[380px] rounded-full bg-brand-deepest/30" />

      <div className="relative grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-12 px-6 sm:px-10 lg:px-16 py-11 sm:py-14 lg:py-16">
        <div className="min-w-0">
          <h2 className="text-[30px] sm:text-[40px] lg:text-[48px] font-bold leading-[1.05] tracking-[-0.03em] text-balance">
            {c.finalTitle.map((line) => (
              <span key={line} className="block">{line}</span>
            ))}
          </h2>
          <p className="mt-4 text-[16px] sm:text-[17px] text-white/80 leading-relaxed max-w-[44ch]">{c.finalBody}</p>

          <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
            <button
              type="button"
              onClick={scrollToApply}
              className="min-h-[52px] px-7 rounded-xl bg-card text-brand-ink text-[16px] font-bold shadow-[0_8px_24px_rgba(2,43,145,0.35)] hover:bg-brand-whisper transition-colors"
            >
              {c.startRequest}
            </button>
            <a
              href={whatsappLink(c.whatsappMessage)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[15px] font-semibold text-white/90 hover:text-white underline-offset-4 hover:underline"
            >
              <MessageCircle size={18} strokeWidth={1.75} />
              {c.whatsappPrompt}
            </a>
          </div>

          <ul className="mt-8 pt-6 border-t border-white/20 max-w-[560px] flex flex-col gap-3">
            {c.trust.map((t) => (
              <li key={t} className="flex items-center gap-2 text-[14px] text-white/85">
                <span className="w-5 h-5 rounded-full bg-amber flex items-center justify-center shrink-0">
                  <Check size={12} strokeWidth={3.5} className="text-white" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Beside the headline on a wide screen. On a phone it comes after
            the button and the reassurances, so the band still opens with the
            headline and the button, and the crossed-off list closes the
            page. It used to be hidden there altogether. */}
        <div className="min-w-0 w-full max-w-[300px] sm:max-w-[340px] lg:max-w-none mx-auto">
          <FridgeNote c={c} />
        </div>
      </div>
    </section>
  );
}

/* ───────── Page ───────── */

export default function HomeGroceryPage() {
  const { lang } = useLanguageStore();
  const c = COPY[lang];
  const { isAuthenticated, hydrating, user } = useAuthStore();
  const { pathname } = useLocation();

  const { data: mine, isLoading: mineLoading, isError: mineFailed } =
    useMyHomeGrocery({ enabled: isAuthenticated });
  // An approved household goes to its profile page; nobody else is sent
  // anywhere. A failed status read renders the page (see `view` below).
  const access = homeGroceryRouteAccess({
    hydrating,
    isAuthenticated,
    statusLoading: mineLoading,
    isSubscriber: !!mine?.subscriber,
    pathname,
  });
  const { data: subscriptions } = useRashanSubscriptions({ enabled: isAuthenticated });
  // A Home Grocery plan lives in the same table as the old self-serve
  // subscriptions; it is the household's plan, not something to migrate.
  const { data: planView } = useHomeGroceryPlan({ enabled: isAuthenticated });
  const legacy = useMemo(
    () => (subscriptions ?? []).filter((s) => s.status !== 'cancelled' && s.id !== planView?.plan?.id),
    [subscriptions, planView?.plan?.id],
  );

  const [household, setHousehold] = useState(4);
  const [sent, setSent] = useState<SentRequest | null>(null);
  const sentTo = sent?.email ?? null;

  // Which page this visitor gets. A failed status read falls back to the
  // application: the API refuses a second request anyway, and the form then
  // says so, which beats a page that never finishes loading.
  const view: 'loading' | 'apply' | 'pending' =
    access.kind !== 'render'
      ? 'loading'
      : !isAuthenticated || mineFailed || !mine
        ? 'apply'
        : mine.open_request
          ? 'pending'
          : 'apply';

  const rejectedReason = view === 'apply' && mine?.last_decision?.approval_status === 'rejected'
    ? (mine.last_decision.rejection_reason ?? null)
    : undefined;

  const onSent = (s: SentRequest) => setSent(s);

  // Where to look once it is sent. Signed in, the hero itself turns into "in
  // review" once the status is re-read, so back to the top. Signed out, the
  // confirmation replaces the (taller) form — bring it into view, or a phone
  // is left looking at the empty space the form used to fill.
  useEffect(() => {
    if (!sent) return;
    if (isAuthenticated) window.scrollTo({ top: 0, behavior: 'smooth' });
    else document.getElementById('apply')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [sent, isAuthenticated]);

  if (access.kind === 'redirect') return <Navigate to={access.to} replace />;

  const showForm = view === 'apply' || (sentTo !== null && view !== 'pending');

  return (
    <div className="bg-surface-linen pb-20">
      <div className="max-w-[1500px] mx-auto w-full px-4 lg:px-6 pt-4 flex flex-col gap-16 md:gap-24">
        <div className="flex flex-col gap-4">
          {/* A household that was turned down needs the reason first — not
              the pitch they already answered once. */}
          {rejectedReason !== undefined && !sentTo && <RejectedNotice c={c} reason={rejectedReason} />}
          {view === 'loading' && <HeroSkeleton />}
          {view === 'apply' && (
            <HeroApply c={c} lang={lang} household={household} setHousehold={setHousehold} />
          )}
          {view === 'pending' && mine && <HeroPending c={c} lang={lang} mine={mine} email={user?.email ?? null} />}

          {legacy.length > 0 && <LegacyNotice c={c} subs={legacy} />}
        </div>

        {showForm && (
          <ApplyCard
            c={c}
            lang={lang}
            household={household}
            setHousehold={setHousehold}
            sent={sent}
            onSent={onSent}
            signedIn={isAuthenticated}
          />
        )}
        {view === 'pending' && <CarePanel c={c} />}
        <Brands c={c} />
        <FAQ c={c} />
        {view === 'apply' && !sentTo && <FinalCTA c={c} />}
      </div>
    </div>
  );
}
