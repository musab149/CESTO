import { forwardRef, useId, type TextareaHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Partner-scoped textarea primitive. Mirrors the admin Textarea shape
 * ([apps/admin/src/components/form/Textarea.tsx]) so a partner ↔ admin
 * side-by-side reads the same. Kept in the partner scope so styling
 * evolves independently from admin if we ever diverge.
 */

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  labelTrailing?: ReactNode;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, className, id, labelTrailing, rows = 4, ...textareaProps },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `ta-${reactId}`;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;

  const ring = error
    ? 'border-danger focus:ring-danger/20 focus:border-danger'
    : 'border-border focus:ring-brand/30 focus:border-brand';

  return (
    <div className={className}>
      {label && (
        <div className="flex items-center justify-between mb-1.5">
          <label htmlFor={inputId} className="text-sm font-semibold text-ink font-display">
            {label}
          </label>
          {labelTrailing}
        </div>
      )}
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[
          'w-full bg-surface-cream border rounded-lg px-4 py-3 text-sm font-display text-ink',
          'focus:outline-none focus:ring-2 transition-colors placeholder:text-ink/40 resize-y',
          ring,
        ].join(' ')}
        {...textareaProps}
      />
      {error ? (
        <p
          id={`${inputId}-err`}
          role="alert"
          className="flex items-start gap-1.5 mt-1.5 text-[12px] text-danger font-display font-medium"
        >
          <AlertCircle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-[12px] text-muted font-body">
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export default Textarea;
