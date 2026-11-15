import { ApiError, notificationsService, adminNotifications } from '@grocery-app/shared';

/**
 * Admin-side browser push notification glue. Mirror of apps/web's webPush.ts
 * but posts subscriptions to /api/admin/notifications/web-subscribe so the
 * server links them to the admin's admin_id, not user_id.
 *
 * Flow:
 *   1. isSupported() — feature detection
 *   2. registerServiceWorker() — mounts /sw.js
 *   3. subscribeToPush() — prompts for OS permission, subscribes with
 *      PushManager, POSTs subscription to admin backend
 *   4. unsubscribeFromPush() — inverse. Called on logout / disable.
 */

export type SubscribeResult =
  | { status: 'subscribed'; endpoint: string }
  | { status: 'permission_denied' }
  | { status: 'unsupported' }
  | { status: 'server_not_configured' }
  | { status: 'error'; message: string };

export function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function currentPermission(): NotificationPermission | 'unsupported' {
  if (!isSupported()) return 'unsupported';
  return Notification.permission;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isSupported()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.warn('[webpush] service worker registration failed', err);
    return null;
  }
}

export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!isSupported()) return { status: 'unsupported' };

  const reg = await registerServiceWorker();
  if (!reg) return { status: 'error', message: 'Service worker unavailable' };

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') return { status: 'permission_denied' };

  // Public VAPID key endpoint is shared across customer + admin.
  let publicKey: string;
  try {
    const res = await notificationsService.vapidPublicKey();
    publicKey = res.publicKey;
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      return { status: 'server_not_configured' };
    }
    return { status: 'error', message: 'Failed to fetch VAPID key' };
  }

  let subscription: PushSubscription;
  try {
    const existing = await reg.pushManager.getSubscription();
    subscription = existing ?? (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    }));
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Subscribe failed',
    };
  }

  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    return { status: 'error', message: 'PushSubscription missing required fields' };
  }

  try {
    await adminNotifications.webSubscribe({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      userAgent: navigator.userAgent.slice(0, 500),
    });
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Failed to save subscription',
    };
  }

  return { status: 'subscribed', endpoint: json.endpoint };
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!isSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => { /* already gone */ });
  await adminNotifications.webUnsubscribe(endpoint).catch(() => { /* backend already forgot */ });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
