import { z } from 'zod';

export const sendOtpSchema = z.object({
  phone: z.string().min(6).max(15),
  countryCode: z.string().default('+34'),
});

export const verifyOtpSchema = z.object({
  phone: z.string().min(6).max(15),
  countryCode: z.string().default('+34'),
  otp: z.string().length(6),
});

export const registerEmailSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/, 'Must contain at least one uppercase letter').regex(/[0-9]/, 'Must contain at least one number'),
});

export const loginEmailSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const completeProfileSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8)
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
});

export const googleSignInSchema = z.object({
  accessToken: z.string().min(20),
});

export const appleSignInSchema = z.object({
  identityToken: z.string().min(20).max(8000),
  /** The raw nonce; Apple signed its SHA-256 into the identity token. */
  nonce: z.string().min(16).max(128),
  // Apple shares the name only on the very first authorization, so these are
  // optional and only ever used to name a newly created account.
  givenName: z.string().trim().max(80).optional(),
  familyName: z.string().trim().max(80).optional(),
  /** One-time code the server trades for a refresh token, kept so the
   *  sign-in can be revoked when the account is deleted. Optional: builds
   *  from before it was sent still sign in. */
  authorizationCode: z.string().min(10).max(2000).optional(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(32),
  newPassword: z
    .string()
    .min(8)
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
});
