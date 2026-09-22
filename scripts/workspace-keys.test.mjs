import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import express from 'express';
import { createRequire } from 'node:module';
import { authMiddleware } from '../src/server/middleware/auth.js';
import { workspaceRoutes } from '../src/server/routes/workspaceRoutes.js';
import { migrateAccountV2 } from '../src/server/database/migrate-account-v2.js';
import { getSigningKey } from '../src/server/utils/oidcProvider.js';
import { accessTokenHash, jwkThumbprint } from '../src/server/utils/dpop.js';
import { workspaceKeyRoute, workspaceKeyFromHeaders } from '../src/server/services/workspaceApiKeys.js';
const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
const url = process.env.WORKSPACE_KEY_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/workspacekeyproof') throw new Error('Only isolated local workspacekeyproof DB is permitted');
}
test('workspace credentials have a closed route allowlist and terminal mixed-header selection', () => {
  const ws = crypto.randomUUID(), base = `/api/workspaces/${ws}`;
  assert.deepEqual(workspaceKeyRoute('GET', base), { workspaceId: ws, scope: 'workspace:read' });
  assert.deepEqual(workspaceKeyRoute('HEAD', `${base}/members?sort=name`), { workspaceId: ws, scope: 'workspace:members:read' });
  for (const [method, path] of [['POST', base], ['GET', '/api/workspaces'], ['GET', `${base}/api-keys`], ['GET', `${base}/members/one`],
    ['GET', `${base}/billing`], ['GET', `${base}/notifications`], ['GET', '/api/v2/account'], ['GET', '/api/agents']]) assert.equal(workspaceKeyRoute(method, path), null);
  const key = 'xeno-ws-v1_' + 'a'.repeat(64);
  assert.deepEqual(workspaceKeyFromHeaders({ authorization: `Bearer ${key}` }), { key });
  assert.deepEqual(workspaceKeyFromHeaders({ 'x-api-key': key }), { key });
  for (const headers of [{ authorization: `Bearer ${key}`, 'x-api-key': 'other' }, { authorization: 'Bearer other', 'x-api-key': key },
    { authorization: ['Bearer other', key] }, { authorization: `Bearer other, DPoP ${key}` }]) assert.ok(workspaceKeyFromHeaders(headers).error);
  assert.equal(workspaceKeyFromHeaders({ authorization: 'Bearer ordinary' }), null);
});
test('workspace key migration, real HTTP DPoP management and scoped credential enforcement', { skip: !url }, async t => {
  const schema = `workspace_keys_${crypto.randomBytes(8).toString('hex')}`;
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 5 });
  let server;
  try {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TABLE users(id uuid PRIMARY KEY,username text,email text,display_name text,avatar_url text,created_at timestamptz DEFAULT now(),email_verified boolean DEFAULT true,is_active boolean DEFAULT true);
      CREATE TABLE credit_transactions(user_id uuid,reference_type text,reference_id text);
      CREATE TABLE user_sessions(id uuid PRIMARY KEY,user_id uuid,expires_at timestamptz,last_active_at timestamptz DEFAULT now());
      CREATE TABLE api_keys(id uuid PRIMARY KEY,user_id uuid,key_prefix text,key_hash text,is_active boolean,expires_at timestamptz,last_used_at timestamptz,usage_count integer DEFAULT 0);`);
    await migrateAccountV2(pool);
    for (const name of ['20260711120000-workspaces.sql', '20260904150000-workspace-api-keys.sql', '20260904200000-workspace-key-operations.sql', '20260904210000-workspace-membership-operations.sql', '20260904220000-workspace-operation-abandonment.sql']) {
      await pool.query((await fs.readFile(new URL(`../src/server/database/migrations/${name}`, import.meta.url), 'utf8')).split('-- DOWN')[0]);
    }
    const owner = crypto.randomUUID(), admin = crypto.randomUUID(), viewer = crypto.randomUUID(), stranger = crypto.randomUUID();
    const ws = crypto.randomUUID(), foreign = crypto.randomUUID();
    for (const [id, name] of [[owner, 'owner'], [admin, 'admin'], [viewer, 'viewer'], [stranger, 'stranger']]) await pool.query('INSERT INTO users(id,username,email,display_name) VALUES($1,$2,$3,$2)', [id, name, `${name}@example.test`]);
    for (const [id, user] of [[ws, owner], [foreign, stranger]]) await pool.query("INSERT INTO workspaces(id,owner_user_id,workspace_type,name,slug) VALUES($1::uuid,$2,'team','Key proof',$1::text)", [id, user]);
    for (const [wid, user, role] of [[ws, owner, 'owner'], [ws, admin, 'admin'], [ws, viewer, 'viewer'], [foreign, stranger, 'owner']]) await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,$2,'user',$3)", [wid, role, user]);
    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }), jwk = pair.publicKey.export({ format: 'jwk' }), jkt = jwkThumbprint(jwk);
    const signing = await getSigningKey(pool);
    const mint = async ({ user = owner, scopes = 'team:read team:manage', client = 'xeno-post', age = 0, bound = true } = {}) => {
      const sid = crypto.randomUUID(), authTime = Math.floor(Date.now()/1000) - age;
      await pool.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch) VALUES($1,0) ON CONFLICT DO NOTHING', [user]);
      await pool.query("INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at) VALUES($1,$2,0,to_timestamp($3),$4,now()+interval '1 hour')", [sid,user,authTime,bound ? jkt : null]);
      return jwt.sign({ sub:user,sid,auth_epoch:0,auth_time:authTime,client_id:client,scope:scopes,typ:'at+jwt',...(bound ? { cnf:{jkt} } : {}) }, signing.privatePem, { algorithm:signing.alg,keyid:signing.kid,audience:'xeno-api',issuer:'https://xenostudio.ai',expiresIn:'10m',header:{typ:'at+jwt'} });
    };
    const proof = (token, method, path, overrides = {}) => jwt.sign({ jti:crypto.randomUUID(),htm:method,htu:`https://xenostudio.ai${path}`,iat:Math.floor(Date.now()/1000),ath:accessTokenHash(token),...overrides }, pair.privateKey, { algorithm:'ES256',header:{typ:'dpop+jwt',jwk} });
    let dropOperationId;
    const app = express(); app.use(express.json()); app.use((req,res,next) => {
      req.db = pool;
      const originalJson = res.json.bind(res);
      res.json = value => {
        if (dropOperationId && value.operation?.operation_id === dropOperationId && req.method === 'POST') {
          dropOperationId = undefined; res.socket.destroy(); return res;
        }
        return originalJson(value);
      };
      next();
    });
    app.use('/api/workspaces', authMiddleware, workspaceRoutes); app.get('/api/global', authMiddleware, (_req,res) => res.json({ success:true }));
    server = app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
    const request = async (token, method, path, body, opts = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers:{authorization:`${opts.scheme || 'DPoP'} ${token}`,'content-type':'application/json',
        ...(opts.proof === null ? {} : {dpop:opts.proof ?? proof(token,method,path)}),...opts.headers}, ...(body && !['GET','HEAD'].includes(method) ? {body:JSON.stringify(body)} : {}) });
    const base = `/api/workspaces/${ws}`, route = `${base}/api-keys`, token = await mint();
    const body = {name:'Read only',scopes:['workspace:read','workspace:members:read'],expires_at:new Date(Date.now()+86400000).toISOString()};
    const issue = async (actor = token, input = body) => { const res = await request(actor,'POST',route,input); assert.equal(res.status,201,JSON.stringify(await res.clone().json())); return res.json(); };
    let issued;
    await t.test('durable operation identity deduplicates concurrent creates and never replays the secret', async () => {
      const operation_id = crypto.randomUUID(), input = {...body,operation_id};
      const before = Number((await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count);
      const replies = await Promise.all(Array.from({length:8},()=>request(token,'POST',route,input)));
      for(const reply of replies) assert.equal(reply.status,201);
      const values = await Promise.all(replies.map(r=>r.json()));
      assert.equal(new Set(values.map(v=>v.key.id)).size,1);
      assert.equal(values.filter(v=>v.secret).length,1);
      assert.equal(values.filter(v=>v.replayed).length,7);
      assert.equal(Number((await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count),before+1);
      const first = values.find(v=>v.secret), readPath = `${route}/operations/${operation_id}`;
      const recovered = await (await request(await mint(),'GET',readPath)).json();
      assert.deepEqual(recovered,{success:true,state:'committed',operation:first.operation});
      assert.ok(!JSON.stringify((await pool.query('SELECT * FROM workspace_key_operations')).rows).includes(first.secret));
      assert.equal((await request(token,'POST',route,{...input,name:'Different'})).status,409);
      const ageToken = await mint({age:600});
      assert.equal((await request(ageToken,'GET',readPath)).status,200);
      assert.equal((await request(ageToken,'POST',route,input)).status,401);
      assert.equal((await request(await mint({scopes:'team:read'}),'GET',readPath)).status,403);
      for(const user of [viewer,stranger])assert.deepEqual(await (await request(await mint({user}),'GET',readPath)).json(),{success:true,state:'not-observed',operation:null});
      const otherActor = await (await request(await mint({user:admin}),'GET',readPath)).json();
      assert.deepEqual(otherActor,{success:true,state:'not-observed',operation:null});
      // This policy-approved browser client may not borrow another product's receipt.
      const otherClient = await mint({client:'xeno-hub'});
      const clientReply = await request(otherClient,'GET',readPath);
      assert.equal(clientReply.status,200);
      assert.deepEqual(await clientReply.json(),{success:true,state:'not-observed',operation:null});
      const unknown = await (await request(token,'GET',`${route}/operations/${crypto.randomUUID()}`)).json();
      assert.deepEqual(unknown,{success:true,state:'not-observed',operation:null});
    });
    await t.test('concurrent same ID different bodies admits exactly one intent', async () => {
      const operation_id = crypto.randomUUID();
      const replies = await Promise.all(['Intent A','Intent B'].map(name=>request(token,'POST',route,{...body,name,operation_id})));
      assert.deepEqual(replies.map(r=>r.status).sort(),[201,409]);
      const stored = (await pool.query('SELECT receipt FROM workspace_key_operations WHERE operation_id=$1',[operation_id])).rows;
      assert.equal(stored.length,1); assert.ok(['Intent A','Intent B'].includes(stored[0].receipt.key.name));
    });
    await t.test('lost HTTP acknowledgement recovers public receipt without minting or returning a second secret', async () => {
      const operation_id = crypto.randomUUID(), input = {...body,operation_id};
      const before = Number((await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count);
      dropOperationId = operation_id;
      await assert.rejects(request(token,'POST',route,input));
      const read = await (await request(token,'GET',`${route}/operations/${operation_id}`)).json();
      assert.equal(read.state,'committed'); assert.equal(read.secret,undefined);
      const replay = await issue(token,input);
      assert.equal(replay.replayed,true); assert.equal(replay.secret,undefined); assert.deepEqual(replay.operation,read.operation);
      assert.equal(Number((await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count),before+1);
    });
    await t.test('authorized transactional rejection is durable, replayable and cannot later become a key', async () => {
      const operation_id = crypto.randomUUID(), input = {...body,operation_id,expires_at:'2000-01-01T00:00:00.000Z'};
      const before = (await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count;
      const rejected = await issue(token,input);
      assert.equal(rejected.operation.rejection,'invalid_workspace_key_request'); assert.equal(rejected.key,undefined); assert.equal(rejected.secret,undefined);
      const read = await (await request(token,'GET',`${route}/operations/${operation_id}`)).json();
      assert.equal(read.state,'rejected'); assert.deepEqual(read.operation,rejected.operation);
      assert.equal((await issue(token,input)).replayed,true);
      assert.equal((await request(token,'POST',route,{...body,operation_id})).status,409);
      assert.equal((await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count,before);
      const missing = await (await request(token,'POST',`${route}/${crypto.randomUUID()}/rotate`,{expected_revision:1,operation_id:crypto.randomUUID()})).json();
      assert.equal(missing.operation.rejection,'workspace_key_not_found');
      const key = await issue();
      const wrongRevision = await (await request(token,'DELETE',`${route}/${key.key.id}`,{expected_revision:99,operation_id:crypto.randomUUID()})).json();
      assert.equal(wrongRevision.operation.rejection,'workspace_key_conflict');
      assert.equal((await pool.query('SELECT revoked_at FROM workspace_api_keys WHERE id=$1',[key.key.id])).rows[0].revoked_at,null);
    });
    await t.test('rotation and revocation replay original committed receipt despite later key state', async () => {
      const original = await issue(), operation_id = crypto.randomUUID();
      const rotatePath = `${route}/${original.key.id}/rotate`, input = {operation_id,expected_revision:1};
      const replies = await Promise.all([request(token,'POST',rotatePath,input),request(token,'POST',rotatePath,input)]);
      assert.deepEqual(replies.map(r=>r.status),[200,200]);
      const results = await Promise.all(replies.map(r=>r.json()));
      const first = results.find(r=>r.secret); assert.equal(results.filter(r=>r.secret).length,1);
      assert.equal(first.operation.previous_key_id,original.key.id);
      assert.equal((await pool.query('SELECT replaced_by FROM workspace_api_keys WHERE id=$1',[original.key.id])).rows[0].replaced_by,first.key.id);
      const revokeId = crypto.randomUUID(), revokeInput = {operation_id:revokeId,expected_revision:1};
      const revoke = await (await request(token,'DELETE',`${route}/${first.key.id}`,revokeInput)).json();
      assert.equal(revoke.replayed,false); assert.ok(revoke.key.revoked_at); assert.equal(revoke.secret,undefined);
      const repeated = await (await request(token,'DELETE',`${route}/${first.key.id}`,revokeInput)).json();
      assert.equal(repeated.replayed,true); assert.deepEqual(repeated.operation,revoke.operation);
      const old = await (await request(token,'POST',rotatePath,input)).json();
      assert.equal(old.replayed,true); assert.equal(old.secret,undefined); assert.deepEqual(old.operation,first.operation);
    });
    await t.test('own immutable receipt survives membership loss without granting fresh key authority', async () => {
      const actorToken = await mint({user:admin}), operation_id = crypto.randomUUID();
      const issued=await issue(actorToken,{...body,operation_id});
      await pool.query("DELETE FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND subject_id=$2",[ws,admin]);
      assert.deepEqual(await (await request(actorToken,'GET',`${route}/operations/${operation_id}`)).json(),{success:true,state:'committed',operation:issued.operation});
      const replay=await (await request(actorToken,'POST',route,{...body,operation_id})).json();
      assert.equal(replay.replayed,true);assert.equal(replay.secret,undefined);assert.deepEqual(replay.operation,issued.operation);
      assert.equal((await request(actorToken,'POST',route,{...body,operation_id:crypto.randomUUID()})).status,403);
      assert.equal((await request(actorToken,'GET',route)).status,403);
      await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,'admin','user',$2)",[ws,admin]);
      const missingId = crypto.randomUUID(), input = {...body,operation_id:missingId};
      assert.equal((await (await request(token,'GET',`${route}/operations/${missingId}`)).json()).state,'not-observed');
      const later = await issue(token,input); assert.equal(later.replayed,false);
      assert.equal((await (await request(token,'GET',`${route}/operations/${missingId}`)).json()).operation.key.id,later.key.id);
    });
    await t.test('only fresh sender-bound approved user owner/admin can manage keys', async () => {
      assert.equal((await request(token,'POST',route,body,{proof:null})).status,401);
      assert.equal((await request(token,'POST',route,body,{proof:proof(token,'GET',route)})).status,401);
      assert.equal((await request(await mint({bound:false}),'POST',route,body,{proof:null,scheme:'Bearer'})).status,401);
      assert.equal((await request(await mint({age:600}),'POST',route,body)).status,401);
      for (const actor of [await mint({scopes:'team:read'}),await mint({client:'xeno-agent-cli'}),await mint({user:viewer}),await mint({user:stranger})]) assert.equal((await request(actor,'POST',route,body)).status,403);
      const legacy = jwt.sign({userId:owner},process.env.JWT_SECRET || 'xenostudio-super-secret-jwt-key-change-in-production',{algorithm:'HS256',expiresIn:'10m'});
      assert.equal((await request(legacy,'POST',route,body,{proof:null,scheme:'Bearer'})).status,401);
      assert.equal((await request(token,'POST',`/api/workspaces/${foreign}/api-keys`,body)).status,403);
      await issue(await mint({user:admin})); issued = await issue();
      assert.match(issued.secret,/^xeno-ws-v1_[0-9a-f]{64}$/); assert.equal(issued.key.workspace_id,ws);
    });
    await t.test('DPoP replay cannot create a second key', async () => {
      const signed = proof(token,'POST',route), before = Number((await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count);
      const replies = await Promise.all([request(token,'POST',route,body,{proof:signed}), request(token,'POST',route,body,{proof:signed})]);
      assert.deepEqual(replies.map(r=>r.status).sort(),[201,401]);
      assert.equal(Number((await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count),before+1);
    });
    await t.test('secrets are returned once, only hashes persist and audit/list never contain credentials', async () => {
      const record = (await pool.query('SELECT * FROM workspace_api_keys WHERE id=$1',[issued.key.id])).rows[0];
      assert.equal(record.key_hash,crypto.createHash('sha256').update(issued.secret).digest('hex'));
      assert.ok(!JSON.stringify(record).includes(issued.secret));
      const list = await (await request(token,'GET',route)).json();
      assert.ok(!JSON.stringify(list).includes('key_hash')); assert.ok(!JSON.stringify(list).includes(issued.secret));
      assert.ok(!JSON.stringify((await pool.query('SELECT * FROM workspace_audit')).rows).includes(issued.secret));
      assert.equal((await pool.query('SELECT count(*) FROM api_keys')).rows[0].count,'0');
    });
    await t.test('issued key reads only exact matching workspace routes and advertised scopes', async () => {
      const opts = {scheme:'Bearer',proof:null};
      assert.equal((await request(issued.secret,'GET',base,null,opts)).status,200);
      assert.equal((await request(issued.secret,'GET',`${base}/members`,null,opts)).status,200);
      for (const [method,path] of [['GET','/api/workspaces'],['GET','/api/global'],['GET',route],['GET',`${base}/billing`],['POST',`${base}/select`],['POST',route],['PATCH',`${base}/members/${viewer}`]]) assert.equal((await request(issued.secret,method,path,body,opts)).status,403);
      assert.equal((await request(issued.secret,'GET',`/api/workspaces/${foreign}/members`,null,opts)).status,401);
      const narrow = await issue(token,{...body,scopes:['workspace:read']});
      assert.equal((await request(narrow.secret,'GET',`${base}/members`,null,opts)).status,403);
      assert.equal((await request(token,'GET',base,null,{headers:{'x-api-key':issued.secret}})).status,401);
      assert.equal((await request(issued.secret.toUpperCase(),'GET',base,null,opts)).status,401);
    });
    await t.test('global scopes and invalid expiry cannot be issued', async () => {
      for (const invalid of [{...body,scopes:['inference:run']},{...body,scopes:['workspace:read','workspace:read']},{...body,expires_at:'2000-01-01'},{...body,expires_at:new Date(Date.now()+100*86400000).toISOString()}]) assert.equal((await request(token,'POST',route,invalid)).status,400);
    });
    await t.test('pagination reaches old active keys beyond 200 and cursors cannot cross workspaces', async () => {
      await pool.query(`INSERT INTO workspace_api_keys(workspace_id,created_by_user_id,name,key_prefix,key_hash,scopes,created_at,expires_at)
        SELECT $1,$2,'Historical reader '||g,'xeno-ws-v1_0000000000000',md5('page'||g)||md5('key'||g),ARRAY['workspace:read'],now()-interval '1 day',now()+interval '1 day' FROM generate_series(1,205) g`,[ws,owner]);
      const expected = Number((await pool.query('SELECT count(*) FROM workspace_api_keys WHERE workspace_id=$1',[ws])).rows[0].count);
      const seen = new Set(); let cursor = null, firstCursor;
      do {
        const result = await request(token,'GET',`${route}?limit=37${cursor ? `&cursor=${cursor}` : ''}`);
        assert.equal(result.status,200); const page = await result.json();
        assert.ok(page.keys.length<=37);
        for(const key of page.keys) { assert.ok(!seen.has(key.id)); seen.add(key.id); }
        cursor = page.next_cursor; firstCursor ??= cursor;
      } while(cursor);
      assert.equal(seen.size,expected);
      const foreignToken = await mint({user:stranger});
      assert.equal((await request(foreignToken,'GET',`/api/workspaces/${foreign}/api-keys?cursor=${firstCursor}`)).status,400);
      assert.equal((await request(token,'GET',`${route}?limit=201`)).status,400);
      const absent = Buffer.from(JSON.stringify({version:1,workspaceId:ws,keyId:crypto.randomUUID()})).toString('base64url');
      assert.equal((await request(token,'GET',`${route}?cursor=${absent}`)).status,409);
    });
    await t.test('membership is rechecked on every management admission, including read-after-revocation', async () => {
      const adminToken = await mint({user:admin});
      await pool.query("UPDATE relationship_tuples SET relation='viewer' WHERE object_id=$1 AND subject_id=$2",[ws,admin]);
      assert.equal((await request(adminToken,'POST',route,body)).status,403);
      assert.equal((await request(adminToken,'GET',route)).status,403);
      await pool.query("UPDATE relationship_tuples SET relation='admin' WHERE object_id=$1 AND subject_id=$2",[ws,admin]);
    });
    await t.test('concurrent rotation has exactly one winner and revokes old key atomically', async () => {
      const path = `${route}/${issued.key.id}/rotate`, input = {expected_revision:issued.key.revision};
      const replies = await Promise.all([request(token,'POST',path,input),request(token,'POST',path,input)]);
      assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
      const rotated = await replies.find(r=>r.status===200).json();
      assert.equal((await request(issued.secret,'GET',base,null,{scheme:'Bearer',proof:null})).status,401);
      assert.equal((await request(rotated.secret,'GET',base,null,{scheme:'Bearer',proof:null})).status,200);
      const res = await request(token,'DELETE',`${route}/${rotated.key.id}`,{expected_revision:1}); assert.equal(res.status,200);
      assert.equal((await request(rotated.secret,'GET',base,null,{scheme:'Bearer',proof:null})).status,401);
      assert.equal((await request(token,'DELETE',`${route}/${rotated.key.id}`,{expected_revision:1})).status,409);
    });
    await t.test('expired, disabled issuer, removed membership and archived workspace fail immediately', async () => {
      const current = await issue(), opts = {scheme:'Bearer',proof:null};
      await pool.query("UPDATE workspace_api_keys SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE id=$1",[current.key.id]);
      assert.equal((await request(current.secret,'GET',base,null,opts)).status,401);
      const other = await issue(); await pool.query('UPDATE users SET is_active=false WHERE id=$1',[owner]);
      assert.equal((await request(other.secret,'GET',base,null,opts)).status,401); await pool.query('UPDATE users SET is_active=true WHERE id=$1',[owner]);
      await pool.query("DELETE FROM relationship_tuples WHERE object_id=$1 AND subject_id=$2",[ws,owner]);
      assert.equal((await request(other.secret,'GET',base,null,opts)).status,403);
      await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('workspace',$1,'owner','user',$2)",[ws,owner]);
      await pool.query("UPDATE workspaces SET status='archived' WHERE id=$1",[ws]);
      assert.equal((await request(other.secret,'GET',base,null,opts)).status,401); await pool.query("UPDATE workspaces SET status='active' WHERE id=$1",[ws]);
    });
    await t.test('audit failure rolls back rotation and preserves the previous valid key', async () => {
      const current = await issue(), before = (await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count;
      await pool.query('ALTER TABLE workspace_audit RENAME TO unavailable_workspace_audit');
      const res = await request(token,'POST',`${route}/${current.key.id}/rotate`,{expected_revision:1}); assert.equal(res.status,503);
      assert.equal((await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count,before);
      assert.equal((await request(current.secret,'GET',base,null,{scheme:'Bearer',proof:null})).status,200);
      await pool.query('ALTER TABLE unavailable_workspace_audit RENAME TO workspace_audit');
    });
    await t.test('receipt write failure rolls back the key mutation and audit together', async () => {
      const current = await issue(), operation_id = crypto.randomUUID();
      const before = (await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count;
      await pool.query("ALTER TABLE workspace_key_operations ADD CONSTRAINT proof_reject_receipt CHECK (receipt->>'action' <> 'rotate') NOT VALID");
      const result = await request(token,'POST',`${route}/${current.key.id}/rotate`,{operation_id,expected_revision:1});
      assert.equal(result.status,503);
      assert.equal((await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count,before);
      assert.equal((await pool.query('SELECT revoked_at FROM workspace_api_keys WHERE id=$1',[current.key.id])).rows[0].revoked_at,null);
      assert.equal((await (await request(token,'GET',`${route}/operations/${operation_id}`)).json()).state,'not-observed');
      await pool.query('ALTER TABLE workspace_key_operations DROP CONSTRAINT proof_reject_receipt');
    });
    await t.test('capacity refuses new operation IDs without forgetting or blocking existing receipts', async () => {
      const operation_id = crypto.randomUUID(), input = {...body,operation_id}, first = await issue(token,input);
      await pool.query(`INSERT INTO workspace_key_operations(workspace_id,actor_user_id,client_id,operation_id,request_hash,receipt,incarnation_hash)
        SELECT $1,$2,'capacity-test',gen_random_uuid(),repeat('0',64),$3::jsonb,repeat('0',64) FROM generate_series(1,10000-(SELECT count(*)::int FROM workspace_key_operations WHERE workspace_id=$1))`,[ws,owner,JSON.stringify(first.operation)]);
      assert.equal((await request(token,'POST',route,{...body,operation_id:crypto.randomUUID()})).status,429);
      const replay = await issue(token,input); assert.equal(replay.replayed,true); assert.equal(replay.secret,undefined);
      assert.equal((await request(token,'GET',`${route}/operations/${operation_id}`)).status,200);
      assert.equal((await pool.query('SELECT count(*) FROM workspace_key_operations WHERE workspace_id=$1',[ws])).rows[0].count,'10000');
      await pool.query("DELETE FROM workspace_key_operations WHERE workspace_id=$1 AND client_id='capacity-test'",[ws]);
    });
    await t.test('workspace deletion keeps duplicate tombstone and recreated IDs cannot expose or replay old receipts', async () => {
      const foreignToken = await mint({user:stranger}), foreignRoute = `/api/workspaces/${foreign}/api-keys`;
      const operation_id = crypto.randomUUID(), input = {...body,operation_id};
      const created = await request(foreignToken,'POST',foreignRoute,input); assert.equal(created.status,201);
      await pool.query('DELETE FROM workspaces WHERE id=$1',[foreign]);
      assert.equal((await pool.query('SELECT count(*) FROM workspace_key_operations WHERE workspace_id=$1',[foreign])).rows[0].count,'1');
      assert.equal((await request(foreignToken,'GET',`${foreignRoute}/operations/${operation_id}`)).status,403);
      await pool.query("INSERT INTO workspaces(id,owner_user_id,workspace_type,name,slug,created_at) VALUES($1::uuid,$2,'team','Recreated proof',$1::text,now()+interval '1 second')",[foreign,stranger]);
      assert.equal((await request(foreignToken,'GET',`${foreignRoute}/operations/${operation_id}`)).status,409);
      assert.equal((await request(foreignToken,'POST',foreignRoute,input)).status,409);
      assert.equal((await pool.query('SELECT count(*) FROM workspace_api_keys WHERE workspace_id=$1',[foreign])).rows[0].count,'0');
    });
    await t.test('abandoned key intent survives lost ACK and prevents a delayed create', async () => {
      const operation_id=crypto.randomUUID(), path=`${route}/operations/${operation_id}/abandon`, original={action:'create',...body};
      const before=(await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count;
      dropOperationId=operation_id;
      await assert.rejects(request(token,'POST',path,{request:original}));
      const read=await (await request(token,'GET',`${route}/operations/${operation_id}`)).json();
      assert.equal(read.state,'abandoned');assert.equal(read.operation.abandoned,true);
      const replay=await issue(token,{...body,operation_id});
      assert.deepEqual(replay.operation,read.operation);assert.equal(replay.secret,undefined);assert.equal(replay.key,undefined);
      assert.equal((await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count,before);
      assert.equal((await request(token,'POST',route,{...body,name:'changed',operation_id})).status,409);
    });
    await t.test('key mutation and abandonment races preserve the first committed outcome', async () => {
      for(let i=0;i<5;i++){
        const operation_id=crypto.randomUUID();
        const responses=await Promise.all([request(token,'POST',route,{...body,operation_id}),request(token,'POST',`${route}/operations/${operation_id}/abandon`,{request:{action:'create',...body}})]);
        const [mutation,abandonment]=await Promise.all(responses.map(res=>res.json()));
        assert.deepEqual(mutation.operation,abandonment.operation);
        assert.equal(abandonment.secret,undefined);
        const read=await (await request(token,'GET',`${route}/operations/${operation_id}`)).json();
        assert.deepEqual(read.operation,mutation.operation);
        assert.equal(read.state,mutation.operation.abandoned?'abandoned':'committed');
      }
    });
    await t.test('key abandonment is sender-bound own-namespace authority, not workspace membership', async () => {
      const actor=await mint({user:viewer}),operation_id=crypto.randomUUID(),path=`${route}/operations/${operation_id}/abandon`;
      const before=(await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count;
      const result=await request(actor,'POST',path,{request:{action:'create',...body}});assert.equal(result.status,200);
      assert.equal((await result.json()).operation.abandoned,true);
      assert.equal((await request(actor,'POST',route,{...body,operation_id:crypto.randomUUID()})).status,403);
      assert.equal((await (await request(token,'GET',`${route}/operations/${operation_id}`)).json()).state,'not-observed');
      assert.equal((await request(actor,'POST',path,{request:{action:'create',...body}},{proof:null})).status,401);
      assert.equal((await pool.query('SELECT count(*) FROM workspace_api_keys')).rows[0].count,before);
    });
    await t.test('abandonment preserves committed and rejected key outcomes and enforces a separate actor budget',async()=>{
      for(const input of [body,{...body,expires_at:'2020-01-01T00:00:00.000Z'}]){
        const operation_id=crypto.randomUUID(),original=await issue(token,{...input,operation_id});
        const response=await request(token,'POST',`${route}/operations/${operation_id}/abandon`,{request:{action:'create',...input}});
        assert.equal(response.status,200);const result=await response.json();
        assert.deepEqual(result.operation,original.operation);assert.equal(result.secret,undefined);assert.equal(result.replayed,true);
      }
      const actor=await mint({user:viewer}),operation_id=crypto.randomUUID(),requestBody={request:{action:'create',...body}};
      const path=`${route}/operations/${operation_id}/abandon`;
      const first=await (await request(actor,'POST',path,requestBody)).json();
      await pool.query(`INSERT INTO workspace_key_operations(workspace_id,actor_user_id,client_id,operation_id,family,request_hash,receipt,incarnation_hash)
        SELECT $1,$2,'xeno-post',gen_random_uuid(),'key',repeat('0',64),$3::jsonb,repeat('0',64) FROM generate_series(1,10000-(SELECT count(*)::int FROM workspace_key_operations WHERE actor_user_id=$2 AND client_id='xeno-post' AND receipt ? 'abandoned'))`,[ws,viewer,JSON.stringify(first.operation)]);
      assert.equal((await request(actor,'POST',`${route}/operations/${crypto.randomUUID()}/abandon`,requestBody)).status,429);
      assert.equal((await request(actor,'POST',path,requestBody)).status,200);
      // Another actor's real mutation budget is not spent by these tombstones.
      assert.ok((await issue(token,{...body,operation_id:crypto.randomUUID()})).key);
    });
  } finally {
    if(server) await new Promise(resolve=>server.close(resolve));
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end();
  }
});
