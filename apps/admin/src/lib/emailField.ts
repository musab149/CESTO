import type { ChangeEvent } from 'react';

/**
 * An email field is a lower-case field.
 *
 * `users.email` is a plain unique column, so Omar@gmail.com and
 * omar@gmail.com were two different accounts. On 2026-10-10 that reached
 * customers: three people had ended up with two accounts each, and b2b
 * clients could not sign in with the address in their own welcome email —
 * they had typed a capital first letter, which is what a phone keyboard
 * offers unless it is told otherwise.
 *
 * The API normalises as well, and THAT is the guarantee. This exists so the
 * field shows the person what will actually be stored, rather than changing
 * it behind them after they press the button.
 *
 * TextField and FormField already do this for anything built on them. These
 * two are for the inputs written by hand.
 */

/** Attributes that stop a keyboard or a spell-checker from editing an address. */
export const EMAIL_INPUT_PROPS = {
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: false,
} as const;

/**
 * Wrap a react-hook-form registration so the value is lower-cased as it is
 * typed. COMPOSES with its onChange rather than replacing it — an `onChange`
 * written after `{...register('email')}` silently takes over and the form
 * stops tracking the field.
 *
 * Assigning to `e.target.value` moves the caret to the end, so it is only
 * done when the text actually changes: typing in lower case never triggers
 * it. The selection APIs are not usable here, since Chrome throws on
 * setSelectionRange for type="email".
 */
export function lowercaseEmail<
  T extends { onChange: (e: ChangeEvent<HTMLInputElement>) => unknown },
>(registration: T): T {
  return {
    ...registration,
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      const lower = e.target.value.toLowerCase();
      if (e.target.value !== lower) e.target.value = lower;
      return registration.onChange(e);
    },
  };
}
