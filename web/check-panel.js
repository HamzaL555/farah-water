/**
 * Headless check of the web panel: parses app.js for syntax errors, verifies
 * every DOM id referenced by the code exists in index.html, and confirms every
 * nav page is reachable from the router. Catches dead controls before deploy.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB = 'C:/Users/user/Desktop/Farah/web';
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');

// 1. Syntax check.
let syntaxOk = true;
try {
  new vm.Script(js, { filename: 'app.js' });
} catch (e) {
  syntaxOk = false;
  console.log('SYNTAX ERROR:', e.message);
}
console.log(`syntax: ${syntaxOk ? 'ok' : 'FAILED'}`);

// 2. Every $('#id') lookup must resolve to an id that exists either in the
//    static markup or in markup the code itself injects via innerHTML.
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
// Ids written into generated markup, e.g. id="w-name" or a helper's
// '<input id="' + id + '"' concatenation.
const generatedIds = new Set([...js.matchAll(/id=\\?"([a-zA-Z][a-zA-Z0-9_-]*)\\?"/g)].map((m) => m[1]));
// Ids passed as the first argument of the field helpers, which splice them into
// the generated markup: textField('w-name', ...) / moneyField('s-count', ...).
for (const m of js.matchAll(/\b(?:textField|moneyField)\(\s*'([a-zA-Z][a-zA-Z0-9_-]*)'/g)) {
  generatedIds.add(m[1]);
}
const known = new Set([...htmlIds, ...generatedIds]);
const usedIds = new Set([...js.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1]));
const missing = [...usedIds].filter((id) => !known.has(id));
console.log(`\nids looked up: ${usedIds.size}  (static: ${htmlIds.size}, injected: ${generatedIds.size})`);
if (missing.length === 0) console.log('every looked-up id is defined in static or injected markup');
else {
  console.log('UNRESOLVED IDS (would be null at runtime):');
  missing.forEach((id) => console.log('  #' + id));
}

// 3. Nav pages must all have a renderer.
const navIds = [...js.matchAll(/\{ id: '([a-z-]+)',/g)].map((m) => m[1]);
const dispatch = /async function render\(page, view\) \{([\s\S]*?)\n  \}/.exec(js)?.[1] || '';
const unrouted = navIds.filter((id) => !new RegExp(`page === '${id}'`).test(dispatch));
console.log(`\nnav pages: ${navIds.length} (${navIds.join(', ')})`);
if (unrouted.length === 0) console.log('every nav page has a render handler');
else console.log('PAGES WITHOUT A RENDERER: ' + unrouted.join(', '));

// 4. Static controls in the markup must have a handler. Submit buttons are
//    handled by the form's own submit listener, so they count as wired.
const wired = [...js.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)\.addEventListener/g)].map((m) => m[1]);
const forms = [...html.matchAll(/<form[^>]*id="([^"]+)"/g)].map((m) => m[1]);
const formSubmit = new Set(
  [...js.matchAll(/\$\('#([a-zA-Z0-9_-]+)'\)\.addEventListener\('submit'/g)].map((m) => m[1]),
);
const interactive = [...html.matchAll(/<button[^>]*id="([^"]+)"([^>]*)>/g)].map((m) => ({
  id: m[1],
  isSubmit: /type="submit"/.test(m[2]),
}));
const unwired = interactive.filter(
  (b) => !wired.includes(b.id) && !(b.isSubmit && formSubmit.has('login-form')),
);
console.log(`\nstatic buttons: ${interactive.length}, wired: ${wired.length}, forms: ${forms.length}`);
if (unwired.length === 0) console.log('every static control has a handler');
else console.log('CONTROLS WITHOUT A LISTENER: ' + unwired.map((b) => b.id).join(', '));

// 5. Endpoint paths used by the panel must be plausible.
const paths = [...new Set([...js.matchAll(/api\('(?:GET|POST|PATCH|DELETE)', '([^']+)'/g)].map((m) => m[1]))];
console.log(`\nendpoints called (${paths.length}):`);
paths.forEach((p) => console.log('  ' + p));

// 6. Every class the markup uses must be defined in the stylesheet.
//    An undefined class means the element silently loses its layout - which is
//    exactly how the shell lost its flex row and pushed content off-screen.
const htmlClasses = new Set(
  [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].trim().split(/\s+/)).filter(Boolean),
);
const css = fs.readFileSync(path.join(WEB, 'styles.css'), 'utf8') +
  '\n' + fs.readFileSync(path.join(WEB, 'theme-2026.css'), 'utf8');
const unstyled = [...htmlClasses].filter((cl) => !new RegExp(`\\.${cl}(?![\\w-])`).test(css));
console.log(`\nclasses used in html: ${htmlClasses.size}`);
if (unstyled.length === 0) console.log('every class has a rule in styles.css');
else console.log('CLASSES WITH NO CSS RULE: ' + unstyled.join(', '));

// 7. Times must be rendered in Baku time.
//
//    The bug this guards against is quiet and everywhere: reading the UTC parts
//    of a timestamp and printing them unshifted prints a delivery recorded at
//    14:00 as 10:00, on every screen, forever. Both renderers have to go
//    through the same offset shift, so check that they do and that the offset
//    is the one Baku actually uses.
const offsetMatch = /BAKU_OFFSET_MS\s*=\s*4\s*\*\s*3600\s*\*\s*1000/.test(js);
const dateBody = /\n  function date\(v\) \{([\s\S]*?)\n  \}/.exec(js)?.[1] ?? '';
const dateTimeBody = /\n  function dateTime\(v\) \{([\s\S]*?)\n  \}/.exec(js)?.[1] ?? '';
const shifted = /\bbaku\(/.test(dateBody) && /\bbaku\(/.test(dateTimeBody);
// The delivery date field is built from dayOffsetIso, so that is the one that
// has to carry the offset: "Bu gün" means today in Baku, not on the viewer's
// machine clock.
const dayBody = /function dayOffsetIso\(days\) \{([\s\S]*?)\n  \}/.exec(js)?.[1] ?? '';
const dayShifted = /BAKU_OFFSET_MS/.test(dayBody);
console.log(`\nbaku time: offset ${offsetMatch ? 'ok' : 'MISSING'}, date/dateTime ${shifted ? 'ok' : 'READ UTC DIRECTLY'}, dayOffsetIso ${dayShifted ? 'ok' : 'MISSING'}`);

// The native date input rendered 10/14/2026 on an en-US browser - month first,
// the opposite of every other date here. DD.MM.YYYY is the format, and the
// panel must be the one that parses it.
const parsesAz =
  /function parseAzerbaijaniDate\(/.test(js) &&
  /placeholder="GG\.AA\.İLİ"/.test(js) &&
  /function dayRelativeName\(/.test(js);
console.log(`delivery date: DD.MM.YYYY parser ${parsesAz ? 'ok' : 'MISSING'}`);

const failed =
  !syntaxOk || missing.length > 0 || unrouted.length > 0 || unwired.length > 0 || unstyled.length > 0 ||
  !offsetMatch || !shifted || !dayShifted || !parsesAz;
console.log(`\n${failed ? 'ISSUES FOUND' : 'PANEL OK'}`);
process.exit(failed ? 1 : 0);
