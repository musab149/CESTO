/* Cesto admin push service worker.
 *
 * Mirror of apps/web/public/sw.js but with admin-oriented deep-linking:
 * order pushes route to /orders/{id} in the admin panel, low-stock pushes
 * to /products, support tickets to /support, etc. Payload shape is the
 * same JSON the server sends: `{ title, body, data }`.
 *
 * Served at /sw.js. Do NOT rename without updating registerServiceWorker.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Cesto Admin', body: '', data: {} };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: 'Cesto Admin', body: event.data.text(), data: {} };
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
      const origin = self.location.origin;
      for (const client of allClients) {
        const url = new URL(client.url);
        if (url.origin === origin && 'focus' in client) {
          if ('navigate' in client && path) {
            try {
              await client.navigate(path);
            } catch {
              /* navigation blocked — just focus */
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

/**
 * Admin deep-link routing. Types mirror NotificationType in the API:
 *   admin_new_order       → /orders/{id}
 *   admin_low_stock       → /products
 *   admin_new_support     → /support
 *   admin_new_lead        → /leads
 *   admin_broadcast / …   → /notifications
 */
function resolvePath(data) {
  if (!data) return '/';
  if (typeof data.deeplink === 'string' && data.deeplink.startsWith('/')) {
    return data.deeplink;
  }
  const type = typeof data.type === 'string' ? data.type : '';
  if (type === 'admin_new_order' && typeof data.order_id === 'string') {
    return `/orders/${data.order_id}`;
  }
  if (type === 'admin_low_stock') return '/products';
  if (type === 'admin_new_support') return '/support';
  if (type === 'admin_new_lead') return '/leads';
  return '/notifications';
}
