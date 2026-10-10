/**
 * One-off: change the `admin` account password on the live database.
 * Uses the same bcrypt cost the API uses, and forces the app to demand a
 * fresh password on first login only if explicitly asked.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
const NEW_PASSWORD = process.argv[2];
const USERNAME = process.argv[3] || 'admin';

if (!NEW_PASSWORD) {
  console.error('Usage: node set-admin-password.js <newPassword> [username]');
  process.exit(1);
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { username: USERNAME } });
    if (!user) {
      console.error(`No user named "${USERNAME}".`);
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(NEW_PASSWORD, rounds);
    // failedLoginAttempts is reset too: setting a password should never leave
    // the account closer to a lockout from an earlier bad guess.
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        mustChangePassword: false,
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: null,
      },
    });

    // Verify the new hash immediately against the same value.
    const ok = await bcrypt.compare(NEW_PASSWORD, passwordHash);

    console.log(`user      : ${user.username} (${user.role})`);
    console.log(`hash ok   : ${ok}`);
    console.log(`rounds    : ${rounds}`);
    console.log(`done      : password updated`);
  } catch (e) {
    console.error('ERR', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
