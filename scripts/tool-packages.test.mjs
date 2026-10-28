// XENO tools on the web (src/server/services/toolPackages.js, src/toolHost): the verifier refuses exactly what
// Hub's refuses, the import map and its shims agree with the live modules, and the server's list of web
// capabilities matches what the web host actually implements.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import * as T from '../src/server/services/toolPackages.js';
import { SPECIFIERS, shimSource, importMap, OUT } from './gen-tool-host-shims.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const KEY = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
const js = Buffer.from('export default 1');
const pkg = (extra = {}) => {
  const manifest = { schemaVersion: 1, id: 't', version: '1.0.0', name: 'T', files: [{ name: 'index.js', sha256: createHash('sha256').update(js).digest('hex'), bytes: js.length }], ...extra };
  const signature = { algorithm: 'ed25519', signature: sign(null, Buffer.from(T.canonical(manifest)), privateKey).toString('base64') };
  return { manifestBytes: Buffer.from(JSON.stringify(manifest)), signatureBytes: Buffer.from(JSON.stringify(signature)), files: { 'index.js': js }, trustedKeys: [KEY] };
};

test('a correctly signed package verifies', () => assert.equal(T.verifyToolPackage(pkg()).ok, true));
test('a changed byte, an extra file, no signature or another key is refused', () => {
  assert.match(T.verifyToolPackage({ ...pkg(), files: { 'index.js': Buffer.from('export default 2') } }).reason, /content mismatch/);
  assert.match(T.verifyToolPackage({ ...pkg(), files: { 'index.js': js, 'x.js': js } }).reason, /undeclared/);
  assert.match(T.verifyToolPackage({ ...pkg(), signatureBytes: null }).reason, /unsigned/);
  assert.match(T.verifyToolPackage({ ...pkg(), trustedKeys: T.TRUSTED_PUBLIC_KEYS }).reason, /does not verify/);
});
test('the trusted keys are Hub’s', () => {
  // Compare with what Hub SHIPS (its origin/main), not whatever a sibling working tree happens to hold: a checkout
  // that is behind or carries someone's uncommitted work would make this guard lie in either direction.
  const dir = new URL('../../xeno-hub/', import.meta.url), rel = 'src/main/services/tools/toolPackageVerifier.ts';
  if (!fs.existsSync(new URL(rel, dir))) return; // Hub is not checked out next to this repo
  let src;
  try { src = execFileSync('git', ['-C', fileURLToPath(dir), 'show', `origin/main:${rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { src = fs.readFileSync(new URL(rel, dir), 'utf8'); }
  for (const k of T.TRUSTED_PUBLIC_KEYS) assert.ok(src.includes(k), 'Hub does not trust ' + k);
});
test('the shims on disk match the live modules, and tool-host.html carries the same import map', () => {
  for (const [s, v] of Object.entries(SPECIFIERS)) assert.equal(fs.readFileSync(`${OUT}/${v.file}`, 'utf8').replace(/\r\n/g, '\n'), shimSource(s, v.names), `${v.file} is stale: run node scripts/gen-tool-host-shims.mjs`);
  const html = fs.readFileSync(new URL('../tool-host.html', import.meta.url), 'utf8');
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(map, importMap());
});
test('every web capability the server promises is implemented by the web host, and Hub-only ones refuse', () => {
  const host = fs.readFileSync(new URL('../src/toolHost/webHost.ts', import.meta.url), 'utf8');
  const groups = new Set(T.WEB_CAPABILITIES.map((c) => c.split('.')[0]).filter((g) => !['notify', 'telemetry'].includes(g)));
  for (const g of groups) assert.match(host, new RegExp(`\\n    ${g}: \\{`), `webHost has no ${g}`);
  for (const g of ['inference', 'convert', 'font']) { assert.ok(!T.WEB_CAPABILITIES.includes(g)); assert.match(host, new RegExp(`${g}: \\{[^\\n]*NeedsHubError`)); }
});
test('where a tool runs comes from its manifest', () => {
  assert.deepEqual(T.webSupport({ capabilities: ['fs.read', 'llm'] }), { runs: true, needsHub: [] });
  assert.deepEqual(T.webSupport({ capabilities: ['fs.read', 'inference'] }).needsHub, ['local AI models']);
  assert.equal(T.webSupport({ contract: 'agent@1', capabilities: [] }).runs, false);
});
