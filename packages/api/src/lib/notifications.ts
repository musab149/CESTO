// Notification service — single entry point for emitting a notification.
//
// Responsibilities:
//   1. Persist a Notification row (DB is source of truth).
//   2. Fan out to push channel (FCM/Expo) via pushDispatcher (best-effort).
//   3. Build bilingual title + body from a small set of templates so callers
//      don't repeat the same Spanish/English strings everywhere.
//
// Everything below is fire-and-forget from the caller's point of view: we
// catch and log inside the helpers so a failed notification never breaks the
// order flow that triggered it.

import { Prisma, NotificationType } from '@prisma/client';
import prisma from './prisma';
import { pushDispatcher } from './pushDispatcher';
import { webPushDispatcher } from './webPushDispatcher';
import type { EarningEvent } from './repEarnings';
import {
  sendOrderStatusEmail,
  sendOrderEditedEmail,
  sendOrderPlacedEmail,
  sendAdminAlert,
  resolveEmailLang,
  resolveAdminNotifyEmail,
  OrderStatusEmailStatus,
} from './mailer';

// ─── Bilingual builders ───────────────────────────────
// Each builder returns { title_es, title_en, body_es, body_en }. Keep the
// strings short — push providers truncate aggressively (~40 char title,
// ~120 char body on most surfaces).

interface BilingualContent {
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
}

interface OrderCtx {
  orderNumber: string;
  customerName?: string | null;
  total?: number | null;
  reason?: string | null;
}

function fmtEur(amount: number | null | undefined): string {
  if (amount == null) return '';
  return `${amount.toFixed(2).replace('.', ',')} €`;
}

function buildOrderContent(type: NotificationType, ctx: OrderCtx): BilingualContent {
  const num = `#${ctx.orderNumber}`;
  switch (type) {
    case 'order_confirmed':
      return {
        title_es: 'Pedido confirmado',
        title_en: 'Order confirmed',
        body_es: `Tu pedido ${num} ha sido confirmado. Te avisaremos cuando salga.`,
        body_en: `Your order ${num} has been confirmed. We'll let you know when it's on the way.`,
      };
    case 'order_preparing':
      return {
        title_es: 'Preparando tu pedido',
        title_en: 'Preparing your order',
        body_es: `Estamos preparando tu pedido ${num}.`,
        body_en: `We're preparing your order ${num}.`,
      };
    case 'order_on_the_way':
      return {
        title_es: 'Tu pedido está en camino',
        title_en: 'Your order is on the way',
        body_es: `Tu pedido ${num} está en camino. Estará contigo en breve.`,
        body_en: `Your order ${num} is on the way. It will be with you shortly.`,
      };
    case 'order_delivered':
      return {
        title_es: '¡Pedido entregado!',
        title_en: 'Order delivered!',
        body_es: `¡Tu pedido ${num} ha sido entregado! Gracias por tu compra.`,
        body_en: `Your order ${num} has been delivered! Thanks for shopping with us.`,
      };
    case 'order_cancelled':
      return {
        title_es: 'Pedido cancelado',
        title_en: 'Order cancelled',
        body_es: ctx.reason
          ? `Tu pedido ${num} ha sido cancelado: ${ctx.reason}`
          : `Tu pedido ${num} ha sido cancelado.`,
        body_en: ctx.reason
          ? `Your order ${num} has been cancelled: ${ctx.reason}`
          : `Your order ${num} has been cancelled.`,
      };
    case 'order_placed': {
      const amount = ctx.total != null ? ` · ${fmtEur(ctx.total)}` : '';
      return {
        title_es: 'Hemos preparado un pedido para ti',
        title_en: "We've put an order together for you",
        body_es: `Pedido ${num}${amount}. Te avisaremos cuando salga hacia ti.`,
        body_en: `Order ${num}${amount}. We'll let you know when it's on the way.`,
      };
    }
    case 'order_edited':
      return {
        title_es: 'Pedido modificado',
        title_en: 'Order updated',
        body_es: `Tu pedido ${num} fue modificado por nuestro equipo.`,
        body_en: `Your order ${num} was updated by our team.`,
      };
    case 'admin_new_order': {
      const who = ctx.customerName ? ` de ${ctx.customerName}` : '';
      const whoEn = ctx.customerName ? ` from ${ctx.customerName}` : '';
      const amount = ctx.total != null ? ` · ${fmtEur(ctx.total)}` : '';
      return {
        title_es: 'Nuevo pedido recibido',
        title_en: 'New order received',
        body_es: `Pedido ${num}${who}${amount}`,
        body_en: `Order ${num}${whoEn}${amount}`,
      };
    }
    case 'admin_order_edited': {
      const who = ctx.customerName ? `${ctx.customerName} ` : 'El cliente ';
      const whoEn = ctx.customerName ? `${ctx.customerName} ` : 'The customer ';
      const amount = ctx.total != null ? ` · ${fmtEur(ctx.total)}` : '';
      return {
        title_es: 'Pedido modificado por el cliente',
        title_en: 'Order changed by customer',
        body_es: `${who}ha modificado el pedido ${num}${amount}. Revisa el contenido antes de prepararlo.`,
        body_en: `${whoEn}changed order ${num}${amount}. Check the contents before packing it.`,
      };
    }
    default:
      throw new Error(`buildOrderContent: unsupported type "${type}"`);
  }
}

