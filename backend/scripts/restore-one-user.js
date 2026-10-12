/**
 * Restores a single user account from a backup file.
 *
 * Deliberately narrow. `restore-data.js` replaces the whole database, which is
 * the right tool for "get everything back" and catastrophically wrong for "put
 * one account back" - it would also roll back every delivery recorded since
 * the backup. This touches one row.
 *
 * Usage:
 *   node scripts/restore-one-user.js <backup.json> <username>
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const file = process.argv[2];
const username = process.argv[3];

(async () => {
  if (!file || !username) {
    console.error('Istehsal: node scripts/restore-one-user.js <backup.json> <username>');
    process.exit(1);
  }

  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  const users = backup.tables?.user ?? [];
  const row = users.find((u) => u.username === username);
  if (!row) {
    console.error(`Ehtiyatda "${username}" yoxdur.`);
    console.error('Var olanlar:', users.map((u) => u.username).join(', ') || '(yoxdur)');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`"${username}" artiq movcuddur - heç nə deyismədi.`);
    await prisma.$disconnect();
    return;
  }

  // `put the account back` means the password too, so the owner logs in with
  // what they had before. Never print the hash.
  const created = await prisma.user.create({
    data: {
      id: row.id,
      fullName: row.fullName,
      username: row.username,
      phone: row.phone ?? null,
      email: row.email ?? null,
      passwordHash: row.passwordHash,
      role: row.role,
      isActive: row.isActive,
      mustChangePassword: row.mustChangePassword ?? false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      createdAt: row.createdAt ? new Date(row.createdAt) : new Date(),
    },
  });

  console.log(`berpa edildi: ${created.fullName} (${created.username}, ${created.role})`);
  console.log(`  telefon   : ${created.phone ?? '-'}`);
  console.log(`  e-mail    : ${created.email ?? '-'}`);
  console.log(`  parol     : ehtiyatdakı kimi (oz fesrlerinizle daxil olun)`);

  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });