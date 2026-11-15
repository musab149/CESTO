import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import { isBunnyConfigured, randomObjectName, uploadObjectToBunny, uploadToBunny, type UploadFolder } from './bunny';
import { normaliseForStorage } from './uploadTransform';
import { renderVariants, supportsVariants, variantPath } from './imageVariants';

/**
 * One place where "an uploaded image becomes a URL".
 *
 * Three routes need this — admin (all folders), customer (avatars) and partner
 * (products) — and before the Bunny swap all three carried their own copy of
 * the multer + destination logic. They now share this, so the storage backend,
 * the size cap and the MIME allowlist can only ever be changed in one place.
 *
 * Backend selection is by configuration, not by environment name: Bunny when
 * BUNNY_* is set, local disk otherwise. Local dev therefore keeps working with
 * no credentials at all, which is the same contract the Cloudinary 503
 * fallback provided — except the fallback is now decided server-side, before
 * any bytes move, instead of by the client catching a 503 mid-flight.
 */

export const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/**
 * Avatars are capped tighter at the route.
 *
 * Raised from 5 MB with the banner work: banners are now stored at up to
 * 2560 px, and the source an admin exports for that — a full-width PNG, or a
 * lightly-compressed JPEG straight out of a design tool — routinely lands
 * between 5 and 10 MB. The old ceiling rejected exactly the high-resolution
 * uploads that fix blurry banners, which is the wrong file to turn away.
 *
 * This bounds a multer memory buffer, so it is a per-request RAM cost on the
 * API. 10 MB is affordable for an occasional admin upload; going much past
 * that on a small instance would not be.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const UPLOAD_ROOT = path.join(process.cwd(), 'uploads');

export interface StoredImage {
  url: string;
  filename: string;
  size: number;
  mimeType: string;
}

/**
 * Memory storage, not disk: the buffer has to go through sharp before it lands
 * anywhere, and for the Bunny path it never touches the filesystem at all.
 * Bounded by the `limits.fileSize` the caller passes to `imageUpload()`.
 */
export function imageUpload(maxBytes = MAX_UPLOAD_BYTES) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME.has(file.mimetype)) {
        return cb(new Error(`Unsupported file type: ${file.mimetype}`));
      }
      cb(null, true);
    },
  });
}

/**
 * Normalise, then persist to whichever backend is configured.
 *
 * The returned `url` is absolute for Bunny (a b-cdn.net pull-zone URL) and
 * server-relative for disk (`/uploads/<folder>/<name>`). Both shapes are
 * already handled by resolveImageUrl() on every frontend, so callers store
 * whatever comes back without branching.
 */
export async function storeImage(
  file: Express.Multer.File,
  folder: UploadFolder,
): Promise<StoredImage> {
  const { buffer, ext, contentType } = await normaliseForStorage(
    file.buffer,
    file.mimetype,
    folder,
  );
  const objectName = randomObjectName(ext);

  if (isBunnyConfigured()) {
    const url = await uploadToBunny(folder, objectName, buffer, contentType);

    // Bunny Optimizer is off, so `?width=` does nothing — the only way a phone
    // gets a 300px image is if one was stored. Write the ladder alongside the
    // master; resolveImageUrl() points at these, not at query params.
    //
    // Sequenced after the master and never allowed to throw: a failed variant
    // costs image weight at that size, while a failed master costs the upload.
    // Those are not the same kind of failure and must not share a fate.
    if (supportsVariants(objectName)) {
      try {
        const variants = await renderVariants(buffer);
        await Promise.all(
          variants.map((v) =>
            uploadObjectToBunny(
              `${folder}/${variantPath(objectName, v.width)}`,
              v.buffer,
              v.contentType,
            ),
          ),
        );
      } catch (err) {
        console.error(`[imageStore] variant generation failed for ${objectName}:`, err);
      }
    }

    return { url, filename: objectName, size: buffer.length, mimeType: contentType };
  }

  const dir = path.join(UPLOAD_ROOT, folder);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, objectName), buffer);

  return {
    url: `/uploads/${folder}/${objectName}`,
    filename: objectName,
    size: buffer.length,
    mimeType: contentType,
  };
}

/**
 * Shared multer error surface. Without this a file-too-large or wrong-type
 * rejection escapes as Express' default HTML error page, which the frontends
 * parse as JSON and report as an opaque failure.
 */
export function uploadErrorHandler(err: any, _req: any, res: any, next: any) {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Image is too large.'
      : err.message;
    return res.status(400).json({ success: false, data: null, error: message });
  }
  if (err?.message) {
    return res.status(400).json({ success: false, data: null, error: err.message });
  }
  next(err);
}
