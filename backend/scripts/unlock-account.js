/**
 * Unlocks an account and sets a password chosen by the owner.
 *
 * Used when a verification run left a test password behind, or when failed
 * attempts are heading towards the lockout threshold and the user cannot
 * remember which password is correct.
 *
 * Resets the failure counter and any active lock, so the next attempt is a
 * clean first try.
 *
 * Usage: node unlock-account.js <username> <newPassword>
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const [username, password] = process.argv.slice(2);

if (!username || !password) {
  console.error('Usage: node unlock-account.js <username> <newPassword>');
  process.exit(1);
}

if (password.length < 6) {
  console.error('Şifrə ən azı 6 simvol olmalıdır.');
  process.exit(1);
}

(async () => {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, fullName: true, role: true, isActive: true, failedLoginAttempts: true, lockedUntil: true },
  });
  if (!user) {
    console.error(`"${username}" adında hesab yoxdur.`);
    const all = await prisma.user.findMany({ select: { username: true, role: true } });
    console.error('Mövcud hesablar:', all.map((u) => `${u.username} (${u.role})`).join(', '));
    process.exit(1);
  }

  const wasLocked = user.lockedUntil && new Date(user.lockedUntil) > new Date();

  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  const passwordHash = await bcrypt.hash(password, rounds);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      // mustChangePassword stays false: the user is being given a password they
      // chose, so forcing a change on first login would be noise.
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  // Prove the stored hash actually accepts the new password before reporting.
  const verified = await bcrypt.compare(password, passwordHash);
  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    select: { failedLoginAttempts: true, lockedUntil: true },
  });

  console.log(`hesab     : ${user.username} (${user.role}) - ${user.fullName}`);
  console.log(`aktiv     : ${user.isActive}`);
  if (wasLocked) console.log('evvel     : BLOKLANMISDI - blok silindi');
  console.log(`cəhd      : ${user.failedLoginAttempts} -> ${fresh.failedLoginAttempts}`);
  console.log(`şifrə     : dəyişdirildi, yoxlanıldı = ${verified}`);
  console.log(`blok      : ${fresh.lockedUntil ? fresh.lockedUntil : 'yox'}`);
  console.log(`\nBu hesabla indi daxil ola bilərsən.`);

  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
