/**
 * Proves the chat-sandbox storage service (services/chatSandbox.js) end to end against a REAL
 * Postgres and a REAL object-store backend (fs): create a sandbox for a conversation, save a run's
 * output files, read them back as run inputs, skip unchanged files, and refuse writes past the quota.
 *
 * Spins its own throwaway postgres:16-alpine via the `docker` CLI (the platform repo does not depend
 * on dockerode), so it needs only Docker — no external database. Set XENO_SANDBOX_SMOKE_DSN to point
 * at an existing Postgres instead. Every gate REPORTS; exits non-zero if any fail.
 *
 * Mutation-checkable: break saveSandboxFiles' quota check -> G4 fails; break the unchanged-skip ->
 * G3 fails; break restore -> G2 fails.
 */
import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// fs object-store backend under a temp dir, chosen before the module caches its backend.
process.env.ARTIFACTS_DIR = mkdtempSync(join(tmpdir(), 'xeno-sandbox-store-'));
delete process.env.ARTIFACTS_R2_BUCKET;

const b64 = (s) => Buffer.from(s).toString('base64');
const results = [];
const gate = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();

let cid = null;
let pool = null;
const externalDsn = process.env.XENO_SANDBOX_SMOKE_DSN;
try {
  let connectionString = externalDsn;
  if (!externalDsn) {
    const hostPort = 15400 + (process.pid % 1000);
    cid = docker(
      'run', '-d', '--rm',
      '-e', 'POSTGRES_PASSWORD=smoke', '-e', 'POSTGRES_DB=smoke',
      '-p', `${hostPort}:5432`, 'postgres:16-alpine',
    );
    connectionString = `postgres://postgres:smoke@localhost:${hostPort}/smoke`;
  }

  for (let i = 0; i < 60; i++) {
    try {
      const c = new pg.Client({ connectionString });
      await c.connect();
      await c.query('SELECT 1');
      await c.end();
      break;
    } catch {
      if (i === 59) throw new Error('postgres never became ready');
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  pool = new pg.Pool({ connectionString, max: 4 });

  // Minimal FK targets, then the real migration (proves the migration SQL applies cleanly).
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query('CREATE TABLE IF NOT EXISTS users (id UUID PRIMARY KEY DEFAULT gen_random_uuid())');
  await pool.query('CREATE TABLE IF NOT EXISTS chat_conversations (id UUID PRIMARY KEY DEFAULT gen_random_uuid())');
  const migration = readFileSync(new URL('../src/server/database/migrations/20260926200000-chat-sandboxes.sql', import.meta.url), 'utf8');
  await pool.query(migration);
  gate('G0 the migration SQL applies cleanly on a fresh database', true);

  const { getOrCreateSandbox, saveSandboxFiles, restoreSandboxFiles, listSandboxFiles } = await import('../src/server/services/chatSandbox.js');

  const userId = (await pool.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0].id;
  const convId = (await pool.query('INSERT INTO chat_conversations DEFAULT VALUES RETURNING id')).rows[0].id;

  // --- G1: create sandbox + save a run's outputs ---
  let sandbox = await getOrCreateSandbox(pool, convId, userId);
  const again = await getOrCreateSandbox(pool, convId, userId);
  const r1 = await saveSandboxFiles(pool, sandbox, [
    { path: 'notes.txt', content: b64('hello world'), size: 11 },
    { path: 'out/data.json', content: b64('{"n":42}'), size: 8 },
  ]);
  gate("G1 one sandbox per conversation; a run's output files are saved", sandbox.id === again.id && r1.saved.length === 2 && r1.fileCount === 2, JSON.stringify({ same: sandbox.id === again.id, saved: r1.saved.map((f) => f.path), total: r1.totalBytes }));

  // --- G2: restore returns them as run inputs, with correct bytes ---
  sandbox = await getOrCreateSandbox(pool, convId, userId);
  const restored = await restoreSandboxFiles(pool, sandbox.id);
  const notes = restored.find((f) => f.path === 'notes.txt');
  const dataj = restored.find((f) => f.path === 'out/data.json');
  gate('G2 the sandbox restores as run inputs with correct content', !!notes && Buffer.from(notes.content, 'base64').toString() === 'hello world' && !!dataj && Buffer.from(dataj.content, 'base64').toString() === '{"n":42}', JSON.stringify({ paths: restored.map((f) => f.path) }));

  // --- G3: an unchanged file on a later run is not rewritten ---
  const r3 = await saveSandboxFiles(pool, sandbox, [{ path: 'notes.txt', content: b64('hello world'), size: 11 }]);
  gate('G3 an unchanged file is skipped (no rewrite)', r3.saved.length === 0 && r3.fileCount === 2, JSON.stringify(r3.saved));

  // --- G4: a write past the quota is refused, not silently accepted ---
  await pool.query('UPDATE chat_sandboxes SET quota_bytes = total_bytes + 4 WHERE id = $1', [sandbox.id]);
  sandbox = await getOrCreateSandbox(pool, convId, userId);
  const r4 = await saveSandboxFiles(pool, sandbox, [{ path: 'big.bin', content: b64('X'.repeat(1000)), size: 1000 }]);
  gate('G4 a write past the per-conversation quota is refused', r4.saved.length === 0 && r4.skipped.some((s) => s.reason === 'quota_exceeded'), JSON.stringify({ saved: r4.saved, skipped: r4.skipped }));

  // --- G5: manifest reflects exactly what was saved ---
  const manifest = await listSandboxFiles(pool, sandbox.id);
  gate('G5 the manifest lists exactly the saved files', manifest.length === 2 && manifest.map((f) => f.path).sort().join(',') === 'notes.txt,out/data.json', JSON.stringify(manifest.map((f) => f.path)));
} catch (err) {
  console.error('smoke crashed:', err instanceof Error ? err.stack : String(err));
  results.push({ name: 'crash', ok: false });
} finally {
  if (pool) await pool.end().catch(() => {});
  if (cid) {
    try { docker('rm', '-f', cid); } catch { /* already gone */ }
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} gates passed`);
process.exit(failed.length ? 1 : 0);
