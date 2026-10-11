/**
 * Runs the integration suites sequentially. Against a pooled remote database
 * the parallel runner hits the 30 s per-test ceiling on the heavier report
 * tests, which is a harness artefact rather than a product failure.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { existsSync } = require('fs');

const suites = process.argv.slice(2);
if (suites.length === 0) {
  console.error('Usage: node run-integration-sequential.js <suite> [suite...]');
  process.exit(1);
}

// Resolve vitest's CLI entry without relying on the package's "exports" map,
// which does not expose the bin path directly.
const candidates = [
  path.join('node_modules', 'vitest', 'vitest.mjs'),
  path.join('node_modules', 'vitest', 'dist', 'cli.js'),
  path.join('node_modules', '.bin', process.platform === 'win32' ? 'vitest.cmd' : 'vitest'),
];
const vitestBin = candidates.find((c) => existsSync(path.join(process.cwd(), c)));
if (!vitestBin) {
  console.error('Could not locate the vitest binary. Tried:\n  ' + candidates.join('\n  '));
  process.exit(1);
}

const useNode = vitestBin.endsWith('.mjs') || vitestBin.endsWith('.js');

let failed = 0;
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const args = [
    ...(useNode ? [vitestBin] : []),
    'run',
    '--mode=integration',
    path.join('tests', 'integration', `${suite}.test.ts`),
    '--maxWorkers=1',
    '--fileParallelism=false',
    '--testTimeout=60000',
    '--hookTimeout=60000',
  ];
  const r = spawnSync(
    useNode ? process.execPath : vitestBin,
    useNode ? args : args.slice(1),
    { stdio: 'inherit', shell: !useNode, env: { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true' } },
  );
  if (r.status !== 0) failed++;
}

console.log(failed === 0 ? '\nALL SUITES PASSED' : `\n${failed} SUITE(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
