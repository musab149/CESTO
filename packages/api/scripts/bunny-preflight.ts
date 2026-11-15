/**
 * Prove the Bunny setup actually works, before a migration writes 1,648 rows
 * that depend on it.
 *
 *   npm run bunny:preflight --workspace=packages/api
 *
 * Every failure this catches is one that otherwise stays silent. A pull zone
 * pointed at the wrong storage zone still returns 200 for the zone root. An
 * Optimizer that was never switched on ignores `?width=` without complaint and
 * serves the full-size original. Missing WebP/AVIF conversion looks identical
 * to working conversion until someone reads the bandwidth bill. None of it
 * throws, so none of it shows up until it is expensive.
 *
 * So this uploads a real object, fetches it back through the CDN, and checks
 * what actually came over the wire. Then it deletes it again.
 */
import sharp from 'sharp';
import { loadEnv, describeTarget } from '../src/lib/loadEnv';

const ENV = loadEnv();

// Imported after loadEnv so bunnyConfig() sees the file's values.
import { bunnyConfig, uploadObjectToBunny, deleteFromBunny } from '../src/lib/bunny';

const SOURCE_W = 600;
const SOURCE_H = 400;
const RESIZE_W = 40;

type Status = 'pass' | 'fail' | 'warn';

/**
 * Not every failure means the same thing, and conflating them gives bad advice.
 * A bad key or an unreachable pull zone means the migration physically cannot
 * run. A disabled Optimizer means it runs perfectly and the app then serves
 * oversized images — a delivery problem, fixable from the dashboard at any
 * time with no re-migration, because the `?width=` params are appended at
 * render time and never stored in the database.
 */
type Blocks = 'transfer' | 'delivery';

const results: Array<{ status: Status; label: string; detail: string; blocks: Blocks }> = [];
const record = (status: Status, label: string, detail: string, blocks: Blocks = 'transfer') => {
  results.push({ status, label, detail, blocks });
  const icon = status === 'pass' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL';
  console.log(`  [${icon}] ${label}\n         ${detail}`);
};

/** Show enough of a secret to confirm it is the right one, never the whole thing. */
const mask = (v: string) => (v.length <= 8 ? '*'.repeat(v.length) : `${v.slice(0, 4)}…${v.slice(-2)}`);

async function main() {
  console.log('\nBunny preflight\n');

  // ─── 1 · configuration ────────────────────────────────
  const cfg = bunnyConfig();
  if (!cfg) {
    console.error('  [FAIL] Configuration');
    console.error('         BUNNY_STORAGE_ZONE / BUNNY_STORAGE_KEY / BUNNY_CDN_URL must all be');
    console.error('         set in packages/api/.env. Nothing else can be checked until they are.');
    process.exitCode = 1;
    return;
  }

  console.log(describeTarget(ENV));
  console.log(`  Zone:    ${cfg.zone}`);
  console.log(`  Storage: ${cfg.storageHost}`);
  console.log(`  CDN:     ${cfg.cdnUrl}`);
  console.log(`  Key:     ${mask(cfg.accessKey)}\n`);

  if (!/^https?:\/\//i.test(cfg.cdnUrl)) {
    record('fail', 'CDN URL scheme', `BUNNY_CDN_URL must start with https:// — got "${cfg.cdnUrl}". Without it every stored URL is malformed.`);
  } else {
    record('pass', 'CDN URL scheme', 'Absolute URL with a scheme.');
  }

  // ─── 2 · upload ───────────────────────────────────────
  // A gradient, not a flat colour: a flat image compresses to near-nothing at
  // any size, which would make the Optimizer size comparison meaningless.
  const source = await sharp({
    create: { width: SOURCE_W, height: SOURCE_H, channels: 3, background: { r: 190, g: 60, b: 40 } },
  })
    .composite([{
      input: await sharp({
        create: { width: SOURCE_W, height: SOURCE_H, channels: 4, background: { r: 20, g: 80, b: 160, alpha: 0.6 } },
      }).png().toBuffer(),
      blend: 'overlay',
    }])
    .png()
    .toBuffer();

  const objectPath = `_preflight/${Date.now()}-${Math.random().toString(16).slice(2, 8)}.png`;
  let url: string;
  try {
    url = await uploadObjectToBunny(objectPath, source, 'image/png');
    record('pass', 'Storage upload (PUT)', `${source.length} B → ${objectPath}`);
  } catch (e) {
    record('fail', 'Storage upload (PUT)', `${e instanceof Error ? e.message : e}
         A 401 here almost always means BUNNY_STORAGE_KEY is the account API key
         rather than the storage zone password (FTP & API Access page).`);
    process.exitCode = 1;
    return;
  }

  try {
    // ─── 3 · CDN readback ───────────────────────────────
    // The check that catches a pull zone wired to the wrong storage zone: the
    // PUT above succeeded, so a 404 here means the two are not connected.
    let served: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(url, { cache: 'no-store' } as RequestInit);
        if (res.ok) { served = res; break; }
        if (attempt === 2) {
          record('fail', 'CDN readback', `${res.status} from ${url}
         The upload succeeded, so the object IS in storage. A 404 here means this
         pull zone is not serving that storage zone — check the pull zone's origin.`);
        }
      } catch (e) {
        if (attempt === 2) record('fail', 'CDN readback', `${e instanceof Error ? e.message : e}`);
      }
    }

    if (!served) { process.exitCode = 1; return; }

    const originalBytes = (await served.arrayBuffer()).byteLength;
    record('pass', 'CDN readback', `${originalBytes} B served from ${cfg.cdnUrl}`);

    // ─── 4 · Optimizer ──────────────────────────────────
    // Behavioural, not header-sniffing: ask for a 40px wide version and see
    // whether what comes back is actually 40px wide.
    const resized = await fetch(`${url}?width=${RESIZE_W}`, { cache: 'no-store' } as RequestInit);
    if (!resized.ok) {
      record('fail', 'Bunny Optimizer', `${resized.status} when requesting ?width=${RESIZE_W}`);
    } else {
      const buf = Buffer.from(await resized.arrayBuffer());
      const meta = await sharp(buf).metadata().catch(() => null);
      if (meta?.width === RESIZE_W) {
        record('pass', 'Bunny Optimizer', `?width=${RESIZE_W} returned a ${meta.width}×${meta.height} image (${buf.length} B, down from ${originalBytes} B).`);
      } else if (meta?.width === SOURCE_W) {
        // EXPECTED, not a fault. The Optimizer add-on was deliberately not
        // purchased and delivery serves pre-generated variant files instead,
        // so an ignored ?width= is the designed behaviour. Reporting it as a
        // failure every run trains the reader to skip a red line — which is
        // precisely how a real failure gets missed.
        record('pass', 'Bunny Optimizer (off, by design)', `?width=${RESIZE_W} was ignored; the full ${meta.width}px image came back.
         Correct for this setup: Optimizer is not purchased and delivery uses
         pre-generated variant FILES (_w200 … _w800), not query params.
         What matters instead is that backfill:variants has been run for THIS
         environment. Without it a preset URL is a 404, not a downgrade.`, 'delivery');
      } else {
        record('warn', 'Bunny Optimizer', `?width=${RESIZE_W} returned ${meta?.width ?? 'an undecodable response'}px — expected ${RESIZE_W}. Worth a look.`);
      }
    }

    // ─── 5 · automatic WebP / AVIF ──────────────────────
    // The f_auto equivalent, and the reason imageUrl.ts deliberately emits no
    // format= param. Source is a PNG; with conversion on, a browser that
    // advertises AVIF/WebP should not receive image/png back.
    const negotiated = await fetch(`${url}?width=200`, {
      headers: { Accept: 'image/avif,image/webp,image/png,*/*' },
      cache: 'no-store',
    } as RequestInit);
    const servedType = negotiated.headers.get('content-type') ?? 'unknown';

    if (/avif|webp/i.test(servedType)) {
      record('pass', 'Automatic WebP/AVIF', `Served ${servedType} for a PNG source.`);
    } else {
      record('warn', 'Automatic WebP/AVIF', `Served ${servedType} for a PNG source with an AVIF/WebP Accept header.
         Low impact here, and possibly not actionable: automatic conversion may
         require the Optimizer add-on, which was deliberately not purchased.
         It costs AVIF only — every master and variant this pipeline writes is
         ALREADY WebP, so browsers still get WebP either way. Worth enabling if
         it turns out to be free on this plan; not worth buying Optimizer for.`, 'delivery');
    }
  } finally {
    // ─── 6 · cleanup ──────────────────────────────────────
    const removed = await deleteFromBunny(url!).catch(() => false);
    console.log(`\n  ${removed ? 'Cleaned up' : 'NOTE: could not delete'} ${objectPath}`);
  }

  // ─── summary ──────────────────────────────────────────
  const failures = results.filter((r) => r.status === 'fail');
  const blocking = failures.filter((r) => r.blocks === 'transfer');
  const deliveryOnly = failures.filter((r) => r.blocks === 'delivery');
  const warned = results.filter((r) => r.status === 'warn').length;

  console.log(`\n${results.length - failures.length - warned} passed · ${warned} warning(s) · ${failures.length} failure(s)\n`);

  if (blocking.length) {
    console.log('BLOCKED — the migration cannot run until these are fixed:');
    for (const r of blocking) console.log(`  - ${r.label}`);
    console.log('');
    process.exitCode = 1;
    return;
  }

  if (deliveryOnly.length) {
    console.log('Transfer works, so the migration CAN run. But delivery is degraded:');
    for (const r of deliveryOnly) console.log(`  - ${r.label}`);
    console.log('\nFixable from the Bunny dashboard whenever — no re-migration needed.\n');
    return;
  }

  if (warned) {
    console.log('Safe to migrate, but read the warnings — they are the expensive-but-silent kind.\n');
  } else {
    console.log('Bunny is ready. Next: npm run migrate:cloudinary-to-bunny --workspace=packages/api\n');
  }
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? (e.stack ?? e.message) : e}`);
  process.exitCode = 1;
});
