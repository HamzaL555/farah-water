/** Shows the login state of every account, especially any lockout. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();

(async () => {
  const users = await p.user.findMany({
    select: {
      id: true, username: true, fullName: true, role: true, isActive: true,
      failedLoginAttempts: true, lockedUntil: true, mustChangePassword: true,
      lastLoginAt: true, passwordHash: true,
    },
    orderBy: { role: 'asc' },
  });

  for (const u of users) {
    const locked = u.lockedUntil && new Date(u.lockedUntil) > new Date();
    console.log('---');
    console.log(`  username : ${u.username}`);
    console.log(`  ad       : ${u.fullName}`);
    console.log(`  rol      : ${u.role}`);
    console.log(`  aktiv    : ${u.isActive}`);
    console.log(`  cəhd     : ${u.failedLoginAttempts}${locked ? '  (BLOKLANIB)' : ''}`);
    if (u.lockedUntil) {
      console.log(`  blok     : ${new Date(u.lockedUntil).toLocaleString('az-AZ')}` +
        (locked ? '  <-- indi blokdadir' : '  <-- keçmişde bloklanıb, keçib'));
    }
    console.log(`  son giriş: ${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('az-AZ') : 'heç'}`);
    console.log(`  sifre dəyişməsi: ${u.mustChangePassword ? 'VACİB' : 'yox'}`);

    // Does the test password still match? That is how we find out whether a
    // verification run overwrote a password the owner actually knows.
    for (const candidate of ['WorkerTest2026', 'Kenan333']) {
      if (await bcrypt.compare(candidate, u.passwordHash)) {
        console.log(`  >>> bu hesabin parolu: "${candidate}"  (test parcasi)`);
      }
    }
  }
  console.log('---');
  console.log('\nQeydiyyat (register) endpoint-i yoxdur - yalniz admin yeni hesab yaradir.');

  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
