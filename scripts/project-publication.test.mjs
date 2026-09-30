import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createAuthorizedProject } from '../src/server/services/chatProjectAuthority.js';
import { writeTuples, check } from '../src/server/utils/authzReBAC.js';
import { readProjectPublication, previewProjectPublication, mutateProjectPublication, readProjectPublicationOperation,
  readPublicProject, discoverPublicProjects } from '../src/server/services/projectPublication.js';

const url = process.env.TEST_DATABASE_URL;
test('project publication is explicit, receipted and revocable without publishing private project authority', { skip: !url, timeout: 120000 }, async t => {
  assert.match(new URL(url).pathname, /^\/(?:xeno_qual_[a-f0-9]{32}|chatproof)$/);
  assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
  const pool = new pg.Pool({ connectionString: url, max: 8 }); t.after(() => pool.end());
  const user = async () => { const name = randomUUID(); return (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'fixture',$1,true) RETURNING id`, [name, `${name}@example.test`])).rows[0].id; };
  // Empty rollback/reapply and retained-state refusal are tested in the same real schema.
  const { readFile } = await import('node:fs/promises');
  const migration = await readFile(new URL('../src/server/database/migrations/20260930010000-project-publications.sql', import.meta.url), 'utf8');
  const [up, down] = migration.split('-- DOWN');
  await pool.query(down); await pool.query(up);
  const owner = await user(), stranger = await user();
  const project = await createAuthorizedProject(pool, { principal: { type: 'user', id: owner }, name: 'PRIVATE-NAME',
    description: 'PRIVATE-DESCRIPTION', customInstructions: 'PRIVATE-INSTRUCTIONS', settings: { privatePath: 'C:/PRIVATE-PATH' } });
  const context = actorUserId => ({ actorUserId, clientId: 'fixture-publication' });
  const base = { projectId: project.id, expectedActorAccountId: owner };
  const content = { schemaVersion: 1, title: 'Published title', purpose: 'Public purpose', license: 'All rights reserved', termsVersion: 'v1', contributionGuide: 'No automatic execution permission.', roadmap: 'A reviewed public summary.', updates: '' };
  await assert.rejects(readPublicProject(pool, project.id), { code: 'project_not_found' });
  await assert.rejects(readProjectPublication(pool, context(stranger), base), { code: 'actor_changed' });
  await assert.rejects(readProjectPublication(pool, context(stranger), { ...base, expectedActorAccountId: stranger }), { code: 'project_not_found' });
  assert.equal((await readProjectPublication(pool, context(owner), base)).revision, '0');
  const draft = { ...base, action: 'draft', operationId: randomUUID(), expectedRevision: '0', content };
  const saved = await mutateProjectPublication(pool, context(owner), draft);
  assert.equal(saved.operation.revision, '1');
  await assert.rejects(pool.query(down), { code: '23514' }, 'rollback refuses retained publication state');
  assert.equal((await mutateProjectPublication(pool, context(owner), draft)).replayed, true);
  await assert.rejects(mutateProjectPublication(pool, context(owner), { ...draft, content: { ...content, title: 'Changed' } }), { code: 'operation_identity_conflict' });
  const preview = await previewProjectPublication(pool, context(owner), { ...base, visibility: 'unlisted' });
  assert.equal(preview.projection.maintainer.id, owner);
  const publish = { ...base, action: 'publish', operationId: randomUUID(), expectedRevision: '1', visibility: 'unlisted', previewHash: preview.previewHash };
  await assert.rejects(mutateProjectPublication(pool, context(owner), { ...publish, previewHash: '0'.repeat(64) }), { code: 'preview_changed' }, 'publication requires the exact preview hash');
  assert.equal((await readProjectPublicationOperation(pool, context(owner), { ...base, operationId: publish.operationId })).state, 'not-observed');
  await mutateProjectPublication(pool, context(owner), publish);
  const visible = await readPublicProject(pool, project.id);
  assert.equal(visible.title, content.title);
  assert.equal(visible.visibility, 'unlisted');
  for (const secret of ['PRIVATE-NAME', 'PRIVATE-DESCRIPTION', 'PRIVATE-INSTRUCTIONS', 'PRIVATE-PATH', 'custom_instructions', 'settings', 'chat_count']) assert(!JSON.stringify(visible).includes(secret), `public projection excludes ${secret}`);
  assert.equal((await discoverPublicProjects(pool)).projects.length, 0, 'unlisted publication never enters discovery');
  assert.equal((await check(pool, { object: `project:${project.id}`, relation: 'viewer', subject: `user:${stranger}` })).allowed, false, 'publication grants no private project authority');
  const publicPreview = await previewProjectPublication(pool, context(owner), { ...base, visibility: 'public' });
  await mutateProjectPublication(pool, context(owner), { ...publish, operationId: randomUUID(), expectedRevision: '2', visibility: 'public', previewHash: publicPreview.previewHash });
  assert.equal((await discoverPublicProjects(pool)).projects[0].projectId, project.id);
  // New draft does not silently edit the published snapshot.
  await mutateProjectPublication(pool, context(owner), { ...draft, operationId: randomUUID(), expectedRevision: '3', content: { ...content, title: 'Unpublished draft' } });
  assert.equal((await readPublicProject(pool, project.id)).title, content.title);
  const revoke = { ...base, action: 'revoke', operationId: randomUUID(), expectedRevision: '4' };
  await mutateProjectPublication(pool, context(owner), revoke);
  await assert.rejects(readPublicProject(pool, project.id), { code: 'project_not_found' }, 'revoked publication cannot be read by known ID');
  assert.equal((await discoverPublicProjects(pool)).projects.length, 0);
  // Retrying an old successful publish returns history, never resurrects disclosure.
  assert.equal((await mutateProjectPublication(pool, context(owner), publish)).replayed, true);
  await assert.rejects(readPublicProject(pool, project.id), { code: 'project_not_found' });
  assert.equal((await readProjectPublicationOperation(pool, context(owner), { ...base, operationId: publish.operationId })).state, 'committed');
  await assert.rejects(pool.query('UPDATE project_publication_versions SET projection=projection'), { code: '23514' });
  await assert.rejects(pool.query('DELETE FROM project_publication_operations'), { code: '23514' });
  // Viewer visibility never becomes publication management authority.
  await writeTuples(pool, { writes: [{ object: `project:${project.id}`, relation: 'viewer', subject: `user:${stranger}` }] });
  await assert.rejects(mutateProjectPublication(pool, context(stranger), { ...revoke, operationId: randomUUID(), expectedActorAccountId: stranger, expectedRevision: '5' }), { code: 'project_not_found' }, 'viewer cannot mutate project publication');
  // Real mounted HTTP boundary, with fixture-only JWTs and no auth replacement.
  process.env.JWT_SECRET = randomUUID() + randomUUID();
  const { createRequire } = await import('node:module');
  const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
  const { default: express } = await import('express');
  const { default: router } = await import('../src/server/routes/projectPublicationRoutes.js');
  const { browserSessionMiddleware } = await import('../src/server/middleware/browserSession.js');
  const app = express(); app.use(express.json({ limit: '1mb' })); app.use(browserSessionMiddleware(pool));
  app.use((req, _res, next) => { req.db = pool; next(); });
  app.use('/api/public-projects', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const http = async (path, body, actor = owner) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/public-projects${path}`, {
      method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json',
        ...(actor ? { authorization: `Bearer ${jwt.sign({ userId: actor }, process.env.JWT_SECRET, { expiresIn: '5m' })}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.match(response.headers.get('cache-control'), /no-store/);
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await http('/state', base, null)).status, 401);
  assert.equal((await http('/state', base, stranger)).status, 403);
  assert.equal((await http('/state', base)).status, 200);
  assert.equal((await http('/state', { ...base, padding: 'x'.repeat(50 * 1024) })).status, 400, 'body cap holds after global JSON parsing');
  const { createHash } = await import('node:crypto');
  const sessionToken = randomUUID(), csrf = randomUUID(), sid = randomUUID();
  const digest = value => createHash('sha256').update(value).digest('hex');
  await pool.query("INSERT INTO user_sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [sid, owner, digest(sessionToken)]);
  await pool.query("INSERT INTO browser_session_state(sid,csrf_hash,purpose) VALUES($1,$2,'standard')", [sid, digest(csrf)]);
  const cookieCall = async includeCsrf => fetch(`http://127.0.0.1:${server.address().port}/api/public-projects/state`, { method: 'POST',
    headers: { 'content-type': 'application/json', cookie: `xeno_session=${sessionToken}; xeno_csrf=${csrf}`, ...(includeCsrf ? { 'x-xeno-csrf': csrf } : {}) }, body: JSON.stringify(base) });
  const refusedCookie = await cookieCall(false); await refusedCookie.text();
  assert.equal(refusedCookie.status, 403, 'cookie request without CSRF is refused');
  const acceptedCookie = await cookieCall(true); await acceptedCookie.text();
  assert.equal(acceptedCookie.status, 200, 'canonical browser session authenticates publication management');
  const { generateKeyPairSync } = await import('node:crypto');
  const { getSigningKey } = await import('../src/server/utils/oidcProvider.js');
  const { jwkThumbprint, accessTokenHash } = await import('../src/server/utils/dpop.js');
  const { issuer } = await import('../src/server/config/hosts.js');
  const signer = await getSigningKey(pool), key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = key.publicKey.export({ format: 'jwk' }), jkt = jwkThumbprint(jwk), now = Math.floor(Date.now() / 1000), oauthSid = randomUUID();
  await pool.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch) VALUES($1,0) ON CONFLICT DO NOTHING', [owner]);
  await pool.query(`INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at)
    VALUES($1,$2,0,to_timestamp($3),$4,now()+interval '1 hour')`, [oauthSid, owner, now, jkt]);
  const oidcCall = async (scope, proofPresent = true) => {
    const path = '/api/public-projects/state';
    const token = jwt.sign({ sub: owner, sid: oauthSid, auth_epoch: 0, auth_time: now, client_id: 'xeno-agent-interface', scope, typ: 'at+jwt', cnf: { jkt } },
      signer.privatePem, { algorithm: signer.alg, keyid: signer.kid, audience: 'xeno-api', expiresIn: '5m', header: { typ: 'at+jwt' } });
    const proof = jwt.sign({ jti: randomUUID(), htm: 'POST', htu: issuer() + path, ath: accessTokenHash(token), iat: now }, key.privateKey,
      { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk } });
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `DPoP ${token}`, ...(proofPresent ? { dpop: proof } : {}) }, body: JSON.stringify(base) });
    await response.text(); return response.status;
  };
  assert.equal(await oidcCall('projects:read'), 200, 'sender-bound scoped OIDC request succeeds');
  assert.equal(await oidcCall('openid'), 403, 'OIDC without project scope is refused');
  assert.equal(await oidcCall('projects:read', false), 401, 'bound token without DPoP proof is refused');
  assert.equal((await http('/' + project.id, null, null)).status, 404);
  assert.deepEqual((await http('/', null, null)).body.result.projects, []);
  const hPreview = await http('/preview', { ...base, visibility: 'public' });
  assert.equal(hPreview.status, 200);
  const hPublish = await http('/operations', { ...base, action: 'publish', operationId: randomUUID(), expectedRevision: '5', visibility: 'public', previewHash: hPreview.body.result.previewHash });
  assert.equal(hPublish.status, 200);
  const hRead = await http('/' + project.id, null, null);
  assert.equal(hRead.status, 200);
  assert.equal(hRead.body.result.title, 'Unpublished draft');
  assert(!JSON.stringify(hRead.body).includes('PRIVATE-INSTRUCTIONS'));
  assert.equal((await http('/operations', { ...base, action: 'revoke', operationId: randomUUID(), expectedRevision: '6' })).status, 200);
  assert.equal((await http('/' + project.id, null, null)).status, 404);
  const finalPreview = await previewProjectPublication(pool, context(owner), { ...base, visibility: 'public' });
  await mutateProjectPublication(pool, context(owner), { ...publish, operationId: randomUUID(), expectedRevision: '7', visibility: 'public', previewHash: finalPreview.previewHash });
  await pool.query('UPDATE chat_projects SET is_archived=true WHERE id=$1', [project.id]);
  await assert.rejects(readPublicProject(pool, project.id), { code: 'project_not_found' });
  await pool.query('UPDATE chat_projects SET is_archived=false WHERE id=$1', [project.id]);
  await assert.rejects(readPublicProject(pool, project.id), { code: 'project_not_found' });
  assert.equal((await readProjectPublication(pool, context(owner), base)).visibility, 'private', 'unarchive cannot resurrect a public page');
  const workspace = (await pool.query(`INSERT INTO workspaces(owner_user_id,name,slug,workspace_type)
    VALUES($1,'PRIVATE-WORKSPACE',$2,'team') RETURNING id`, [owner, randomUUID()])).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `workspace:${workspace}`, relation: 'owner', subject: `user:${owner}` }] });
  const workspaceProjects = [];
  for (let i = 0; i < 2; i++) {
    const p = await createAuthorizedProject(pool, { principal: { type: 'user', id: owner }, workspaceId: workspace, name: `Private ${i}` });
    workspaceProjects.push(p.id);
    const wb = { projectId: p.id, expectedActorAccountId: owner };
    await mutateProjectPublication(pool, context(owner), { ...wb, action: 'draft', operationId: randomUUID(), expectedRevision: '0', content });
    const wp = await previewProjectPublication(pool, context(owner), { ...wb, visibility: 'public' });
    await mutateProjectPublication(pool, context(owner), { ...wb, action: 'publish', operationId: randomUUID(), expectedRevision: '1', visibility: 'public', previewHash: wp.previewHash });
  }
  const firstPage = await discoverPublicProjects(pool, { limit: 1 });
  assert.equal(firstPage.projects.length, 1); assert(firstPage.nextCursor);
  const secondPage = await discoverPublicProjects(pool, { limit: 1, after: firstPage.nextCursor });
  assert.equal(secondPage.projects.length, 1); assert.equal(secondPage.nextCursor, null);
  assert.notEqual(firstPage.projects[0].projectId, secondPage.projects[0].projectId);
  assert(!JSON.stringify(firstPage).includes('PRIVATE-WORKSPACE'));
  await pool.query("UPDATE workspaces SET status='archived' WHERE id=$1", [workspace]);
  assert.equal((await discoverPublicProjects(pool)).projects.length, 0, 'inactive workspace hides its public projections');
  await assert.rejects(readPublicProject(pool, workspaceProjects[0]), { code: 'project_not_found' });
  const failedOperation = randomUUID();
  const failingPool = { connect: async () => {
    const client = await pool.connect();
    return { query: (sql, params) => {
      if (String(sql).includes('INSERT INTO project_publication_operations')) throw new Error('Fixture receipt storage failure');
      return client.query(sql, params);
    }, release: () => client.release() };
  } };
  const failedPreview = await previewProjectPublication(pool, context(owner), { ...base, visibility: 'public' });
  await assert.rejects(mutateProjectPublication(failingPool, context(owner), { ...publish, operationId: failedOperation,
    expectedRevision: '9', visibility: 'public', previewHash: failedPreview.previewHash }), /Fixture receipt storage failure/);
  assert.equal((await readProjectPublication(pool, context(owner), base)).revision, '9', 'receipt failure rolls back publication revision');
  await assert.rejects(readPublicProject(pool, project.id), { code: 'project_not_found' }, 'receipt failure never leaves a public effect');
  assert.equal((await readProjectPublicationOperation(pool, context(owner), { ...base, operationId: failedOperation })).state, 'not-observed');
  const concurrent = await Promise.allSettled([
    mutateProjectPublication(pool, context(owner), { ...draft, operationId: randomUUID(), expectedRevision: '9', content: { ...content, title: 'First contender' } }),
    mutateProjectPublication(pool, context(owner), { ...draft, operationId: randomUUID(), expectedRevision: '9', content: { ...content, title: 'Second contender' } }),
  ]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1, 'exactly one revision wins');
  assert.equal(concurrent.find(result => result.status === 'rejected').reason.code, 'publication_revision_conflict');
  const ownerPreview = await previewProjectPublication(pool, context(owner), { ...base, visibility: 'public' });
  await mutateProjectPublication(pool, context(owner), { ...publish, operationId: randomUUID(), expectedRevision: '10', visibility: 'public', previewHash: ownerPreview.previewHash });
  await pool.query('UPDATE chat_projects SET owner_user_id=$2,user_id=$2 WHERE id=$1', [project.id, stranger]);
  await pool.query('UPDATE chat_projects SET owner_user_id=$2,user_id=$2 WHERE id=$1', [project.id, owner]);
  await assert.rejects(readPublicProject(pool, project.id), { code: 'project_not_found' });
  assert.equal((await readProjectPublication(pool, context(owner), base)).visibility, 'private', 'owner A-B-A cannot resurrect publication');
  await writeTuples(pool, { writes: [{ object: `project:${project.id}`, relation: 'admin', subject: `user:${stranger}` }] });
  const managerBase = { ...base, expectedActorAccountId: stranger };
  const managerPreview = await previewProjectPublication(pool, context(stranger), { ...managerBase, visibility: 'public' });
  await writeTuples(pool, { deletes: [{ object: `project:${project.id}`, relation: 'admin', subject: `user:${stranger}` }] });
  await assert.rejects(mutateProjectPublication(pool, context(stranger), { ...publish, ...managerBase, operationId: randomUUID(), expectedRevision: managerPreview.revision, visibility: 'public', previewHash: managerPreview.previewHash }), { code: 'project_not_found' }, 'revoked administrator cannot publish from an old preview');
  {
    const browserProject = await createAuthorizedProject(pool, { principal: { type: 'user', id: owner }, name: 'PRIVATE-NAME', customInstructions: 'PRIVATE-INSTRUCTIONS' });
    const { provePublicationBrowser } = await import('./lib/project-publication-browser.mjs');
    await provePublicationBrowser({ app, baseUrl: `http://127.0.0.1:${server.address().port}`, projectId: browserProject.id,
      accountId: owner, token: jwt.sign({ userId: owner }, process.env.JWT_SECRET, { expiresIn: '5m' }) });
  }
  await pool.query('UPDATE users SET is_active=false WHERE id=$1', [owner]);
  await assert.rejects(readProjectPublication(pool, context(owner), base), { code: 'publication_authority_required' });
});
