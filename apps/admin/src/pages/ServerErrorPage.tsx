import { useNavigate } from 'react-router-dom';
import { AlertOctagon, Home, RefreshCw } from 'lucide-react';
import ErrorPage from './ErrorPage';

interface Props {
  reference?: string;
  onRetry?: () => void;
  /** Present when ErrorBoundary caught a render crash rather than an API 500. */
  error?: Error | null;
  componentStack?: string | null;
}

/**
 * Two different failures land here and they are not the same thing.
 *
 * /500 is a real server error. ErrorBoundary is a component that threw while
 * rendering, with the API perfectly healthy — so the page said "the API
 * returned an unexpected error" over a crash the API had no part in, and sent
 * whoever read it to go looking at the backend. It also said the team had been
 * alerted, which was never true: nothing reports anywhere.
 *
 * So the copy now depends on which one happened, and a render crash shows the
 * message it threw. This is a staff-only panel — the error text is what makes
 * a bug report actionable, and hiding it only means it gets described as "it
 * broke".
 */
/** What main.tsx stashed on its way here. See redirectOnServerError. */
interface StashedApiError {
  status?: number;
  message?: string;
  at?: string;
  path?: string;
  data?: unknown;
}

function readStashedApiError(): StashedApiError | null {
  try {
    const raw = sessionStorage.getItem('admin:lastServerError');
    return raw ? (JSON.parse(raw) as StashedApiError) : null;
  } catch {
    return null;
  }
}

export default function ServerErrorPage({ reference, onRetry, error, componentStack }: Props) {
  const navigate = useNavigate();
  const crashed = !!error;

  // Only for the API case: a render crash has the real Error in hand and the
  // stash would be stale from some earlier request.
  const stashed = crashed ? null : readStashedApiError();
  const serverMessage = stashed?.message
    ?? (stashed?.data as { error?: string } | null)?.error
    ?? null;

  return (
    <ErrorPage
      icon={AlertOctagon}
      accent="danger"
      badge={crashed ? 'APP ERROR' : 'ERROR 500'}
      title={crashed ? 'This screen stopped rendering' : 'Something broke on our end'}
      body={crashed
        ? 'A component threw while drawing this page. Your last action may well have gone through \u2014 reload before redoing it. Send engineering the reference and the message below.'
        : 'The API returned an unexpected error. Try again, and if it keeps happening, send engineering the reference below.'}
      detail={
        (reference ?? stashed?.path) ? (
          <>
            <span className="font-display text-[11px] uppercase tracking-wider text-gray shrink-0">Reference</span>
            <span className="truncate text-ink">
              {reference ?? `${stashed?.path}  ·  ${stashed?.at}`}
            </span>
          </>
        ) : undefined
      }
      extra={!crashed && serverMessage ? (
        /* The server said something specific — show it. It usually names the
           Prisma code, which is the one token that makes the report
           actionable instead of "it broke". */
        <div className="rounded-lg border border-danger/25 bg-danger-bg/40 overflow-hidden">
          <p className="px-3 pt-2.5 text-[11px] font-display uppercase tracking-wider text-danger">
            {`HTTP ${stashed?.status ?? 500}`}
          </p>
          <p className="px-3 pb-2.5 pt-1 text-[12.5px] font-mono text-ink break-words">
            {serverMessage}
          </p>
        </div>
      ) : crashed ? (
        <div className="rounded-lg border border-danger/25 bg-danger-bg/40 overflow-hidden">
          <p className="px-3 pt-2.5 text-[11px] font-display uppercase tracking-wider text-danger">
            {error.name}
          </p>
          <p className="px-3 pb-2.5 pt-1 text-[12.5px] font-mono text-ink break-words">
            {error.message || 'No message'}
          </p>
          {componentStack && (
            <details className="border-t border-danger/20">
              <summary className="px-3 py-2 text-[12px] font-display text-gray cursor-pointer hover:text-ink">
                Component stack
              </summary>
              <pre className="px-3 pb-3 text-[11px] font-mono text-muted whitespace-pre-wrap break-words max-h-60 overflow-auto">
                {componentStack.trim()}
              </pre>
            </details>
          )}
        </div>
      ) : undefined}
      actions={[
        { label: crashed ? 'Reload' : 'Try again', icon: RefreshCw, onClick: onRetry ?? (() => window.location.reload()) },
        { label: 'Dashboard', icon: Home, variant: 'secondary', onClick: () => navigate('/') },
      ]}
    />
  );
}
