/**
 * Downloads the monthly and yearly report in every format and checks the file
 * really is what its name claims - a .xls must be an OLE2 workbook, not a
 * renamed xlsx, or Excel opens it as a corrupt file.
 *
 *   node scripts/verify-report-files.js [apiBase] [adminPassword]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = process.argv[2] || 'https://farah-water.vercel.app/api/v1';
const PW = process.argv[3] || 'Kenan333';
const OUT = path.join(__dirname, '..', '..', '.tmp-reports');

let pass = 0, fail = 0;
const line = (ok, label, detail) => {
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(44)} ${detail ?? ''}`);
};

const SIGNATURES = {
  // OLE2 compound file: the legacy Excel 97-2003 container.
  xls: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  // ZIP container: xlsx is a zip archive.
  xlsx: [0x50, 0x4b, 0x03, 0x04],
};

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: PW }),
  }).then((r) => r.json());
  const token = login?.data?.tokens?.accessToken;
  if (!token) {
    console.error('Giris alinamadi');
    process.exit(1);
  }

  const cases = [];
  for (const scope of ['monthly', 'yearly']) {
    for (const format of ['xls', 'xlsx', 'csv', 'pdf', 'json']) {
      cases.push({ scope, format });
    }
  }

  for (const c of cases) {
    const url = `${BASE}/reports/${c.scope}?format=${c.format}`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await res.arrayBuffer());
    const file = path.join(OUT, `${c.scope}.${c.format}`);
    fs.writeFileSync(file, buf);

    const label = `${c.scope} .${c.format}`;
    const contentType = res.headers.get('content-type') ?? '';
    const disposition = res.headers.get('content-disposition') ?? '';
    const ok = res.status === 200 && buf.length > 200;

    if (!ok) {
      line(false, label, `HTTP ${res.status}, ${buf.length} bayt`);
      continue;
    }

    // JSON is rendered by the app, so it is not a download and must NOT claim
    // to be one. Everything else must arrive as an attachment.
    const isDownload = c.format !== 'json';
    const hasAttachment = disposition.includes('attachment');
    if (isDownload !== hasAttachment) {
      line(false, `${label} (attachment header)`, hasAttachment ? 'var' : '(yoxdur)');
    }

    if (c.format === 'xls' || c.format === 'xlsx') {
      const sig = SIGNATURES[c.format];
      const matches = sig.every((b, i) => buf[i] === b);
      line(
        matches && hasAttachment,
        label,
        `${buf.length} bayt, ${sig[0] === 0xd0 ? 'OLE2' : 'ZIP'} imzası ${matches ? 'düzgün' : 'SƏHV'}`,
      );
    } else if (c.format === 'pdf') {
      line(buf.slice(0, 4).toString() === '%PDF' && hasAttachment, label, `${buf.length} bayt, ${contentType}`);
    } else if (c.format === 'csv') {
      // A BOM is present so Excel opens the Azerbaijani characters correctly;
      // the check looks past it.
      const text = buf.toString('utf8').replace(/^\uFEFF/, '');
      const rows = text.split('\n').filter(Boolean).length;
      line(rows > 5 && text.includes(';'), label, `${buf.length} bayt, ${rows} sətir`);
    } else {
      const body = JSON.parse(buf.toString());
      const sections = body?.data?.sections ?? [];
      line(sections.length > 0 && !hasAttachment, label, `${sections.length} bölmə, başlıq: "${body?.data?.title}"`);
    }
  }

  console.log(`\nfayllar: ${OUT}`);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });