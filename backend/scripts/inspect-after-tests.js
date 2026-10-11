/** Reports exactly what the integration-test TRUNCATE left behind. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  console.log('DATABASE_URL host:', (process.env.DATABASE_URL || '').split('@')[1]?.split('/')[0] ?? '(none)');

  const users = await p.user.findMany({
    select: { username: true, role: true, isActive: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log('\n=== USERS ===');
  if (users.length === 0) console.log('  (none)');
  for (const u of users) {
    console.log(`  ${u.username.padEnd(12)} ${u.role.padEnd(6)} active=${u.isActive} created=${u.createdAt.toISOString()}`);
  }

  console.log('\n=== ROW COUNTS ===');
  for (const t of [
    'user', 'customer', 'delivery', 'payment', 'debtAdjustment',
    'inventoryTransaction', 'inventoryBalance', 'auditLog', 'appSetting',
  ]) {
    console.log(`  ${t.padEnd(22)}${await p[t].count()}`);
  }

  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
