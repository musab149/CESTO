// Reusable zod fragments built from a message bag. Same shape as the web +
// mobile rules.ts so schemas authored against one work everywhere.

import { z } from 'zod';
import type { ValidationMessages } from './messages';

const PHONE_RE    = /^[6-9]\d{8}$/;
const POSTCODE_RE = /^\d{5}$/;
const HEX_RE      = /^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;
const SLUG_RE     = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export interface PasswordRuleOpts {
  min?: number;
  strong?: boolean;
}

export function rules(m: ValidationMessages) {
  return {
    required: (label?: string) =>
      z.string().trim().min(1, label ?? m.required),

    email: () =>
      z.string().trim().min(1, m.required).email(m.email),

    password: ({ min = 8, strong = true }: PasswordRuleOpts = {}) => {
      const base = z.string().min(min, m.passwordMin(min));
      if (!strong) return base;
      return base.refine(
        (pw) => /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw),
        { message: m.passwordWeak },
      );
    },

    /** Trimmed text, fixed min/max length. */
    name: ({ min = 2, max = 100 }: { min?: number; max?: number } = {}) =>
      z.string().trim().min(min, m.nameMin(min)).max(max, m.nameMax(max)),

    /** Spanish phone — 9 digits, optional +34 prefix stripped. */
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
     * stripped. The default across the app. Server does the authoritative
     * check.
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

    /** 5-digit postcode (string). */
    postcode: () =>
      z.string().trim().min(1, m.required).regex(POSTCODE_RE, m.postcodeFormat),

    /** Optional URL — empty passes, otherwise must look URL-shaped. */
    optionalUrl: () =>
      z.string()
        .trim()
        .refine((v) => v === '' || /^(https?:\/\/|\/)/.test(v), { message: m.urlInvalid }),

    /** Required URL. */
    url: () =>
      z.string()
        .trim()
        .min(1, m.required)
        .refine((v) => /^(https?:\/\/|\/)/.test(v), { message: m.urlInvalid }),

    /** Hex colour with optional alpha. */
    optionalHexColor: () =>
      z.string()
        .trim()
        .refine((v) => v === '' || HEX_RE.test(v), { message: m.hexColor }),

    /** kebab-case slug. */
    slug: () =>
      z.string().trim().min(1, m.required).regex(SLUG_RE, m.slug),

    /** Generic short text capped at max. */
    shortText: (max = 200) =>
      z.string().trim().min(1, m.required).max(max, m.tooLong(max)),

    /** Optional short text — empty passes, max enforced. */
    optionalShortText: (max = 200) =>
      z.string().trim().max(max, m.tooLong(max)),

    /** Required long text. */
    longText: (max = 4000) =>
      z.string().trim().min(1, m.required).max(max, m.tooLong(max)),

    /** Optional long text. */
    optionalLongText: (max = 4000) =>
      z.string().trim().max(max, m.tooLong(max)),

    /** Positive integer in string form (HTML number input emits string). */
    positiveInt: () =>
      z.coerce.number().int().nonnegative(m.positive),

    /** Decimal price ≥ 0. */
    money: () =>
      z.coerce.number().nonnegative(m.positive),
  };
}

export type Rules = ReturnType<typeof rules>;
