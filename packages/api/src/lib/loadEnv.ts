import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

/**
 * Load an environment file chosen at the command line, and say out loud which
 * one it was.
 *
 * The migration and backfill scripts rewrite database rows and move assets
 * between CDNs. Which environment they hit is decided entirely by a
 * DATABASE_URL and a set of BUNNY_* values, and the difference between staging
 * and production is invisible once the process is running. So the choice is
 * explicit — `--env=.env.staging` — rather than "whatever .env happens to hold
 * right now", and every script prints the target before it does anything.
 *
 *     npm run … -- --env=.env.staging
 *
 * Env variants are gitignored (see .gitignore): they carry a real DATABASE_URL
 * and a Bunny storage key that grants delete over the entire zone.
 */
export interface LoadedEnv {
  /** Absolute path of the file that was loaded. */
  file: string;
  /** Host from DATABASE_URL — enough to tell environments apart, no credentials. */
  databaseHost: string;
}

export function loadEnv(argv: string[] = process.argv.slice(2)): LoadedEnv {
  const requested = argv
    .find((a) => a.startsWith('--env='))
    ?.split('=').slice(1).join('=');

  const apiRoot = path.join(__dirname, '..', '..');
  const file = requested
    ? (path.isAbsolute(requested) ? requested : path.join(apiRoot, requested))
    : path.join(apiRoot, '.env');

  if (!fs.existsSync(file)) {
    throw new Error(
      `Env file not found: ${file}\n` +
      `Pass --env=<file> relative to packages/api, e.g. --env=.env.staging`,
    );
  }

  // `override` so an explicitly chosen file wins over anything already in the
  // process environment. Without it a stale exported DATABASE_URL would
  // silently beat the file you just named, which is the exact mistake this
  // whole function exists to prevent.
  dotenv.config({ path: file, override: true });

  return { file, databaseHost: hostOfDatabaseUrl(process.env.DATABASE_URL) };
}

/** Pull just the host out of a connection string — never the credentials. */
function hostOfDatabaseUrl(url: string | undefined): string {
  if (!url) return '(DATABASE_URL unset)';
  const m = url.match(/^[a-z+]+:\/\/[^@]*@([^/:?]+)/i);
  return m ? m[1] : '(unparseable)';
}

/** One-line banner naming the environment a script is about to act on. */
export function describeTarget(env: LoadedEnv, extra: Record<string, string> = {}): string {
  const lines = [
    `  env file: ${path.basename(env.file)}`,
    `  database: ${env.databaseHost}`,
    ...Object.entries(extra).map(([k, v]) => `  ${k}: ${v}`),
  ];
  return lines.join('\n');
}
