import sharp from 'sharp';

/**
 * Pre-generated width variants.
 *
 * Bunny Optimizer is not enabled on the pull zone (a deliberate cost decision),
 * so there is no on-the-fly resizing: `?width=300` is ignored and the origin
 * serves whatever bytes are stored. The only way to send a phone a 300px image
 * is to have stored one. So every upload writes a small ladder of real files
 * alongside its master, and resolveImageUrl() points at one of them.
 *
 * ─── Why these five widths ──────────────────────────────────────────────────
 *
 * They are exactly the widths the frontend can ask for, and nothing else:
 *
 *   200  thumb + logo   cart lines, order rows, search suggestions, brand logos
 *   300  card           product grid + rails — the highest-volume request
 *   400  tile           category / brand / origin tiles
 *   600  —              srcSet only; the 2× candidate for a 280px card
 *   800  hero           product detail main image
 *
 * `banner` and `raw` are absent on purpose: the master is already capped at
 * 1600, which is the banner preset, so those resolve to the master itself.
 *
 * 600 has no named preset but is not optional — imageSrcSet() defaults to
 * [200, 300, 600], and with stored variants a width that was never generated
 * is a 404 rather than a graceful downgrade. Any width the frontend can emit
 * MUST exist here. Adding one later means re-running the backfill over every
 * asset, so this list is deliberately closed.
 */
export const VARIANT_WIDTHS = [200, 300, 400, 600, 800] as const;

export type VariantWidth = (typeof VARIANT_WIDTHS)[number];

/**
 * Quality per variant. Mirrors the split in shared/src/api/imageUrl.ts — larger
 * renders are more often the focal point of the screen, where compression
 * artefacts are actually visible.
 */
const QUALITY_SMALL = 80;
const QUALITY_LARGE = 85;

/**
 * Only `.webp` masters get variants.
 *
 * normaliseForStorage() re-encodes everything to WebP except animated GIFs,
 * which pass through untouched to keep their frames. Those keep a `.gif`
 * master, and this rule means resolveImageUrl() leaves them (and legacy
 * `/uploads/*.jpg`, and anything third-party) pointing at the original rather
 * than at a variant that was never written.
 */
export function supportsVariants(objectNameOrUrl: string): boolean {
  return /\.webp(?:$|[?#])/i.test(objectNameOrUrl);
}

/**
 * `products/abc.webp` + 300 → `products/abc_w300.webp`
 *
 * Suffix rather than a subdirectory so a variant sorts next to its master in
 * the storage browser, and so deriving one is a pure string operation on the
 * frontend with no knowledge of the folder layout.
 */
export function variantPath(objectPathOrUrl: string, width: number): string {
  return objectPathOrUrl.replace(/\.webp(?=$|[?#])/i, `_w${width}.webp`);
}

export interface RenderedVariant {
  width: VariantWidth;
  buffer: Buffer;
  contentType: string;
}

/**
 * Render the full ladder from a master buffer.
 *
 * Every width is emitted unconditionally, even when it exceeds the master's own
 * dimensions. `withoutEnlargement` means a 512px avatar asked for 800 yields a
 * 512px file rather than an upscale — so the file always exists, is never
 * larger than the source, and resolveImageUrl() can point at any preset for any
 * asset without first knowing how big the original was. A little redundant
 * storage on small assets buys the guarantee that no preset can 404.
 */
export async function renderVariants(master: Buffer): Promise<RenderedVariant[]> {
  const out: RenderedVariant[] = [];

  for (const width of VARIANT_WIDTHS) {
    try {
      const buffer = await sharp(master)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: width >= 800 ? QUALITY_LARGE : QUALITY_SMALL })
        .toBuffer();
      out.push({ width, buffer, contentType: 'image/webp' });
    } catch {
      // One unrenderable width must not cost the upload its other variants,
      // nor the master itself. The caller treats a short list as partial
      // coverage and carries on.
    }
  }

  return out;
}
