/**
 * /api/v2/spawn/skills (routes/spawnSkillRoutes.js) against a real database, behind the real oidcAuth:
 *  - a person sees their own and their workspace's skills, and never someone else's private one;
 *  - one version comes back with every file's bytes and sha256, matching what was stored, and a pinned old
 *    version stays readable after a newer one exists;
 *  - import runs the library's scans (a secret is refused, nothing saved) and lands in the person's library;
 *  - an agent's token is refused.
 * Run: DATABASE_URL=postgres://… node src/server/tests/spawn-skills.test.mjs
 */
import http from 'node:http';
import { createHash } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import { oidcAuth } from '../middleware/oidcAuth.js';
import spawnSkillRoutes from '../routes/spawnSkillRoutes.js';
import * as skillsSvc from '../services/skills.js';
import { writeTuples } from '../utils/authzReBAC.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
process.env.JWT_SECRET = JWT_SECRET;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };
const md = (name, description, body = 'Run the tests, then report.') => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${body}\n`;
const B = (s) => Buffer.from(s, 'utf8');
const sha = (b) => 'sha256:' + createHash('sha256').update(b).digest('hex');
const hex = (b) => createHash('sha256').update(b).digest('hex');
const digestOf = (files) => sha(Buffer.from(files.map((f) => [f.rel, sha(f.bytes)]).sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([r, d]) => r + ' ' + d).join('\n')));
const entry = (f) => ({ rel: f.rel, sha256: sha(f.bytes), bytes: f.bytes.length, mode: 438, executable: false });
function corpusSkill(name, files) {
  const log = [{ schema: 2, rev: 1, event: 'carried', at: '2026-10-05T00:00:00.000Z', actor: 'corpus skills carry', bundleDigest: digestOf(files), files: files.length, bytes: files.reduce((n, f) => n + f.bytes.length, 0), manifest: files.map(entry).sort((a, b) => (a.rel < b.rel ? -1 : 1)) }];
  const sidecar = { name, description: 'x', declaredName: name, origin: [{ tool: 'claude', kind: 'canonical' }], carriedAt: log[0].at, carriedBy: 'corpus skills carry', files: files.map(entry).sort((a, b) => (a.rel < b.rel ? -1 : 1)), bundleDigest: digestOf(files) };
  return { name, sidecar: JSON.stringify(sidecar), revisions: JSON.stringify(log[0]) + '\n', files: files.map((f) => ({ rel: f.rel, base64: f.bytes.toString('base64') })), objects: files.map((f) => ({ sha256: sha(f.bytes), base64: f.bytes.toString('base64') })) };
}

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  const mk = async (m) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW())
    ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`, [m, `${m}@example.test`])).rows[0].id;
  const ada = await mk('sps-ada'), eve = await mk('sps-eve'), bot = await mk('sps-bot');
  await pool.query(`INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [bot, ada]).catch(() => {});
  const ws = (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1, 'team', 'Acme', 'acme-sps-' || floor(random()*1e9)) RETURNING id`, [eve])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${ws}`, relation: 'owner', subject: `user:${eve}` }, { object: `workspace:${ws}`, relation: 'viewer', subject: `user:${ada}` }] });
  const token = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });

  const app = express(); app.use(express.json({ limit: '50mb' }));
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/v2/spawn/skills', oidcAuth, spawnSkillRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { tok, body } = {}) => {
    const r = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    return { s: r.status, j };
  };
  const A = token(ada), E = token(eve);
  const n = Date.now().toString(36);
  try {
    check((await call('GET', '/api/v2/spawn/skills')).s === 401, 'no token, no skills');
    const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0xff, 0xfe]);
    const mine = await skillsSvc.create(pool, { id: ada, kind: 'human' }, { files: [{ path: 'SKILL.md', content: md(`ada-${n}`, 'Use when testing.') }, { path: 'logo.png', base64: PNG.toString('base64') }] });
    const v2 = await skillsSvc.addVersion(pool, { id: ada, kind: 'human' }, mine.id, { files: [{ path: 'SKILL.md', content: md(`ada-${n}`, 'Use when testing.', 'v2') }] });
    const evePrivate = await skillsSvc.create(pool, { id: eve, kind: 'human' }, { files: [{ path: 'SKILL.md', content: md(`eve-${n}`, 'Eve only.') }] });
    const team = await skillsSvc.create(pool, { id: eve, kind: 'human' }, { workspaceId: ws, files: [{ path: 'SKILL.md', content: md(`team-${n}`, 'For the team.') }] });

    const list = await call('GET', '/api/v2/spawn/skills', { tok: A });
    const ids = (list.j.skills || []).map((s) => s.id);
    check(list.s === 200 && ids.includes(mine.id) && ids.includes(team.id) && !ids.includes(evePrivate.id), 'the list has my skills and my workspace’s, not someone else’s private one');
    const row = list.j.skills.find((s) => s.id === mine.id);
    check(row.version === v2.version && row.hash === v2.hash && row.owner.kind === 'personal', 'each row carries the latest version, its hash and its owner');

    check((await call('GET', `/api/v2/spawn/skills/${evePrivate.id}`, { tok: A })).s === 404, 'another person’s private skill is refused');
    const old = await call('GET', `/api/v2/spawn/skills/${mine.id}?version=1.0.0`, { tok: A });
    const png = old.j.skill.files.find((f) => f.path === 'logo.png'), skm = old.j.skill.files.find((f) => f.path === 'SKILL.md');
    check(old.s === 200 && old.j.skill.version === '1.0.0' && old.j.skill.hash === mine.hash, 'a pinned old version is still served after a newer one exists');
    check(png.encoding === 'base64' && Buffer.from(png.content, 'base64').equals(PNG) && png.sha256 === hex(PNG) && png.size === PNG.length, 'a binary file comes back byte for byte with its sha256');
    check(skm.encoding === 'utf8' && skm.sha256 === hex(B(skm.content)), 'a text file comes back as text with its sha256');
    check((await call('GET', `/api/v2/spawn/skills/${mine.id}?version=9.9.9`, { tok: A })).s === 404, 'a version that does not exist is a 404');

    const count = async () => (await pool.query('SELECT count(*)::int AS c FROM skill_versions')).rows[0].c;
    const c0 = await count();
    const leak = await call('POST', '/api/v2/spawn/skills/import', { tok: A, body: corpusSkill(`leak-${n}`, [{ rel: 'SKILL.md', bytes: B(md(`leak-${n}`, 'Use it.', 'key: sk-ant-api03-' + 'A'.repeat(90) + 'AA')) }]) });
    check(leak.s === 422 && leak.j.code === 'skill_has_secret' && (await count()) === c0, 'import runs the library’s scans: a secret is refused and nothing is saved');
    const imp = await call('POST', '/api/v2/spawn/skills/import', { tok: A, body: corpusSkill(`carried-${n}`, [{ rel: 'SKILL.md', bytes: B(md(`carried-${n}`, 'Use when carrying.')) }]) });
    check(imp.s === 201 && imp.j.skill.imported === 'new' && imp.j.skill.owner.kind === 'personal', 'an import lands in the person’s own library');
    const again = await call('POST', '/api/v2/spawn/skills/import', { tok: A, body: corpusSkill(`carried-${n}`, [{ rel: 'SKILL.md', bytes: B(md(`carried-${n}`, 'Use when carrying.')) }]) });
    check(again.s === 200, `importing the same skill again adds nothing new (${again.s} ${again.j && again.j.code})`);
    const wsImp = await call('POST', '/api/v2/spawn/skills/import', { tok: A, body: { ...corpusSkill(`teamimp-${n}`, [{ rel: 'SKILL.md', bytes: B(md(`teamimp-${n}`, 'x')) }]), workspaceId: ws } });
    check(wsImp.s === 403 || wsImp.s === 404, `a workspace they can only view refuses an import (${wsImp.s})`);

    const isAgent = (await pool.query('SELECT 1 FROM agent_identities WHERE user_id = $1', [bot])).rows.length;
    if (isAgent) check((await call('GET', '/api/v2/spawn/skills', { tok: token(bot) })).s === 403, 'an agent token is refused');
    else console.log('  skip agent token (could not create an agent identity row here)');
  } finally {
    server.close(); await pool.end();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
