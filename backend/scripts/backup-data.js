/**
 * Nightly database backup for the hosted database.
 *
 * The data lives in Postgres, not in the application host. If the host ever
 * goes away, a dump taken here is what makes recovery possible, so this
 * deliberately has no dependency on any particular hosting provider.
 *
 * Two independent backups are produced:
 *   1. a .sql text dump        - readable, portable, diffable
 *   2. a .json data dump       - no pg tools needed, used by restore-data.js
 *
 * Retention keeps the last N dumps of each kind.
 *
 * Usage: node backup-data.js [--keep 30] [--out <dir>]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const KEEP = Number(arg('keep', 30));
const OUT = path.resolve(arg('out', path.join(__dirname, '..', '..', 'backups')));

const MODELS = [
  'user', 'customer', 'delivery', 'payment', 'debtAdjustment',
  'inventoryBalance', 'inventoryTransaction', 'auditLog', 'appSetting',
  'refreshToken', 'loginAttempt',
];

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);

/** Serialises a Prisma row so Dates and Decimals survive JSON. */
function plain(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  // Prisma.Decimal carries toJSON/toString; anything else is passed through.
  if (typeof value === 'object' && typeof value.toJSON === 'function') return value.toJSON();
  return value;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const host = (process.env.DATABASE_URL || '').split('@')[1]?.split('/')[0] ?? 'unknown';
  console.log(`target : ${host}`);
  console.log(`output : ${OUT}`);
  console.log(`keep   : last ${KEEP} of each kind`);

  // --- read every table -----------------------------------------------------
  const tables = {};
  let totalRows = 0;
  for (const model of MODELS) {
    const client = prisma[model];
    if (!client) { console.warn(`  skip (unknown model): ${model}`); continue; }
    const rows = await client.findMany();
    tables[model] = rows.map((r) => {
      const out = {};
      for (const [k, v] of Object.entries(r)) out[k] = plain(v);
      return out;
    });
    totalRows += rows.length;
    console.log(`  ${model.padEnd(22)} ${String(rows.length).padStart(5)} sətir`);
  }

  const meta = {
    takenAt: new Date().toISOString(),
    host,
    rowCounts: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])),
    totalRows,
  };

  // --- JSON dump -----------------------------------------------------------
  const jsonFile = path.join(OUT, `farah-${stamp()}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify({ meta, tables }, null, 1));
  console.log(`\nJSON   : ${path.basename(jsonFile)} (${(fs.statSync(jsonFile).size / 1024).toFixed(1)} KB)`);

  // --- SQL dump ------------------------------------------------------------
  // Written as INSERT statements inside a transaction so a restore is atomic.
  const q = (v) => {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return `'${String(v).replace(/'/g, "''")}'`;
  };

  const lines = [
    '-- Farah Su Şirkəti — data backup',
    `-- ${meta.takenAt}`,
    `-- ${meta.totalRows} sətir`,
    '',
    'BEGIN;',
    '',
  ];
  for (const [model, rows] of Object.entries(tables)) {
    if (!rows.length) continue;
    lines.push(`-- ${model} (${rows.length})`);
    for (const row of rows) {
      const cols = Object.keys(row);
      lines.push(
        `INSERT INTO "${model}" (${cols.map((c) => `"${c}"`).join(', ')}) ` +
        `VALUES (${cols.map((c) => q(row[c])).join(', ')});`,
      );
    }
    lines.push('');
  }
  lines.push('COMMIT;', '');

  const sqlFile = path.join(OUT, `farah-${stamp()}.sql`);
  fs.writeFileSync(sqlFile, lines.join('\n'));
  console.log(`SQL    : ${path.basename(sqlFile)} (${(fs.statSync(sqlFile).size / 1024).toFixed(1)} KB)`);

  // --- retention -----------------------------------------------------------
  for (const ext of ['json', 'sql']) {
    const files = fs
      .readdirSync(OUT)
      .filter((f) => f.startsWith('farah-') && f.endsWith(`.${ext}`))
      .sort()
      .reverse();
    files.slice(KEEP).forEach((f) => {
      fs.unlinkSync(path.join(OUT, f));
      console.log(`  removed old backup: ${f}`);
    });
  }

  const kept = fs.readdirSync(OUT).filter((f) => f.startsWith('farah-')).length;
  console.log(`\n${totalRows} sətir ehtiyatlandı. ${kept} fayl saxlanılır.`);
  console.log(`Bərpa: node backend/scripts/restore-data.js --file <bu .json fayl>`);

  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
