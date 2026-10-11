/**
 * Guard for the DB-backed test suite.
 *
 * tests/integration/setup.ts TRUNCATEs every table before the suite runs, so it
 * is bound by whatever DATABASE_URL resolves to. Running it against the live
 * Neon database erases production data and overwrites the admin account with a
 * fixture. This module makes that impossible to do by accident.
 */

/** Hosts that can never be a disposable test database. */
const FORBIDDEN_HOST_PATTERNS: Array<{ re: RegExp; why: string }> = [
  { re: /\.neon\.tech$/i, why: 'Neon managed instance' },
  { re: /\.supabase\.(com|co)$/i, why: 'Supabase managed instance' },
  { re: /\.amazonaws\.com$/i, why: 'AWS RDS' },
  { re: /\.database\.azure\.com$/i, why: 'Azure Database' },
  { re: /\.postgres\.database\.azure\.com$/i, why: 'Azure Database' },
  { re: /\.sql\.azure\.com$/i, why: 'Azure SQL' },
  { re: /\.rds\.amazonaws\.com$/i, why: 'AWS RDS' },
  { re: /\.cloudsql\.google\.com$/i, why: 'Google Cloud SQL' },
  { re: /\.planetscale\.com$/i, why: 'PlanetScale' },
  { re: /\.mongo\.com$/i, why: 'MongoDB Atlas' },
  { re: /\.redis\.io$/i, why: 'Redis Cloud' },
  { re: /\.upstash\.io$/i, why: 'Upstash' },
];

/** Only these are considered a local, disposable database. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]', 'host.docker.internal']);

const OPT_IN = 'I_UNDERSTAND=DELETE_ALL';

export interface GuardOptions {
  /** Test database name; anything else must not be truncated. */
  expectedDatabase?: string;
  allowOptIn?: boolean;
}

/**
 * Throws with an actionable message unless the URL is safe to truncate.
 * Returns the parsed host and database name on success.
 */
export function assertSafeTestDatabase(
  url: string,
  { expectedDatabase = 'farah_test', allowOptIn = true }: GuardOptions = {},
): { host: string; database: string } {
  if (!url) {
    throw new Error(
      '[test-db-guard] DATABASE_URL is empty.\n' +
        `Integration tests TRUNCATE the target database. Set DATABASE_URL to a local\n` +
        `scratch database, e.g. postgresql://postgres:postgres@localhost:5432/${expectedDatabase}`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[test-db-guard] DATABASE_URL is not a valid URL: ${url}`);
  }

  const host = parsed.hostname;
  const database = parsed.pathname.replace(/^\//, '') || '(none)';
  const where = `${host}/${database}`;

  const forbidden = FORBIDDEN_HOST_PATTERNS.find((p) => p.re.test(host));
  if (forbidden) {
    // No opt-in: a managed host is production by default, full stop.
    throw new Error(
      `[test-db-guard] REFUSING TO RUN.\n` +
        `DATABASE_URL points at ${where} (${forbidden.why}).\n` +
        `Integration tests TRUNCATE every table, which would erase the live database.\n\n` +
        `Fix: point .env at a local scratch database and keep production credentials\n` +
        `out of the test path entirely, for example:\n` +
        `  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/${expectedDatabase}\n\n` +
        `If you are certain ${where} is a disposable scratch database, you may set\n` +
        `${OPT_IN}=1 - but that override is deliberately unavailable for managed hosts.`,
    );
  }

  if (!LOCAL_HOSTS.has(host)) {
    if (!allowOptIn || process.env.I_UNDERSTAND !== 'DELETE_ALL') {
      throw new Error(
        `[test-db-guard] REFUSING TO RUN against ${where}.\n` +
          `Integration tests TRUNCATE every table. Only a local database is allowed.\n` +
          `Set DATABASE_URL to localhost, or set ${OPT_IN}=1 if this host is a\n` +
          `disposable scratch database you own.`,
      );
    }
  }

  if (database !== expectedDatabase) {
    throw new Error(
      `[test-db-guard] REFUSING TO RUN against ${where}.\n` +
        `Integration tests TRUNCATE every table, so the target database must be named\n` +
        `"${expectedDatabase}". Got "${database}".\n` +
        `Rename your scratch database, or point DATABASE_URL at one with that name.`,
    );
  }

  return { host, database };
}
