import { Request, Response, NextFunction, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';

/**
 * Prisma codes that mean the query never reached the database.
 *
 * P1001 can't reach the server · P1002 reached it, timed out · P1017 the
 * server closed the connection. All three are the network between us and
 * Neon, not anything a query did, and all three are usually over by the time
 * anyone reads the log line.
 */
const CONNECTION_CODES = new Set(['P1001', 'P1002', 'P1017']);

function isConnectionFailure(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  return err instanceof Prisma.PrismaClientKnownRequestError
    && CONNECTION_CODES.has(err.code);
}

/** Methods it is safe to simply run again. */
const IDEMPOTENT = new Set(['GET', 'HEAD']);

const RETRY_DELAY_MS = 250;

/**
 * Wraps an async handler so thrown errors flow to the error middleware —
 * and so a READ that lost the database connection gets one more go.
 *
 * WHY THE RETRY IS ONLY FOR GET AND HEAD. A connection failure usually means
 * nothing ran, which would make a retry safe for anything. Usually is not
 * always: a handler that wrote three rows and then lost the connection on the
 * fourth would, on a second run, write the first three again. Hiring a sales
 * rep is exactly that shape — create the user, then grant the role — and
 * re-running it would answer "that account is already a sales rep" for an
 * action the admin performed once. So writes are left to fail honestly and
 * report a 503, and only the methods that are idempotent by definition are
 * repeated.
 *
 * This is deliberately NOT a Prisma `$extends` retry, which would be the
 * tidier place for it: see lib/prisma.ts, where extending the client is ruled
 * out because it rewrites the client type and lib/cartStore.ts pins
 * `Prisma.TransactionClient`.
 *
 * One retry, not a loop. If the database is genuinely down, the second
 * failure should be told to the caller rather than held while we try a third
 * time — 503 with "please try again" is an honest answer and a fast one.
 */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    const attempt = (retrying: boolean): Promise<unknown> =>
      Promise.resolve(fn(req as T, res, next)).catch((err: unknown) => {
        const mayRetry = !retrying
          && isConnectionFailure(err)
          && IDEMPOTENT.has(req.method)
          // Anything already written to the wire makes a second run a second
          // response, which Express answers with ERR_HTTP_HEADERS_SENT.
          && !res.headersSent;

        if (!mayRetry) throw err;

        console.warn(`[db] connection lost on ${req.method} ${req.originalUrl} — retrying once`);
        return new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
          .then(() => attempt(true));
      });

    attempt(false).catch(next);
  };
}
