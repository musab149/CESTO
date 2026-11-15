import { ApiError, notificationsService } from '@grocery-app/shared';

/**
 * Client-side glue for browser push notifications.
 *
 * The pattern:
 *   1. `isSupported()` — feature detection. Called before showing UI.
 *   2. `registerServiceWorker()` — mounts /sw.js. Idempotent.
 *   3. `subscribeToPush()` — prompts for OS permission, subscribes with
 *      PushManager using the server's VAPID public key, and POSTs the
 *      subscription to the backend so future events can reach it.
 *   4. `unsubscribeFromPush()` — inverse. Called on logout or when the
 *      user disables notifications.
 *
 * All functions swallow expected errors (permission denied, unsupported
 * browser, server not configured) and return a status enum. Callers use
 * that to decide UI state without try/catch soup.
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
    // { scope: '/' } so it can handle notificationclick for any path.
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (err) {
    console.warn('[webpush] service worker registration failed', err);
    return null;
  }
}

/**
 * Ask for permission, subscribe via PushManager, POST to backend.
 * Returns a discriminated result so the caller can render the right UI
 * (toast success, error banner, silent no-op if denied, etc.).
 */
export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!isSupported()) return { status: 'unsupported' };

  const reg = await registerServiceWorker();
  if (!reg) return { status: 'error', message: 'Service worker unavailable' };

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();
  if (permission !== 'granted') return { status: 'permission_denied' };

  // Fetch the VAPID public key from the server every time — cheap, and it
  // means a key rotation on the backend seamlessly re-subscribes users.
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
      // TS lib narrowed BufferSource to ArrayBuffer-backed; our helper
      // returns a Uint8Array<ArrayBufferLike> which the runtime accepts.
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
    await notificationsService.webSubscribe({
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

/**
 * Cancel the local subscription and tell the backend to forget it. Safe
 * to call even when nothing is subscribed.
 */
export async function unsubscribeFromPush(): Promise<void> {
  if (!isSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => { /* already gone */ });
  await notificationsService.webUnsubscribe(endpoint).catch(() => { /* backend already forgot */ });
}

/**
 * PushManager.subscribe wants applicationServerKey as a Uint8Array of the
 * raw bytes, not the URL-safe base64 the server hands us.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
