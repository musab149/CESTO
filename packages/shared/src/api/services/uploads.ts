import { request } from '../client';

export type UploadFolder = 'products' | 'banners' | 'categories' | 'avatars';

export interface UploadResult {
  /** URL to display the image — an absolute Bunny CDN URL, or a server-relative
   *  path like "/uploads/products/abc123.webp" when the API is running in
   *  local-disk fallback mode. Pass through `resolveImageUrl()` before rendering. */
  url: string;
  filename: string;
  size: number;
  mimeType: string;
}

/**
 * Longest edge we send to the server.
 *
 * The API caps stored images at the same 1600px anyway (lib/uploadTransform.ts),
 * so this is purely about the wire: an admin uploading a 12 MP camera file
 * pushes ~200 KB instead of 8 MB, which on a Spanish office connection is the
 * difference between instant and a progress bar. It is an optimisation, never
 * a guarantee — the server does not trust it.
 */
const MAX_UPLOAD_EDGE = 1600;

/**
 * True only in a real browser holding a real Blob.
 *
 * This module is imported by the Expo app, which has no `document` and passes
 * a hand-rolled `{ uri, name, type }` cast to Blob — calling canvas APIs on
 * that would throw. Mobile also already downscales with expo-image-manipulator
 * before it gets here, so passing straight through is correct, not a shortfall.
 */
function canResizeHere(file: File | Blob): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    typeof Blob !== 'undefined' &&
    file instanceof Blob
  );
}

/**
 * Downscale in the browser before upload. Returns the ORIGINAL file on any
 * doubt — wrong environment, animated or vector source, a decode failure, or a
 * result that came out no smaller. An upload must never fail because an
 * optimisation did.
 */
async function downscaleForUpload(file: File | Blob, fileName?: string): Promise<File | Blob> {
  if (!canResizeHere(file)) return file;
  // GIF would lose its animation and SVG would be rasterised into a bitmap.
  if (!file.type?.startsWith('image/') || /gif|svg/i.test(file.type)) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);
    if (longest <= MAX_UPLOAD_EDGE) {
      bitmap.close?.();
      return file;
    }

    const scale = MAX_UPLOAD_EDGE / longest;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.9),
    );
    // A re-encode can lose to the original on already-optimised sources.
    if (!blob || blob.size >= file.size) return file;

    return typeof File === 'function'
      ? new File([blob], fileName ?? 'upload.webp', { type: 'image/webp' })
      : blob;
  } catch {
    return file;
  }
}

/**
 * Upload a single image to the API, which persists it to Bunny Edge Storage
 * (or local disk when Bunny is not configured) and returns the URL.
 *
 * This used to ask the API for a Cloudinary signature and POST the file
 * straight to Cloudinary, falling back to a multer route on a 503. Bunny has
 * no per-upload signature — its storage key is zone-wide and cannot be exposed
 * to a browser — so there is now one path for every backend, and the fallback
 * decision moved server-side where the client never sees it.
 *
 * Uploads carry a longer timeout than the 10s default: the request now streams
 * the file to our API *and* waits on the API's own PUT to Bunny, so a large
 * image on a slow connection legitimately takes longer than a JSON call.
 */
const UPLOAD_TIMEOUT_MS = 60_000;

async function uploadTo(route: string, file: File | Blob, fileName?: string): Promise<UploadResult> {
  const payload = await downscaleForUpload(file, fileName);
  const fd = new FormData();
  fd.append('file', payload, fileName);
  return request<UploadResult>(route, {
    method: 'POST',
    body: fd,
    multipart: true,
    timeoutMs: UPLOAD_TIMEOUT_MS,
  });
}

export const adminUploads = {
  uploadImage(folder: UploadFolder, file: File | Blob, fileName?: string): Promise<UploadResult> {
    return uploadTo(`/api/admin/uploads/${folder}`, file, fileName);
  },
};

/** Customer-scoped avatar upload. Any logged-in user can call this. */
export const customerUploads = {
  uploadAvatar(file: File | Blob, fileName?: string): Promise<UploadResult> {
    return uploadTo('/api/uploads/avatar', file, fileName);
  },
};
