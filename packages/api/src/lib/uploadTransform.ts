import sharp from 'sharp';
import type { UploadFolder } from './bunny';

/**
 * Incoming normalisation — what we STORE, not what we deliver.
 *
 * Cloudinary did this for us: the signed upload carried a `transformation` and
 * a `format` param and Cloudinary applied them server-side before persisting.
 * Bunny Edge Storage has no such thing — it writes exactly the bytes you PUT.
 * So the recipe moves here, into the API, and runs on the buffer before it
 * goes up the wire.
 *
 * The recipe itself is unchanged, because the measurements that produced it
 * still hold. Both were taken against a real 1254px product PNG:
 *
 *   c_limit,w_1600                 1,817,971 B   no-op — source is already smaller
 *   c_limit,w_1600,q_auto:good     2,460,938 B   BIGGER. A PNG re-encode loses
 *                                                to the original.
 *   + format webp                    228,758 B   87.7% smaller, alpha preserved
 *
 * Quality alone is worse than useless on a PNG — the format change is what
 * pays. WebP keeps transparency (logos and cut-out product shots survive), and
 * Bunny Optimizer re-encodes from it to AVIF/WebP/JPEG per browser at delivery.
 *
 * Doing this server-side is strictly stronger than the Cloudinary arrangement
 * it replaces. That one was enforced by a signature the client echoed back;
 * this one is enforced by the fact that the client never chooses. It also
 * finally covers the partner upload path, which posts a raw file and never had
 * a signed incoming transform at all.
 */

/**
 * Avatars render at 96px at the very largest, so they get a much tighter cap
 * than catalogue imagery. Everything else keeps enough resolution to survive a
 * future full-bleed hero or a zoomed product view.
 */
const AVATAR_MAX = 512;
const CATALOGUE_MAX = 1600;

/**
 * Banners are the one thing here drawn EDGE TO EDGE, so they are the one thing
 * whose stored width has to beat the viewport rather than the layout slot.
 *
 * A product image renders in a card a few hundred CSS pixels wide, and 1600
 * covers it several times over. A hero does not: at 1440 CSS px on a 2× display
 * the browser wants ~2880 device pixels, so a 1600 master was being upscaled
 * most of the way and read as soft — which is exactly the "blurry banners"
 * report.
 *
 * Worse for the mobile art. The resize below fits inside a SQUARE box, so a
 * portrait banner is capped on its height: 1080×1920 came out 900 px wide,
 * and then the site asked for the 800 px variant on top of that. Two
 * downgrades before it reached the phone.
 *
 * 2560 covers a 1280 CSS px hero at 2×, and a portrait mobile banner lands
 * around 1440 wide — ahead of any phone in use. Only this folder pays the
 * bytes for it.
 */
const BANNER_MAX = 2560;

/**
 * Matches the `q_auto:good` Cloudinary was asked for. Bunny has no "auto"
 * quality, so this is the one number that decides stored fidelity; delivery
 * quality is set separately per preset in shared/src/api/imageUrl.ts.
 */
const WEBP_QUALITY = 82;

/**
 * Banners carry flat colour, gradients and set type — the three things WebP
 * shows banding and mosquito noise on first. They are also one file per page
 * view rather than thirty, so the extra bytes are cheap where it matters.
 */
const BANNER_WEBP_QUALITY = 90;

export function maxEdgeFor(folder: UploadFolder): number {
  if (folder === 'avatars') return AVATAR_MAX;
  if (folder === 'banners') return BANNER_MAX;
  return CATALOGUE_MAX;
}

export function qualityFor(folder: UploadFolder): number {
  return folder === 'banners' ? BANNER_WEBP_QUALITY : WEBP_QUALITY;
}

export interface NormalisedImage {
  buffer: Buffer;
  /** File extension including the dot, for the stored object name. */
  ext: string;
  contentType: string;
}

/**
 * Re-encode an uploaded image to a capped-width WebP.
 *
 * Returns the ORIGINAL buffer untouched on any doubt — an animated GIF, an
 * unreadable file, or a re-encode that came out no smaller. An upload must
 * never fail because an optimisation did; that was true of the browser-side
 * downscale in the shared client and it is true here.
 */
export async function normaliseForStorage(
  buffer: Buffer,
  mimeType: string,
  folder: UploadFolder,
): Promise<NormalisedImage> {
  const passthrough = (): NormalisedImage => ({
    buffer,
    ext: extForMime(mimeType),
    contentType: mimeType,
  });

  // Re-encoding a GIF through sharp's still pipeline silently drops every
  // frame after the first. Rare enough in a grocery catalogue that keeping the
  // original is a better trade than a one-frame animation.
  if (mimeType === 'image/gif') return passthrough();

  try {
    const out = await sharp(buffer)
      // No-arg .rotate() applies the EXIF orientation tag and then strips it.
      // Without this, portrait photos straight off a phone store sideways —
      // Cloudinary normalised orientation on ingest and we would otherwise
      // regress on it.
      .rotate()
      .resize({
        width: maxEdgeFor(folder),
        height: maxEdgeFor(folder),
        // `inside` + withoutEnlargement is the c_limit equivalent: it caps the
        // longest edge and never upscales, so it is a no-op on anything
        // already under the cap. A bare resize would ENLARGE a small source
        // and the file would get bigger.
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: qualityFor(folder) })
      .toBuffer();

    // A re-encode that came out bigger is not worth taking — EXCEPT for a
    // banner that the resize actually shrank. A 4000 px source re-encoded to
    // 2560 can still land heavier than a hard-compressed JPEG original, and
    // keeping the original there would mean storing an uncapped file we then
    // hand to every visitor in full.
    if (out.length >= buffer.length) {
      const shrank = folder === 'banners'
        && (await sharp(buffer).metadata().then((m) => Math.max(m.width ?? 0, m.height ?? 0) > BANNER_MAX).catch(() => false));
      if (!shrank) return passthrough();
    }

    return { buffer: out, ext: '.webp', contentType: 'image/webp' };
  } catch {
    return passthrough();
  }
}

function extForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':  return '.png';
    case 'image/webp': return '.webp';
    case 'image/gif':  return '.gif';
    default:           return '.jpg';
  }
}
