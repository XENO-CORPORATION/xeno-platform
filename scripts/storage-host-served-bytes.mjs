// storage-host-served-bytes — after a deploy, reads what storage.xenosystem.ai SERVES, inside the frontend container
// (the workspace's files are behind the site gate, so they cannot be read from outside without a pass):
//   - workspace/storage.html is there, marked data-product="storage", and names Storage's scripts (PRODUCT_SCRIPTS);
//   - every script it names is byte-identical to that file at the deployed commit, and its ?v=<stamp> is the first 12
//     hex of the file's own SHA-256 (the stamp the build gives it), so no browser can hold a stale copy;
//   - nginx's storage block in the running container is the committed one.
//   node scripts/storage-host-served-bytes.mjs <deployed commit>      (ssh alias xeno-platform-001)
import { execFileSync } from 'node:child_process'; import crypto from 'node:crypto';
import { PRODUCT_SCRIPTS } from './vite-workspace.mjs';
const sha = process.argv[2]; if (!/^[0-9a-f]{7,40}$/.test(sha || '')) throw new Error('usage: storage-host-served-bytes.mjs <deployed commit>');
let failed = 0; const ok = (c, m) => { if (c) console.log('PASS', m); else { failed++; console.log('FAIL', m); } };
const h = (b) => crypto.createHash('sha256').update(b).digest('hex');
const box = (cmd) => execFileSync('ssh', ['xeno-platform-001', cmd], { maxBuffer: 64 * 1024 * 1024 });
const served = (p) => box(`sudo docker exec xenostudio-frontend cat /usr/share/nginx/html/${p}`);
const committed = (p) => execFileSync('git', ['show', `${sha}:${p}`], { maxBuffer: 64 * 1024 * 1024 });

const page = served('workspace/storage.html').toString('utf8');
ok(/<html lang="en" data-product="storage">/.test(page), 'workspace/storage.html is served and is the Storage host page');
const named = [...page.matchAll(/<script src="([^"?]+)\?v=([0-9a-f]+)"/g)].map((m) => [m[1], m[2]]);
// the page keeps index.html's script order (productPage only drops scripts), so the list is compared as a set, and the
// one order that matters is checked: the upload panel loads before the Storage page that hands it files
const names = named.map(([n]) => n);
ok(names.length === PRODUCT_SCRIPTS.storage.length && JSON.stringify([...names].sort()) === JSON.stringify([...PRODUCT_SCRIPTS.storage].sort()), `it names exactly Storage's ${PRODUCT_SCRIPTS.storage.length} scripts (${names.length})`);
ok(names.indexOf('platform-storage-uploads.js') >= 0 && names.indexOf('platform-storage-uploads.js') < names.indexOf('platform-storage.js'), 'the upload panel loads before the Storage page');
let same = 0, stamped = 0; const off = [];
for (const [name, v] of named) {
  const got = served(`workspace/${name}`), want = committed(`prototypes/xeno-workspace/${name}`);
  if (h(got) === h(want)) same++; else off.push(`${name} bytes`);
  if (h(got).slice(0, v.length) === v) stamped++; else off.push(`${name} stamp`);
}
ok(same === named.length, `every script byte-identical to ${sha.slice(0, 8)} (${same}/${named.length})${off.length ? ' ' + off.join(', ') : ''}`);
ok(stamped === named.length, `every ?v= stamp is its file's own hash (${stamped}/${named.length})`);
const conf = box('sudo docker exec xenostudio-frontend cat /etc/nginx/conf.d/default.conf').toString('utf8').replace(/\r\n/g, '\n');
const repoConf = committed('nginx/default.conf').toString('utf8').replace(/\r\n/g, '\n');
const block = (c) => { const b = c.slice(c.indexOf('server_name storage.xenosystem.ai;')); return b.slice(0, b.indexOf('\n}\n')); };
ok(block(conf).length > 500 && block(conf) === block(repoConf), `nginx's running storage block is the committed one (${block(conf).length} chars)`);
console.log(failed ? `${failed} FAILED` : 'storage-host-served-bytes: all passed'); process.exit(failed ? 1 : 0);
