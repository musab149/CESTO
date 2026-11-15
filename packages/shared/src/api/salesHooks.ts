import {
  useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient,
} from '@tanstack/react-query';
import {
  salesMe, salesClients, salesCatalogue, salesOrders, salesProducts, salesInvoices, salesEarnings,
  type SalesMeResponse, type SalesNewClientPayload, type SalesNewOrderPayload,
  type SalesAddressInput, type SalesProductsListParams,
  type SalesQuickProductPayload,
} from './services/sales';
import type { EditOrderRequest } from '../types';

export const SALES_ME_KEY         = ['sales-me'] as const;
export const SALES_EARNINGS_KEY   = ['sales-earnings'] as const;
export const SALES_CLIENTS_KEY    = ['sales-clients'] as const;
export const SALES_CATALOGUE_KEY  = ['sales-catalogue'] as const;
export const SALES_CATEGORIES_KEY = ['sales-categories'] as const;
export const SALES_ORDERS_KEY     = ['sales-orders'] as const;

// ─── Who they are, and the day's figures ────────────────

export const useSalesMe = (opts: { enabled?: boolean } = {}) =>
  useQuery<SalesMeResponse>({
    queryKey: SALES_ME_KEY,
    queryFn: () => salesMe.get(),
    enabled: opts.enabled ?? true,
    retry: false,
  });

// ─── Clients ────────────────────────────────────────────

export const useSalesClients = (params: { q?: string; page?: number; limit?: number; relation?: 'own' | 'other' | 'all' } = {}) =>
  useQuery({
    queryKey: [...SALES_CLIENTS_KEY, params],
    queryFn: () => salesClients.list(params),
  });

/**
 * Any client of Cesto, by their whole email (2026-10-28). A mutation, not a
 * query: it is asked once, on purpose, and finding somebody puts them among
 * the rep's others — so the lists go stale with it.
 */
export const useFindSalesClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) => salesClients.find(email),
    onSuccess: () => qc.invalidateQueries({ queryKey: SALES_CLIENTS_KEY }),
  });
};

/**
 * "Is this email or phone already taken?", asked while they type.
 *
 * `enabled` is the caller's, because asking per keystroke is the failure mode
 * this exists to avoid — the form gates it on the field looking complete.
 */
export const useSalesClientLookup = (
  params: { email?: string; phone?: string },
  enabled: boolean,
) => useQuery({
  queryKey: [...SALES_CLIENTS_KEY, 'lookup', params],
  queryFn: () => salesClients.lookup(params),
  enabled: enabled && !!(params.email || params.phone),
  // A taken email does not become free while a rep fills in a form.
  staleTime: 60_000,
});

export const useSalesClient = (id: string | undefined) =>
  useQuery({
    queryKey: [...SALES_CLIENTS_KEY, 'one', id],
    queryFn: () => salesClients.get(id!),
    enabled: !!id,
  });

/** The prices agreed with this client, to start an order line with its discount. */
export const useSalesClientDiscounts = (id: string | undefined) =>
  useQuery({
    queryKey: [...SALES_CLIENTS_KEY, 'discounts', id],
    queryFn: () => salesClients.productDiscounts(id!),
    enabled: !!id,
  });

export const useCreateSalesClient = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SalesNewClientPayload) => salesClients.create(payload),
    onSuccess: () => {
      // The new client joins their book and their opened-clients count, so both
      // go stale at once.
      qc.invalidateQueries({ queryKey: SALES_CLIENTS_KEY });
      qc.invalidateQueries({ queryKey: SALES_ME_KEY });
    },
  });
};

export const useAddSalesClientAddress = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { clientId: string; address: SalesAddressInput }) =>
      salesClients.addAddress(vars.clientId, vars.address),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [...SALES_CLIENTS_KEY, 'one', vars.clientId] });
    },
  });
};

/**
 * Issue a client their shop login. Refreshes the client, whose `access` is
 * now "temporary" — and stays so until they choose their own.
 */
export const useIssueSalesClientCredentials = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { clientId: string; sendEmail: boolean }) =>
      salesClients.issueCredentials(vars.clientId, { send_email: vars.sendEmail }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [...SALES_CLIENTS_KEY, 'one', vars.clientId] });
    },
  });
};

// ─── Catalogue ──────────────────────────────────────────

/**
 * Scroll-to-load, because a rep scrolls a result list on a tablet rather than
 * paging it. `for_client` is part of the key: the same search priced for a
 * wholesale client is a different answer, and sharing one cache entry would
 * show one client's prices while building another's order.
 */
/**
 * The catalogue, paged for the ported order panel.
 *
 * Named and shaped after `useAdminProductsFullInfinite` because the panel is a
 * port of admin's and calls it the same way — including `placeholderData`,
 * without which changing a category empties the grid for a beat and both the
 * grid and the footer count snap back a moment later. Keeping the previous
 * page is the difference between a list updating and a list flickering.
 *
 * `for_client` is part of the key: the same search priced for a wholesale
 * client is a different answer, and sharing one cache entry would show one
 * client's prices while building another's order.
 */
export const useSalesProductsFullInfinite = (
  params: Omit<SalesProductsListParams, 'page'> = {},
  enabled = true,
) => useInfiniteQuery({
  queryKey: [...SALES_CATALOGUE_KEY, params],
  queryFn: ({ pageParam = 1 }) => salesCatalogue.products({ ...params, page: pageParam as number }),
  initialPageParam: 1,
  getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  placeholderData: (previous) => previous,
  enabled,
});

/**
 * One page of products, for the pickers that do not scroll.
 *
 * The infinite version above is for the order screen's grid; a search box
 * inside a modal wants twenty rows and no pagination at all. Rows already
 * carry their variants, so nothing needs a second request to offer a size.
 */
export const useSalesProductsList = (
  params: SalesProductsListParams = {},
  enabled = true,
) => useQuery({
  queryKey: [...SALES_CATALOGUE_KEY, 'list', params],
  queryFn: () => salesCatalogue.products(params),
  enabled,
});

/**
 * The taxonomy behind the filter rail. Read-only — a rep picks from what an
 * admin curates — and barely ever changes, so none of it is worth refetching
 * on every screen.
 */
const TAXONOMY_STALE = 30 * 60 * 1000;

export const useSalesCategories = () =>
  useQuery({
    queryKey: SALES_CATEGORIES_KEY,
    queryFn: () => salesCatalogue.categories(),
    staleTime: TAXONOMY_STALE,
  });

export const useSalesSubcategories = () =>
  useQuery({
    queryKey: [...SALES_CATEGORIES_KEY, 'sub'],
    queryFn: () => salesCatalogue.subcategories(),
    staleTime: TAXONOMY_STALE,
  });

export const useSalesBrandsTable = () =>
  useQuery({
    queryKey: [...SALES_CATALOGUE_KEY, 'brands'],
    queryFn: () => salesCatalogue.brands(),
    staleTime: TAXONOMY_STALE,
  });

export const useSalesOriginsTable = () =>
  useQuery({
    queryKey: [...SALES_CATALOGUE_KEY, 'origins'],
    queryFn: () => salesCatalogue.origins(),
    staleTime: TAXONOMY_STALE,
  });

export const useSalesStores = (params: { page?: number; limit?: number } = {}) =>
  useQuery({
    queryKey: [...SALES_CATALOGUE_KEY, 'stores', params],
    queryFn: () => salesCatalogue.stores(params),
    staleTime: TAXONOMY_STALE,
  });

/**
 * Add a product the catalogue does not have.
 *
 * Invalidates the catalogue rather than pushing the new row into the cache:
 * the order screen puts it straight into the basket from the response, so the
 * list only has to be correct the next time it is opened.
 */
export const useQuickCreateSalesProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SalesQuickProductPayload) => salesProducts.quickCreate(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: SALES_CATALOGUE_KEY }),
  });
};

// ─── Orders ─────────────────────────────────────────────

export const useSalesOrders = (
  params: { status?: string; client?: string; page?: number; limit?: number } = {},
) => useQuery({
  queryKey: [...SALES_ORDERS_KEY, params],
  queryFn: () => salesOrders.list(params),
});

/** One row per purchase, with its parts inside. */
export const useSalesOrderGroups = (
  params: { status?: string; q?: string; client?: string; page?: number; limit?: number } = {},
) => useQuery({
  queryKey: [...SALES_ORDERS_KEY, 'grouped', params],
  queryFn: () => salesOrders.listGrouped(params),
});

export const useSalesOrder = (id: string | undefined) =>
  useQuery({
    queryKey: [...SALES_ORDERS_KEY, 'one', id],
    queryFn: () => salesOrders.get(id!),
    enabled: !!id,
  });
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
export const useSalesOrderForEdit = (id: string | undefined) =>
  useQuery({
    queryKey: [...SALES_ORDERS_KEY, 'one', id, 'for-edit'],
    queryFn: () => salesOrders.get(id!),
    enabled: !!id,
    gcTime: 0,
  });

/**
 * After a write that moves stock: the catalogue's product pages are stale.
 *
 * RESET, not invalidated. Invalidating an infinite query refetches every page
 * it has loaded, one after another — after a rep built a 1,000-line order that
 * was 34+ requests over ~25s, for a screen they had already left (staging,
 * 2026-10-21). A reset drops the pages, so the grid starts again from page one
 * the next time it is on screen, with today's counts.
 *
 * Only the product queries: brands, origins and stores share the prefix but do
 * not change with stock, and were being refetched for nothing.
 */
const resetCatalogueStock = (qc: QueryClient) =>
  qc.resetQueries({
    queryKey: SALES_CATALOGUE_KEY,
    predicate: (q) => !['brands', 'origins', 'stores'].includes(q.queryKey[1] as string),
  });

/**
 * Every write to an order invalidates the list AND that order.
 *
 * Shared by the five mutations below rather than repeated: an edit changes the
 * total the list shows, a cancel changes its status, and a fee change moves
 * both. Forgetting one of the two is a screen that silently disagrees with the
 * one next to it.
 */
const useOrderMutation = <TArgs extends { id: string }, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  /** `inlineErrors`: the screen shows this one's failure itself. */
  meta?: Record<string, unknown>,
) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    meta,
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: SALES_ORDERS_KEY });
      qc.invalidateQueries({ queryKey: [...SALES_ORDERS_KEY, 'one', vars.id] });
      // Editing and cancelling both move stock, so the catalogue's counts are
      // stale too.
      void resetCatalogueStock(qc);
      qc.invalidateQueries({ queryKey: SALES_ME_KEY });
    },
  });
};

// Shows its own failure in place (see INLINE_ERRORS in hooks.ts): a 5xx must
// not tear down a basket that is being edited.
export const useEditSalesOrderItems = () =>
  useOrderMutation((v: { id: string; payload: EditOrderRequest; progressKey?: string }) =>
    salesOrders.editItems(v.id, v.payload, v.progressKey), { inlineErrors: true });

export const useCancelSalesOrder = () =>
  useOrderMutation((v: { id: string; reason?: string; progressKey?: string }) =>
    salesOrders.cancel(v.id, v.reason, v.progressKey));

export const useConfirmSalesOrderStock = () =>
  useOrderMutation((v: { id: string }) => salesOrders.confirmStock(v.id));

export const useSetSalesOrderDeliveryFee = () =>
  useOrderMutation((v: { id: string; deliveryFee: number }) =>
    salesOrders.setDeliveryFee(v.id, v.deliveryFee));

export const useSetSalesOrderNotes = () =>
  useOrderMutation((v: { id: string; customerNotes: string }) =>
    salesOrders.setNotes(v.id, v.customerNotes));

/**
 * Draft a document, then issue it.
 *
 * Two mutations rather than one, because they are two decisions the server
 * makes separately: drafting can be refused by the blockers, and issuing
 * allocates a number from a gap-free series. The screen chains them because a
 * rep pressing "Albarán" wants the document, not a draft of one — but the
 * refusal still arrives from whichever step refused.
 *
 * Invalidates the ORDER as well as the document, so the new albarán shows on it.
 */
export const useDraftSalesInvoice = () =>
  useOrderMutation((v: { id: string; kind: 'albaran' }) =>
    salesOrders.draftInvoice(v.id, v.kind));

export const useIssueSalesInvoice = () =>
  useOrderMutation((v: { id: string }) => salesInvoices.issue(v.id));

export const useCreateSalesOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    /** `idempotencyKey` describes the ATTEMPT, so it rides beside the payload. */
    mutationFn: ({ idempotencyKey, ...payload }: SalesNewOrderPayload & { idempotencyKey?: string }) =>
      salesOrders.create(payload, idempotencyKey),
    // Shows its own failure in place (see INLINE_ERRORS in hooks.ts): a 5xx
    // must not tear down a basket that is being built or edited.
    meta: { inlineErrors: true },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: SALES_ORDERS_KEY });
      qc.invalidateQueries({ queryKey: SALES_ME_KEY });
      // A placed order took stock, so every catalogue page in the cache is now
      // showing a stale count. Dropped, not refetched — see resetCatalogueStock.
      void resetCatalogueStock(qc);
    },
  });
};

/** Their earnings: the balance, its history, their orders on the way. Read-only. */
export const useSalesEarnings = () =>
  useQuery({ queryKey: SALES_EARNINGS_KEY, queryFn: () => salesEarnings.list() });

/** One line of their history, opened: what it came from. */
export const useSalesEarningEntry = (id: string | null) =>
  useQuery({ queryKey: [...SALES_EARNINGS_KEY, 'entry', id], queryFn: () => salesEarnings.entry(id!), enabled: !!id });


// ─── Notifications (the bell in the rep panel, 2026-10-26) ──
//
// Polled, like the partner bell: push may be off or the phone offline, and a
// rep with the panel open still sees a delivery or a payment within half a
// minute.

import { salesNotifications } from './services/notifications';
import type { NotificationListParams } from './services/notifications';

export const SALES_NOTIFICATIONS_KEY = ['sales-notifications'] as const;
const SALES_UNREAD_KEY = ['sales-notifications-unread'] as const;

export const useSalesNotifications = (params: NotificationListParams = {}, enabled = true) =>
  useQuery({
    queryKey: [...SALES_NOTIFICATIONS_KEY, params],
    queryFn: () => salesNotifications.list(params),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    enabled,
  });

export const useSalesUnreadNotificationCount = () =>
  useQuery({
    queryKey: SALES_UNREAD_KEY,
    queryFn: () => salesNotifications.unreadCount(),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

const invalidateSalesNotifications = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: SALES_NOTIFICATIONS_KEY });
  qc.invalidateQueries({ queryKey: SALES_UNREAD_KEY });
};

export const useMarkSalesNotificationRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => salesNotifications.markRead(id),
    onSuccess: () => invalidateSalesNotifications(qc),
  });
};

export const useMarkAllSalesNotificationsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => salesNotifications.markAllRead(),
    onSuccess: () => invalidateSalesNotifications(qc),
  });
};
