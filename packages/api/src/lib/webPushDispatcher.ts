import prisma from './prisma';
import type { WebPushSubscription } from '@prisma/client';

// Web push dispatcher. Same graceful-degrade pattern as pushDispatcher.ts:
// initializes web-push with VAPID keys when env is set, otherwise sends
// become no-ops. The DB inbox row is created independently by the caller
// (createNotification in notifications.ts) — this layer only handles the
// OS-level browser banner delivery, and is best-effort.

/**
 * `ownerKind` picks which set of subscriptions the OS push fans out to:
 * - 'customer' → all subs where user_id = ownerId
 * - 'admin'    → all subs where admin_id = ownerId
 */
interface WebPushPayload {
  ownerKind: 'customer' | 'admin';
  ownerId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

interface WebPushDispatcher {
  send(payload: WebPushPayload): Promise<void>;
}

function tryMakeWebPush(): WebPushDispatcher | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:soporte@cesto.es';
  if (!publicKey || !privateKey) return null;

  let webpush: typeof import('web-push');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    webpush = require('web-push') as typeof import('web-push');
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (err: any) {
    console.warn(`[webpush] failed to initialize: ${err?.message ?? err}`);
    return null;
  }

  return {
    async send({ ownerKind, ownerId, title, body, data }) {
      // Fetch every browser this user/admin has subscribed. Fan-out is
      // small (usually 1-3) and Web Push spec caps this well below any
      // concern. The where-clause routes on ownerKind so a customer's
      // subs never receive an admin push and vice-versa.
      const subs = await prisma.webPushSubscription.findMany({
        where: ownerKind === 'admin'
          ? { admin_id: ownerId }
          : { user_id: ownerId },
      });
      if (subs.length === 0) return;

      const payload = JSON.stringify({ title, body, data: data ?? {} });
      const expired: string[] = [];

      await Promise.all(
        subs.map(async (sub: WebPushSubscription) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.p256dh, auth: sub.auth },
              },
              payload,
            );
          } catch (err: any) {
            const status = err?.statusCode ?? err?.status;
            // 404 (subscription unknown) / 410 (gone — user unsubscribed
            // in the browser) mean this row is dead. Anything else is
            // transient (network, push service outage) — leave it.
            if (status === 404 || status === 410) {
              expired.push(sub.endpoint);
            } else {
              console.warn(`[webpush:error] status=${status ?? '?'} ${err?.message ?? err}`);
            }
          }
        }),
      );

      if (expired.length > 0) {
        await prisma.webPushSubscription.deleteMany({
          where: { endpoint: { in: expired } },
        }).catch((err) => console.warn(`[webpush] failed to prune expired subs: ${err?.message ?? err}`));
      }
    },
  };
}

const consoleWebPush: WebPushDispatcher = {
  async send({ ownerKind, ownerId, title }) {
    console.log(`[webpush:console] ${ownerKind}=${ownerId.slice(0, 8)}… title="${title}"`);
  },
};

function pickWebPush(): WebPushDispatcher {
  const real = tryMakeWebPush();
  if (real) {
    console.log('[webpush] using web-push dispatcher');
    return real;
  }
  const hasKeys = !!process.env.VAPID_PUBLIC_KEY?.trim() && !!process.env.VAPID_PRIVATE_KEY?.trim();
  if (hasKeys) {
    console.log('[webpush] VAPID set but init failed — using console fallback');
  } else {
    console.log('[webpush] VAPID keys unset — using console fallback');
  }
  return consoleWebPush;
}

export const webPushDispatcher: WebPushDispatcher = pickWebPush();
