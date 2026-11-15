import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  partnerAuth, partnerStore, partnerProducts, partnerRiders, partnerOrders,
  partnerTaxonomy, partnerDashboard,
  type PartnerMeResponse, type PartnerStorePayload, type PartnerProductsListParams,
  type PartnerOrdersListParams, type PartnerOrderStatusTarget,
  type PartnerRiderPayload,
  type PartnerDashboardRange, type PartnerCategorySubmissionPayload,
} from './services/partner';
import type { Product, Order, EditOrderRequest } from '../types';

// Query keys — exported so consumers can invalidate on out-of-band writes.
export const PARTNER_ME_KEY       = ['partner-me']       as const;
export const PARTNER_STORE_KEY    = ['partner-store']    as const;
export const PARTNER_PRODUCTS_KEY = ['partner-products'] as const;
export const PARTNER_RIDERS_KEY   = ['partner-riders']   as const;
export const PARTNER_ORDERS_KEY   = ['partner-orders']   as const;
export const PARTNER_TAXONOMY_KEY = ['partner-taxonomy'] as const;

export const PARTNER_DASHBOARD_STATS_KEY  = ['partner-dashboard-stats']  as const;
export const PARTNER_DASHBOARD_RECENT_KEY = ['partner-dashboard-recent'] as const;

// ─── Dashboard ──────────────────────────────────────────

export const usePartnerDashboardStats = (params: { range?: PartnerDashboardRange } = {}) =>
  useQuery({
    queryKey: [...PARTNER_DASHBOARD_STATS_KEY, params],
    queryFn: () => partnerDashboard.stats(params),
    // Keep it fresh — partners will leave this tab open while orders roll in.
    refetchInterval: 60_000,
  });

export const usePartnerRecentOrders = () =>
  useQuery({
    queryKey: PARTNER_DASHBOARD_RECENT_KEY,
    queryFn: () => partnerDashboard.recentOrders(),
    refetchInterval: 60_000,
  });

// ─── /me ────────────────────────────────────────────────

export const useCurrentPartner = (opts: { enabled?: boolean } = {}) =>
  useQuery<PartnerMeResponse>({
    queryKey: PARTNER_ME_KEY,
    queryFn: () => partnerAuth.me(),
    enabled: opts.enabled ?? true,
    retry: false,
  });

// ─── Store profile ──────────────────────────────────────

export const usePartnerStore = () =>
  useQuery({ queryKey: PARTNER_STORE_KEY, queryFn: () => partnerStore.get() });

export const useUpdatePartnerStore = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PartnerStorePayload) => partnerStore.update(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PARTNER_STORE_KEY });
      // The /me query includes store — keep it fresh so the layout top-bar updates.
      qc.invalidateQueries({ queryKey: PARTNER_ME_KEY });
    },
  });
};

// ─── Products ───────────────────────────────────────────

export const usePartnerProducts = (params: PartnerProductsListParams = {}) =>
  useQuery({
    queryKey: [...PARTNER_PRODUCTS_KEY, params],
    queryFn: () => partnerProducts.list(params),
  });

export const usePartnerProduct = (id: string | undefined) =>
  useQuery({
    queryKey: [...PARTNER_PRODUCTS_KEY, 'detail', id],
    queryFn: () => partnerProducts.get(id!),
    enabled: !!id,
  });

export const useCreatePartnerProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Product> & { variants: unknown[]; images: unknown[] }) =>
      partnerProducts.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: PARTNER_PRODUCTS_KEY }),
  });
};

export const useUpdatePartnerProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Product> & { variants: unknown[]; images: unknown[] } }) =>
      partnerProducts.update(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: PARTNER_PRODUCTS_KEY }),
  });
};

export const useDeletePartnerProduct = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => partnerProducts.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: PARTNER_PRODUCTS_KEY }),
  });
};

// ─── Riders ─────────────────────────────────────────────

export const usePartnerRiders = (params: { activeOnly?: boolean } = {}) =>
  useQuery({
    queryKey: [...PARTNER_RIDERS_KEY, params],
    queryFn: () => partnerRiders.list(params),
  });

export const useCreatePartnerRider = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PartnerRiderPayload) => partnerRiders.create(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: PARTNER_RIDERS_KEY }),
  });
};

export const useUpdatePartnerRider = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PartnerRiderPayload }) => partnerRiders.update(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: PARTNER_RIDERS_KEY }),
  });
};

export const useDeletePartnerRider = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => partnerRiders.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: PARTNER_RIDERS_KEY }),
  });
};

// ─── Orders ─────────────────────────────────────────────

export const usePartnerOrders = (params: PartnerOrdersListParams = {}) =>
  useQuery<Array<Order & { _count: { items: number } }>>({
    queryKey: [...PARTNER_ORDERS_KEY, params],
    queryFn: () => partnerOrders.list(params),
  });

export const usePartnerOrder = (id: string | undefined) =>
  useQuery<Order>({
    queryKey: [...PARTNER_ORDERS_KEY, 'detail', id],
    queryFn: () => partnerOrders.get(id!),
    enabled: !!id,
  });

export const useUpdatePartnerOrderStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: PartnerOrderStatusTarget }) =>
      partnerOrders.updateStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: PARTNER_ORDERS_KEY }),
  });
};

// ─── Taxonomy (partner-owned read hooks) ────────────────

export const usePartnerCategories = () =>
  useQuery({ queryKey: [...PARTNER_TAXONOMY_KEY, 'categories'], queryFn: () => partnerTaxonomy.categories() });

export const usePartnerSubcategories = (categoryId: string | undefined) =>
  useQuery({
    queryKey: [...PARTNER_TAXONOMY_KEY, 'subcategories', categoryId],
    queryFn: () => partnerTaxonomy.subcategories(categoryId),
    enabled: !!categoryId,
  });

export const usePartnerProductTypes = (subcategoryId: string | undefined) =>
  useQuery({
    queryKey: [...PARTNER_TAXONOMY_KEY, 'product-types', subcategoryId],
    queryFn: () => partnerTaxonomy.productTypes(subcategoryId!),
    enabled: !!subcategoryId,
  });

export const usePartnerBrands = () =>
  useQuery({ queryKey: [...PARTNER_TAXONOMY_KEY, 'brands'], queryFn: () => partnerTaxonomy.brands() });

export const usePartnerOrigins = () =>
  useQuery({ queryKey: [...PARTNER_TAXONOMY_KEY, 'origins'], queryFn: () => partnerTaxonomy.origins() });

export const usePartnerMyCategories = () =>
  useQuery({ queryKey: [...PARTNER_TAXONOMY_KEY, 'my-categories'], queryFn: () => partnerTaxonomy.myCategories() });

export const useCreatePartnerCategory = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PartnerCategorySubmissionPayload) => partnerTaxonomy.createCategory(payload),
    // Approved-only endpoints won't show this yet, but "my submissions"
    // should reflect it immediately.
    onSuccess: () => qc.invalidateQueries({ queryKey: [...PARTNER_TAXONOMY_KEY, 'my-categories'] }),
  });
};

export const useDismissPartnerCategorySubmission = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => partnerTaxonomy.dismissCategorySubmission(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...PARTNER_TAXONOMY_KEY, 'my-categories'] }),
  });
};

// ─── Orders ─────────────────────────────────────────────

export const useAssignPartnerOrderRider = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, riderId }: { id: string; riderId: string | null }) =>
      partnerOrders.assignRider(id, riderId),
    onSuccess: () => qc.invalidateQueries({ queryKey: PARTNER_ORDERS_KEY }),
  });
};

export const useCancelPartnerOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      partnerOrders.cancel(id, reason),
    onSuccess: () => qc.invalidateQueries({ queryKey: PARTNER_ORDERS_KEY }),
  });
};

export const useConfirmPartnerDraftStock = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => partnerOrders.confirmStock(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: PARTNER_ORDERS_KEY }),
  });
};

export const useEditPartnerOrderItems = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: EditOrderRequest }) =>
      partnerOrders.editItems(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: PARTNER_ORDERS_KEY }),
  });
};

export const useSetPartnerOrderDeliveryFee = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, deliveryFee }: { id: string; deliveryFee: number }) =>
      partnerOrders.setDeliveryFee(id, deliveryFee),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PARTNER_ORDERS_KEY });
      // The fee is revenue, so the store's own figures move with it. Both
      // dashboard keys by name — they are siblings, not a shared prefix, so
      // one ['partner-dashboard'] call would match neither.
      qc.invalidateQueries({ queryKey: PARTNER_DASHBOARD_STATS_KEY });
      qc.invalidateQueries({ queryKey: PARTNER_DASHBOARD_RECENT_KEY });
    },
  });
};

// ─── Duplicates ─────────────────────────────────────────

export const PARTNER_DUPLICATES_KEY = ['partner-product-duplicates'] as const;

