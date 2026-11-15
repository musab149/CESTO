import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { error } from '../lib/response';
import { requireAuth } from './auth';

/**
 * The business panel's guard (2026-10-29, user: "When the user signs in as a
 * b2b user then they are going to see a dashboard just like the reps").
 *
 * A business buyer is an ordinary customer whose account an admin approved
 * (`User.is_business`, with a BusinessProfile). They sign in like anybody else
 * and keep the customer token; this checks the approval on top, the way
 * requireSalesRep checks the rep role. Everything a buyer DOES — cart,
 * checkout, their orders, addresses — stays on the customer routes, which
 * already price them at wholesale (lib/pricing). What lives under
 * /api/business is only what those routes cannot answer: the catalogue as a
 * business sees it, and the panel's summary.
 *
 * requireAuth first, so a blocked account gets the same 403 + code the shop's
 * client already knows how to explain, rather than a second shape.
 */
export interface BusinessContext {
  user: { id: string; name: string; email: string | null };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      business?: BusinessContext;
    }
  }
}

export function requireBusiness() {
  return (req: Request, res: Response, next: NextFunction): void => {
    void requireAuth(req, res, async () => {
      let user;
      try {
        user = await prisma.user.findUnique({
          where: { id: req.user!.userId },
          select: { id: true, name: true, email: true, is_business: true, pricing_mode: true },
        });
      } catch (err) {
        // Express 4 does not catch a rejected async middleware.
        next(err);
        return;
      }
      // Revoking business status is `is_business = false`: they keep their
      // account and their orders, and lose only this panel.
      if (!user || !user.is_business) {
        error(res, 'This account is not an approved business.', 403);
        return;
      }
      // A business buys at wholesale (business accounts cannot switch to
      // retail since 2026-08-26). GET /api/users/me repairs a leftover
      // `retail` too, but only once it is called; the panel's first catalogue
      // request can beat it, and b2bPricingGuard reads this value next — so
      // the price on a card would have been retail while checkout, after the
      // repair, charged wholesale.
      if (user.pricing_mode !== 'b2b') {
        try {
          await prisma.user.update({ where: { id: user.id }, data: { pricing_mode: 'b2b' } });
        } catch (err) {
          next(err);
          return;
        }
      }
      req.business = { user: { id: user.id, name: user.name, email: user.email } };
      next();
    });
  };
}
