/** Post-wipe verification: what remains in every table, and the warehouse count. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const bal = await p.inventoryBalance.findMany({ select: { key: true, scope: true, quantity: true } });
  console.log('=== INVENTORY BALANCES ===');
  if (bal.length === 0) console.log('  (none)');
  bal.forEach((b) => console.log(`  ${b.key}  scope=${b.scope}  qty=${b.quantity}`));

  console.log('\n=== ROW COUNTS ===');
  for (const t of [
    'user', 'customer', 'delivery', 'payment', 'debtAdjustment',
    'inventoryTransaction', 'inventoryBalance', 'auditLog', 'loginAttempt', 'refreshToken',
  ]) {
    console.log(`  ${t.padEnd(22)}${await p[t].count()}`);
  }

  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