// ─── Public API ───────────────────────────────────────

interface CreateNotificationInput {
  audience: 'customer' | 'admin' | 'partner' | 'sales_rep';
  user_id: string | null;
  type: NotificationType;
  title_es: string;
  title_en: string;
  body_es: string;
  body_en: string;
  deeplink?: string | null;
  data?: Record<string, string> | null;
}

/**
 * Persists a notification + fires push best-effort. Returns the created row.
 * Never throws — callers fire-and-forget.
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<void> {
  try {
    const row = await prisma.notification.create({
      data: {
        audience: input.audience,
        user_id: input.user_id,
        type: input.type,
        title_es: input.title_es,
        title_en: input.title_en,
        body_es: input.body_es,
        body_en: input.body_en,
        deeplink: input.deeplink ?? null,
        data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
      select: { id: true, user_id: true },
    });

    // A partner login is a User like any other, so its phone and browsers are
    // reached the same way a customer's are — and so is a sales rep.
    if ((input.audience === 'customer' || input.audience === 'partner' || input.audience === 'sales_rep') && row.user_id) {
      const user = await prisma.user.findUnique({
        where: { id: row.user_id },
        select: { fcm_token: true, preferred_language: true },
      });
      const lang = user?.preferred_language === 'en' ? 'en' : 'es';
      const title = lang === 'en' ? input.title_en : input.title_es;
      const body = lang === 'en' ? input.body_en : input.body_es;
      const data = {
        notification_id: row.id,
        type: input.type,
        ...(input.deeplink ? { deeplink: input.deeplink } : {}),
        ...(input.data ?? {}),
      };

      // Mobile FCM — nothing to fan out over, the user has 0 or 1 token.
      void pushDispatcher.send({
        token: user?.fcm_token ?? null,
        title,
        body,
        data,
      });

      // Browser push — the dispatcher fans out across every subscription
      // this user has (multiple devices/browsers all get notified).
      void webPushDispatcher.send({
        ownerKind: 'customer',
        ownerId: row.user_id,
        title,
        body,
        data,
      });
    } else if (input.audience === 'admin') {
      // Admin notifications broadcast to every admin that has opted in.
      // Fan out across every admin with an active web-push subscription;
      // each admin's own dispatch is best-effort (dispatcher swallows).
      // English title/body — the admin panel is English-first.
      const data = {
        notification_id: row.id,
        type: input.type,
        ...(input.deeplink ? { deeplink: input.deeplink } : {}),
        ...(input.data ?? {}),
      };
      const subscribedAdmins = await prisma.webPushSubscription.findMany({
        where: { admin_id: { not: null } },
        select: { admin_id: true },
        distinct: ['admin_id'],
      });
      for (const { admin_id } of subscribedAdmins) {
        if (!admin_id) continue;
        void webPushDispatcher.send({
          ownerKind: 'admin',
          ownerId: admin_id,
          title: input.title_en,
          body: input.body_en,
          data,
        });
      }
    }
  } catch (err) {
    console.error('[notifications] failed to create notification', err);
  }
}

// ─── Convenience helpers ──────────────────────────────
// Thin wrappers so callers in the order routes stay readable.

export async function notifyOrderStatusChange(opts: {
  userId: string;
  orderId: string;
  orderNumber: string;
  status: OrderStatusEmailStatus;
  reason?: string | null;
  /**
   * The rep who made this change, when it was one — so the rep who built the
   * order is not told about their own cancel (see notifyRepOrder).
   */
  actorRepId?: string | null;
}): Promise<void> {
  // Every status change passes through here, so the rep who built the order
  // hears from the same place the customer does.
  if (opts.status === 'delivered' || opts.status === 'cancelled') {
    void notifyRepOrder({ orderId: opts.orderId, status: opts.status, reason: opts.reason ?? null, actorRepId: opts.actorRepId ?? null });
  }
  const typeByStatus = {
    confirmed: 'order_confirmed',
    preparing: 'order_preparing',
    on_the_way: 'order_on_the_way',
    delivered: 'order_delivered',
    cancelled: 'order_cancelled',
  } as const;
  const type = typeByStatus[opts.status] as NotificationType;
  const content = buildOrderContent(type, {
    orderNumber: opts.orderNumber,
    reason: opts.reason,
  });
  await createNotification({
    audience: 'customer',
    user_id: opts.userId,
    type,
    ...content,
    deeplink: `/orders/${opts.orderId}`,
    data: { order_id: opts.orderId, order_number: opts.orderNumber },
  });

  // Mirror to email — best-effort. Push may be muted or the device may be
  // offline; email keeps the customer in the loop.
  try {
    const user = await prisma.user.findUnique({
      where: { id: opts.userId },
      select: { email: true, name: true, preferred_language: true },
    });
    if (user?.email) {
      const webBase = process.env.WEB_URL ?? 'http://localhost:5199';
      await sendOrderStatusEmail({
        to: user.email,
        name: user.name ?? '',
        lang: resolveEmailLang(user.preferred_language),
        orderNumber: opts.orderNumber,
        status: opts.status,
        reason: opts.reason ?? null,
        trackUrl: `${webBase.replace(/\/$/, '')}/orders/${opts.orderId}`,
      });
    }
  } catch (err) {
    console.error('[notifications] order status email failed', err);
  }
}

export async function notifyOrderEdited(opts: {
  userId: string;
  orderId: string;
  orderNumber: string;
  /** Optional — if omitted, the email still sends with a generic line. */
  changeSummaryLines?: string[];
  newTotal?: number;
}): Promise<void> {
  const content = buildOrderContent('order_edited', { orderNumber: opts.orderNumber });
  await createNotification({
    audience: 'customer',
    user_id: opts.userId,
    type: 'order_edited',
    ...content,
    deeplink: `/orders/${opts.orderId}`,
    data: { order_id: opts.orderId, order_number: opts.orderNumber },
  });

  // Mirror to email — best-effort, same shape as notifyOrderStatusChange.
  try {
    const user = await prisma.user.findUnique({
      where: { id: opts.userId },
      select: { email: true, name: true, preferred_language: true },
    });
    if (user?.email) {
      const webBase = process.env.WEB_URL ?? 'http://localhost:5199';
      const lang = resolveEmailLang(user.preferred_language);
      await sendOrderEditedEmail({
        to: user.email,
        name: user.name ?? '',
        lang,
        orderNumber: opts.orderNumber,
        changeSummaryLines: opts.changeSummaryLines?.length
          ? opts.changeSummaryLines
          : [lang === 'en' ? 'Your order items were updated.' : 'Los artículos de tu pedido fueron actualizados.'],
        newTotal: opts.newTotal ?? 0,
        trackUrl: `${webBase.replace(/\/$/, '')}/orders/${opts.orderId}`,
      });
    }
  } catch (err) {
    console.error('[notifications] order edited email failed', err);
  }
}

/**
 * Somebody put a delivery fee on the customer's order, or changed it.
 *
 * A customer's own order is never priced for delivery at checkout (user
 * decision 2026-10-23): the office — or the shop, or the rep — sets the fee
 * once it can see the order, and the customer is told here, with the new
 * total. In-app and push only: it is one line, and the email quota is shared
 * across every environment. Type `order_edited`, which every web and app
 * build already opens on the order, rather than a new enum value and a
 * migration to carry it.
 *
 * Nothing is said for a fee set to zero: the order goes on reading as "to
 * come" (deliveryFeeIsPending), and "your delivery is free" is the promise
 * this app never makes. Nor when the figure did not move.
 */
export async function notifyDeliveryFeeSet(opts: {
  userId: string;
  /** The order — or the whole purchase, for a split one — the customer opens. */
  orderId: string;
  orderNumber: string;
  before: number;
  after: number;
  total: number;
}): Promise<void> {
  if (opts.after <= 0 || opts.after === opts.before) return;
  const num = `#${opts.orderNumber}`;
  const first = opts.before <= 0;
  await createNotification({
    audience: 'customer',
    user_id: opts.userId,
    type: 'order_edited',
    title_es: first ? 'Hemos añadido el envío a tu pedido' : 'Hemos cambiado el envío de tu pedido',
    title_en: first ? "We've added delivery to your order" : "We've changed the delivery on your order",
    body_es: `Pedido ${num}: envío ${fmtEur(opts.after)}. Total: ${fmtEur(opts.total)}.`,
    body_en: `Order ${num}: delivery ${fmtEur(opts.after)}. Total: ${fmtEur(opts.total)}.`,
    deeplink: `/orders/${opts.orderId}`,
    data: { order_id: opts.orderId, order_number: opts.orderNumber },
  });
}

