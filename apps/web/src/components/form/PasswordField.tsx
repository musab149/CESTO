import { forwardRef, useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';
import TextField, { type TextFieldProps } from './TextField';

export interface PasswordFieldProps extends Omit<TextFieldProps, 'leadingIcon' | 'trailing' | 'type'> {
  /** Hide the lock icon (e.g. when the field lives in a narrower layout). */
  hideLockIcon?: boolean;
}

/** Password input with show/hide eye toggle. Otherwise identical to TextField. */
const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { hideLockIcon, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      ref={ref}
      type={visible ? 'text' : 'password'}
      leadingIcon={hideLockIcon ? undefined : <Lock size={18} strokeWidth={1.75} />}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          tabIndex={-1}
          className="text-muted hover:text-ink transition-colors p-1"
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      }
      {...props}
    />
  );
});

export default PasswordField;
