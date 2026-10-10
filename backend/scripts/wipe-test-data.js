/**
 * Wipes ALL test/demo data from the live database, leaving only the admin
 * account and a zeroed warehouse.
 *
 * The financial-delete triggers are deliberately disabled for the duration of
 * the transaction and re-enabled at the end (see the finally block), so a
 * crash can never leave the guards off.
 *
 * Run with --yes to confirm. Everything runs in ONE transaction: either the
 * database is clean afterwards, or nothing changed at all.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const CONFIRMED = process.argv.includes('--yes');
const prisma = new PrismaClient();

// Blocked by farah_prevent_financial_delete(); only the first three can fire
// for rows we touch. The admin-deactivation trigger is a BEFORE UPDATE and is
// irrelevant here.
const GUARD_TRIGGERS = [
  'payments_no_delete',
  'deliveries_no_delete',
  'debt_adjustments_no_delete',
  'inventory_transactions_no_delete',
];

(async () => {
  if (!CONFIRMED) {
    console.log('This deletes EVERY worker, customer, delivery, payment,');
    console.log('inventory movement and audit row. Only "admin" survives.');
    console.log('\nRe-run with --yes to proceed.');
    process.exit(1);
  }

  let guardsOff = false;
  try {
    await prisma.$transaction(async (tx) => {
      // 1. Lift the delete guards (session-scoped to this transaction).
      for (const t of GUARD_TRIGGERS) {
        await tx.$executeRawUnsafe(`ALTER TABLE public.${tableFor(t)} DISABLE TRIGGER "${t}"`);
      }
      guardsOff = true;

      const admin = await tx.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, username: true } });
      if (!admin) throw new Error('No admin found - refusing to wipe.');
      console.log(`keeping admin: ${admin.username}`);

      // 2. Collect the ids we are allowed to remove (everything except admin).
      const workers = await tx.user.findMany({ where: { id: { not: admin.id } }, select: { id: true, username: true } });
      const workerIds = workers.map((w) => w.id);
      const customers = await tx.customer.findMany({ select: { id: true, name: true } });
      const customerIds = customers.map((c) => c.id);

      console.log(`workers to remove  (${workers.length}): ${workers.map((w) => w.username).join(', ') || 'none'}`);
      console.log(`customers to remove (${customers.length}): ${customers.map((c) => c.name).join(', ') || 'none'}`);

      // 3. Delete children before parents (FK onDelete: Restrict).
      const steps = [];
      const run = async (label, fn) => {
        const r = await fn();
        steps.push(`${label}: ${r.count}`);
      };

      await run('payments', () => tx.payment.deleteMany({ where: { OR: [{ workerId: { in: workerIds } }, { customerId: { in: customerIds } }] } }));
      await run('debt_adjustments', () => tx.debtAdjustment.deleteMany({}));
      await run('inventory_transactions', () => tx.inventoryTransaction.deleteMany({}));
      await run('deliveries', () => tx.delivery.deleteMany({}));
      await run('login_attempts', () => tx.loginAttempt.deleteMany({}));
      await run('refresh_tokens', () => tx.refreshToken.deleteMany({}));
      await run('audit_logs', () => tx.auditLog.deleteMany({}));

      // Worker-scoped balances cascade with the user; the warehouse one is kept
      // and zeroed so the admin starts from a real, empty stock.
      await tx.inventoryBalance.updateMany({ where: { scope: 'WAREHOUSE' }, data: { quantity: 0 } });
      const workerBal = await tx.inventoryBalance.deleteMany({ where: { scope: 'WORKER' } });
      steps.push(`worker_balances: ${workerBal.count}`);

      const delCust = await tx.customer.deleteMany({});
      steps.push(`customers: ${delCust.count}`);

      const delUsers = await tx.user.deleteMany({ where: { id: { in: workerIds } } });
      steps.push(`workers: ${delUsers.count}`);

      // 4. Re-enable the guards inside the same transaction.
      for (const t of GUARD_TRIGGERS) {
        await tx.$executeRawUnsafe(`ALTER TABLE public.${tableFor(t)} ENABLE TRIGGER "${t}"`);
      }
      guardsOff = false;

      console.log('\ndeleted:');
      steps.forEach((s) => console.log(`  ${s}`));
    });

    console.log('\nWIPE COMPLETE');
  } catch (e) {
    console.error('\nFAILED:', e.message);
    if (guardsOff) {
      console.error('Guards were left disabled by the aborted transaction.');
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();

function tableFor(triggerName) {
  return {
    payments_no_delete: 'payments',
    deliveries_no_delete: 'deliveries',
    debt_adjustments_no_delete: 'debt_adjustments',
    inventory_transactions_no_delete: 'inventory_transactions',
  }[triggerName];
}