export async function notifyAdminNewOrder(opts: {
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  total: number;
}): Promise<void> {
  const content = buildOrderContent('admin_new_order', {
    orderNumber: opts.orderNumber,
    customerName: opts.customerName,
    total: opts.total,
  });
  await createNotification({
    audience: 'admin',
    user_id: null,
    type: 'admin_new_order',
    ...content,
    deeplink: `/orders/${opts.orderId}`,
    data: { order_id: opts.orderId, order_number: opts.orderNumber },
  });

  const inbox = resolveAdminNotifyEmail();
  if (inbox) {
    const adminBase = process.env.ADMIN_URL?.trim() || 'http://localhost:5173';
    void sendAdminAlert({
      to: inbox,
      subject: `New order — ${opts.orderNumber} (€${opts.total.toFixed(2)})`,
      rows: [
        { label: 'Order #',  value: opts.orderNumber },
        { label: 'Customer', value: opts.customerName ?? '—' },
        { label: 'Total',    value: `€${opts.total.toFixed(2)}` },
      ],
      ctaLabel: 'Open order',
      ctaUrl: `${adminBase.replace(/\/$/, '')}/orders/${opts.orderId}`,
    }).catch((err) => console.error('[mail:admin-alert] new order send failed', err));
  }
}

/**
 * A customer edited their own order before dispatch.
 *
 * Points the opposite way to notifyOrderEdited: that one tells the customer
 * their order was changed FOR them. This one tells whoever is packing that
 * it was changed UNDER them, which is the more urgent direction — an order
 * already in `preparing` may be half-picked against the old contents.
 */
export async function notifyAdminOrderEdited(opts: {
  orderId: string;
  orderNumber: string;
  customerName: string | null;
  newTotal: number;
  /** Human-readable lines, e.g. "+2 × Arroz basmati". Best-effort context
   *  for the email; the in-app row stays short. */
  changeSummaryLines?: string[];
  /** Set when the order was already being packed, which is what makes this
   *  worth interrupting someone over rather than just logging. */
  wasPreparing?: boolean;
}): Promise<void> {
  const content = buildOrderContent('admin_order_edited', {
    orderNumber: opts.orderNumber,
    customerName: opts.customerName,
    total: opts.newTotal,
  });
  await createNotification({
    audience: 'admin',
    user_id: null,
    type: 'admin_order_edited',
    ...content,
    deeplink: `/orders/${opts.orderId}`,
    data: { order_id: opts.orderId, order_number: opts.orderNumber },
  });

  const inbox = resolveAdminNotifyEmail();
  if (inbox) {
    const adminBase = process.env.ADMIN_URL?.trim() || 'http://localhost:5173';
    const urgent = opts.wasPreparing ? ' — ALREADY PREPARING' : '';
    void sendAdminAlert({
      to: inbox,
      subject: `Customer changed order ${opts.orderNumber}${urgent}`,
      rows: [
        { label: 'Order #',   value: opts.orderNumber },
        { label: 'Customer',  value: opts.customerName ?? '—' },
        { label: 'New total', value: `€${opts.newTotal.toFixed(2)}` },
        { label: 'Status',    value: opts.wasPreparing ? 'Was being prepared' : 'Not yet being prepared' },
        ...(opts.changeSummaryLines?.length
          ? [{ label: 'Changes', value: opts.changeSummaryLines.join(', ') }]
          : []),
      ],
      ctaLabel: 'Open order',
      ctaUrl: `${adminBase.replace(/\/$/, '')}/orders/${opts.orderId}`,
    }).catch((err) => console.error('[mail:admin-alert] customer order edit send failed', err));
  }
}

export async function notifyAdminLowStock(opts: {
  productId: string;
  productNameEs: string;
  productNameEn: string;
  variantNameEs: string;
  variantNameEn: string;
  remaining: number;
}): Promise<void> {
  await createNotification({
    audience: 'admin',
    user_id: null,
    type: 'admin_low_stock',
    title_es: 'Stock bajo',
    title_en: 'Low stock',
    body_es: `${opts.productNameEs} (${opts.variantNameEs}) — quedan ${opts.remaining} unidades.`,
    body_en: `${opts.productNameEn} (${opts.variantNameEn}) — ${opts.remaining} units left.`,
    deeplink: `/products?id=${opts.productId}`,
    data: { product_id: opts.productId, remaining: String(opts.remaining) },
  });
}

export async function notifyAdminDraftOrder(opts: {
  orderId: string;
  orderNumber: string;
  storeName: string | null;
  itemNames: string[];
}): Promise<void> {
  const items = opts.itemNames.join(', ');
  const store = opts.storeName ? ` (${opts.storeName})` : '';
  await createNotification({
    audience: 'admin',
    user_id: null,
    type: 'admin_draft_order',
    title_es: 'Pedido en borrador — sin stock',
    title_en: 'Draft order — out of stock',
    body_es: `Pedido ${opts.orderNumber}${store} necesita stock: ${items}`,
    body_en: `Order ${opts.orderNumber}${store} needs stock: ${items}`,
    deeplink: `/orders/${opts.orderId}`,
    data: { order_id: opts.orderId, order_number: opts.orderNumber },
  });
}

/**
 * Product quotation request submitted (B2bLead type='quotation'). Feed row
 * only — the email is already sent generically for every lead type by
 * leads.ts's sendAdminAlert call, so no email here to avoid double-sending.
 */
