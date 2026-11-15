import { OrderStatus, Prisma, SubDeliveryStatus } from '@prisma/client';
import prisma from './prisma';
import { deleteFromBunny } from './bunny';
import { recomputeProductRating } from '../routes/reviews';
import { revokeAppleToken } from './appleTokens';

/**
 * Erase a customer account. The one implementation behind both the
 * customer's own "Delete my account" (DELETE /api/users/me) and the admin
 * action that honours a request arriving by email.
 *
 * What this removes is a public promise, not an implementation detail:
 * privacy policy §7–§8 and the /delete-account page declared to Google Play
 * both list it. Change one and change the others.
 *
 * Two shapes:
 *  - No orders: the user row is deleted and everything hanging off it goes.
 *  - Has orders: orders are accounting records Spanish law makes us keep, and
 *    they join to both the user and the address they went to through
 *    ON DELETE RESTRICT keys. Those rows stay, stripped of anything that
 *    identifies the person; everything else is deleted.
 *
 * The version this replaced deleted the addresses of a customer who had
 * orders. Every order pins its address with RESTRICT, so that transaction
 * always rolled back — nobody who had ever ordered could delete their account.
 */

const ERASED_NAME = 'Deleted user';
const ERASED_STREET = 'Deleted address';

/** Still heading for the address. Anonymising it now would strand the rider. */
const ORDER_IN_PROGRESS: OrderStatus[] = ['draft', 'pending', 'confirmed', 'preparing', 'on_the_way'];
const DELIVERY_UNDERWAY: SubDeliveryStatus[] = ['preparing', 'on_the_way'];
/** The deliveries the customer-facing subscription cancel skips. Same set here. */
const DELIVERY_UPCOMING: SubDeliveryStatus[] = ['scheduled', 'awaiting_confirmation', 'confirmed'];

/**
 * Keeps postcode, city and province: what an order still needs to make sense
 * as an accounting record, and too coarse to point at a person.
 */
const ADDRESS_SCRUB: Prisma.AddressUpdateManyMutationInput = {
  contact_name: ERASED_NAME,
  contact_phone: '',
  street_line_1: ERASED_STREET,
  street_line_2: null,
  delivery_notes: null,
  latitude: null,
  longitude: null,
  geocoded_at: null,
  geocode_failed_at: null,
  is_default: false,
};

/** The same scrub for the copy of the address every order carries. */
const SNAPSHOT_SCRUB = JSON.stringify({
  contact_name: ERASED_NAME,
  contact_phone: '',
  street_line_1: ERASED_STREET,
  street_line_2: null,
  delivery_notes: null,
});

export class UserErasureError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type ErasureOutcome = { mode: 'hard' } | { mode: 'soft'; preservedOrders: number };

type RequestedBy = 'self' | 'admin';

const BLOCKED = {
  partner: {
    self: {
      es: 'Esta cuenta gestiona una tienda colaboradora. Escríbenos a support.cesto@gmail.com para cerrarla.',
      en: 'This account manages a partner shop. Write to support.cesto@gmail.com to close it.',
    },
    admin: 'This account manages a partner shop. Unlink it from the shop before deleting it.',
  },
  salesRep: {
    self: {
      es: 'Esta cuenta es de un comercial de Cesto. Pide a un administrador que retire tu acceso de ventas y luego podrás eliminarla.',
      en: 'This account belongs to a Cesto sales rep. Ask an administrator to remove your sales access, then you can delete it.',
    },
    admin: 'This account is a sales rep. Revoke the rep access first, then delete it.',
  },
  inProgress: {
    self: {
      es: 'Tienes un pedido en curso. Podrás eliminar tu cuenta cuando se haya entregado o cancelado.',
      en: 'You have an order in progress. You can delete your account once it has been delivered or cancelled.',
    },
    admin: 'This customer has an order in progress. It can be deleted once the order is delivered or cancelled.',
  },
};

export async function eraseUser(userId: string, requestedBy: RequestedBy): Promise<ErasureOutcome> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, avatar_url: true, preferred_language: true, apple_id: true, apple_token: true },
  });
  if (!user) throw new UserErasureError(404, 'User not found.');

  // A customer reads the refusal in their own language; admins get English.
  const blocked = (reason: keyof typeof BLOCKED) =>
    new UserErasureError(
      409,
      requestedBy === 'admin' ? BLOCKED[reason].admin : BLOCKED[reason].self[user.preferred_language === 'es' ? 'es' : 'en'],
    );

  const outcome = await prisma.$transaction(async (tx): Promise<ErasureOutcome> => {
    // Partner accounts own a shop. Closing one has its own flow; erasing the
    // login underneath it would orphan the store.
    if (await tx.partnerStoreRole.count({ where: { user_id: userId } })) throw blocked('partner');

    /**
     * A rep's own account is theirs, and erasing it rewrites the order book.
     *
     * `orders.created_by_sales_rep_id` is ON DELETE SET NULL, so deleting the
     * login would quietly null the attribution on every order that rep ever
     * built — and an order with no creator reads as "the customer placed
     * this themselves", which moves their whole body of work into the customer
     * book and out of their own list. Hundreds of rows, no error, nothing to
     * notice.
     *
     * So it is refused while the role is live, in the same shape and for the
     * same reason as the partner refusal above: revoking comes first, and then
     * the ordinary customer path works. Only ACTIVE reps — a revoked row is
     * history and holds nothing back.
     */
    if (await tx.salesRep.count({ where: { user_id: userId, is_active: true } })) {
      throw blocked('salesRep');
    }

    const underway =
      (await tx.order.count({ where: { user_id: userId, status: { in: ORDER_IN_PROGRESS } } })) +
      (await tx.subscriptionDelivery.count({
        where: { subscription: { user_id: userId }, status: { in: DELIVERY_UNDERWAY } },
      }));
    if (underway) throw blocked('inProgress');

    // ─── Both paths ───────────────────────────────────────

    // Reviews are public, so they go outright. The rating on each product is
    // recomputed after, or it would keep counting reviews that no longer exist.
    const reviews = await tx.productReview.findMany({ where: { user_id: userId }, select: { product_id: true } });
    await tx.productReview.deleteMany({ where: { user_id: userId } });
    for (const { product_id } of reviews) await recomputeProductRating(tx, product_id);

    // Deleted explicitly rather than left to the cascade: stores keep a
    // denormalised followers_count that a cascade would leave inflated.
    const follows = await tx.storeFollow.findMany({ where: { user_id: userId }, select: { store_id: true } });
    await tx.storeFollow.deleteMany({ where: { user_id: userId } });
    if (follows.length) {
      await tx.store.updateMany({
        where: { id: { in: follows.map((f) => f.store_id) }, followers_count: { gt: 0 } },
        data: { followers_count: { decrement: 1 } },
      });
    }

    // Business applications and quote requests hold the person's contact
    // details. They are linked by approval, or only by the email they were
    // sent from, and survive both paths (the approval link is SetNull).
    await tx.b2bLead.updateMany({
      where: {
        OR: [
          { approved_user_id: userId },
          ...(user.email ? [{ email: { equals: user.email, mode: 'insensitive' as const } }] : []),
        ],
      },
      data: { name: ERASED_NAME, email: '', phone: '', message: null },
    });

    // Home Grocery requests hold more about a household than anything else
    // here — address, family size, what they eat. Found the same three ways
    // approval finds an account: signed in when sent, approved onto it, or
    // sent from its email. These were never erased before the revamp.
    await tx.rashanLead.updateMany({
      where: {
        OR: [
          { user_id: userId },
          { approved_user_id: userId },
          ...(user.email ? [{ email: { equals: user.email, mode: 'insensitive' as const } }] : []),
        ],
      },
      data: {
        name: ERASED_NAME, phone: '', email: null,
        address_line: null, city: null, postcode: null, preferred_slot: null,
        dietary_notes: null, notes: null,
      },
    });

    const orderCount = await tx.order.count({ where: { user_id: userId } });

    // ─── No orders: delete the account outright ──────────

    if (orderCount === 0) {
      // Subscriptions first. They pin their address with RESTRICT, and the
      // cascade from the user row does not order that deletion for us.
      await tx.rashanSubscription.deleteMany({ where: { user_id: userId } });
      await tx.user.delete({ where: { id: userId } });
      return { mode: 'hard' };
    }

    // ─── Has orders: keep the records, strip the person ──

    // An address an order or subscription points at cannot be deleted
    // (RESTRICT), so it is stripped instead. Addresses nothing uses go.
    const addresses = await tx.address.findMany({
      where: { user_id: userId },
      select: { id: true, _count: { select: { orders: true, parent_orders: true, subscriptions: true } } },
    });
    const isPinned = (a: (typeof addresses)[number]) =>
      a._count.orders + a._count.parent_orders + a._count.subscriptions > 0;
    const pinned = addresses.filter(isPinned).map((a) => a.id);
    const unpinned = addresses.filter((a) => !isPinned(a)).map((a) => a.id);
    if (unpinned.length) await tx.address.deleteMany({ where: { id: { in: unpinned } } });
    if (pinned.length) await tx.address.updateMany({ where: { id: { in: pinned } }, data: ADDRESS_SCRUB });

    // Each order also keeps its own copy of the address. `||` overwrites only
    // the identifying keys, so anything else in the snapshot survives.
    await tx.$executeRaw`
      UPDATE "orders"
         SET "address_snapshot" = "address_snapshot" || ${SNAPSHOT_SCRUB}::jsonb,
             "customer_notes" = NULL
       WHERE "user_id" = ${userId}::uuid`;
    await tx.$executeRaw`
      UPDATE "parent_orders"
         SET "address_snapshot" = "address_snapshot" || ${SNAPSHOT_SCRUB}::jsonb,
             "customer_notes" = NULL
       WHERE "user_id" = ${userId}::uuid`;

    // Stop Rashan deliveries exactly as the customer-facing cancel does. The
    // subscription row stays because its address is one of the pinned ones.
    const subs = await tx.rashanSubscription.findMany({
      where: { user_id: userId, status: { not: 'cancelled' } },
      select: { id: true },
    });
    if (subs.length) {
      const ids = subs.map((s) => s.id);
      await tx.subscriptionDelivery.updateMany({
        where: { subscription_id: { in: ids }, status: { in: DELIVERY_UPCOMING } },
        data: { status: 'skipped' },
      });
      await tx.rashanSubscription.updateMany({
        where: { id: { in: ids } },
        data: { status: 'cancelled', cancelled_at: new Date(), cancellation_reason: 'Account deleted', next_delivery_date: null },
      });
    }

    // Everything else exists only for the account's own use.
    await tx.cartItem.deleteMany({ where: { user_id: userId } });
    await tx.notification.deleteMany({ where: { user_id: userId } });
    await tx.webPushSubscription.deleteMany({ where: { user_id: userId } });
    await tx.userRefreshToken.deleteMany({ where: { user_id: userId } }); // signs every device out
    await tx.authHandoffToken.deleteMany({ where: { user_id: userId } });
    await tx.passwordResetToken.deleteMany({ where: { user_id: userId } });
    await tx.productReviewReport.deleteMany({ where: { reporter_id: userId } });
    await tx.businessProfile.deleteMany({ where: { user_id: userId } });
    await tx.homeGroceryProfile.deleteMany({ where: { user_id: userId } });
    await tx.appleToken.deleteMany({ where: { user_id: userId } }); // revoked with Apple after the commit

    // The row itself stays because orders join to it. google_id and apple_id
    // go too, or a later Google/Apple sign-in could reattach to it.
    await tx.user.update({
      where: { id: userId },
      data: {
        name: ERASED_NAME,
        email: null,
        phone: null,
        phone_country_code: null,
        password_hash: null,
        google_id: null,
        apple_id: null,
        avatar_url: null,
        fcm_token: null,
        status: 'blocked',
        is_business: false,
        pricing_mode: 'retail',
      },
    });

    return { mode: 'soft', preservedOrders: orderCount };
  }, { maxWait: 5_000, timeout: 20_000 });

  // After the commit, and best-effort: a CDN failure must not undo an erasure
  // the database has already made. The photo is unreachable from the account
  // either way, since avatar_url is gone.
  if (user.avatar_url) await deleteFromBunny(user.avatar_url).catch(() => false);

  // Sign in with Apple must be revoked when the account goes (App Review
  // 5.1.1(v)): it removes Cesto from the customer's "Apps using Apple ID".
  // After the commit, like the photo — Apple being unreachable must not undo
  // an erasure — and logged with enough to finish it by hand.
  if (user.apple_token) {
    await revokeAppleToken(user.apple_token.refresh_token, user.apple_token.client_id)
      .then((done) => {
        if (!done) console.warn(`[apple] not configured; Apple sign-in for erased user ${userId} was not revoked`);
      })
      .catch((err) => console.error(`[apple] revoking Apple sign-in for erased user ${userId} failed:`, err instanceof Error ? err.message : err));
  } else if (user.apple_id) {
    console.warn(`[apple] erased user ${userId} signed in with Apple but no token was kept; nothing to revoke`);
  }

  return outcome;
}
