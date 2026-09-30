import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
test('account-backed HTTP admission prepares the canonical allowance only after target authorization', { skip: !url, timeout: 120000 }, async t => {
  const pool = new pg.Pool({ connectionString: url, max: 8 }); t.after(() => pool.end());
  const { createWorkforceResource } = await import('../src/server/services/workforceResources.js');
  const { getSigningKey } = await import('../src/server/utils/oidcProvider.js');
  const { jwkThumbprint, accessTokenHash } = await import('../src/server/utils/dpop.js');
  const { issuer } = await import('../src/server/config/hosts.js');
  const { apiCacheMiddleware } = await import('../src/server/middleware/cdnOptimization.js');
  const { allowanceSourceRef, windowFor } = await import('../src/server/utils/quotaEngine.js');
  const { default: express } = await import('express');
  const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
  process.env.JWT_SECRET = randomUUID() + randomUUID();
  const { default: router } = await import('../src/server/routes/workforceRoutes.js');
  const marker = randomUUID();
  const user = async suffix => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified) VALUES($1,$2,'fixture',$1,TRUE) RETURNING id`,
    [marker + suffix, marker + suffix + '@example.test'])).rows[0].id;
  const owner = await user('-owner'), stranger = await user('-stranger');
  const context = actorUserId => ({ actorUserId, clientId: 'xeno-agent-interface' });
  const made = await createWorkforceResource(pool, context(owner), { operationId: randomUUID(), kind: 'agent', name: 'Allowance fixture', owner: { type: 'user', id: owner },
    definition: { schemaVersion: 1, instructions: 'Use my main account.', skills: [], requestedCapabilities: [] } });
  const signer = await getSigningKey(pool), key = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = key.publicKey.export({ format: 'jwk' }), jkt = jwkThumbprint(jwk), now = Math.floor(Date.now() / 1000), sessions = new Map();
  for (const actor of [owner, stranger]) {
    const sid = randomUUID(); sessions.set(actor, sid);
    await pool.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch) VALUES($1,0) ON CONFLICT DO NOTHING', [actor]);
    await pool.query(`INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at) VALUES($1,$2,0,to_timestamp($3),$4,now()+interval '1 hour')`, [sid, actor, now, jkt]);
  }
  const app = express(); app.use('/api/', apiCacheMiddleware); app.use((req, _res, next) => { req.db = pool; next(); }); app.use('/api/workforce', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const body = () => ({ operationId: randomUUID(), expectedActorAccountId: owner,
    agent: { resourceId: made.resource.id, version: made.version.version, contentHash: made.version.contentHash },
    target: { kind: 'personal', ownerUserId: owner }, capabilities: [], runtimeCapabilities: [], budget: { ceilingMicro: '1000000' } });
  const call = async (input, actor = owner) => {
    const path = '/api/workforce/run-admissions';
    const token = jwt.sign({ sub: actor, sid: sessions.get(actor), auth_epoch: 0, auth_time: now, client_id: 'xeno-agent-interface', scope: 'workforce:read workforce:manage', typ: 'at+jwt', cnf: { jkt } },
      signer.privatePem, { algorithm: signer.alg, keyid: signer.kid, audience: 'xeno-api', expiresIn: '5m', header: { typ: 'at+jwt' } });
    const proof = jwt.sign({ jti: randomUUID(), htm: 'POST', htu: issuer() + path, ath: accessTokenHash(token), iat: now }, key.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk } });
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `DPoP ${token}`, dpop: proof }, body: JSON.stringify(input) });
    return { status: response.status, body: await response.json() };
  };
  const grants = async id => (await pool.query("SELECT * FROM credit_grants WHERE user_id=$1 AND kind='allowance'", [id])).rows;
  const beforeCaps = (await pool.query('SELECT count(*)::int AS n FROM spend_caps')).rows[0].n;
  assert.equal((await grants(owner)).length, 0);
  const foreign = await call({ ...body(), expectedActorAccountId: stranger, target: { kind: 'personal', ownerUserId: stranger } }, stranger);
  assert.equal((await grants(stranger)).length, 0, 'hidden target must not issue an allowance');
  assert.ok([403,404].includes(foreign.status), `unauthorized resource cannot reach account issuance: ${JSON.stringify(foreign)}`);
  const invalid = await call({ ...body(), budget: { ceilingMicro: '0' } });
  assert.equal(invalid.status, 400);
  assert.equal((await grants(owner)).length, 0, 'invalid request must not issue an allowance');
  const requests = [body(), body()];
  const results = await Promise.all(requests.map(q => call(q)));
  for (const result of results) assert.equal(result.status, 200, `fresh account receives its main allowance before admission: ${JSON.stringify(result.body)}`);
  const issued = await grants(owner);
  assert.equal(issued.length, 1, 'concurrent first use issues one canonical allowance lot');
  assert.equal(issued[0].source_ref, allowanceSourceRef(owner, 'free', windowFor().index));
  assert.equal(results[0].body.admission.payer.userId, owner);
  const replay = await call(requests[0]);
  assert.equal(replay.status, 200); assert.equal(replay.body.admission.admissionId, results[0].body.admission.admissionId);
  assert.equal((await grants(owner)).length, 1, 'admission retry cannot issue a second allowance');
  const bot = await user('-agent');
  await pool.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role,agent_origin) VALUES($1,$2,'other','quota-admission-fixture')", [bot, owner]);
  const { admitAccountRun } = await import('../src/server/services/workforceRunAdmission.js');
  await pool.query('UPDATE users SET email_verified=false WHERE id=$1', [owner]);
  const unverified = await call(body());
  assert.equal(unverified.status, 403, 'unverified free allowance is a typed refusal, not a server fault');
  assert.equal(unverified.body.details?.reason, 'email_verification_required');
  await pool.query('UPDATE users SET email_verified=true WHERE id=$1', [owner]);
  const botAdmission = await admitAccountRun(pool, context(bot), { ...body(), expectedActorAccountId: bot });
  assert.equal(botAdmission.admission.payer.userId, owner, 'an agent admission uses its human owners account');
  assert.equal((await grants(bot)).length, 0, 'an agent receives no separate weekly quota');
  assert.equal((await grants(owner)).length, 1, 'agent and human share the same allowance window');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM spend_caps')).rows[0].n, beforeCaps, 'admission never invents a spend-cap setting');
  // §8.7: every admitted personal ROOT reserves its ceiling as one canonical workforce/run hold named by the
  // admission -- and nothing else: no hold without an admission, none for a refused request, none twice.
  const holds = (await pool.query(`SELECT h.hold_id, h.surface, h.operation, h.amount_micro, a.budget_ceiling_micro, a.parent_admission_id
    FROM credit_holds h LEFT JOIN workforce_run_admissions a ON a.id::text=h.hold_id WHERE h.user_id=$1`, [owner])).rows;
  const roots = (await pool.query(`SELECT count(*)::int AS n FROM workforce_run_admissions WHERE payer_user_id=$1 AND payer_kind='user'
    AND parent_admission_id IS NULL`, [owner])).rows[0].n;
  assert.equal(holds.length, roots, 'one reservation per admitted root, and none for anything refused');
  assert.ok(holds.every((h) => h.surface === 'workforce' && h.operation === 'run' && h.parent_admission_id === null
    && String(h.amount_micro) === String(h.budget_ceiling_micro)), 'each reservation is exactly its admission\'s ceiling, never a fabricated amount');
});
