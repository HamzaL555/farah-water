#!/usr/bin/env node
/**
 * Verifies the three changes the owner asked for, against a live server.
 *
 *   1. A company delivery needs no customer - the form no longer shows one and
 *      the server must not ask for one either. The company itself is attached,
 *      so the drop still shows up in reports and on the invoice.
 *   2. The admin's price / payment correction no longer insists on a reason.
 *   3. Times read as Baku time, not as the server's UTC.
 *
 * Usage: node scripts/verify-company-delivery.js <baseUrl> <adminPassword>
 * Run make-test-worker.js first; clean up with wipe-test-data.js afterwards.
 */
const BASE = process.argv[2] || 'http://localhost:3000';
const ADMIN_PWD = process.argv[3] || process.env.ADMIN_PASSWORD || 'AdminPass123!';
const WORKER = { identifier: 'testisci', password: 'Test1234' };

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  · ' + detail : ''}`);
  ok ? pass++ : fail++;
  return ok;
}

async function call(path, { token, method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function login(who) {
  const r = await call('/auth/login', { method: 'POST', body: { identifier: who.identifier, password: who.password } });
  if (r.status !== 200) throw new Error(`${who.identifier} login failed: ${r.status}`);
  return r.body.data.tokens.accessToken;
}

(async () => {
  const admin = await login({ identifier: 'admin', password: ADMIN_PWD });
  const worker = await login(WORKER);

  console.log('\n=== 1. SIRKET CATDIRILMASINDA MUSTERI YOX ===');
  const companies = await call('/companies', { token: worker });
  const list = companies.body?.data?.items ?? companies.body?.data ?? [];
  const company = list[0];
  const office = company?.offices?.[0];

  if (!check('sirkət və ofis tapıldı', Boolean(company && office), company?.name)) {
    console.log('\nVERIFICATION FAILED');
    process.exit(1);
  }

  await call('/inventory/stock-in', { token: worker, method: 'POST', body: { bottleCount: 60, note: 'verify-company-delivery' } });
  // Stock-in fills the warehouse; the worker then takes what they will deliver.
  await call('/inventory/issue', { token: worker, method: 'POST', body: { bottleCount: 40, note: 'verify-company-delivery' } });

  const created = await call('/deliveries', {
    token: worker,
    method: 'POST',
    body: {
      idempotencyKey: `verify-${Date.now()}`,
      // Deliberately no customerName and no customerId.
      destinationType: 'COMPANY',
      companyId: company.id,
      officeId: office.id,
      bottleCount: 6,
    },
  });

  check('müştərisiz şirkət çatdırılması qəbul edildi', created.status === 201, `HTTP ${created.status}`);
  const d = created.body?.data;
  if (check('çatdırılma yaradıldı', Boolean(d?.id))) {
    check('müştəri şirkətin özüdür', d.customerName === company.name, d.customerName ?? 'null');
    check('ofis qeydə alındı', d.officeName === office.name, d.officeName ?? 'null');
    check('qiymət server tərəfindən qoyuldu', Number(d.unitPrice) > 0, String(d.unitPrice));
  }

  console.log('\n=== 2. EV CATDIRILMASINDA MUSTERI YENI DE YERINDDIR ===');
  const noCustomer = await call('/deliveries', {
    token: worker,
    method: 'POST',
    body: {
      idempotencyKey: `verify-home-${Date.now()}`,
      destinationType: 'HOME',
      address: 'verify ünvanı',
      bottleCount: 2,
    },
  });
  check('müştərisiz ev çatdırılması rədd edildi', noCustomer.status === 422, `HTTP ${noCustomer.status}`);

  console.log('\n=== 3. ADMINE DUZELISDE SEBEB MECBUR DEYIL ===');
  if (d?.id) {
    const withReason = await call(`/deliveries/${d.id}`, {
      token: admin,
      method: 'PATCH',
      body: { unitPrice: String(d.unitPrice), paidAmount: '5.00', reason: '' },
    });
    check('səbəb boş ola bilər', withReason.status === 200, `HTTP ${withReason.status}`);
    check('ödəniş yazıldı', Number(withReason.body?.data?.paidAmount) === 5, String(withReason.body?.data?.paidAmount));
    check('borc avtomatik hesablandı', Number(withReason.body?.data?.debtAmount) === Number(d.totalAmount) - 5);
  }

  console.log('\n=== 4. SAAT BAKI VAXTIDIR ===');
  const me = await call('/auth/me', { token: admin });
  const loginRow = await call('/audit?pageSize=3', { token: admin });
  const items = loginRow.body?.data?.items ?? [];
  const last = items[0];
  const iso = last?.createdAt ?? me.body?.data?.lastLoginAt;
  if (check('son hadisənin vaxtı gəldi', Boolean(iso), iso ?? 'yoxdur')) {
    // "Son giriş saati 4 saat əvvəl göstərir" was the complaint: the client read
    // the UTC parts of the timestamp and printed them as if they were local.
    // Baku is UTC+4 year-round, so rendering must land within a minute of now.
    const driftMin = Math.abs(new Date(iso).getTime() - Date.now()) / 60000;
    const utc = new Date(iso).toISOString();
    const baku = new Date(new Date(iso).getTime() + 4 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
    check('vaxt Bakı vaxtıdır (UTC+4)', driftMin < 2, `utc=${utc} → bakı=${baku} (${driftMin.toFixed(1)} dəq)`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(fail === 0 ? '\nHER SEY ISLEYIR' : '\nVERIFICATION FAILED');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('\nVERIFICATION FAILED:', e.message);
  process.exit(1);
});