import { forwardRef, useId, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  /** Lucide icon (or any node) rendered inside the input at the left. */
  leadingIcon?: ReactNode;
  /** Optional element rendered at the right. */
  trailing?: ReactNode;
  error?: string;
  hint?: string;
  /** When true and the value matches, paints a brand-coloured ring. */
  success?: boolean;
  /** Optional helper text rendered to the right of the label. */
  labelTrailing?: ReactNode;
}

/**
 * Standard text field used across admin CRUD forms. Matches the existing
 * admin look — h-12, rounded-lg, surface-cream background, brand focus
 * ring. Errors paint the border red and surface a message under the row.
 */
const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, leadingIcon, trailing, error, hint, success, className, id, labelTrailing, ...inputProps },
  ref,
) {
  const reactId = useId();
  const inputId = id ?? `tf-${reactId}`;

  /**
   * AN EMAIL FIELD IS A LOWER-CASE FIELD.
   *
   * `users.email` is a plain unique column, so Omar@gmail.com and
   * omar@gmail.com were two different accounts. On 2026-10-10 that reached
   * customers: three people had ended up with two accounts each, and b2b
   * clients could not sign in with the address in their own welcome email.
   * They had typed a capital first letter — which is what a phone keyboard
   * offers unless it is told otherwise, hence autoCapitalize below.
   *
   * The API normalises too, and that is the guarantee; this is so the field
   * shows the person what will actually be stored instead of silently
   * changing it behind them.
   *
   * Assigning to `e.target.value` moves the caret to the end, so it is only
   * done when the text actually changes — typing in lower case, which is
   * nearly always, never triggers it. The selection APIs are not an option
   * here: Chrome throws on setSelectionRange for type="email".
   */
  const isEmail = inputProps.type === 'email';
  const forwardedChange = inputProps.onChange;
  const handleChange = isEmail
    ? (e: ChangeEvent<HTMLInputElement>) => {
        const lower = e.target.value.toLowerCase();
        if (e.target.value !== lower) e.target.value = lower;
        forwardedChange?.(e);
      }
    : forwardedChange;
  const describedBy = error ? `${inputId}-err` : hint ? `${inputId}-hint` : undefined;

  const ring = error
    ? 'border-danger focus:ring-danger/20 focus:border-danger'
    : success
      ? 'border-brand focus:ring-brand/30 focus:border-brand'
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
      <div className="relative">
        {leadingIcon && (
          <span
            className={`absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors ${
              error ? 'text-danger' : 'text-ink/40'
            }`}
          >
            {leadingIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={[
            'w-full h-12 bg-surface-cream border rounded-lg text-sm font-display text-ink',
            'focus:outline-none focus:ring-2 transition-colors placeholder:text-ink/40',
            leadingIcon ? 'pl-11' : 'pl-4',
            trailing ? 'pr-11' : 'pr-4',
            ring,
          ].join(' ')}
          {...(isEmail
            ? { autoCapitalize: 'none' as const, autoCorrect: 'off', spellCheck: false }
            : {})}
          {...inputProps}
          onChange={handleChange}
        />
        {trailing && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/40">
            {trailing}
          </span>
        )}
      </div>
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

export default TextField;
