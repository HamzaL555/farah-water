/**
 * Exact-string patcher used while str_replace cannot reach subdirectories.
 *
 * Usage: node tools/edit.mjs <file> <spec.json>
 * spec: [{ "oldStr": "...", "newStr": "...", "allowMultiple": false }]
 *    or { "file": "...", "reps": [ ... ] }
 *
 * Fails loudly (exit 1) unless every oldStr matches exactly once by default,
 * so a stale pattern can never silently patch the wrong place. Replacements use
 * split/join so `$` inside replacement text stays literal.
 */
import fs from 'node:fs';

const [fileArg, specPath] = process.argv.slice(2);
if (!fileArg || !specPath) {
  console.error('usage: node tools/edit.mjs <file> <spec.json>');
  process.exit(2);
}

const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const file = fileArg !== '-' ? fileArg : spec.file;
const reps = Array.isArray(spec) ? spec : spec.reps;
if (!Array.isArray(reps)) {
  console.error('spec must be an array or { reps: [...] }');
  process.exit(2);
}

let src = fs.readFileSync(file, 'utf8');

for (const rep of reps) {
  const oldStr = rep.oldStr;
  const newStr = rep.newStr ?? '';
  const count = src.split(oldStr).length - 1;
  if (count === 0) {
    console.error(`NOT FOUND in ${file}:\n---\n${oldStr.slice(0, 400)}\n---`);
    process.exit(1);
  }
  if (count > 1 && !rep.allowMultiple) {
    console.error(`MATCHED ${count}x (expected 1) in ${file}:\n---\n${oldStr.slice(0, 400)}\n---`);
    process.exit(1);
  }
  src = src.split(oldStr).join(newStr);
}

fs.writeFileSync(file, src);
console.log(`OK ${file} (${reps.length} replacement${reps.length === 1 ? '' : 's'})`);
