/**
 * Checks the warehouse hand-over: the worker runs it, the admin watches.
 *
 *   1. A worker records an inbound into the warehouse.
 *   2. A worker takes stock out into their own hands.
 *   3. An admin can do neither - the warehouse is read-only for them.
 *   4. A worker cannot move stock into someone else's hands, because the
 *      endpoint no longer accepts a workerId at all.
 *
 *   node scripts/verify-warehouse-handover.js [apiBase] [adminPassword]
 */
const BASE = process.argv[2] || 'https://farah-water.vercel.app/api/v1';
const PW = process.argv[3] || 'Kenan333';
const WORKER_PW = process.env.TEST_WORKER_PASSWORD || 'Test1234';

let pass = 0, fail = 0;
const line = (ok, label, detail) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(48)} ${detail ?? ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const post = (p, token, body) =>
    fetch(`${BASE}${p}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json().then((j) => ({ status: r.status, body: j })));

  const get = (p, token) =>
    fetch(`${BASE}${p}`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());

  const adminLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: PW }),
  }).then((r) => r.json());
  const admin = adminLogin?.data?.tokens?.accessToken;
  if (!admin) {
    console.error('Admin girisi alinamadi');
    process.exit(1);
  }

  const users = (await get('/users', admin)).data.items;
  const worker = users.find((u) => u.username === 'testisci')
    ?? (process.env.VERIFY_WORKER ? users.find((u) => u.username === process.env.VERIFY_WORKER) : null);
  if (!worker) {
    console.log('\n  XEBER: test iscisi yoxdur - bu yoxlama kecmedi.');
    console.log('  Yarat:  node scripts/make-test-worker.js <apiBase> <adminParol>');
    console.log(`\n${pass} passed, ${fail} failed (yoxlanmadi)`);
    process.exit(1);
  }

  const wLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: worker.username, password: WORKER_PW }),
  }).then((r) => r.json());
  const wt = wLogin?.data?.tokens?.accessToken;
  if (!wt) {
    console.log(`\n  XEBER: ${worker.username} ile giris alinamadi.`);
    console.log(`\n${pass} passed, ${fail} failed (yoxlanmadi)`);
    process.exit(1);
  }

  const before = (await get('/inventory/summary', admin)).data;

  console.log('=== 1. ISCI ANBARA QEBUL EDIR ===');
  const inbound = await post('/inventory/stock-in', wt, {
    bottleCount: 60,
    note: 'verify-warehouse-handover',
    idempotencyKey: `vwh-in-${Date.now()}`,
  });
  line(inbound.status === 201, 'isci anbara qebul etdi', `HTTP ${inbound.status} · yeni qalıq: ${inbound.body.data?.newBalance}`);

  await wait(1200);
  const afterIn = (await get('/inventory/summary', admin)).data;
  line(
    afterIn.warehouseQuantity === before.warehouseQuantity + 60,
    'admin dərhal görür',
    `${before.warehouseQuantity} → ${afterIn.warehouseQuantity}`,
  );
  const inTx = (await get('/inventory/transactions?pageSize=5', admin)).data.items[0];
  line(inTx?.createdByRole === 'WORKER', 'kim yazdi: işçi', inTx?.createdByName);

  console.log('\n=== 2. ISCI ANBARDAN GOTURUR ===');
  const mineBefore = (afterIn.workers ?? []).find((w) => w.workerId === worker.id)?.quantity ?? 0;
  const take = await post('/inventory/issue', wt, {
    bottleCount: 25,
    note: 'verify-warehouse-handover',
    idempotencyKey: `vwh-take-${Date.now()}`,
  });
  line(take.status === 201, 'isci goturdu', `HTTP ${take.status} · elinde: ${take.body.data?.newBalance}`);

  await wait(1200);
  const afterTake = (await get('/inventory/summary', admin)).data;
  const mineAfter = (afterTake.workers ?? []).find((w) => w.workerId === worker.id)?.quantity ?? 0;
  line(mineAfter === mineBefore + 25, 'biddon iscinin hesabina dusdu', `${mineBefore} → ${mineAfter}`);
  line(
    afterTake.warehouseQuantity === afterIn.warehouseQuantity - 25,
    'anbar azaldi',
    `${afterIn.warehouseQuantity} → ${afterTake.warehouseQuantity}`,
  );

  console.log('\n=== 3. ADMIN YALNIZ BAXIR ===');
  const adminTake = await post('/inventory/issue', admin, {
    bottleCount: 5,
    note: 'admin cəhdi',
    idempotencyKey: `vwh-admin-${Date.now()}`,
  });
  line(adminTake.status === 403, 'admin goture bilmir', `HTTP ${adminTake.status} ${adminTake.body.error?.message ?? ''}`);

  const adminIn = await post('/inventory/stock-in', admin, {
    bottleCount: 5,
    note: 'admin cəhdi',
    idempotencyKey: `vwh-admin-in-${Date.now()}`,
  });
  line(adminIn.status === 403, 'admin qəbul da edə bilmir', `HTTP ${adminIn.status} ${adminIn.body.error?.message ?? ''}`);

  const adminReturn = await post('/inventory/return', admin, {
    workerId: worker.id,
    bottleCount: 5,
    note: 'admin cəhdi',
    idempotencyKey: `vwh-admin-ret-${Date.now()}`,
  });
  line(adminReturn.status === 403, 'admin qaytara bilmir', `HTTP ${adminReturn.status}`);

  const adminWo = await post('/inventory/write-off', admin, {
    type: 'LOSS',
    bottleCount: 5,
    note: 'admin cəhdi',
    idempotencyKey: `vwh-admin-wo-${Date.now()}`,
  });
  line(adminWo.status === 403, 'admin yazb etmə bilmir', `HTTP ${adminWo.status}`);

  console.log('\n=== 4. ISCI BASKISININ HESABINA KECIRE BILMEZ ===');
  const others = users.filter((u) => u.role === 'WORKER' && u.id !== worker.id);
  if (!others.length) {
    console.log('  note  ikinci isci yoxdur - bu addim kecmedi');
  } else {
    const cross = await post('/inventory/issue', wt, {
      workerId: others[0].id,
      bottleCount: 5,
      note: 'baskasinin hesabina',
      idempotencyKey: `vwh-cross-${Date.now()}`,
    });
    const target = (await get('/inventory/summary', admin)).data.workers.find((w) => w.workerId === others[0].id);
    line(cross.status === 201 && target.quantity === 0, 'baskaya bidon dushmedi', `${target?.username ?? '-'}: ${target?.quantity}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('Not: yoxlama nəticələrini qaytarır; təmizlik "wipe-test-data.js" ilə.');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });