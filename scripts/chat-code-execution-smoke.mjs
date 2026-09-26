/**
 * CAPSTONE: per-chat code execution end to end (CHAT-CODE-EXECUTION-SPEC.md steps 1–3 glued).
 *
 * Drives runInSandbox against a REAL running xenorun and a REAL Postgres, across TWO turns: turn 1
 * writes a file and prints; turn 2 reads that file back — proving the conversation's sandbox persists
 * between runs over stateless, one-shot compute. Also proves the reachability probe sees the engine.
 *
 * Requires a running xenorun; set XENORUN_URL (default http://localhost:13939). Spins its own throwaway
 * Postgres via the `docker` CLI. Every gate REPORTS; exits non-zero if any fail.
 *
 *   XENORUN_URL=http://localhost:13939 node scripts/chat-code-execution-smoke.mjs
 *
 * Mutation-checkable: break restore in chatSandbox -> G3 fails (turn 2 can't see turn 1's file).
 */
process.env.XENORUN_URL = process.env.XENORUN_URL || 'http://localhost:13939';
process.env.ARTIFACTS_DIR = process.env.ARTIFACTS_DIR || (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'xeno-codeexec-'));
delete process.env.ARTIFACTS_R2_BUCKET;

import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const results = [];
const gate = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`); };
const docker = (...a) => execFileSync('docker', a, { encoding: 'utf8' }).trim();

let cid = null;
let pool = null;
try {
  const { codeExecutionAvailable, runInSandbox } = await import('../src/server/services/sandboxSession.js');

  // --- G0: the engine is reachable (probe) ---
  const up = await codeExecutionAvailable(globalThis.fetch, Date.now());
  gate('G0 the code-execution engine is reachable (probe)', up === true, `XENORUN_URL=${process.env.XENORUN_URL}`);
  if (!up) throw new Error(`xenorun not reachable at ${process.env.XENORUN_URL} — start it first`);

  // --- Postgres ---
  const hostPort = 15600 + (process.pid % 1000);
  cid = docker('run', '-d', '--rm', '-e', 'POSTGRES_PASSWORD=smoke', '-e', 'POSTGRES_DB=smoke', '-p', `${hostPort}:5432`, 'postgres:16-alpine');
  const connectionString = `postgres://postgres:smoke@localhost:${hostPort}/smoke`;
  for (let i = 0; i < 60; i++) {
    try { const c = new pg.Client({ connectionString }); await c.connect(); await c.query('SELECT 1'); await c.end(); break; }
    catch { if (i === 59) throw new Error('postgres never ready'); await new Promise((r) => setTimeout(r, 500)); }
  }
  pool = new pg.Pool({ connectionString, max: 4 });
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query('CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid())');
  await pool.query('CREATE TABLE IF NOT EXISTS chat_conversations (id UUID PRIMARY KEY DEFAULT gen_random_uuid())');
  await pool.query(readFileSync(new URL('../src/server/database/migrations/20260926200000-chat-sandboxes.sql', import.meta.url), 'utf8'));

  const userId = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id;
  const convId = (await pool.query('INSERT INTO chat_conversations DEFAULT VALUES RETURNING id')).rows[0].id;

  // --- G1: turn 1 runs code that writes a file ---
  const turn1 = await runInSandbox({
    db: pool, conversationId: convId, ownerUserId: userId, language: 'python',
    code: "open('counter.txt','w').write('7')\nprint('wrote counter=7')",
  });
  gate('G1 turn 1 runs and writes a file into the sandbox', turn1.status === 'success' && turn1.stdout.includes('wrote counter=7') && turn1.savedFiles.some((f) => f.path === 'counter.txt'), JSON.stringify({ status: turn1.status, saved: turn1.savedFiles.map((f) => f.path), stdout: turn1.stdout.trim() }));

  // --- G2: turn 2 is a SEPARATE run and still sees turn 1's file (persistence) ---
  const turn2 = await runInSandbox({
    db: pool, conversationId: convId, ownerUserId: userId, language: 'python',
    code: "n = int(open('counter.txt').read())\nopen('counter.txt','w').write(str(n+1))\nprint('read', n, '-> wrote', n+1)",
  });
  gate('G2 turn 2 reads the file turn 1 wrote (the sandbox persists across runs)', turn2.status === 'success' && turn2.stdout.includes('read 7 -> wrote 8'), JSON.stringify({ status: turn2.status, stdout: turn2.stdout.trim(), stderr: turn2.stderr.trim() }));

  // --- G3: a DIFFERENT conversation gets its OWN sandbox (isolation) ---
  const convId2 = (await pool.query('INSERT INTO chat_conversations DEFAULT VALUES RETURNING id')).rows[0].id;
  const other = await runInSandbox({
    db: pool, conversationId: convId2, ownerUserId: userId, language: 'python',
    code: "import os\nprint('has counter:', os.path.exists('counter.txt'))",
  });
  gate('G3 a different conversation has its own empty sandbox (per-chat isolation)', other.status === 'success' && other.stdout.includes('has counter: False'), JSON.stringify({ stdout: other.stdout.trim() }));

  // --- G4: the persisted value is correct in a third turn on the first conversation ---
  const turn3 = await runInSandbox({
    db: pool, conversationId: convId, ownerUserId: userId, language: 'python',
    code: "print('counter is', open('counter.txt').read())",
  });
  gate('G4 state accumulates across turns (counter is now 8)', turn3.stdout.includes('counter is 8'), JSON.stringify({ stdout: turn3.stdout.trim() }));
} catch (err) {
  console.error('smoke crashed:', err instanceof Error ? err.stack : String(err));
  results.push({ name: 'crash', ok: false });
} finally {
  if (pool) await pool.end().catch(() => {});
  if (cid) { try { docker('rm', '-f', cid); } catch { /* gone */ } }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
process.exit(failed.length ? 1 : 0);
