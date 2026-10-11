/**
 * Proves a backup can actually be restored.
 *
 * Restores into a THROWAWAY database (created from the same template, then
 * dropped), so the live data is never touched. A backup that has never been
 * restored is not a backup.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const LIVE_URL = process.env.DATABASE_URL;
const prisma = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node verify-restore.js <backup.json>'); process.exit(1); }

  const backup = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const expected = Object.fromEntries(
    Object.entries(backup.tables).map(([k, v]) => [k, v.length]),
  );
  const name = 'farah_restore_test';
  const testUrl = LIVE_URL.replace(/\/[^/?]+(\?|$)/, `/${name}$1`);

  console.log(`backup     : ${path.basename(file)}`);
  console.log(`test db    : ${name}`);
  console.log(`expected   : ${Object.entries(expected).filter(([, n]) => n).map(([k, n]) => k + '=' + n).join(' ')}\n`);

  const psql = (sql) => {
    const { spawnSync } = require('child_process');
    const r = spawnSync('docker', ['exec', '-i', 'farah-postgres', 'psql', '-U', 'farah', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
      encoding: 'utf8',
    });
    return (r.stdout || '') + (r.stderr || '');
  };

  // 1. create the throwaway database
  const admin = new PrismaClient({ datasourceUrl: LIVE_URL });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name}`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${name}`);
  await admin.$disconnect();
  console.log('created throwaway database');

  const test = new PrismaClient({ datasourceUrl: testUrl });

  try {
    // 2. apply the schema
    execSync('npx.cmd prisma db push --skip-generate --accept-data-loss', {
      cwd: 'C:/Users/user/Desktop/Farah/backend',
      env: { ...process.env, DATABASE_URL: testUrl },
      stdio: 'pipe',
      shell: 'C:\\Windows\\System32\\cmd.exe',
    });
    console.log('schema applied');

    // 3. load the rows
    let inserted = 0;
    for (const [model, rows] of Object.entries(backup.tables)) {
      if (!rows.length) continue;
      for (let i = 0; i < rows.length; i += 500) {
        const r = await test[model].createMany({ data: rows.slice(i, i + 500), skipDuplicates: true });
        inserted += r.count ?? 0;
      }
    }
    console.log(`inserted ${inserted} rows\n`);

    // 4. compare counts
    let bad = 0;
    console.log('model                 expected  actual');
    for (const [model, want] of Object.entries(expected)) {
      if (!want) continue;
      const got = await test[model].count();
      const ok = got === want;
      if (!ok) bad++;
      console.log(`  ${model.padEnd(22)}${String(want).padStart(6)}  ${String(got).padStart(6)}  ${ok ? '' : '<-- MISMATCH'}`);
    }

    // 5. money must survive exactly
    const pay = await test.payment.findMany({ select: { amount: true } });
    const sum = pay.reduce((s, p) => s.add(p.amount), new (require('@prisma/client').Prisma.Decimal)(0));
    console.log(`\npayment sum : ${sum.toFixed(2)}`);
    const liveSum = await prisma.payment.findMany({ select: { amount: true } });
    const liveTotal = liveSum.reduce((s, p) => s.add(p.amount), new (require('@prisma/client').Prisma.Decimal)(0));
    console.log(`live sum    : ${liveTotal.toFixed(2)}`);
    if (sum.toFixed(2) !== liveTotal.toFixed(2)) { console.log('  <-- MONEY MISMATCH'); bad++; }
    else console.log('  money matches the live database exactly');

    console.log(`\n${bad === 0 ? 'RESTORE VERIFIED' : bad + ' PROBLEM(S)'}`);
    process.exitCode = bad === 0 ? 0 : 1;
  } finally {
    // Postgres refuses to drop a database while a session is still attached,
    // and the Prisma engine keeps a pool open, so close it and evict anything
    // left before dropping.
    await test.$disconnect().catch(() => {});
    const cleanup = new PrismaClient({ datasourceUrl: LIVE_URL });
    await cleanup.$executeRawUnsafe(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`,
    ).catch(() => {});
    await cleanup.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${name}`);
    await cleanup.$disconnect();
    console.log('throwaway database dropped');
    void psql;
    await prisma.$disconnect();
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
