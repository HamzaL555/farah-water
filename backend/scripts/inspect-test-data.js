/** Shows exactly which rows belong to test data, before anything is deleted. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const TEST_USERNAMES = ['test620743', 'test'];
const TEST_CUSTOMER_NAME = 'Test Müştərisi';

(async () => {
  const testUsers = await p.user.findMany({
    where: { OR: [{ username: { contains: 'test', mode: 'insensitive' } }, { fullName: { contains: 'test', mode: 'insensitive' } }] },
    select: { id: true, username: true, fullName: true, role: true, isActive: true },
  });
  console.log('=== TEST USERS ===');
  testUsers.forEach((u) => console.log(`  ${u.username} | ${u.fullName} | ${u.role} | active=${u.isActive} | ${u.id}`));

  const testCustomers = await p.customer.findMany({
    where: { name: { contains: 'test', mode: 'insensitive' } },
    select: { id: true, name: true, phone: true, address: true },
  });
  console.log('\n=== TEST CUSTOMERS ===');
  testCustomers.forEach((c) => console.log(`  ${c.name} | ${c.phone ?? '-'} | ${c.address ?? '-'} | ${c.id}`));

  const customerIds = testCustomers.map((c) => c.id);
  const userIds = testUsers.map((u) => u.id);

  const deliveries = await p.delivery.findMany({
    where: { OR: [{ workerId: { in: userIds } }, { customerId: { in: customerIds } }] },
    select: {
      id: true, workerId: true, customerId: true, address: true,
      bottleCount: true, unitPrice: true, totalAmount: true, paidAmount: true, debtAmount: true,
      status: true, deliveredAt: true, cancelledAt: true,
    },
  });
  console.log(`\n=== TEST DELIVERIES (${deliveries.length}) ===`);
  deliveries.forEach((d) => console.log(
    `  x${d.bottleCount} @ ${d.unitPrice} | total=${d.totalAmount} paid=${d.paidAmount} debt=${d.debtAmount} | ${d.status} | ${d.deliveredAt.toISOString().slice(0, 16)} | cancelled=${d.cancelledAt ? 'yes' : 'no'} | ${d.id}`,
  ));

  const deliveryIds = deliveries.map((d) => d.id);
  const payments = await p.payment.findMany({
    where: { deliveryId: { in: deliveryIds } },
    select: { id: true, deliveryId: true, amount: true, method: true, voidedAt: true, paidAt: true },
  });
  console.log(`\n=== TEST PAYMENTS (${payments.length}) ===`);
  payments.forEach((x) => console.log(`  ${x.amount} | ${x.method} | voided=${x.voidedAt ? 'yes' : 'no'} | ${x.id}`));

  const debtAdj = await p.debtAdjustment.findMany({
    where: { deliveryId: { in: deliveryIds } },
    select: { id: true, deliveryId: true, type: true, amount: true },
  });
  console.log(`\n=== TEST DEBT ADJUSTMENTS (${debtAdj.length}) ===`);
  debtAdj.forEach((x) => console.log(`  ${x.type} ${x.amount} | ${x.id}`));

  const invTx = await p.inventoryTransaction.findMany({
    where: { OR: [{ workerId: { in: userIds } }] },
    select: { id: true, workerId: true, type: true, bottleCount: true, direction: true, balanceKey: true, note: true, deliveryId: true },
  });
  console.log(`\n=== TEST INVENTORY TRANSACTIONS (${invTx.length}) ===`);
  invTx.forEach((x) => console.log(`  ${x.type} | ${x.direction > 0 ? '+' : ''}${x.bottleCount} | key=${x.balanceKey} | ${x.note ?? '-'} | ${x.id}`));

  const balances = await p.inventoryBalance.findMany({ select: { workerId: true, quantity: true } });
  console.log('\n=== ALL INVENTORY BALANCES ===');
  balances.forEach((b) => console.log(`  worker=${b.workerId} qty=${b.quantity}`));

  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
