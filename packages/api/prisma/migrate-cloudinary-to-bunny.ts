/**
 * Move every Cloudinary asset the database still references onto Bunny, then
 * rewrite the rows to point at the new URLs.
 *
 *   npx ts-node prisma/migrate-cloudinary-to-bunny.ts                  # dry run
 *   npx ts-node prisma/migrate-cloudinary-to-bunny.ts --limit=5        # smoke test
 *   npx ts-node prisma/migrate-cloudinary-to-bunny.ts --commit         # do it
 *   npx ts-node prisma/migrate-cloudinary-to-bunny.ts --rollback --commit
 *
 * Flags:
 *   --commit         actually upload and write. Without it, nothing changes.
 *   --limit=N        process only the first N distinct assets. Use it first.
 *   --map=PATH       transfer ledger (default prisma/cloudinary-to-bunny.map.json)
 *   --concurrency=N  parallel transfers (default 4)
 *   --no-optimize    copy bytes verbatim instead of re-encoding to WebP
 *   --no-verify      skip the post-upload readback (not recommended)
 *   --rollback       rewrite the DB back to the Cloudinary URLs in the map
 *
 * ─── How it works ───────────────────────────────────────────────────────────
 *
 * Three phases, deliberately separated so a failure in one never leaves the
 * database pointing at something that does not exist:
 *
 *   1. SCAN      find every Cloudinary URL and the exact row + column it sits
 *                in. Two of those "columns" are JSON blobs, handled by string
 *                replacement inside the serialised config.
 *   2. TRANSFER  download each distinct asset, optionally re-encode, PUT to
 *                Bunny, read it back through the CDN to prove it is really
 *                there, generate and upload its width variants, and only then
 *                append it to the ledger.
 *   3. REWRITE   update rows, using only ledger entries that passed step 2.
 *
 * The ledger is the safety net. It is written incrementally, so a crashed or
 * interrupted run resumes instead of re-downloading everything, and it records
 * old -> new for every asset, which is what makes --rollback possible.
 *
 * Variants are generated in step 2 rather than by a later `backfill:variants`
 * pass, and that ordering is load-bearing. A row is only ever rewritten to an
 * asset that reached the ledger, and an asset only reaches the ledger after its
 * ladder is uploaded — so no row can point at a variant that does not exist.
 * Bunny Optimizer is off, so a missing variant is a 404, not a downgrade; a
 * separate backfill would leave migrated rows blank for the length of the run,
 * which on production's 7,500+ assets is hours on a live storefront.
 *
 * ─── Why re-encode by default ───────────────────────────────────────────────
 *
 * The masters in the Cloudinary account were never capped on the way in — the
 * measured example is a 1254px PNG at 1.86 MB. Pushing those across verbatim
 * would carry that bill onto Bunny unchanged. Running them through the same
 * pipeline new uploads use (src/lib/uploadTransform.ts) took that example to
 * 229 KB with alpha intact. `--no-optimize` opts out if a byte-exact copy
 * matters more.
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { loadEnv, describeTarget } from '../src/lib/loadEnv';
import { bunnyConfig, uploadObjectToBunny } from '../src/lib/bunny';
import { normaliseForStorage } from '../src/lib/uploadTransform';
import { renderVariants, variantPath } from '../src/lib/imageVariants';

// Load .env explicitly, and BEFORE anything reads process.env. Prisma happens
// to load it too, which is why the DB connection worked without this — but
// relying on that side effect meant BUNNY_* could read as unset while sitting
// right there in the file, and the script would refuse to run for no visible
// reason. server.ts is the only other place that calls this.
const ENV = loadEnv();

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;

const COMMIT = flag('commit');
const ROLLBACK = flag('rollback');
const OPTIMIZE = !flag('no-optimize');
const VERIFY = !flag('no-verify');
const LIMIT = Number(opt('limit', '0')) || Infinity;
const CONCURRENCY = Math.max(1, Number(opt('concurrency', '4')) || 4);
/**
 * Ledger path, derived from the env file so two environments can never share
 * one.
 *
 *   .env           -> cloudinary-to-bunny.map.json
 *   .env.staging   -> cloudinary-to-bunny.staging.map.json
 *
 * Sharing a ledger is not a tidiness problem, it is a correctness one. An
 * asset present in two environments would be found "already in ledger" on the
 * second run, so it would skip the transfer and rewrite that row to the URL
 * from the FIRST run — pointing a staging row at the production zone. It also
 * destroys the file's other job: being the rollback record for one specific
 * run against one specific database.
 *
 * --map= still overrides, for the case where you genuinely want to resume a
 * named run.
 */
const ENV_SUFFIX = path.basename(ENV.file).replace(/^\.env\.?/, '');
const DEFAULT_MAP = `cloudinary-to-bunny${ENV_SUFFIX ? `.${ENV_SUFFIX}` : ''}.map.json`;
const MAP_PATH = path.resolve(opt('map', path.join(__dirname, DEFAULT_MAP)));

/** Every Cloudinary URL in the DB, whatever shape it was stored in. */
const CLOUDINARY_URL_RE = /https?:\/\/res\.cloudinary\.com\/[^"'\s\\)]+/gi;

// ─── Types ──────────────────────────────────────────────────────────────────

type Folder = 'products' | 'banners' | 'categories' | 'avatars';

/** A Cloudinary URL sitting in a plain string column. */
interface ColumnRef {
  kind: 'column';
  model: string;
  id: string;
  /** Which id field to match on — HomeSection and AppSetting key on `key`. */
  idField: 'id' | 'key';
  column: string;
  url: string;
  folder: Folder;
}

/** A row whose images live inside a JSON blob, rewritten by string replace. */
interface JsonRef {
  kind: 'json';
  model: string;
  id: string;
  idField: 'key';
  column: string;
  urls: string[];
  folder: Folder;
}

type Ref = ColumnRef | JsonRef;

interface LedgerEntry {
  newUrl: string;
  objectPath: string;
  sourceBytes: number;
  storedBytes: number;
  at: string;
}

type Ledger = Record<string, LedgerEntry>;

// ─── Phase 1 · scan ─────────────────────────────────────────────────────────

const isCloudinary = (v: unknown): v is string =>
  typeof v === 'string' && /^https?:\/\/res\.cloudinary\.com\//i.test(v);

/**
 * Collect every Cloudinary reference together with where it lives.
 *
 * Mirrors the table/column list in purge-orphan-images.ts. If a new column
 * ever starts holding an image URL, both files need it — there is no schema
 * metadata that would let us discover them automatically.
 */
async function collectRefs(): Promise<Ref[]> {
  const refs: Ref[] = [];
  const add = (
    model: string, id: string, column: string, url: unknown, folder: Folder,
    idField: 'id' | 'key' = 'id',
  ) => {
    if (isCloudinary(url)) refs.push({ kind: 'column', model, id, idField, column, url, folder });
  };

  const [products, banners, categories, stores, brands, origins, packs, users, sections, settings] =
    await Promise.all([
      prisma.productImage.findMany({ select: { id: true, url: true } }),
      prisma.banner.findMany({ select: { id: true, image_desktop: true, image_mobile: true } }),
      prisma.category.findMany({ select: { id: true, icon_url: true } }),
      prisma.store.findMany({ select: { id: true, logo_url: true, cover_url: true } }),
      prisma.brand.findMany({ select: { id: true, logo_url: true } }),
      prisma.origin.findMany({ select: { id: true, image_url: true } }),
      prisma.rashanPack.findMany({ select: { id: true, cover_url: true } }),
      prisma.user.findMany({ select: { id: true, avatar_url: true } }),
      prisma.homeSection.findMany({ select: { key: true, config: true } }),
      prisma.appSetting.findMany({ select: { key: true, config: true } }),
    ]);

  products.forEach((r) => add('productImage', r.id, 'url', r.url, 'products'));
  banners.forEach((r) => {
    add('banner', r.id, 'image_desktop', r.image_desktop, 'banners');
    add('banner', r.id, 'image_mobile', r.image_mobile, 'banners');
  });
  categories.forEach((r) => add('category', r.id, 'icon_url', r.icon_url, 'categories'));
  stores.forEach((r) => {
    add('store', r.id, 'logo_url', r.logo_url, 'products');
    add('store', r.id, 'cover_url', r.cover_url, 'banners');
  });
  brands.forEach((r) => add('brand', r.id, 'logo_url', r.logo_url, 'products'));
  origins.forEach((r) => add('origin', r.id, 'image_url', r.image_url, 'categories'));
  packs.forEach((r) => add('rashanPack', r.id, 'cover_url', r.cover_url, 'banners'));
  // Avatars are the only folder with a tighter cap (512px), so they must not
  // be lumped in with catalogue imagery.
  users.forEach((r) => add('user', r.id, 'avatar_url', r.avatar_url, 'avatars'));

  const jsonRows: Array<[string, string, Prisma.JsonValue | null]> = [
    ...sections.map((s) => ['homeSection', s.key, s.config] as [string, string, Prisma.JsonValue | null]),
    ...settings.map((s) => ['appSetting', s.key, s.config] as [string, string, Prisma.JsonValue | null]),
  ];
  for (const [model, key, config] of jsonRows) {
    const matches = JSON.stringify(config ?? {}).match(CLOUDINARY_URL_RE);
    if (!matches?.length) continue;
    refs.push({
      kind: 'json', model, id: key, idField: 'key', column: 'config',
      urls: [...new Set(matches)], folder: 'banners',
    });
  }

  return refs;
}

// ─── Phase 2 · transfer ─────────────────────────────────────────────────────

/**
 * Strip transformation segments so we fetch the master, not a resized
 * derivative. Stored URLs should already be untransformed — resolveImageUrl
 * adds the transform at render time — but a hand-built row could carry one,
 * and migrating a 300px derivative as if it were the original is unrecoverable
 * once Cloudinary is gone.
 */
export function masterUrlOf(url: string): string {
  const marker = '/image/upload/';
  const at = url.indexOf(marker);
  if (at === -1) return url;

  const base = url.slice(0, at + marker.length);
  const rest = url.slice(at + marker.length).split('?')[0].split('#')[0];
  const segments = rest.split('/').filter(Boolean);

  let i = 0;
  while (
    i < segments.length &&
    (segments[i].includes(',') || /^[a-z]{1,2}_[^/]+$/i.test(segments[i]))
  ) i++;

  return base + segments.slice(i).join('/');
}

/**
 * Bunny object path for a Cloudinary URL, mirroring its public_id so a
 * migrated object stays traceable to what it replaced. Anything whose id is
 * not already under one of our folders goes under `migrated/` rather than
 * being scattered across the zone root.
 */
export function objectPathFor(url: string, ext: string): string {
  const master = masterUrlOf(url);
  const marker = '/image/upload/';
  const rest = master.slice(master.indexOf(marker) + marker.length);
  const segments = rest.split('/').filter(Boolean);

  // Drop the `v1788796487` version segment; it is not part of the identity.
  if (/^v\d+$/.test(segments[0] ?? '')) segments.shift();

  const publicId = segments.join('/').replace(/\.[a-z0-9]+$/i, '');
  const safe = publicId.replace(/[^A-Za-z0-9/_-]/g, '_');
  if (!safe) throw new Error(`Could not derive an object path from ${url}`);

  const known = ['products', 'banners', 'categories', 'avatars'];
  const prefixed = known.some((f) => safe.startsWith(`${f}/`)) ? safe : `migrated/${safe}`;
  return `${prefixed}${ext}`;
}

async function fetchMaster(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(masterUrlOf(url));
  if (!res.ok) throw new Error(`source fetch ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('source returned 0 bytes');
  return {
    buffer,
    contentType: res.headers.get('content-type') ?? 'image/jpeg',
  };
}

/**
 * Read the object back through the CDN before we let it into the ledger.
 *
 * A successful PUT to storage is not proof the pull zone can serve it, and the
 * whole failure mode this script has to avoid is rewriting the database to
 * point at 404s. One retry covers propagation on a cold path.
 */
async function verifyReadable(newUrl: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1500));
    try {
      const res = await fetch(newUrl, { method: 'GET', headers: { Range: 'bytes=0-0' } });
      if (res.ok || res.status === 206) return;
    } catch { /* retry */ }
  }
  throw new Error('uploaded but not readable through the pull zone');
}

async function transferOne(url: string, folder: Folder): Promise<LedgerEntry> {
  const { buffer, contentType } = await fetchMaster(url);

  const stored = OPTIMIZE
    ? await normaliseForStorage(buffer, contentType, folder)
    : { buffer, ext: path.extname(new URL(masterUrlOf(url)).pathname) || '.jpg', contentType };

  const objectPath = objectPathFor(url, stored.ext);
  const newUrl = await uploadObjectToBunny(objectPath, stored.buffer, stored.contentType);
  if (VERIFY) await verifyReadable(newUrl);

  // ─── Variants, here and not in a later pass ─────────────
  //
  // The rewrite phase only ever points a row at an asset that reached the
  // ledger, and an asset only reaches the ledger by returning from here. So
  // generating the ladder now means no row is ever rewritten to a URL whose
  // variants do not exist yet.
  //
  // That ordering is the whole point. Bunny Optimizer is not enabled, so
  // resolveImageUrl rewrites a card to `_w300.webp` — a real file, or a 404.
  // Leaving variants to `backfill:variants` afterwards opens a window where
  // migrated rows render blank, and that window is the length of the run.
  // On 894 local assets it was minutes; on production's 7,527 it would be
  // hours of blank images on a live storefront.
  //
  // Uploads are sequential within an asset on purpose: firing all five in
  // parallel multiplied the pool's concurrency by five and collapsed the
  // Frankfurt edge into mass `fetch failed` during the local backfill.
  let variantBytes = 0;
  if (stored.ext === '.webp') {
    for (const v of await renderVariants(stored.buffer)) {
      await uploadObjectToBunny(variantPath(objectPath, v.width), v.buffer, v.contentType);
      variantBytes += v.buffer.length;
    }
  }

  return {
    newUrl,
    objectPath,
    sourceBytes: buffer.length,
    storedBytes: stored.buffer.length + variantBytes,
    at: new Date().toISOString(),
  };
}

/** Bounded-concurrency map. Keeps Cloudinary and Bunny from being hammered. */
async function pooled<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        await fn(items[i], i);
      }
    }),
  );
}

// ─── Phase 3 · rewrite ──────────────────────────────────────────────────────

/**
 * Apply the ledger to the database. `direction` decides which way the mapping
 * is read, which is the whole of --rollback: the same engine, keys and values
 * swapped.
 */
async function rewrite(refs: Ref[], ledger: Ledger, direction: 'forward' | 'back') {
  const lookup = new Map<string, string>();
  for (const [oldUrl, entry] of Object.entries(ledger)) {
    if (direction === 'forward') lookup.set(oldUrl, entry.newUrl);
    else lookup.set(entry.newUrl, oldUrl);
  }

  let rows = 0;
  let skipped = 0;
  let vanished = 0;

  /**
   * A row that existed during the scan can be gone by the time the rewrite
   * reaches it. On production the scan-to-rewrite gap is hours, and the
   * database is live — a deleted product is normal business, not corruption.
   *
   * Prisma raises P2025 for that. The first production run treated it as fatal
   * and aborted the whole rewrite partway through, leaving most rows migrated
   * and the rest not, with a non-zero exit and no summary. Skipping the row is
   * the correct response: there is nothing to point at any more.
   */
  const isMissingRecord = (e: unknown) =>
    e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025';

  for (const ref of refs) {
    const model = (prisma as any)[ref.model];
    const where = { [ref.idField]: ref.id };

    if (ref.kind === 'column') {
      const next = lookup.get(ref.url);
      if (!next) { skipped++; continue; }
      try {
        if (COMMIT) await model.update({ where, data: { [ref.column]: next } });
        rows++;
      } catch (e) {
        if (!isMissingRecord(e)) throw e;
        vanished++;
      }
      continue;
    }

    // JSON blob: replace inside the serialised config so nested shapes and
    // arrays are handled without knowing the schema of each section type.
    const row = await model.findUnique({ where, select: { [ref.column]: true } });
    if (!row) { skipped++; continue; }

    let json = JSON.stringify(row[ref.column] ?? {});
    let changed = false;
    for (const [from, to] of lookup) {
      if (!json.includes(from)) continue;
      json = json.split(from).join(to);
      changed = true;
    }
    if (!changed) { skipped++; continue; }

    try {
      if (COMMIT) {
        await model.update({ where, data: { [ref.column]: JSON.parse(json) as Prisma.InputJsonValue } });
      }
      rows++;
    } catch (e) {
      if (!isMissingRecord(e)) throw e;
      vanished++;
    }
  }

  return { rows, skipped, vanished };
}

// ─── Ledger ─────────────────────────────────────────────────────────────────

function loadLedger(): Ledger {
  if (!fs.existsSync(MAP_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(MAP_PATH, 'utf8')) as Ledger;
  } catch {
    throw new Error(`Ledger at ${MAP_PATH} is not valid JSON. Move it aside or fix it — refusing to overwrite a file I cannot read.`);
  }
}

function saveLedger(ledger: Ledger) {
  fs.writeFileSync(MAP_PATH, JSON.stringify(ledger, null, 2));
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const cfg = bunnyConfig();
  if (!cfg) {
    throw new Error('BUNNY_STORAGE_ZONE / BUNNY_STORAGE_KEY / BUNNY_CDN_URL must be set.');
  }

  const ledger = loadLedger();

  console.log(`\nMode: ${ROLLBACK ? 'ROLLBACK' : 'MIGRATE'} · ${COMMIT ? 'COMMIT (writes)' : 'dry run'}`);
  console.log(describeTarget(ENV, { zone: `${cfg.zone} -> ${cfg.cdnUrl}` }));
  console.log(`Ledger: ${MAP_PATH} (${Object.keys(ledger).length} entries)\n`);

  console.log('Scanning database…');
  const refs = await collectRefs();

  if (ROLLBACK) {
    if (!Object.keys(ledger).length) throw new Error('Ledger is empty — nothing to roll back to.');
    const { rows, skipped, vanished } = await rewrite(refs, ledger, 'back');
    console.log(`\n${COMMIT ? 'Reverted' : 'Would revert'} ${rows} row(s); ${skipped} untouched`
      + (vanished ? `; ${vanished} deleted since the scan` : '') + '.');
    if (!COMMIT) console.log('Dry run — pass --commit to apply.');
    return;
  }

  // One entry per distinct asset: the same Cloudinary image can be referenced
  // by many rows, and it must only be transferred once.
  const distinct = new Map<string, Folder>();
  for (const ref of refs) {
    if (ref.kind === 'column') {
      if (!distinct.has(ref.url)) distinct.set(ref.url, ref.folder);
    } else {
      for (const u of ref.urls) if (!distinct.has(u)) distinct.set(u, ref.folder);
    }
  }

  const rowCount = refs.reduce((n, r) => n + (r.kind === 'column' ? 1 : r.urls.length), 0);
  console.log(`  ${distinct.size} distinct asset(s) across ${rowCount} reference(s) in ${refs.length} row(s)\n`);

  if (!distinct.size) {
    console.log('Nothing references Cloudinary. Already migrated, or nothing to do.');
    return;
  }

  // Keep these two counts apart. Collapsing them into one "already done"
  // number reads as though --limit had migrated far more than it has.
  const outstanding = [...distinct.entries()].filter(([url]) => !ledger[url]);
  const alreadyDone = distinct.size - outstanding.length;
  const pending = outstanding.slice(0, LIMIT === Infinity ? undefined : LIMIT);
  const heldBack = outstanding.length - pending.length;

  console.log(
    `Transferring ${pending.length}` +
    ` · ${alreadyDone} already in ledger` +
    (heldBack ? ` · ${heldBack} held back by --limit` : '') +
    '…',
  );

  if (!COMMIT) {
    for (const [url, folder] of pending.slice(0, 10)) {
      console.log(`  would move  [${folder}] ${url}`);
    }
    if (pending.length > 10) console.log(`  … and ${pending.length - 10} more`);
    console.log('\nDry run — no bytes moved, no rows written. Pass --commit to apply.');
    console.log('Tip: start with `--commit --limit=5` and eyeball the result in the admin panel.');
    return;
  }

  let done = 0;
  const failures: Array<{ url: string; reason: string }> = [];

  await pooled(pending, CONCURRENCY, async ([url, folder]) => {
    try {
      const entry = await transferOne(url, folder);
      ledger[url] = entry;
      done++;
      // Persist as we go, but not on every single asset. saveLedger rewrites
      // the whole file, and at production scale (7,500+ entries, ~1.5 MB) doing
      // that per asset means gigabytes of writes and a growing stall on each
      // one. Every 25 is a cheap compromise: a crash re-transfers at most 25
      // assets, which is harmless because object paths are deterministic and a
      // re-upload overwrites an identical file.
      if (done % 25 === 0) saveLedger(ledger);
      process.stdout.write(`\r  transferred ${done}/${pending.length}…`);
    } catch (e) {
      failures.push({ url, reason: e instanceof Error ? e.message : String(e) });
    }
  });

  process.stdout.write('\n');
  saveLedger(ledger);

  const moved = Object.values(ledger);
  const savedBytes = moved.reduce((n, e) => n + (e.sourceBytes - e.storedBytes), 0);
  console.log(`\nTransferred ${done}, failed ${failures.length}.`);
  if (OPTIMIZE && moved.length) {
    console.log(`Re-encode saved ${mb(savedBytes)} across ${moved.length} asset(s).`);
  }

  for (const f of failures.slice(0, 20)) console.log(`  FAIL ${f.url}\n       ${f.reason}`);
  if (failures.length > 20) console.log(`  … and ${failures.length - 20} more`);

  // Rows are only ever pointed at ledger entries, and an asset reaches the
  // ledger only after it has been read back through the CDN. A partial
  // transfer therefore rewrites a partial set of rows and leaves the rest on
  // Cloudinary, still working — which is why dual-mode delivery stays.
  console.log('\nRewriting rows…');
  const { rows, skipped, vanished } = await rewrite(refs, ledger, 'forward');
  console.log(`Updated ${rows} row(s); ${skipped} left on Cloudinary (no ledger entry yet)`
    + (vanished ? `; ${vanished} row(s) deleted since the scan and skipped` : '') + '.');

  if (failures.length || skipped) {
    console.log('\nRe-run to retry what did not make it. The ledger makes this resumable.');
  } else {
    console.log('\nAll references migrated. Cloudinary can be retired once you have verified the app.');
  }
  // Echo the env flag back. Without it this line reads as a command that would
  // roll back LOCAL, which is the opposite of what someone copying it wants.
  const envFlag = ENV.file.endsWith(`${path.sep}.env`) ? '' : ` --env=${path.basename(ENV.file)}`;
  console.log(`Rollback: npm run migrate:cloudinary-to-bunny --workspace=packages/api --${envFlag} --rollback --commit`);
}

// Only when run directly. Without this guard, importing the module — which the
// unit test alongside it does, to reach the URL helpers — would kick off a
// migration as a side effect of the import.
if (require.main === module) {
  main()
    .catch((e) => { console.error(`\n${e instanceof Error ? e.message : e}`); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
