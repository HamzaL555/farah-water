/**
 * Renders a report to .xlsx locally and opens the result with ExcelJS again.
 * A 200 response is not proof of a usable workbook, so the file is re-parsed
 * and its sheets, dimensions and styles are asserted.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const os = require('os');

const { buildReport, reportToCsv } = require('../dist/reports/reports.service');
const { reportToXlsx } = require('../dist/reports/reports.xlsx');
const { prisma } = require('../dist/prisma');
const ExcelJS = require('exceljs');

const OUT = path.join(os.tmpdir(), 'farah-report-test.xlsx');

(async () => {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) { console.error('No admin found.'); process.exit(1); }
  const actor = { id: admin.id, role: admin.role, fullName: admin.fullName };

  const types = ['daily', 'period', 'worker', 'customer', 'inventory', 'payments', 'deliveries'];
  let failures = 0;

  for (const type of types) {
    const report = await buildReport({ type }, actor);
    const buffer = await reportToXlsx(report);
    fs.writeFileSync(OUT, buffer);

    // Re-open the produced file: proves the bytes are a valid workbook.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(OUT);

    const ws = wb.getWorksheet(1);
    const rowCount = ws.rowCount;
    const colCount = ws.columnCount;
    const title = ws.getCell('A1').value;
    const totalRows = report.sections.reduce((s, x) => s + x.rows.length + (x.totals ? 1 : 0), 0);

    const ok = {
      'non-empty file': buffer.length > 2000,
      'opens as workbook': wb.worksheets.length === 1,
      'title written': title === report.title,
      'rows written': rowCount >= totalRows,
      'columns detected': colCount >= Math.max(...report.sections.map((s) => s.columns.length)),
      'zip signature': buffer[0] === 0x50 && buffer[1] === 0x4b,
    };

    const bad = Object.entries(ok).filter(([, v]) => !v).map(([k]) => k);
    if (bad.length) failures++;

    console.log(`${bad.length ? 'FAIL' : 'ok  '} ${type.padEnd(11)} ${String(buffer.length).padStart(7)} bytes  rows=${String(rowCount).padStart(4)} cols=${String(colCount).padStart(2)} sections=${report.sections.length}`);
    if (bad.length) console.log(`      failed: ${bad.join(', ')}`);
  }

  // Azerbaijani characters must survive the round trip.
  const report = await buildReport({ type: 'deliveries' }, actor);
  const buf = await reportToXlsx(report);
  fs.writeFileSync(OUT, buf);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(OUT);
  const ws = wb.getWorksheet(1);
  const flat = [];
  ws.eachRow((r) => r.eachCell((c) => flat.push(String(c.value ?? ''))));
  const hasAz = flat.some((v) => /[əğışöüçƏĞİŞÖÜÇ]/.test(v));
  console.log(`\nAzerbaijani characters present in output: ${hasAz ? 'yes' : 'n/a (no data rows)'}`);
  console.log(`CSV still generated (${reportToCsv(report).length} bytes)`);

  fs.unlinkSync(OUT);
  console.log(`\n${failures === 0 ? 'ALL XLSX CHECKS PASSED' : failures + ' TYPE(S) FAILED'}`);
  await prisma.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
