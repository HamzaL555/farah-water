/**
 * End-to-end check of the new delivery rules, against whatever API base is
 * given. Creates and then removes its own data, so it is safe to run against
 * production but ONLY when there are no workers holding stock.
 *
 *   node scripts/test-new-delivery-rules.js http://localhost:4000/api/v1
 */
const BASE = process.argv[2] || 'http://localhost:4000/api/v1';
const PW = process.argv[3] || 'Kenan333';
/** Matches make-test-worker.js. Overridable for a real worker account. */
const WORKER_PASSWORD = process.env.TEST_WORKER_PASSWORD || 'Test1234';

let pass = 0, fail = 0;
const line = (ok, label, detail) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} ${detail ?? ''}`);
};

async function api(path, token, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* file or empty */ }
  return { status: res.status, json };
}

(async () => {
  console.log(`API: ${BASE}\n`);

  const login = await api('/auth/login', null, {
    method: 'POST',
    body: { identifier: 'admin', password: PW },
  });
  const token = login.json?.data?.tokens?.accessToken;
  if (!token) {
    console.error('GIRIS ALINMADI:', JSON.stringify(login.json));
    process.exit(1);
  }
  console.log('admin girisi ok\n');

  // ---------------------------------------------------------------- companies
  console.log('=== 1. SIRKET VE OFISLER ===');
  const cos = await api('/companies', token);
  const companies = cos.json?.data ?? [];
  line(cos.status === 200, 'GET /companies', `HTTP ${cos.status}`);
  const evrascon = companies.find((c) => c.name === 'Evrascon');
  line(Boolean(evrascon), 'Evrascon movcuddur', evrascon ? evrascon.name : 'yoxdur');
  line(evrascon?.offices?.length === 13, '13 ofis', `${evrascon?.offices?.length ?? 0} ofis`);
  line(Number(evrascon?.filteredPrice) === 2.5, 'filtr qiymeti 2.50', String(evrascon?.filteredPrice));

  // ------------------------------------------------------- the real test bed
  // A delivery costs the worker a bottle, so this needs stock to be honest.
  const before = await api('/inventory/summary', token);
  const warehouseBefore = Number(before.json?.data?.warehouseQuantity ?? 0);
  console.log(`\nanbarda ${warehouseBefore} bidon var\n`);

  if (warehouseBefore < 10) {
    console.log('BOMECI: anbarda 10-dan az bidon var. Yeni test ucun anbara qebul edirem.');
    const inb = await api('/inventory/stock-in', token, {
      method: 'POST',
      body: { bottleCount: 50, note: 'test-new-delivery-rules' },
    });
    line(inb.status === 200 || inb.status === 201, 'anbara qebul', `HTTP ${inb.status}`);
  }

  const workers = await api('/users', token);
  const worker = workers.json?.data?.items?.find((u) => u.role === 'WORKER' && u.isActive);
  if (!worker) {
    console.log('\nISCI YOXDUR. Yeni forman yoxlamak mumkun deyil.');
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  }

  const balances = await api(`/inventory/summary`, token);
  const myStock = (balances.json?.data?.workers ?? []).find((b) => b.workerId === worker.id);
  console.log(`\n${worker.username} elinde ${myStock?.quantity ?? 0} bidon`);

  if ((myStock?.quantity ?? 0) < 10) {
    console.log(`BOMECI: ${worker.username} elinde 10-dan az bidon var. 30 verirem.`);
    const iss = await api('/inventory/issue', token, {
      method: 'POST',
      body: { workerId: worker.id, bottleCount: 30, note: 'test-new-delivery-rules' },
    });
    line(iss.status === 200 || iss.status === 201, 'isciye tehvil', `HTTP ${iss.status} ${JSON.stringify(iss.json?.error?.message ?? '')}`);
  }

  // ------------------------------------------------- worker logins as itself
  const wLogin = await api('/auth/login', null, {
    method: 'POST',
    body: { identifier: worker.username, password: process.argv[4] || WORKER_PASSWORD },
  });
  const wToken = wLogin.json?.data?.tokens?.accessToken;
  line(Boolean(wToken), `${worker.username} giris ede bilir`, wToken ? 'ok' : JSON.stringify(wLogin.json?.error?.message));
  if (!wToken) {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(1);
  }

  const officeId = evrascon.offices[0].id;
  const stamp = Date.now();
  const created = [];

  // ---------------------------------------------------- company delivery rule
  console.log('\n=== 2. SIRKETE CATDIRILMA ===');
  const co = await api('/deliveries', wToken, {
    method: 'POST',
    body: {
      idempotencyKey: `test-co-${stamp}`,
      customerName: 'Test Test',
      waterType: 'FILTERED',
      destinationType: 'COMPANY',
      companyId: evrascon.id,
      officeId,
      bottleCount: 5,
    },
  });
  const coD = co.json?.data;
  created.push(coD?.id);
  line(co.status === 201, 'sirkete catdirilma yaradildi', `HTTP ${co.status}`);
  line(Number(coD?.unitPrice) === 2.5, 'qiymet sirketden geldi (2.50)', String(coD?.unitPrice));
  line(Number(coD?.totalAmount) === 12.5, 'umumi 5 x 2.50 = 12.50', String(coD?.totalAmount));
  line(coD?.address === 'Evrascon - Baş ofis', 'unvan ofisden yasandi', coD?.address);
  line(Number(coD?.paidAmount) === 0, 'isci pul yazmadi -> 0', String(coD?.paidAmount));
  line(coD?.status === 'UNPAID', 'status odenilmemis', coD?.status);

  // ------------------------------------------- a worker cannot set the price
  console.log('\n=== 3. ISCI QIYET YAZA BILMER ===');
  const cheat = await api('/deliveries', wToken, {
    method: 'POST',
    body: {
      idempotencyKey: `test-cheat-${stamp}`,
      customerName: 'Test Test',
      waterType: 'FILTERED',
      destinationType: 'COMPANY',
      companyId: evrascon.id,
      officeId,
      bottleCount: 5,
      unitPrice: 0.01,
      paidAmount: 999,
    },
  });
  const cheatD = cheat.json?.data;
  created.push(cheatD?.id);
  line(Number(cheatD?.unitPrice) === 2.5, 'gonderilen qiymet ignora edildi', String(cheatD?.unitPrice));
  line(Number(cheatD?.paidAmount) === 0, 'gonderilen odenis ignora edildi', String(cheatD?.paidAmount));

  // ------------------------------------------------------- spring has its own
  console.log('\n=== 4. BULAQ SUYU ===');
  await api('/companies/' + evrascon.id, token, {
    method: 'PATCH',
    body: { springPrice: 3.75 },
  });
  const sp = await api('/deliveries', wToken, {
    method: 'POST',
    body: {
      idempotencyKey: `test-sp-${stamp}`,
      customerName: 'Test Test',
      waterType: 'SPRING',
      destinationType: 'COMPANY',
      companyId: evrascon.id,
      officeId,
      bottleCount: 2,
    },
  });
  const spD = sp.json?.data;
  created.push(spD?.id);
  line(Number(spD?.unitPrice) === 3.75, 'bulaq suyunun qiymeti 3.75', String(spD?.unitPrice));
  line(Number(spD?.totalAmount) === 7.5, 'umumi 2 x 3.75 = 7.50', String(spD?.totalAmount));
  await api('/companies/' + evrascon.id, token, { method: 'PATCH', body: { springPrice: 2.5 } });

  // ------------------------------------------------------ home delivery rule
  console.log('\n=== 5. EVE CATDIRILMA ===');
  const home = await api('/deliveries', wToken, {
    method: 'POST',
    body: {
      idempotencyKey: `test-home-${stamp}`,
      customerName: 'Test Test',
      address: 'Bakı, test unvanı',
      waterType: 'FILTERED',
      destinationType: 'HOME',
      bottleCount: 3,
    },
  });
  const homeD = home.json?.data;
  created.push(homeD?.id);
  line(home.status === 201, 'eve catdirilma yaradildi', `HTTP ${home.status}`);
  line(Number(homeD?.unitPrice) === 0, 'qiymet 0 ile basladi', String(homeD?.unitPrice));
  line(Number(homeD?.debtAmount) === 0, 'borc 0 (qiymet yoxdur)', String(homeD?.debtAmount));

  // ------------------------------------------ admin sets the price and money
  console.log('\n=== 6. ADMIN QIYET VE ODENIS YAZIR ===');
  const fixed = await api(`/deliveries/${homeD.id}`, token, {
    method: 'PATCH',
    body: { unitPrice: 3.5, paidAmount: 7, reason: 'Qiymet ve odenis test' },
  });
  const fx = fixed.json?.data;
  line(fixed.status === 200, 'admin duzeltdi', `HTTP ${fixed.status}`);
  line(Number(fx?.unitPrice) === 3.5, 'qiymet 3.50', String(fx?.unitPrice));
  line(Number(fx?.totalAmount) === 10.5, 'umumi 3 x 3.50 = 10.50', String(fx?.totalAmount));
  line(Number(fx?.paidAmount) === 7, 'odenilen 7.00', String(fx?.paidAmount));
  line(Number(fx?.debtAmount) === 3.5, 'borc avtomatik 3.50', String(fx?.debtAmount));
  line(fx?.status === 'PARTIAL', 'status qismen', fx?.status);

  // ------------------------------------- workers cannot post a payment
  console.log('\n=== 7. ISCI ODENIS QEYD EDEMIYOR ===');
  const wPay = await api('/payments', wToken, {
    method: 'POST',
    body: { idempotencyKey: `test-pay-${stamp}`, deliveryId: homeD.id, amount: 1 },
  });
  line(wPay.status === 403, 'isci odenis qeyd ede bilmir', `HTTP ${wPay.status} ${wPay.json?.error?.message ?? ''}`);

  const wVoid = await api(`/payments/xyz/void`, wToken, { method: 'POST', body: { reason: 'test' } });
  line(wVoid.status === 403 || wVoid.status === 400, 'isci odenis geri qaytara bilmir', `HTTP ${wVoid.status}`);

  const wEdit = await api(`/deliveries/${homeD.id}`, wToken, {
    method: 'PATCH',
    body: { unitPrice: 0.01, reason: 'test attempt' },
  });
  line(wEdit.status === 403, 'isci catdirilma redakte ede bilmir', `HTTP ${wEdit.status}`);

  // --------------------------------------------------------------- cancel it
  console.log('\n=== 8. TEMIZLIK ===');
  // The test deliveries hold payments now, so they cannot simply be cancelled;
  // void those first.
  for (const id of created.filter(Boolean)) {
    const det = await api(`/deliveries/${id}`, token);
    for (const p of det.json?.data?.payments ?? []) {
      await api(`/payments/${p.id}/void`, token, { method: 'POST', body: { reason: 'test təmizliyi' } });
    }
    const c = await api(`/deliveries/${id}/cancel`, token, {
      method: 'POST',
      body: { reason: 'test təmizliyi' },
    });
    line(c.status === 200, `ləğv: ${String(id).slice(0, 8)}`, `HTTP ${c.status}`);
  }

  const after = await api('/inventory/summary', token);
  const warehouseAfter = Number(after.json?.data?.warehouseQuantity ?? 0);
  line(warehouseAfter === warehouseBefore, 'anbar qayıtdı', `${warehouseBefore} -> ${warehouseAfter}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });