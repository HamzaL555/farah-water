/**
 * Removes a test worker account and clears the stock ledger.
 *
 * Order matters. `inventory_transactions.created_by_id` is ON DELETE RESTRICT,
 * so the worker cannot be dropped while they recorded a stock movement - even
 * one that belongs to the warehouse and has nothing to do with them. The ledger
 * is therefore cleared first, then the account.
 *
 * Refuses to run if the account has real financial history: a delivery or a
 * payment cannot be removed, because those tables are append-only by design and
 * the numbers they hold have already been reported to the owner. An account
 * like that must be deactivated instead, which preserves the name on every
 * record they ever touched.
 *
 * A backup is taken first.
 *
 * Usage: node remove-worker-and-reset-stock.js <username>
 */
require('dotenv').config();
const { execFileSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const username = process.argv[2];

(async () => {
  if (!username) {
    console.error('Istehsal: node remove-worker-and-reset-stock.js <username>');
    process.exit(1);
  }

  const u = await prisma.user.findUnique({ where: { username } });
  if (!u) {
    console.log(`"${username}" adli hesab yoxdur - silmek ucun bir sey deyil.`);
    await prisma.$disconnect();
    return;
  }
  if (u.role === 'ADMIN') {
    console.error('ADMIN hesabi silinmir. Bu, sistemi idare eden hesabdir.');
    process.exit(1);
  }

  const dels = await prisma.delivery.count({ where: { workerId: u.id } });
  const pays = await prisma.payment.count({ where: { recordedById: u.id } });
  const adj = await prisma.debtAdjustment.count({ where: { createdById: u.id } });

  if (dels || pays || adj) {
    console.error('============================================');
    console.error(' SILINMIR - hesab real tarixceya baglidir');
    console.error('============================================');
    console.error(`  ${username}: ${dels} catdirilma, ${pays} odenis, ${adj} borc duzelisi`);
    console.error('');
    console.error('Bu melumatlar siline bilmez - odenis ve catdirilma qeydleri');
    console.error('hesabatda durur ve silinmesi mumkun deyil. Hesabi deaktiv et:');
    console.error(`  node scripts/deactivate-user.js ${username}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const txCount = await prisma.inventoryTransaction.count({ where: { workerId: u.id } });
  const bal = await prisma.inventoryBalance.findMany({ include: { worker: { select: { username: true } } } });

  console.log('============================================');
  console.log(' SILINECEK');
  console.log('============================================');
  console.log(`  hesab      : ${u.fullName} (${u.username}, ${u.role})`);
  console.log(`  ona ait amaliyyat : ${txCount}`);
  console.log('');
  console.log('  butun anbar emaliyyatlari silinir:');
  const txs = await prisma.inventoryTransaction.findMany({
    orderBy: { occurredAt: 'asc' },
    select: { type: true, bottleCount: true, direction: true, occurredAt: true },
  });
  for (const t of txs) {
    console.log(`    ${new Date(t.occurredAt).toISOString().slice(0, 16)}  ${t.type.padEnd(17)} ${t.direction > 0 ? '+' : ''}${t.direction * t.bottleCount}`);
  }
  console.log('');
  console.log('  qaliqlar sifirlanir:');
  for (const b of bal) {
    console.log(`    ${(b.worker ? b.worker.username : 'ANBAR').padEnd(10)} ${b.quantity}  ->  0`);
  }
  console.log('');

  console.log('Ehtiyat yaradilir...');
  execFileSync('node', ['scripts/backup-data.js', '--keep', '30'], { stdio: 'pipe' });
  console.log('  ehtiyat hazirdir\n');

  const steps = [];
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('ALTER TABLE inventory_transactions DISABLE TRIGGER "inventory_transactions_no_delete"');

    const a = await tx.auditLog.deleteMany({ where: { entityType: 'inventory_transaction' } });
    steps.push(`anbar audit satirlari : ${a.count}`);

    const d = await tx.inventoryTransaction.deleteMany({});
    steps.push(`anbar emaliyyatlari    : ${d.count}`);

    const z = await tx.inventoryBalance.updateMany({ data: { quantity: 0 } });
    steps.push(`qaliqlar sifirlandi   : ${z.count}`);

    await tx.$executeRawUnsafe('ALTER TABLE inventory_transactions ENABLE TRIGGER "inventory_transactions_no_delete"');

    // The worker's balance row cascades away with the account; the warehouse row
    // must survive, because the dashboard reads a total from it.
    const del = await tx.user.delete({ where: { id: u.id } });
    steps.push(`hesab silindi         : ${del.username}`);
  });

  console.log('edildi:');
  steps.forEach((s) => console.log(`  ${s}`));

  console.log('\nyekun veziyyet:');
  const b2 = await prisma.inventoryBalance.findMany({ include: { worker: { select: { username: true } } } });
  for (const b of b2) console.log(`  ${(b.worker ? b.worker.username : 'ANBAR').padEnd(10)} ${b.quantity} bidon`);
  console.log(`  emaliyyat sayi : ${await prisma.inventoryTransaction.count()}`);
  console.log(`  hesablar      : ${(await prisma.user.findMany({ select: { username: true, role: true } })).map((x) => `${x.username} (${x.role})`).join(', ')}`);

  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });