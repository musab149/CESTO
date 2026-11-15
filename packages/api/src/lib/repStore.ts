import type { Prisma } from '@prisma/client';
import prisma from './prisma';

/**
 * The shops a sales rep sells from.
 *
 * 2026-10-25, the user: "Admin will be able to assign the rep a store and then
 * rep will be only able to see the products in his panel from that assigned
 * store. If no store is assigned then the rep will not be able to create the
 * orders." 2026-10-26: "now admin can assign multiple stores to the rep and
 * from those assigned stores the products will show to them".
 *
 * Any number of partner shops (SalesRepStore rows) and, beside them, Cesto's
 * own catalogue — products with no shop, which has no Store row
 * (SalesRep.house_store). With none of either, or only shops that can no
 * longer be sold from, the rep sees no products and every order they build or
 * add to is refused. A shop that cannot be sold from drops out on its own; the
 * others still sell. Lines already on an order from elsewhere stay: a rep may
 * still change, discount or remove them.
 *
 * The order stays Cesto's either way (lib/createOrder) — the user's decision:
 * this narrows what a rep may pick, not who fulfils it.
 *
 * AND SINGLE PRODUCTS (2026-10-27, the user: "assign any products to the rep
 * and these products can be from any store and they show up in catalogue of
 * the rep and when they are creating the orders or edit"). An admin may
 * assign products one by one (SalesRepProduct), from any shop or Cesto's own,
 * on top of the shops. The rep sees and sells every size of one while it is
 * active and its shop could be sold from — the same test a shop passes, so a
 * product does not outlive the shop it belongs to being suspended. A rep with
 * assigned products and no shop builds orders from those alone.
 *
 * Enforced on the server, in /api/sales/* — the catalogue, its filter lists,
 * order create, order edit adds and quick-add — not by the screens.
 */

/** The `id` a client sees for Cesto's own catalogue, as in product filters. */
export const HOUSE_STORE_ID = 'cesto';
export const HOUSE_STORE_NAME = 'Cesto Shop';

/** Why a shop that is assigned cannot be sold from. */
export type RepStoreUnavailable = 'inactive' | 'suspended' | 'deleting' | 'deleted';

export interface RepShop {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  unavailable: RepStoreUnavailable | null;
}

/** Cesto's own catalogue, the partner shops, and the single products the rep sells. */
export interface RepStore {
  house: boolean;
  shops: RepShop[];
  /** Whose assigned products — null for a RepStore built without the rep. */
  repId: string | null;
  /** How many products are assigned to them by hand, in any state; 0 = none. */
  products: number;
}

const STORE_FIELDS = {
  id: true, name: true, slug: true, logo_url: true,
  is_active: true, status: true, deletion_scheduled_at: true, deleted_at: true,
} as const;

/** What a SalesRep select needs to resolve it. */
export const REP_STORE_SELECT = {
  user_id: true,
  house_store: true,
  stores: { select: { store: { select: STORE_FIELDS } } },
  _count: { select: { products: true } },
} as const;

/** A shop that can be sold from, as a where — `unavailableReason`'s rule. */
export const SELLABLE_STORE: Prisma.StoreWhereInput = {
  deleted_at: null, deletion_scheduled_at: null, is_active: true, status: { not: 'suspended' },
};

/**
 * The products assigned to this rep by hand that may be sold: the product's
 * shop could be sold from (or it is Cesto's own). Active is the caller's —
 * every read here forces it already.
 */
export function assignedScope(repId: string): Prisma.ProductWhereInput {
  return {
    rep_assignments: { some: { sales_rep_id: repId } },
    OR: [{ store_id: null }, { store: SELLABLE_STORE }],
  };
}

type StoreRow = {
  id: string; name: string; slug: string; logo_url: string | null;
  is_active: boolean; status: string; deletion_scheduled_at: Date | null; deleted_at: Date | null;
};

/**
 * Why a shop cannot be sold from, or null when it can. Draft and paused shops
 * can: the order is Cesto's, so a shop not yet open to shoppers, or one its
 * partner paused, does not stop Cesto selling its products.
 */
export function unavailableReason(s: Pick<StoreRow, 'is_active' | 'status' | 'deletion_scheduled_at' | 'deleted_at'>): RepStoreUnavailable | null {
  if (s.deleted_at) return 'deleted';
  if (s.deletion_scheduled_at) return 'deleting';
  if (!s.is_active) return 'inactive';
  if (s.status === 'suspended') return 'suspended';
  return null;
}

export function repStoreFrom(row: {
  user_id?: string;
  house_store: boolean;
  stores: { store: StoreRow }[];
  _count?: { products: number };
} | null | undefined): RepStore {
  if (!row) return { house: false, shops: [], repId: null, products: 0 };
  return {
    house: row.house_store,
    shops: row.stores
      .map(({ store: s }) => ({ id: s.id, name: s.name, slug: s.slug, logo_url: s.logo_url, unavailable: unavailableReason(s) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    repId: row.user_id ?? null,
    products: row._count?.products ?? 0,
  };
}

/** The partner shops that can be sold from right now. */
export function sellableShopIds(s: RepStore): string[] {
  return s.shops.filter((x) => !x.unavailable).map((x) => x.id);
}

/** True when this rep has a shop of their own to sell from (quick-add needs one). */
export function hasShop(s: RepStore): boolean {
  return s.house || sellableShopIds(s).length > 0;
}

/**
 * True when this rep can build orders at all: a shop, or products assigned to
 * them by hand. Assigned products that have since gone inactive still count —
 * the catalogue then shows none, and that says why better than a refusal.
 */
export function sellsFrom(s: RepStore): boolean {
  return hasShop(s) || (s.repId !== null && s.products > 0);
}

/**
 * The products this rep may sell, as a where-fragment to AND in. A rep who
 * can sell nothing gets a condition no product meets.
 */
export function repProductScope(s: RepStore): Prisma.ProductWhereInput {
  const ids = sellableShopIds(s);
  const arms: Prisma.ProductWhereInput[] = [];
  if (s.house) arms.push({ store_id: null });
  if (ids.length) arms.push({ store_id: { in: ids } });
  if (s.repId && s.products > 0) arms.push(assignedScope(s.repId));
  if (arms.length === 0) return { id: { in: [] } };
  return arms.length === 1 ? arms[0] : { OR: arms };
}

/** Whether a product's shop (null = Cesto's own) is one this rep may sell from. */
export function sellsFromShop(s: RepStore, storeId: string | null): boolean {
  return storeId === null ? s.house : sellableShopIds(s).includes(storeId);
}

/** One entry of what /api/sales/me and the admin rep screens read. */
export interface RepStoreView {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  sellable: boolean;
  unavailable: RepStoreUnavailable | null;
}

/** Cesto's own first, then the shops by name. Empty = none assigned. */
export function repStoresView(s: RepStore): RepStoreView[] {
  return [
    ...(s.house ? [{ id: HOUSE_STORE_ID, name: HOUSE_STORE_NAME, slug: HOUSE_STORE_ID, logo_url: null, sellable: true, unavailable: null }] : []),
    ...s.shops.map((x) => ({ id: x.id, name: x.name, slug: x.slug, logo_url: x.logo_url, sellable: !x.unavailable, unavailable: x.unavailable })),
  ];
}

/**
 * The one shop the screens before 2026-10-26 read as `store`: the first that
 * can be sold from, else the first assigned, else null. Sent beside `stores`
 * so a page loaded before the deploy still says something true.
 */
export function legacyStoreView(s: RepStore): RepStoreView | null {
  const all = repStoresView(s);
  return all.find((x) => x.sellable) ?? all[0] ?? null;
}

/** The refusal a rep gets, and what the screens read to say it in Spanish. */
export const REP_NO_STORE = 'rep_no_store';
export const REP_OUTSIDE_STORE = 'rep_outside_store';
/** Quick-add by a rep with several shops, without saying which. */
export const REP_PICK_STORE = 'rep_pick_store';

export function noStoreMessage(s: RepStore): string {
  if (s.shops.length > 0) {
    const names = s.shops.map((x) => x.name).join(', ');
    return s.shops.length === 1
      ? `Your shop, ${names}, cannot be sold from right now. Ask an admin to assign you another.`
      : `None of your shops can be sold from right now (${names}). Ask an admin to assign you another.`;
  }
  return 'You have no shop or product assigned yet. Ask an admin to assign you some before building orders.';
}

/**
 * Of these product sizes, the products outside what this rep may sell, by
 * name — for the refusal. Empty when they are all theirs to sell.
 */
export async function productsOutsideRepStore(s: RepStore, variantIds: string[]): Promise<string[]> {
  if (variantIds.length === 0) return [];
  const byHand = s.repId !== null && s.products > 0;
  const rows = await prisma.productVariant.findMany({
    where: { id: { in: [...new Set(variantIds)] } },
    select: {
      product: {
        select: {
          name_es: true,
          store_id: true,
          store: { select: { is_active: true, status: true, deletion_scheduled_at: true, deleted_at: true } },
          // Assigned to this rep by hand — read only when they have any.
          ...(byHand ? { rep_assignments: { where: { sales_rep_id: s.repId! }, select: { product_id: true } } } : {}),
        },
      },
    },
  });
  const theirs = (p: (typeof rows)[number]['product']) => {
    if (sellsFromShop(s, p.store_id)) return true;
    const assigned = ((p as { rep_assignments?: unknown[] }).rep_assignments ?? []).length > 0;
    return assigned && (p.store === null || unavailableReason(p.store) === null);
  };
  return [...new Set(rows.filter((r) => !theirs(r.product)).map((r) => r.product.name_es))];
}

/**
 * Hand a removed product's rep assignments to the one it was merged into, so
 * a rep keeps selling what the duplicate stood for. Before the duplicate is
 * deleted — that delete takes its rows with it.
 */
export async function moveRepAssignments(
  db: Pick<typeof prisma, '$executeRaw'>,
  fromId: string,
  toId: string,
): Promise<void> {
  if (fromId === toId) return;
  await db.$executeRaw`
    INSERT INTO "sales_rep_products" ("sales_rep_id", "product_id", "created_at")
    SELECT "sales_rep_id", ${toId}::uuid, "created_at" FROM "sales_rep_products" WHERE "product_id" = ${fromId}::uuid
    ON CONFLICT DO NOTHING`;
}

/**
 * The shops an admin picked, as the flag and the rows: 'cesto' for Cesto's
 * own, shop ids for the rest; empty for none. Throws for a shop that does not
 * exist, or for a NEW one that cannot be sold from — assigning it would offer
 * the rep nothing. One already assigned (`kept`) may stay while it is
 * unavailable: the screen sends the whole list, and adding a shop must not
 * fail because another one was switched off since.
 */
export async function assignmentFor(picks: string[], kept: string[] = []): Promise<{ house_store: boolean; store_ids: string[] }> {
  const unique = [...new Set(picks)];
  const house = unique.includes(HOUSE_STORE_ID);
  const ids = unique.filter((p) => p !== HOUSE_STORE_ID);
  if (ids.length === 0) return { house_store: house, store_ids: [] };
  const found = await prisma.store.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, is_active: true, status: true, deletion_scheduled_at: true, deleted_at: true },
  });
  if (found.length !== ids.length) throw new RepStoreAssignmentError('One of those shops does not exist.');
  for (const store of found) {
    if (kept.includes(store.id)) continue;
    const reason = unavailableReason(store);
    if (reason) throw new RepStoreAssignmentError(`${store.name} cannot be sold from (${reason}). Pick another.`);
  }
  return { house_store: house, store_ids: ids };
}

/**
 * The write that makes `assignment` the rep's shops — every one of them, so
 * shops left out are removed. For `salesRep.update` / an upsert's `update`.
 */
export function shopsWrite(a: { house_store: boolean; store_ids: string[] }) {
  return {
    house_store: a.house_store,
    stores: { deleteMany: {}, create: a.store_ids.map((store_id) => ({ store_id })) },
  };
}

/** The same, for `salesRep.create` — there is nothing to remove yet. */
export function shopsCreate(a: { house_store: boolean; store_ids: string[] }) {
  return {
    house_store: a.house_store,
    stores: { create: a.store_ids.map((store_id) => ({ store_id })) },
  };
}

export class RepStoreAssignmentError extends Error {}
