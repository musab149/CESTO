import { useMemo, useState } from 'react';
import { Megaphone, Send, CheckCircle2, AlertCircle, Users, Repeat, ShoppingBag } from 'lucide-react';
import { useBroadcastNotification, type BroadcastPayload } from '@grocery-app/shared';

type Segment = NonNullable<BroadcastPayload['segment']>;

const SEGMENTS: Array<{
  key: Segment;
  label: string;
  description: string;
  Icon: typeof Users;
}> = [
  {
    key: 'all',
    label: 'All active customers',
    description: 'Every active user account — biggest reach, use sparingly.',
    Icon: Users,
  },
  {
    key: 'with_orders',
    label: 'Customers with orders',
    description: 'Anyone who has placed at least one order.',
    Icon: ShoppingBag,
  },
  {
    key: 'subscribers',
    label: 'Active Rashan subscribers',
    description: 'Users with an active subscription.',
    Icon: Repeat,
  },
];

const TITLE_LIMIT = 60;
const BODY_LIMIT  = 180;

export default function BroadcastPage() {
  const broadcast = useBroadcastNotification();

  const [titleEs, setTitleEs] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEs, setBodyEs]   = useState('');
  const [bodyEn, setBodyEn]   = useState('');
  const [deeplink, setDeeplink] = useState('');
  const [segment, setSegment] = useState<Segment>('all');
  const [confirming, setConfirming] = useState(false);

  const result = broadcast.data ?? null;
  const apiError = broadcast.error ? (broadcast.error as Error).message : null;

  const formError = useMemo(() => {
    if (!titleEs.trim() || !titleEn.trim()) return 'Both Spanish and English titles are required.';
    if (!bodyEs.trim() || !bodyEn.trim())   return 'Both Spanish and English bodies are required.';
    if (titleEs.length > TITLE_LIMIT || titleEn.length > TITLE_LIMIT) return `Titles must be ${TITLE_LIMIT} characters or fewer.`;
    if (bodyEs.length > BODY_LIMIT || bodyEn.length > BODY_LIMIT)     return `Bodies must be ${BODY_LIMIT} characters or fewer.`;
    if (deeplink && !deeplink.startsWith('/')) return 'Deeplink must be an app-relative path starting with "/".';
    return null;
  }, [titleEs, titleEn, bodyEs, bodyEn, deeplink]);

  const send = async () => {
    if (formError) return;
    await broadcast.mutateAsync({
      title_es: titleEs.trim(),
      title_en: titleEn.trim(),
      body_es:  bodyEs.trim(),
      body_en:  bodyEn.trim(),
      deeplink: deeplink.trim() ? deeplink.trim() : null,
      segment,
    });
    setConfirming(false);
    // Clear the form so the next broadcast doesn't accidentally reuse it.
    setTitleEs(''); setTitleEn(''); setBodyEs(''); setBodyEn(''); setDeeplink('');
  };

  return (
    <div className="max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <div className="w-11 h-11 rounded-xl bg-brand-mist text-brand flex items-center justify-center shrink-0">
          <Megaphone size={22} strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="text-2xl font-bold font-display text-ink">Broadcast notification</h1>
          <p className="text-sm text-muted mt-0.5">
            Send a one-off push + inbox notification to a segment of customers.
            Persisted per recipient so each user's read state works as usual.
          </p>
        </div>
      </div>

      {/* Last result */}
      {result && (
        <div className="mb-5 rounded-lg border border-success/30 bg-success-bg px-4 py-3 flex items-start gap-3">
          <CheckCircle2 size={18} strokeWidth={2} className="text-success mt-0.5 shrink-0" />
          <div className="text-sm text-success font-display">
            <p className="font-bold">Broadcast sent</p>
            <p className="text-xs mt-0.5">
              Persisted {result.persisted} notification{result.persisted === 1 ? '' : 's'} to{' '}
              {result.recipients} recipient{result.recipients === 1 ? '' : 's'}
              {result.segment ? ` in segment "${result.segment}"` : ''}.
            </p>
          </div>
        </div>
      )}
      {apiError && (
        <div className="mb-5 rounded-lg border border-danger/30 bg-danger-bg px-4 py-3 flex items-start gap-3">
          <AlertCircle size={18} strokeWidth={2} className="text-danger mt-0.5 shrink-0" />
          <p className="text-sm text-danger font-display">{apiError}</p>
        </div>
      )}

      {/* Composer */}
      <div className="bg-card border border-border rounded-xl p-6 space-y-6">
        {/* Audience */}
        <section>
          <h2 className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted font-display mb-3">
            Audience
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {SEGMENTS.map((s) => {
              const active = segment === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setSegment(s.key)}
                  className={`text-left rounded-lg border px-3.5 py-3 transition-colors ${
                    active
                      ? 'border-brand bg-brand-mist/40'
                      : 'border-border bg-surface-cream hover:border-brand/40'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <s.Icon size={16} strokeWidth={1.75} className={active ? 'text-brand' : 'text-muted'} />
                    <span className={`text-sm font-bold font-display ${active ? 'text-brand' : 'text-ink'}`}>
                      {s.label}
                    </span>
                  </div>
                  <p className="text-xs text-muted font-body leading-snug">{s.description}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* Title — bilingual */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <BilingualField
            label="Title (ES)"
            value={titleEs}
            onChange={setTitleEs}
            placeholder="Oferta del fin de semana"
            limit={TITLE_LIMIT}
          />
          <BilingualField
            label="Title (EN)"
            value={titleEn}
            onChange={setTitleEn}
            placeholder="Weekend offer"
            limit={TITLE_LIMIT}
          />
        </section>

        {/* Body — bilingual */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <BilingualField
            label="Body (ES)"
            value={bodyEs}
            onChange={setBodyEs}
            placeholder="Hasta -20% en arroz Basmati hasta el domingo."
            limit={BODY_LIMIT}
            multiline
          />
          <BilingualField
            label="Body (EN)"
            value={bodyEn}
            onChange={setBodyEn}
            placeholder="Up to 20% off Basmati rice until Sunday."
            limit={BODY_LIMIT}
            multiline
          />
        </section>

        {/* Deeplink */}
        <section>
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted font-display block mb-1.5">
              Deeplink (optional)
            </span>
            <input
              type="text"
              value={deeplink}
              onChange={(e) => setDeeplink(e.target.value)}
              placeholder="/categories/cat-001"
              className="w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm font-mono text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
            />
            <span className="text-[11px] text-muted font-body mt-1.5 block">
              App-relative path. Tapping the notification jumps the user here. Leave blank for an info-only message.
            </span>
          </label>
        </section>

        {/* Footer / send. On a phone (2026-11-05) the status line sits above
            a full-width Send, instead of squeezing it into a two-line button. */}
        <div className="border-t border-border pt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <span className="text-xs text-muted font-display">
            {formError ?? `Ready to send to "${segment}"`}
          </span>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!!formError || broadcast.isPending}
            className="inline-flex items-center justify-center gap-2 h-11 sm:h-10 px-4 shrink-0 rounded-lg text-sm font-bold font-display bg-brand text-white hover:bg-brand-deepest transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={14} strokeWidth={2} />
            {broadcast.isPending ? 'Sending…' : 'Send broadcast'}
          </button>
        </div>
      </div>

      {/* Confirm dialog */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-veil/40 backdrop-blur-sm">
          <div className="bg-card rounded-xl border border-border shadow-float max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-bold font-display text-ink mb-1.5">Send this broadcast?</h3>
            <p className="text-sm text-muted font-body mb-5">
              This will push to every active user in the <strong className="text-ink">{segment}</strong>{' '}
              segment and create one inbox row per recipient. This can't be undone.
            </p>
            <div className="bg-surface-cream rounded-lg border border-border p-3 mb-5">
              <p className="text-[11px] uppercase tracking-wider font-bold text-muted font-display">Preview · ES</p>
              <p className="text-sm font-bold text-ink font-display mt-1">{titleEs}</p>
              <p className="text-xs text-gray font-body mt-1">{bodyEs}</p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={broadcast.isPending}
                className="h-10 px-4 rounded-lg text-sm font-bold font-display text-ink border border-border hover:border-ink/30 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={send}
                disabled={broadcast.isPending}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-bold font-display bg-brand text-white hover:bg-brand-deepest transition-colors disabled:opacity-50"
              >
                <Send size={14} strokeWidth={2} />
                {broadcast.isPending ? 'Sending…' : 'Confirm send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BilingualField({
  label, value, onChange, placeholder, limit, multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  limit: number;
  multiline?: boolean;
}) {
  const over = value.length > limit;
  return (
    <label className="block">
      <span className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] uppercase tracking-[0.14em] font-bold text-muted font-display">{label}</span>
        <span className={`text-[11px] font-mono ${over ? 'text-danger font-bold' : 'text-muted'}`}>
          {value.length}/{limit}
        </span>
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full bg-surface-cream border border-border rounded-lg px-3 py-2.5 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition resize-none"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full bg-surface-cream border border-border rounded-lg h-10 px-3 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand transition"
        />
      )}
    </label>
  );
}
