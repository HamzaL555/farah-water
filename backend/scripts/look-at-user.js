/**
 * Read-only. Shows the current stock position and anything linked to a user.
 *
 * Usage: node look-at-user.js <username>
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const username = process.argv[2] || 'hamza';

(async () => {
  const u = await prisma.user.findUnique({ where: { username } });

  console.log('=== HESAB ===');
  if (!u) {
    console.log(`  "${username}" yoxdur`);
  } else {
    console.log(`  ${u.fullName} (${u.username})  rol=${u.role}  aktiv=${u.isActive}`);
    console.log(`  yaradildi : ${new Date(u.createdAt).toISOString().slice(0, 16)}`);
    console.log(`  son giris : ${u.lastLoginAt ? new Date(u.lastLoginAt).toISOString().slice(0, 16) : '-'}`);
  }

  console.log('\n=== ANBAR QALIQLARI ===');
  const bal = await prisma.inventoryBalance.findMany({
    include: { worker: { select: { username: true, fullName: true } } },
  });
  for (const b of bal) {
    console.log(`  ${(b.worker ? b.worker.username : 'ANBAR').padEnd(10)} ${String(b.quantity).padStart(4)} bidon`);
  }

  console.log('\n=== CATDIRILMALAR ===');
  const dels = await prisma.delivery.findMany({
    include: { customer: { select: { name: true } }, worker: { select: { username: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!dels.length) console.log('  yoxdur');
  for (const d of dels) {
    console.log(
      `  ${new Date(d.createdAt).toISOString().slice(0, 16)}  ${d.customer.name.padEnd(18)}` +
      ` ${String(d.bottleCount).padStart(3)} bidon  ${d.totalAmount} AZN  ${d.status}  isci=${d.worker ? d.worker.username : '-'}`,
    );
  }

  console.log('\n=== ODENISLER ===');
  const pays = await prisma.payment.findMany({
    include: { recordedBy: { select: { username: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!pays.length) console.log('  yoxdur');
  for (const p of pays) {
    console.log(`  ${new Date(p.createdAt).toISOString().slice(0, 16)}  ${String(p.amount).padStart(8)} AZN  qeyd eden=${p.recordedBy.username}`);
  }

  console.log('\n=== MUSTERILER ===');
  const cs = await prisma.customer.findMany();
  if (!cs.length) console.log('  yoxdur');
  for (const c of cs) console.log(`  ${c.name}  ${c.phone || '-'}  aktiv=${c.isActive}`);

  console.log('\n=== ANBAR EMALIYYATLARI ===');
  const txs = await prisma.inventoryTransaction.findMany({
    orderBy: { occurredAt: 'asc' },
    include: { createdBy: { select: { username: true } } },
  });
  for (const t of txs) {
    console.log(
      `  ${new Date(t.occurredAt).toISOString().slice(0, 16)}  ${t.type.padEnd(17)}` +
      ` ${t.direction > 0 ? '+' : ''}${t.direction * t.bottleCount}`.padStart(6) +
      `  yazan=${t.createdBy.username}  ${t.note || ''}`,
    );
  }

  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });