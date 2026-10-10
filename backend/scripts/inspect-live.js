/** Read-only inventory of live data, so deletions are targeted rather than guessed. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const p = new PrismaClient();

(async () => {
  const users = await p.user.findMany({
    select: {
      id: true, username: true, fullName: true, phone: true, role: true,
      isActive: true, createdAt: true,
      _count: { select: { deliveries: true, inventoryTx: true, inventoryBal: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  console.log('=== USERS ===');
  for (const u of users) {
    console.log(
      `  ${u.username.padEnd(12)} ${String(u.role).padEnd(6)} active=${String(u.isActive).padEnd(5)} ` +
      `deliveries=${String(u._count.deliveries).padEnd(4)} bottles=${String(u._count.bottles).padEnd(4)} ` +
      `created=${u.createdAt.toISOString().slice(0, 10)}  id=${u.id}`,
    );
  }

  const customers = await p.customer.findMany({
    select: { id: true, name: true, phone: true, isActive: true, _count: { select: { deliveries: true } } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`\n=== CUSTOMERS (${customers.length}) ===`);
  for (const c of customers) {
    console.log(`  ${c.name.padEnd(22)} ${String(c.phone).padEnd(14)} deliveries=${c._count.deliveries} id=${c.id}`);
  }

  const bottles = await p.bottle.findMany({
    select: { id: true, kind: true, size: true, price: true, stock: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  console.log(`\n=== BOTTLES (${bottles.length}) ===`);
  for (const b of bottles) console.log(`  ${b.kind} ${b.size}L price=${b.price} stock=${b.stock}`);

  const counts = {};
  for (const t of ['delivery', 'payment', 'debt', 'bottleTransaction', 'stockMovement', 'auditLog']) {
    try { counts[t] = await p[t].count(); } catch { counts[t] = 'n/a'; }
  }
  console.log('\n=== ROW COUNTS ===');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(18)} ${v}`);

  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
