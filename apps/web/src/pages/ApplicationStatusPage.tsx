import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  CheckCircle2, XCircle, Clock, AlertTriangle, Send, Store as StoreIcon,
} from 'lucide-react';
import {
  useLeadStatusByToken, useResubmitLead,
} from '@grocery-app/shared';

/**
 * MV Slice 1 · public magic-link status page.
 *
 * Reached via the "needs more info" email — the URL carries the raw token,
 * the token itself is the auth. No login. Four render branches:
 *   invalid/expired token   → 404 banner + apply-again CTA
 *   approved                → congrats + partner-login link
 *   rejected                → apologetic banner
 *   pending_review          → informational banner (post-resubmit)
 *   needs_info              → resubmit form
 *
 * Keeps intentionally sparse — this is a rarely-seen page, no branding
 * flourish. Prioritises clarity of state.
 */
export default function ApplicationStatusPage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError, refetch } = useLeadStatusByToken(token);
  const resubmit = useResubmitLead();

  // Form state — only populated once `data` arrives.
  const [location, setLocation]           = useState('');
  const [businessType, setBusinessType]   = useState('');
  const [website, setWebsite]             = useState('');
  const [registrationNo, setRegistrationNo] = useState('');
  const [note, setNote]                   = useState('');

  useEffect(() => {
    if (!data) return;
    setLocation(data.location ?? '');
    setBusinessType(data.business_type ?? '');
    setWebsite(data.website ?? '');
    setRegistrationNo(data.registration_no ?? '');
  }, [data]);

  const [submitted, setSubmitted] = useState(false);

  async function handleResubmit() {
    if (!token) return;
    // Only send fields the applicant actually populated / changed. Empty
    // string counts as "clear this field" per the backend contract.
    await resubmit.mutateAsync({
      token,
      payload: {
        location:        location.trim(),
        business_type:   businessType.trim(),
        website:         website.trim(),
        registration_no: registrationNo.trim(),
        ...(note.trim() && { note: note.trim() }),
      },
    });
    setSubmitted(true);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-muted mb-3">
          <StoreIcon className="w-3.5 h-3.5" strokeWidth={1.75} />
          Cesto Partners · Application status
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold font-display text-ink tracking-tight">
          Your partner application
        </h1>
      </div>

      {isLoading && (
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <div className="text-sm text-muted">Loading your application…</div>
        </div>
      )}

      {isError && (
        <div className="bg-card rounded-2xl border border-danger/30 p-8">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-danger shrink-0 mt-0.5" strokeWidth={1.75} />
            <div>
              <h2 className="text-lg font-bold font-display text-ink mb-1">
                This link is invalid or has expired
              </h2>
              <p className="text-sm text-muted font-body mb-4">
                Magic links are valid for 7 days. If yours has expired, you can submit a fresh application
                from the B2B page and we'll pick up where you left off.
              </p>
              <a
                href="/b2b-deals"
                className="inline-flex items-center gap-2 h-11 px-5 rounded-xl bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm transition-colors"
              >
                Start a new application
              </a>
            </div>
          </div>
        </div>
      )}

      {data && !submitted && data.approval_status === 'approved' && (
        <div className="bg-card rounded-2xl border border-success/30 p-8">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-6 h-6 text-success shrink-0 mt-0.5" strokeWidth={1.75} />
            <div>
              <h2 className="text-lg font-bold font-display text-ink mb-1">
                Approved — welcome to Cesto Partners
              </h2>
              <p className="text-sm text-muted font-body">
                Your application for <strong className="text-ink">{data.company}</strong> was approved. Check your inbox
                for the welcome email — it has your temporary login credentials and a link to the partner
                dashboard.
              </p>
            </div>
          </div>
        </div>
      )}

      {data && data.approval_status === 'rejected' && (
        <div className="bg-card rounded-2xl border border-border p-8">
          <div className="flex items-start gap-3">
            <XCircle className="w-6 h-6 text-muted shrink-0 mt-0.5" strokeWidth={1.75} />
            <div>
              <h2 className="text-lg font-bold font-display text-ink mb-1">
                Application not moving forward
              </h2>
              <p className="text-sm text-muted font-body">
                Thanks for your interest in Cesto Partners. After reviewing your submission we're not able to
                move forward at this time. Details were sent to your inbox. You're welcome to apply again in
                the future.
              </p>
            </div>
          </div>
        </div>
      )}

      {data && (submitted || data.approval_status === 'pending_review') && (
        <div className="bg-card rounded-2xl border border-brand/30 p-8">
          <div className="flex items-start gap-3">
            <Clock className="w-6 h-6 text-brand shrink-0 mt-0.5" strokeWidth={1.75} />
            <div>
              <h2 className="text-lg font-bold font-display text-ink mb-1">
                We've received your application
              </h2>
              <p className="text-sm text-muted font-body">
                Our team will review it and get back to you.
                You can close this tab — we'll email you the outcome.
              </p>
            </div>
          </div>
        </div>
      )}

      {data && !submitted && data.approval_status === 'needs_info' && (
        <div className="space-y-6">
          <div className="bg-amber-mist/50 border border-amber/40 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-deep shrink-0 mt-0.5" strokeWidth={1.75} />
              <div>
                <h2 className="text-base font-bold font-display text-amber-deep mb-1">
                  A bit more information needed
                </h2>
                <p className="text-[13px] text-amber-deep/85 font-body">
                  Check your email for the specific details our team asked for, update the fields below,
                  and hit <span className="font-semibold">Submit updated application</span>.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
            <div className="text-xs font-mono uppercase tracking-widest text-muted mb-1">
              Your application · {data.company}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Location</span>
                <input
                  type="text" value={location} onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Madrid, Spain"
                  className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Business type</span>
                <input
                  type="text" value={businessType} onChange={(e) => setBusinessType(e.target.value)}
                  placeholder="e.g. Retail grocery"
                  className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Website</span>
                <input
                  type="url" value={website} onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://…"
                  autoComplete="off" spellCheck={false}
                  className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-mono text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">Registration no.</span>
                <input
                  type="text" value={registrationNo} onChange={(e) => setRegistrationNo(e.target.value)}
                  placeholder="Business / tax ID"
                  autoComplete="off" spellCheck={false}
                  className="mt-1 w-full bg-surface-cream border border-border rounded-lg h-11 px-3 text-sm font-mono text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30"
                />
              </label>
            </div>

            <label className="block">
              <span className="text-[11px] font-medium text-muted uppercase tracking-wide font-display">
                Note to our team (optional)
              </span>
              <textarea
                value={note} onChange={(e) => setNote(e.target.value)}
                rows={4}
                placeholder="Anything you'd like our team to know about the updates you've made?"
                className="mt-1 w-full bg-surface-cream border border-border rounded-lg px-3 py-2 text-sm font-body text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand/30 resize-none"
              />
            </label>

            {resubmit.isError && (
              <div className="bg-danger-bg border border-danger/40 rounded-lg px-3 py-2 text-[13px] font-body text-danger">
                {resubmit.error instanceof Error ? resubmit.error.message : 'Something went wrong. Please try again.'}
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isLoading}
                className="text-xs font-semibold font-display text-muted hover:text-ink transition-colors"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={handleResubmit}
                disabled={resubmit.isPending}
                className="inline-flex items-center gap-2 h-11 px-6 rounded-xl bg-brand hover:bg-brand-mid text-white font-semibold font-display text-sm transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" strokeWidth={1.75} />
                {resubmit.isPending ? 'Submitting…' : 'Submit updated application'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
