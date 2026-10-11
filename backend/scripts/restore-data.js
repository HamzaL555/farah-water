/**
 * Restores a JSON backup produced by backup-data.js.
 *
 * Deliberately fails if any rows are present unless --force is given: an
 * accidental double-restore would duplicate deliveries and payments, which
 * the database triggers cannot undo.
 *
 * Usage: node restore-data.js --file backups/farah-20261101.json [--force]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const FILE = arg('file');
const FORCE = process.argv.includes('--force');

if (!FILE) {
  console.error('Usage: node restore-data.js --file <backup.json> [--force]');
  process.exit(1);
}

// Children before parents: foreign keys are ON DELETE RESTRICT.
const ORDER = [
  'user', 'appSetting', 'customer', 'inventoryBalance',
  'delivery', 'payment', 'debtAdjustment', 'inventoryTransaction',
  'auditLog', 'loginAttempt', 'refreshToken',
];

(async () => {
  const abs = path.resolve(FILE);
  if (!fs.existsSync(abs)) { console.error(`Fayl tapılmadı: ${abs}`); process.exit(1); }

  const backup = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const tables = backup.tables ?? {};
  console.log(`file   : ${path.basename(abs)}`);
  console.log(`taken  : ${backup.meta?.takenAt ?? 'unknown'}`);
  console.log(`rows   : ${Object.values(tables).reduce((s, r) => s + r.length, 0)}`);

  const existing = {
    user: await prisma.user.count(),
    customer: await prisma.customer.count(),
    delivery: await prisma.delivery.count(),
    payment: await prisma.payment.count(),
  };
  const occupied = Object.values(existing).some((n) => n > 0);

  if (occupied && !FORCE) {
    console.error('\nBAZA BOŞ DEYİL:');
    for (const [k, v] of Object.entries(existing)) console.error(`  ${k}: ${v}`);
    console.error('\nEhtiyatı bərpa etmək mövcud məlumatı SİLƏCƏK.');
    console.error('Əminsən olduqda: --force əlavə et.');
    process.exit(1);
  }

  const counts = [];
  await prisma.$transaction(async (tx) => {
    for (const model of ORDER) {
      const rows = tables[model];
      if (!rows || !rows.length) continue;

      if (occupied) {
        // Clearing needs the guards off: payments/deliveries cannot be deleted.
        await tx.$executeRawUnsafe('ALTER TABLE payments DISABLE TRIGGER payments_no_delete');
        await tx.$executeRawUnsafe('ALTER TABLE deliveries DISABLE TRIGGER deliveries_no_delete');
        await tx.$executeRawUnsafe('ALTER TABLE debt_adjustments DISABLE TRIGGER debt_adjustments_no_delete');
        await tx.$executeRawUnsafe('ALTER TABLE inventory_transactions DISABLE TRIGGER inventory_transactions_no_delete');
      }

      await tx[model].deleteMany({});

      let inserted = 0;
      // Chunked so a large backup does not exceed the transaction timeout.
      for (let i = 0; i < rows.length; i += 500) {
        const slice = rows.slice(i, i + 500);
        const result = await tx[model].createMany({ data: slice, skipDuplicates: true });
        inserted += result.count ?? slice.length;
      }
      counts.push(`${model}: ${inserted}`);

      if (occupied) {
        await tx.$executeRawUnsafe('ALTER TABLE payments ENABLE TRIGGER payments_no_delete');
        await tx.$executeRawUnsafe('ALTER TABLE deliveries ENABLE TRIGGER deliveries_no_delete');
        await tx.$executeRawUnsafe('ALTER TABLE debt_adjustments ENABLE TRIGGER debt_adjustments_no_delete');
        await tx.$executeRawUnsafe('ALTER TABLE inventory_transactions ENABLE TRIGGER inventory_transactions_no_delete');
      }
    }
  });

  console.log('\nbərpa olunanlar:');
  counts.forEach((c) => console.log(`  ${c}`));

  const after = {
    user: await prisma.user.count(),
    customer: await prisma.customer.count(),
    delivery: await prisma.delivery.count(),
    payment: await prisma.payment.count(),
  };
  console.log('\nyekun vəziyyət:');
  for (const [k, v] of Object.entries(after)) console.log(`  ${k}: ${v}`);

  await prisma.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
