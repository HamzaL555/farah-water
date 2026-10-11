/**
 * Sets a password for any account by username. Same hashing cost the API uses.
 * Usage: node set-password.js <username> <newPassword>
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();
const [username, password] = process.argv.slice(2);

if (!username || !password) {
  console.error('Usage: node set-password.js <username> <newPassword>');
  process.exit(1);
}

(async () => {
  const user = await prisma.user.findUnique({ where: { username }, select: { id: true, role: true } });
  if (!user) { console.error(`No user "${username}".`); process.exit(1); }

  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  const passwordHash = await bcrypt.hash(password, rounds);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null },
  });

  const ok = await bcrypt.compare(password, passwordHash);
  console.log(`${username} (${user.role}): password set, verified=${ok}`);
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
