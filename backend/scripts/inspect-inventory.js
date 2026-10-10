/** Full inventory ledger + settings, to decide whether the warehouse count is test data. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const all = await p.inventoryTransaction.findMany({
    orderBy: { occurredAt: 'asc' },
    select: {
      id: true, type: true, bottleCount: true, direction: true, balanceKey: true,
      workerId: true, deliveryId: true, note: true, occurredAt: true,
    },
  });
  console.log(`=== ALL INVENTORY TRANSACTIONS (${all.length}) ===`);
  for (const t of all) {
    console.log(
      `  ${t.occurredAt.toISOString().slice(0, 16)} | ${String(t.type).padEnd(18)} | ` +
      `${String(t.direction).padStart(2)} x${String(t.bottleCount).padEnd(4)} | key=${t.balanceKey.padEnd(42)} | ` +
      `${t.workerId ? 'worker=' + t.workerId.slice(0, 8) : 'worker=-'} | ${t.note ?? '-'}`,
    );
  }

  const bal = await p.inventoryBalance.findMany({ select: { key: true, scope: true, workerId: true, quantity: true } });
  console.log('\n=== BALANCES ===');
  for (const b of bal) console.log(`  ${b.key.padEnd(42)} scope=${String(b.scope).padEnd(9)} qty=${b.quantity}`);

  const settings = await p.appSetting.findMany();
  console.log('\n=== APP SETTINGS ===');
  for (const s of settings) console.log(`  ${s.key} = ${s.value}`);

  const audit = await p.auditLog.findMany({
    orderBy: { createdAt: 'desc' }, take: 15,
    select: { action: true, entityType: true, entityId: true, actorId: true, createdAt: true },
  });
  console.log('\n=== RECENT AUDIT (last 15) ===');
  for (const a of audit) {
    console.log(`  ${a.createdAt.toISOString().slice(0, 16)} | ${String(a.action).padEnd(16)} | ${String(a.entityType).padEnd(12)} | ${(a.entityId ?? '-').slice(0, 8)}`);
  }

  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
