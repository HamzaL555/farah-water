/** Lists exactly what a wipe would remove, before anything is deleted. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const admin = await p.user.findFirst({ where: { role: 'ADMIN' } });

  const workers = await p.user.findMany({
    where: { id: { not: admin.id } },
    select: { id: true, username: true, fullName: true, isActive: true, _count: { select: { deliveries: true } } },
  });
  const customers = await p.customer.findMany({
    select: { id: true, name: true, phone: true, address: true, _count: { select: { deliveries: true } } },
  });
  const deliveries = await p.delivery.findMany({
    select: { id: true, bottleCount: true, totalAmount: true, status: true, deliveredAt: true, customer: { select: { name: true } } },
  });
  const payments = await p.payment.count();
  const invTx = await p.inventoryTransaction.count();

  console.log('============================================');
  console.log(' SILINECEKLER');
  console.log('============================================');

  console.log(`\n[1] ISCILER (${workers.length})`);
  if (!workers.length) console.log('    yoxdur');
  workers.forEach((w) => console.log(`    - ${w.fullName} (${w.username}) · ${w._count.deliveries} çatdırılma`));

  console.log(`\n[2] MUSTERILER (${customers.length})`);
  if (!customers.length) console.log('    yoxdur');
  customers.forEach((c) => console.log(`    - ${c.name} · ${c.phone || 'telefon yoxdur'} · ${c.address} · ${c._count.deliveries} çatdırılma`));

  console.log(`\n[3] CATDIRILMALAR (${deliveries.length})`);
  if (!deliveries.length) console.log('    yoxdur');
  deliveries.forEach((d) => console.log(`    - ${d.customer.name} · ${d.bottleCount} bidon · ${d.totalAmount} AZN · ${d.status}`));

  console.log(`\n[4] ODEMISLER (${payments})`);
  console.log(`\n[5] ANBAR EMELIYATLARI (${invTx})`);

  const balances = await p.inventoryBalance.findMany({ include: { worker: { select: { username: true } } } });
  console.log(`\n[6] BIDON QALIGI`);
  balances.forEach((b) => console.log(`    - ${b.worker ? b.worker.username : 'ANBAR'}: ${b.quantity} bidon`));

  const audit = await p.auditLog.count();
  console.log(`\n[7] AUDIT JURNALI (${audit} sətir)`);

  console.log('\n============================================');
  console.log(' QORUNACAQ (silinməyəcək)');
  console.log('============================================');
  console.log(`  ✔ admin hesabı: ${admin.username} — parol dəyişməyəcək`);
  console.log(`  ✔ sistem parametrləri (şirkət adı, valyuta, qiymət)`);

  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
