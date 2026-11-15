// Push notification dispatcher. Same provider-swap shape as mailer.ts:
// pick a real provider (FCM via firebase-admin, Expo, OneSignal — whichever
// the deployment is configured for) when env vars are present, otherwise
// fall back to the console dispatcher so local dev and tests work with no
// setup. The dispatcher is best-effort — failures are logged and swallowed;
// the Notification row persisted by the service is the source of truth.

export interface PushPayload {
  /** FCM/Expo token of the target device. Null = no token registered yet. */
  token: string | null;
  title: string;
  body: string;
  /** Deeplink + arbitrary metadata. Clients use this to refresh in place. */
  data?: Record<string, string>;
}

export interface PushDispatcher {
  send(payload: PushPayload): Promise<void>;
}

// ─── Console (fallback, dev) ──────────────────────────
const consoleDispatcher: PushDispatcher = {
  async send({ token, title, body, data }) {
    if (!token) {
      console.log(`[push:skip] no token · title="${title}"`);
      return;
    }
    const dataStr = data ? ` · data=${JSON.stringify(data)}` : '';
    console.log(`[push:console] token=${token.slice(0, 12)}… title="${title}" body="${body}"${dataStr}`);
  },
};

// ─── FCM (firebase-admin) ─────────────────────────────
// Wired only when FIREBASE_SERVICE_ACCOUNT (JSON) is set. We require the
// dep dynamically so dev environments that haven't installed firebase-admin
// keep building. To enable in prod:
//   1) npm i firebase-admin --workspace @grocery-app/api
//   2) Set FIREBASE_SERVICE_ACCOUNT to the JSON of a service-account key.
function tryMakeFcmDispatcher(): PushDispatcher | null {
  const svc = process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (!svc) return null;

  let serviceAccount: unknown;
  try {
    serviceAccount = JSON.parse(svc);
  } catch (err: any) {
    console.warn(`[push] FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${err?.message ?? err}`);
    return null;
  }

  try {
    // firebase-admin v13+ ships modular sub-paths — use those directly so we
    // work on the current SDK. The legacy `admin.apps.length` shape is gone.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { initializeApp, getApps, cert } = require('firebase-admin/app');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getMessaging } = require('firebase-admin/messaging');

    if (getApps().length === 0) {
      initializeApp({ credential: cert(serviceAccount as Parameters<typeof cert>[0]) });
    }

    return {
      async send({ token, title, body, data }) {
        if (!token) return;
        try {
          await getMessaging().send({
            token,
            notification: { title, body },
            data: data ?? {},
          });
        } catch (err: any) {
          // Don't throw — push is best-effort. Log so ops can see it.
          console.error(`[push:fcm-error] ${err?.code ?? ''} ${err?.message ?? err}`);
        }
      },
    };
  } catch (err: any) {
    console.warn(`[push] firebase-admin failed to initialize: ${err?.message ?? err}`);
    return null;
  }
}

// ─── Expo push (iOS) ──────────────────────────────────
// The iOS app registers an Expo push token (ExponentPushToken[…]) instead of
// its raw APNs device token, which firebase-admin cannot deliver to. Expo's
// service forwards to APNs with the push key EAS holds for the app, so this
// server needs no Apple credentials. Android keeps registering FCM tokens and
// keeps going through the FCM dispatcher above.
// EXPO_ACCESS_TOKEN is optional: only needed if "enhanced push security" is
// switched on for the project at expo.dev.
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export const isExpoPushToken = (token: string): boolean => /^Expo(nent)?PushToken\[.+\]$/.test(token);

interface ExpoPushResponse {
  data?: { status?: string; message?: string; details?: { error?: string } };
  errors?: { message?: string }[];
}

const expoDispatcher: PushDispatcher = {
  async send({ token, title, body, data }) {
    if (!token) return;
    const accessToken = process.env.EXPO_ACCESS_TOKEN?.trim();
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ to: token, title, body, data: data ?? {}, sound: 'default' }),
      });
      const json = (await res.json().catch(() => null)) as ExpoPushResponse | null;
      const ticket = json?.data;
      if (!res.ok || ticket?.status === 'error') {
        // DeviceNotRegistered = app uninstalled or notifications revoked.
        console.error(`[push:expo-error] ${ticket?.details?.error ?? res.status} ${ticket?.message ?? json?.errors?.[0]?.message ?? ''}`);
      }
    } catch (err: any) {
      console.error(`[push:expo-error] ${err?.message ?? err}`);
    }
  },
};

function pickFcmOrConsole(): PushDispatcher {
  const fcm = tryMakeFcmDispatcher();
  if (fcm) {
    console.log('[push] using FCM dispatcher');
    return fcm;
  }
  const hasEnv = !!process.env.FIREBASE_SERVICE_ACCOUNT?.trim();
  if (hasEnv) {
    console.log('[push] FCM setup failed — using console dispatcher (see warning above)');
  } else {
    console.log('[push] FIREBASE_SERVICE_ACCOUNT unset — using console dispatcher');
  }
  return consoleDispatcher;
}

function pickDispatcher(): PushDispatcher {
  const fallback = pickFcmOrConsole();
  // Tests never reach out to Expo; everything goes to the fallback there.
  if (process.env.NODE_ENV === 'test') return fallback;
  return {
    send: (payload) =>
      (payload.token && isExpoPushToken(payload.token) ? expoDispatcher : fallback).send(payload),
  };
}

export const pushDispatcher: PushDispatcher = pickDispatcher();
