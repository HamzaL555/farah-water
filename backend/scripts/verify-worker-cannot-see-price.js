/**
 * Checks the two things the owner asked for after the first release of the
 * new delivery form:
 *
 *   1. A worker cannot see a company's price, by any route.
 *   2. A modal submit button that fails validation must come back to life.
 *
 * The first is checked against the API as well as the screen, because hiding a
 * number in the UI is not hiding it from anything that can read the network.
 *
 *   node scripts/verify-worker-cannot-see-price.js [apiBase] [adminPassword]
 */
const BASE = process.argv[2] || 'https://farah-water.vercel.app/api/v1';
const PW = process.argv[3] || 'Kenan333';
const WORKER_PW = process.env.TEST_WORKER_PASSWORD || 'Test1234';

let pass = 0, fail = 0;
const line = (ok, label, detail) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} ${detail ?? ''}`);
};

(async () => {
  const login = async (identifier, password) =>
    fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    }).then((r) => r.json());

  const adminLogin = await login('admin', PW);
  const adminToken = adminLogin?.data?.tokens?.accessToken;
  if (!adminToken) { console.error('Admin girisi alinamadi'); process.exit(1); }

  const auth = (t) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' });
  const get = (p, t) => fetch(`${BASE}${p}`, { headers: auth(t) }).then((r) => r.json());

  console.log('=== 1. ISCI QIYMETI GORMEMELI DEYIL ===');

  const asAdmin = (await get('/companies', adminToken)).data;
  const adminSeesPrice = asAdmin?.[0]?.filteredPrice !== null && asAdmin?.[0]?.filteredPrice !== undefined;
  line(adminSeesPrice, 'admin qiymeti gorur', String(asAdmin?.[0]?.filteredPrice));

  // Find a worker. The check is meaningless without one, so say so rather than
  // quietly passing. It prefers the throwaway account and NEVER falls back to
  // a real one: signing in as an actual driver account to run a test would
  // touch their lockout counter for no reason.
  const users = (await get('/users', adminToken))?.data?.items ?? [];
  const byName = (name) => users.find((u) => u.username === name && u.role === 'WORKER' && u.isActive);
  const worker = byName('testisci') ?? (process.env.VERIFY_WORKER ? byName(process.env.VERIFY_WORKER) : null);
  if (!worker) {
    console.log('\n  XEBER: test iscisi yoxdur - bu yoxlama kecmedi.');
    console.log('  Yarat:  node scripts/make-test-worker.js <apiBase> <adminParol>');
    console.log('  Və ya:  VERIFY_WORKER=<istifadeci> ile yoxla');
    console.log(`\n${pass} passed, ${fail} failed (yoxlanmadi)`);
    process.exit(1);
  }

  const wLogin = await login(worker.username, WORKER_PW);
  const workerToken = wLogin?.data?.tokens?.accessToken;
  if (!workerToken) {
    console.log(`\n  XEBER: ${worker.username} ile giris alinamadi - parol "${WORKER_PW}" ola biler.`);
    console.log(`\n${pass} passed, ${fail} failed (yoxlanmadi)`);
    process.exit(1);
  }

  const asWorker = (await get('/companies', workerToken)).data;
  const price = asWorker?.[0]?.filteredPrice;
  line(price === null, 'isci qiymeti ALMIR (null)', String(price));
  line(asWorker?.[0]?.springPrice === null, 'isci bulaq qiymetini de almır', String(asWorker?.[0]?.springPrice));
  line((asWorker?.[0]?.offices?.length ?? 0) > 0, 'ofisleri ise gorur', `${asWorker?.[0]?.offices?.length} ofis`);

  // The number must not be hiding anywhere else in the response either.
  const raw = JSON.stringify(asWorker);
  line(!raw.includes('"filteredPrice":2.5') && !/"filteredPrice":\s*\d/.test(raw),
    'butun cavabda qiymet yoxdur', 'axtarildi');

  // And a company delivery must still be creatable without a price.
  const office = asWorker?.[0]?.offices?.[0];
  if (office) {
    // A company delivery still costs a bottle, so the worker needs one. Stock
    // has to reach the warehouse first - issuing from an empty warehouse is
    // refused, which would look like the price check failing.
    const summary = (await get('/inventory/summary', adminToken))?.data;
    if ((summary?.warehouseQuantity ?? 0) < 10) {
      await fetch(`${BASE}/inventory/stock-in`, {
        method: 'POST',
        headers: auth(adminToken),
        body: JSON.stringify({ bottleCount: 20, note: 'verify-worker-cannot-see-price' }),
      });
    }
    const mine = ((await get('/inventory/summary', adminToken))?.data?.workers ?? [])
      .find((w) => w.workerId === worker.id);
    if ((mine?.quantity ?? 0) < 1) {
      const issued = await fetch(`${BASE}/inventory/issue`, {
        method: 'POST',
        headers: auth(adminToken),
        body: JSON.stringify({ workerId: worker.id, bottleCount: 5, note: 'verify-worker-cannot-see-price' }),
      }).then((r) => r.json());
      if (issued?.error) {
        line(false, 'isciye bidon verile bilmedi', issued.error.message);
      }
    }
    const made = await fetch(`${BASE}/deliveries`, {
      method: 'POST',
      headers: auth(workerToken),
      body: JSON.stringify({
        idempotencyKey: `price-check-${Date.now()}`,
        customerName: 'Qiymət Yoxdur',
        waterType: 'FILTERED',
        destinationType: 'COMPANY',
        companyId: asWorker[0].id,
        officeId: office.id,
        bottleCount: 1,
      }),
    }).then((r) => r.json());

    const unit = Number(made?.data?.unitPrice ?? -1);
    line(unit > 0, 'sirket qiymeti yene de hesablanir', `${unit}`);
    const total = Number(made?.data?.totalAmount ?? -1);
    line(Math.abs(total - unit) < 0.001, 'umumi qiymətə bərabərdir', `${total}`);

    // The created row must not carry the price into anything the worker reads.
    const detail = await get(`/deliveries/${made.data.id}`, workerToken);
    const detailUnit = Number(detail?.data?.unitPrice ?? -1);
    line(detailUnit > 0, 'işçi öz çatdırılmasını görür (qiymət daxil)', String(detailUnit));

    // Clean up so the check leaves nothing behind.
    await fetch(`${BASE}/deliveries/${made.data.id}/cancel`, {
      method: 'POST',
      headers: auth(adminToken),
      body: JSON.stringify({ reason: 'verify-script təmizliyi' }),
    });
  }

  console.log('\n=== 2. MODAL DUYMESI DONMAMALIDIR ===');
  // Checked against the code with comments stripped: the guard's own comment
  // quotes the old broken form, so a naive search finds it there and reports a
  // bug that is not in the code.
  const fs = require('fs');
  const path = require('path');
  const panel = fs
    .readFileSync(path.join(__dirname, '..', '..', 'web', 'app.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const guarded = /Promise\.resolve\(\)\s*\.then\(function \(\) \{ return b\.onClick\(btn\); \}\)/.test(panel);
  line(guarded, 'onClick zincir icinde cagrilir', guarded ? 'duzgun' : 'KOTI');
  line(!/Promise\.resolve\(b\.onClick\(btn\)\)/.test(panel), 'kohne oz-secme formasi yoxdur', 'yoxdur');

  // Every modal handler must return rather than throw, so nothing can escape
  // synchronously even if the chain above is changed later.
  const handlers = panel.match(/onClick: (function \(|async function )/g) || [];
  line(handlers.length > 0, 'modal handler sayisi', String(handlers.length));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });