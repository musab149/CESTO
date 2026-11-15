import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  error?: string;
}

const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, error, className, id, ...inputProps }, ref,
) {
  const reactId = useId();
  const inputId = id ?? `cb-${reactId}`;

  return (
    <div className={className}>
      <label htmlFor={inputId} className="flex items-start gap-2.5 cursor-pointer select-none">
        <div className="relative mt-0.5">
          <input
            ref={ref}
            id={inputId}
            type="checkbox"
            className="sr-only peer"
            aria-invalid={error ? true : undefined}
            {...inputProps}
          />
          <div
            className={[
              'w-5 h-5 rounded border-2 bg-surface-cream transition-colors flex items-center justify-center shrink-0',
              'peer-checked:bg-brand peer-checked:border-brand',
              error ? 'border-danger' : 'border-border',
            ].join(' ')}
          >
            <svg
              viewBox="0 0 16 16"
              className="w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-opacity"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 8 6.5 11.5 13 5" />
            </svg>
          </div>
        </div>
        <span className="text-sm text-ink font-display leading-snug">{label}</span>
      </label>
      {error && (
        <p
          role="alert"
          className="flex items-start gap-1.5 mt-1.5 ml-7 text-[12px] text-danger font-display font-medium"
        >
          <AlertCircle size={13} strokeWidth={2} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
});

export default Checkbox;
