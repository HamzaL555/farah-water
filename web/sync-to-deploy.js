/**
 * Copies the web panel into the API deployment tree.
 *
 * web/ is the single source of truth; backend/public/admin/ is what Vercel
 * actually serves at /admin. Keeping one copy in the repo and syncing it means
 * the panel cannot drift from what is deployed.
 */
const fs = require('fs');
const path = require('path');

const SRC = 'C:/Users/user/Desktop/Farah/web';
const DST = 'C:/Users/user/Desktop/Farah/backend/public/admin';
const FILES = ['index.html', 'app.js', 'styles.css'];

fs.mkdirSync(DST, { recursive: true });

let changed = 0;
for (const name of FILES) {
  const from = path.join(SRC, name);
  const to = path.join(DST, name);
  if (!fs.existsSync(from)) {
    console.error(`missing source: ${name}`);
    process.exitCode = 1;
    continue;
  }
  const a = fs.readFileSync(from);
  const b = fs.existsSync(to) ? fs.readFileSync(to) : null;
  if (b && b.equals(a)) {
    console.log(`  same  ${name}`);
    continue;
  }
  fs.writeFileSync(to, a);
  console.log(`  copy  ${name}  (${a.length} bytes)`);
  changed++;
}

// Fail loudly if the two copies differ, so a missed sync cannot ship.
for (const name of FILES) {
  const a = fs.readFileSync(path.join(SRC, name));
  const b = fs.readFileSync(path.join(DST, name));
  if (!a.equals(b)) {
    console.error(`\nOUT OF SYNC: ${name}`);
    process.exitCode = 1;
  }
}

console.log(`\n${changed} file(s) updated; web/ and backend/public/admin/ match.`);
