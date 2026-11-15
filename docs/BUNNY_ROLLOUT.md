# Bunny.net rollout

Cloudinary → Bunny Edge Storage, per environment.

**Local dev is DONE** (2026-09-10): 894/894 assets migrated, every master has
its full variant ladder, 0 Cloudinary references left in the database.
**Staging and production have NOT been migrated** and are still entirely on
Cloudinary.

---

## What changed, in one paragraph

Uploads no longer go direct from the browser to a CDN. Bunny Edge Storage has
no per-upload signature — one AccessKey grants read/write/delete over the whole
zone — so uploads proxy through the API, which normalises with `sharp` (EXIF
rotate, cap the longest edge, re-encode WebP) and PUTs the master plus a ladder
of width variants. Delivery is dual-mode: `resolveImageUrl()` rewrites Bunny
URLs to a stored variant and still applies Cloudinary transformations to any
row that has not been migrated yet, so a partially-migrated environment renders
correctly throughout.

**Bunny Optimizer is deliberately NOT enabled** (cost decision, 2026-09-10).
There is no on-the-fly resizing: `?width=` is ignored. That is why variants are
real files. A width that was never generated is a 404, not a downgrade.

---

## Per-environment rollout

Run these in order, per environment, pointed at that environment's
`DATABASE_URL` and that environment's `BUNNY_*` values.

### 0. Point the scripts at an environment

Put each environment's credentials in its own gitignored file under
`packages/api/` and name it on the command line:

    packages/api/.env.staging      DATABASE_URL + BUNNY_* for staging
    packages/api/.env.production   DATABASE_URL + BUNNY_* for production

    npm run <script> --workspace=packages/api -- --env=.env.staging

Never paste these into a chat or a ticket. `BUNNY_STORAGE_KEY` grants
read/write/**delete** over the entire storage zone, and `DATABASE_URL` is a
direct line to the database. `.gitignore` covers `.env.*`, so the files cannot
be committed by accident.

Without `--env=` the scripts use `packages/api/.env`, which is local dev.

**Every script prints its target before doing anything:**

    env file: .env.staging
    database: ep-xxxx.eu-central-1.aws.neon.tech
    zone:     cestostorage-staging -> https://cestostorage-staging.b-cdn.net

Read those three lines before answering any prompt. They are the only thing
distinguishing a staging run from a production one once the process is going.
A named file that does not exist is a hard error, never a silent fallback, and
a file's values override anything already exported in the shell.

### 1. Bunny zone

A storage zone and a pull zone in front of it. **Use a separate storage zone
for staging** — testers upload junk, and a shared zone means production pays to
store it forever.

### 2. Env vars on the Render service

    BUNNY_STORAGE_ZONE   storage zone name
    BUNNY_STORAGE_KEY    storage zone PASSWORD (not the account API key)
    BUNNY_CDN_URL        pull zone base, WITH scheme: https://<zone>.b-cdn.net
    BUNNY_STORAGE_HOST   leave blank for Frankfurt

If these are missing the API does **not** crash — it silently falls back to
local disk, which on Render is ephemeral and wiped every deploy. Absence of an
error is not evidence it worked.

### 3. Preflight

    npm run bunny:preflight --workspace=packages/api

Uploads a real image, reads it back through the CDN, checks what is served,
deletes it. Catches a pull zone wired to the wrong storage zone, a bad key, and
a missing `https://` on `BUNNY_CDN_URL` — all of which otherwise fail silently.

A **Bunny Optimizer** failure here is expected and does not block anything; it
is reported as delivery-only. A transfer-blocking failure does block.

### 4. Migrate the assets

    npm run migrate:cloudinary-to-bunny --workspace=packages/api              # dry run
    npm run migrate:cloudinary-to-bunny --workspace=packages/api -- --commit --limit=5
    npm run migrate:cloudinary-to-bunny --workspace=packages/api -- --commit

Dry run first and check the asset count looks sane. Then five, and look at
those five in the admin panel. Then the rest.

Resumable: the ledger (`packages/api/prisma/cloudinary-to-bunny.map.json`,
gitignored) is written as it goes, so an interrupted run continues rather than
restarting. Expect a handful of transient `fetch failed` at this volume — local
dev had 2 in 894, and a re-run cleared them.

**The ledger is per-environment and is the rollback record for that run.**
Never share one between staging and production. Keep it until sign-off.

    ... -- --rollback --commit     # put the DB rows back

### 5. Generate the variant ladders

    npm run backfill:variants --workspace=packages/api -- --commit

**Not optional, and not deferrable.** The migration writes masters only. Until
this finishes, every preset URL is a 404 and the app shows blank images. Run it
immediately after the migration, before the frontend for that environment is
used.

Idempotent by HEAD-probing the largest variant, so a re-run only touches what
is missing. `--skip-probe` on a first run where nothing has variants yet.

Keep `--concurrency` modest (default 5). At 10, with the five variant uploads
issued in parallel, the Frankfurt edge collapsed into mass `fetch failed` after
about 50 assets.

### 6. Verify

- Upload a fresh image through the admin panel; the returned URL must be a
  `b-cdn.net` one, **not** `/uploads/...`.
- Open a product grid and a product detail page; images must render.
- Spot-check that a card is pulling `_w300.webp`, not the master.

---

## Cloudinary

**Do not cancel the account** while any row still points at
`res.cloudinary.com`. The migration reads *from* Cloudinary — cancelling first
makes the masters unrecoverable. Retire it only once every environment is
migrated and verified.

At that point, the Cloudinary branch in `packages/shared/src/api/imageUrl.ts`
can be deleted too.

---

## Known gaps

- **`prisma/purge-orphan-images.ts` is Cloudinary-only.** It cannot see
  orphans in a Bunny zone. Replacing a product image leaves the old master and
  its five variants behind, billed forever.
- **Nothing deletes on replace.** Now that uploads proxy through the API this
  is finally possible, and it would stop orphans accruing at the source.
- **The variant ladder is closed.** Adding a width means re-running the
  backfill over every asset. Widths live in `packages/api/src/lib/imageVariants.ts`
  and are mirrored in `packages/shared/src/api/imageUrl.ts` — a width named in
  one but not generated by the other is a 404.
