/**
 * Deletes one worker account by username, but only when it holds no history.
 * A worker with deliveries, payments or stock rows is refused: those rows are
 * financial records and must not disappear with the account.
 *
 * Usage: node delete-worker.js <username>
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const username = process.argv[2];
if (!username) {
  console.error('Usage: node delete-worker.js <username>');
  process.exit(1);
}

(async () => {
  const u = await p.user.findUnique({
    where: { username },
    select: {
      id: true, username: true, role: true, fullName: true,
      _count: { select: { deliveries: true, inventoryTx: true } },
    },
  });
  if (!u) { console.log(`No user "${username}". Nothing to do.`); await p.$disconnect(); return; }
  if (u.role === 'ADMIN') { console.error('Refusing to delete an ADMIN account.'); process.exit(1); }

  const balance = await p.inventoryBalance.findUnique({
    where: { workerId: u.id },
    select: { quantity: true },
  });
  const payments = await p.payment.count({ where: { workerId: u.id } });

  console.log(`user        : ${u.username} (${u.fullName})`);
  console.log(`deliveries  : ${u._count.deliveries}`);
  console.log(`payments    : ${payments}`);
  console.log(`stock rows  : ${u._count.inventoryTx}`);
  console.log(`balance     : ${balance ? balance.quantity : 'none'}`);

  const blockers = [];
  if (u._count.deliveries > 0) blockers.push('deliveries');
  if (payments > 0) blockers.push('payments');
  if (balance && balance.quantity !== 0) blockers.push('a non-zero stock balance');

  if (blockers.length) {
    console.error(`\nRefusing: ${blockers.join(', ')}. Financial history would be lost.`);
    console.error('Deactivate the account instead: PATCH /users/:id { isActive: false }');
    process.exit(1);
  }

  // Refresh tokens and login attempts are session data, not financial records.
  await p.refreshToken.deleteMany({ where: { userId: u.id } });
  await p.loginAttempt.deleteMany({ where: { identifier: username } });
  await p.auditLog.deleteMany({ where: { actorId: u.id } });
  await p.user.delete({ where: { id: u.id } });

  console.log('\ndeleted cleanly (no financial rows existed)');
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
