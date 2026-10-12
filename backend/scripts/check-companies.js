/** Read-only check that the company/offices data landed correctly. */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  const rows = await prisma.company.findMany({
    include: { offices: { orderBy: { sortOrder: 'asc' } } },
  });
  console.log(`sirket sayi: ${rows.length}`);
  for (const c of rows) {
    console.log(`\n${c.name}`);
    console.log(`  filtr suyu : ${c.filteredPrice.toFixed(2)} AZN`);
    console.log(`  bulaq suyu : ${c.springPrice.toFixed(2)} AZN`);
    console.log(`  ofis sayi  : ${c.offices.length}`);
    c.offices.forEach((o, i) => console.log(`    ${String(i + 1).padStart(2)}. ${o.name}`));
  }
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });