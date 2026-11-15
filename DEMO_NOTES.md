# Demo Notes — Grocery App Spain MVP

Read this before the walkthrough so the caveats don't surprise you on stage.

## Demo credentials

| Surface  | Login                                          | Password   |
|----------|------------------------------------------------|------------|
| Customer | phone `+34611111111` OR email `demo@groceryapp.es` | `demo1234` |
| Admin    | `admin@groceryapp.es`                          | `admin1234` |

Demo customer ("Amir Khan") has a default address in Madrid Centro (28004),
5 orders across statuses (`delivered ×2`, `on_the_way`, `preparing`, `pending`)
and one active monthly Essentials rashan subscription with 3 deliveries
(2 already delivered, 1 scheduled in 14 days).

## Stubbed by design (Phase 6 work)

These three are intentionally NOT real for the MVP demo. Narrate them as
"in production this hits a real provider":

1. **SMS OTP** — the API does NOT send SMS. When OTP is triggered the code
   is logged to the API server console (the terminal running
   `npm run api:dev`). Tail it during the demo. For tomorrow, prefer the
   email-password login flow over OTP.

2. **Payment processing** — checkout shows the payment-method selector
   (COD / Card / Bizum) and creates the order, but **no money moves**.
   The order is created with `payment_method` set; in production this would
   gate on a real payment provider (Stripe / Bizum API) returning success.

3. **Push notifications** — there is no real FCM delivery. The customer
   notification inbox is populated by deriving notifications from order
   status changes (mobile) and the admin "notifications bell" uses mock
   data. Show the inbox UI; don't expect a real push to arrive on the
   phone.

## Other narrate-as-future items

- **Product images** on older rows are Cloudinary URLs that may 404 on
  demo. If a product card shows a broken image, that's why. Uploading a
  fresh image always works: with no `BUNNY_*` creds in
  `packages/api/.env` the API stores to local disk and serves from
  `/uploads/*`, so the admin Product Form needs no external setup.
- **Redis** is referenced in comments but not used. OTP / cart /
  password-reset state lives in memory and resets when the API restarts.
- **Admin NotificationsBell** uses mock data (`mockAdminNotifications`)
  not a real `/api/admin/notifications` endpoint. Component is wired and
  shapes match — the endpoint just needs to be built in Phase 6.

## Known cosmetic quirks

- The DB has been used for manual testing during development, so the
  product catalog has some weird entries (e.g. a "Pakistan" zone, variants
  named "10" with high prices). The seed is idempotent — re-running
  `npm run api:seed` will NOT clean this up. To get a pristine demo
  catalog, run `npx prisma migrate reset` in `packages/api` BEFORE the
  demo (this drops the DB and re-seeds from scratch — destructive).
- Onboarding now only shows on first launch for unauthenticated users.
  To re-test onboarding, clear AsyncStorage on the device or uninstall +
  reinstall the Expo Go app.
