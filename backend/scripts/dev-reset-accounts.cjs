/**
 * DEV ONLY: resets the local admin password and (re)creates two test workers.
 * Run with DATABASE_URL pointing at farah_dev. Never run against production.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const url = process.env.DATABASE_URL || '';
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error('Refusing: DATABASE_URL is not local:', url);
  process.exit(1);
}

const p = new PrismaClient();

async function upsertWorker(username, fullName, workerType) {
  const passwordHash = await bcrypt.hash('Test1234', 12);
  const existing = await p.user.findUnique({ where: { username } });
  if (existing) {
    await p.user.update({
      where: { username },
      data: { passwordHash, isActive: true, workerType, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null },
    });
  } else {
    await p.user.create({
      data: {
        username,
        fullName,
        passwordHash,
        role: 'WORKER',
        workerType,
        isActive: true,
        mustChangePassword: false,
      },
    });
  }
}

(async () => {
  // Dev-only admin password so the local panel can be exercised.
  const adminHash = await bcrypt.hash('AdminDev2026!', 12);
  const admin = await p.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) throw new Error('No admin user in this database.');
  await p.user.update({
    where: { id: admin.id },
    data: { passwordHash: adminHash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null },
  });
  console.log('admin -> AdminDev2026!');

  await upsertWorker('anbartest', 'Test Anbardar', 'WAREHOUSE_KEEPER');
  await upsertWorker('aditisci', 'Test Adi İşçi', 'REGULAR');
  console.log('anbartest / aditisci -> Test1234');

  await p.$disconnect();
})().catch(async (e) => {
  console.error('ERR', e.message);
  await p.$disconnect();
  process.exit(1);
});
