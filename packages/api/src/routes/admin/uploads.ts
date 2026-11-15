import { Router } from 'express';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { imageUpload, storeImage, uploadErrorHandler } from '../../lib/imageStore';
import type { UploadFolder } from '../../lib/bunny';

const router = Router();

/**
 * Admin image upload. Any of the allowed folders — requireAdmin is already
 * applied by the parent router in server.ts.
 *
 * POST /api/admin/uploads/sign is gone along with the Cloudinary direct
 * upload it authorised; see lib/bunny.ts. Files now go to Bunny Edge Storage
 * when BUNNY_* is configured and to local disk otherwise, which keeps local
 * dev working with no credentials.
 */

const ALLOWED_FOLDERS = new Set<UploadFolder>(['products', 'banners', 'categories', 'avatars']);

function parseFolder(raw: unknown): UploadFolder | null {
  const value = (Array.isArray(raw) ? raw[0] : raw ?? '').toString().toLowerCase();
  return ALLOWED_FOLDERS.has(value as UploadFolder) ? (value as UploadFolder) : null;
}

/**
 * Deploy-skew shim. The API and the frontends deploy independently, so for a
 * window after this ships there are browsers running a cached bundle that
 * still asks for a Cloudinary signature first. That old client falls back to
 * the multer route on a 503 and *only* on a 503 — a bare 404 from the removed
 * endpoint would throw and break uploads outright.
 *
 * So /sign stays, permanently answering 503. Old clients transparently take
 * their fallback path (which still exists, at the same URL, and now writes to
 * Bunny); new clients never call this at all. Safe to delete once no cached
 * bundle predating the Bunny swap can still be in use.
 */
router.post('/sign', (_req, res) =>
  res.status(503).json({ success: false, data: null, error: 'Signed uploads are no longer used. Post the file to /api/admin/uploads/:folder.' }),
);

const upload = imageUpload();

// ─── POST /api/admin/uploads/:folder ─────────────────────
// Multipart field name: "file"

// Cast the multer middleware to any to bridge a duplicate
// @types/express-serve-static-core that multer drags in. Runtime is unaffected.
router.post(
  '/:folder',
  upload.single('file') as unknown as import('express').RequestHandler,
  asyncHandler(async (req, res) => {
    // Validated after multer rather than before: the folder only decides the
    // destination and the size cap is enforced by multer either way, so an
    // invalid folder costs one buffered file and never reaches storage.
    const folder = parseFolder(req.params.folder);
    if (!folder) return error(res, 'Invalid upload folder.', 400);
    if (!req.file) return error(res, 'No file uploaded. Send field "file" as multipart/form-data.', 400);

    return success(res, await storeImage(req.file, folder), 201);
  }),
);

router.use(uploadErrorHandler);

export default router;