export async function notifyAdminQuotationRequest(opts: {
  leadId: string;
  customerName: string;
  productName: string;
  quantity: number;
}): Promise<void> {
  await createNotification({
    audience: 'admin',
    user_id: null,
    type: 'admin_quotation_request',
    title_es: 'Solicitud de cotización',
    title_en: 'Quotation request',
    body_es: `${opts.customerName} solicitó una cotización para ${opts.productName} (x${opts.quantity}).`,
    body_en: `${opts.customerName} requested a quotation for ${opts.productName} (x${opts.quantity}).`,
    deeplink: `/leads?id=${opts.leadId}`,
    data: { lead_id: opts.leadId },
  });
}

export async function notifyAdminNewCustomer(opts: {
  userId: string;
  name: string;
}): Promise<void> {
  const displayName = opts.name.trim() || 'Nuevo usuario';
  await createNotification({
    audience: 'admin',
    user_id: null,
    type: 'admin_new_customer',
    title_es: 'Nuevo cliente registrado',
    title_en: 'New customer registered',
    body_es: `${displayName} acaba de crear una cuenta.`,
    body_en: `${displayName} just created an account.`,
    deeplink: `/customers/${opts.userId}`,
    data: { user_id: opts.userId },
  });

  const inbox = resolveAdminNotifyEmail();
  if (inbox) {
    const adminBase = process.env.ADMIN_URL?.trim() || 'http://localhost:5173';
    // Pull identifying fields so the email is useful even before an admin
    // clicks through. Best-effort — never fail the caller.
    void (async () => {
      const user = await prisma.user.findUnique({
        where: { id: opts.userId },
        select: { name: true, email: true, phone: true },
      });
      await sendAdminAlert({
        to: inbox,
        subject: `New customer signup — ${user?.name || displayName}`,
        rows: [
          { label: 'Name',  value: user?.name  || displayName },
          { label: 'Email', value: user?.email || '—' },
          { label: 'Phone', value: user?.phone || '—' },
        ],
        ctaLabel: 'View customer',
        ctaUrl: `${adminBase.replace(/\/$/, '')}/customers/${opts.userId}`,
      });
    })().catch((err) => console.error('[mail:admin-alert] new customer send failed', err));
  }
}

export async function notifyAdminSubscriptionPaused(opts: {
  subscriptionId: string;
  customerName: string;
  packName: string;
}): Promise<void> {
  await createNotification({
    audience: 'admin',
    user_id: null,
    type: 'admin_subscription_paused',
    title_es: 'Suscripción pausada',
    title_en: 'Subscription paused',
    body_es: `${opts.customerName} ha pausado su suscripción ${opts.packName}.`,
    body_en: `${opts.customerName} paused their ${opts.packName} subscription.`,
    deeplink: `/subscriptions/${opts.subscriptionId}`,
    data: { subscription_id: opts.subscriptionId },
  });
}

// ─── Home Grocery (formerly rashan) requests ──────────

/**
 * Somebody submitted the Home Grocery form. Bell row only — the request
 * route already emails the admin inbox, so a second email here would double
 * up, same as notifyAdminQuotationRequest.
 */
export async function notifyAdminHomeGroceryRequest(opts: {
  leadId: string;
  name: string;
  householdSize: number;
}): Promise<void> {
  const name = opts.name.trim() || 'Cliente';
  await createNotification({
    audience: 'admin',
    user_id: null,
    type: 'admin_home_grocery_request',
    title_es: 'Nueva solicitud de Compra del hogar',
    title_en: 'New Home Grocery request',
    body_es: `${name} quiere suscribirse (hogar de ${opts.householdSize}).`,
    body_en: `${name} wants to subscribe (household of ${opts.householdSize}).`,
    deeplink: `/users?tab=rashan&request=${opts.leadId}`,
    data: { lead_id: opts.leadId },
  });
}

/** The household's request was approved. In-app + push to their account. */
export async function notifyHomeGroceryApproved(opts: { userId: string }): Promise<void> {
  await createNotification({
    audience: 'customer',
    user_id: opts.userId,
    type: 'home_grocery_approved',
    title_es: '¡Ya eres suscriptor de Compra del hogar!',
    title_en: "You're now a Home Grocery subscriber!",
    body_es: 'Hemos aprobado tu solicitud. Nuestro equipo preparará tu compra y te avisará de cada entrega.',
    body_en: "We've approved your request. Our team will put your grocery order together and keep you posted on each delivery.",
    deeplink: '/rashan',
  });
}

/**
 * The household's request was turned down. The reason is the admin's own
 * words and is shown verbatim — it is written for the customer, which is why
 * the reject dialog says so.
 */
export async function notifyHomeGroceryRejected(opts: {
  userId: string;
  reason: string;
}): Promise<void> {
  await createNotification({
    audience: 'customer',
    user_id: opts.userId,
    type: 'home_grocery_rejected',
    title_es: 'Tu solicitud de Compra del hogar',
    title_en: 'Your Home Grocery request',
    body_es: `No hemos podido aprobar tu solicitud. Motivo: ${opts.reason}`,
    body_en: `We couldn't approve your request. Reason: ${opts.reason}`,
    deeplink: '/rashan',
  });
}

