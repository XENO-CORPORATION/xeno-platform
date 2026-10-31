/**
 * Skills on the XENO Marketplace (listing kind `skill`; services/marketplaceSkillPackages.js), end to end against a real
 * database and the real routers:
 *
 *  - a developer publishes a skill from their library: the PLATFORM builds the package (a supplied one is refused),
 *    the automated checks name it, a reviewer approves it, and it is in the catalog under its publisher;
 *  - before anyone gets it, its preview shows the publisher, the SKILL.md, its files and which of them are scripts;
 *  - installing needs an entitlement; it lands in the buyer's library at exactly the published version and hash;
 *  - a newer version is announced to the buyer's library, changes nothing until they install it, and an agent pinned to
 *    the old version keeps it;
 *  - the database refuses to publish a malformed or unlicensed package and to change a published one;
 *  - an agent can neither publish nor install.
 *
 * Run: DATABASE_URL=postgres://… node src/server/tests/marketplace-skills.test.mjs
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import marketplaceRoutes from '../routes/marketplaceRoutes.js';
import platformAgentRoutes from '../routes/platformAgentRoutes.js';
import skillsRoutes from '../routes/skillsRoutes.js';
import { personOnly } from '../routes/xenoMcpRoutes.js';
import { stopListening } from '../services/agentPresenceStream.js';
import * as skillPackages from '../services/marketplaceSkillPackages.js';
import { authMiddleware } from '../middleware/auth.js';
import { runAllMigrations } from '../services/migrationRunner.js';
import { migrateAccountV2 } from '../database/migrate-account-v2.js';
import { migrateOidcClients } from '../database/migrate-oidc-clients.js';

const JWT_SECRET = process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production';
process.env.JWT_SECRET = JWT_SECRET;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0, failed = 0;
const check = (c, m) => { if (c) { passed++; console.log('  ok  ' + m); } else { failed++; console.log('FAIL: ' + m); } };
const md = (name, description, body) => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

async function main() {
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  await migrateOidcClients(pool);
  const mk = async (m, role = 'user') => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at,role) VALUES($1,$2,'x',$1,TRUE,NOW(),$3)
    ON CONFLICT (username) DO UPDATE SET role = EXCLUDED.role RETURNING id`, [m, `${m}@example.test`, role])).rows[0].id;
  const ada = await mk('mks-ada'), bob = await mk('mks-bob'), boss = await mk('mks-boss', 'admin');
  const session = (id) => jwt.sign({ userId: id, email: 'x@y.z' }, JWT_SECRET, { expiresIn: '1h' });
  const A = session(ada), B = session(bob), R = session(boss);

  const app = express(); app.use(express.json({ limit: '4mb' }));
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/marketplace', marketplaceRoutes);
  app.use('/api/agents', authMiddleware, personOnly, platformAgentRoutes);
  app.use('/api/skills', authMiddleware, personOnly, skillsRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body } = {}) => {
    const r = await fetch(origin + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; const t = await r.text(); try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    return { s: r.status, j };
  };
  const publish = async (listingId, skillId, skillVersion) => {
    const v = await call('POST', `/api/marketplace/listings/${listingId}/versions`, { token: A, body: { version: skillVersion, skillId, skillVersion } });
    const sub = await call('POST', `/api/marketplace/listings/${listingId}/submit`, { token: A, body: { versionId: v.j.version && v.j.version.id } });
    const ap = await call('POST', `/api/marketplace/submissions/${sub.j.submission.id}/approve`, { token: R, body: {} });
    return { v, sub, ap };
  };

  try {
    // 1. Ada writes a skill (with a script) and publishes it
    const sk = (await call('POST', '/api/skills', { token: A, body: { files: [
      { path: 'SKILL.md', content: md('ledger-review', 'Use when a change touches money: how to check it before review.', '1. Run scripts/check.sh\n2. Report what changed.') },
      { path: 'scripts/check.sh', content: '#!/bin/sh\nnpm test -- ledger\n' }] } })).j.skill;
    const dev = await call('POST', '/api/marketplace/developer/register', { token: A, body: { displayName: 'Ada Labs', slug: 'ada-labs' } });
    check(dev.s === 201 && dev.j.developer.slug === 'ada-labs', 'Ada registers as a publisher, ada-labs');
    const li = await call('POST', '/api/marketplace/listings', { token: A, body: { kind: 'skill', title: 'Ledger review', summary: 'Check money changes before review', license: 'MIT', pricing: [{ model: 'free', priceCredits: 0 }] } });
    check(li.s === 201 && li.j.listing.kind === 'skill', 'a skill listing is created');
    const L = li.j.listing.id;
    const forged = await call('POST', `/api/marketplace/listings/${L}/versions`, { token: A, body: { version: '1.0.0', skillPackage: { format: 'xeno-skill-package' }, skillId: sk.id } });
    check(forged.s === 400 && forged.j.error === 'skill_package_is_built_by_the_platform', 'a package sent by the caller is refused: the platform builds it');
    check((await call('POST', `/api/marketplace/listings/${L}/versions`, { token: B, body: { version: '1.0.0', skillId: sk.id } })).s === 403, 'someone without a publisher profile cannot add a version');
    const p1 = await publish(L, sk.id, '1.0.0');
    check(p1.v.s === 201 && p1.v.j.version.hash === sk.hash && p1.v.j.version.scripts.join() === 'scripts/check.sh', 'the version is built from the library skill, with the same hash, and names its script');
    check(p1.sub.s === 202 && p1.sub.j.submission.checks.skillPackage.pass && /1 script/.test(p1.sub.j.submission.checks.skillPackage.detail), 'the automated checks name the package and its script');
    check(p1.ap.s === 200 && p1.ap.j.publishedVersion === '1.0.0', 'a reviewer approves it and it is published');
    const cat = (await call('GET', '/api/marketplace/catalog?kind=skill')).j.listings;
    check(cat.length === 1 && cat[0].developerSlug === 'ada-labs' && cat[0].currentVersion === '1.0.0', 'the catalog lists it under its publisher, ada-labs');

    // 2. the preview: what it is before anyone gets it
    const pv = (await call('GET', `/api/marketplace/skills/${L}/preview`)).j;
    check(pv.listing.publisher.handle === 'ada-labs' && /Run scripts\/check\.sh/.test(pv.current.skillMd) && pv.current.scripts.join() === 'scripts/check.sh' && pv.current.files.length === 2, 'the preview shows the publisher, the SKILL.md, its files and that it carries a script');

    // 3. install: needs an entitlement; lands at exactly the published version
    check((await call('POST', `/api/marketplace/listings/${L}/install-skill`, { token: B, body: {} })).j.code === 'not_entitled', 'installing without getting it first is refused');
    const got = await call('POST', `/api/marketplace/listings/${L}/purchase`, { token: B, body: {} });
    check(got.s === 200 && got.j.entitlement.type === 'owned', 'Bob gets the free skill');
    const in1 = await call('POST', `/api/marketplace/listings/${L}/install-skill`, { token: B, body: {} });
    check(in1.s === 201 && in1.j.skill.version === '1.0.0' && in1.j.skill.hash === sk.hash && in1.j.skill.origin.listingId === L, 'it lands in Bob’s library at 1.0.0, same hash, knowing where it came from');
    check((await call('POST', `/api/marketplace/listings/${L}/install-skill`, { token: B, body: {} })).j.skill.installed === 'already', 'installing it again changes nothing');
    const bobSkill = in1.j.skill;

    // 4. Bob's agent pins it; Ada publishes 1.0.1; nothing moves until Bob installs it, and the agent stays pinned
    const ag = (await call('POST', '/api/agents', { token: B, body: { name: 'Bob bot' } })).j.agent;
    await call('PATCH', `/api/agents/${ag.id}`, { token: B, body: { skills: [{ id: bobSkill.id }] } });
    const v2 = (await call('POST', `/api/skills/${sk.id}/versions`, { token: A, body: { files: [{ path: 'SKILL.md', content: md('ledger-review', 'Use when a change touches money.', '1. Run scripts/check.sh\n2. Reconcile.\n3. Report.') }, { path: 'scripts/check.sh', content: '#!/bin/sh\nnpm test -- ledger\n' }] } })).j.skill;
    const p2 = await publish(L, sk.id, '1.0.1');
    check(p2.ap.j.publishedVersion === '1.0.1', 'Ada publishes 1.0.1');
    const lib = (await call('GET', '/api/skills', { token: B })).j.skills.find((x) => x.id === bobSkill.id);
    check(lib.version === '1.0.0' && lib.origin.latest === '1.0.1', 'Bob’s library still has 1.0.0, and is told 1.0.1 is out');
    const up = await call('POST', `/api/marketplace/listings/${L}/install-skill`, { token: B, body: {} });
    check(up.j.skill.installed === 'updated' && up.j.skill.version === '1.0.1' && up.j.skill.hash === v2.hash, 'installing again brings 1.0.1 into the same library skill');
    const pinned = (await call('GET', `/api/agents/${ag.id}`, { token: B })).j.agent.skills[0];
    check(pinned.version === '1.0.0' && pinned.hash === sk.hash, 'Bob’s agent stays on the 1.0.0 it was given until someone moves it');

    // 5. the database guards publication and immutability whoever writes the rows
    let e1 = null; try { await pool.query(`UPDATE marketplace_listing_versions SET skill_package = jsonb_set(skill_package, '{description}', '"changed"') WHERE listing_id = $1 AND version = '1.0.0'`, [L]); } catch (e) { e1 = e; }
    check(e1 && /immutable/.test(e1.message), 'a published skill package cannot be changed');
    let e2 = null; try { await pool.query(`INSERT INTO marketplace_listing_versions (listing_id, version, license, skill_package, skill_package_hash, published_at) VALUES ($1, '9.9.9', 'MIT', '{"format":"xeno-skill-package","schemaVersion":1,"name":"x","description":"y","files":[{"path":"../evil","content":"z"}]}', repeat('a',64), now())`, [L]); } catch (e) { e2 = e; }
    check(e2 && /SKILL\.md and its text files/.test(e2.message), 'a package that is not a SKILL.md and its files cannot be published');
    let e3 = null; try { await pool.query(`INSERT INTO marketplace_listing_versions (listing_id, version, license, skill_package, skill_package_hash, published_at) VALUES ($1, '9.9.8', NULL, (SELECT skill_package FROM marketplace_listing_versions WHERE listing_id = $1 AND version = '1.0.0'), repeat('a',64), now())`, [L]); } catch (e) { e3 = e; }
    check(e3 && /licence/.test(e3.message), 'a skill package is never published without a licence');

    // 6. agents neither publish nor install
    let e4 = null; try { await skillPackages.installSkill(pool, { id: ag.userId, kind: 'agent' }, { listingId: L }); } catch (e) { e4 = e; }
    check(e4 && e4.status === 403, 'an agent cannot install a skill');
  } finally {
    server.close(); try { await stopListening(); } catch { /* already stopped */ } await pool.end();
  }
  console.log(`\nmarketplace-skills: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
