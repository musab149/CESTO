import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminAuth, adminDashboard, adminOrders, adminProducts,
  adminCategories, adminBanners, adminRiders, adminUsers,
  adminSettings, type StoreSettings,
  adminInvoices, adminInvoicingSettings, adminStaff, adminSalesReps, adminDocuments,
} from './services/admin';
import {
  storesService,
  type AdminStoresListParams,
  type StoreWritePayload,
  type ScheduleStoreDeletionPayload,
  type PermanentDeleteStorePayload,
  type AdminLinkPartnerPayload,
} from './services/stores';
import {
  adminBrands, adminOrigins,
  type BrandWritePayload, type OriginWritePayload,
} from './services/brandsOrigins';
import {
  adminNotifications,
  type NotificationListParams,
  type BroadcastPayload,
} from './services/notifications';
import type { DashboardRange } from './services/admin';
import type { AdminSalesRepRow, Paged } from './services/admin';
import type { OrderStatus, CategoryApprovalStatus, EditOrderRequest, ProductAudience } from '../types';

// ─── Auth ───────────────────────────────────────────────

export const useAdminLogin = () =>
  useMutation({ mutationFn: ({ email, password }: { email: string; password: string }) => adminAuth.login(email, password) });

export const useAdminMe = () =>
  useQuery({ queryKey: ['admin-me'], queryFn: () => adminAuth.me() });

export const useAdminLogout = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => adminAuth.logout(), onSuccess: () => qc.clear() });
};

// ─── Dashboard ──────────────────────────────────────────

export const useAdminStats = (params: { range?: DashboardRange } = {}) =>
  useQuery({
    queryKey: ['admin-stats', params.range ?? 'today'],
    queryFn: () => adminDashboard.stats(params),
  });

export const useAdminRecentOrders = () =>
  useQuery({ queryKey: ['admin-recent-orders'], queryFn: () => adminDashboard.recentOrders() });

// ─── Orders ─────────────────────────────────────────────

export const useAdminOrders = (params: Parameters<typeof adminOrders.list>[0] = {}) =>
  useQuery({ queryKey: ['admin-orders', params], queryFn: () => adminOrders.list(params) });

/**
 * One row per customer purchase rather than per Order row — see AdminOrderGroup.
 *
 * Keyed UNDER 'admin-orders' on purpose: every order mutation below already
 * invalidates that prefix, so a status change or a delete refreshes the
 * grouped list too. A sibling key would have to be added to five call sites
 * and would be silently missed by the sixth.
 */
export const useAdminOrderGroups = (params: Parameters<typeof adminOrders.listGrouped>[0] = {}) =>
  useQuery({ queryKey: ['admin-orders', 'grouped', params], queryFn: () => adminOrders.listGrouped(params) });

export const useAdminOrder = (id: string | undefined) =>
  useQuery({ queryKey: ['admin-order', id], queryFn: () => adminOrders.get(id!), enabled: !!id });
/**
 * The same order, for the screen that EDITS it.
 *
 * A separate key with `gcTime: 0`, and the two words matter together. The
 * order builder reads the basket ONCE, into a useState initialiser, because a
 * refetch mid-edit would redefine "unchanged" and swallow the rep's work. That
 * freeze is only safe if what it freezes is current — and the shared key
 * serves whatever is in the cache the instant the screen mounts, refetching
 * behind it. Opening the editor on a cached payload from before the last save
 * seeds it with the OLD basket: the discount somebody just applied is simply
 * not in the field, and the diff is then measured against a past that no
 * longer exists.
 *
 * Dropping the entry the moment the editor unmounts means the next open has
 * nothing to serve, so the gate shows its skeleton and hands the builder a
 * payload that was fetched for this mount. Invalidation from a save still
 * matches this key by prefix and refreshes it, which is harmless: the builder
 * owns its state by then and the gate does not unmount it.
 */
export const useAdminOrderForEdit = (id: string | undefined) =>
  useQuery({
    queryKey: ['admin-order', id, 'for-edit'],
    queryFn: () => adminOrders.get(id!),
    enabled: !!id,
    gcTime: 0,
  });

export const useUpdateOrderStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reason, progressKey }: { id: string; status: OrderStatus; reason?: string; progressKey?: string }) =>
      adminOrders.setStatus(id, status, reason, progressKey),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
      qc.invalidateQueries({ queryKey: ['admin-order', v.id] });
    },
  });
};

export const useAssignRider = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, riderId }: { id: string; riderId: string | null }) => adminOrders.assignRider(id, riderId),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['admin-order', v.id] }),
  });
};

export const useUpdateOrderNotes = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, adminNotes }: { id: string; adminNotes: string }) => adminOrders.updateNotes(id, adminNotes),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['admin-order', v.id] }),
  });
};

export const useConfirmDraftStock = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminOrders.confirmStock(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
      qc.invalidateQueries({ queryKey: ['admin-order', id] });
    },
  });
};

export const useDeleteOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => adminOrders.deleteOrder(id, reason),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
      qc.invalidateQueries({ queryKey: ['admin-order', v.id] });
      // Deleting an order changes revenue/order-count figures immediately —
      // invalidate the whole prefix so every range variant refetches.
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      qc.invalidateQueries({ queryKey: ['admin-recent-orders'] });
    },
  });
};

export const useCreateAdminOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    /** `idempotencyKey` describes the ATTEMPT, so it rides beside the payload. */
    mutationFn: ({ idempotencyKey, ...payload }: Parameters<typeof adminOrders.create>[0] & { idempotencyKey?: string }) =>
      adminOrders.create(payload, idempotencyKey),
    // Shows its own failure in place (see INLINE_ERRORS in hooks.ts): a 5xx
    // must not tear down a basket that is being built or edited.
    meta: { inlineErrors: true },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
      qc.invalidateQueries({ queryKey: ['admin-user', v.user_id] });
    },
  });
};

/** The buying price of an order's lines (admin only). */
export const useSetOrderItemCosts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items: Array<{ order_item_id: string; unit_cost: number }> }) =>
      adminOrders.setItemCosts(id, items),
    // The page this was saved from (a single order, or the purchase whose
    // parts it shows), and the products: a line's price above 0 becomes its
    // size's buying price too.
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin-order', v.id] });
      invalidateProductQueries(qc);
      // A rep's order's figures moved: their profile lists it to approve again.
      qc.invalidateQueries({ queryKey: [REP_EARNINGS_KEY] });
    },
  });
};

/**
 * Recargo de equivalencia on or off for one order (or its whole purchase),
 * 2026-11-04. The order's total moves, and so do its factura draft and the
 * purchase it belongs to.
 */
export const useSetOrderRecargo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => adminOrders.setRecargo(id, on),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
      qc.invalidateQueries({ queryKey: ['admin-order'] });
      qc.invalidateQueries({ queryKey: ['admin-invoices'] });
      qc.invalidateQueries({ queryKey: ['admin-invoice'] });
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] });
      void v;
    },
  });
};

export const useSetOrderDeliveryFee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deliveryFee }: { id: string; deliveryFee: number }) =>
      adminOrders.setDeliveryFee(id, deliveryFee),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
      qc.invalidateQueries({ queryKey: ['admin-order', v.id] });
      // A draft invoice tracks its order, so its totals move with this.
      qc.invalidateQueries({ queryKey: ['admin-invoices'] });
      // The fee is revenue, so the dashboard figures move too.
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] });
    },
  });
};

export const useEditOrderItems = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload, progressKey }: { id: string; payload: EditOrderRequest; progressKey?: string }) =>
      adminOrders.editItems(id, payload, progressKey),
    // Shows its own failure in place (see INLINE_ERRORS in hooks.ts): a 5xx
    // must not tear down a basket that is being built or edited.
    meta: { inlineErrors: true },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
      qc.invalidateQueries({ queryKey: ['admin-order', v.id] });
      // Editing items changes the order total — dashboard revenue figures
      // should reflect it, same reasoning as useDeleteOrder.
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
  });
};

// ─── Products ───────────────────────────────────────────

export const useAdminProducts = (params: Parameters<typeof adminProducts.list>[0] = {}) =>
  useQuery({ queryKey: ['admin-products', params], queryFn: () => adminProducts.list(params) });

export const useAdminProduct = (id: string | undefined) =>
  useQuery({ queryKey: ['admin-product', id], queryFn: () => adminProducts.get(id!), enabled: !!id });

export const useQuickCreateProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof adminProducts.quickCreate>[0]) =>
      adminProducts.quickCreate(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-products'] }),
  });
};

/** Who the shop shows a product to, set from the products table. */
export const useSetProductAudience = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, audience, b2bPrices }: { id: string; audience: ProductAudience; b2bPrices?: Array<{ variant_id: string; b2b_price: number }> }) =>
      adminProducts.setAudience(id, audience, b2bPrices),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      qc.invalidateQueries({ queryKey: ['admin-product', id] });
    },
  });
};

export const useMarkProductReviewed = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminProducts.markReviewed(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      qc.invalidateQueries({ queryKey: ['admin-product', id] });
    },
  });
};

export const useCreateProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof adminProducts.create>[0]) => adminProducts.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-products'] }),
  });
};

export const useUpdateProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof adminProducts.update>[1] }) =>
      adminProducts.update(id, payload),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      qc.invalidateQueries({ queryKey: ['admin-product', v.id] });
    },
  });
};

export const useDeleteProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, permanent }: { id: string; permanent?: boolean }) =>
      adminProducts.remove(id, { permanent }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-products'] }),
  });
};

/**
 * Nuclear-delete a product: erases it and every order that referenced it.
 * Invalidates both product list AND orders (dashboard/orders page) since
 * historical order rows disappear.
 */
export const usePurgeProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminProducts.purge(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] });
    },
  });
};

// ─── Bulk edit ──────────────────────────────────────────

function invalidateProductQueries(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['admin-products'] });
  qc.invalidateQueries({ queryKey: ['admin-products-full'] });
  // The order builder's catalogue. Its own key, so the line above misses it.
  qc.invalidateQueries({ queryKey: ['admin-products-full-infinite'] });
  qc.invalidateQueries({ queryKey: ['admin-product'] });
  qc.invalidateQueries({ queryKey: ['admin-dashboard'] });
}

/**
 * Rows for the bulk-edit grid. staleTime/gcTime are 0 on purpose: the grid
 * diffs edits against these values, so hydrating from a snapshot taken before
 * another admin's save would compute the diff against a stale baseline.
 */
export const useAdminProductsFull = (
  params: Parameters<typeof adminProducts.listFull>[0] = {},
  enabled = true,
) =>
  useQuery({
    queryKey: ['admin-products-full', params],
    queryFn: () => adminProducts.listFull(params),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });

/**
 * The same rows, a page at a time, for a list that scrolls rather than pages.
 *
 * The order builder shows the catalogue beside the basket, and a rep looking
 * for one product among thousands cannot be served a first page and left
 * there — "the first thirty that matched" is indistinguishable from "all that
 * matched" when there is no pager to prove otherwise.
 *
 * staleTime/gcTime are left at the defaults, unlike useAdminProductsFull: that
 * one feeds the bulk-edit grid, where a stale baseline would make one admin's
 * save compute its diff against another's. Nothing is edited from here.
 */
export const useAdminProductsFullInfinite = (
  params: Omit<Parameters<typeof adminProducts.listFull>[0], 'page'> = {},
  enabled = true,
) =>
  useInfiniteQuery({
    queryKey: ['admin-products-full-infinite', params],
    queryFn: ({ pageParam = 1 }) =>
      adminProducts.listFull({ ...params, page: pageParam as number }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    /**
     * Hold the last results while the next query runs.
     *
     * Changing a category changes the query key, so without this `data` goes
     * undefined for a beat: the grid empties, the footer count blanks, and
     * both snap back a moment later. Keeping the previous page means the old
     * products stay under the cursor until the new ones replace them, which
     * is the difference between a list updating and a list flickering.
     */
    placeholderData: (previous) => previous,
    enabled,
  });

// ─── SALES REPS ─────────────────────────────────────────

export const useAdminSalesReps = (
  params: Parameters<typeof adminSalesReps.list>[0] = {},
) => useQuery({
  queryKey: ['admin-sales-reps', params],
  queryFn: () => adminSalesReps.list(params),
});

export const useAdminSalesRep = (
  userId: string | undefined,
  params: Parameters<typeof adminSalesReps.get>[1] = {},
) => useQuery({
  queryKey: ['admin-sales-rep', userId, params],
  queryFn: () => adminSalesReps.get(userId!, params),
  enabled: !!userId,
});

// ─── A rep's products, assigned by hand (API lib/repStore, 2026-10-27) ───

const REP_PRODUCTS_KEY = 'admin-rep-products';

export const useAdminRepProducts = (
  userId: string | undefined,
  params: Parameters<typeof adminSalesReps.products>[1] = {},
) => useQuery({
  queryKey: [REP_PRODUCTS_KEY, userId, params],
  queryFn: () => adminSalesReps.products(userId!, params),
  enabled: !!userId,
  placeholderData: (previous) => previous,
});

/** The picker's results, a page at a time as the list is scrolled. */
export const useAdminRepProductSearch = (
  userId: string | undefined,
  params: Omit<Parameters<typeof adminSalesReps.searchProducts>[1], 'page'> = {},
  enabled = true,
) => useInfiniteQuery({
  queryKey: [REP_PRODUCTS_KEY, userId, 'search', params],
  queryFn: ({ pageParam = 1 }) => adminSalesReps.searchProducts(userId!, { ...params, page: pageParam as number }),
  initialPageParam: 1,
  getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  placeholderData: (previous) => previous,
  enabled: !!userId && enabled,
});

const useRepProductsChange = <A extends unknown[], R>(fn: (userId: string, ...args: A) => Promise<R>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, args }: { userId: string; args: A }) => fn(userId, ...args),
    onSuccess: async (_d, v) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [REP_PRODUCTS_KEY, v.userId] }),
        // The count rides on the profile and the reps list.
        qc.invalidateQueries({ queryKey: ['admin-sales-rep', v.userId] }),
        qc.invalidateQueries({ queryKey: ['admin-sales-reps'] }),
      ]);
    },
  });
};

export const useAssignRepProducts = () => useRepProductsChange((userId: string, ids: string[]) => adminSalesReps.assignProducts(userId, ids));
export const useUnassignRepProducts = () => useRepProductsChange((userId: string, ids: string[]) => adminSalesReps.unassignProducts(userId, ids));

// ─── A rep's earnings, order by order (API lib/repEarnings) ───

const REP_EARNINGS_KEY = 'admin-rep-earnings';

/** Their balance, its history, and their orders on the way to an earning. */
export const useAdminRepEarnings = (userId: string | undefined) => useQuery({
  queryKey: [REP_EARNINGS_KEY, userId],
  queryFn: () => adminSalesReps.earnings(userId!),
  enabled: !!userId,
});

/** One line of their history, opened. */
export const useAdminRepEarningEntry = (userId: string | undefined, entryId: string | null) => useQuery({
  queryKey: [REP_EARNINGS_KEY, userId, 'entry', entryId],
  queryFn: () => adminSalesReps.earningEntry(userId!, entryId!),
  enabled: !!userId && !!entryId,
});

const useRepLedgerChange = <V extends { userId: string }>(fn: (v: V) => Promise<unknown>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: [REP_EARNINGS_KEY, v.userId] }),
  });
};

export const useRecordRepPayout = () => useRepLedgerChange(
  ({ userId, ...body }: { userId: string; amount: number; paid_on?: string; note?: string | null }) => adminSalesReps.recordPayout(userId, body),
);
export const useVoidRepPayout = () => useRepLedgerChange(
  ({ userId, entryId, reason }: { userId: string; entryId: string; reason?: string | null }) => adminSalesReps.voidPayout(userId, entryId, reason),
);
export const useAddRepAdjustment = () => useRepLedgerChange(
  ({ userId, ...body }: { userId: string; amount: number; note: string }) => adminSalesReps.addAdjustment(userId, body),
);

/**
 * An order's earning: its expenses and own %, or its approval. The order page
 * and the rep's profile both show it, so both are refreshed.
 */
const useRepOrderEarningChange = <V extends { id: string }>(fn: (v: V) => Promise<unknown>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin-order', v.id] });
      qc.invalidateQueries({ queryKey: [REP_EARNINGS_KEY] });
    },
  });
};

export const useSetRepOrderEarning = () => useRepOrderEarningChange(
  ({ id, body }: { id: string; body: Parameters<typeof adminOrders.setRepEarning>[1] }) => adminOrders.setRepEarning(id, body),
);
export const useApproveRepOrderEarning = () => useRepOrderEarningChange(
  ({ id }: { id: string }) => adminOrders.approveRepEarning(id),
);

/**
 * Hire a rep.
 *
 * TWO THINGS HAPPEN HERE THAT DID NOT USED TO, both for one reason: an admin
 * hired a rep on production, watched the table not change, and refreshed the
 * browser to find out whether it had worked. It had. The row simply was not
 * on screen yet.
 *
 *   · The response IS the new row, so it goes straight into every cached
 *     list. No round trip, nothing to wait for, and the row is there in the
 *     same frame the dialog closes.
 *   · The refetch is AWAITED. React Query keeps the mutation pending until
 *     the promise returned from onSuccess settles, so the submit button's
 *     spinner now covers the refetch as well as the request. Firing it and
 *     returning immediately is what closed the dialog over a stale table —
 *     and three seconds of "nothing happened" is all it takes to send
 *     somebody to the reload button, which is the one action that hides the
 *     bug by fixing the symptom.
 */
export const useGrantSalesRep = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof adminSalesReps.grant>[0]) => adminSalesReps.grant(payload),
    onSuccess: async (row) => {
      qc.setQueriesData<Paged<AdminSalesRepRow>>(
        { queryKey: ['admin-sales-reps'] },
        (prev) => {
          if (!prev) return prev;
          // Re-granting a revoked rep returns a row that is already listed.
          // Replace it in place rather than showing the same person twice.
          const without = prev.items.filter((r) => r.user_id !== row.user_id);
          const existed = without.length !== prev.items.length;
          return {
            ...prev,
            items: [row, ...without],
            total: existed ? prev.total : prev.total + 1,
          };
        },
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin-sales-reps'] }),
        // Granting can CREATE the account, so the customer list is stale too —
        // the new rep is a User and belongs in it.
        qc.invalidateQueries({ queryKey: ['admin-users'] }),
      ]);
    },
  });
};

export const useUpdateSalesRep = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, ...payload }: Parameters<typeof adminSalesReps.update>[1] & { userId: string }) =>
      adminSalesReps.update(userId, payload),
    // Awaited for the same reason as the grant above: the confirm dialog
    // closes when this settles, and it should close onto the new status.
    onSuccess: async (_d, v) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin-sales-reps'] }),
        qc.invalidateQueries({ queryKey: ['admin-sales-rep', v.userId] }),
        // Their usual percentage: the earnings card shows it, and the orders
        // not approved yet follow it.
        qc.invalidateQueries({ queryKey: [REP_EARNINGS_KEY, v.userId] }),
        qc.invalidateQueries({ queryKey: ['admin-order'] }),
      ]);
    },
  });
};

/**
 * Re-issue a rep's login.
 *
 * Invalidates the rep AND the list: the row carries `account_status` and the
 * profile shows whether their password is still the temporary one, both of
 * which this changes.
 */
export const useResendSalesRepCredentials = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; sendEmail?: boolean }) =>
      adminSalesReps.resendCredentials(v.userId, v.sendEmail ?? true),
    onSuccess: async (_d, v) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin-sales-reps'] }),
        qc.invalidateQueries({ queryKey: ['admin-sales-rep', v.userId] }),
      ]);
    },
  });
};

export const useBulkUpdateProducts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: Parameters<typeof adminProducts.bulkUpdate>[0]) => adminProducts.bulkUpdate(items),
    onSuccess: () => invalidateProductQueries(qc),
  });
};

// ─── Staff (admin panel accounts) ───────────────────────

export const useAdminStaff = (params: Parameters<typeof adminStaff.list>[0] = {}) =>
  useQuery({ queryKey: ['admin-staff', params], queryFn: () => adminStaff.list(params) });

const invalidateStaff = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ queryKey: ['admin-staff'] });

export const useCreateStaff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof adminStaff.create>[0]) => adminStaff.create(payload),
    onSuccess: () => invalidateStaff(qc),
  });
};

export const useUpdateStaff = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Parameters<typeof adminStaff.update>[1] & { id: string }) =>
      adminStaff.update(id, payload),
    onSuccess: () => invalidateStaff(qc),
  });
};

export const useResetStaffPassword = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminStaff.resetPassword(id),
    onSuccess: () => invalidateStaff(qc),
  });
};

export const useBulkProductAction = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof adminProducts.bulkAction>[0]) => adminProducts.bulkAction(payload),
    onSuccess: () => invalidateProductQueries(qc),
  });
};

/** Groups of products sharing a normalised name — feeds the /duplicates page. */
export const useAdminProductDuplicates = () =>
  useQuery({
    queryKey: ['admin-product-duplicates'],
    queryFn:  () => adminProducts.listDuplicates(),
    // The list changes every time an admin creates or removes a product,
    // and there's no cheap way for the server to signal that. Keep it
    // fresh with a short refetch on window focus.
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

/** Bulk resolve duplicates — deactivates rows with orders, hard-deletes the rest. */
export const useResolveProductDuplicates = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof adminProducts.resolveDuplicates>[0]) =>
      adminProducts.resolveDuplicates(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-product-duplicates'] });
      qc.invalidateQueries({ queryKey: ['admin-products'] });
    },
  });
};

/** Merge variants from remove_ids INTO keep_id, then delete the empty
 *  shell products. Companion to useResolveProductDuplicates but for the
 *  case where the sheet mistakenly split one SKU across multiple rows
 *  (different sizes → separate products) and we want to consolidate. */
export const useMergeProductDuplicates = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof adminProducts.mergeDuplicates>[0]) =>
      adminProducts.mergeDuplicates(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-product-duplicates'] });
      qc.invalidateQueries({ queryKey: ['admin-products'] });
    },
  });
};

// ─── Import duplicates (staged rows) ───────────────────

/** Pending rows the Excel importer flagged as duplicates. Feeds the
 *  Duplicates page → "From Excel import" tab. */
export const useProductImportDuplicates = (status: Parameters<typeof adminProducts.listImportDuplicates>[0] = 'pending') =>
  useQuery({
    queryKey: ['admin-import-duplicates', status],
    queryFn:  () => adminProducts.listImportDuplicates(status),
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

/** Create the actual Product from a staged import-duplicate row. */
export const useCreateFromImportDuplicate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminProducts.createFromImportDuplicate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-import-duplicates'] });
      qc.invalidateQueries({ queryKey: ['admin-product-duplicates'] });
      qc.invalidateQueries({ queryKey: ['admin-products'] });
    },
  });
};

/** Soft-delete a staged import-duplicate row. */
export const useDismissImportDuplicate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminProducts.dismissImportDuplicate(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-import-duplicates'] });
    },
  });
};

/** Bulk soft-delete pending import-duplicate rows. Pass a subset of ids
 *  to target them; call with no argument (or an empty array) to dismiss
 *  every pending row. */
export const useDismissAllImportDuplicates = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => adminProducts.dismissAllImportDuplicates(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-import-duplicates'] });
    },
  });
};

export const useImportProducts = () => {
  return useMutation({
    mutationFn: (file: File) => adminProducts.importFromXlsx(file),
    // Note: no cache invalidation here — the mutation only ENQUEUES the job.
    // The polling hook (`useImportJob`) invalidates the admin-products list
    // when it sees the job transition to `done` with created > 0.
  });
};

/**
 * Poll a single import job until it reaches a terminal state. Interval
 * ramps down while queued/running (1s while active) and stops entirely once
 * done/failed/interrupted. Refreshes the admin-products list on transition
 * to `done` so newly-imported rows appear in the table without a manual
 * reload.
 */
export const useImportJob = (jobId: string | null | undefined) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['admin-import-job', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      const job = await adminProducts.getImportJob(jobId);
      // Freshly-done job with created rows — invalidate the list so the
      // Products page reflects the new inventory.
      if (job.status === 'done' && (job.result?.created ?? 0) > 0) {
        qc.invalidateQueries({ queryKey: ['admin-products'] });
      }
      return job;
    },
    enabled: !!jobId,
    // Poll every second while the job hasn't reached a terminal status. The
    // false return stops the interval; polling resumes when the next enqueue
    // sets a new jobId.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 1_000;
      if (data.status === 'queued' || data.status === 'running') return 1_000;
      return false;
    },
    // Don't cache stale terminal jobs across mounts — always fetch fresh.
    staleTime: 0,
  });
};

/** Recent import jobs for the signed-in admin. Powers a future "history" panel. */
export const useImportJobs = (limit = 10) =>
  useQuery({
    queryKey: ['admin-import-jobs', limit],
    queryFn: () => adminProducts.listImportJobs(limit),
  });

// ─── Categories + subs ──────────────────────────────────

export const useAdminCategories = () =>
  useQuery({ queryKey: ['admin-categories'], queryFn: () => adminCategories.list() });

export const useAdminSubcategories = () =>
  useQuery({ queryKey: ['admin-subcategories'], queryFn: () => adminCategories.listSubcategories() });

const invalidateCats = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['admin-categories'] });
  qc.invalidateQueries({ queryKey: ['admin-subcategories'] });
  qc.invalidateQueries({ queryKey: ['admin-pending-categories'] });
};

export const usePendingCategories = () =>
  useQuery({ queryKey: ['admin-pending-categories'], queryFn: () => adminCategories.listPending() });

export const useDismissPendingCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminCategories.dismissPending(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-pending-categories'] }),
  });
};

// ─── Pending products parked under a real Category ──
// `useCategoryPendingProducts` is lazily enabled by passing a categoryId only
// when the publish modal is open — keeps the categories table page cheap.

export const useCategoryPendingProducts = (categoryId: string | undefined) =>
  useQuery({
    queryKey: ['admin-category-pending-products', categoryId],
    queryFn: () => adminCategories.listPendingProducts(categoryId!),
    enabled: !!categoryId,
  });

export const usePublishPendingProducts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, ids, subcategoryId }: { categoryId: string; ids: string[]; subcategoryId?: string | null }) =>
      adminCategories.publishPendingProducts(categoryId, ids, subcategoryId),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin-category-pending-products', v.categoryId] });
      qc.invalidateQueries({ queryKey: ['admin-categories'] });
      qc.invalidateQueries({ queryKey: ['admin-products'] });
    },
  });
};

export const useDismissPendingProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminCategories.dismissPendingProduct(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-category-pending-products'] });
      qc.invalidateQueries({ queryKey: ['admin-categories'] });
    },
  });
};

export const useCreateCategory = () => { const qc = useQueryClient(); return useMutation({ mutationFn: adminCategories.create, onSuccess: () => invalidateCats(qc) }); };
export const useUpdateCategory = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof adminCategories.update>[1] }) => adminCategories.update(id, payload), onSuccess: () => invalidateCats(qc) }); };
export const useDeleteCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reassignTo }: { id: string; reassignTo?: string }) => adminCategories.remove(id, reassignTo),
    onSuccess: () => {
      invalidateCats(qc);
      qc.invalidateQueries({ queryKey: ['admin-products'] }); // products may have moved
    },
  });
};
export const useCreateSubcategory = () => { const qc = useQueryClient(); return useMutation({ mutationFn: adminCategories.createSubcategory, onSuccess: () => invalidateCats(qc) }); };
export const useUpdateSubcategory = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof adminCategories.updateSubcategory>[1] }) => adminCategories.updateSubcategory(id, payload), onSuccess: () => invalidateCats(qc) }); };
export const useDeleteSubcategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adminCategories.removeSubcategory,
    onSuccess: () => {
      invalidateCats(qc);
      qc.invalidateQueries({ queryKey: ['admin-products'] }); // products lose subcategory link
    },
  });
};

// ─── Partner category submissions (approval queue) ──────

export const usePartnerCategorySubmissions = (status: CategoryApprovalStatus = 'pending') =>
  useQuery({
    queryKey: ['admin-partner-category-submissions', status],
    queryFn: () => adminCategories.listPartnerSubmissions(status),
  });

export const useApproveCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch?: Parameters<typeof adminCategories.approve>[1] }) =>
      adminCategories.approve(id, patch),
    onSuccess: () => {
      invalidateCats(qc);
      qc.invalidateQueries({ queryKey: ['admin-partner-category-submissions'] });
    },
  });
};

export const useRejectCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminCategories.reject(id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-partner-category-submissions'] }),
  });
};

// ─── Banners ────────────────────────────────────────────

export const useAdminBanners = () => useQuery({ queryKey: ['admin-banners'], queryFn: () => adminBanners.list() });
export const useCreateBanner = () => { const qc = useQueryClient(); return useMutation({ mutationFn: adminBanners.create, onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-banners'] }) }); };
export const useUpdateBanner = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof adminBanners.update>[1] }) => adminBanners.update(id, payload), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-banners'] }) }); };
export const useDeleteBanner = () => { const qc = useQueryClient(); return useMutation({ mutationFn: adminBanners.remove, onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-banners'] }) }); };

// ─── Riders ─────────────────────────────────────────────

export const useAdminRiders = (activeOnly?: boolean) =>
  useQuery({ queryKey: ['admin-riders', activeOnly], queryFn: () => adminRiders.list(activeOnly) });

export const useRiderSubDeliveries = (id: string | undefined) =>
  useQuery({
    queryKey: ['admin-rider-sub-deliveries', id],
    queryFn: () => adminRiders.subscriptionDeliveries(id!),
    enabled: !!id,
  });

export const useCreateRider = () => { const qc = useQueryClient(); return useMutation({ mutationFn: adminRiders.create, onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-riders'] }) }); };
export const useUpdateRider = () => { const qc = useQueryClient(); return useMutation({ mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof adminRiders.update>[1] }) => adminRiders.update(id, payload), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-riders'] }) }); };
export const useDeleteRider = () => { const qc = useQueryClient(); return useMutation({ mutationFn: adminRiders.remove, onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-riders'] }) }); };

// ─── Users ──────────────────────────────────────────────

// ─── Invoices ───────────────────────────────────────────

// The archive reads frozen records, so what is open stays open behind a refresh:
// the previous page holds while the next one loads, rather than a blank list.
export const useAdminDocuments = (params: Parameters<typeof adminDocuments.list>[0]) =>
  useQuery({
    queryKey: ['admin-documents', params],
    queryFn: () => adminDocuments.list(params),
    placeholderData: (previous) => previous,
  });

export const useAdminIssuedDocument = (id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ['admin-document', id],
    queryFn: () => adminDocuments.issued(id!),
    enabled: !!id && enabled,
  });

export const useAdminBillDocument = (id: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ['admin-document-bill', id],
    queryFn: () => adminDocuments.bill(id!),
    enabled: !!id && enabled,
  });

export const useAdminInvoices = (params: Parameters<typeof adminInvoices.list>[0] = {}) =>
  useQuery({ queryKey: ['admin-invoices', params], queryFn: () => adminInvoices.list(params) });

export const useAdminInvoice = (id: string | undefined) =>
  useQuery({
    queryKey: ['admin-invoice', id],
    queryFn: () => adminInvoices.get(id!),
    enabled: !!id,
  });

/** Idempotent: pressing it twice lands on the same draft. */
export const useCreateInvoiceForOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { orderId: string; kind?: 'albaran' | 'invoice' }) =>
      adminInvoices.createForOrder(v.orderId, v.kind),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin-invoices'] });
      // Converting a draft's kind changes the document this page is showing.
      qc.invalidateQueries({ queryKey: ['admin-invoice'] });
      qc.invalidateQueries({ queryKey: ['admin-order', v.orderId] });
    },
  });
};

export const useUpdateInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Parameters<typeof adminInvoices.update>[1] & { id: string }) =>
      adminInvoices.update(id, payload),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['admin-invoice', v.id] }),
  });
};

/** One-way door. The UI confirms before calling this. */
export const useIssueInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminInvoices.issue(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['admin-invoice', id] });
      qc.invalidateQueries({ queryKey: ['admin-invoices'] });
    },
  });
};

export const useDeleteInvoice = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminInvoices.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-invoices'] }),
  });
};

export const useInvoicingSettings = () =>
  useQuery({ queryKey: ['admin-invoicing-settings'], queryFn: () => adminInvoicingSettings.get() });

export const useUpdateInvoicingSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof adminInvoicingSettings.update>[0]) =>
      adminInvoicingSettings.update(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-invoicing-settings'] }),
  });
};

export const useAdminUsers = (
  params: Parameters<typeof adminUsers.list>[0] = {},
  // `enabled` so a caller can hold the request back — a user search inside a
  // dialog tab nobody has opened is a request nobody asked for.
  opts: { enabled?: boolean } = {},
) => useQuery({
  queryKey: ['admin-users', params],
  queryFn: () => adminUsers.list(params),
  enabled: opts.enabled ?? true,
});

export const useAdminUser = (id: string | undefined) =>
  useQuery({ queryKey: ['admin-user', id], queryFn: () => adminUsers.get(id!), enabled: !!id });

/**
 * Debounce-friendly availability check for the client form.
 *
 * `enabled` is the caller's gate — pass false until the field looks complete,
 * so this does not fire on every keystroke of a half-typed address.
 */
export const useAdminUserLookup = (
  params: { email?: string; phone?: string },
  enabled: boolean,
) => useQuery({
  queryKey: ['admin-user-lookup', params],
  queryFn: () => adminUsers.lookup(params),
  enabled,
  staleTime: 30_000,
  retry: false,
});

export const useCreateAdminClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof adminUsers.createClient>[0]) =>
      adminUsers.createClient(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
};

export const useUpdateAdminUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Parameters<typeof adminUsers.update>[1] & { id: string }) =>
      adminUsers.update(id, payload),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-user', v.id] });
    },
  });
};

export const useCreateAdminUserAddress = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Parameters<typeof adminUsers.createAddress>[1] & { id: string }) =>
      adminUsers.createAddress(id, payload),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: ['admin-user', v.id] }),
  });
};

/** Rotates the client's password and re-sends it. The old one stops working,
 *  so this is behind a confirmation in the UI. */
/**
 * Issue a customer a new password.
 *
 * Invalidates the customer: the row carries `password_is_temp`, which this
 * sets, and a detail page still showing the old state would say they had
 * logged in when the rotation has just signed them out everywhere.
 */
export const useResendClientCredentials = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; sendEmail?: boolean }) =>
      adminUsers.resendCredentials(v.id, v.sendEmail ?? true),
    onSuccess: async (_d, v) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin-user', v.id] }),
        qc.invalidateQueries({ queryKey: ['admin-users'] }),
      ]);
    },
  });
};

export const useSetUserStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: 'active' | 'blocked'; reason?: string }) =>
      adminUsers.setStatus(id, status, reason),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-user', v.id] });
    },
  });
};

export const useEraseUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminUsers.erase(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-user', id] });
    },
  });
};

// ─── Rashan (admin) ────────────────────────────────────

import {
  adminRashan,
  type AdminPackPayload,
  type AdminPackOwner,
  type AdminUpdateSubPayload,
  type RashanSubStatus,
  type SubDeliveryStatus,
} from './services/rashan';

const invalidateRashanPacks = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['admin-rashan-packs'] });
  qc.invalidateQueries({ queryKey: ['rashan-packs'] });      // customer rail
  qc.invalidateQueries({ queryKey: ['store-rashan-packs'] }); // storefront tab
};

export const useAdminRashanPacks = (params: { owner?: AdminPackOwner } = {}) =>
  useQuery({
    queryKey: ['admin-rashan-packs', params],
    queryFn: () => adminRashan.listPacks(params),
  });

// Partner packs publish instantly, so moderation is a takedown after the
// fact. Both mutations clear the customer caches too — a pack blocked in one
// tab must not stay live in another.
export const useBlockRashanPack = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminRashan.blockPack(id, reason),
    onSuccess: () => invalidateRashanPacks(qc),
  });
};

export const useUnblockRashanPack = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminRashan.unblockPack(id),
    onSuccess: () => invalidateRashanPacks(qc),
  });
};

export const useAdminRashanPack = (id: string | undefined) =>
  useQuery({
    queryKey: ['admin-rashan-pack', id],
    queryFn: () => adminRashan.getPack(id!),
    enabled: !!id,
  });

export const useCreateRashanPack = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<AdminPackPayload>) => adminRashan.createPack(payload),
    onSuccess: () => invalidateRashanPacks(qc),
  });
};

export const useUpdateRashanPack = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<AdminPackPayload> }) =>
      adminRashan.updatePack(id, payload),
    onSuccess: () => invalidateRashanPacks(qc),
  });
};

export const useDeleteRashanPack = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminRashan.deletePack(id),
    onSuccess: () => invalidateRashanPacks(qc),
  });
};

export const useAdminSubscriptions = (params: { status?: RashanSubStatus; q?: string; page?: number; limit?: number } = {}) =>
  useQuery({
    queryKey: ['admin-rashan-subscriptions', params],
    queryFn: () => adminRashan.listSubscriptions(params),
  });

export const useAdminSubscription = (id: string | undefined) =>
  useQuery({
    queryKey: ['admin-rashan-subscription', id],
    queryFn: () => adminRashan.getSubscription(id!),
    enabled: !!id,
  });

export const useAdminSubsSummary = () =>
  useQuery({
    queryKey: ['admin-rashan-summary'],
    queryFn: () => adminRashan.summary(),
  });

export const useAdminUpdateSubscription = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: AdminUpdateSubPayload }) =>
      adminRashan.updateSubscription(id, payload),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['admin-rashan-subscriptions'] });
      qc.invalidateQueries({ queryKey: ['admin-rashan-subscription', vars.id] });
      qc.invalidateQueries({ queryKey: ['admin-rashan-summary'] });
    },
  });
};

export const useAdminDeliveries = (params: { status?: SubDeliveryStatus; from?: string; to?: string; q?: string; page?: number; limit?: number } = {}) =>
  useQuery({
    queryKey: ['admin-rashan-deliveries', params],
    queryFn: () => adminRashan.listDeliveries(params),
  });

export const useSetDeliveryStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, failureReason }: { id: string; status: SubDeliveryStatus; failureReason?: string }) =>
      adminRashan.setDeliveryStatus(id, status, failureReason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-rashan-deliveries'] });
      qc.invalidateQueries({ queryKey: ['admin-rashan-subscriptions'] });
    },
  });
};

export const useAssignSubDeliveryRider = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, riderId }: { id: string; riderId: string | null }) =>
      adminRashan.assignDeliveryRider(id, riderId),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['admin-rashan-deliveries'] });
      qc.invalidateQueries({ queryKey: ['admin-rashan-subscription', updated.subscription_id] });
      qc.invalidateQueries({ queryKey: ['admin-rashan-subscriptions'] });
    },
  });
};


// ─── B2B Leads (admin) ─────────────────────────────────

import {
  adminLeads,
  type B2bLead,
  type ListLeadsParams,
  type ListLeadsResponse,
  type PatchLeadPayload,
  type ApprovePartnerPayload,
  type ApproveBusinessPayload,
  type RequestPartnerInfoPayload,
  type RejectPartnerPayload,
} from './services/leads';

const LEADS_KEY = ['admin-leads'] as const;

export const useAdminLeads = (params: ListLeadsParams = {}) =>
  useQuery<ListLeadsResponse>({
    queryKey: [...LEADS_KEY, params],
    queryFn: () => adminLeads.list(params),
  });

export const useAdminLead = (id: string | null | undefined) =>
  useQuery<B2bLead>({
    queryKey: [...LEADS_KEY, 'detail', id],
    queryFn: () => adminLeads.get(id as string),
    enabled: !!id,
  });

