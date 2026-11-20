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
const FILES = ['index.html', 'app.js', 'styles.css', 'theme-2026.css', 'manifest.webmanifest'];
const ASSETS = ['logo.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'favicon-32.png'];

/** Copies one file, reporting only when the bytes actually differ. */
function copy(name, from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (!fs.existsSync(from)) {
    console.error(`missing source: ${name}`);
    process.exitCode = 1;
    return 0;
  }
  const a = fs.readFileSync(from);
  const b = fs.existsSync(to) ? fs.readFileSync(to) : null;
  if (b && b.equals(a)) {
    console.log(`  same  ${name}`);
    return 0;
  }
  fs.writeFileSync(to, a);
  console.log(`  copy  ${name}  (${a.length} bytes)`);
  return 1;
}

let changed = 0;
for (const name of FILES) {
  changed += copy(name, path.join(SRC, name), path.join(DST, name));
}

// Icons are copied one by one rather than as a directory: an assets/ folder
// synced wholesale would also pull in anything left over from an experiment.
const ASSET_SRC = path.join(SRC, 'assets');
if (fs.existsSync(ASSET_SRC)) {
  for (const name of fs.readdirSync(ASSET_SRC)) {
    changed += copy(`assets/${name}`, path.join(ASSET_SRC, name), path.join(DST, 'assets', name));
  }
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
for (const name of ASSETS) {
  const a = fs.readFileSync(path.join(ASSET_SRC, name));
  const b = fs.readFileSync(path.join(DST, 'assets', name));
  if (!a.equals(b)) {
    console.error(`\nOUT OF SYNC: assets/${name}`);
    process.exitCode = 1;
  }
}

console.log(`\n${changed} file(s) updated; web/ and backend/public/admin/ match.`);
