/**
 * Measures ACTUAL current usage against the free-tier limits.
 *
 * Quotes limits are useless on their own; the question is how much headroom is
 * left and how long it lasts. This reports real numbers for both providers.
 */
const fs = require('fs');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

(async () => {
  // ---------------------------- database size --------------------------------
  const [db] = await prisma.$queryRawUnsafe(
    'SELECT pg_database_size(current_database()) AS bytes',
  );
  const size = Number(db.bytes);
  const LIMIT = 1024 * 1024 * 1024; // Neon free: 1 GB per project
  const pct = (size / LIMIT) * 100;

  console.log('=== NEON (baza) ===');
  console.log(`  istifadə   : ${mb(size)} / 1024 MB  (${pct.toFixed(3)}%)`);
  console.log(`  qalan      : ${mb(LIMIT - size)}`);
  console.log(`  limit bitəndə: yazma dayanır, məlumat SİLİNMİR`);

  // Rough row growth: how fast is the database filling up?
  const tables = [
    'delivery', 'payment', 'inventoryTransaction', 'auditLog', 'customer', 'user',
  ];
  console.log('\n  cədvəllər:');
  for (const t of tables) {
    const n = await prisma[t].count();
    console.log(`    ${t.padEnd(22)} ${String(n).padStart(6)} sətir`);
  }

  // --------------------------- server-side sizes -----------------------------
  const sizes = await prisma.$queryRawUnsafe(`
    SELECT relname,
           pg_total_relation_size(relid) AS bytes
    FROM pg_catalog.pg_statio_user_tables
    ORDER BY pg_total_relation_size(relid) DESC
    LIMIT 6
  `);
  console.log('\n  ən böyük cədvəllər:');
  for (const s of sizes) console.log(`    ${s.relname.padEnd(22)} ${mb(Number(s.bytes))}`);

  // ------------------------------ Vercel ------------------------------------
  const VTOK = 'C:/Users/user/AppData/Local/Temp/opencode/vtok.txt';
  if (fs.existsSync(VTOK)) {
    const TOKEN = fs.readFileSync(VTOK, 'utf8').trim();
    const teams = await fetch('https://api.vercel.com/v2/teams', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    }).then((r) => r.json());
    const team = teams.teams?.[0]?.id;

    const billing = await fetch(
      `https://api.vercel.com/v1/teams/${team}/billing?periodStart=${new Date(Date.now() - 86400000 * 20).toISOString()}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    if (billing.ok) {
      const b = await billing.json();
      console.log('\n=== VERCEL (server) ===');
      console.log(`  plan       : ${b.plan || 'hobby'}`);
      for (const k of ['fastDataTransfer', 'functionInvocations', 'totalRequests']) {
        if (b[k] !== undefined) console.log(`  ${k.padEnd(12)}: ${b[k]}`);
      }
      if (b.usage) {
        for (const [k, v] of Object.entries(b.usage)) {
          console.log(`  ${k.padEnd(24)}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
        }
      }
    } else {
      console.log('\n=== VERCEL ===\n  (usage endpoint not readable on this plan)');
    }
  }

  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
