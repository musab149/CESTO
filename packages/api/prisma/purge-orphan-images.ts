/**
 * Find (and optionally delete) Cloudinary assets that nothing in the database
 * references any more.
 *
 * Nothing in the app has ever called Cloudinary's destroy API: deleting a
 * product, replacing a banner or swapping a store logo drops the row's URL and
 * leaves the file behind, billed as storage forever.
 *
 *   npx ts-node prisma/purge-orphan-images.ts                 # dry run, default
 *   npx ts-node prisma/purge-orphan-images.ts --delete        # actually destroy
 *   npx ts-node prisma/purge-orphan-images.ts --min-age-days=30
 *   npx ts-node prisma/purge-orphan-images.ts --json=out.json # full report
 *
 * SAFETY
 *  - Dry run unless `--delete` is passed. Prints exactly what it would remove.
 *  - Assets newer than --min-age-days (default 7) are NEVER touched. An admin
 *    uploads an image and then saves the product; in between, the asset is
 *    genuinely orphaned and deleting it would break the form they are filling in.
 *  - Bails out if the reference scan finds zero URLs, which almost certainly
 *    means a broken query rather than a genuinely empty catalogue.
 *
 * Same shape as fix-image-urls.ts — a one-off maintenance script, run by hand.
 *
 * SCOPE: Cloudinary only. Uploads now go to Bunny Edge Storage, so this script
 * covers the legacy backlog and nothing else — it will not see, and cannot
 * delete, an orphaned object in the Bunny storage zone. A Bunny equivalent
 * (list via GET https://{region}/{zone}/{folder}/, delete via DELETE on the
 * object path — see src/lib/bunny.ts) is still to be written. Better still,
 * now that uploads proxy through the API, deleting on replace is finally
 * possible and would stop orphans accruing in the first place.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const KEY = process.env.CLOUDINARY_API_KEY;
const SECRET = process.env.CLOUDINARY_API_SECRET;

const args = process.argv.slice(2);
const DO_DELETE = args.includes('--delete');
const MIN_AGE_DAYS = Number(
  (args.find((a) => a.startsWith('--min-age-days=')) ?? '--min-age-days=7').split('=')[1],
);
const JSON_OUT = args.find((a) => a.startsWith('--json='))?.split('=')[1] ?? null;

/** Every Cloudinary URL in the DB, whatever shape it was stored in. */
const CLOUDINARY_URL_RE = /https?:\/\/res\.cloudinary\.com\/[^"'\s\\)]+/gi;

/**
 * Pull the public_id out of a delivery URL.
 *
 *   .../image/upload/v1788796487/products/abc.png            → products/abc
 *   .../image/upload/f_auto,q_auto,c_limit,w_300/v1/x/y.webp → x/y
 *
 * Transformation segments are skipped (they contain a comma, or read as
 * `<one-or-two letters>_<value>`), then the `v1234` version segment, and the
 * extension is dropped. Folders are part of the id, so they stay.
 */
export function publicIdFromUrl(url: string): string | null {
  const marker = '/image/upload/';
  const at = url.indexOf(marker);
  if (at === -1) return null;

  let rest = url.slice(at + marker.length).split('?')[0].split('#')[0];
  const segments = rest.split('/').filter(Boolean);

  let i = 0;
  while (
    i < segments.length &&
    (segments[i].includes(',') || /^[a-z]{1,2}_[^/]+$/i.test(segments[i]))
  ) i++;
  if (i < segments.length && /^v\d+$/.test(segments[i])) i++;

  const idWithExt = segments.slice(i).join('/');
  if (!idWithExt) return null;
  return idWithExt.replace(/\.[a-z0-9]+$/i, '');
}

/** Collect every public_id the database still points at. */
async function collectReferenced(): Promise<Set<string>> {
  const urls: string[] = [];
  const push = (v: unknown) => { if (typeof v === 'string' && v) urls.push(v); };

  const [products, banners, categories, stores, brands, origins, packs, users, sections, settings] =
    await Promise.all([
      prisma.productImage.findMany({ select: { url: true } }),
      prisma.banner.findMany({ select: { image_desktop: true, image_mobile: true } }),
      prisma.category.findMany({ select: { icon_url: true } }),
      prisma.store.findMany({ select: { logo_url: true, cover_url: true } }),
      prisma.brand.findMany({ select: { logo_url: true } }),
      prisma.origin.findMany({ select: { image_url: true } }),
      prisma.rashanPack.findMany({ select: { cover_url: true } }),
      prisma.user.findMany({ select: { avatar_url: true } }),
      // Home sections and settings keep their images inside JSON blobs, so
      // there is no column to select — scan the serialised config instead.
      prisma.homeSection.findMany({ select: { config: true } }),
      prisma.appSetting.findMany({ select: { config: true } }),
    ]);

  products.forEach((r) => push(r.url));
  banners.forEach((r) => { push(r.image_desktop); push(r.image_mobile); });
  categories.forEach((r) => push(r.icon_url));
  stores.forEach((r) => { push(r.logo_url); push(r.cover_url); });
  brands.forEach((r) => push(r.logo_url));
  origins.forEach((r) => push(r.image_url));
  packs.forEach((r) => push(r.cover_url));
  users.forEach((r) => push(r.avatar_url));

  for (const blob of [...sections.map((s) => s.config), ...settings.map((s) => s.config)]) {
    const matches = JSON.stringify(blob ?? {}).match(CLOUDINARY_URL_RE);
    if (matches) urls.push(...matches);
  }

  const ids = new Set<string>();
  for (const u of urls) {
    const id = publicIdFromUrl(u);
    if (id) ids.add(id);
  }
  return ids;
}

interface CloudinaryResource { public_id: string; bytes: number; created_at: string; format: string }

/** Page through every image in the account. */
async function listAllAssets(): Promise<CloudinaryResource[]> {
  const auth = Buffer.from(`${KEY}:${SECRET}`).toString('base64');
  const out: CloudinaryResource[] = [];
  let cursor: string | undefined;

  do {
    const url = new URL(`https://api.cloudinary.com/v1_1/${CLOUD}/resources/image`);
    url.searchParams.set('max_results', '500');
    if (cursor) url.searchParams.set('next_cursor', cursor);

    const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) {
      throw new Error(`Cloudinary Admin API ${res.status}: ${await res.text()}`);
    }
    const body = (await res.json()) as { resources: CloudinaryResource[]; next_cursor?: string };
    out.push(...body.resources);
    cursor = body.next_cursor;
    process.stdout.write(`\r  listed ${out.length} assets…`);
  } while (cursor);

  process.stdout.write('\n');
  return out;
}

