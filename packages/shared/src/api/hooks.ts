import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { authService } from './services/auth';
import { catalogService, type ListProductsParams, type ListAllProductsParams } from './services/catalog';
import { cartService } from './services/cart';
import {
  ordersService,
  type CheckoutPayload,
  type CustomerOrderEditOperation,
  type PagedOrders,
} from './services/orders';
import { accountService, addressesService, type AddressInput } from './services/account';
import type { PricingMode } from '../types';
import { api, setPricingModeHeader, getPricingModeHeader } from './client';
import type { OrderProgressView } from '../orderProgress';
import { productsByIdsCached, clearProductCache } from './productCache';
import { helpCenterService } from './services/helpCenter';
import { storesService, type StoresListParams, type StoreProductsParams } from './services/stores';
import { publicSettings, type PublicStoreSettings } from './services/admin';
import { brandsService, originsService } from './services/brandsOrigins';
import type { StoreDetail } from '../types';

export type { PublicStoreSettings };

// ─── Catalog ────────────────────────────────────────────

export const useProducts = (params: ListAllProductsParams = {}, options: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: ['products', params],
    queryFn: () => catalogService.listProducts(params),
    enabled: options.enabled ?? true,
  });

export const useCategories = () =>
  useQuery({ queryKey: ['categories'], queryFn: () => catalogService.listCategories() });

export const useSubcategories = (categoryId: string | undefined) =>
  useQuery({
    queryKey: ['subcategories', categoryId],
    queryFn: () => catalogService.listSubcategories(categoryId!),
    enabled: !!categoryId,
  });

// Third-tier taxonomy — product types scoped to one subcategory. Only
// fires when a subcategory is picked. See productTypesService.
import { productTypesService } from './services/productTypes';
export const useProductTypesForSubcategory = (subcategoryId: string | undefined) =>
  useQuery({
    queryKey: ['product-types', 'subcategory', subcategoryId],
    queryFn: () => productTypesService.listForSubcategory(subcategoryId!),
    enabled: !!subcategoryId,
  });

export const useCategoryProducts = (categoryId: string | undefined, params: ListProductsParams = {}) =>
  useQuery({
    queryKey: ['category-products', categoryId, params],
    queryFn: () => catalogService.listCategoryProducts(categoryId!, params),
    enabled: !!categoryId,
  });

export const useRelatedProducts = (id: string | undefined, limit = 12) =>
  useQuery({
    queryKey: ['product-related', id, limit],
    queryFn: () => catalogService.relatedProducts(id!, limit),
    enabled: !!id,
  });

export const useProduct = (id: string | undefined) =>
  useQuery({
    queryKey: ['product', id],
    queryFn: () => catalogService.getProduct(id!),
    enabled: !!id,
  });

export const useFeaturedProducts = (limit?: number) =>
  useQuery({ queryKey: ['featured-products', limit], queryFn: () => catalogService.featuredProducts(limit) });

/**
 * Fetch a specific list of products by id, preserving the caller's order.
 * Used by FavoritesPage so the "wide fetch + client filter" no longer caps
 * favourites at ~200. Disabled while the id list is empty so we don't hit
 * the server every render.
 *
 * The id list is part of the query key, so changing it starts a DIFFERENT
 * query with an empty cache. Without a placeholder, removing one item blanks
 * every consumer of this hook until the refetch lands: the rashan builder
 * emptied its item list AND dropped its subtotal to EUR 0 mid-remove, and the
 * cart and favourites grids flash the same way.
 *
 * Keeping the previous rows during the transition is not just cosmetic — a
 * removal produces a SUBSET of what was already fetched, so the old data
 * still answers every lookup the new list makes. An addition is briefly one
 * row short, which is a far better failure than blanking the screen.
 *
 * First load is unaffected: with no previous data there is no placeholder, so
 * `isLoading` is still true and skeletons still show.
 */
export const useProductsByIds = (ids: string[], options: { inlineErrors?: boolean } = {}) =>
  useQuery({
    queryKey: ['products-by-ids', ids],
    // Only what the basket has not fetched in the last minute — see
    // productCache.ts. Before, one "+" re-downloaded the whole basket.
    queryFn: () => productsByIdsCached(ids, (missing) => catalogService.productsByIds(missing), getPricingModeHeader()),
    enabled: ids.length > 0,
    placeholderData: (previous) => previous,
    // A screen holding unsaved work shows the failure itself rather than
    // being swapped for the 500 page.
    meta: options.inlineErrors ? INLINE_ERRORS : undefined,
  });

export const useSponsoredProducts = (limit?: number) =>
  useQuery({ queryKey: ['sponsored-products', limit], queryFn: () => catalogService.sponsoredProducts(limit) });

export const useInfiniteProducts = (
  params: Omit<ListAllProductsParams, 'page'> = {},
  options: { enabled?: boolean; inlineErrors?: boolean } = {},
) =>
  useInfiniteQuery({
    queryKey: ['products-infinite', params],
    queryFn: ({ pageParam = 1 }) =>
      catalogService.listProducts({ ...params, page: pageParam as number }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: options.enabled ?? true,
    meta: options.inlineErrors ? INLINE_ERRORS : undefined,
  });

export const useBanners = () =>
  useQuery({ queryKey: ['banners'], queryFn: () => catalogService.banners() });

export const useSearchSuggestions = (q: string) =>
  useQuery({
    queryKey: ['search-suggestions', q],
    queryFn: () => catalogService.searchSuggestions(q),
    enabled: q.trim().length >= 2,
  });

export const useSearch = (q: string, params: ListProductsParams = {}) =>
  useQuery({
    queryKey: ['search', q, params],
    queryFn: () => catalogService.search(q, params),
    enabled: q.trim().length > 0,
  });

/**
 * Infinite / load-more variant of useSearch — feeds the customer-side
 * search results grid so the "Load more" button can append the next
 * page instead of overwriting.
 */
export const useInfiniteSearch = (
  q: string,
  params: Omit<ListProductsParams, 'page'> = {},
  options: { enabled?: boolean } = {},
) =>
  useInfiniteQuery({
    queryKey: ['search-infinite', q, params],
    queryFn: ({ pageParam = 1 }) =>
      catalogService.search(q, { ...params, page: pageParam as number }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: (options.enabled ?? true) && q.trim().length > 0,
  });

// ─── Cart ───────────────────────────────────────────────

export const useCart = (opts?: { enabled?: boolean }) =>
  useQuery({ queryKey: ['cart'], queryFn: () => cartService.get(), ...opts });

export const useAddToCart = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, variantId, quantity }: { productId: string; variantId: string; quantity: number }) =>
      cartService.add(productId, variantId, quantity),
    onSuccess: (data) => qc.setQueryData(['cart'], data),
  });
};

export const useUpdateCartQuantity = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ variantId, quantity }: { variantId: string; quantity: number }) =>
      cartService.updateQuantity(variantId, quantity),
    onSuccess: (data) => qc.setQueryData(['cart'], data),
  });
};

export const useRemoveCartItem = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (variantId: string) => cartService.remove(variantId),
    onSuccess: (data) => qc.setQueryData(['cart'], data),
  });
};

export const useClearCart = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => cartService.clear(),
    onSuccess: (data) => qc.setQueryData(['cart'], data),
  });
};

// ─── Orders ─────────────────────────────────────────────

export const useOrders = (params: { status?: string; page?: number; limit?: number } = {}) =>
  useQuery({ queryKey: ['orders', params], queryFn: () => ordersService.list(params) });

/** An order still on its way, in route order (the API's IN_PROGRESS_STATUSES). */
export const ORDER_STATUSES_IN_PROGRESS = ['pending', 'confirmed', 'preparing', 'on_the_way'] as const;
const inProgressOnly = (d: PagedOrders) =>
  d.items.filter((o) => (ORDER_STATUSES_IN_PROGRESS as readonly string[]).includes(o.status));

/**
 * The orders still on their way, kept live — the business home's order bar (2026-11-01, user:
 * "this order bar should be properly functional… if there are no orders then it should not show
 * up"). Refetched every 20s while the page is visible and whenever the window comes back into
 * focus, so a status the team moves on reaches the bar without a reload; and under the 'orders'
 * key, so placing, editing or cancelling an order refreshes it at once. `active` asks the API for
 * just those; an older API ignores it and sends the newest orders, so they're filtered here too.
 */
export const useOrdersInProgress = (opts: { refetchInterval?: number } = {}) =>
  useQuery({
    queryKey: ['orders', { active: true }],
    queryFn: () => ordersService.list({ active: 1, limit: 50 }),
    select: inProgressOnly,
    refetchInterval: opts.refetchInterval ?? 20_000,
    refetchOnWindowFocus: true,
  });

/** Load-more variant for the customer order history page. */
export const useInfiniteOrders = (
  params: Omit<{ status?: string; page?: number; limit?: number; home_grocery?: 'exclude' }, 'page'> = {},
  options: { enabled?: boolean } = {},
) =>
  useInfiniteQuery({
    enabled: options.enabled ?? true,
    queryKey: ['orders-infinite', params],
    queryFn: ({ pageParam = 1 }) => ordersService.list({ ...params, page: pageParam as number }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });

export const useOrder = (id: string | undefined) =>
  useQuery({ queryKey: ['order', id], queryFn: () => ordersService.get(id!), enabled: !!id });

/**
 * The order, read for an edit screen that freezes it as its starting point.
 * Its own key and nothing kept after the screen goes (gcTime 0), so the seed
 * is never an older cached copy — the rep's useSalesOrderForEdit, for a
 * customer's own order.
 */
export const useMyOrderForEdit = (id: string | undefined) =>
  useQuery({ queryKey: ['order', id, 'for-edit'], queryFn: () => ordersService.get(id!), enabled: !!id, gcTime: 0 });

export const useTrackOrder = (id: string | undefined, opts?: { refetchInterval?: number }) =>
  useQuery({
    queryKey: ['order-track', id],
    queryFn: () => ordersService.track(id!),
    enabled: !!id,
    refetchInterval: opts?.refetchInterval ?? 30_000,
  });

/**
 * `inlineErrors` tells an app's global error handler to leave this one alone.
 * The web sends any 5xx to its /500 page, which tears down the page it came
 * from — and checkout explains its own failures in place, with a way to retry.
 * Sending a shopper mid-order to "Something broke on our end" is what made a
 * slow 600-line order on production look like a crash.
 */
const INLINE_ERRORS = { inlineErrors: true } as const;

export const useOrderQuote = () =>
  useMutation({
    mutationFn: (addressId: string) => ordersService.quote(addressId),
    meta: INLINE_ERRORS,
  });

/**
 * How far a running order operation has got — checkout, a built order's
 * create, a save, a cancel — asked once a second while `key` is set. The key
 * is the one the request was sent with (see orderProgress.ts in this package
 * and in the API).
 *
 * NEVER THROWS. Any failure — no record (404: an older API, another server
 * instance, or simply not started yet), a timeout, a 5xx — comes back as
 * null, which the page reads as "no news, keep going". A thrown error here
 * would reach the apps' query error handlers, and the admin's sends a 5xx on
 * a screen with no data to the error page: the very basket this is meant to
 * reassure someone about would be thrown away.
 */
export const useOrderProgress = (key: string | null, scope: 'user' | 'admin' = 'user') => {
  const qc = useQueryClient();
  const queryKey = ['order-progress', scope, key];
  return useQuery({
    queryKey,
    queryFn: async (): Promise<OrderProgressView | null> => {
      try {
        const path = scope === 'admin' ? `/api/admin/orders/progress/${key}` : `/api/orders/progress/${key}`;
        return await api.get<OrderProgressView>(path, undefined, { timeoutMs: 5_000 });
      } catch {
        // One failed poll keeps the last answer. Null here would draw the
        // first step as under way again, halfway through the order.
        return qc.getQueryData<OrderProgressView | null>(queryKey) ?? null;
      }
    },
    enabled: !!key,
    // Stop asking once the server has said how it ended.
    refetchInterval: (q) => (q.state.data?.done || q.state.data?.failed ? false : 1_000),
    refetchIntervalInBackground: true,
    retry: false,
    staleTime: 0,
    gcTime: 60_000,
  });
};

export const useCheckout = () => {
  const qc = useQueryClient();
  return useMutation({
    /**
     * `idempotencyKey` rides alongside the payload rather than inside it: it
     * describes the ATTEMPT, not the order, and the server reads it from a
     * header. A caller that omits it gets the old behaviour exactly.
     */
    mutationFn: ({ idempotencyKey, ...payload }: CheckoutPayload & { idempotencyKey?: string }) =>
      ordersService.checkout(payload, idempotencyKey),
    meta: INLINE_ERRORS,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['cart'] });
    },
  });
};

export const useCancelOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason, progressKey }: { id: string; reason?: string; progressKey?: string }) =>
      ordersService.cancel(id, reason, progressKey),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', vars.id] });
    },
  });
};

/**
 * Apply a batch of customer edits to a placed order.
 *
 * Invalidates the order itself AND the list, because an edit moves the
 * total, and the list renders it. Does NOT invalidate the cart — editing
 * an order and shopping are separate baskets, and blowing the cart away
 * because someone fixed a quantity on last week's order would be its own
 * bug.
 */
export const useEditMyOrderItems = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, operations, progressKey }: { id: string; operations: CustomerOrderEditOperation[]; progressKey?: string }) =>
      ordersService.editItems(id, operations, progressKey),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', vars.id] });
    },
  });
};

export const useSetMyOrderNotes = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, customerNotes }: { id: string; customerNotes: string }) =>
      ordersService.setNotes(id, customerNotes),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['order', vars.id] });
    },
  });
};

export const useReorder = () => {
  const qc = useQueryClient();
  return useMutation({
    /** An order id (replaces the cart, as before), or the id and how. */
    mutationFn: (v: string | { id: string; mode: 'add' | 'replace' }) =>
      (typeof v === 'string' ? ordersService.reorder(v) : ordersService.reorder(v.id, v.mode)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cart'] }),
  });
};

// ─── Account ────────────────────────────────────────────

export const useMe = (opts?: Partial<UseQueryOptions<Awaited<ReturnType<typeof accountService.me>>>>) =>
  useQuery({ queryKey: ['me'], queryFn: () => accountService.me(), ...opts });

/**
 * Toggle retail ↔ wholesale pricing for an approved business customer.
 *
 * Invalidates every catalogue query as well as ['me'], because the prices
 * already sitting in the React Query cache were fetched under the previous
 * mode — without this the grid keeps showing stale retail prices until
 * something else triggers a refetch.
 */
export const useSetPricingMode = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (mode: PricingMode) => accountService.setPricingMode(mode),
    // Returned, not fired and forgotten. React Query awaits a promise from
    // onSuccess before the mutation settles, so isPending / mutateAsync now
    // cover the catalogue refetch as well as the POST. Without this the
    // mutation reported success while every price on screen was still the
    // old one, and callers had no way to know when the switch had actually
    // landed — only that the server had accepted it.
    onSuccess: (_data, mode) => {
      // Must happen BEFORE invalidateQueries below, not after: the browser's
      // HTTP cache for catalogue GETs keys on this header (see http-cache.ts).
      // The refetches triggered by invalidateQueries fire synchronously off
      // this same tick — if the header still held the old mode when they
      // went out, they'd match the pre-switch cache entry and hand back the
      // old prices even though React Query "refetched".
      setPricingModeHeader(mode);
      // The basket's product cache is per mode already; dropping it as well
      // means nothing priced the old way can answer a refetch below.
      clearProductCache();
      return Promise.all(
        ['me', 'product', 'products', 'products-by-ids', 'products-infinite', 'featured-products',
         'sponsored-products', 'search', 'category-products', 'store-products']
          .map((key) => qc.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
};

export const useUpdateProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { name?: string; email?: string }) => accountService.updateProfile(payload),
    onSuccess: (data) => qc.setQueryData(['me'], data),
  });
};

export const useUpdateAvatar = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (avatarUrl: string) => accountService.updateAvatar(avatarUrl),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
};

export const useDeleteAccount = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => accountService.deleteAccount(),
    onSuccess: () => qc.clear(),
  });
};

export const useAddresses = () =>
  useQuery({ queryKey: ['addresses'], queryFn: () => addressesService.list() });

export const useCreateAddress = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddressInput) => addressesService.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
  });
};

export const useUpdateAddress = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AddressInput }) => addressesService.update(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
  });
};

export const useDeleteAddress = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => addressesService.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
  });
};

export const useSetDefaultAddress = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => addressesService.setDefault(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
  });
};

// ─── Auth mutations ─────────────────────────────────────

export const useSendOtp = () =>
  useMutation({ mutationFn: ({ phone, countryCode }: { phone: string; countryCode?: string }) => authService.sendOtp(phone, countryCode) });

export const useVerifyOtp = () =>
  useMutation({ mutationFn: ({ phone, otp, countryCode }: { phone: string; otp: string; countryCode?: string }) => authService.verifyOtp(phone, otp, countryCode) });

export const useEmailLogin = () =>
  useMutation({ mutationFn: ({ email, password }: { email: string; password: string }) => authService.loginEmail(email, password) });

export const useEmailRegister = () =>
  useMutation({ mutationFn: ({ name, email, password }: { name: string; email: string; password: string }) => authService.registerEmail(name, email, password) });

export const useGoogleSignIn = () =>
  useMutation({ mutationFn: ({ accessToken }: { accessToken: string }) => authService.googleSignIn(accessToken) });

export const useLogout = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => authService.logout(),
    onSuccess: () => qc.clear(),
  });
};

export const useChangePassword = () =>
  useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      authService.changePassword(currentPassword, newPassword),
  });

export const useForgotPassword = () =>
  useMutation({
    mutationFn: ({ email }: { email: string }) => authService.forgotPassword(email),
  });

