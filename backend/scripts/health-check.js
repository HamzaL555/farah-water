/**
 * One-shot health check across every layer the product depends on.
 * Reports pass/fail per layer so a single broken piece is obvious.
 */
const fs = require('fs');
const BASE = 'https://farah-water.vercel.app';
const API = `${BASE}/api/v1`;
const PW = process.argv[2];

let pass = 0, fail = 0;
const line = (ok, label, detail) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(34)} ${detail}`);
};

(async () => {
  console.log('=== 1. SAYT (hosting) ===');

  const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
  line(Boolean(health?.data?.status === 'ok'), 'api /health', health?.data?.status ?? 'no response');

  const admin = await fetch(`${BASE}/admin`).then((r) => r.text()).catch(() => '');
  line(admin.includes('Farah Su Şirkəti'), 'panel /admin loads', admin.length + ' bytes');

  const js = await fetch(`${BASE}/admin/app.js`).then((r) => r.text()).catch(() => '');
  line(js.includes('pageReports') && js.includes('setDrawer'), 'panel script is current', `${js.length} bytes`);

  const css = await fetch(`${BASE}/admin/styles.css`).then((r) => r.text()).catch(() => '');
  line(css.includes('max-width: 860px'), 'panel styles loaded', `${css.length} bytes`);

  const cc = (await fetch(`${API}/health`).then((r) => r.headers)).get('cache-control') ?? '';
  line(/no-store/.test(cc), 'responses are no-store', cc || '(missing)');

  console.log('\n=== 2. GİRİŞ ===');
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: PW }),
  }).then((r) => r.json()).catch(() => null);
  const token = login?.data?.tokens?.accessToken;
  line(Boolean(token), 'admin login', token ? 'token issued' : login?.error?.message ?? 'failed');
  if (!token) {
    console.log('\n  Cannot continue without a token.');
    process.exit(1);
  }

  const auth = { authorization: `Bearer ${token}` };
  const me = await fetch(`${API}/auth/me`, { headers: auth }).then((r) => r.json()).catch(() => null);
  line(me?.data?.username === 'admin', 'session valid', me?.data?.fullName ?? 'n/a');

  console.log('\n=== 3. BÜTÜN SƏHİFLƏR ===');
  const pages = [
    ['/dashboard/admin', 'Dashboard'], ['/users', 'İşçilər'],
    ['/inventory/summary', 'Anbar'], ['/customers', 'Müştərilər'],
    ['/deliveries', 'Çatdırılmalar'], ['/debts', 'Borclar'],
    ['/dashboard/revenue', 'Gəlirlər'], ['/reports?type=daily', 'Hesabat'],
    ['/audit/logs', 'Audit'],
  ];
  for (const [p, label] of pages) {
    const r = await fetch(`${API}${p}`, { headers: auth }).catch(() => null);
    line(r?.status === 200, label, p);
  }

  console.log('\n=== 4. İŞÇİ HESABI ===');
  const worker = await fetch(`${API}/users`, { headers: auth }).catch(() => null);
  line(worker?.status === 200, 'user list endpoint', `HTTP ${worker?.status ?? 'no response'}`);
  const w = (await worker?.json().catch(() => null))?.data?.items?.find((x) => x.role === 'WORKER');

  // A system with no workers yet is a normal state, not a broken one: the admin
  // creates the first worker when there is someone to drive. Requiring one here
  // meant a clean install always reported a failure, which trains you to ignore
  // the health check - the worst outcome for the one page meant to tell you
  // something is actually wrong.
  if (w) {
    line(true, 'worker account exists', `${w.fullName} (${w.username})`);
  } else {
    console.log(`  note  ${'no worker account yet'.padEnd(34)} yoxdur - "İşçilər" bolmesinden yaradilir`);
  }

  console.log('\n=== 5. HESABATLAR ===');
  const formats = [
    ['/reports?type=daily&format=xlsx', 'xlsx'], ['/reports?type=daily&format=csv', 'csv'],
    ['/reports?type=daily&format=pdf', 'pdf'],
    ['/reports/monthly?format=xlsx', 'monthly xlsx'],
    ['/reports/monthly?month=last&format=xlsx', 'last month'],
  ];
  for (const [p, kind] of formats) {
    const r = await fetch(`${API}${p}`, { headers: auth }).catch(() => null);
    let ok = false, note = '';
    if (r && r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (kind.includes('csv')) ok = buf[0] === 0xef && buf[1] === 0xbb;
      else if (kind.includes('pdf')) ok = buf.slice(0, 4).toString() === '%PDF';
      else ok = buf[0] === 0x50 && buf[1] === 0x4b;
      note = `${buf.length} bytes`;
    } else {
      note = `HTTP ${r?.status}`;
    }
    line(ok, p.replace('/reports', ''), note);
  }

  console.log('\n=== 6. EHTİYAT ===');
  const dir = 'C:/Users/user/Desktop/Farah/backups';
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('farah-')) : [];
  const newest = files.length ? files.sort().reverse()[0] : null;
  line(Boolean(newest), 'backup files present', newest || 'NONE');

  const logPath = 'C:/Users/user/Desktop/Farah/logs/maintenance.log';
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').trim().split('\n') : [];
  // Only errors since the loop last started are meaningful; entries from an
  // earlier, already-fixed run should not keep this check red.
  const lastStart = log.map((l, i) => (l.includes('Baxim basladi') ? i : -1)).filter((i) => i >= 0).pop();
  const recent = lastStart === undefined ? [] : log.slice(lastStart);
  const errors = recent.filter((l) => l.includes('XETA')).length;
  line(errors === 0, 'maintenance loop healthy', errors ? `${errors} error(s)` : `${recent.length} entries since start, no errors`);

  console.log(`\n${pass} passed, ${fail} failed`);
  console.log(fail === 0 ? '\nHER SEY ISLEYIR' : `\n${fail} PROBLEM VAR`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
