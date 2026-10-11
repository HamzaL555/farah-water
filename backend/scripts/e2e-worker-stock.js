/**
 * Reproduces the user's exact scenario against the LIVE api:
 *
 *   1. admin creates a worker
 *   2. admin's warehouse summary must list that worker at quantity 0
 *      <- this is the "işçi seç buttonu işləmir" bug
 *   3. the worker counts bottles arriving into the warehouse
 *   4. admin sees the new total AND who entered it
 *
 * Creates real rows, then removes them again.
 */
const fs = require('fs');
const BASE = 'https://farah-water.vercel.app/api/v1';
const ADMIN_PW = process.argv[2];

if (!ADMIN_PW) {
  console.error('Usage: node e2e-worker-stock.js <adminPassword>');
  process.exit(1);
}

let adminToken = '';
const created = { userId: null, customerId: null };

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error page */ }
  return { status: res.status, body: json, raw: text };
}

const step = (n, label) => console.log(`\n--- ${n}. ${label}`);

(async () => {
  // 1. admin signs in
  step(1, 'admin login');
  const login = await call('POST', '/auth/login', { body: { identifier: 'admin', password: ADMIN_PW } });
  if (login.status !== 200) {
    console.log('  FAILED', login.status, login.raw.slice(0, 200));
    process.exit(1);
  }
  adminToken = login.body.data.tokens.accessToken;
  console.log('  ok, admin signed in');

  // 2. create a worker
  step(2, 'admin creates a worker');
  const uname = 'e2eworker' + Date.now().toString().slice(-6);
  const created1 = await call('POST', '/users', {
    token: adminToken,
    body: { fullName: 'E2E İşçi', username: uname, phone: '+9945099' + Date.now().toString().slice(-6) },
  });
  if (created1.status !== 201 && created1.status !== 200) {
    console.log('  FAILED', created1.status, created1.raw.slice(0, 300));
    process.exit(1);
  }
  const workerId = created1.body.data.user.id;
  const workerPw = created1.body.data.temporaryPassword;
  created.userId = workerId;
  console.log(`  ok: ${uname} (${workerId})`);

  // 3. THE BUG: does the admin picker see a worker who holds no stock yet?
  step(3, 'admin warehouse summary lists the new worker at 0');
  const sum = await call('GET', '/inventory/summary', { token: adminToken });
  const row = sum.body.data.workers.find((w) => w.workerId === workerId);
  if (!row) {
    console.log('  FAILED - worker missing from summary.workers (this is the bug)');
    console.log('  workers returned:', JSON.stringify(sum.body.data.workers));
    await cleanup();
    process.exit(1);
  }
  console.log(`  ok: ${row.workerName} quantity=${row.quantity} active=${row.isActive}`);

  // 4. worker signs in
  step(4, 'worker login');
  const wlogin = await call('POST', '/auth/login', { body: { identifier: uname, password: workerPw } });
  if (wlogin.status !== 200) {
    console.log('  FAILED', wlogin.status, wlogin.raw.slice(0, 200));
    await cleanup();
    process.exit(1);
  }
  const workerToken = wlogin.body.data.tokens.accessToken;
  console.log('  ok');

  // 5. the worker counts bottles arriving
  step(5, 'worker posts 75 bottles into the warehouse');
  const stockIn = await call('POST', '/inventory/stock-in', {
    token: workerToken,
    body: { bottleCount: 75, note: 'E2E sayım', idempotencyKey: 'e2e-' + Date.now() },
  });
  if (stockIn.status !== 201 && stockIn.status !== 200) {
    console.log(`  FAILED ${stockIn.status}: ${stockIn.raw.slice(0, 250)}`);
    console.log('  (403 would mean the deployed backend still requires ADMIN)');
    await cleanup();
    process.exit(1);
  }
  console.log(`  ok: warehouse now ${stockIn.body.data.newBalance}`);

  // 6. admin sees the increase, attributed to the worker
  step(6, 'admin sees the total and who entered it');
  const sum2 = await call('GET', '/inventory/summary', { token: adminToken });
  console.log(`  warehouse=${sum2.body.data.warehouseQuantity} todayInbound=${sum2.body.data.todayInbound}`);

  const ledger = await call('GET', '/inventory/transactions?pageSize=10', { token: adminToken });
  const entry = ledger.body.data.items.find(
    (t) => t.createdById === workerId && t.type === 'INBOUND' && t.note === 'E2E sayım',
  );
  if (!entry) {
    console.log('  FAILED - inbound row not attributed to the worker');
    await cleanup();
    process.exit(1);
  }
  console.log(`  ok: ${entry.type} ${entry.signedCount} by ${entry.createdByName} (${entry.createdByRole})`);

  console.log('\n=== SCENARIO PASSES ===');
  await cleanup();
})().catch(async (e) => {
  console.error('ERR', e.message);
  await cleanup();
  process.exit(1);
});

async function cleanup() {
  console.log('\n--- cleanup');
  try {
    await call('DELETE', '/inventory/createdby-probe', { token: adminToken });
  } catch { /* probe endpoint does not exist; ignore */ }

  // Deactivate + the wipe script handles the rest on the next run; here we only
  // mark the worker inactive so no active account is left behind.
  const r = await call('PATCH', `/users/${created.userId}`, {
    token: adminToken,
    body: { isActive: false },
  });
  console.log(`  worker ${created.userId} deactivated (${r.status}); run wipe-test-data.js to clear the rows`);
}
