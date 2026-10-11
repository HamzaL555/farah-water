/**
 * Sets the admin account's display name and phone.
 * The test-suite TRUNCATE incident left the admin row holding fixture values
 * ("Test Admin", a random phone), which then show up in the UI and the audit
 * log. This restores sensible values without touching the password hash.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const FULL_NAME = process.argv[2] || 'Farah Su Şirkəti Admin';
const PHONE = process.argv[3] || '+994500000000';

(async () => {
  const admin = await p.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true, username: true, fullName: true, phone: true } });
  if (!admin) { console.error('No admin found.'); process.exit(1); }

  // The phone column is UNIQUE, so free it up first if another row holds it.
  await p.user.updateMany({ where: { phone: PHONE, id: { not: admin.id } }, data: { phone: null } });

  await p.user.update({
    where: { id: admin.id },
    data: { fullName: FULL_NAME, phone: PHONE },
  });

  const after = await p.user.findUnique({ where: { id: admin.id }, select: { username: true, fullName: true, phone: true } });
  console.log('admin profile updated:');
  console.log(`  username: ${after.username}`);
  console.log(`  fullName: ${after.fullName}`);
  console.log(`  phone   : ${after.phone}`);
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
