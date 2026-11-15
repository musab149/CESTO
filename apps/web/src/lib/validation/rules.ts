// Reusable zod fragments built from a message bag. Forms compose these into
// per-form schemas. The bag is passed in (not imported) so a form can build
// its schema inside the component and re-render with localized messages
// when the user toggles language.

import { z } from 'zod';
import type { ValidationMessages } from './messages';

/** Spanish mobile: 9 digits, optional leading 6/7 (mobile) or 8/9 (landline). */
const PHONE_RE = /^[6-9]\d{8}$/;

/** Spanish postcode: 5 digits, leading 0 allowed (e.g. 08001 Barcelona). */
const POSTCODE_RE = /^\d{5}$/;

export interface PasswordRuleOpts {
  /** Minimum length. Server enforces 8. */
  min?: number;
  /** When true, require a mix of upper/lower/digit. */
  strong?: boolean;
}

export function rules(m: ValidationMessages) {
  return {
    /** Trimmed non-empty string. Use .min(1) under the hood so the required
        check fires before any other refinement. */
    required: (label?: string) =>
      z.string().trim().min(1, label ?? m.required),

    email: () =>
      z.string()
        .trim()
        .min(1, m.required)
        .email(m.email),

    password: ({ min = 8, strong = true }: PasswordRuleOpts = {}) => {
      const base = z.string().min(min, m.passwordMin(min));
      return strong
        ? base.refine(
            (pw) => /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw),
            { message: m.passwordWeak },
          )
        : base;
    },

    name: ({ min = 2, max = 80 }: { min?: number; max?: number } = {}) =>
      z.string()
        .trim()
        .min(min, m.nameMin(min))
        .max(max, m.nameMax(max)),

    /** Spanish phone, leading + optional country code stripped before check. */
    phoneEs: () =>
      z.string()
        .trim()
        .transform((v) => v.replace(/[\s-]/g, '').replace(/^\+34/, ''))
        .pipe(z.string().regex(PHONE_RE, m.phoneInvalid)),

    /** Phone but optional — empty string passes. */
    phoneEsOptional: () =>
      z.string()
        .trim()
        .transform((v) => v.replace(/[\s-]/g, '').replace(/^\+34/, ''))
        .refine((v) => v === '' || PHONE_RE.test(v), { message: m.phoneInvalid }),

    /**
     * International phone — 7 to 20 digits, optional leading `+`, allows
     * separators (spaces, dashes, parens, dots). Use for sign-up, delivery
     * addresses, contact forms, B2B forms — the default across the app.
     * Server does the authoritative check.
     */
    phoneIntl: () =>
      z.string()
        .trim()
        .transform((v) => v.replace(/[\s\-().]/g, ''))
        .pipe(z.string().regex(/^\+?\d{7,20}$/, m.phoneInvalidIntl)),

    /** International phone but optional — empty string passes. */
    phoneIntlOptional: () =>
      z.string()
        .trim()
        .transform((v) => v.replace(/[\s\-().]/g, ''))
        .refine((v) => v === '' || /^\+?\d{7,20}$/.test(v), { message: m.phoneInvalidIntl }),

    /** 5-digit Spanish postcode. */
    postcode: () =>
      z.string()
        .trim()
        .min(1, m.required)
        .regex(POSTCODE_RE, m.postcodeFormat),

    /** Generic short text with a max. */
    shortText: (max = 200) =>
      z.string()
        .trim()
        .min(1, m.required)
        .max(max, m.tooLong(max)),

    /** Long text (textarea) — non-empty with a max. */
    longText: (max = 2000) =>
      z.string()
        .trim()
        .min(1, m.required)
        .max(max, m.tooLong(max)),

    /** Optional long text. */
    optionalLongText: (max = 2000) =>
      z.string()
        .trim()
        .max(max, m.tooLong(max))
        .optional()
        .or(z.literal('')),

    /** Must be true — used for terms checkboxes. */
    mustBeTrue: (message?: string) =>
      z.literal(true, {
        errorMap: () => ({ message: message ?? m.termsRequired }),
      }),

    /** Optional absolute or relative URL. Empty string passes. */
    optionalUrl: () =>
      z.string()
        .trim()
        .refine(
          (v) => v === '' || /^(https?:\/\/|\/)/.test(v),
          { message: m.urlInvalid },
        )
        .optional()
        .or(z.literal('')),
  };
}

export type Rules = ReturnType<typeof rules>;
