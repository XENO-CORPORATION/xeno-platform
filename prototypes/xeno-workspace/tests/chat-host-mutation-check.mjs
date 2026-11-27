// chat-host-mutation-check — proves chat-host-test can FAIL: each mutation removes one piece of the chat host, runs the
// test, and requires it to fail; each file is restored byte for byte afterwards, pass or fail.
//   node prototypes/xeno-workspace/tests/chat-host-mutation-check.mjs
import { readFileSync, writeFileSync } from 'node:fs'; import { spawnSync } from 'node:child_process'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), ws = path.resolve(here, '..'), repo = path.resolve(here, '../../..');
const MUTANTS = [
  ['the host is not read as the chat host', path.join(ws, 'address.js'), '^(tasks|chat|storage)\\.(xenosystem', '^(tasks|chatX|storage)\\.(xenosystem'],
  ['conversations keep the workspace\'s item form', path.join(ws, 'address.js'), "chat: (it) => (/^projects\\//.test(it) || !it ? it : 'c/' + it),", 'chat: (it) => it,'],
  ['Images is not one of the host\'s places', path.join(ws, 'address.js'), "['images', 'p', 'image']", "['imagesX', 'p', 'image']"],
  ['the sidebar shows the workspace path', path.join(ws, 'app.js'), "const onHost = window.XENO_ADDR?.product === 'chat';", 'const onHost = false;'],
  ['the rail carries the workspace\'s areas, not the chat\'s places', path.join(ws, 'app.js'), "const hostRail = HOST_RAILS[window.XENO_ADDR?.product];", 'const hostRail = null;'],
  ['the rail is hidden on the chat host, the sidebar left floating', path.join(ws, 'index.html'), 'html[data-product="tasks"] .rail,', 'html[data-product] .rail,'],
  ['the host serves every workspace script', path.join(repo, 'scripts', 'vite-workspace.mjs'), "productPage(fs.readFileSync(path.join(src, 'index.html'), 'utf8'), productHost.toLowerCase()).html", "fs.readFileSync(path.join(src, 'index.html'), 'utf8').replace('<html lang=\"en\">', `<html lang=\"en\" data-product=\"${productHost.toLowerCase()}\">`)"],
];
let caught = 0;
for (const [name, file, from, to] of MUTANTS) {
  const orig = readFileSync(file), text = orig.toString('utf8');
  if (!text.includes(from)) { console.log('ANCHOR MISSING', name); process.exitCode = 1; continue; }
  try {
    writeFileSync(file, text.replace(from, to));
    const r = spawnSync(process.execPath, [path.join(here, 'chat-host-test.mjs')], { encoding: 'utf8', timeout: 300000 });
    const fails = (r.stdout.match(/^FAIL .*/gm) || []);
    if (r.status !== 0 && fails.length) { caught++; console.log('CAUGHT', name, '·', fails[0].slice(0, 140)); } else { console.log('MISSED', name); process.exitCode = 1; }
  } finally { writeFileSync(file, orig); }
}
console.log(`${caught} of ${MUTANTS.length} mutations caught`);
