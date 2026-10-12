/**
 * Preview for "remove the test worker and zero the stock".
 *
 * Prints exactly what would go and what would stay. Does not change anything.
 *
 * Usage: node preview-remove-worker.js [username]
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const username = process.argv[2] || 'hamza';

(async () => {
  const u = await prisma.user.findUnique({ where: { username } });
  if (!u) {
    console.log(`"${username}" adli hesab yoxdur.`);
    console.log('Movcud:', (await prisma.user.findMany({ select: { username: true } })).map((x) => x.username).join(', '));
    await prisma.$disconnect();
    return;
  }

  console.log('============================================');
  console.log(` SILINACEK HESAB: ${u.username}`);
  console.log('============================================');
  console.log(`  ad      : ${u.fullName}`);
  console.log(`  rol     : ${u.role}`);
  console.log(`  yaradil : ${new Date(u.createdAt).toISOString().slice(0, 10)}`);
  console.log(`  son giris: ${u.lastLoginAt ? new Date(u.lastLoginAt).toISOString().slice(0, 16) : '-'}`);
  console.log('');

  const dels = await prisma.delivery.count({ where: { workerId: u.id } });
  const pays = await prisma.payment.count({ where: { recordedById: u.id } });
  const debtAdj = await prisma.debtAdjustment.count({ where: { createdById: u.id } });
  const cust = await prisma.customer.count();
  const invTx = await prisma.inventoryTransaction.count({ where: { workerId: u.id } });
  const invRec = await prisma.inventoryTransaction.count({ where: { createdById: u.id } });
  const audit = await prisma.auditLog.count({ where: { actorId: u.id } });

  console.log('  Bu hesabla bagli melumat:');
  console.log(`    catdirilma     : ${dels}`);
  console.log(`    odenis         : ${pays}`);
  console.log(`    borc duzelis   : ${debtAdj}`);
  console.log(`    sistem musteri : ${cust}`);
  console.log(`    anbar emaliyyati (ona ait)  : ${invTx}`);
  console.log(`    anbar emaliyyati (o yazib)  : ${invRec}`);
  console.log(`    audit satir    : ${audit} (silindikde ad qalir, actorId null olur)`);

  const linked = dels + pays + debtAdj + invTx + invRec;
  console.log('');
  console.log(linked
    ? '  DIQQET: bu hesab real melumata baglidir, silmek risklidir.'
    : '  Bu hesab sirf test - hec bir real kayda bagli deyil.');

  console.log('');
  console.log('============================================');
  console.log(' ANBAR SIFIRLANACAGI');
  console.log('============================================');
  const txs = await prisma.inventoryTransaction.findMany({
    orderBy: { occurredAt: 'asc' },
    select: { id: true, type: true, bottleCount: true, direction: true, balanceKey: true, occurredAt: true },
  });
  for (const t of txs) {
    console.log(`  ${new Date(t.occurredAt).toISOString().slice(0, 16)}  ${t.type.padEnd(17)} ${t.direction > 0 ? '+' : ''}${t.direction * t.bottleCount}`);
  }
  const bal = await prisma.inventoryBalance.findMany({ include: { worker: { select: { username: true } } } });
  console.log('');
  for (const b of bal) {
    console.log(`  ${(b.worker ? b.worker.username : 'ANBAR').padEnd(10)} ${b.quantity} bidon  ->  0`);
  }

  console.log('');
  console.log('============================================');
  console.log(' QORUNACAQ');
  console.log('============================================');
  const others = await prisma.user.findMany({ where: { id: { not: u.id } }, select: { username: true, role: true } });
  console.log(`  hesablar   : ${others.map((x) => `${x.username} (${x.role})`).join(', ')}`);
  console.log(`  musteriler : ${await prisma.customer.count()}`);
  console.log(`  catdirilma : ${await prisma.delivery.count()}`);
  console.log(`  odenis     : ${await prisma.payment.count()}`);
  console.log(`  borc       : ${await prisma.debtAdjustment.count()}`);
  console.log('');
  console.log('Hesab + butun anbar emaliyyatlari silinir, qaliqlar 0 olur.');
  console.log('Bunun ucun: node remove-worker-and-reset-stock.js ' + username);

  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });