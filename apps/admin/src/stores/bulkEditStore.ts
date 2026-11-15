import { create } from 'zustand';
import type { AdminBulkActionPayload, AdminProductsListParams } from '@grocery-app/shared';

export type BulkSelectionFilter = NonNullable<AdminBulkActionPayload['filter']>;

export interface BulkEditSelection {
  /** 'ids' = the admin ticked specific rows. 'filter' = select-all-matching. */
  mode: 'ids' | 'filter';
  ids: string[];
  filter: BulkSelectionFilter;
  /** Total matching the filter — what the header count showed. */
  matchedTotal: number;
  /** Products page URL (path + query) to return to after saving. */
  returnTo: string;
}

interface BulkEditState {
  selection: BulkEditSelection | null;
  setSelection: (s: BulkEditSelection) => void;
  clear: () => void;
}

/**
 * Hands the selection from the products table to the bulk-edit page.
 *
 * Not a URL param (250 UUIDs blows past a sane URL length) and not router
 * state (lost on refresh). The bulk page redirects back to /products when
 * this is empty, so a hard refresh degrades gracefully instead of crashing.
 */
export const useBulkEditStore = create<BulkEditState>((set) => ({
  selection: null,
  setSelection: (selection) => set({ selection }),
  clear: () => set({ selection: null }),
}));

/** Strip list-only params so a filter can be sent to the bulk endpoints. */
export function toSelectionFilter(params: AdminProductsListParams): BulkSelectionFilter {
  const filter = { ...params } as AdminProductsListParams;
  delete filter.sort;
  delete filter.page;
  delete filter.limit;
  delete filter.full;
  delete filter.ids;
  return filter;
}
