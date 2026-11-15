// Reusable zod fragments — framework-agnostic, identical shape to the web
// app's rules so server-side validators only need to match one schema.

import { z } from 'zod';
import type { ValidationMessages } from './messages';

const PHONE_RE = /^[6-9]\d{8}$/;
const POSTCODE_RE = /^\d{5}$/;

export interface PasswordRuleOpts {
  min?: number;
  strong?: boolean;
}

export function rules(m: ValidationMessages) {
  return {
    required: (label?: string) =>
      z.string().trim().min(1, label ?? m.required),

    email: () =>
      z.string()
        .trim()
        .min(1, m.required)
        .email(m.email),

    password: ({ min = 8, strong = true }: PasswordRuleOpts = {}) => {
      const base = z.string().min(min, m.passwordMin(min));
      if (!strong) return base;
      return base.refine(
        (pw) => /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw),
        { message: m.passwordWeak },
      );
    },

    name: ({ min = 2, max = 80 }: { min?: number; max?: number } = {}) =>
      z.string()
        .trim()
        .min(min, m.nameMin(min))
        .max(max, m.nameMax(max)),

    phoneEs: () =>
      z.string()
        .trim()
        .transform((v) => v.replace(/[\s-]/g, '').replace(/^\+34/, ''))
        .pipe(z.string().regex(PHONE_RE, m.phoneInvalid)),

    phoneEsOptional: () =>
      z.string()
        .trim()
        .transform((v) => v.replace(/[\s-]/g, '').replace(/^\+34/, ''))
        .refine((v) => v === '' || PHONE_RE.test(v), { message: m.phoneInvalid }),

    /**
     * International phone — 7 to 20 digits, optional leading `+`, separators
     * stripped. Default across the app. Server does the authoritative check.
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

    postcode: () =>
      z.string()
        .trim()
        .min(1, m.required)
        .regex(POSTCODE_RE, m.postcodeFormat),

    shortText: (max = 200) =>
      z.string()
        .trim()
        .min(1, m.required)
        .max(max, m.tooLong(max)),

    longText: (max = 2000) =>
      z.string()
        .trim()
        .min(1, m.required)
        .max(max, m.tooLong(max)),

    optionalLongText: (max = 2000) =>
      z.string()
        .trim()
        .max(max, m.tooLong(max))
        .optional()
        .or(z.literal('')),

    // Boolean field that must be true. Uses z.boolean() instead of z.literal(true)
    // so the inferred type stays `boolean` — useful when the form interface
    // declares it as `boolean` rather than the `true` literal.
    mustBeTrue: (message?: string) =>
      z.boolean().refine((v) => v === true, {
        message: message ?? m.termsRequired,
      }),

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
