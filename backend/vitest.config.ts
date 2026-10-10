import { defineConfig } from 'vitest/config';

/**
 * `--mode=integration` selects the DB-backed suite; the default run is the
 * fast, dependency-free unit suite.
 */
const isIntegration = process.argv.includes('--mode=integration') || process.env.VITEST_MODE === 'integration';

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
