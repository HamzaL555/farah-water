/**
 * Builds a throwaway copy of the panel pointed at a local API.
 *
 * window.FARAH_API_URL is read once, at the moment app.js runs, so a reload
 * cannot change it. This writes the override into the page before app.js so
 * the local build can be exercised against a local server without adding
 * dev-only code to the shipped panel.
 *
 *   node make-dev-copy.js <apiBase>
 */
const fs = require('fs');
const path = require('path');

const apiBase = process.argv[2] || 'http://localhost:4000/api/v1';
const out = path.join(__dirname, '..', '.devpanel');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const copyDir = (from, to) => {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const a = path.join(from, name);
    const b = path.join(to, name);
    if (fs.statSync(a).isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
};

copyDir(path.join(__dirname, '..', 'backend', 'public', 'admin'), path.join(out, 'admin'));

const index = path.join(out, 'admin', 'index.html');
let html = fs.readFileSync(index, 'utf8');
// The app.js tag is cache-busted (`app.js?v=...`), so match the tag rather than
// a bare filename. The override must come before app.js runs.
const appTag = /<script src="\/admin\/app\.js[^"]*"><\/script>/;
if (!appTag.test(html)) {
  throw new Error('app.js <script> tag not found in admin/index.html');
}
html = html.replace(
  appTag,
  `<script>window.FARAH_API_URL=${JSON.stringify(apiBase)};</script>\n    $&`,
);
fs.writeFileSync(index, html);

console.log(`dev panel yaradildi: ${out}`);
console.log(`api: ${apiBase}`);