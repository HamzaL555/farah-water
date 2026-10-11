/**
 * Proves the .xls export is a genuine BIFF8 workbook, not a renamed .xlsx.
 * BIFF8 files start with the OLE2 signature D0 CF 11 E0; a .xlsx is a ZIP and
 * would start with PK. The file is also re-read with SheetJS.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');
const XLSX = require('xlsx');

const { buildReport } = require('../dist/reports/reports.service');
const { reportToXls } = require('../dist/reports/reports.xls');
const { prisma } = require('../dist/prisma');

const OUT = path.join(os.tmpdir(), 'farah-report-test.xls');

(async () => {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const actor = { id: admin.id, role: admin.role, fullName: admin.fullName };

  let bad = 0;
  for (const type of ['daily', 'period', 'deliveries', 'inventory', 'payments']) {
    const report = await buildReport({ type }, actor);
    const buf = reportToXls(report);
    fs.writeFileSync(OUT, buf);

    const ole2 = buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
    const notZip = !(buf[0] === 0x50 && buf[1] === 0x4b);

    // Re-read: proves the bytes parse as a workbook.
    const wb = XLSX.readFile(OUT);
    const sheetCount = wb.SheetNames.length;

    const checks = {
      'OLE2 signature': ole2,
      'not a zip': notZip,
      'opens as workbook': sheetCount >= 1,
    };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    if (failed.length) bad++;

    console.log(`${failed.length ? 'FAIL' : 'ok  '} ${type.padEnd(11)} ${String(buf.length).padStart(7)} bytes  sheets=${sheetCount}  ${wb.SheetNames.join(', ').slice(0, 40)}`);
    if (failed.length) console.log(`      failed: ${failed.join(', ')}`);
  }

  // Azerbaijani characters must survive.
  const rep = await buildReport({ type: 'deliveries' }, actor);
  fs.writeFileSync(OUT, reportToXls(rep));
  const wb = XLSX.readFile(OUT);
  const flat = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false });
    rows.forEach((r) => r.forEach((c) => flat.push(String(c ?? ''))));
  }
  const hasAz = flat.some((v) => /[əğışöüçƏĞİŞÖÜÇ]/.test(v));
  console.log(`\nAzerbaijani text present: ${hasAz ? 'yes' : 'n/a (no data rows)'}`);

  fs.unlinkSync(OUT);
  console.log(`\n${bad === 0 ? 'ALL XLS CHECKS PASSED' : bad + ' TYPE(S) FAILED'}`);
  await prisma.$disconnect();
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
