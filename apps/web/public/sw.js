/* Cesto push service worker.
 *
 * Two things happen here:
 *   1. `push` — server delivers a payload; we render a native OS banner.
 *   2. `notificationclick` — user taps the banner; we focus an existing
 *      Cesto tab if one exists (routing there) or open a new one.
 *
 * The payload the server sends is `{ title, body, data }` JSON. `data`
 * mirrors the API's Notification.data shape: `{ type, deeplink?,
 * order_id?, subscription_id?, ... }`.
 *
 * This file is served from /sw.js — do NOT rename without updating the
 * registerServiceWorker call in the client library.
 */

self.addEventListener('install', (event) => {
  // Take over as fast as possible so a fresh subscription during signup
  // doesn't get stuck behind the previous SW.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Cesto', body: '', data: {} };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      // Some push services deliver text-only fallbacks; treat as body.
      payload = { title: 'Cesto', body: event.data.text(), data: {} };
    }
  }
  const { title, body, data } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body || '',
      icon: '/cesto-icon.png',
      badge: '/cesto-icon.png',
      tag: (data && data.notification_id) || undefined,
      data: data || {},
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const path = resolvePath(data);

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Focus an existing Cesto tab if one is open — nicer UX than
      // spinning up a fresh tab every time.
      const origin = self.location.origin;
      for (const client of allClients) {
        const url = new URL(client.url);
        if (url.origin === origin && 'focus' in client) {
          if ('navigate' in client && path) {
            try {
              await client.navigate(path);
            } catch {
              /* navigation blocked (cross-origin, etc.) — just focus */
            }
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(path || '/');
      }
    })(),
  );
});

/** Match the same rules as the mobile tap handler. */
function resolvePath(data) {
  if (!data) return '/';
  if (typeof data.deeplink === 'string' && data.deeplink.startsWith('/')) {
    return data.deeplink;
  }
  const type = typeof data.type === 'string' ? data.type : '';
  if (type.startsWith('order_') && typeof data.order_id === 'string') {
    return `/orders/${data.order_id}`;
  }
  if (type === 'admin_subscription_paused') {
    return '/rashan';
  }
  // promo_banner / admin_broadcast / anything else → notifications page.
  return '/notifications';
}
