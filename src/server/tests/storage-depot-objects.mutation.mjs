/**
 * Mutation check for storage-depot-objects.test.mjs: remove each protection in turn and prove the test fails.
 * Restores the file in `finally`. Run: DATABASE_URL=… node tests/storage-depot-objects.mutation.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const file = new URL('../services/storageDepotObjects.js', import.meta.url);
const original = readFileSync(file, 'utf8');
const mutations = [
  ['no pool check', [
    ['await assertStorageRoom(tx, { workspaceId, bytes: bytes.length });   // takes', '/* M */ // takes'],
    ['await inTransaction(db, (tx) => assertStorageRoom(tx,', 'await inTransaction(db, (tx) => null && assertStorageRoom(tx,'],
  ]],
  ['different bytes accepted', [['if (existing.payload_sha256 !== actual) throw', 'if (false) throw']]],
  ['stranger bytes adopted', [['if (!there || sha256Hex(there) !== actual) throw', 'if (false) throw']]],
  ['wire check skipped', [["if (actual !== sha256) throw", 'if (false) throw']]],
  ['workspace not in the key', [['`depot/${workspaceId}/${hash.slice(0, 2)}/${hash}`', '`depot/00000000-0000-4000-8000-000000000000/${hash.slice(0, 2)}/${hash}`']]],
];
let failures = 0;
try {
  for (const [name, edits] of mutations) {
    let text = original;
    for (const [from, to] of edits) { if (!text.includes(from)) throw new Error(`mutation "${name}": anchor not found: ${from}`); text = text.replace(from, to); }
    writeFileSync(file, text);
    const run = spawnSync(process.execPath, ['tests/storage-depot-objects.test.mjs'], { encoding: 'utf8', timeout: 240000 });
    const caught = run.status !== 0;
    console.log(`${caught ? 'CAUGHT' : 'MISSED'}  ${name}`);
    if (!caught) failures += 1;
  }
} finally { writeFileSync(file, original); }
const control = spawnSync(process.execPath, ['tests/storage-depot-objects.test.mjs'], { encoding: 'utf8', timeout: 240000 });
console.log(control.status === 0 ? 'control (restored) passes' : 'CONTROL FAILED');
process.exit(failures || control.status !== 0 ? 1 : 0);
