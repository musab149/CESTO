# Local Setup — Grocery App Spain

One-pager for getting all three apps + the API running on a single laptop.

## Prerequisites

- Node 18+
- PostgreSQL 16 running on `localhost:5432` (already running natively on
  this machine — port 5432 is held by process 6308). Default credentials:
  user `postgres`, password `postgres`, db `grocery_app_spain`.
- For mobile: Expo Go on your phone (or an iOS Simulator / Android Emulator)

Redis is NOT required for the demo — OTP / cart / password-reset use
in-memory stores.

## First-time setup

```bash
# From repo root
npm install
npm run api:migrate    # Prisma migrations (already applied on this machine)
npm run api:seed       # Populates demo data (idempotent — safe to re-run)
```

Demo creds after seeding:
- **Admin:** admin@groceryapp.es / admin1234
- **Customer:** demo@groceryapp.es / demo1234 (or phone +34611111111)

## Daily startup

Open **two** terminals. In the first:

```bash
npm run dev
```

This spins up API (3000), web (5173), admin (5174) concurrently with
colour-coded logs.

In the second:

```bash
npm run mobile:dev
```

Expo prints a QR code. Open Expo Go on your phone and scan it.

## URLs

| Surface       | URL                       |
|---------------|---------------------------|
| API           | http://localhost:3000     |
| Customer Web  | http://localhost:5173     |
| Admin Panel   | http://localhost:5174     |
| Mobile        | Expo QR (this machine)    |
| Prisma Studio | `npm run --workspace=packages/api studio` (port 5555) |

## Mobile on a physical device

`localhost` does NOT resolve from your phone to your machine. You need to
edit `apps/mobile/.env` and set:

```
EXPO_PUBLIC_API_URL=http://192.168.88.120:3000
```

Then restart `npm run mobile:dev`. Both phone and laptop must be on the
same WiFi. If the IP changes (WiFi switch, reboot), re-run `ipconfig` and
update the env.

## Troubleshooting

- **API won't connect to DB:** verify the native Postgres service is
  running. `services.msc` → look for "postgresql-x64-16".
- **Port 3000 in use:** kill the previous `ts-node-dev` process or set
  `PORT=3001` in `packages/api/.env` (and update each app's env to match).
- **Mobile shows white screen:** the API URL probably isn't reachable from
  the device. Open http://YOUR-LAN-IP:3000/api/products in your phone's
  browser to verify. If that 404s, the firewall is blocking port 3000.
- **"Database is up to date" but seed fails on duplicate:** the catalog
  blocks are now count-guarded, so this shouldn't happen. If it does,
  inspect `packages/api/prisma/seed.ts` line ~14 (`skipCatalog`).
- **Want a clean DB?** Run `npx prisma migrate reset` from
  `packages/api/` — it drops everything and re-seeds. Destructive.
