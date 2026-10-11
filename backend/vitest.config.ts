import { defineConfig } from 'vitest/config';
import { config as loadEnv } from 'dotenv';
import { assertSafeTestDatabase } from './tests/helpers/test-db-guard';

/**
 * `--mode=integration` selects the DB-backed suite; the default run is the
 * fast, dependency-free unit suite.
 */
const isIntegration = process.argv.includes('--mode=integration') || process.env.VITEST_MODE === 'integration';

/**
 * Refuse to boot the suite at all when DATABASE_URL points at anything that
 * is not a local throwaway database.
 *
 * `resetDb()` in tests/integration/setup.ts issues TRUNCATE against whatever
 * DATABASE_URL resolves to. Without this check, running `npm run test:integration`
 * with a production `.env` silently erases the live database and replaces the
 * admin account with a fixture. That happened once; this makes it impossible.
 *
 * dotenv is loaded here first so the guard can name the offending host instead
 * of reporting an empty URL.
 */
if (isIntegration) {
  loadEnv({ quiet: true });
  assertSafeTestDatabase(process.env.DATABASE_URL ?? '');
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: isIntegration ? ['tests/integration/**/*.test.ts'] : ['tests/unit/**/*.test.ts'],
    // Integration tests share one PostgreSQL database and TRUNCATE between
    // cases, so files must never run concurrently.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
    env: { NODE_ENV: 'test', VITEST_MODE: isIntegration ? 'integration' : 'unit' },
  },
});