// ─── Orders our team builds ───────────────────────────
//
// A checkout tells its customer with the receipt. An order built FOR them —
// staff in the panel, a rep at the counter — told them nothing until its
// first status change, so a household could have an order on its way that
// it had never heard of. And a rep's order reached nobody in the office:
// the admin bell rang for checkouts only.

function addressLinesOf(snapshot: Prisma.JsonValue | null): string[] {
  const snap = snapshot as Prisma.JsonObject | null;
  if (!snap) return [];
  const lines: string[] = [];
  if (typeof snap.street_line_1 === 'string') lines.push(snap.street_line_1);
  if (typeof snap.street_line_2 === 'string' && snap.street_line_2) lines.push(snap.street_line_2);
  const cityLine = [snap.postcode, snap.city].filter(Boolean).join(' ');
  if (cityLine) lines.push(cityLine);
  if (typeof snap.province === 'string' && snap.province) lines.push(snap.province);
  return lines;
}

/**
 * Announce an order our team built, once it is real — at creation, or when a
 * parked draft takes its stock. A draft is a basket nobody has committed to,
 * so nothing is said about one.
 *
 * `feeDecided`: the builder typed the delivery fee, so a zero is a waiver
 * rather than a wholesale fee still to be priced.
 */
export async function announceOrderBuiltForCustomer(opts: {
  orderId: string;
  feeDecided?: boolean;
  /**
   * The household placed it itself, outside checkout — a Home Grocery order
   * from its plan page. Same receipt and same office ping, worded as theirs
   * rather than as one placed for them.
   */
  byCustomer?: boolean;
}): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: opts.orderId },
      select: {
        id: true, order_number: true, status: true, user_id: true,
        subtotal: true, delivery_fee: true, recargo: true, total: true, buyer_is_business: true,
        address_snapshot: true, created_by_admin_id: true, created_by_sales_rep_id: true,
        user: { select: { name: true, email: true, preferred_language: true } },
        items: { select: { quantity: true } },
      },
    });
    if (!order || order.status === 'draft') return;
    if (!opts.byCustomer && !order.created_by_admin_id && !order.created_by_sales_rep_id) return;

    const total = Number(order.total);
    const fee = Number(order.delivery_fee);
    await createNotification({
      audience: 'customer',
      user_id: order.user_id,
      type: 'order_placed',
      ...buildOrderContent('order_placed', { orderNumber: order.order_number, total }),
      deeplink: `/orders/${order.id}`,
      data: { order_id: order.id, order_number: order.order_number },
    });

    if (order.user.email) {
      // A zero nobody typed is "to come", for any buyer: a customer's own
      // order is never priced at checkout (2026-10-23).
      const pending = fee === 0 && !opts.feeDecided;
      const webBase = (process.env.WEB_URL ?? 'http://localhost:5199').replace(/\/$/, '');
      void sendOrderPlacedEmail({
        to: order.user.email,
        name: order.user.name ?? '',
        lang: resolveEmailLang(order.user.preferred_language),
        orderNumber: order.order_number,
        itemCount: order.items.reduce((n, i) => n + i.quantity, 0),
        subtotal: Number(order.subtotal),
        deliveryFee: fee,
        recargo: Number(order.recargo),
        deliveryFeePending: pending,
        deliveryFeeFree: fee === 0 && !pending,
        placedForYou: !opts.byCustomer,
        total,
        addressLines: addressLinesOf(order.address_snapshot),
        trackUrl: `${webBase}/orders/${order.id}`,
      }).catch((err) => console.error('[mail:order-placed] send failed', err));
    }

    // The office has to fulfil a rep's order and would otherwise not know it
    // exists. Staff who built one in the panel already do.
    if (order.created_by_sales_rep_id || opts.byCustomer) {
      await notifyAdminNewOrder({
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: order.user.name ?? null,
        total,
      });
    }
  } catch (err) {
    console.error('[notifications] built-order announcement failed', err);
  }
}

// ─── Partners ─────────────────────────────────────────
//
// A partner used to learn about an order only by opening the dashboard, and
// nobody told them either when a customer changed or cancelled one they were
// packing. Every active login at the shop now gets a push on their phone and
// browsers, and the same notice waits on their dashboard bell. No email —
// a push is what a shop acts on, and the shared mail quota is not spent on it.

export type PartnerOrderEvent = 'new' | 'draft' | 'edited' | 'cancelled';

const PARTNER_TYPE: Record<PartnerOrderEvent, NotificationType> = {
  new: 'partner_new_order',
  draft: 'partner_draft_order',
  edited: 'partner_order_edited',
  cancelled: 'partner_order_cancelled',
};

