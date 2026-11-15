import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { AlertCircle } from 'lucide-react';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, hint, className, id, rows = 4, ...textareaProps },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `ta-${reactId}`;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;

  const ringClasses = error
    ? 'border-danger focus:border-danger focus:ring-danger/20'
    : 'border-border focus:border-brand focus:ring-brand-mist';

  return (
    <div className={className}>
      {label && (
        <label
          htmlFor={inputId}
          className="block text-[13px] font-semibold text-charcoal font-display mb-2"
        >
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={[
          'w-full bg-surface-white border-2 rounded-xl px-4 py-3 text-[15px] text-ink font-ui',
          'focus:outline-none focus:ring-4 transition-all placeholder:text-muted resize-y',
          ringClasses,
        ].join(' ')}
        {...textareaProps}
      />
      {error ? (
        <p
          id={`${inputId}-err`}
          role="alert"
          className="flex items-start gap-1.5 mt-1.5 text-[12px] text-danger font-ui font-medium"
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
