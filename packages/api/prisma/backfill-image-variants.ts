/**
 * Write the missing `_wNNN` variants for masters that never got any.
 *
 * ─── Why this exists ────────────────────────────────────────────────────
 *
 * Three commits landed in the wrong order:
 *
 *   2026-09-09  the Cloudinary → Bunny migration shipped — masters only
 *   2026-09-10  the apps switched to requesting `_w200`/`_w300`/… variants
 *   2026-09-11  variant generation was added TO the migration
 *
 * Anything migrated before the 11th therefore has a master on the CDN and no
 * variants beside it, while anything uploaded through the app since the 10th
 * has both. The apps cannot tell the difference: `hasVariants()` decides from
 * the file extension alone, so every `.webp` master is assumed to have the
 * ladder. When it does not, the browser and the phone both request a file
 * that 404s and render nothing.
 *
 * Store logos and covers are the visible case — they carry Cloudinary-style
 * names (`/banners/r3lq5d1esahqtjcjhaom.webp`) because they were migrated,
 * while product images carry app-generated names and were uploaded later.
 * That is why stores break and products do not.
 *
 * ─── What it does ───────────────────────────────────────────────────────
 *
 * Reads every image URL the database holds, asks the Bunny STORAGE API which
 * variants already exist, and renders + uploads only the missing ones from the
 * master. It never deletes, never rewrites the database, and is safe to run
 * repeatedly: a master that already has its five widths costs one HEAD each.
 *
 * The storage API is used rather than the CDN deliberately — the CDN caches
 * 404s and can answer from an edge that has not seen a new upload yet, so it
 * is the wrong thing to ask "does this file exist?".
 *
 * ─── Usage ──────────────────────────────────────────────────────────────
 *
 *   npm run backfill:variants --workspace=packages/api              # reports only
 *   npm run backfill:variants --workspace=packages/api -- --commit  # writes
 *
 * Flags:
 *   --commit         actually render and upload; without it nothing is written
 *   --only=stores    limit to one source (stores | products | banners | …)
 *   --limit=N        stop after N masters, for a cautious first pass
 *
 * Point it at an environment by its own .env: this reads DATABASE_URL and the
 * BUNNY_* vars exactly as the API does, so running it against production means
 * running it with production's env.
 */
import dotenv from 'dotenv';
dotenv.config();

import prisma from '../src/lib/prisma';
import { bunnyConfig } from '../src/lib/bunny';
import { renderVariants, variantPath, VARIANT_WIDTHS } from '../src/lib/imageVariants';

const args = process.argv.slice(2);
/**
 * Writing takes --commit. A bare run reports and writes nothing.
 *
 * This script replaced an older one that lived in scripts/ and took exactly
 * the opposite default: there, a bare run was the dry run and --commit wrote.
 * Both existed at once, under the same npm script name declared twice in
 * package.json, while docs/BUNNY_ROLLOUT.md documented the old flags. Anyone
 * following that doc would have re-rendered and re-uploaded every master.
 *
 * The safe default is the one where forgetting a flag costs a wasted minute
 * rather than 868 uploads, so --commit is what writes here too.
 */
const DRY_RUN = !args.includes('--commit');
const ONLY = args.find((a) => a.startsWith('--only='))?.split('=')[1] ?? null;
const LIMIT = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 0) || null;

/**
 * A dry run only reads, so it should not need a key that can write.
 *
 * Bunny issues a separate read-only password per storage zone; set
 * BUNNY_STORAGE_READONLY_KEY and the report runs on that, leaving the
 * read-write key for the run that actually uploads.
 */
const READONLY_KEY = process.env.BUNNY_STORAGE_READONLY_KEY?.trim() || null;

const cfg = bunnyConfig();
if (cfg && DRY_RUN && READONLY_KEY) cfg.accessKey = READONLY_KEY;
if (!cfg) {
  console.error('Bunny is not configured — set BUNNY_STORAGE_ZONE, BUNNY_STORAGE_KEY and BUNNY_CDN_URL.');
  process.exit(1);
}

/** `https://zone.b-cdn.net/banners/x.webp` → `banners/x.webp`, or null if not ours. */
function objectPathOf(url: string): string | null {
  if (!url.startsWith(`${cfg!.cdnUrl}/`)) return null;
  const path = url.slice(cfg!.cdnUrl.length + 1).split('?')[0];
  return path || null;
}

/**
 * Exists / does not exist — and never "I could not tell".
 *
 * An earlier version returned a boolean and treated every non-OK status as
 * "missing". With a key that does not authenticate, Bunny answers 401 to
 * everything, and this reported all 868 masters as needing a backfill. Run
 * without --commit it would have re-rendered and re-uploaded the lot. Only
 * 404 means missing; anything else is a fault worth stopping on.
 */
async function storageHead(objectPath: string): Promise<boolean> {
  // Bunny storage has no HEAD; a ranged GET costs one byte instead of the file.
  const res = await fetch(`https://${cfg!.storageHost}/${cfg!.zone}/${objectPath}`, {
    headers: { AccessKey: cfg!.accessKey, Range: 'bytes=0-0' },
  });
  if (res.ok || res.status === 206) return true;
  if (res.status === 404) return false;
  throw new Error(
    `storage returned ${res.status} for ${objectPath} - this is not "missing". `
    + (res.status === 401 || res.status === 403
      ? 'BUNNY_STORAGE_KEY is wrong for this zone, or BUNNY_STORAGE_HOST is the wrong region.'
      : 'Check the zone and region before trusting any result.'),
  );
}

/**
 * Prove the credentials work before reading a single row. Without this, the
 * first real answer arrives hundreds of lines into a report that is entirely
 * wrong, which is worse than not running at all.
 */
async function preflight(): Promise<void> {
  const res = await fetch(`https://${cfg!.storageHost}/${cfg!.zone}/`, {
    headers: { AccessKey: cfg!.accessKey },
  });
  if (res.ok) return;
  console.error('');
  console.error(`Cannot read storage zone "${cfg!.zone}" at ${cfg!.storageHost} - HTTP ${res.status}.`);
  if (res.status === 401 || res.status === 403) {
    console.error('BUNNY_STORAGE_KEY must be the storage zone PASSWORD (Storage -> FTP & API Access),');
    console.error('not the account API key, and BUNNY_STORAGE_HOST must match the zone region.');
  }
  console.error('Nothing was read or written.');
  process.exit(1);
}

