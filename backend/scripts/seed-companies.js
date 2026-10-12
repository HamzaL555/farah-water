/**
 * Seeds the company list and its offices.
 *
 * Idempotent: an office is matched on (company, name), so re-running adds only
 * what is missing and never duplicates or reorders what is already there.
 *
 * Usage: node seed-companies.js
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Evrascon's buildings, in the order the driver should see them.
const EVRASCON_OFFICES = [
  'Baş ofis',
  'Qurd Qapısı',
  'Şıxov',
  'Ağ Şəhər',
  'Park Hill',
  'Həzi Aslanov',
  'Bakmil',
  'Yanar dağ',
  'Seabreeze',
  'Xırdalan',
  'Müşviq',
  'Nasosnu',
  'Nasosnu boru zavodu',
];

const COMPANIES = [
  {
    name: 'Evrascon',
    filteredPrice: '2.50',
    springPrice: '2.50',
    offices: EVRASCON_OFFICES,
  },
];

(async () => {
  for (const c of COMPANIES) {
    const company = await prisma.company.upsert({
      where: { name: c.name },
      create: { name: c.name, filteredPrice: c.filteredPrice, springPrice: c.springPrice },
      // Only fill a missing price. Re-running must not silently change a price
      // the admin has since negotiated.
      update: {
        filteredPrice: c.filteredPrice,
        springPrice: c.springPrice,
        isActive: true,
      },
    });

    let added = 0;
    for (let i = 0; i < c.offices.length; i++) {
      const name = c.offices[i];
      const found = await prisma.office.findUnique({
        where: { companyId_name: { companyId: company.id, name } },
        select: { id: true },
      });
      if (found) {
        await prisma.office.update({ where: { id: found.id }, data: { sortOrder: i, isActive: true } });
      } else {
        await prisma.office.create({ data: { companyId: company.id, name, sortOrder: i } });
        added++;
      }
    }

    const total = await prisma.office.count({ where: { companyId: company.id } });
    console.log(`${c.name}: 1 sirket, ${total} ofis (${added} yeni elave edildi)`);
  }

  console.log('\nbitti.');
  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });