/** Confirms every integrity trigger is currently enabled (tgenabled = 'O'). */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const rows = await p.$queryRawUnsafe(`
    SELECT c.relname AS table, t.tgname AS trigger, t.tgenabled AS enabled
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE NOT t.tgisinternal AND c.relname IN
      ('payments','deliveries','debt_adjustments','inventory_transactions','users')
    ORDER BY c.relname, t.tgname
  `);
  console.log('=== TRIGGER STATE ===');
  let bad = 0;
  for (const r of rows) {
    const state = r.enabled === 'O' ? 'ENABLED ' : r.enabled === 'D' ? 'DISABLED' : r.enabled;
    if (r.enabled !== 'O') bad++;
    console.log(`  ${state}  ${r.table}.${r.trigger}`);
  }
  console.log(bad === 0 ? '\nALL TRIGGERS ENABLED (correct)' : `\nWARNING: ${bad} trigger(s) NOT enabled`);
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
