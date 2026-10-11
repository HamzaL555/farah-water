/** Final state check after restoring the live database. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const users = await p.user.findMany({
    select: { username: true, role: true, isActive: true, mustChangePassword: true },
  });
  console.log('=== USERS ===');
  for (const u of users) {
    console.log(`  ${u.username.padEnd(12)} ${u.role.padEnd(6)} active=${u.isActive} mustChangePassword=${u.mustChangePassword}`);
  }

  console.log('\n=== ROW COUNTS ===');
  for (const t of [
    'user', 'customer', 'delivery', 'payment', 'debtAdjustment',
    'inventoryTransaction', 'inventoryBalance', 'auditLog', 'appSetting',
  ]) {
    console.log(`  ${t.padEnd(22)}${await p[t].count()}`);
  }

  const bal = await p.inventoryBalance.findMany();
  console.log('\n=== WAREHOUSE ===');
  bal.forEach((b) => console.log(`  ${b.key} = ${b.quantity}`));

  const settings = await p.appSetting.findMany();
  console.log('\n=== SETTINGS ===');
  settings.forEach((s) => console.log(`  ${s.key} = ${JSON.stringify(s.value)}`));

  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
