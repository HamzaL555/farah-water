/**
 * Removes customers created by the auto-refresh verification runs.
 * Only touches names that match the proof prefixes, so real data is untouched.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const PREFIXES = ['LiveProof', 'WebPanelProof', 'proofcust', 'AutoTest'];

(async () => {
  const all = await p.customer.findMany({ select: { id: true, name: true, _count: { select: { deliveries: true } } } });
  const targets = all.filter((c) => PREFIXES.some((x) => c.name.startsWith(x)));

  if (!targets.length) {
    console.log('Nothing to remove.');
    await p.$disconnect();
    return;
  }

  for (const c of targets) {
    console.log(`  ${c.name.padEnd(18)} deliveries=${c._count.deliveries}`);
  }

  const withHistory = targets.filter((c) => c._count.deliveries > 0);
  if (withHistory.length) {
    console.error('\nRefusing: these have deliveries, so they may be real. ' +
      withHistory.map((c) => c.name).join(', '));
    process.exit(1);
  }

  const r = await p.customer.deleteMany({ where: { id: { in: targets.map((c) => c.id) } } });
  console.log(`\nremoved ${r.count} proof customer(s)`);

  const left = await p.customer.findMany({ select: { name: true } });
  console.log(`customers remaining: ${left.length ? left.map((c) => c.name).join(', ') : 'none'}`);

  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
