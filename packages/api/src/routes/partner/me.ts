import { Router } from 'express';
import { success } from '../../lib/response';
import { asyncHandler } from '../../lib/async';

const router = Router();

// requirePartnerRole is applied at the mount point in server.ts, so this
// handler can trust req.partnerRole is populated with a live user + store.
router.get('/', asyncHandler(async (req, res) => {
  const { user, role, store } = req.partnerRole!;
  return success(res, {
    user,
    role,
    store,
  });
}));

export default router;
