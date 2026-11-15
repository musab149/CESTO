/**
 * Turn on Prisma's per-statement events, before anyone constructs the client.
 *
 * Its own module because `import` is hoisted: an assignment at the top of the
 * test file still runs AFTER the imports below it, by which point lib/prisma
 * has already built the client and the log option is fixed. Imported first,
 * this runs first.
 *
 * Only the big-order test needs it, and only to count statements — see the
 * comment on the client in lib/prisma.ts for why that number is the one that
 * matters.
 */
process.env.PRISMA_LOG_QUERIES = '1';
export {};
