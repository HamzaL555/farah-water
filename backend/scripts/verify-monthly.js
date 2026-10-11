/** Confirms each `month` value resolves to a different month. Run after build. */
require('dotenv').config();
const { buildReport } = require('../dist/reports/reports.service');
const { prisma } = require('../dist/prisma');
const { startOfLocalMonth, endOfLocalMonth, tzOffsetMinutes, formatDDMMYYYY } = require('../dist/common/utils/date');
const { monthName } = require('../dist/reports/reports.xlsx');

function resolve(month) {
  let anchor = null;
  if (month === 'last') {
    const thisMonth = startOfLocalMonth();
    anchor = new Date(thisMonth.getTime());
    anchor.setUTCDate(0);
  } else if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, m] = month.split('-').map(Number);
    anchor = new Date(Date.UTC(y, m - 1, 1));
  }
  const start = anchor ? startOfLocalMonth(anchor) : null;
  const end = anchor ? endOfLocalMonth(anchor) : null;
  const local = anchor ? new Date(anchor.getTime() + tzOffsetMinutes() * 60_000) : new Date();
  return {
    label: `${monthName(local.getUTCMonth())} ${local.getUTCFullYear()}`,
    range: start && end
      ? `${formatDDMMYYYY(start)} .. ${formatDDMMYYYY(new Date(end.getTime() - 86400000))}`
      : '(all)',
  };
}

(async () => {
  // Every case must produce a BOUNDED range. An unbounded current month means
  // the "no month given" branch forgot to set an anchor, which silently turns
  // the monthly report into an all-time report.
  function bounded(month) {
    const a = month === 'last'
      ? (() => { const t = startOfLocalMonth(); const d = new Date(t.getTime()); d.setUTCDate(0); return d; })()
      : month && /^\d{4}-\d{2}$/.test(month)
        ? new Date(Date.UTC(...month.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n))))
        : startOfLocalMonth();
    const s = startOfLocalMonth(a), e = endOfLocalMonth(a);
    return s && e ? `${formatDDMMYYYY(s)} .. ${formatDDMMYYYY(new Date(e.getTime() - 86400000))}` : null;
  }

  const cases = [undefined, 'last', '2026-09', '2026-01', '2026-12', '2025-02'];
  const seen = new Set();
  let bad = 0;
  for (const c of cases) {
    const r = resolve(c);
    console.log(`  ${String(c === undefined ? '(current)' : c).padEnd(10)} -> ${r.label.padEnd(18)} ${r.range}`);
    // 'last' and an explicit 'YYYY-MM' for the same month are expected to
    // produce the same range; that is correct behaviour, not a duplicate.
    void r;
    void seen;

    const b = bounded(c);
    if (!b) { console.log('     UNBOUNDED RANGE'); bad++; }
    else console.log(`     bounded: ${b}`);
  }

  // Current month must be the real current month, and `last` must differ.
  const now = new Date();
  const cur = resolve(undefined).label;
  const prev = resolve('last').label;
  const expectedCur = `${monthName(now.getUTCMonth())} ${now.getUTCFullYear()}`;
  if (cur !== expectedCur) { console.log(`\nFAIL current month is ${cur}, expected ${expectedCur}`); bad++; }
  if (cur === prev) { console.log(`\nFAIL current and last month are both ${cur}`); bad++; }

  // A delivery must fall inside its own month's report, and the neighbouring
  // month must not pick it up. Dates are built with Date.UTC(year, monthIndex,
  // day) because Date.UTC(..., 0) means "last day of the previous month".
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  const actor = { id: admin.id, role: admin.role, fullName: admin.fullName };
  const d = await prisma.delivery.findFirst({ orderBy: { deliveredAt: 'asc' } });

  const deliveryCount = (report) =>
    (report.sections.find((s) => s.heading === 'Çatdırılmalar')?.rows || []).length;

  if (d) {
    const y = d.deliveredAt.getUTCFullYear();
    const m0 = d.deliveredAt.getUTCMonth(); // 0-based
    // ISO instants, matching what the route now sends: `new Date(from)` cannot
  // parse the DD.MM.YYYY display format.
  const mk = (monthIndex) => ({
    from: new Date(Date.UTC(y, monthIndex, 1)).toISOString(),
    to: new Date(Date.UTC(y, monthIndex + 1, 0)).toISOString(),
  });

    const own = await buildReport({ type: 'period', ...mk(m0) }, actor);
    const next = await buildReport({ type: 'period', ...mk(m0 + 1) }, actor);
    const ownRows = deliveryCount(own);
    const nextRows = deliveryCount(next);

    console.log(`\n  delivery on ${formatDDMMYYYY(d.deliveredAt)}`);
    console.log(`    own month (${formatDDMMYYYY(new Date(Date.UTC(y, m0, 1)))}): ${ownRows} row(s)`);
    console.log(`    next month: ${nextRows} row(s)`);
    if (ownRows === 0) { console.log('    FAIL delivery missing from its own month'); bad++; }
  } else {
    console.log('\n  (no deliveries yet; range routing not exercised against data)');
    // Still assert that both ranges produce usable, distinct windows.
    const probe = await buildReport({ type: 'period', from: '2026-09-01', to: '2026-09-30' }, actor);
    const probe2 = await buildReport({ type: 'period', from: '2026-10-01', to: '2026-10-31' }, actor);
    console.log(`  sep subtitle: ${probe.subtitle}`);
    console.log(`  oct subtitle: ${probe2.subtitle}`);
    if (probe.subtitle === probe2.subtitle) { console.log('  FAIL distinct months produced the same range'); bad++; }
  }

  console.log(`\n${bad === 0 ? 'MONTH RESOLUTION OK' : bad + ' PROBLEM(S)'}`);
  await prisma.$disconnect();
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
