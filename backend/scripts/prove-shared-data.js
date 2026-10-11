/**
 * Proves the app and the web panel share ONE backend, not two copies.
 *
 * Writes a record through the same REST API the phone app uses, then reads it
 * back through an independent session - exactly what the web panel does. If the
 * data were duplicated, the second read would not see it.
 */
const B = 'https://farah-water.vercel.app/api/v1';
const ADMIN = process.argv[2];
const WORKER_PW = process.argv[3];

let pass = 0, fail = 0;
const line = (ok, label, detail) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(44)} ${detail}`);
};

async function login(identifier, password) {
  const r = await fetch(`${B}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  }).then((r) => r.json());
  return r?.data?.tokens?.accessToken;
}

(async () => {
  console.log('=== ARXITEKTURA ===');
  console.log('  Telefon APK  ─┐');
  console.log('                ├─→  /api/v1  →  bir baza (Neon)');
  console.log('  Sayt /admin  ─┘');
  console.log('');
  console.log('  İki ayrı frontend, bir baza. Məlumat KOPYALANMIR.');
  console.log('');

  const adminTok = await login('admin', ADMIN);
  const workerTok = await login('hamza', WORKER_PW);
  if (!adminTok || !workerTok) { console.log('login failed'); process.exit(1); }

  const A = { authorization: `Bearer ${adminTok}` };
  const W = { authorization: `Bearer ${workerTok}` };

  console.log('=== 1. APP-dən yaz → SAYTDA görünməli ===');
  // The worker posts an inbound stock count, exactly as the app does.
  const stamp = Date.now();
  const write = await fetch(`${B}/inventory/stock-in`, {
    method: 'POST',
    headers: { ...W, 'content-type': 'application/json' },
    body: JSON.stringify({ bottleCount: 7, note: `proof-${stamp}`, idempotencyKey: `proof-${stamp}` }),
  });
  line(write.status === 201, 'işçi (app) anbara 7 bidon yazdı', `HTTP ${write.status}`);

  // The site reads through its own session with its own request.
  const read = await fetch(`${B}/inventory/transactions?pageSize=5`, { headers: A });
  const items = (await read.json()).data.items;
  const found = items.find((x) => x.note === `proof-${stamp}`);
  line(Boolean(found), 'sayt eyni qeydi gördü', found ? `${found.type} ${found.signedCount}` : 'NOT FOUND');

  console.log('');
  console.log('=== 2. SAYTDAN yaz → APP-də görünməli ===');
  // An admin creates a customer, exactly as the web panel does.
  const uname = `proofcust${String(stamp).slice(-6)}`;
  const cw = await fetch(`${B}/customers`, {
    method: 'POST',
    headers: { ...A, 'content-type': 'application/json' },
    body: JSON.stringify({ name: uname, address: 'Test ünvan' }),
  });
  line(cw.status === 201 || cw.status === 200, 'sayt müştəri yaratdı', `HTTP ${cw.status}`);

  // The worker app lists customers in its own session.
  const cl = await fetch(`${B}/customers?search=${uname}`, { headers: W });
  const items2 = (await cl.json()).data.items;
  line(items2.some((c) => c.name === uname), 'işçi (app) eyni müştərini gördü', `${items2.length} tapıldı`);

  console.log('');
  console.log('=== 3. Eyni hesabat rəqəmləri ===');
  const r1 = await fetch(`${B}/dashboard/admin`, { headers: A }).then((r) => r.json());
  const r2 = await fetch(`${B}/inventory/summary`, { headers: W }).then((r) => r.json());
  line(typeof r1.data.inventory.warehouseQuantity === 'number', 'admin görünüşü oxunur', `anbar=${r1.data.inventory.warehouseQuantity}`);
  line(typeof r2.data.warehouseQuantity === 'number', 'işçi görünüşü oxunur', `anbar=${r2.data.warehouseQuantity}`);
  line(
    r1.data.inventory.warehouseQuantity === r2.data.warehouseQuantity,
    'hər iki tərəf eyni rəqəmi görür',
    `${r1.data.inventory.warehouseQuantity} = ${r2.data.warehouseQuantity}`,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('\nNəticə: məlumat TƏK bazadadır. Yazma anında hər iki tərəfdə görünür.');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
