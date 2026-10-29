/**
 * A tool a person makes is a XENO Artifact of kind 'tool' (docs/decisions/2026-10-29-personal-tools-are-artifacts.md),
 * against a real Postgres, the REAL artifact routes behind the REAL authMiddleware, and filesystem storage:
 *
 *   - create as a tool with a category; a bad kind or category is refused; a page stays a page by default
 *   - GET /api/artifacts?kind=tool lists only the person's tools
 *   - keep-as-tool turns the person's own page into a tool, never someone else's, and never touches the files
 *   - the view token's reply carries the sealed frame address; tools.xenosystem.ai may frame raw pages
 *
 *   node src/server/tests/artifact-tools.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { authMiddleware } from '../middleware/auth.js';
import artifactRoutes from '../routes/artifactRoutes.js';
import { frameAncestor } from '../routes/artifactViewerRoutes.js';
import { _internal as storageInternal, setArtifactStorageForTests } from '../services/artifactStorage.js';
import { runAllMigrations } from '../services/migrationRunner.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };
const tag = `at${Date.now().toString(36)}`;
const TOOL = '<!doctype html><title>Logo export kit</title><h1>Drop a logo</h1><script>document.title += " ready"</script>';

async function main() {
  await runAllMigrations(pool);
  const storageDir = mkdtempSync(path.join(tmpdir(), 'xeno-artifact-tools-test-'));
  setArtifactStorageForTests(storageInternal.fsBackend(storageDir));
  try {
    const mk = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1, $2, $3, true, true, 'x') RETURNING id`, [`${tag}_${s}`, `${tag}_${s}@xeno.test`, s])).rows[0].id;
    const me = await mk('me'), other = await mk('other');
    const as = (id, s) => ({ authorization: `Bearer ${jwt.sign({ userId: id, email: `${tag}_${s}@xeno.test`, username: `${tag}_${s}` }, JWT_SECRET, { expiresIn: '1h' })}`, 'content-type': 'application/json' });
    const ME = as(me, 'me'), OTHER = as(other, 'other');

    const app = express();
    app.use(express.json({ limit: '30mb' }));
    app.use((req, _res, next) => { req.db = pool; next(); });
    app.use('/api/artifacts', authMiddleware, artifactRoutes);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}/api/artifacts`;
    const call = async (method, p, headers, body) => { const r = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, d: await r.json().catch(() => ({})) }; };
    try {
      const t1 = await call('POST', '', ME, { html: TOOL, title: 'Logo export kit', kind: 'tool', category: 'generator' });
      check(t1.status === 201 && t1.d.artifact.kind === 'tool' && t1.d.artifact.category === 'generator', 'a person creates a tool, with its category');
      check((await call('POST', '', ME, { html: TOOL, kind: 'plugin' })).d.code === 'invalid_kind', 'an unknown kind is refused');
      check((await call('POST', '', ME, { html: TOOL, kind: 'tool', category: 'weapons' })).d.code === 'invalid_category', 'an unknown category is refused');
      const page = await call('POST', '', ME, { html: '<!doctype html><title>Notes</title><p>hi</p>' });
      check(page.status === 201 && page.d.artifact.kind === 'page' && page.d.artifact.category === undefined, 'without a kind it is a page, as before');

      const mine = await call('GET', '?kind=tool', ME);
      check(mine.status === 200 && mine.d.artifacts.length === 1 && mine.d.artifacts[0].id === t1.d.artifact.id, 'My tools lists only the person’s tools');
      check((await call('GET', '?kind=tool', OTHER)).d.artifacts.length === 0, 'and never someone else’s');

      const pid = page.d.artifact.id;
      check((await call('POST', `/${pid}/keep-as-tool`, OTHER, { category: 'utility' })).status === 404, 'nobody can keep someone else’s page as a tool');
      const files0 = (await pool.query('SELECT content_hash FROM artifact_revisions WHERE artifact_id = $1', [pid])).rows[0].content_hash;
      const kept = await call('POST', `/${pid}/keep-as-tool`, ME, { category: 'utility' });
      const files1 = (await pool.query('SELECT content_hash FROM artifact_revisions WHERE artifact_id = $1', [pid])).rows[0].content_hash;
      check(kept.status === 200 && kept.d.artifact.kind === 'tool' && kept.d.artifact.category === 'utility' && files0 === files1, 'the owner keeps a page as a tool; its files are untouched');
      check((await call('GET', '?kind=tool', ME)).d.artifacts.length === 2, 'and it appears in My tools');
      check((await pool.query("SELECT count(*)::int n FROM security_events WHERE event_type = 'artifact_kept_as_tool' AND user_id = $1", [me])).rows[0].n === 1, 'keeping is in the audit log');
      let refused = false;
      try { await pool.query("UPDATE artifacts SET category = 'ai' WHERE id = (SELECT id FROM artifacts WHERE kind = 'page' AND owner_user_id = $1 LIMIT 1)", [other]); } catch { refused = true; }
      await call('POST', '', OTHER, { html: '<!doctype html><title>x</title>' });
      try { await pool.query("UPDATE artifacts SET category = 'ai' WHERE kind = 'page' AND owner_user_id = $1", [other]); } catch { refused = true; }
      check(refused, 'the database refuses a category on a page');

      const vt = await call('POST', `/${t1.d.artifact.id}/view-token`, ME, {});
      check(vt.status === 200 && new RegExp(`^/a/${t1.d.artifact.id}/v/[^/]+/r/1/index\\.html$`).test(vt.d.frameUrl), `the view token comes with the sealed frame address (${vt.d.frameUrl})`);
      check(frameAncestor({}, { PUBLIC_ORIGIN: 'https://xenosystem.ai' }).split(' ').includes('https://tools.xenosystem.ai') && frameAncestor({}, {}) === "'self'", 'tools.xenosystem.ai may frame a raw page; with no public origin only the page’s own origin may');
    } finally { server.close(); }
  } finally { rmSync(storageDir, { recursive: true, force: true }); }
  console.log(`\nartifact-tools: ${passed} checks passed`);
}

main().then(() => pool.end(), (e) => { console.error(e); process.exit(1); });