function buildPartnerContent(
  kind: PartnerOrderEvent,
  ctx: { orderNumber: string; customerName: string | null; total: number; by: 'customer' | 'cesto'; reason?: string | null },
): BilingualContent {
  const num = `#${ctx.orderNumber}`;
  const whoEs = ctx.by === 'cesto' ? 'Cesto' : 'El cliente';
  const whoEn = ctx.by === 'cesto' ? 'Cesto' : 'The customer';
  switch (kind) {
    case 'new':
      return {
        title_es: 'Nuevo pedido',
        title_en: 'New order',
        body_es: `Pedido ${num}${ctx.customerName ? ` de ${ctx.customerName}` : ''} · ${fmtEur(ctx.total)}`,
        body_en: `Order ${num}${ctx.customerName ? ` from ${ctx.customerName}` : ''} · ${fmtEur(ctx.total)}`,
      };
    case 'draft':
      return {
        title_es: 'Pedido a la espera de stock',
        title_en: 'Order waiting on your stock',
        body_es: `El pedido ${num} lleva productos que no tienes en stock. Confírmalo cuando los tengas.`,
        body_en: `Order ${num} has products you're out of. Confirm the stock once you have them.`,
      };
    case 'edited':
      return {
        title_es: 'Pedido modificado',
        title_en: 'Order changed',
        body_es: `${whoEs} ha cambiado el pedido ${num}. Revísalo antes de prepararlo.`,
        body_en: `${whoEn} changed order ${num}. Check it before you pack it.`,
      };
    case 'cancelled':
      return {
        title_es: 'Pedido cancelado',
        title_en: 'Order cancelled',
        body_es: `${whoEs} ha cancelado el pedido ${num}.${ctx.reason ? ` Motivo: ${ctx.reason}` : ''}`,
        body_en: `${whoEn} cancelled order ${num}.${ctx.reason ? ` Reason: ${ctx.reason}` : ''}`,
      };
  }
}

/**
 * Tell the shop about one of its orders.
 *
 * Only a part a partner fulfils: it carries their store_id and the customer
 * placed it. An order our team built is Cesto's whatever it holds
 * (lib/createOrder), and a Cesto order has no partner to tell.
 *
 * `by` is who changed or cancelled it. A partner's own actions are never
 * announced back to them, so the partner routes do not call this.
 */
export async function notifyPartnerOrder(opts: {
  orderId: string;
  kind: PartnerOrderEvent;
  by?: 'customer' | 'cesto';
  reason?: string | null;
}): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: opts.orderId },
      select: {
        id: true, order_number: true, total: true, store_id: true,
        created_by_admin_id: true, created_by_sales_rep_id: true,
        user: { select: { name: true } },
      },
    });
    if (!order?.store_id) return;
    if (order.created_by_admin_id || order.created_by_sales_rep_id) return;

    const logins = await prisma.partnerStoreRole.findMany({
      where: { store_id: order.store_id, is_active: true, user: { status: 'active' } },
      select: { user_id: true },
    });
    if (logins.length === 0) return;

    const by = opts.by ?? 'customer';
    const total = Number(order.total);
    const content = buildPartnerContent(opts.kind, {
      orderNumber: order.order_number,
      customerName: order.user.name ?? null,
      total,
      by,
      reason: opts.reason,
    });
    // createNotification persists the bell row and pushes it, in each
    // login's own language.
    for (const { user_id } of logins) {
      await createNotification({
        audience: 'partner',
        user_id,
        type: PARTNER_TYPE[opts.kind],
        ...content,
        deeplink: `/partner/orders/${order.id}`,
        data: { order_id: order.id, order_number: order.order_number, store_id: order.store_id },
      });
    }
  } catch (err) {
    console.error('[notifications] partner order notification failed', err);
  }
}

// ─── Sales reps (audience `sales_rep`, 2026-10-26) ─────────────
// The bell in the rep panel: what happens to their money and to the orders
// they built, without them having to go and look.

/**
 * An order a rep built was delivered (its earning now waits for an admin's
 * approval), or cancelled by somebody else — the customer, the office or a
 * shop. A rep who cancels it themselves already knows, so `actorRepId` skips
 * them.
 */
