import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';

/**
 * Human-readable messages for the Prisma failures a user can actually cause or
 * observe. Anything not listed is a bug or an infrastructure problem, and is
 * treated as such — a 500, logged in full.
 */
export function knownPrismaResponse(
  err: Prisma.PrismaClientKnownRequestError,
): { status: number; message: string } | null {
  switch (err.code) {
    case 'P2002': {
      const target = (err.meta?.target as string[])?.join(', ') || 'field';
      return { status: 409, message: `A record with this ${target} already exists.` };
    }
    case 'P2025':
      return { status: 404, message: 'Record not found.' };
    case 'P2003':
      return { status: 400, message: 'Related record not found.' };
    case 'P2023':
      // An id that is not a UUID at all — /api/admin/orders/groups, a typo,
      // a truncated link. Nothing by that id can exist, so it is a 404, not
      // the 500 it used to be (which the admin panel answers by throwing the
      // page away). Only the UUID case: any other inconsistent column data is
      // a real data problem and stays a 500.
      return /Error creating UUID/i.test(err.message) ? { status: 404, message: 'Not found.' } : null;

    // ─── Infrastructure, not user input ───────────────────
    // These used to fall through to a bare 400 "Database error: P2028", which
    // told the user nothing and told our monitoring that a failing checkout was
    // a client mistake. They are server-side problems and must read as 5xx.
    case 'P2024':
      // Connection pool exhausted — every connection busy for longer than
      // pool_timeout. Usually load, or connections held open by slow queries.
      return { status: 503, message: 'The server is busy. Please try again in a moment.' };
    case 'P2028':
      // Interactive transaction timed out or was already closed. On checkout
      // this means the transaction exceeded its `timeout` — see the explicit
      // budget set on the transaction in routes/orders.ts.
      return { status: 503, message: 'That took too long to process. Please try again.' };
    case 'P2034':
      // Write conflict / deadlock. Genuinely transient: retrying usually works.
      return { status: 503, message: 'Too many people are ordering at once. Please try again.' };

    // ─── The connection itself ────────────────────────────
    // P1xxx is Prisma saying it never got to the database: unreachable,
    // timed out, or the server hung up. Those arrive here as KNOWN request
    // errors rather than as PrismaClientInitializationError (which this file
    // already answers 503 to further down), so they were falling through to
    // the default below and being served as a 500 reading "Database error
    // (P1001). Please try again."
    //
    // That is wrong twice over. It is not a 500 — nothing broke in our code,
    // and the correct answer is "try again", which is what 503 MEANS. And a
    // Prisma code is not a sentence: an admin saw P1001 after successfully
    // hiring a sales rep on production (2026-10-09) and could not tell
    // whether the rep had been created. It had.
    case 'P1001':
    case 'P1002':
    case 'P1017':
      return { status: 503, message: 'Lost the connection to the database for a moment. Please try again.' };
    case 'P1008':
      return { status: 503, message: 'The database took too long to answer. Please try again.' };
    default:
      return null;
  }
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const isPrisma = err instanceof Prisma.PrismaClientKnownRequestError;

  // Log the code, meta and stack — not just the message.
  //
  // The previous handler logged `err.message` alone while returning the raw
  // code to the client, so a production failure surfaced to the user as an
  // opaque "Database error: P2028" with nothing in the logs to tie it to a
  // route, a request, or a line of code. Whoever is next paged at 2am needs
  // the method and path at minimum.
  console.error('[API Error]', {
    method: req.method,
    path: req.originalUrl,
    name: err.name,
    ...(isPrisma
      ? { prismaCode: (err as Prisma.PrismaClientKnownRequestError).code,
          meta: (err as Prisma.PrismaClientKnownRequestError).meta }
      : {}),
    message: err.message,
    stack: err.stack,
  });

  if (isPrisma) {
    const known = knownPrismaResponse(err as Prisma.PrismaClientKnownRequestError);
    if (known) {
      res.status(known.status).json({ success: false, data: null, error: known.message });
      return;
    }
    // Unrecognised Prisma code: a 500, because we do not know that the caller
    // did anything wrong. The code still goes to the client — it is the one
    // thing that makes a user's screenshot actionable — but it is no longer
    // dressed up as a 400.
    res.status(500).json({
      success: false,
      data: null,
      error: `Database error (${(err as Prisma.PrismaClientKnownRequestError).code}). Please try again.`,
    });
    return;
  }

  // Prisma validation errors
  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({ success: false, data: null, error: 'Invalid data provided.' });
    return;
  }

  // Connection-level failures: the database is unreachable or the client could
  // not start. Never the caller's fault.
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    res.status(503).json({ success: false, data: null, error: 'Service temporarily unavailable. Please try again.' });
    return;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    res.status(401).json({ success: false, data: null, error: 'Invalid or expired token.' });
    return;
  }

  // An interactive transaction that ran out of time does NOT reliably arrive as
  // a PrismaClientKnownRequestError with code P2028. Depending on where it
  // expires it can be a PrismaClientUnknownRequestError, or a plain Error whose
  // message says the transaction is closed or no longer valid. Those were
  // falling all the way through to the generic 500 below, which is how an admin
  // saving an order edit got "Internal server error" — a server-side timeout
  // dressed up as an unexplained crash, with the one word that would have
  // identified it ("transaction") sitting in the message.
  //
  // Matched on the message rather than the class because the class is exactly
  // what varies. Narrow enough not to catch unrelated failures, since it
  // requires both the word transaction AND a closed/expired phrasing.
  const msg = err.message ?? '';
  const looksLikeClosedTransaction =
    /transaction/i.test(msg) &&
    /(already closed|not found|expired|timed? ?out|no longer valid)/i.test(msg);

  if (err instanceof Prisma.PrismaClientUnknownRequestError || looksLikeClosedTransaction) {
    res.status(503).json({
      success: false,
      data: null,
      error: 'That took too long to process. Please try again.',
    });
    return;
  }

  // Default
  res.status(500).json({ success: false, data: null, error: 'Internal server error.' });
}