export const useResetPassword = () =>
  useMutation({
    mutationFn: ({ token, newPassword }: { token: string; newPassword: string }) =>
      authService.resetPassword(token, newPassword),
  });

// ─── Rashan (customer) ─────────────────────────────────

import { rashanService, type CreateSubscriptionPayload, type UpdateSubscriptionPayload } from './services/rashan';

export const useRashanPacks = () =>
  useQuery({
    queryKey: ['rashan-packs'],
    queryFn: () => rashanService.listPacks(),
    staleTime: 5 * 60 * 1000,
  });

export const useRashanPack = (slug: string | undefined) =>
  useQuery({
    queryKey: ['rashan-pack', slug],
    queryFn: () => rashanService.getPack(slug!),
    enabled: !!slug,
  });

/** Needs a session — pass `enabled: false` when signed out rather than
 *  firing a request that can only 401. */
export const useRashanSubscriptions = (opts: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: ['rashan-subscriptions'],
    queryFn: () => rashanService.listSubscriptions(),
    enabled: opts.enabled ?? true,
  });

export const useRashanSubscription = (id: string | undefined) =>
  useQuery({
    queryKey: ['rashan-subscription', id],
    queryFn: () => rashanService.getSubscription(id!),
    enabled: !!id,
  });

const invalidateSubs = (qc: ReturnType<typeof useQueryClient>, id?: string) => {
  qc.invalidateQueries({ queryKey: ['rashan-subscriptions'] });
  if (id) qc.invalidateQueries({ queryKey: ['rashan-subscription', id] });
};

export const useCreateSubscription = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSubscriptionPayload) => rashanService.createSubscription(payload),
    onSuccess: () => invalidateSubs(qc),
  });
};

export const useUpdateSubscription = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateSubscriptionPayload }) =>
      rashanService.updateSubscription(id, payload),
    onSuccess: (_, vars) => invalidateSubs(qc, vars.id),
  });
};

export const usePauseSubscription = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rashanService.pauseSubscription(id),
    onSuccess: (_, id) => invalidateSubs(qc, id),
  });
};

export const useResumeSubscription = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rashanService.resumeSubscription(id),
    onSuccess: (_, id) => invalidateSubs(qc, id),
  });
};

export const useCancelSubscription = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      rashanService.cancelSubscription(id, reason),
    onSuccess: (_, vars) => invalidateSubs(qc, vars.id),
  });
};

export const useSkipNextDelivery = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rashanService.skipNext(id),
    onSuccess: (_, id) => invalidateSubs(qc, id),
  });
};

export const useConfirmNextDelivery = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rashanService.confirmNext(id),
    onSuccess: (_, id) => invalidateSubs(qc, id),
  });
};

/** Rashan packs sold by one store — the storefront's Rashan tab. */
export const useStoreRashanPacks = (slug: string | undefined) =>
  useQuery({
    queryKey: ['store-rashan-packs', slug],
    queryFn: () => storesService.listRashanPacks(slug!),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });

// ─── Home Grocery requests (customer) ──────────────────

import { rashanLeadsService, type SubmitRashanLeadPayload, type MyHomeGrocery } from './services/rashanLeads';

const MY_HOME_GROCERY_KEY = ['my-home-grocery'] as const;

/** Public — works signed out. Refreshes the signed-in view of their status,
 *  so /rashan swaps the form for "request received" without a reload. */
export const useSubmitRashanLead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SubmitRashanLeadPayload) => rashanLeadsService.submit(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: MY_HOME_GROCERY_KEY }),
  });
};

/** Where the signed-in customer stands: subscriber, waiting, or turned down
 *  (with the reason). Pass `enabled: false` when signed out — it needs a session. */
export const useMyHomeGrocery = (opts: { enabled?: boolean } = {}) =>
  useQuery<MyHomeGrocery>({
    queryKey: MY_HOME_GROCERY_KEY,
    queryFn: () => rashanLeadsService.mine(),
    enabled: opts.enabled ?? true,
  });

// ─── Home Grocery plan (customer) ──────────────────────

import {
  homeGroceryPlanService,
  type HomeGroceryPlanView,
  type CreatePlanPayload,
  type PlanItem,
  type PlanSettingsPayload,
  type PlanHistoryFilter,
  type PlaceHomeGroceryOrderPayload,
  type PlanSlot,
} from './services/homeGroceryPlan';

export const HOME_GROCERY_PLAN_KEY = ['home-grocery-plan'] as const;

/** The household's plan, its next delivery and the last few. Reading it is
 *  also what makes a missing next delivery, so it is safe to poll on focus. */
export const useHomeGroceryPlan = (opts: { enabled?: boolean; staleTime?: number } = {}) =>
  useQuery<HomeGroceryPlanView>({
    queryKey: HOME_GROCERY_PLAN_KEY,
    queryFn: () => homeGroceryPlanService.get(),
    enabled: opts.enabled ?? true,
    // The cart and header ask on every page; the plan page itself wants it fresh.
    ...(opts.staleTime !== undefined ? { staleTime: opts.staleTime } : {}),
  });

/**
 * Every plan change answers with the whole plan view, so it goes straight into
 * the cache rather than through a refetch. History and the order lists move
 * with it: an edit rewrites the upcoming order, a skip cancels one.
 */
const usePlanMutation = <TArgs,>(fn: (args: TArgs) => Promise<HomeGroceryPlanView>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // The plan screens show their own failures in place.
    meta: INLINE_ERRORS,
    onSuccess: (view) => {
      qc.setQueryData(HOME_GROCERY_PLAN_KEY, view);
      qc.invalidateQueries({ queryKey: [...HOME_GROCERY_PLAN_KEY, 'deliveries'] });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
};

export const useCreateHomeGroceryPlan = () =>
  usePlanMutation((payload: CreatePlanPayload) => homeGroceryPlanService.create(payload));
export const useUpdatePlanItems = () =>
  usePlanMutation((items: PlanItem[]) => homeGroceryPlanService.updateItems(items));
export const useUpdatePlanSettings = () =>
  usePlanMutation((payload: PlanSettingsPayload) => homeGroceryPlanService.updateSettings(payload));
export const usePausePlan = () => usePlanMutation((_: void) => homeGroceryPlanService.pause());
export const useResumePlan = () => usePlanMutation((_: void) => homeGroceryPlanService.resume());
export const useSkipPlanDelivery = () => usePlanMutation((_: void) => homeGroceryPlanService.skip());

/**
 * Place a Home Grocery order from the plan page. It is an order: the order
 * lists move, and so does the plan (what is under way, when the next is due).
 * Fails in place — the screen holds a list the household built.
 */
export const usePlaceHomeGroceryOrder = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, key }: { payload: PlaceHomeGroceryOrderPayload; key: string }) =>
      homeGroceryPlanService.placeOrder(payload, key),
    meta: INLINE_ERRORS,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: HOME_GROCERY_PLAN_KEY });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
};

/** Move one of the household's Home Grocery orders to another day or part of the day. */
export const useChangeOrderSlot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, slot }: { orderId: string; slot: PlanSlot }) =>
      homeGroceryPlanService.changeSlot(orderId, slot),
    meta: INLINE_ERRORS,
    onSuccess: (_res, { orderId }) => {
      qc.invalidateQueries({ queryKey: ['order', orderId] });
      qc.invalidateQueries({ queryKey: HOME_GROCERY_PLAN_KEY });
      qc.invalidateQueries({ queryKey: ['orders'] });
    },
  });
};

/** The plan's deliveries, newest first, a page at a time ("Load more"). */
export const usePlanDeliveries = (filter: PlanHistoryFilter, opts: { enabled?: boolean; limit?: number } = {}) =>
  useInfiniteQuery({
    // The page size is part of the key: a 5-row preview and the 10-row list
    // must not share pages, or the list would page on from the preview's.
    queryKey: [...HOME_GROCERY_PLAN_KEY, 'deliveries', filter, opts.limit ?? 10],
    queryFn: ({ pageParam = 1 }) =>
      homeGroceryPlanService.deliveries({ status: filter, page: pageParam as number, limit: opts.limit ?? 10 }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: opts.enabled ?? true,
  });

// ─── B2B Leads (customer) ──────────────────────────────

import {
  leadsService,
  type SubmitLeadPayload,
  type LeadStatusView,
  type ResubmitLeadPayload,
} from './services/leads';

export const useSubmitLead = () =>
  useMutation({
    mutationFn: (payload: SubmitLeadPayload) => leadsService.submit(payload),
  });

// MV Slice 1 — magic-link resubmit flow, public (unauthenticated). Token is
// its own authentication; retry/refetch is fine because the API is idempotent
// on GET and single-use invalidation on POST.
export const useLeadStatusByToken = (token: string | undefined) =>
  useQuery<LeadStatusView>({
    queryKey: ['lead-status', token],
    queryFn: () => leadsService.getStatusByToken(token as string),
    enabled: !!token,
    // Never retry on 404 — an invalid/expired token doesn't get better.
    retry: false,
  });

export const useResubmitLead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ token, payload }: { token: string; payload: ResubmitLeadPayload }) =>
      leadsService.resubmit(token, payload),
    onSuccess: (_data, vars) => {
      // Invalidate the status view so it re-fetches — but the token is
      // now consumed, so it'll return 404 and the page can show "submitted".
      qc.invalidateQueries({ queryKey: ['lead-status', vars.token] });
    },
  });
};

// ─── Product reviews ───────────────────────────────────

import {
  reviewsService,
  type WriteReviewPayload,
  type ReportReviewPayload,
} from './services/reviews';

export const useProductReviews = (productId: string | undefined, params: { page?: number; limit?: number } = {}) =>
  useQuery({
    queryKey: ['product-reviews', productId, params],
    queryFn: () => reviewsService.list(productId!, params),
    enabled: !!productId,
  });

/**
 * Whether the signed-in customer may write here. Guests get a 401, which is
 * expected rather than exceptional — `enabled` gates on the caller passing
 * `true`, so the product page only asks once it knows someone is signed in.
 */
export const useReviewEligibility = (productId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ['review-eligibility', productId],
    queryFn: () => reviewsService.eligibility(productId!),
    enabled: !!productId && enabled,
    retry: false,
  });

export const useWriteReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, payload }: { productId: string; payload: WriteReviewPayload }) =>
      reviewsService.write(productId, payload),
    onSuccess: (_data, vars) => {
      // The product itself carries rating / rating_count, which the write just
      // recomputed — invalidate it too or the star row keeps the old average.
      qc.invalidateQueries({ queryKey: ['product-reviews', vars.productId] });
      qc.invalidateQueries({ queryKey: ['review-eligibility', vars.productId] });
      qc.invalidateQueries({ queryKey: ['product', vars.productId] });
    },
  });
};

export const useDeleteMyReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) => reviewsService.removeMine(productId),
    onSuccess: (_data, productId) => {
      qc.invalidateQueries({ queryKey: ['product-reviews', productId] });
      qc.invalidateQueries({ queryKey: ['review-eligibility', productId] });
      qc.invalidateQueries({ queryKey: ['product', productId] });
    },
  });
};

/**
 * Report a review. Nothing is invalidated on success: a report changes no
 * visible state — the review stays exactly where it is until a human decides
 * otherwise — so refetching the list would only make the UI flicker for no
 * reason. The confirmation is the toast.
 */
export const useReportReview = () =>
  useMutation({
    mutationFn: ({ productId, reviewId, payload }: {
      productId: string;
      reviewId: string;
      payload: ReportReviewPayload;
    }) => reviewsService.report(productId, reviewId, payload),
  });

// ─── Help Center (customer) ─────────────────────────────

export const useHelpCenter = () =>
  useQuery({ queryKey: ['help-center'], queryFn: () => helpCenterService.list() });

export const useHelpArticle = (slug: string | undefined) =>
  useQuery({
    queryKey: ['help-article', slug],
    queryFn: () => helpCenterService.getArticle(slug!),
    enabled: !!slug,
  });

// ─── Support tickets (customer) ────────────────────────

import { supportService, type SubmitTicketPayload } from './services/support';

export const useSubmitSupportTicket = () =>
  useMutation({
    mutationFn: (payload: SubmitTicketPayload) => supportService.submit(payload),
  });

// ─── Notifications (customer) ──────────────────────────

import { notificationsService, type NotificationListParams } from './services/notifications';

export const useNotifications = (
  params: NotificationListParams = {},
  opts?: { refetchInterval?: number },
) =>
  useQuery({
    queryKey: ['notifications', params],
    queryFn: () => notificationsService.list(params),
    // Keep the dropdown fresh without leaning entirely on push delivery —
    // web push may be denied, and mobile FCM only reaches devices.
    refetchInterval: opts?.refetchInterval ?? 30_000,
    refetchOnWindowFocus: true,
  });

export const useUnreadNotificationCount = (opts?: { refetchInterval?: number }) =>
  useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: () => notificationsService.unreadCount(),
    // Aggressive so the bell badge feels live — cheap endpoint (one COUNT).
    refetchInterval: opts?.refetchInterval ?? 15_000,
    refetchOnWindowFocus: true,
  });

const invalidateNotifications = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['notifications'] });
  qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
};

export const useMarkNotificationRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsService.markRead(id),
    onSuccess: () => invalidateNotifications(qc),
  });
};

export const useMarkAllNotificationsRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => notificationsService.markAllRead(),
    onSuccess: () => invalidateNotifications(qc),
  });
};

export const useDeleteNotification = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsService.remove(id),
    onSuccess: () => invalidateNotifications(qc),
  });
};

// ─── Stores (customer) ──────────────────────────────────

export const useStores = (params: StoresListParams = {}) =>
  useQuery({
    queryKey: ['stores', params],
    queryFn: () => storesService.list(params),
  });

export const useStore = (slug: string | undefined) =>
  useQuery({
    queryKey: ['store', slug],
    queryFn: () => storesService.getBySlug(slug!),
    enabled: !!slug,
  });

export const useStoreProducts = (slug: string | undefined, params: StoreProductsParams = {}) =>
  useQuery({
    queryKey: ['store-products', slug, params],
    queryFn: () => storesService.listProducts(slug!, params),
    enabled: !!slug,
  });

/**
 * Infinite / load-more variant of useStoreProducts — powers the /stores/:slug
 * product grid so admins with 100+ SKUs per store don't overwhelm the page.
 * Mirrors the pattern used by useInfiniteProducts / useInfiniteSearch.
 */
export const useInfiniteStoreProducts = (
  slug: string | undefined,
  params: Omit<StoreProductsParams, 'page'> = {},
) =>
  useInfiniteQuery({
    queryKey: ['store-products-infinite', slug, params],
    queryFn: ({ pageParam = 1 }) =>
      storesService.listProducts(slug!, { ...params, page: pageParam as number }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled: !!slug,
  });

/**
 * Store-scoped taxonomy drill-down. Unlike useSubcategories /
 * useProductTypesForSubcategory (which list every subcategory / product type
 * in the whole catalogue), these only return the ones this store actually
 * has active products in — so the storefront pills never offer a dead filter.
 */
export const useStoreSubcategories = (
  slug: string | undefined,
  categoryId: string | undefined,
) =>
  useQuery({
    queryKey: ['store-subcategories', slug, categoryId],
    queryFn: () => storesService.listSubcategories(slug!, categoryId!),
    enabled: !!slug && !!categoryId,
  });

export const useStoreProductTypes = (
  slug: string | undefined,
  subcategoryId: string | undefined,
) =>
  useQuery({
    queryKey: ['store-product-types', slug, subcategoryId],
    queryFn: () => storesService.listProductTypes(slug!, subcategoryId!),
    enabled: !!slug && !!subcategoryId,
  });

export const useMyFollowedStores = (enabled = true) =>
  useQuery({
    queryKey: ['me-followed-stores'],
    queryFn: () => storesService.myFollowedStores(),
    enabled,
  });

/**
 * Toggle follow with optimistic UI. On mutate we flip is_followed and bump
 * followers_count locally; on rollback we revert. Server response is the
 * authoritative count.
 */
export const useToggleFollowStore = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slug, follow }: { slug: string; follow: boolean }) => {
      return follow ? storesService.follow(slug) : storesService.unfollow(slug);
    },
    onMutate: async ({ slug, follow }) => {
      await qc.cancelQueries({ queryKey: ['store', slug] });
      const previous = qc.getQueryData<StoreDetail>(['store', slug]);
      if (previous) {
        qc.setQueryData<StoreDetail>(['store', slug], {
          ...previous,
          is_followed: follow,
          followers_count: Math.max(0, previous.followers_count + (follow ? 1 : -1)),
        });
      }
      return { previous };
    },
    onError: (_err, { slug }, ctx) => {
      if (ctx?.previous) qc.setQueryData(['store', slug], ctx.previous);
    },
    onSettled: (_data, _err, { slug }) => {
      qc.invalidateQueries({ queryKey: ['store', slug] });
      qc.invalidateQueries({ queryKey: ['me-followed-stores'] });
    },
  });
};

// ─── Public store settings ────────────────────────────────
// Whatever the admin saves at /settings surfaces here for the customer web —
// storeName, contact info, privacy/terms copy, maintenance mode. Kept in
// react-query with a modest staleTime so a saved change ripples out within
// a minute without hammering the endpoint on every page transition.

export const useStoreSettings = () =>
  useQuery({
    queryKey: ['store-settings'],
    queryFn:  () => publicSettings.get(),
    staleTime: 60_000,
  });

// ─── Brands + Origins (first-class tables — customer marquees) ─────────

export const useBrandsList = () =>
  useQuery({
    queryKey: ['brands'],
    queryFn:  () => brandsService.list(),
    staleTime: 60_000,
  });

export const useOriginsList = () =>
  useQuery({
    queryKey: ['origins'],
    queryFn:  () => originsService.list(),
    staleTime: 60_000,
  });