export const useUpdateAdminLead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PatchLeadPayload }) =>
      adminLeads.update(id, payload),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: LEADS_KEY });
      qc.invalidateQueries({ queryKey: [...LEADS_KEY, 'detail', vars.id] });
    },
  });
};

// ─── MV Slice 1 · partner approval mutations ─────────────
// All three invalidate the lead list + detail so the UI reflects the new
// approval_status immediately. Server-side gate is MV_PARTNER_APPROVAL —
// admin bundle should also hide the buttons via VITE_MV_PARTNER_APPROVAL.

function invalidateLeadCaches(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: LEADS_KEY });
  qc.invalidateQueries({ queryKey: [...LEADS_KEY, 'detail', id] });
  // Approval creates a Store + PartnerUser — refresh admin store lists too.
  qc.invalidateQueries({ queryKey: ['admin-stores'] });
  // And a User, which is what the approved lead BECOMES. The B2B tab shows
  // open leads and wholesale accounts in one table, so without this the lead
  // vanishes and the client it turned into does not arrive until a reload.
  qc.invalidateQueries({ queryKey: ['admin-users'] });
  qc.invalidateQueries({ queryKey: ['admin-user'] });
}

export const useApprovePartner = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ApprovePartnerPayload }) =>
      adminLeads.approve(id, payload),
    onSuccess: (_data, vars) => invalidateLeadCaches(qc, vars.id),
  });
};

/** B2B business approval — creates a User + BusinessProfile, no store. */
export const useApproveBusiness = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ApproveBusinessPayload }) =>
      adminLeads.approveBusiness(id, payload),
    onSuccess: (_data, vars) => invalidateLeadCaches(qc, vars.id),
  });
};

export const useRequestPartnerInfo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: RequestPartnerInfoPayload }) =>
      adminLeads.requestInfo(id, payload),
    onSuccess: (_data, vars) => invalidateLeadCaches(qc, vars.id),
  });
};

export const useRejectPartner = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: RejectPartnerPayload }) =>
      adminLeads.reject(id, payload),
    onSuccess: (_data, vars) => invalidateLeadCaches(qc, vars.id),
  });
};

// ─── Rashan leads (admin) ──────────────────────────────

import {
  adminRashanLeads,
  type RashanLead,
  type ListRashanLeadsParams,
  type ListRashanLeadsResponse,
  type PatchRashanLeadPayload,
  type ApproveRashanLeadPayload,
} from './services/rashanLeads';

const RASHAN_LEADS_KEY = ['admin-rashan-leads'] as const;

export const useAdminRashanLeads = (params: ListRashanLeadsParams = {}) =>
  useQuery<ListRashanLeadsResponse>({
    queryKey: [...RASHAN_LEADS_KEY, params],
    queryFn: () => adminRashanLeads.list(params),
  });

export const useAdminRashanLead = (id: string | null | undefined) =>
  useQuery<RashanLead>({
    queryKey: [...RASHAN_LEADS_KEY, 'detail', id],
    queryFn: () => adminRashanLeads.get(id as string),
    enabled: !!id,
  });

export const useUpdateAdminRashanLead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PatchRashanLeadPayload }) =>
      adminRashanLeads.update(id, payload),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: RASHAN_LEADS_KEY });
      qc.invalidateQueries({ queryKey: [...RASHAN_LEADS_KEY, 'detail', vars.id] });
    },
  });
};

/**
 * A decision moves a row from the request half of the Home Grocery tab to
 * the subscriber half — so the user lists refresh too, or the request
 * vanishes and the subscriber it became only arrives on reload. Same reason
 * invalidateLeadCaches refreshes them for B2B.
 */
function invalidateHomeGroceryCaches(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: RASHAN_LEADS_KEY });
  qc.invalidateQueries({ queryKey: ['admin-users'] });
  qc.invalidateQueries({ queryKey: ['admin-user'] });
}

export const useApproveRashanLead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ApproveRashanLeadPayload }) =>
      adminRashanLeads.approve(id, payload),
    onSuccess: () => invalidateHomeGroceryCaches(qc),
  });
};

export const useRejectRashanLead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminRashanLeads.reject(id, reason),
    onSuccess: () => invalidateHomeGroceryCaches(qc),
  });
};

// ─── Help Center (admin) ───────────────────────────────

import {
  adminHelpCenter,
  type AdminHelpCategoryPayload,
  type AdminHelpArticlePayload,
} from './services/helpCenter';

const HC_CATS = ['admin-help-categories'] as const;
const HC_ARTS = ['admin-help-articles'] as const;

const invalidateHC = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: HC_CATS });
  qc.invalidateQueries({ queryKey: HC_ARTS });
  qc.invalidateQueries({ queryKey: ['help-center'] });
  qc.invalidateQueries({ queryKey: ['help-article'] });
};

export const useAdminHelpCategories = () =>
  useQuery({ queryKey: HC_CATS, queryFn: () => adminHelpCenter.listCategories() });

export const useCreateHelpCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdminHelpCategoryPayload) => adminHelpCenter.createCategory(payload),
    onSuccess: () => invalidateHC(qc),
  });
};

export const useUpdateHelpCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: AdminHelpCategoryPayload }) =>
      adminHelpCenter.updateCategory(id, payload),
    onSuccess: () => invalidateHC(qc),
  });
};

export const useDeleteHelpCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminHelpCenter.deleteCategory(id),
    onSuccess: () => invalidateHC(qc),
  });
};

export const useAdminHelpArticles = (params: { categoryId?: string } = {}) =>
  useQuery({ queryKey: [...HC_ARTS, params], queryFn: () => adminHelpCenter.listArticles(params) });

export const useAdminHelpArticle = (id: string | undefined) =>
  useQuery({
    queryKey: [...HC_ARTS, 'detail', id],
    queryFn: () => adminHelpCenter.getArticle(id!),
    enabled: !!id,
  });

export const useCreateHelpArticle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdminHelpArticlePayload) => adminHelpCenter.createArticle(payload),
    onSuccess: () => invalidateHC(qc),
  });
};

export const useUpdateHelpArticle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: AdminHelpArticlePayload }) =>
      adminHelpCenter.updateArticle(id, payload),
    onSuccess: () => invalidateHC(qc),
  });
};

export const useDeleteHelpArticle = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminHelpCenter.deleteArticle(id),
    onSuccess: () => invalidateHC(qc),
  });
};

// ─── Support tickets (admin) ───────────────────────────

import {
  adminSupport,
  type ListTicketsParams,
  type ListTicketsResponse,
  type PatchTicketPayload,
  type SupportTicket,
} from './services/support';

const SUPPORT_KEY = ['admin-support'] as const;

export const useAdminSupportTickets = (params: ListTicketsParams = {}) =>
  useQuery<ListTicketsResponse>({
    queryKey: [...SUPPORT_KEY, params],
    queryFn: () => adminSupport.list(params),
  });

export const useAdminSupportTicket = (id: string | null | undefined) =>
  useQuery<SupportTicket>({
    queryKey: [...SUPPORT_KEY, 'detail', id],
    queryFn: () => adminSupport.get(id as string),
    enabled: !!id,
  });

export const useUpdateAdminSupportTicket = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PatchTicketPayload }) =>
      adminSupport.update(id, payload),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: SUPPORT_KEY });
      qc.invalidateQueries({ queryKey: [...SUPPORT_KEY, 'detail', vars.id] });
    },
  });
};

// ─── Notifications ──────────────────────────────────────

const ADMIN_NOTIFICATIONS_KEY = ['admin-notifications'] as const;

export const useAdminNotifications = (
  params: NotificationListParams = {},
  opts?: { refetchInterval?: number },
) =>
  useQuery({
    queryKey: [...ADMIN_NOTIFICATIONS_KEY, params],
    queryFn: () => adminNotifications.list(params),
    // Admin needs new-order pings to feel immediate — support/ops watches
    // this while running the operation.
    refetchInterval: opts?.refetchInterval ?? 20_000,
    refetchOnWindowFocus: true,
  });

export const useAdminUnreadNotificationCount = (opts?: { refetchInterval?: number }) =>
  useQuery({
    queryKey: [...ADMIN_NOTIFICATIONS_KEY, 'unread-count'],
    queryFn: () => adminNotifications.unreadCount(),
    refetchInterval: opts?.refetchInterval ?? 10_000,
    refetchOnWindowFocus: true,
  });

const invalidateAdminNotifications = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ADMIN_NOTIFICATIONS_KEY });
};

export const useMarkAdminNotificationRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminNotifications.markRead(id),
    onSuccess: () => invalidateAdminNotifications(qc),
  });
};

export const useMarkAllAdminNotificationsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminNotifications.markAllRead(),
    onSuccess: () => invalidateAdminNotifications(qc),
  });
};

export const useBroadcastNotification = () =>
  useMutation({
    mutationFn: (payload: BroadcastPayload) => adminNotifications.broadcast(payload),
  });

// ─── Store Settings ─────────────────────────────────────

export const useAdminSettings = () =>
  useQuery({
    queryKey: ['admin-settings'],
    queryFn:  () => adminSettings.get(),
    staleTime: 60_000,
  });

export const useUpdateAdminSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: StoreSettings) => adminSettings.update(payload),
    onSuccess: (saved) => {
      // Prime the cache with the server's canonical version and invalidate
      // so any other consumer (e.g. Dashboard using storeName) refetches.
      qc.setQueryData(['admin-settings'], saved);
      qc.invalidateQueries({ queryKey: ['admin-settings'] });
    },
  });
};

// ─── Stores (admin) ─────────────────────────────────────

const invalidateStores = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['admin-stores'] });
  qc.invalidateQueries({ queryKey: ['stores'] });
};

export const useAdminStores = (params: AdminStoresListParams = {}) =>
  useQuery({
    queryKey: ['admin-stores', params],
    queryFn: () => storesService.admin.list(params),
  });

export const useAdminStore = (id: string | undefined) =>
  useQuery({
    queryKey: ['admin-store', id],
    queryFn: () => storesService.admin.get(id!),
    enabled: !!id,
  });

export const useCreateStore = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: StoreWritePayload) => storesService.admin.create(payload),
    onSuccess: () => invalidateStores(qc),
  });
};

export const useUpdateStore = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: StoreWritePayload }) =>
      storesService.admin.update(id, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin-store', id] });
      invalidateStores(qc);
    },
  });
};

// ─── Store linking ──────────────────────────────────────

/** Stores a partner application can be linked to. Kept out of the general
 *  stores cache: the eligibility rules differ and a link/unlink has to
 *  invalidate this list specifically. */
export const useLinkableStores = (enabled = true) =>
  useQuery({
    queryKey: ['admin-linkable-stores'],
    queryFn: () => storesService.admin.linkable(),
    enabled,
    // Another admin approving an application removes a store from this pool,
    // and a stale list means picking one that 409s on submit.
    staleTime: 15_000,
  });

/** Give somebody a store — the store page, the Vendors tab and both lists follow. */
export const useLinkPartner = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AdminLinkPartnerPayload) => storesService.admin.linkPartner(payload),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['admin-store', d.store_id] });
      qc.invalidateQueries({ queryKey: ['admin-linkable-stores'] });
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-user', d.user_id] });
      qc.invalidateQueries({ queryKey: ['admin-user-lookup'] });
      invalidateStores(qc);
    },
  });
};

/** A partner's login again. Answers what the client resend does, for the same dialog. */
export const useResendPartnerCredentials = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; sendEmail: boolean }) => storesService.admin.partnerCredentials(v.userId, v.sendEmail),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['admin-user', v.userId] });
      // The store page shows whether they have signed in yet.
      qc.invalidateQueries({ queryKey: ['admin-store'] });
    },
  });
};

export const useUnlinkStorePartner = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storesService.admin.unlinkPartner(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['admin-linkable-stores'] });
      qc.invalidateQueries({ queryKey: ['admin-store', id] });
      invalidateStores(qc);
    },
  });
};

/**
 * @deprecated Backend endpoint returns 410 Gone — retained so a stale admin
 * bundle mid-deploy shows a legible error banner instead of a silent crash.
 * Use `useScheduleStoreDeletion` → wait 5 days → `usePermanentDeleteStore`.
 */
export const useDeleteStore = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storesService.admin.remove(id),
    onSuccess: () => invalidateStores(qc),
  });
};

// ─── Store soft-delete lifecycle ────────────────────────
// Four-step flow, see feedback_store-soft-delete-pattern memory.
//   schedule → (5-day grace, may cancel) → permanent (super_admin) → restore (super_admin)

export const useScheduleStoreDeletion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ScheduleStoreDeletionPayload }) =>
      storesService.admin.scheduleDeletion(id, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin-store', id] });
      invalidateStores(qc);
    },
  });
};

export const useCancelStoreDeletion = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storesService.admin.cancelDeletion(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['admin-store', id] });
      invalidateStores(qc);
    },
  });
};

export const usePermanentDeleteStore = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PermanentDeleteStorePayload }) =>
      storesService.admin.permanentDelete(id, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin-store', id] });
      invalidateStores(qc);
    },
  });
};

export const useRestoreStore = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => storesService.admin.restore(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['admin-store', id] });
      invalidateStores(qc);
    },
  });
};

export const useAssignStoreProducts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, productIds }: { id: string; productIds: string[] }) =>
      storesService.admin.assignProducts(id, productIds),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin-store', id] });
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      invalidateStores(qc);
    },
  });
};

export const useUnassignStoreProducts = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, productIds }: { id: string; productIds: string[] }) =>
      storesService.admin.unassignProducts(id, productIds),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin-store', id] });
      qc.invalidateQueries({ queryKey: ['admin-products'] });
      invalidateStores(qc);
    },
  });
};

// ─── Brands (first-class table) ─────────────────────────
// Also invalidates the public queries so the customer marquee updates without
// a full page reload after an admin edit.

const invalidateBrands = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['admin-brands'] });
  qc.invalidateQueries({ queryKey: ['brands'] });
};

export const useAdminBrandsTable = () =>
  useQuery({ queryKey: ['admin-brands'], queryFn: () => adminBrands.list() });

export const useAdminBrand = (id: string | null | undefined) =>
  useQuery({
    queryKey: ['admin-brand', id],
    queryFn: () => adminBrands.get(id as string),
    enabled: !!id,
  });

export const useCreateBrand = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: BrandWritePayload) => adminBrands.create(payload),
    onSuccess: () => invalidateBrands(qc),
  });
};

export const useUpdateBrand = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<BrandWritePayload> }) =>
      adminBrands.update(id, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin-brand', id] });
      invalidateBrands(qc);
    },
  });
};

export const useDeleteBrand = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminBrands.remove(id),
    onSuccess: () => invalidateBrands(qc),
  });
};

export const useReorderBrands = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => adminBrands.reorder(ids),
    onSuccess: () => invalidateBrands(qc),
  });
};

// ─── Origins (first-class table) ────────────────────────

const invalidateOrigins = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['admin-origins'] });
  qc.invalidateQueries({ queryKey: ['origins'] });
};

export const useAdminOriginsTable = () =>
  useQuery({ queryKey: ['admin-origins'], queryFn: () => adminOrigins.list() });

export const useAdminOrigin = (id: string | null | undefined) =>
  useQuery({
    queryKey: ['admin-origin', id],
    queryFn: () => adminOrigins.get(id as string),
    enabled: !!id,
  });

export const useCreateOrigin = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: OriginWritePayload) => adminOrigins.create(payload),
    onSuccess: () => invalidateOrigins(qc),
  });
};

export const useUpdateOrigin = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<OriginWritePayload> }) =>
      adminOrigins.update(id, payload),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['admin-origin', id] });
      invalidateOrigins(qc);
    },
  });
};

export const useDeleteOrigin = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminOrigins.remove(id),
    onSuccess: () => invalidateOrigins(qc),
  });
};

export const useReorderOrigins = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => adminOrigins.reorder(ids),
    onSuccess: () => invalidateOrigins(qc),
  });
};

// ─── Product Types (2026-07-17) ─────────────────────────
// Third-tier taxonomy under SubCategory. Admin CRUD lives on the
// Categories page (nested under each subcategory row). Public reads
// go through useProductTypesForSubcategory in ../hooks.ts.

import {
  adminProductTypes,
  type CreateProductTypePayload,
  type UpdateProductTypePayload,
  type AdminProductTypesListParams,
} from './services/productTypes';

const PRODUCT_TYPES_KEY = ['admin-product-types'] as const;

/** Invalidate every cached list that could be affected by a product-type
 *  mutation: the admin list itself + the public per-subcategory lists used
 *  by cascading pickers on the product form and customer web. */
function invalidateProductTypes(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: PRODUCT_TYPES_KEY });
  qc.invalidateQueries({ queryKey: ['product-types'] });
}

export const useAdminProductTypes = (params: AdminProductTypesListParams = {}) =>
  useQuery({
    queryKey: [...PRODUCT_TYPES_KEY, params],
    queryFn: () => adminProductTypes.list(params),
  });

export const useAdminProductType = (id: string | null | undefined) =>
  useQuery({
    queryKey: [...PRODUCT_TYPES_KEY, 'detail', id],
    queryFn: () => adminProductTypes.get(id as string),
    enabled: !!id,
  });

export const useCreateProductType = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateProductTypePayload) => adminProductTypes.create(payload),
    onSuccess: () => invalidateProductTypes(qc),
  });
};

export const useUpdateProductType = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateProductTypePayload }) =>
      adminProductTypes.update(id, payload),
    onSuccess: () => invalidateProductTypes(qc),
  });
};

export const useDeleteProductType = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminProductTypes.remove(id),
    onSuccess: () => invalidateProductTypes(qc),
  });
};

export const useReorderProductTypes = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => adminProductTypes.reorder(ids),
    onSuccess: () => invalidateProductTypes(qc),
  });
};

import {
  adminReviews,
  type AdminReviewsParams,
} from './services/reviews';

// ─── Review moderation ──────────────────────────────────
//
// Every mutation invalidates the list AND the product: hiding or deleting a
// review changes products.rating, which the API recomputes in the same
// transaction, so a stale product row would show an average its own reviews
// no longer support.

const ADMIN_REVIEWS_KEY = ['admin-reviews'];

export const useAdminReviews = (params: AdminReviewsParams = {}) =>
  useQuery({
    queryKey: [...ADMIN_REVIEWS_KEY, params],
    queryFn: () => adminReviews.list(params),
  });

const invalidateReviews = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ADMIN_REVIEWS_KEY });
  qc.invalidateQueries({ queryKey: ['admin-products'] });
};

export const useHideReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string | null }) =>
      adminReviews.hide(id, reason),
    onSuccess: () => invalidateReviews(qc),
  });
};

export const useUnhideReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminReviews.unhide(id),
    onSuccess: () => invalidateReviews(qc),
  });
};

export const useDeleteReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminReviews.remove(id),
    onSuccess: () => invalidateReviews(qc),
  });
};

/** Clears the open reports. The review is untouched, so the product rating
 *  cannot have changed — only the list needs refreshing. */
export const useDismissReviewReports = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminReviews.dismissReports(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ADMIN_REVIEWS_KEY }); },
  });
};

// ─── Home Grocery plans (staff) ─────────────────────────

import {
  adminHomeGroceryPlans,
  type StaffPlanView,
  type CreatePlanPayload,
  type PlanItem,
  type PlanSettingsPayload,
  type PlanHistoryFilter,
  type PlanSlot,
} from './services/homeGroceryPlan';

const ADMIN_HG_PLAN_KEY = ['admin-home-grocery-plan'] as const;

const ADMIN_CUSTOMER_DISCOUNTS_KEY = ['admin-customer-discounts'] as const;

/** The prices agreed with a customer (euros off one unit per product size). */
export const useAdminCustomerDiscounts = (userId: string | null | undefined) =>
  useQuery({
    queryKey: [...ADMIN_CUSTOMER_DISCOUNTS_KEY, userId],
    queryFn: () => adminUsers.productDiscounts(userId!),
    enabled: !!userId,
  });

export const useRemoveCustomerDiscount = (userId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (variantId: string) => adminUsers.removeProductDiscount(userId, variantId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...ADMIN_CUSTOMER_DISCOUNTS_KEY, userId] }),
  });
};

/** A subscriber's plan as staff see it: the household's view plus profile and addresses. */
export const useAdminHomeGroceryPlan = (userId: string | null | undefined) =>
  useQuery<StaffPlanView>({
    queryKey: [...ADMIN_HG_PLAN_KEY, userId],
    queryFn: () => adminHomeGroceryPlans.get(userId!),
    enabled: !!userId,
  });

/** Each change answers with the whole view; it goes straight into the cache. */
const useStaffPlanMutation = <TArgs,>(userId: string, fn: (args: TArgs) => Promise<StaffPlanView>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // Shown in the panel. A 5xx must not throw staff to /500 mid-edit.
    meta: { inlineErrors: true },
    onSuccess: (view) => {
      qc.setQueryData([...ADMIN_HG_PLAN_KEY, userId], view);
      qc.invalidateQueries({ queryKey: [...ADMIN_HG_PLAN_KEY, userId, 'deliveries'] });
      qc.invalidateQueries({ queryKey: [...ADMIN_HG_PLAN_KEY, 'upcoming'] });
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
      // The Home Grocery tab's plan column and the customer page.
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      qc.invalidateQueries({ queryKey: ['admin-user', userId] });
    },
  });
};

export const useAdminCreatePlan = (userId: string) =>
  useStaffPlanMutation(userId, (payload: CreatePlanPayload) => adminHomeGroceryPlans.create(userId, payload));
export const useAdminUpdatePlanItems = (userId: string) =>
  useStaffPlanMutation(userId, (items: PlanItem[]) => adminHomeGroceryPlans.updateItems(userId, items));
export const useAdminUpdatePlanSettings = (userId: string) =>
  useStaffPlanMutation(userId, (payload: PlanSettingsPayload) => adminHomeGroceryPlans.updateSettings(userId, payload));
export const useAdminPausePlan = (userId: string) =>
  useStaffPlanMutation(userId, (_: void) => adminHomeGroceryPlans.pause(userId));
export const useAdminResumePlan = (userId: string) =>
  useStaffPlanMutation(userId, (_: void) => adminHomeGroceryPlans.resume(userId));
export const useAdminSkipPlanDelivery = (userId: string) =>
  useStaffPlanMutation(userId, (_: void) => adminHomeGroceryPlans.skip(userId));
export const useAdminEndPlan = (userId: string) =>
  useStaffPlanMutation(userId, (reason: string | undefined) => adminHomeGroceryPlans.end(userId, reason));

export const useAdminPlanDeliveries = (userId: string | null | undefined, filter: PlanHistoryFilter) =>
  useInfiniteQuery({
    queryKey: [...ADMIN_HG_PLAN_KEY, userId, 'deliveries', filter],
    queryFn: ({ pageParam = 1 }) =>
      adminHomeGroceryPlans.deliveries(userId!, { status: filter, page: pageParam as number, limit: 10 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: !!userId,
  });

/** Move a Home Grocery order to another day or part of the day — today included, for staff. */
export const useAdminChangeOrderSlot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, slot }: { orderId: string; slot: PlanSlot }) => adminHomeGroceryPlans.changeSlot(orderId, slot),
    meta: { inlineErrors: true },
    onSuccess: (_d, { orderId }) => {
      qc.invalidateQueries({ queryKey: ['admin-order', orderId] });
      qc.invalidateQueries({ queryKey: ADMIN_HG_PLAN_KEY });
      qc.invalidateQueries({ queryKey: ['admin-orders'] });
    },
  });
};

/** Every plan's open delivery planned within `days` (overdue drafts included). */
export const useAdminUpcomingPlanDeliveries = (days = 14) =>
  useQuery({
    queryKey: [...ADMIN_HG_PLAN_KEY, 'upcoming', days],
    queryFn: () => adminHomeGroceryPlans.upcoming(days),
  });
