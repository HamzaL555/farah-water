/**
 * Read-only smoke test against the LIVE API with an EMPTY database.
 * Empty states are where null refs and divide-by-zero live, so this runs
 * right after a wipe and before the app is used for real.
 * It creates nothing.
 */
const BASE = 'https://farah-water.vercel.app/api/v1';

const GETS = [
  ['/auth/me', 'who am I'],
  ['/dashboard/admin', 'admin dashboard'],
  ['/dashboard/revenue', 'revenue dashboard'],
  ['/customers', 'customer list'],
  ['/customers?pageSize=5', 'customer paged'],
  ['/deliveries', 'delivery list'],
  ['/deliveries?pageSize=5', 'delivery paged'],
  ['/debts', 'debt list'],
  ['/payments', 'payment list'],
  ['/users', 'worker list'],
  ['/inventory/summary', 'warehouse summary'],
  ['/inventory/my-stock', 'worker stock'],
  ['/inventory/transactions', 'inventory history'],
  ['/reports?type=daily', 'report daily'],
  ['/reports?type=period&from=2026-10-01&to=2026-10-31', 'report period'],
  ['/reports?type=worker', 'report worker'],
  ['/reports?type=customer', 'report customer'],
  ['/reports?type=inventory', 'report inventory'],
  ['/reports?type=payments', 'report payments'],
  ['/reports?type=deliveries', 'report deliveries'],
  ['/audit/logs?pageSize=5', 'audit log'],
  ['/audit/settings', 'audit settings'],
];

(async () => {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: process.argv[2] || '' }),
  });
  const lb = await login.json().catch(() => ({}));
  const token = lb?.data?.tokens?.accessToken;
  if (!token) {
    console.log(`LOGIN FAILED (${login.status}) - pass the password as argv[2]`);
    process.exit(1);
  }
  console.log('login: OK\n');

  let pass = 0;
  let fail = 0;

  for (const [path, label] of GETS) {
    const res = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
    let note = '';
    if (res.ok) {
      const body = await res.json().catch(() => null);
      // Flag the classic empty-state smells.
      const json = JSON.stringify(body);
      if (/NaN|Infinity|undefined/.test(json)) note = '  <-- contains NaN/Infinity/undefined';
      if (body === null) note = '  <-- unparseable body';
      pass++;
      console.log(`  PASS  ${String(res.status)}  ${label.padEnd(28)} ${path}${note}`);
    } else {
      fail++;
      const t = await res.text().catch(() => '');
      console.log(`  FAIL  ${String(res.status)}  ${label.padEnd(28)} ${path}`);
      console.log(`        ${t.slice(0, 220)}`);
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
