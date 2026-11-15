import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface ErrorPageAction {
  label: string;
  onClick: () => void;
  icon?: LucideIcon;
  variant?: 'primary' | 'secondary';
}

interface Props {
  icon: LucideIcon;
  badge: string;
  title: string;
  body: string;
  detail?: ReactNode;
  /** Rendered full-width under the detail chip, for anything longer than it. */
  extra?: ReactNode;
  actions: ErrorPageAction[];
  accent?: 'brand' | 'danger' | 'warning';
  hideBack?: boolean;
}

const ACCENT: Record<NonNullable<Props['accent']>, { halo: string; chip: string; ring: string }> = {
  brand:   { halo: 'bg-brand-mist text-brand',     chip: 'bg-brand text-white',     ring: 'ring-brand/20' },
  danger:  { halo: 'bg-danger-bg text-danger',     chip: 'bg-danger text-white',    ring: 'ring-danger/20' },
  warning: { halo: 'bg-amber-mist text-amber-deep', chip: 'bg-amber-deep text-white', ring: 'ring-amber/30' },
};

export default function ErrorPage({
  icon: Icon, badge, title, body, detail, extra, actions, accent = 'brand', hideBack,
}: Props) {
  const navigate = useNavigate();
  const tone = ACCENT[accent];

  return (
    <div className="min-h-screen bg-surface-linen flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-[640px]">
        {!hideBack && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-[13px] font-display font-medium text-gray hover:text-ink transition-colors mb-6"
          >
            <ArrowLeft size={15} strokeWidth={2} />
            Back
          </button>
        )}

        <section className="bg-card border border-border rounded-2xl shadow-card overflow-hidden">
          <div className="px-6 sm:px-10 py-10 sm:py-14 flex flex-col items-center text-center">
            <div className={`w-20 h-20 rounded-2xl ${tone.halo} flex items-center justify-center mb-5 ring-8 ${tone.ring}`}>
              <Icon size={32} strokeWidth={1.75} />
            </div>

            <span className={`inline-flex items-center gap-1.5 ${tone.chip} px-3 py-1 rounded-full text-[11px] font-extrabold font-display tracking-[0.18em] mb-4`}>
              {badge}
            </span>

            <h1 className="text-2xl sm:text-3xl font-display font-bold text-ink leading-tight mb-3">
              {title}
            </h1>
            <p className="max-w-[480px] text-[14px] text-gray font-body leading-relaxed mb-6">
              {body}
            </p>

            {detail && (
              <div className="inline-flex items-center gap-2 bg-surface-linen border border-border rounded-lg px-3 py-2 text-[12px] font-mono text-muted max-w-full">
                {detail}
              </div>
            )}

            {extra && <div className="w-full mt-4 text-left">{extra}</div>}
          </div>

          <div className="bg-surface-cream border-t border-border px-6 sm:px-10 py-6 flex flex-col sm:flex-row gap-3 sm:justify-center">
            {actions.map((a, i) => {
              const ActionIcon = a.icon;
              const primary = a.variant !== 'secondary';
              const cls = primary
                ? 'bg-brand text-white hover:bg-brand-mid'
                : 'border-2 border-border text-ink hover:bg-surface-linen';
              return (
                <button
                  key={i}
                  type="button"
                  onClick={a.onClick}
                  className={`h-11 px-5 rounded-xl text-[13px] font-display font-semibold transition-colors inline-flex items-center justify-center gap-2 ${cls}`}
                >
                  {ActionIcon && <ActionIcon size={15} strokeWidth={1.75} />}
                  {a.label}
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
