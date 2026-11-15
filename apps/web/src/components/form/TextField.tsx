import { forwardRef, useId, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  /** Lucide icon (or any node) rendered inside the input at the left. */
  leadingIcon?: ReactNode;
  /** Optional element rendered at the right (e.g. show-password button). */
  trailing?: ReactNode;
  /** Validation message — when present, ring + icon turn red. */
  error?: string;
  /** Sub-label shown under the field when there's no error. */
  hint?: string;
  /** Show a green check ring (e.g. confirm-password match). */
  success?: boolean;
}

/**
 * The base text field used across every customer-facing form. Matches the
 * existing design system exactly — 52px tall, rounded-xl, brand-mist focus
 * ring — so migrating a form is just swapping out the markup, no design
 * regression.
 */
const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, leadingIcon, trailing, error, hint, success, className, id, ...inputProps },
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

  const ringClasses = error
    ? 'border-danger focus:border-danger focus:ring-danger/20'
    : success
      ? 'border-brand focus:border-brand focus:ring-brand-mist'
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
      <div className="relative group">
        {leadingIcon && (
          <span
            className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors pointer-events-none ${
              error ? 'text-danger' : 'text-muted group-focus-within:text-brand'
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
            'w-full h-[52px] bg-surface-white border-2 rounded-xl text-[15px] text-ink font-ui',
            'focus:outline-none focus:ring-4 transition-all placeholder:text-muted',
            leadingIcon ? 'pl-12' : 'pl-4',
            trailing ? 'pr-12' : 'pr-4',
            ringClasses,
          ].join(' ')}
          {...(isEmail
            ? { autoCapitalize: 'none' as const, autoCorrect: 'off', spellCheck: false }
            : {})}
          {...inputProps}
          onChange={handleChange}
        />
        {trailing && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-muted">
            {trailing}
          </span>
        )}
      </div>
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
        <p
          id={`${inputId}-hint`}
          className="mt-1.5 text-[12px] text-muted font-body"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
});

export default TextField;
