import { api } from '../client';
import { getTokenStorage } from '../storage';
import type { User } from '../../types';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  isNewUser?: boolean;
  /** True when the user's password was set by an admin (e.g. partner
   *  approval) and hasn't been rotated. Frontend forces the
   *  change-password screen after login. */
  must_change_password?: boolean;
}

export const authService = {
  sendOtp(phone: string, countryCode = '+34') {
    return api.post<{ message: string; phone: string }>('/api/auth/send-otp', { phone, countryCode }, { skipAuth: true });
  },

  async verifyOtp(phone: string, otp: string, countryCode = '+34') {
    const tokens = await api.post<AuthTokens>('/api/auth/verify-otp', { phone, otp, countryCode }, { skipAuth: true });
    await getTokenStorage().setTokens(tokens.accessToken, tokens.refreshToken);
    return tokens;
  },

  async registerEmail(name: string, email: string, password: string) {
    const tokens = await api.post<AuthTokens>('/api/auth/register-email', { name, email, password }, { skipAuth: true });
    await getTokenStorage().setTokens(tokens.accessToken, tokens.refreshToken);
    return tokens;
  },

  async loginEmail(email: string, password: string) {
    const tokens = await api.post<AuthTokens>('/api/auth/login-email', { email, password }, { skipAuth: true });
    await getTokenStorage().setTokens(tokens.accessToken, tokens.refreshToken);
    return tokens;
  },

  async googleSignIn(accessToken: string) {
    const tokens = await api.post<AuthTokens>('/api/auth/google', { accessToken }, { skipAuth: true });
    await getTokenStorage().setTokens(tokens.accessToken, tokens.refreshToken);
    return tokens;
  },

  forgotPassword(email: string) {
    return api.post<{ message: string }>('/api/auth/forgot-password', { email }, { skipAuth: true });
  },

  changePassword(currentPassword: string, newPassword: string) {
    return api.post<{ message: string }>('/api/auth/change-password', { currentPassword, newPassword });
  },

  resetPassword(token: string, newPassword: string) {
    return api.post<{ message: string }>('/api/auth/reset-password', { token, newPassword }, { skipAuth: true });
  },

  async logout() {
    try { await api.post<{ message: string }>('/api/auth/logout'); } catch { /* network errors shouldn't block local logout */ }
    await getTokenStorage().clear();
  },

  completeProfile(name: string, email?: string) {
    return api.put<User>('/api/auth/complete-profile', { name, email });
  },

  me() {
    return api.get<User>('/api/users/me');
  },
};
