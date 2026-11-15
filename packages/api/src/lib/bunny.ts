import crypto from 'crypto';

/**
 * Bunny Edge Storage client.
 *
 * Replaces Cloudinary as the image origin. The shape of the integration is
 * fundamentally different and it is worth being explicit about why:
 *
 * Cloudinary supported *signed direct-from-browser uploads* — the API returned
 * a short-lived SHA1 signature and the client POSTed straight to Cloudinary,
 * so the bytes never touched our server. Bunny Edge Storage has no per-upload
 * signature: a storage zone authenticates with ONE AccessKey that grants full
 * read/write/delete over the entire zone. Handing that to a browser would let
 * any logged-in customer wipe the product catalogue.
 *
 * So uploads proxy through the API instead: multer buffers into memory, we
 * normalise (see uploadTransform.ts), then PUT to storage over the wire. The
 * `/sign` endpoints are gone. This costs us one extra hop of bandwidth per
 * upload and buys back an enforcement point we did not really have before.
 *
 * Delivery is a separate pull zone in front of the storage zone, so the URL we
 * persist is the CDN hostname, never the storage endpoint (which is
 * key-authenticated and would 401 for a browser).
 */

export type UploadFolder = 'products' | 'banners' | 'categories' | 'avatars';

/**
 * Frankfurt. The right default for a Spain-facing app, and the only region
 * whose endpoint has no prefix — every other region is `<code>.storage…`.
 * Override with BUNNY_STORAGE_HOST if the zone's primary region is elsewhere;
 * the value is on the storage zone's FTP & API Access page.
 */
const DEFAULT_STORAGE_HOST = 'storage.bunnycdn.com';

export interface BunnyConfig {
  /** Storage zone name — the first path segment of every storage URL. */
  zone: string;
  /** Storage zone password. NOT the account API key. Never leaves the server. */
  accessKey: string;
  /** Region endpoint, e.g. `storage.bunnycdn.com`. */
  storageHost: string;
  /** Pull zone base for delivery, e.g. `https://cesto.b-cdn.net` (no trailing slash). */
  cdnUrl: string;
}

/**
 * Returns null when Bunny is not configured, which is the signal for callers
 * to fall back to local disk. Local dev has no Bunny credentials and should
 * not need any — same contract the Cloudinary 503 fallback had.
 */
export function bunnyConfig(): BunnyConfig | null {
  const zone = process.env.BUNNY_STORAGE_ZONE?.trim();
  const accessKey = process.env.BUNNY_STORAGE_KEY?.trim();
  const cdnUrl = process.env.BUNNY_CDN_URL?.trim();
  if (!zone || !accessKey || !cdnUrl) return null;

  return {
    zone,
    accessKey,
    storageHost: process.env.BUNNY_STORAGE_HOST?.trim() || DEFAULT_STORAGE_HOST,
    // Tolerate a trailing slash in the env var so the joined URL never doubles up.
    cdnUrl: cdnUrl.replace(/\/+$/, ''),
  };
}

export function isBunnyConfigured(): boolean {
  return bunnyConfig() !== null;
}

/**
 * Random object name, matching the 12-byte scheme the disk routes already use
 * so nothing downstream has to care which backend produced a URL.
 */
export function randomObjectName(ext: string): string {
  return crypto.randomBytes(12).toString('hex') + ext;
}

/**
 * PUT one object into the storage zone and return its public CDN URL.
 *
 * Bunny creates intermediate directories implicitly, so there is no mkdir
 * equivalent to call first. A Checksum header is sent so a truncated upload is
 * rejected at the edge rather than silently persisted as a corrupt image —
 * uppercase hex SHA256, which is the exact casing Bunny requires.
 */
export async function uploadToBunny(
  folder: UploadFolder,
  objectName: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  return uploadObjectToBunny(`${folder}/${objectName}`, body, contentType);
}

/**
 * As above, but for an arbitrary object path rather than one of the four
 * upload folders. Exists for the Cloudinary migration, which mirrors each
 * asset's original public_id path so a migrated object stays traceable back to
 * the URL it replaced. Prefer uploadToBunny() for anything user-facing — the
 * folder allowlist is what stops a caller writing anywhere in the zone.
 */
export async function uploadObjectToBunny(
  objectPath: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const cfg = bunnyConfig();
  if (!cfg) throw new Error('Bunny storage is not configured.');

  const checksum = crypto.createHash('sha256').update(body).digest('hex').toUpperCase();

  const res = await fetch(`https://${cfg.storageHost}/${cfg.zone}/${objectPath}`, {
    method: 'PUT',
    headers: {
      AccessKey: cfg.accessKey,
      'Content-Type': contentType,
      Checksum: checksum,
    },
    body: new Uint8Array(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Bunny upload failed (${res.status}): ${detail || 'no body'}`);
  }

  return `${cfg.cdnUrl}/${objectPath}`;
}

/**
 * Delete one object by its public CDN URL. Returns false when the URL does not
 * belong to our pull zone or Bunny reports it already gone — deliberately not
 * an error, so a caller cleaning up after a replaced image never fails the
 * user-facing request over a missing file.
 */
export async function deleteFromBunny(cdnUrl: string): Promise<boolean> {
  const cfg = bunnyConfig();
  if (!cfg || !cdnUrl.startsWith(`${cfg.cdnUrl}/`)) return false;

  const objectPath = cdnUrl.slice(cfg.cdnUrl.length + 1).split('?')[0];
  if (!objectPath) return false;

  const res = await fetch(`https://${cfg.storageHost}/${cfg.zone}/${objectPath}`, {
    method: 'DELETE',
    headers: { AccessKey: cfg.accessKey },
  });

  return res.ok;
}