export async function notifyRepOrder(opts: {
  orderId: string;
  status: 'delivered' | 'cancelled';
  reason?: string | null;
  actorRepId?: string | null;
}): Promise<void> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: opts.orderId },
      select: {
        order_number: true, total: true, created_by_sales_rep_id: true,
        user: { select: { name: true, business_profile: { select: { company: true } } } },
      },
    });
    const repId = order?.created_by_sales_rep_id;
    if (!order || !repId || repId === opts.actorRepId) return;
    const client = order.user?.business_profile?.company ?? order.user?.name ?? '';
    const amount = fmtEur(Number(order.total));
    const delivered = opts.status === 'delivered';
    const why = !delivered && opts.reason ? opts.reason.trim() : '';
    await createNotification({
      audience: 'sales_rep',
      user_id: repId,
      type: delivered ? 'rep_order_delivered' : 'rep_order_cancelled',
      title_es: delivered ? 'Pedido entregado' : 'Pedido cancelado',
      title_en: delivered ? 'Order delivered' : 'Order cancelled',
      body_es: delivered
        ? `${order.order_number} de ${client} (${amount}) está entregado. Tu ganancia queda pendiente de aprobación.`
        : `${order.order_number} de ${client} (${amount}) se ha cancelado${why ? `: ${why}` : '.'}`,
      body_en: delivered
        ? `${order.order_number} for ${client} (${amount}) was delivered. Your earning now waits for approval.`
        : `${order.order_number} for ${client} (${amount}) was cancelled${why ? `: ${why}` : '.'}`,
      deeplink: `/sales/orders/${opts.orderId}`,
      data: { order_id: opts.orderId, order_number: order.order_number },
    });
  } catch (err) {
    console.error('[notifications] rep order notification failed', err);
  }
}

/**
 * Something moved a rep's earnings (lib/repEarnings): an order's earning
 * approved, approved again with new figures, or taken back; a payment
 * recorded; a bonus, a deduction or a payment undone by an admin.
 */
export async function notifyRepEarning(event:
  | EarningEvent
  | { kind: 'payout'; repId: string; amount: Prisma.Decimal; paidOn: string }
  | { kind: 'payout_void' | 'adjustment'; repId: string; amount: Prisma.Decimal; note?: string | null },
): Promise<void> {
  try {
    const eur = (d: Prisma.Decimal) => fmtEur(Number(d));
    const signed = (d: Prisma.Decimal) => `${d.isNegative() ? '−' : '+'}${fmtEur(Math.abs(Number(d)))}`;
    let type: NotificationType;
    let title: { es: string; en: string };
    let body: { es: string; en: string };
    let deeplink = '/sales/earnings';
    let data: Record<string, string> = {};
    switch (event.kind) {
      case 'approved':
        type = 'rep_earning_approved';
        title = { es: 'Ganancia aprobada', en: 'Earning approved' };
        body = {
          es: `${event.orderNumber}: ${eur(event.amount)} para ti, pendientes de cobro.`,
          en: `${event.orderNumber}: ${eur(event.amount)} for you, owed to you.`,
        };
        deeplink = `/sales/orders/${event.orderId}`;
        data = { order_id: event.orderId, order_number: event.orderNumber };
        break;
      case 'updated':
        type = 'rep_earning_approved';
        title = { es: 'Ganancia actualizada', en: 'Earning updated' };
        body = {
          es: `${event.orderNumber}: ahora ${eur(event.amount)} (${signed(event.delta)}).`,
          en: `${event.orderNumber}: now ${eur(event.amount)} (${signed(event.delta)}).`,
        };
        deeplink = `/sales/orders/${event.orderId}`;
        data = { order_id: event.orderId, order_number: event.orderNumber };
        break;
      case 'reversed':
        type = 'rep_earning_reversed';
        title = { es: 'Ganancia revertida', en: 'Earning reversed' };
        body = {
          es: `${event.orderNumber} ya no cuenta: se restan ${eur(event.amount)} de lo que te debemos.`,
          en: `${event.orderNumber} no longer counts: ${eur(event.amount)} comes off what you are owed.`,
        };
        data = { order_id: event.orderId, order_number: event.orderNumber };
        break;
      case 'payout':
        type = 'rep_payout_recorded';
        title = { es: 'Te hemos pagado', en: 'You have been paid' };
        body = { es: `${eur(event.amount)} pagados.`, en: `${eur(event.amount)} paid.` };
        break;
      case 'payout_void':
        type = 'rep_earning_adjusted';
        title = { es: 'Pago anulado', en: 'Payment voided' };
        body = {
          es: `Un pago de ${eur(event.amount)} se ha anulado${event.note ? `: ${event.note}` : '.'}`,
          en: `A payment of ${eur(event.amount)} was voided${event.note ? `: ${event.note}` : '.'}`,
        };
        break;
      case 'adjustment':
        type = 'rep_earning_adjusted';
        title = event.amount.isNegative()
          ? { es: 'Deducción en tus ganancias', en: 'Deduction from your earnings' }
          : { es: 'Ajuste a tu favor', en: 'Adjustment in your favour' };
        body = {
          es: `${signed(event.amount)}${event.note ? ` · ${event.note}` : ''}`,
          en: `${signed(event.amount)}${event.note ? ` · ${event.note}` : ''}`,
        };
        break;
    }
    await createNotification({
      audience: 'sales_rep',
      user_id: event.repId,
      type,
      title_es: title.es,
      title_en: title.en,
      body_es: body.es,
      body_en: body.en,
      deeplink,
      data,
    });
  } catch (err) {
    console.error('[notifications] rep earning notification failed', err);
  }
}