export const usePartnerProductDuplicates = () =>
  useQuery({
    queryKey: PARTNER_DUPLICATES_KEY,
    queryFn: () => partnerProducts.listDuplicates(),
  });

// ─── Import duplicates ──────────────────────────────────
// Distinct cache key from PARTNER_DUPLICATES_KEY: the two queues answer
// different questions and a create here adds a product, which the catalogue
// duplicates scan then needs to re-run.

export const PARTNER_IMPORT_DUPLICATES_KEY = ['partner-import-duplicates'] as const;

export const usePartnerImportDuplicates = (
  status: Parameters<typeof partnerProducts.listImportDuplicates>[0] = 'pending',
) =>
  useQuery({
    queryKey: [...PARTNER_IMPORT_DUPLICATES_KEY, status],
    queryFn: () => partnerProducts.listImportDuplicates(status),
    // The queue fills asynchronously while an import job runs, and nothing
    // pushes to the client when it does.
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });

const invalidateImportDuplicates = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: PARTNER_IMPORT_DUPLICATES_KEY });
  qc.invalidateQueries({ queryKey: PARTNER_PRODUCTS_KEY });
  qc.invalidateQueries({ queryKey: PARTNER_DUPLICATES_KEY });
};

export const useCreateFromPartnerImportDuplicate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => partnerProducts.createFromImportDuplicate(id),
    onSuccess: () => invalidateImportDuplicates(qc),
  });
};

export const useDismissPartnerImportDuplicate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => partnerProducts.dismissImportDuplicate(id),
    onSuccess: () => invalidateImportDuplicates(qc),
  });
};

export const useDismissAllPartnerImportDuplicates = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) => partnerProducts.dismissAllImportDuplicates(ids),
    onSuccess: () => invalidateImportDuplicates(qc),
  });
};

export const useResolvePartnerDuplicates = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof partnerProducts.resolveDuplicates>[0]) =>
      partnerProducts.resolveDuplicates(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PARTNER_DUPLICATES_KEY });
      qc.invalidateQueries({ queryKey: PARTNER_PRODUCTS_KEY });
    },
  });
};

export const useMergePartnerDuplicates = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof partnerProducts.mergeDuplicates>[0]) =>
      partnerProducts.mergeDuplicates(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PARTNER_DUPLICATES_KEY });
      qc.invalidateQueries({ queryKey: PARTNER_PRODUCTS_KEY });
    },
  });
};

// ─── Bulk Import ────────────────────────────────────────
// Same shape as admin's — enqueue POST returns a jobId, then poll the job
// query at ~1s intervals until it reaches a terminal status. The job
// query invalidates PARTNER_PRODUCTS_KEY on transition to done + created>0
// so the products page refreshes automatically.

export const useImportPartnerProducts = () => {
  return useMutation({
    mutationFn: (file: File) => partnerProducts.importFromXlsx(file),
  });
};

export const usePartnerImportJob = (jobId: string | null | undefined) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['partner-import-job', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      const job = await partnerProducts.getImportJob(jobId);
      if (job.status === 'done' && (job.result?.created ?? 0) > 0) {
        qc.invalidateQueries({ queryKey: PARTNER_PRODUCTS_KEY });
      }
      return job;
    },
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 1_000;
      if (data.status === 'queued' || data.status === 'running') return 1_000;
      return false;
    },
    staleTime: 0,
  });
};

export const usePartnerImportJobs = (limit = 10) =>
  useQuery({
    queryKey: ['partner-import-jobs', limit],
    queryFn: () => partnerProducts.listImportJobs(limit),
  });

// ─── Rashan (partner) ───────────────────────────────────
// The partner's own pack templates plus the subscriptions and deliveries
// those packs generate. Pack writes clear the customer-facing caches as
// well, so a pack switched off in the dashboard leaves /rashan and the
// storefront tab immediately rather than at the next natural refetch.

import {
  partnerRashan,
  type PartnerPackPayload,
  type PartnerSubscriptionsParams,
  type PartnerDeliveriesParams,
} from './services/partnerRashan';
import type { SubDeliveryStatus } from './services/rashan';

export const PARTNER_RASHAN_PACKS_KEY      = ['partner-rashan-packs']      as const;
export const PARTNER_RASHAN_SUBS_KEY       = ['partner-rashan-subs']       as const;
export const PARTNER_RASHAN_DELIVERIES_KEY = ['partner-rashan-deliveries'] as const;

const invalidatePartnerPacks = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: PARTNER_RASHAN_PACKS_KEY });
  qc.invalidateQueries({ queryKey: ['rashan-packs'] });       // the /rashan rail
  qc.invalidateQueries({ queryKey: ['store-rashan-packs'] }); // storefront tab
};

export const usePartnerRashanPacks = () =>
  useQuery({ queryKey: PARTNER_RASHAN_PACKS_KEY, queryFn: () => partnerRashan.listPacks() });

export const usePartnerRashanPack = (id: string | undefined) =>
  useQuery({
    queryKey: [...PARTNER_RASHAN_PACKS_KEY, id],
    queryFn: () => partnerRashan.getPack(id!),
    enabled: !!id,
  });

export const useCreatePartnerRashanPack = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: PartnerPackPayload) => partnerRashan.createPack(payload),
    onSuccess: () => invalidatePartnerPacks(qc),
  });
};

export const useUpdatePartnerRashanPack = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PartnerPackPayload }) =>
      partnerRashan.updatePack(id, payload),
    onSuccess: () => invalidatePartnerPacks(qc),
  });
};

export const useDeletePartnerRashanPack = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => partnerRashan.deletePack(id),
    onSuccess: () => invalidatePartnerPacks(qc),
  });
};

export const usePartnerRashanSubscriptions = (params: PartnerSubscriptionsParams = {}) =>
  useQuery({
    queryKey: [...PARTNER_RASHAN_SUBS_KEY, params],
    queryFn: () => partnerRashan.listSubscriptions(params),
  });

export const usePartnerRashanSubscription = (id: string | undefined) =>
  useQuery({
    queryKey: [...PARTNER_RASHAN_SUBS_KEY, 'detail', id],
    queryFn: () => partnerRashan.getSubscription(id!),
    enabled: !!id,
  });

export const usePartnerRashanDeliveries = (params: PartnerDeliveriesParams = {}) =>
  useQuery({
    queryKey: [...PARTNER_RASHAN_DELIVERIES_KEY, params],
    queryFn: () => partnerRashan.listDeliveries(params),
  });

/** Advancing a delivery can roll the parent subscription's next date, so both
 *  caches are cleared, not just the delivery list. */
const invalidatePartnerDeliveries = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: PARTNER_RASHAN_DELIVERIES_KEY });
  qc.invalidateQueries({ queryKey: PARTNER_RASHAN_SUBS_KEY });
};

export const useSetPartnerDeliveryStatus = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, failureReason }: {
      id: string; status: SubDeliveryStatus; failureReason?: string;
    }) => partnerRashan.setDeliveryStatus(id, status, failureReason),
    onSuccess: () => invalidatePartnerDeliveries(qc),
  });
};

export const useAssignPartnerDeliveryRider = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, riderId }: { id: string; riderId: string | null }) =>
      partnerRashan.assignDeliveryRider(id, riderId),
    onSuccess: () => invalidatePartnerDeliveries(qc),
  });
};

// ─── Notifications (the dashboard bell) ─────────────────
//
// Polled, like the customer bell, because push is the only other channel and
// it may be denied or the device offline. A partner with the dashboard open
// sees a new order within half a minute either way.

import { partnerNotifications } from './services/notifications';
import type { NotificationListParams } from './services/notifications';

export const PARTNER_NOTIFICATIONS_KEY = ['partner-notifications'] as const;
const PARTNER_UNREAD_KEY = ['partner-notifications-unread'] as const;

export const usePartnerNotifications = (
  params: NotificationListParams = {},
  opts?: { refetchInterval?: number },
) =>
  useQuery({
    queryKey: [...PARTNER_NOTIFICATIONS_KEY, params],
    queryFn: () => partnerNotifications.list(params),
    refetchInterval: opts?.refetchInterval ?? 30_000,
    refetchOnWindowFocus: true,
  });

export const usePartnerUnreadNotificationCount = (opts?: { refetchInterval?: number }) =>
  useQuery({
    queryKey: PARTNER_UNREAD_KEY,
    queryFn: () => partnerNotifications.unreadCount(),
    refetchInterval: opts?.refetchInterval ?? 15_000,
    refetchOnWindowFocus: true,
  });

const invalidatePartnerNotifications = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: PARTNER_NOTIFICATIONS_KEY });
  qc.invalidateQueries({ queryKey: PARTNER_UNREAD_KEY });
};

export const useMarkPartnerNotificationRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => partnerNotifications.markRead(id),
    onSuccess: () => invalidatePartnerNotifications(qc),
  });
};

export const useMarkAllPartnerNotificationsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => partnerNotifications.markAllRead(),
    onSuccess: () => invalidatePartnerNotifications(qc),
  });
};