/** Cloudinary caps a bulk delete at 100 ids per call. */
async function destroyBatch(ids: string[]): Promise<number> {
  const auth = Buffer.from(`${KEY}:${SECRET}`).toString('base64');
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const url = new URL(`https://api.cloudinary.com/v1_1/${CLOUD}/resources/image/upload`);
    batch.forEach((id) => url.searchParams.append('public_ids[]', id));

    const res = await fetch(url, { method: 'DELETE', headers: { Authorization: `Basic ${auth}` } });
    if (!res.ok) throw new Error(`Delete failed ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { deleted: Record<string, string> };
    deleted += Object.values(body.deleted ?? {}).filter((v) => v === 'deleted').length;
    console.log(`  deleted ${Math.min(i + 100, ids.length)}/${ids.length}`);
  }
  return deleted;
}

const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

async function main() {
  if (!CLOUD || !KEY || !SECRET) {
    throw new Error('CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET must be set.');
  }

  console.log(`\nMode: ${DO_DELETE ? 'DELETE' : 'dry run'} · keeping anything newer than ${MIN_AGE_DAYS} days\n`);

  console.log('Scanning database references…');
  const referenced = await collectReferenced();
  console.log(`  ${referenced.size} public_ids referenced\n`);

  if (referenced.size === 0) {
    throw new Error('Zero references found — refusing to continue. That is far more likely to be a broken query than an empty catalogue.');
  }

  console.log('Listing Cloudinary assets…');
  const assets = await listAllAssets();
  console.log('');

  const cutoff = Date.now() - MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
  const orphans: CloudinaryResource[] = [];
  let tooNew = 0;

  for (const a of assets) {
    if (referenced.has(a.public_id)) continue;
    if (new Date(a.created_at).getTime() > cutoff) { tooNew++; continue; }
    orphans.push(a);
  }

  const orphanBytes = orphans.reduce((s, a) => s + (a.bytes ?? 0), 0);
  const totalBytes = assets.reduce((s, a) => s + (a.bytes ?? 0), 0);

  console.log('─'.repeat(58));
  console.log(`  assets in account   ${assets.length}  (${mb(totalBytes)})`);
  console.log(`  referenced in DB    ${referenced.size}`);
  console.log(`  too new to touch    ${tooNew}`);
  console.log(`  ORPHANED            ${orphans.length}  (${mb(orphanBytes)})`);
  console.log('─'.repeat(58));

  for (const a of orphans.slice(0, 25)) {
    console.log(`    ${a.public_id}  ${mb(a.bytes ?? 0)}  ${a.created_at.slice(0, 10)}`);
  }
  if (orphans.length > 25) console.log(`    … and ${orphans.length - 25} more`);

  if (JSON_OUT) {
    const fs = await import('fs');
    fs.writeFileSync(JSON_OUT, JSON.stringify({ orphans, orphanBytes, totalAssets: assets.length }, null, 2));
    console.log(`\n  full report → ${JSON_OUT}`);
  }

  if (!DO_DELETE) {
    console.log('\nDry run — nothing deleted. Re-run with --delete to remove the above.');
    return;
  }
  if (orphans.length === 0) {
    console.log('\nNothing to delete.');
    return;
  }

  console.log(`\nDeleting ${orphans.length} assets…`);
  const deleted = await destroyBatch(orphans.map((a) => a.public_id));
  console.log(`\nDone. ${deleted} deleted, ~${mb(orphanBytes)} reclaimed.`);
}

main()
  .catch((e) => { console.error('\n' + (e instanceof Error ? e.message : String(e))); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
