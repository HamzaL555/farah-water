/**
 * Creates a throwaway worker for end-to-end checks.
 *
 * Prints the username and password so the caller can sign in as that worker,
 * which is the only way to test the rules that apply to workers specifically -
 * that a worker cannot set a price, post a payment, or edit a delivery.
 *
 *   node scripts/make-test-worker.js            # create
 *   node scripts/make-test-worker.js --remove   # remove it again
 */
require('dotenv').config();
const { execFileSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const USERNAME = 'testisci';
const PASSWORD = 'Test1234';

(async () => {
  if (process.argv.includes('--remove')) {
    const u = await prisma.user.findUnique({ where: { username: USERNAME } });
    if (!u) {
      console.log(`"${USERNAME}" yoxdur.`);
      await prisma.$disconnect();
      return;
    }
    const dels = await prisma.delivery.count({ where: { workerId: u.id } });
    const pays = await prisma.payment.count({ where: { workerId: u.id } });
    if (dels || pays) {
      console.error(`SILINMIR: ${dels} catdirilma, ${pays} odenis var. Onlari evvel ləğv edin.`);
      await prisma.$disconnect();
      process.exit(1);
    }
    await prisma.user.delete({ where: { id: u.id } });
    console.log(`"${USERNAME}" silindi.`);
    await prisma.$disconnect();
    return;
  }

  const existing = await prisma.user.findUnique({ where: { username: USERNAME } });
  if (existing) {
    console.log(`"${USERNAME}" artiq var. Parol: ${PASSWORD}`);
    await prisma.$disconnect();
    return;
  }

  console.log('Ehtiyat yaradilir...');
  execFileSync('node', ['scripts/backup-data.js', '--keep', '30'], { stdio: 'pipe' });

  // Reuse the real endpoint's logic through the API server so the account is
  // created with the same hashing and rules as any other worker.
  const BASE = process.argv[2] || 'http://localhost:4000/api/v1';
  const PW = process.argv[3] || 'Kenan333';
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: PW }),
  }).then((r) => r.json());
  const token = login?.data?.tokens?.accessToken;
  if (!token) {
    console.error('Admin girisi alinamadi.');
    process.exit(1);
  }

  const res = await fetch(`${BASE}/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      fullName: 'Test İşçi',
      username: USERNAME,
      password: PASSWORD,
    }),
  }).then((r) => r.json());

  if (res?.error) {
    console.error('XETA:', JSON.stringify(res.error));
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`\nYaradildi:  istifadeci : ${USERNAME}`);
  console.log(`            parol      : ${PASSWORD}`);
  console.log(`\nSilmek: node scripts/make-test-worker.js --remove`);
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });