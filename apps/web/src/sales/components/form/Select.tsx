import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  /** Optional set of options rendered automatically when children isn't provided. */
  options?: Array<{ value: string; label: string }>;
  /** Placeholder shown as the first disabled option when value is empty. */
  placeholder?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectFieldProps>(function Select(
  { label, error, hint, className, id, options, placeholder, children, ...selectProps },
  ref,
) {
  const reactId = useId();
  const selectId = id ?? `sel-${reactId}`;
  const describedBy = error ? `${selectId}-err` : hint ? `${selectId}-hint` : undefined;

  const ring = error
    ? 'border-danger focus:ring-danger/20 focus:border-danger'
    : 'border-border focus:ring-brand/30 focus:border-brand';

  return (
    <div className={className}>
      {label && (
        <label htmlFor={selectId} className="block text-sm font-semibold text-ink font-display mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={[
            'w-full h-12 bg-surface-cream border rounded-lg pl-4 pr-10 text-sm font-display text-ink',
            'focus:outline-none focus:ring-2 transition-colors appearance-none',
            ring,
          ].join(' ')}
          {...selectProps}
        >
          {placeholder && <option value="" disabled>{placeholder}</option>}
          {options
            ? options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))
            : children}
        </select>
        <ChevronDown size={16} strokeWidth={2} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40 pointer-events-none" />
      </div>
      {error ? (
        <p
          id={`${selectId}-err`}
          role="alert"
          className="flex items-start gap-1.5 mt-1.5 text-[12px] text-danger font-display font-medium"
        >
          <AlertCircle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={`${selectId}-hint`} className="mt-1.5 text-[12px] text-muted font-body">{hint}</p>
      ) : null}
    </div>
  );
});

export default Select;
