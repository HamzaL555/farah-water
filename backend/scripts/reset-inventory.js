/**
 * Zeroes the stock ledger.
 *
 * Deletes every inventory movement and sets all balances - the central
 * warehouse and every worker's handheld count - to 0. Accounts, customers,
 * deliveries, payments and settings are untouched.
 *
 * A backup is taken first. Inventory movements are financial records: the
 * database blocks DELETE on that table precisely because a mistake there
 * cannot be undone by editing a number.
 *
 * Usage: node reset-inventory.js
 */
require('dotenv').config();
const { execFileSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

(async () => {
  const movements = await prisma.inventoryTransaction.findMany({
    orderBy: { occurredAt: 'asc' },
    select: {
      id: true, type: true, bottleCount: true, direction: true,
      balanceKey: true, occurredAt: true,
      worker: { select: { username: true } },
    },
  });
  const balances = await prisma.inventoryBalance.findMany({
    include: { worker: { select: { username: true, fullName: true } } },
  });
  const auditCount = await prisma.auditLog.count({
    where: { entityType: 'inventory_transaction' },
  });

  console.log('============================================');
  console.log(' SILINECEK: ANBAR EMALIYYATLARI');
  console.log('============================================');
  console.log(`\n[1] Emaliyyatlar (${movements.length})`);
  if (!movements.length) console.log('    yoxdur');
  for (const m of movements) {
    console.log(
      `    ${new Date(m.occurredAt).toISOString().slice(0, 16)}  ${m.type.padEnd(17)}` +
      ` ${m.direction > 0 ? '+' : ''}${m.direction * m.bottleCount}  ${m.worker ? m.worker.username : 'ANBAR'}`,
    );
  }

  console.log(`\n[2] Qalıqlar sıfırlanacaq (${balances.length})`);
  for (const b of balances) {
    console.log(`    ${(b.worker ? b.worker.username : 'ANBAR').padEnd(10)} ${b.quantity}  ->  0`);
  }

  console.log(`\n[3] Anbar audit sətirləri: ${auditCount}`);
  console.log('');
  console.log('============================================');
  console.log(' QORUNACAQ');
  console.log('============================================');
  const users = await prisma.user.findMany({ select: { username: true, role: true } });
  console.log(`  ✔ hesablar    : ${users.map((u) => `${u.username} (${u.role})`).join(', ')}`);
  console.log(`  ✔ müştərilər  : ${await prisma.customer.count()}`);
  console.log(`  ✔ çatdırılma  : ${await prisma.delivery.count()}`);
  console.log(`  ✔ ödəniş      : ${await prisma.payment.count()}`);
  console.log('');

  console.log('Ehtiyat yaradılır...');
  execFileSync('node', ['scripts/backup-data.js', '--keep', '30'], { stdio: 'pipe' });
  console.log('  ehtiyat hazırdır\n');

  const steps = [];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('ALTER TABLE inventory_transactions DISABLE TRIGGER "inventory_transactions_no_delete"');

    const audit = await tx.auditLog.deleteMany({ where: { entityType: 'inventory_transaction' } });
    steps.push(`anbar audit sətirləri: ${audit.count}`);

    const del = await tx.inventoryTransaction.deleteMany({});
    steps.push(`anbar əməliyyatları: ${del.count}`);

    // Zero rather than delete: the warehouse row must exist for the dashboard
    // to read a total from day one, and a worker row reappears on their next
    // movement.
    const zero = await tx.inventoryBalance.updateMany({ data: { quantity: 0 } });
    steps.push(`qalıqlar sıfırlandı: ${zero.count}`);

    await tx.$executeRawUnsafe('ALTER TABLE inventory_transactions ENABLE TRIGGER "inventory_transactions_no_delete"');
  });

  console.log('edildi:');
  steps.forEach((s) => console.log(`  ${s}`));

  console.log('\nyekun vəziyyət:');
  const b2 = await prisma.inventoryBalance.findMany({
    include: { worker: { select: { username: true } } },
  });
  for (const b of b2) {
    console.log(`  ${(b.worker ? b.worker.username : 'ANBAR').padEnd(10)} ${b.quantity} bidon`);
  }
  console.log(`  əməliyyat sayı: ${await prisma.inventoryTransaction.count()}`);

  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
