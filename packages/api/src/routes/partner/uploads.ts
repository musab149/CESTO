import { Router } from 'express';
import { success, error } from '../../lib/response';
import { asyncHandler } from '../../lib/async';
import { imageUpload, storeImage, uploadErrorHandler } from '../../lib/imageStore';

const router = Router();

/**
 * Partner-scoped image upload. Restricted to the `products` folder — partners
 * have no legitimate reason to touch banners / categories / avatars.
 * requirePartnerRole() is applied at the mount point.
 *
 * Storage backend is shared with the admin and customer routes (Bunny when
 * configured, local disk otherwise) via lib/imageStore.ts. Notably this path
 * now gets the same incoming size cap and WebP re-encode as the others: the
 * partner client posts a raw file and never had a signed Cloudinary transform,
 * so until now a partner could store a 12 MP camera original untouched.
 */

const upload = imageUpload();

// ─── POST /api/partner/uploads/image ───────────────────
// Multipart field name: "file"

router.post(
  '/image',
  upload.single('file') as unknown as import('express').RequestHandler,
  asyncHandler(async (req, res) => {
    if (!req.file) return error(res, 'No file uploaded. Send field "file" as multipart/form-data.', 400);
    return success(res, await storeImage(req.file, 'products'), 201);
  }),
);

router.use(uploadErrorHandler);

export default router;
