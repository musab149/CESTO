import { api } from '../client';
import type { User, Address, PricingMode } from '../../types';

export interface AddressInput {
  contact_name: string;
  contact_phone: string;
  street_line_1: string;
  street_line_2?: string;
  postcode: string;
  city: string;
  province: string;
  delivery_notes?: string;
}

export const accountService = {
  me() {
    return api.get<User>('/api/users/me');
  },
  updateProfile(payload: { name?: string; email?: string }) {
    return api.put<User>('/api/users/me', payload);
  },
  /** Flip the storefront between retail and wholesale pricing. Server-side
   *  because order totals are computed from it; 403s if the account isn't an
   *  approved business. */
  setPricingMode(mode: PricingMode) {
    return api.patch<{ pricing_mode: PricingMode; is_business: boolean }>(
      '/api/users/me/pricing-mode',
      { mode },
    );
  },
  updateAvatar(avatarUrl: string) {
    return api.post<{ id: string; avatar_url: string }>('/api/users/me/avatar', { avatar_url: avatarUrl });
  },
  deleteAccount() {
    return api.delete<{ message: string }>('/api/users/me');
  },
  saveFcmToken(token: string, platform: 'web' | 'ios' | 'android') {
    return api.post<{ message: string }>('/api/users/fcm-token', { token, platform });
  },
  /** Clears the stored token so the backend stops sending to this device.
   *  The endpoint has existed since push shipped; nothing called it, which is
   *  why turning notifications off never actually stopped them. */
  deleteFcmToken() {
    return api.delete<{ message: string }>('/api/users/fcm-token');
  },
};

export const addressesService = {
  list() {
    return api.get<Address[]>('/api/users/addresses');
  },
  create(input: AddressInput) {
    return api.post<Address>('/api/users/addresses', input);
  },
  update(id: string, input: AddressInput) {
    return api.put<Address>(`/api/users/addresses/${id}`, input);
  },
  remove(id: string) {
    return api.delete<{ message: string }>(`/api/users/addresses/${id}`);
  },
  setDefault(id: string) {
    return api.put<{ message: string }>(`/api/users/addresses/${id}/default`);
  },
};

// There is no zonesService. `/api/zones/check`, `/api/zones/postcodes` and
// `/api/delivery/slots` were removed with the coverage system — nothing
// decides whether an address is serviceable any more, because every one is.
