/**
 * Attachments through the REAL code engine (xenorun), not a stand-in (CHAT-CODE-EXECUTION-SPEC.md §7a).
 *
 * The first version of §7a was proven with a stub engine and failed in production: the engine took only
 * 1 MB per request and wrote files through its start command (~96 KB per file). This test runs real
 * Python in the real engine:
 *  - the engine advertises `workspace-files-streamed` and its limits on /health;
 *  - a 1.5 MB PNG attached to the chat is read by the code byte for byte (SHA-256 printed by Python);
 *  - a small text attachment next to it is read too;
 *  - a file the code writes comes back and is saved; unchanged attachments are not echoed back;
 *  - against an engine that does not stream files, attachments are withheld with a reason, never sent.
 *
 * Run: DATABASE_URL=postgres://… XENORUN_URL=http://… node src/server/tests/chat-sandbox-real-engine.test.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { registerManagedLibraryFile } from '../services/libraryAssets.js';
import { runInSandbox, codeExecutionAvailable, codeEngineInfo } from '../services/sandboxSession.js';

if (!process.env.DATABASE_URL || !process.env.XENORUN_URL) throw new Error('DATABASE_URL and XENORUN_URL are required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const uploadsDir = path.resolve(process.cwd(), 'src/server/uploads', `sandbox-engine-test-${process.pid}`);
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function main() {
  await runAllMigrations(pool);
  fs.mkdirSync(uploadsDir, { recursive: true });
  const ada = (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1, $2, $1, true, true, 'x') RETURNING id`,
    [`re_ada${Date.now()}`, `re_ada${Date.now()}@xeno.test`])).rows[0].id;
  let n = 0;
  const store = async (name, bytes, mimeType) => {
    const storagePath = path.join(uploadsDir, `${n += 1}-${name}`);
    fs.writeFileSync(storagePath, bytes);
    const id = (await registerManagedLibraryFile(pool, { userId: ada, filename: name, originalName: name, mimeType, fileSize: bytes.length, storagePath, metadata: { source: 'upload' } })).id;
    await pool.query(`UPDATE library_asset_ingestions SET state = 'ready' WHERE asset_id = $1`, [id]);
    return id;
  };

  try {
    check(await codeExecutionAvailable(), 'the real engine is up and offers workspace files');
    const engine = codeEngineInfo();
    check(engine.streamed === true, 'it advertises workspace-files-streamed');
    check(Number(engine.limits?.maxInputTotalBytes) >= 64 * 1024 * 1024 && Number(engine.limits?.maxRequestBytes) > Number(engine.limits?.maxInputTotalBytes),
      `it advertises its limits (input ${engine.limits?.maxInputTotalBytes}, request ${engine.limits?.maxRequestBytes})`);

    // A 1.5 MB "sheet": a real PNG signature over random bytes (bigger than the GRIDMASTER sheet).
    const big = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), crypto.randomBytes(1_500_000)]);
    const sheet = await store('GRIDMASTER sheet.png', big, 'image/png');
    const note = await store('notes.txt', Buffer.from('neck, shoulders, pelvis\n'), 'text/plain');
    const conv = (await pool.query(`INSERT INTO chat_conversations (user_id, owner_user_id, created_by_user_id, title, interface_id) VALUES ($1,$1,$1,'engine','playground') RETURNING id`, [ada])).rows[0].id;
    await pool.query(`INSERT INTO chat_messages (conversation_id, user_id, role, content, attachments, message_index) VALUES ($1,$2,'user','measure',$3::jsonb,0)`,
      [conv, ada, JSON.stringify([{ type: 'image', asset_id: sheet, name: 'GRIDMASTER sheet.png' }, { type: 'file', asset_id: note, name: 'notes.txt' }])]);

    const code = [
      'import hashlib, os, json',
      "p = 'attachments/GRIDMASTER sheet.png'",
      "b = open(p, 'rb').read()",
      "t = open('attachments/notes.txt').read()",
      "os.makedirs('out', exist_ok=True)",
      "json.dump({'size': len(b)}, open('out/measure.json', 'w'))",
      "print(hashlib.sha256(b).hexdigest(), len(b), t.strip())",
    ].join('\n');
    const started = Date.now();
    const run = await runInSandbox({ db: pool, conversationId: conv, ownerUserId: ada, language: 'python', code, uploadsDir, timeoutMs: 30000 });
    const ms = Date.now() - started;
    check(run.status === 'success' && run.exitCode === 0, `the real run succeeded (${run.status}, exit ${run.exitCode}, ${ms} ms)${run.stderr ? ' stderr: ' + run.stderr.slice(0, 200) : ''}`);
    const [hash, size, ...rest] = run.stdout.trim().split(' ');
    check(hash === sha(big) && Number(size) === big.length, `Python read the 1.5 MB attachment byte for byte (${size} bytes, sha ${String(hash).slice(0, 12)})`);
    check(rest.join(' ') === 'neck, shoulders, pelvis', 'and the text attachment beside it');
    check(run.savedFiles.map((f) => f.path).join() === 'out/measure.json', 'the file the code wrote came back and was saved');
    check(!run.skippedFiles.length && !run.outputFilesTruncated, 'unchanged attachments were not echoed back or counted against the output');

    // An engine that does not stream files gets no attachments, and the model is told why.
    const old = await runInSandbox({ db: pool, conversationId: conv, ownerUserId: ada, language: 'python', code: "import os; print(os.path.exists('attachments'))", uploadsDir, engine: { streamed: false, limits: null } });
    check(old.stdout.trim() === 'False', 'an engine that cannot take files is sent none');
    check(old.attachmentsUnavailable.length === 2 && old.attachmentsUnavailable.every((u) => u.reason === 'code_engine_cannot_take_files'), 'and every attachment is reported with that reason');
  } finally {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
