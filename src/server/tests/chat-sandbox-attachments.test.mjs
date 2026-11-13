/**
 * A chat's attachments reach its code sandbox (CHAT-CODE-EXECUTION-SPEC.md §7a), against a real database.
 *
 *  - an image attached to the conversation is in the run as attachments/<name>, byte for byte (SHA-256 equal
 *    to the stored asset's), and the run's result lists it for the model;
 *  - a file the person may not read (another person's asset named in this turn) is NOT given, and is reported;
 *  - a file still being scanned is NOT given, and is reported;
 *  - an attachment the run leaves unchanged is never saved into the sandbox store or copied to the Library
 *    again; one the run changed is refused as read-only;
 *  - a later run still gets the attachment (from the saved conversation), and the sandbox store holds no copy;
 *  - the shared reader still serves image generation, and a text file recorded as image/png is refused.
 *
 * Mutation-checked: remove the ReBAC refusal in getAuthorizedLibraryFile and "another person's file" fails.
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/chat-sandbox-attachments.test.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { registerManagedLibraryFile } from '../services/libraryAssets.js';
import { runInSandbox } from '../services/sandboxSession.js';
import { codeResultPayload } from '../utils/chatCodeTool.js';
import { readGenerationReferences } from '../services/mediaGenerations.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const uploadsDir = path.resolve(process.cwd(), 'src/server/uploads', `sandbox-attach-test-${process.pid}`);
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// a real 1x1 PNG
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000d49444154789c6360f8cfc0f01f0005000201e5d4a3a10000000049454e44ae426082', 'hex');

async function main() {
  await runAllMigrations(pool);
  fs.mkdirSync(uploadsDir, { recursive: true });
  const user = async (name) => (await pool.query(
    `INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1, $2, $1, true, true, 'x') RETURNING id`,
    [`${name}${Date.now()}`, `${name}${Date.now()}@xeno.test`])).rows[0].id;
  const ada = await user('sa_ada'), cal = await user('sa_cal');
  let n = 0;
  const store = async (userId, name, bytes, mimeType, { ready = true } = {}) => {
    const storagePath = path.join(uploadsDir, `${n += 1}-${name}`);
    fs.writeFileSync(storagePath, bytes);
    const id = (await registerManagedLibraryFile(pool, { userId, filename: name, originalName: name, mimeType, fileSize: bytes.length, storagePath, metadata: { source: 'upload' } })).id;
    await pool.query(`UPDATE library_asset_ingestions SET state = $2 WHERE asset_id = $1`, [id, ready ? 'ready' : 'queued']);
    const count = (await pool.query(`SELECT count(*)::int c FROM library_asset_ingestions WHERE asset_id = $1`, [id])).rows[0].c;
    if (!count) await pool.query(`INSERT INTO library_asset_ingestions (asset_id, content_sha256, mime_type, state) VALUES ($1, $2, $3, $4)`, [id, sha(bytes), mimeType, ready ? 'ready' : 'queued']);
    return id;
  };

  try {
    const sheet = await store(ada, 'GRIDMASTER sheet.png', PNG, 'image/png');
    const pending = await store(ada, 'still-scanning.csv', Buffer.from('a,b\n1,2\n'), 'text/csv', { ready: false });
    const calsFile = await store(cal, 'cal-private.txt', Buffer.from('not for ada'), 'text/plain');
    const fakePng = await store(ada, 'fake.png', Buffer.from('this is text, not a png'), 'text/plain');
    await pool.query(`UPDATE user_files SET mime_type = 'image/png' WHERE id = $1`, [fakePng]); // recorded wrongly
    const stored = (await pool.query(`SELECT content_sha256 FROM user_files WHERE id = $1`, [sheet])).rows[0].content_sha256;
    check(stored === sha(PNG), 'the Library recorded the PNG with its real SHA-256');

    const conv = (await pool.query(`INSERT INTO chat_conversations (user_id, owner_user_id, created_by_user_id, title, interface_id) VALUES ($1,$1,$1,'gridmaster','playground') RETURNING id`, [ada])).rows[0].id;
    await pool.query(`INSERT INTO chat_messages (conversation_id, user_id, role, content, attachments, message_index) VALUES ($1, $2, 'user', 'measure the sheet', $3::jsonb, 0)`,
      [conv, ada, JSON.stringify([{ type: 'image', asset_id: sheet, name: 'GRIDMASTER sheet.png' }, { type: 'file', asset_id: pending, name: 'still-scanning.csv' }])]);

    const seen = [];
    const registered = [];
    const library = { uploadsDir, register: async (_db, args) => { registered.push(args.originalName); return { id: crypto.randomUUID() }; } };
    const run1 = await runInSandbox({
      db: pool, conversationId: conv, ownerUserId: ada, language: 'python', code: 'print(1)', uploadsDir, library,
      attachmentItems: [{ id: calsFile, name: 'cal-private.txt' }, { id: sheet, name: 'dup.png' }],
      execute: async (request) => {
        seen.push(request.files.map((f) => f.path));
        const att = request.files.find((f) => f.path === 'attachments/GRIDMASTER sheet.png');
        return {
          status: 'success', stdout: att ? sha(Buffer.from(att.content, 'base64')) : 'missing', stderr: '', exitCode: 0, executionTime: 1,
          outputFiles: [
            att, // left unchanged by the code
            { path: 'out/measure.json', content: Buffer.from('{"ok":true}').toString('base64') },
          ].filter(Boolean),
        };
      },
    });
    check(seen[0].includes('attachments/GRIDMASTER sheet.png'), 'the attached image is in the run under attachments/');
    check(run1.stdout === sha(PNG), 'the run received the exact bytes (SHA-256 equal to the stored asset)');
    check(seen[0].filter((p) => p.startsWith('attachments/')).length === 1, 'the same asset named twice is given once');
    check(!seen[0].some((p) => p.includes('cal-private')), "another person's file is NOT given to the run");
    check(run1.attachmentsUnavailable.some((u) => u.name === 'cal-private.txt' && u.reason === 'forbidden'), "and it is reported as forbidden");
    check(!seen[0].some((p) => p.includes('still-scanning')), 'a file still being scanned is NOT given');
    check(run1.attachmentsUnavailable.some((u) => u.name === 'still-scanning.csv' && u.reason === 'not_ready'), 'and it is reported as not ready');
    const payload = codeResultPayload(run1);
    check(payload.attachments?.length === 1 && payload.attachments[0].path === 'attachments/GRIDMASTER sheet.png' && payload.attachments[0].type === 'image/png' && payload.attachments[0].size === PNG.length,
      'the model is told the attachment: path, type and size');
    check(Array.isArray(payload.attachments_unavailable) && payload.attachments_unavailable.length === 2, 'and which attachments it could not have');
    check(run1.savedFiles.map((f) => f.path).join() === 'out/measure.json', 'only the new file is saved; the unchanged attachment is not');
    check(registered.join() === 'out/measure.json', 'only the new file is copied to the Library');

    const run2 = await runInSandbox({
      db: pool, conversationId: conv, ownerUserId: ada, language: 'python', code: 'print(2)', uploadsDir, library,
      execute: async (request) => {
        seen.push(request.files.map((f) => f.path));
        return { status: 'success', stdout: '', stderr: '', exitCode: 0, outputFiles: [{ path: 'attachments/GRIDMASTER sheet.png', content: Buffer.from('overwritten').toString('base64') }] };
      },
    });
    check(seen[1].includes('attachments/GRIDMASTER sheet.png') && seen[1].includes('out/measure.json'), 'a later run gets the attachment again, beside its own earlier file');
    check(run2.skippedFiles.some((s) => s.path === 'attachments/GRIDMASTER sheet.png' && s.reason === 'attachments_are_read_only'), 'a changed attachment is refused as read-only');
    const inStore = (await pool.query(`SELECT count(*)::int c FROM chat_sandbox_files f JOIN chat_sandboxes s ON s.id = f.sandbox_id WHERE s.conversation_id = $1 AND f.path LIKE 'attachments/%'`, [conv])).rows[0].c;
    check(inStore === 0, 'the sandbox store holds no copy of any attachment');

    // the shared reader still serves image generation, with its own rules
    const refs = await readGenerationReferences(pool, { id: ada }, [sheet], { uploadsDir });
    check(refs.length === 1 && refs[0] === `data:image/png;base64,${PNG.toString('base64')}`, 'image generation still reads the reference');
    const refused = async (ids) => { try { await readGenerationReferences(pool, { id: ada }, ids, { uploadsDir }); return null; } catch (e) { return e.code || e.message; } };
    check(await refused([calsFile]) === 'reference_forbidden', "image generation still refuses another person's file");
    check(await refused([fakePng]) === 'reference_changed', 'a text file recorded as image/png is refused');
  } finally {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
    await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
