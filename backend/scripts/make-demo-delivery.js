/**
 * One realistic delivery, for checking a screen by hand.
 *
 * Creates the stock and the company drop the panel needs to render a complete
 * delivery: a real customer, a real office, a price the admin set, and a part
 * payment. Prints the delivery id so a test can open it directly.
 *
 *   node scripts/make-demo-delivery.js [apiBase] [adminPassword]
 */
const BASE = process.argv[2] || 'https://farah-water.vercel.app/api/v1';
const PW = process.argv[3] || 'Kenan333';

let pass = 0, fail = 0;
const line = (ok, label, detail) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(40)} ${detail ?? ''}`);
};

(async () => {
  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: PW }),
  }).then((r) => r.json());
  const token = login?.data?.tokens?.accessToken;
  if (!token) { console.error('Giris alinamadi'); process.exit(1); }

  const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const api = async (p, o) => fetch(`${BASE}${p}`, { ...o, headers: { ...auth, ...(o && o.headers) } })
    .then((r) => r.json().then((j) => ({ status: r.status, body: j })));

  const workers = await api('/users');
  const worker = workers.body?.data?.items?.find((u) => u.role === 'WORKER' && u.isActive);
  if (!worker) { console.error('Aktiv isci yoxdur'); process.exit(1); }

  const summary = await api('/inventory/summary');
  if ((summary.body?.data?.warehouseQuantity ?? 0) < 60) {
    await api('/inventory/stock-in', { method: 'POST', body: JSON.stringify({ bottleCount: 100, note: 'demo' }) });
  }
  const workerStock = (summary.body?.data?.workers ?? []).find((w) => w.workerId === worker.id)?.quantity ?? 0;
  if (workerStock < 40) {
    await api('/inventory/issue', { method: 'POST', body: JSON.stringify({ workerId: worker.id, bottleCount: 40, note: 'demo' }) });
  }

  const wLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: worker.username, password: process.env.TEST_WORKER_PASSWORD || 'Test1234' }),
  }).then((r) => r.json());
  const wToken = wLogin?.data?.tokens?.accessToken;

  const companies = await api('/companies', { headers: { authorization: `Bearer ${wToken}` } });
  const co = companies.body?.data?.[0];
  const office = co?.offices?.find((o) => o.name === 'Ağ Şəhər') ?? co?.offices?.[0];

  const stamp = Date.now();
  const made = await api('/deliveries', {
    method: 'POST',
    headers: { authorization: `Bearer ${wToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      idempotencyKey: `demo-${stamp}`,
      customerName: 'Aysel Məmmədova',
      customerPhone: '+994501234567',
      waterType: 'FILTERED',
      destinationType: 'COMPANY',
      companyId: co.id,
      officeId: office.id,
      bottleCount: 12,
      note: 'Giriş qatı ilə',
    }),
  });
  const d = made.body?.data;
  line(made.status === 201, 'catdirilma yaradildi', `${made.status}`);

  const priced = await api(`/deliveries/${d.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ unitPrice: '2.75', paidAmount: '20.00', reason: 'Nümunə çatdırılma' }),
  });
  line(priced.status === 200, 'qiymet ve odenis yazildi', `${priced.status}`);

  const final = priced.body?.data ?? d;
  console.log('');
  console.log(`  delivery id : ${final.id}`);
  console.log(`  tarix       : ${final.deliveredAt}`);
  console.log(`  unvan       : ${final.address}`);
  console.log(`  bidon       : ${final.bottleCount}`);
  console.log(`  umumi       : ${final.totalAmount} AZN`);
  console.log(`  odenilen    : ${final.paidAmount} AZN`);
  console.log(`  borc        : ${final.debtAmount} AZN`);
  console.log(`  status      : ${final.status}`);
  console.log('');
  console.log(`${pass} passed, ${fail} failed`);
})().catch((e) => { console.error('ERR', e); process.exit(1); });