async function storageGet(objectPath: string): Promise<Buffer | null> {
  const res = await fetch(`https://${cfg!.storageHost}/${cfg!.zone}/${objectPath}`, {
    headers: { AccessKey: cfg!.accessKey },
  });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

async function storagePut(objectPath: string, body: Buffer, contentType: string): Promise<void> {
  const res = await fetch(`https://${cfg!.storageHost}/${cfg!.zone}/${objectPath}`, {
    method: 'PUT',
    headers: { AccessKey: cfg!.accessKey, 'Content-Type': contentType },
    body: new Uint8Array(body),
  });
  if (!res.ok) throw new Error(`upload failed (${res.status}) for ${objectPath}`);
}

/** Every Bunny .webp master the database points at, with where it came from. */
async function collectUrls(): Promise<Map<string, Set<string>>> {
  const [images, banners, categories, stores, brands, origins, packs, users, sections, settings] =
    await Promise.all([
      prisma.productImage.findMany({ select: { url: true } }),
      prisma.banner.findMany({ select: { image_desktop: true, image_mobile: true } }),
      prisma.category.findMany({ select: { icon_url: true } }),
      prisma.store.findMany({ select: { logo_url: true, cover_url: true } }),
      prisma.brand.findMany({ select: { logo_url: true } }),
      prisma.origin.findMany({ select: { image_url: true } }),
      prisma.rashanPack.findMany({ select: { cover_url: true } }),
      prisma.user.findMany({ select: { avatar_url: true } }),
      prisma.homeSection.findMany({ select: { config: true } }),
      prisma.appSetting.findMany({ select: { config: true } }),
    ]);

  const found = new Map<string, Set<string>>();
  const add = (source: string, value: unknown) => {
    if (typeof value !== 'string' || !value) return;
    if (!/\.webp(?:$|[?#])/i.test(value)) return;   // only webp masters have a ladder
    if (/_w\d+\.webp/i.test(value)) return;          // already a variant
    if (!objectPathOf(value)) return;                // not on our pull zone
    if (!found.has(value)) found.set(value, new Set());
    found.get(value)!.add(source);
  };

  images.forEach((r) => add('products', r.url));
  banners.forEach((r) => { add('banners', r.image_desktop); add('banners', r.image_mobile); });
  categories.forEach((r) => add('categories', r.icon_url));
  stores.forEach((r) => { add('stores', r.logo_url); add('stores', r.cover_url); });
  brands.forEach((r) => add('brands', r.logo_url));
  origins.forEach((r) => add('origins', r.image_url));
  packs.forEach((r) => add('rashan', r.cover_url));
  users.forEach((r) => add('avatars', r.avatar_url));

  // The JSON blobs (home sections, app settings) hold URLs at shapes that
  // change with the editor. Scanned as text so a new field cannot silently
  // escape the backfill.
  const scanJson = (source: string, config: unknown) => {
    for (const m of JSON.stringify(config ?? '').matchAll(/https?:\/\/[^"'\\ ]+?\.webp/gi)) add(source, m[0]);
  };
  sections.forEach((r) => scanJson('home-sections', r.config));
  settings.forEach((r) => scanJson('settings', r.config));

  return found;
}

async function main() {
  console.log(`Bunny zone: ${cfg!.zone}  ·  CDN: ${cfg!.cdnUrl}`);
  console.log(`Key: ${DRY_RUN && READONLY_KEY ? 'BUNNY_STORAGE_READONLY_KEY' : 'BUNNY_STORAGE_KEY'}`);
  await preflight();
  console.log(DRY_RUN ? 'DRY RUN — nothing will be written\n' : 'Writing missing variants\n');

  const urls = await collectUrls();
  let masters = [...urls.entries()].map(([url, sources]) => ({ url, sources: [...sources] }));
  if (ONLY) masters = masters.filter((m) => m.sources.includes(ONLY));
  if (LIMIT) masters = masters.slice(0, LIMIT);

  console.log(`${masters.length} master images to check\n`);

  const missingBySource = new Map<string, number>();
  let complete = 0, fixed = 0, absent = 0, failed = 0;

  for (const { url, sources } of masters) {
    const objectPath = objectPathOf(url)!;
    const present = await Promise.all(VARIANT_WIDTHS.map((w) => storageHead(variantPath(objectPath, w))));
    const missing = VARIANT_WIDTHS.filter((_, i) => !present[i]);

    if (missing.length === 0) { complete++; continue; }

    for (const s of sources) missingBySource.set(s, (missingBySource.get(s) ?? 0) + 1);

    if (DRY_RUN) {
      console.log(`  missing ${missing.map((w) => `_w${w}`).join(' ')}  [${sources.join(',')}]  ${objectPath}`);
      continue;
    }

    const master = await storageGet(objectPath);
    if (!master) {
      // The master itself is gone: the row points at a file that was never
      // copied, or was deleted. Nothing to render from — report, do not guess.
      absent++;
      console.log(`  MASTER MISSING  [${sources.join(',')}]  ${objectPath}`);
      continue;
    }

    try {
      const rendered = await renderVariants(master);
      for (const v of rendered) {
        if (!missing.includes(v.width)) continue;
        await storagePut(variantPath(objectPath, v.width), v.buffer, v.contentType);
      }
      fixed++;
      console.log(`  wrote ${missing.map((w) => `_w${w}`).join(' ')}  ${objectPath}`);
    } catch (err) {
      failed++;
      console.log(`  FAILED  ${objectPath} — ${(err as Error).message}`);
    }
  }

  console.log('\n─── summary ───');
  console.log(`  already complete : ${complete}`);
  if (DRY_RUN) {
    const total = [...missingBySource.values()].reduce((a, b) => a + b, 0);
    console.log(`  missing variants : ${total}`);
    for (const [source, n] of [...missingBySource].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${source.padEnd(14)} ${n}`);
    }
    console.log('\nRe-run with --commit to write them.');
  } else {
    console.log(`  backfilled       : ${fixed}`);
    console.log(`  master missing   : ${absent}`);
    console.log(`  failed           : ${failed}`);
  }

  await prisma.$disconnect();
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exitCode = 1;
});
