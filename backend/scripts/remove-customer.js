/**
 * Removes one customer's data, leaving every other account untouched.
 *
 * Unlike wipe-test-data.js this is targeted: the worker, their stock and the
 * warehouse all stay exactly as they are. Only the named customer's deliveries,
 * payments, debt adjustments, inventory movements and audit trail go.
 *
 * A backup is written first, because deleting financial rows cannot be undone -
 * the database blocks DELETE on those tables precisely because history matters.
 *
 * Usage: node remove-customer.js <customerName>
 */
require('dotenv').config();
const { execFileSync } = require('child_process');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const name = process.argv[2];

if (!name) {
  console.error('Usage: node remove-customer.js <customerName>');
  process.exit(1);
}

const GUARD_TRIGGERS = {
  payments_no_delete: 'payments',
  deliveries_no_delete: 'deliveries',
  debt_adjustments_no_delete: 'debt_adjustments',
  inventory_transactions_no_delete: 'inventory_transactions',
};

(async () => {
  const customer = await prisma.customer.findFirst({
    where: { name: { contains: name, mode: 'insensitive' } },
    select: { id: true, name: true, phone: true, address: true },
  });

  if (!customer) {
    const all = await prisma.customer.findMany({ select: { name: true } });
    console.error(`"${name}" adında müştəri yoxdur. Mövcud: ${all.map((c) => c.name).join(', ') || '(yoxdur)'}`);
    process.exit(1);
  }

  const deliveries = await prisma.delivery.findMany({
    where: { customerId: customer.id },
    select: { id: true, bottleCount: true, totalAmount: true, worker: { select: { fullName: true } } },
  });
  const deliveryIds = deliveries.map((d) => d.id);
  const payments = await prisma.payment.count({ where: { customerId: customer.id } });
  const adjustments = await prisma.debtAdjustment.count({ where: { deliveryId: { in: deliveryIds } } });
  const invTx = await prisma.inventoryTransaction.count({
    where: { deliveryId: { in: deliveryIds } },
  });
  const audit = await prisma.auditLog.count({
    where: { OR: [{ entityId: { in: deliveryIds } }, { entityId: customer.id }] },
  });

  console.log('============================================');
  console.log(` SILINECEK: ${customer.name}`);
  console.log('============================================');
  console.log(`  telefon   : ${customer.phone || '-'}`);
  console.log(`  ünvan     : ${customer.address || '-'}`);
  console.log(`  çatdırılma: ${deliveries.length}`);
  deliveries.forEach((d) => console.log(`     - ${d.worker.fullName}: ${d.bottleCount} bidon, ${d.totalAmount} AZN`));
  console.log(`  ödəniş    : ${payments}`);
  console.log(`  borc düzəlişi: ${adjustments}`);
  console.log(`  anbar əməliyyatı: ${invTx}`);
  console.log(`  audit sətri: ${audit}`);
  console.log('');

  // A backup must exist before any financial row is removed.
  console.log('Ehtiyat yaradılır...');
  execFileSync('node', ['scripts/backup-data.js', '--keep', '30'], { stdio: 'pipe' });
  console.log('  ehtiyat hazırdır\n');

  const steps = [];
  await prisma.$transaction(async (tx) => {
    for (const t of Object.keys(GUARD_TRIGGERS)) {
      await tx.$executeRawUnsafe(`ALTER TABLE ${GUARD_TRIGGERS[t]} DISABLE TRIGGER "${t}"`);
    }

    const run = async (label, fn) => {
      const r = await fn();
      steps.push(`${label}: ${r.count}`);
      return r;
    };

    await run('ödənişlər', () => tx.payment.deleteMany({ where: { customerId: customer.id } }));
    await run('borc düzəlişləri', () => tx.debtAdjustment.deleteMany({ where: { deliveryId: { in: deliveryIds } } }));
    await run('anbar əməliyyatları', () => tx.inventoryTransaction.deleteMany({ where: { deliveryId: { in: deliveryIds } } }));
    await run('çatdırılmalar', () => tx.delivery.deleteMany({ where: { customerId: customer.id } }));
    await run('audit sətirləri', () => tx.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: deliveryIds } }, { entityId: customer.id }] },
    }));
    await run('müştəri', () => tx.customer.deleteMany({ where: { id: customer.id } }));

    for (const t of Object.keys(GUARD_TRIGGERS)) {
      await tx.$executeRawUnsafe(`ALTER TABLE ${GUARD_TRIGGERS[t]} ENABLE TRIGGER "${t}"`);
    }
  });

  console.log('silinenlər:');
  steps.forEach((s) => console.log(`  ${s}`));

  console.log('\nqalanlar:');
  const users = await prisma.user.findMany({ select: { username: true, role: true } });
  console.log(`  hesablar   : ${users.map((u) => `${u.username} (${u.role})`).join(', ')}`);
  const cLeft = await prisma.customer.count();
  console.log(`  müştərilər : ${cLeft}`);
  const dLeft = await prisma.delivery.count();
  console.log(`  çatdırılma : ${dLeft}`);
  const bal = await prisma.inventoryBalance.findMany({ include: { worker: { select: { username: true } } } });
  bal.forEach((b) => console.log(`  bidon      : ${b.worker ? b.worker.username : 'ANBAR'} = ${b.quantity}`));

  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
