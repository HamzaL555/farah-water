/** Confirms the createdBy FK exists on inventory_transactions in the live DB. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const rows = await p.$queryRawUnsafe(`
    SELECT conname,
           pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.conrelid = 'inventory_transactions'::regclass
      AND c.contype = 'f'
    ORDER BY conname
  `);
  console.log('=== FK on inventory_transactions ===');
  for (const r of rows) {
    console.log(`  ${r.conname}`);
    console.log(`    ${r.def}`);
  }
  const hasCreatedBy = rows.some((r) => r.conname === 'inventory_transactions_createdById_fkey');
  console.log(`\ncreatedBy relation: ${hasCreatedBy ? 'PRESENT' : 'MISSING'}`);
  await p.$disconnect();
  process.exit(hasCreatedBy ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
