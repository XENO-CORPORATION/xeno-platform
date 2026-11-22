/**
 * Mutation check for storage-upload-sessions.test.mjs: remove each protection in turn and prove the test fails.
 * Restores the file in `finally`. Run: DATABASE_URL=… node tests/storage-upload-sessions.mutation.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const file = new URL('../services/storageUploads.js', import.meta.url);
const original = readFileSync(file, 'utf8');
const mutations = [
  ['no room check at open', [['try { await client.query(\'BEGIN\'); await assertStorageRoom(client, { userId, workspaceId, bytes }); }', 'try { await client.query(\'BEGIN\'); }']]],
  ['no size cap', [['if (bytes > cap) throw', 'if (false) throw']]],
  ['no type check', [['if (!ALLOWED_UPLOAD_MIMES.has(type)) throw', 'if (false) throw']]],
  ['session not bound to its owner', [["'SELECT * FROM storage_upload_sessions WHERE id = $1 AND user_id = $2', [id, userId]", "'SELECT * FROM storage_upload_sessions WHERE id = $1 AND $2::uuid IS NOT NULL', [id, userId]"]]],
  ['part size not checked', [['if (!Buffer.isBuffer(bytes) || bytes.length !== expected) throw', 'if (!Buffer.isBuffer(bytes)) throw']]],
  ['missing parts not checked', [['if (missing.length) throw', 'if (false) throw']]],
  ['assembled size not checked', [["if (!got || got.size !== Number(row.size_bytes)) throw", 'if (!got) throw']]],
  ['other personal workspace allowed', [["if (String(ws.owner_user_id) !== String(userId)) throw", 'if (false) throw']]],
  ['same name never asked', [["if (onConflict === 'ask') throw", "if (false) throw"]]],
  ['name match case-sensitive', [['lower(f.original_name) = lower($1)', 'f.original_name = $1']]],
  ['folder access not checked', [["await folderAccess(db, userId, folderId, 'edit')", "(await db.query('SELECT * FROM storage_folders WHERE id = $1', [folderId])).rows[0]"]]],
];
let failures = 0;
try {
  for (const [name, edits] of mutations) {
    let text = original;
    for (const [from, to] of edits) { if (!text.includes(from)) throw new Error(`mutation "${name}": anchor not found: ${from}`); text = text.replace(from, to); }
    writeFileSync(file, text);
    const run = spawnSync(process.execPath, ['tests/storage-upload-sessions.test.mjs'], { encoding: 'utf8', timeout: 240000 });
    const caught = run.status !== 0;
    console.log(`${caught ? 'CAUGHT' : 'MISSED'}  ${name}`);
    if (!caught) failures += 1;
  }
} finally { writeFileSync(file, original); }
const control = spawnSync(process.execPath, ['tests/storage-upload-sessions.test.mjs'], { encoding: 'utf8', timeout: 240000 });
console.log(control.status === 0 ? 'control (restored) passes' : 'CONTROL FAILED');
process.exit(failures || control.status !== 0 ? 1 : 0);
