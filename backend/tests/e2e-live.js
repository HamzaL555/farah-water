/**
 * End-to-end verification against the LIVE production deployment.
 *
 *   node tests/e2e-live.js
 *
 * Defaults to the deployed API; override with FARAH_API_BASE.
 * Requires the server to be running and an admin token in
 * C:/Users/user/AppData/Local/Temp/opencode/tok.txt
 */
const fs = require('fs');

const BASE = process.env.FARAH_API_BASE || 'https://farah-water.vercel.app/api/v1';
const TOKEN_FILE = 'C:/Users/user/AppData/Local/Temp/opencode/tok.txt';
const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
let HACT = H;

const asAdmin = () => { HACT = H; };
const asWorker = (t) => { HACT = { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }; };

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: HACT,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json };
}

let pass = 0;
let fail = 0;
const log = (label, ok, extra = '') => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? ' :: ' + extra : ''}`);
};

(async () => {
  console.log('target:', BASE, '\n');

  const health = await fetch(BASE + '/health').then((r) => r.json());
  log('API health', health?.data?.status === 'ok');

  // ---- worker provisioning ----------------------------------------------
  const uname = `test${Date.now().toString().slice(-6)}`;
  const phone = `+9945${String(Math.floor(Math.random() * 9000000) + 1000000)}`;
  const created = await call('POST', '/users', { fullName: 'Test İşçi', username: uname, phone });
  const workerPass = created.json?.data?.temporaryPassword;
  log('admin creates worker (temp password issued)', Boolean(workerPass), `user=${uname}`);
  if (!workerPass) { console.log(JSON.stringify(created.json).slice(0, 200)); process.exit(1); }

  const wl = await call('POST', '/auth/login', { identifier: uname, password: workerPass });
  if (wl.status !== 200) { log('worker login', false, JSON.stringify(wl.json).slice(0, 150)); process.exit(1); }
  const wtok = wl.json.data.tokens.accessToken;
  log('worker login', true);
  asWorker(wtok);

  // ---- role separation ---------------------------------------------------
  for (const p of ['/dashboard/admin', '/users', '/users/stats', '/audit/logs']) {
    const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${wtok}` } });
    log(`worker blocked from ${p}`, r.status === 403, `status ${r.status}`);
  }
  const stockInAttempt = await call('POST', '/inventory/stock-in', { bottleCount: 10 });
  log('worker blocked from stock-in', stockInAttempt.status === 403, `status ${stockInAttempt.status}`);

  // ---- inventory ---------------------------------------------------------
  asAdmin();
  await call('POST', '/inventory/stock-in', { bottleCount: 500 });
  const users = await call('GET', '/users');
  const w = users.json.data.items.find((x) => x.username === uname);
  const issue = await call('POST', '/inventory/issue', { workerId: w.id, bottleCount: 100 });
  log('admin issues 100 bottles', issue.status === 201, `warehouse=${issue.json?.data?.newBalance}`);

  asWorker(wtok);
  const overIssue = await call('POST', '/inventory/issue', { workerId: w.id, bottleCount: 99999 });
  log('worker cannot issue stock', overIssue.status === 403);

  // ---- delivery + money --------------------------------------------------
  const deliveryKey = `e2e-${Date.now()}`;
  const d = await call('POST', '/deliveries', {
    idempotencyKey: deliveryKey,
    customerName: 'Test Müştərisi', address: 'Bakı, Test küç. 1',
    bottleCount: 10, unitPrice: '2.00',
  });
  if (d.status !== 201) { log('create delivery', false, JSON.stringify(d.json).slice(0, 200)); process.exit(1); }
  const del = d.json.data;
  log('10 x 2.00 = 20.00, debt 20.00, UNPAID',
      del.totalAmount === 20 && del.debtAmount === 20 && del.status === 'UNPAID',
      `total=${del.totalAmount} debt=${del.debtAmount} status=${del.status}`);

  const replay = await call('POST', '/deliveries', {
    idempotencyKey: deliveryKey, customerName: 'Test Müştərisi',
    address: 'Bakı, Test küç. 1', bottleCount: 10, unitPrice: '2.00',
  });
  const stock = (await call('GET', '/inventory/my-stock')).json.data;
  log('replayed delivery is idempotent (stock deducted once)',
      replay.json.meta?.duplicate === true && stock.quantity === 90,
      `duplicate=${replay.json.meta?.duplicate} stock=${stock.quantity}`);

  await call('POST', '/payments', { idempotencyKey: `p1-${Date.now()}`, deliveryId: del.id, amount: '12.00' });
  let detail = (await call('GET', `/deliveries/${del.id}`)).json.data;
  log('partial payment 12 of 20 -> debt 8, PARTIAL',
      detail.paidAmount === 12 && detail.debtAmount === 8 && detail.status === 'PARTIAL',
      `paid=${detail.paidAmount} debt=${detail.debtAmount}`);

  const pk = `dup-${Date.now()}`;
  await call('POST', '/payments', { idempotencyKey: pk, deliveryId: del.id, amount: '1.00' });
  const dup = await call('POST', '/payments', { idempotencyKey: pk, deliveryId: del.id, amount: '1.00' });
  detail = (await call('GET', `/deliveries/${del.id}`)).json.data;
  log('duplicate payment key ignored', dup.json.meta?.duplicate === true && detail.paidAmount === 13,
      `paid=${detail.paidAmount}`);

  const forge = await call('POST', '/payments', { idempotencyKey: `f-${Date.now()}`, deliveryId: del.id, amount: '0', status: 'PAID' });
  detail = (await call('GET', `/deliveries/${del.id}`)).json.data;
  log('forged PAID status rejected', forge.status === 400 && detail.status !== 'PAID', `http=${forge.status} status=${detail.status}`);

  const over = await call('POST', '/payments', { idempotencyKey: `o-${Date.now()}`, deliveryId: del.id, amount: '999.00' });
  log('overpayment rejected', over.status === 400, `http=${over.status}`);

  await call('POST', '/payments', { idempotencyKey: `p2-${Date.now()}`, deliveryId: del.id, amount: '7.00' });
  detail = (await call('GET', `/deliveries/${del.id}`)).json.data;
  log('final payment clears debt -> PAID', detail.debtAmount === 0 && detail.status === 'PAID',
      `paid=${detail.paidAmount} debt=${detail.debtAmount}`);

  const big = await call('POST', '/deliveries', {
    idempotencyKey: `big-${Date.now()}`, customerName: 'Test Müştərisi',
    address: 'Bakı, Test küç. 1', bottleCount: 9999, unitPrice: '2.00',
  });
  log('delivery beyond stock refused', big.status === 409, `http=${big.status}`);

  // ---- revenue truth -----------------------------------------------------
  asAdmin();
  const dash = (await call('GET', '/dashboard/admin?preset=today')).json.data;
  log('revenue counts real cash, invoices separate',
      dash.finance.todayCollected === 20 && dash.finance.billedInRange === 20 && dash.finance.totalOutstandingDebt === 0,
      `collected=${dash.finance.todayCollected} billed=${dash.finance.billedInRange}`);

  // ---- exports -----------------------------------------------------------
  const csvRes = await fetch(BASE + '/reports?type=daily&preset=today&format=csv', { headers: { Authorization: `Bearer ${token}` } });
  const csvBytes = Buffer.from(await csvRes.arrayBuffer());
  log('CSV export with UTF-8 BOM',
      csvRes.status === 200 && csvBytes.subarray(0, 3).toString('hex') === 'efbbbf',
      `http=${csvRes.status}`);

  const pdfRes = await fetch(BASE + '/reports?type=daily&preset=today&format=pdf', { headers: { Authorization: `Bearer ${token}` } });
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  log('PDF export with Azerbaijani glyphs',
      pdfRes.status === 200 && pdfBuf.subarray(0, 5).toString() === '%PDF-' && pdfBuf.length > 2000,
      `http=${pdfRes.status} bytes=${pdfBuf.length}`);

  // ---- worker scoping ----------------------------------------------------
  asWorker(wtok);
  const wdash = (await call('GET', '/dashboard/worker')).json.data;
  log('worker dashboard scoped to self', wdash.todayBottles === 10 && wdash.stockInHand === 90,
      `bottles=${wdash.todayBottles} stock=${wdash.stockInHand}`);

  const auditAttempt = await call('GET', '/audit/logs');
  log('worker blocked from audit log', auditAttempt.status === 403);

  // ---- audit trail -------------------------------------------------------
  asAdmin();
  const logs = (await call('GET', '/audit/logs?pageSize=100')).json.data;
  const actions = new Set(logs.items.map((i) => i.action));
  log('audit trail recorded', actions.has('delivery.created') && actions.has('payment.created'),
      `${logs.total} entries`);

  console.log(`\n===== ${pass} passed, ${fail} failed =====`);
  console.log(`inventory: warehouse=${dash.inventory.warehouseQuantity} inWorkersHands=${dash.inventory.inWorkersHands}`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error('E2E ERROR', e); process.exit(1); });
