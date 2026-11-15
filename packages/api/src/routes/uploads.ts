import { Router } from 'express';
import { success, error } from '../lib/response';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../lib/async';
import { imageUpload, storeImage, uploadErrorHandler } from '../lib/imageStore';

const router = Router();

// ─── Customer avatar upload ─────────────────────────────
// Customer-scoped (any logged-in user). Locked to the avatars folder so a
// regular user can't drop files into product/banner folders.
//
// POST /api/uploads/sign is gone. It signed a direct-to-Cloudinary upload;
// Bunny Edge Storage has no per-upload signature (one zone-wide key, which
// cannot go to a browser), so uploads proxy through here instead. See
// lib/bunny.ts for the full reasoning.

// 2 MB — avatars don't need to be huge, and the stored copy is capped at
// 512px by normaliseForStorage() regardless.
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
  res.status(503).json({ success: false, data: null, error: 'Signed uploads are no longer used. Post the file to /api/uploads/avatar.' }),
);

const uploadAvatar = imageUpload(2 * 1024 * 1024);

router.post(
  '/avatar',
  requireAuth,
  uploadAvatar.single('file') as unknown as import('express').RequestHandler,
  asyncHandler(async (req, res) => {
    if (!req.file) return error(res, 'No file uploaded. Send field "file" as multipart/form-data.', 400);
    return success(res, await storeImage(req.file, 'avatars'), 201);
  }),
);

router.use(uploadErrorHandler);

export default router;
