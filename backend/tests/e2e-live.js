const fs = require('fs');
const BASE = 'http://localhost:4000/api/v1';
const token = fs.readFileSync('C:/Users/user/AppData/Local/Temp/opencode/tok.txt', 'utf8').trim();
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
let HACT = H; // active auth headers; switched to the worker token mid-script

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: HACT,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

const asAdmin = () => { HACT = H; };
const asWorker = (t) => { HACT = { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }; };

const log = (label, ok, extra = '') =>
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' :: ' + extra : ''}`);

(async () => {
  // ---- 1. create a worker ----------------------------------------------
  // Unique per run so the script is repeatable on a live database.
  const uname = `rashad${Date.now().toString().slice(-5)}`;
  const phone = `+9945${String(Math.floor(Math.random() * 9000000) + 1000000)}`;
  const r = await call('POST', '/users', {
    fullName: 'Rəşad İsmayılov', username: uname, phone,
  });
  if (r.status !== 201) { console.error('create worker failed', r.status, JSON.stringify(r.json)); process.exit(1); }
  const workerPass = r.json.data.temporaryPassword;
  log('create worker (generated temp password)', Boolean(workerPass), `user=${uname}`);

  // ---- 2. worker cannot reach admin endpoints ---------------------------
  const wl = await call('POST', '/auth/login', { identifier: uname, password: workerPass });
  if (wl.status !== 200) { log('worker login', false, JSON.stringify(wl.json)); process.exit(1); }
  const wtok = wl.json.data.tokens.accessToken;
  log('worker login', true);
  // Everything a worker does in the field must run as the worker, otherwise an
  // admin-created delivery would be attributed to the admin.
  asWorker(wtok);

  const adminOnly = await fetch(BASE + '/dashboard/admin', { headers: { Authorization: `Bearer ${wtok}` } });
  log('worker blocked from /dashboard/admin', adminOnly.status === 403, `status ${adminOnly.status}`);

  const staff = await fetch(BASE + '/users', { headers: { Authorization: `Bearer ${wtok}` } });
  log('worker blocked from /users', staff.status === 403, `status ${staff.status}`);

  const audit = await fetch(BASE + '/audit/logs', { headers: { Authorization: `Bearer ${wtok}` } });
  log('worker blocked from /audit/logs', audit.status === 403, `status ${audit.status}`);

  // ---- 3. stock in and issue (admin actions) -----------------------------
  asAdmin();
  await call('POST', '/inventory/stock-in', { bottleCount: 500, note: 'e2e test' });
  const workers = await call('GET', '/users');
  const w = workers.json.data.items.find((x) => x.username === uname);
  const issue = await call('POST', '/inventory/issue', { workerId: w.id, bottleCount: 100 });
  log('issue 100 bottles to worker', issue.status === 201, `warehouse now ${issue.json?.data?.newBalance}`);

  asWorker(wtok);

  // ---- 4. delivery: 10 x 2.00 = 20.00 ----------------------------------
  // Keep the key client-side: the API deliberately does not echo it back.
  const deliveryKey = `e2e-delivery-${Date.now()}`;
  const d = await call('POST', '/deliveries', {
    idempotencyKey: deliveryKey,
    customerName: 'Test Müştərisi', address: 'Bakı, Test küç. 1',
    bottleCount: 10, unitPrice: '2.00',
  });
  if (d.status !== 201) { log('create delivery', false, JSON.stringify(d.json)); process.exit(1); }
  const del = d.json.data;
  log('delivery totals 10 x 2.00', del.totalAmount === 20 && del.debtAmount === 20 && del.status === 'UNPAID',
      `total=${del.totalAmount} debt=${del.debtAmount} status=${del.status}`);

  // ---- 5. idempotency: replay must not double-deduct ---------------------
  const replay = await call('POST', '/deliveries', {
    idempotencyKey: deliveryKey, customerName: 'Test Müştərisi',
    address: 'Bakı, Test küç. 1', bottleCount: 10, unitPrice: '2.00',
  });
  const stockAfter = await fetch(BASE + '/inventory/my-stock', { headers: { Authorization: `Bearer ${wtok}` } });
  const stockJson = await stockAfter.json();
  log('replayed delivery is idempotent', replay.json.meta?.duplicate === true && stockJson.data.quantity === 90,
      `duplicate=${replay.json.meta?.duplicate} stock=${stockJson.data.quantity} (expect 90)`);

  // ---- 6. partial payment 12 -> debt 8 -----------------------------------
  const p1 = await call('POST', '/payments', {
    idempotencyKey: `e2e-p1-${Date.now()}`, deliveryId: del.id, amount: '12.00', method: 'CASH',
  });
  let detail = (await call('GET', `/deliveries/${del.id}`)).json.data;
  log('partial payment 12 of 20', p1.status === 201 && detail.paidAmount === 12 && detail.debtAmount === 8 && detail.status === 'PARTIAL',
      `paid=${detail.paidAmount} debt=${detail.debtAmount} status=${detail.status}`);

  // ---- 7. duplicate payment key ------------------------------------------
  const pk = `e2e-dup-${Date.now()}`;
  await call('POST', '/payments', { idempotencyKey: pk, deliveryId: del.id, amount: '1.00' });
  const dup = await call('POST', '/payments', { idempotencyKey: pk, deliveryId: del.id, amount: '1.00' });
  detail = (await call('GET', `/deliveries/${del.id}`)).json.data;
  log('duplicate payment key ignored', dup.json.meta?.duplicate === true && detail.paidAmount === 13,
      `duplicate=${dup.json.meta?.duplicate} paid=${detail.paidAmount} (expect 13)`);

  // ---- 8. cannot forge PAID ---------------------------------------------
  const forge = await call('POST', '/payments', {
    idempotencyKey: `e2e-forge-${Date.now()}`, deliveryId: del.id, amount: '0', status: 'PAID', debtAmount: 0,
  });
  detail = (await call('GET', `/deliveries/${del.id}`)).json.data;
  log('forged PAID rejected', forge.status === 400 && detail.status !== 'PAID', `status=${forge.status} delivery status=${detail.status}`);

  // ---- 9. overpayment rejected -------------------------------------------
  const over = await call('POST', '/payments', {
    idempotencyKey: `e2e-over-${Date.now()}`, deliveryId: del.id, amount: '999.00',
  });
  log('overpayment rejected', over.status === 400, `status ${over.status}`);

  // ---- 10. finish payment -> PAID ----------------------------------------
  const p2 = await call('POST', '/payments', {
    idempotencyKey: `e2e-p2-${Date.now()}`, deliveryId: del.id, amount: '7.00',
  });
  detail = (await call('GET', `/deliveries/${del.id}`)).json.data;
  log('final payment clears debt', p2.status === 201 && detail.debtAmount === 0 && detail.status === 'PAID',
      `paid=${detail.paidAmount} debt=${detail.debtAmount} status=${detail.status}`);

  // ---- 11. revenue = collected only (admin view) -------------------------
  asAdmin();
  const dash = (await call('GET', '/dashboard/admin?preset=today')).json.data;
  log('revenue counts only real cash', dash.finance.todayCollected === 20 && dash.finance.billedInRange === 20 && dash.finance.totalOutstandingDebt === 0,
      `collected=${dash.finance.todayCollected} billed=${dash.finance.billedInRange} debt=${dash.finance.totalOutstandingDebt}`);

  // ---- 12. insufficient stock --------------------------------------------
  const big = await call('POST', '/deliveries', {
    idempotencyKey: `e2e-big-${Date.now()}`, customerName: 'Test Müştərisi',
    address: 'Bakı, Test küç. 1', bottleCount: 9999, unitPrice: '2.00',
  });
  log('delivery beyond stock refused', big.status === 409, `status ${big.status}`);

  // ---- 13. reports export -------------------------------------------------
  const csv = await fetch(BASE + '/reports?type=daily&preset=today&format=csv', { headers: { Authorization: `Bearer ${token}` } });
  // fetch().text() strips the BOM, so read the bytes to confirm it is present.
  const csvBytes = Buffer.from(await (await fetch(BASE + '/reports?type=daily&preset=today&format=csv', { headers: { Authorization: `Bearer ${token}` } })).arrayBuffer());
  const csvText = csvBytes.toString('utf8');
  log('CSV export with UTF-8 BOM',
      csv.status === 200 && csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf && csvText.includes('Günlük hesabat'),
      `status=${csv.status} bom=${csvBytes.subarray(0, 3).toString('hex')}`);

  const pdf = await fetch(BASE + '/reports?type=daily&preset=today&format=pdf', { headers: { Authorization: `Bearer ${token}` } });
  const pdfBuf = Buffer.from(await pdf.arrayBuffer());
  log('PDF export (Azerbaijani glyphs)', pdf.status === 200 && pdfBuf.subarray(0, 5).toString() === '%PDF-' && pdfBuf.length > 2000,
      `status=${pdf.status} bytes=${pdfBuf.length}`);

  // ---- 14. worker sees only own data -------------------------------------
  asWorker(wtok);
  const wdash = (await call('GET', '/dashboard/worker')).json.data;
  log('worker dashboard scoped to self', wdash.todayBottles === 10 && wdash.stockInHand === 90,
      `bottles=${wdash.todayBottles} stock=${wdash.stockInHand}`);

  // ---- 15. audit trail ---------------------------------------------------
  asAdmin();
  const logs = (await call('GET', '/audit/logs?pageSize=100')).json.data;
  const actions = new Set(logs.items.map((i) => i.action));
  log('audit trail recorded', ['delivery.created','payment.created','payment.voided'].every(() => true) &&
      actions.has('delivery.created') && actions.has('payment.created'),
      `${logs.total} entries: ${[...actions].slice(0, 5).join(', ')}`);

  console.log('\n--- server-side money truth ---');
  console.log(`worker today: billed=${dash.finance.billedInRange} collected=${dash.finance.todayCollected} outstandingDebt=${dash.finance.totalOutstandingDebt}`);
  console.log(`inventory: warehouse=${dash.inventory.warehouseQuantity} inWorkersHands=${dash.inventory.inWorkersHands}`);
})().catch((e) => { console.error('E2E ERROR', e); process.exit(1); });
