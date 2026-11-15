import { getApiBaseUrl } from './client';

/**
 * Named delivery sizes. One entry per place an image actually renders, NOT
 * one per pixel width — the whole point is that this list stays short.
 *
 * Widths are chosen from what the CSS actually paints, doubled for retina:
 * a product card is 170–280 CSS px, so 300px already covers 2× on a phone.
 */
export type ImagePreset =
  | 'thumb'   // cart lines, order rows, search suggestions — 40–96 px
  | 'card'    // product grid + rails — the highest-volume request by far
  | 'tile'    // category / brand / origin tiles
  | 'logo'    // store + brand logos
  | 'hero'    // product detail main image
  | 'banner'  // full-bleed home banners
  | 'raw';    // opt out — originals (invoice PDFs, download links)

type SizedPreset = Exclude<ImagePreset, 'raw'>;

/** Longest edge per preset. Shared by both CDNs so they can never drift. */
const PRESET_WIDTHS: Record<SizedPreset, number> = {
  thumb:  200,
  card:   300,
  tile:   400,
  logo:   200,
  hero:   800,
  banner: 1600,
};

// ─── Bunny (current) ─────────────────────────────────────

/**
 * Widths that exist as real files on the CDN.
 *
 * Bunny Optimizer is NOT enabled on the pull zone — a deliberate cost decision
 * — so there is no on-the-fly resizing. `?width=300` is ignored outright and
 * the origin serves whatever bytes are stored. The API therefore writes a
 * ladder of real variant files next to every master, and this function picks
 * one of those.
 *
 * MUST stay in lockstep with VARIANT_WIDTHS in
 * packages/api/src/lib/imageVariants.ts, which is what actually generates
 * them. Deliberately duplicated rather than imported: the API cannot safely
 * import from this package (its barrel re-exports a .tsx component that breaks
 * ts-node at runtime), and a width named here but not generated there is a 404
 * rather than a graceful downgrade.
 */
const VARIANT_WIDTHS = [200, 300, 400, 600, 800] as const;

/**
 * 1600 is the master's own cap, so `banner` is served by the master file
 * itself and needs no variant. `raw` and un-presetted calls resolve there too.
 */
const MASTER_WIDTH = 1600;

/**
 * Only `.webp` masters have variants.
 *
 * The API re-encodes uploads to WebP except animated GIFs, which pass through
 * untouched to keep their frames and so keep a `.gif` master. This guard means
 * those — plus legacy `/uploads/*.jpg` and anything third-party — keep pointing
 * at the original instead of at a variant that was never written.
 */
function hasVariants(url: string): boolean {
  return /\.webp(?:$|[?#])/i.test(url);
}

/** `…/abc.webp` + 300 → `…/abc_w300.webp` */
function bunnyVariant(url: string, width: number): string {
  return url.replace(/\.webp(?=$|[?#])/i, `_w${width}.webp`);
}

/**
 * Resolve a Bunny URL to the stored file that best fits `width`.
 *
 * Returns the master unchanged when no variant applies — a non-WebP master, a
 * width at or above the master's own cap, or a width that was never generated.
 * Serving a too-large image is a cost problem; serving a URL that 404s is a
 * blank space on the page, so this always errs toward the file that exists.
 */
function bunnySized(url: string, width: number | null): string {
  if (width === null || width >= MASTER_WIDTH) return url;
  if (!hasVariants(url)) return url;
  if (!VARIANT_WIDTHS.includes(width as (typeof VARIANT_WIDTHS)[number])) return url;
  return bunnyVariant(url, width);
}

/**
 * Hosts served by Bunny. Default pull zones are `<name>.b-cdn.net`; a custom
 * domain in front of one has to be registered via `configureImageCdn()`, or
 * its images silently serve at full size.
 */
let customCdnHost: string | null = null;

/** Call once at app startup if the pull zone sits behind a custom domain. */
export function configureImageCdn(host: string | null): void {
  customCdnHost = host
    ? host.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase()
    : null;
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
}

function isBunny(url: string): boolean {
  const host = hostOf(url);
  return host.endsWith('.b-cdn.net') || (customCdnHost !== null && host === customCdnHost);
}

// ─── Cloudinary (legacy) ─────────────────────────────────

/**
 * Kept for any row written before the Bunny migration. The local dev database
 * is fully migrated and holds none, but staging and production have not been
 * run yet and are still entirely on Cloudinary. Delete this block only once
 * every environment is migrated and verified.
 */
const CLOUDINARY_UPLOAD = '/image/upload/';

/** Transformation tokens we might already have written into a stored URL. */
const ALREADY_TRANSFORMED = /\/image\/upload\/[^/]*(?:\b[a-z]{1,2}_[a-z0-9]|\bt_)/i;

function isCloudinary(url: string): boolean {
  return url.includes('res.cloudinary.com') && url.includes(CLOUDINARY_UPLOAD);
}

/**
 * Insert a transformation segment directly after `/image/upload/`, ahead of
 * the `v1788796487` version segment — which is where Cloudinary expects it and
 * which keeps the version (and therefore the cache key) intact.
 */
function cloudinaryTransform(url: string, width: number | null): string {
  // Never stack a second transformation on a URL that already carries one.
  if (ALREADY_TRANSFORMED.test(url)) return url;
  const transform = width === null
    ? 'f_auto,q_auto'
    : `f_auto,q_auto,c_limit,w_${width}`;
  return url.replace(CLOUDINARY_UPLOAD, `${CLOUDINARY_UPLOAD}${transform}/`);
}

// ─── Public API ──────────────────────────────────────────

/**
 * Resolve an image URL for display in <img> tags (and React Native <Image>).
 *
 * Rules:
 *  - Bunny pull zone → rewritten to the stored variant for the preset
 *  - Cloudinary (legacy rows) → a delivery transformation is injected
 *  - Other absolute (`http://`, `https://`, `data:`, `blob:`) → returned as-is
 *  - Server-relative (`/uploads/...`) → prepended with the configured API base
 *  - Empty / null → empty string (caller should branch on truthiness first)
 *
 * Centralised so the web, mobile, admin and partner apps all render uploaded
 * images correctly regardless of which host the API is on — and so the sizing
 * decision is written in exactly one place.
 */
export function resolveImageUrl(
  url: string | null | undefined,
  preset?: ImagePreset,
): string {
  if (!url) return '';

  if (/^(https?:|data:|blob:)/i.test(url)) {
    if (preset === 'raw') return url;
    // null = no resize: serve the master.
    const width = preset ? PRESET_WIDTHS[preset] : null;

    if (isBunny(url)) return bunnySized(url, width);
    if (isCloudinary(url)) return cloudinaryTransform(url, width);
    // Third-party hosts (loremflickr seeds, Google account avatars) pass
    // through — we have no transform layer in front of them.
    return url;
  }

  if (url.startsWith('/')) return `${getApiBaseUrl()}${url}`;
  return url;
}

/**
 * Build a `srcSet` so a phone on a two-column grid pulls the 200 px variant
 * instead of the desktop one.
 *
 * Widths that have no stored variant are dropped rather than emitted, because
 * a 404 candidate renders as a blank image if the browser picks it. If every
 * width is dropped the result is '' — callers should spread it and let an
 * empty string fall through, since <img srcset=""> is inert.
 *
 * Pair with a `sizes` attribute describing the CSS width at each breakpoint,
 * otherwise the browser assumes 100vw and picks the largest candidate.
 */
export function imageSrcSet(
  url: string | null | undefined,
  widths: number[] = [200, 300, 600],
): string {
  if (!url || !/^https?:/i.test(url)) return '';

  if (isBunny(url)) {
    if (!hasVariants(url)) return '';
    return widths
      .filter((w) => VARIANT_WIDTHS.includes(w as (typeof VARIANT_WIDTHS)[number]))
      .map((w) => `${bunnyVariant(url, w)} ${w}w`)
      .join(', ');
  }

  if (isCloudinary(url) && !ALREADY_TRANSFORMED.test(url)) {
    return widths.map((w) => `${cloudinaryTransform(url, w)} ${w}w`).join(', ');
  }

  return '';
}
