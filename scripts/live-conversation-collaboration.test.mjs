import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import express from 'express';
import pg from 'pg';

import { authMiddleware, optionalAuthMiddleware } from '../src/server/middleware/auth.js';
import chatRoutes from '../src/server/routes/chatRoutes.js';
import { migrateAccountV2 } from '../src/server/database/migrate-account-v2.js';
import { accessTokenHash, jwkThumbprint } from '../src/server/utils/dpop.js';
import { getSigningKey } from '../src/server/utils/oidcProvider.js';
import { check } from '../src/server/utils/authzReBAC.js';

const jwt = createRequire(new URL('../src/server/package.json', import.meta.url))('jsonwebtoken');
const url = process.env.WORKSPACE_KEY_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/workspacekeyproof') {
    throw new Error('Only the owned loopback workspacekeyproof database is allowed');
  }
}

test('live conversation collaboration is durable, sender-bound, race-safe and execution-isolated', { skip: !url }, async (t) => {
  const schema = `live_collab_${crypto.randomBytes(8).toString('hex')}`;
  const pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 16 });
  let server;
  try {
    await pool.query(`CREATE SCHEMA "${schema}";
      CREATE TABLE users(
        id uuid PRIMARY KEY,username text,email text,display_name text,avatar_url text,
        created_at timestamptz DEFAULT now(),email_verified boolean DEFAULT true,is_active boolean DEFAULT true
      );
      CREATE TABLE credit_transactions(user_id uuid,reference_type text,reference_id text);
      CREATE TABLE user_sessions(id uuid PRIMARY KEY,user_id uuid,expires_at timestamptz,last_active_at timestamptz DEFAULT now());
      CREATE TABLE api_keys(id uuid PRIMARY KEY,user_id uuid,key_prefix text,key_hash text,is_active boolean,expires_at timestamptz,last_used_at timestamptz,usage_count integer DEFAULT 0);
      CREATE TABLE account_activations(user_id uuid PRIMARY KEY,method text);`);
    await migrateAccountV2(pool);
    await pool.query((await readFile(new URL('../src/server/database/migrations/20260711120000-workspaces.sql', import.meta.url), 'utf8')).split('-- DOWN')[0]);
    await pool.query(`
      CREATE TABLE chat_projects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid REFERENCES workspaces(id));
      CREATE TABLE chat_conversations(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid REFERENCES users(id),owner_user_id uuid REFERENCES users(id),
        created_by_user_id uuid REFERENCES users(id),title text NOT NULL DEFAULT 'New Chat',model_id text,system_prompt text,
        interface_id text DEFAULT 'playground',workspace_id uuid REFERENCES workspaces(id),project_id uuid REFERENCES chat_projects(id),
        created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),last_message_at timestamptz,
        deleted_at timestamptz,is_archived boolean DEFAULT false
      );
      CREATE TABLE chat_messages(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
        user_id uuid REFERENCES users(id),created_by_user_id uuid REFERENCES users(id),role text NOT NULL,content text NOT NULL,
        model_id text,thinking text,has_thinking boolean DEFAULT false,attachments jsonb,search_context jsonb,
        prompt_tokens integer,completion_tokens integer,total_tokens integer,created_at timestamptz DEFAULT now(),message_index integer NOT NULL,
        UNIQUE(conversation_id,message_index)
      );
      CREATE TABLE chat_shared_conversations(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
        owner_id uuid NOT NULL REFERENCES users(id),share_token varchar(64) NOT NULL,token_digest text NOT NULL UNIQUE,
        visibility text NOT NULL DEFAULT 'public',workspace_id uuid REFERENCES workspaces(id),expires_at timestamptz NOT NULL,
        created_at timestamptz DEFAULT now(),revoked_at timestamptz,accept_count integer DEFAULT 0
      );
      CREATE TABLE chat_share_acceptances(
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),share_id uuid NOT NULL REFERENCES chat_shared_conversations(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id),new_conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
        accepted_at timestamptz DEFAULT now(),UNIQUE(share_id,user_id)
      );
    `);
    await pool.query((await readFile(new URL('../src/server/database/migrations/20260904250000-live-conversation-collaboration.sql', import.meta.url), 'utf8')).split('-- DOWN')[0]);
    await pool.query((await readFile(new URL('../src/server/database/migrations/20260904260000-agent-conversation-collaboration.sql', import.meta.url), 'utf8')).split('-- DOWN')[0]);
    await pool.query((await readFile(new URL('../src/server/database/migrations/20260904261000-agent-conversation-message-revisions.sql', import.meta.url), 'utf8')).split('-- DOWN')[0]);

    const users = Object.fromEntries(['owner', 'viewer', 'commenter', 'contributor', 'racer', 'outsider'].map((name) => [name, crypto.randomUUID()]));
    for (const [name, id] of Object.entries(users)) {
      await pool.query('INSERT INTO users(id,username,email,display_name) VALUES($1,$2,$3,$2)', [id, name, `${name}@example.test`]);
    }
    const workspaceId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workspaces(id,owner_user_id,workspace_type,name,slug,metadata)
       VALUES($1::uuid,$2::uuid,'team','Collaboration proof',$1::text,'{}')`,
      [workspaceId, users.owner],
    );
    await pool.query(
      `INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
       VALUES('workspace',$1,'owner','user',$2)`,
      [workspaceId, users.owner],
    );
    const makeConversation = async (title = 'Live proof') => {
      const conversation = (await pool.query(
        `INSERT INTO chat_conversations(user_id,owner_user_id,created_by_user_id,title)
         VALUES($1,$1,$1,$2) RETURNING id`,
        [users.owner, title],
      )).rows[0];
      await pool.query(
        `INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
         VALUES('conversation',$1,'owner','user',$2)`,
        [conversation.id, users.owner],
      );
      await pool.query(
        `INSERT INTO chat_messages(conversation_id,user_id,created_by_user_id,role,content,message_index)
         VALUES($1,$2,$2,'user','public question',0),($1,$2,$2,'assistant','answer with /api/library/a?grant=private',1),
               ($1,$2,$2,'system','private system instruction',2)`,
        [conversation.id, users.owner],
      );
      return conversation.id;
    };
    const makeWorkspaceConversation = async () => {
      const conversation = (await pool.query(
        `INSERT INTO chat_conversations(user_id,created_by_user_id,title,workspace_id)
         VALUES(NULL,$1,'Workspace live proof',$2) RETURNING id`,
        [users.owner, workspaceId],
      )).rows[0];
      await pool.query(
        `INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
         VALUES('conversation',$1,'parent','workspace',$2)`,
        [conversation.id, workspaceId],
      );
      return conversation.id;
    };

    const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = pair.publicKey.export({ format: 'jwk' });
    const jkt = jwkThumbprint(jwk);
    const signing = await getSigningKey(pool);
    const mint = async ({ user = users.owner, scope = 'collaboration:use', client = 'xeno-hub', bound = true } = {}) => {
      const sid = crypto.randomUUID();
      const authTime = Math.floor(Date.now() / 1000);
      await pool.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch) VALUES($1,0) ON CONFLICT DO NOTHING', [user]);
      await pool.query(
        `INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at)
         VALUES($1,$2,0,to_timestamp($3),$4,now()+interval '1 hour')`,
        [sid, user, authTime, bound ? jkt : null],
      );
      return jwt.sign({ sub: user, sid, auth_epoch: 0, auth_time: authTime, client_id: client, scope, typ: 'at+jwt', ...(bound ? { cnf: { jkt } } : {}) }, signing.privatePem, {
        algorithm: signing.alg, keyid: signing.kid, audience: 'xeno-api', issuer: 'https://xenostudio.ai', expiresIn: '10m', header: { typ: 'at+jwt' },
      });
    };
    const proof = (token, method, path) => jwt.sign({
      jti: crypto.randomUUID(), htm: method, htu: `https://xenostudio.ai${path}`,
      iat: Math.floor(Date.now() / 1000), ath: accessTokenHash(token),
    }, pair.privateKey, { algorithm: 'ES256', header: { typ: 'dpop+jwt', jwk } });

    const app = express();
    app.use(express.json({ limit: '64kb' }));
    app.use((req, _res, next) => { req.db = pool; next(); });
    app.use('/api/chat', (req, res, next) => (
      req.method === 'GET' && /^\/share\/[^/]+$/.test(req.path)
        ? optionalAuthMiddleware(req, res, next)
        : authMiddleware(req, res, next)
    ), chatRoutes);
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    const request = async (token, method, path, body, options = {}) => {
      const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
      if (token) {
        headers.authorization = `${options.scheme || 'DPoP'} ${token}`;
        if (options.withProof !== false) headers.dpop = options.proof || proof(token, method, path);
      }
      return fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method, headers, ...((body !== undefined && body !== null) ? { body: JSON.stringify(body) } : {}),
      });
    };
    const json = async (response, status) => {
      const value = await response.json();
      assert.equal(response.status, status, JSON.stringify(value));
      return value;
    };
    const ownerToken = await mint();
    const createShare = async (conversationId, role, mode = 'live', visibility = 'public') => {
      const path = `/api/chat/conversations/${conversationId}/share`;
      const body = await json(await request(ownerToken, 'POST', path, { mode, role, visibility, expires_in_days: 7 }), 200);
      const token = body.share.share_url.split('/').at(-1);
      assert.match(token, /^[a-f0-9]{64}$/);
      return { ...body.share, token };
    };
    const accept = async (share, user, expected = 200) => {
      const actor = await mint({ user });
      const path = `/api/chat/share/${share.token}/accept`;
      return { actor, result: await json(await request(actor, 'POST', path, {}), expected) };
    };
    const entry = (actor, expectedActorId, conversationId, body, key = crypto.randomUUID()) => {
      const path = `/api/chat/conversations/${conversationId}/collaboration/v2/entries`;
      return request(actor, 'POST', path, { ...body, expected_actor_id: expectedActorId }, { headers: { 'idempotency-key': key } });
    };

    await t.test('Agent conversation registration and owner sync replay across lost ACKs without granting execution', async () => {
      const registerPath = '/api/chat/agent-conversations/register';
      const registrationBody = { local_conversation_id: 'legacy-local-1700000000-abcd', title: 'Mapped agent conversation', model_id: 'fixture-model' };
      const attempts = await Promise.all(Array.from({ length: 6 }, () => request(ownerToken, 'POST', registerPath, registrationBody)));
      const registrations = await Promise.all(attempts.map(async response => {
        assert.ok([200, 201].includes(response.status)); return response.json();
      }));
      const ids = new Set(registrations.map(value => value.conversation_id));
      assert.equal(ids.size, 1);
      const conversationId = registrations[0].conversation_id;
      assert.match(conversationId, /^[0-9a-f-]{36}$/);
      assert.equal(Number((await pool.query('SELECT count(*) count FROM chat_agent_conversation_mappings WHERE local_conversation_id=$1', [registrationBody.local_conversation_id])).rows[0].count), 1);

      const syncPath = `/api/chat/conversations/${conversationId}/collaboration/owner-events`;
      const eventId = 'message-owner-stable-0001';
      const syncBody = { event_id: eventId, kind: 'assistant', content: 'Durable owner answer' };
      const synced = await Promise.all(Array.from({ length: 6 }, () => request(ownerToken, 'POST', syncPath, syncBody, { headers: { 'idempotency-key': eventId } })));
      const syncResults = await Promise.all(synced.map(async response => { assert.ok([200, 201].includes(response.status)); return response.json(); }));
      assert.equal(new Set(syncResults.map(value => value.event.sequence)).size, 1);
      assert.equal(Number((await pool.query("SELECT count(*) count FROM chat_messages WHERE conversation_id=$1 AND content='Durable owner answer'", [conversationId])).rows[0].count), 1);
      assert.equal((await request(ownerToken, 'POST', syncPath, { ...syncBody, content: 'changed' }, { headers: { 'idempotency-key': eventId } })).status, 409);

      const toolId = 'tool-owner-stable-0001';
      const toolBody = { event_id: toolId, kind: 'tool', tool: { name: 'read_file', status: 'completed', arguments: { secret: 'must-not-store' } } };
      const toolAck = await json(await request(ownerToken, 'POST', syncPath, toolBody, { headers: { 'idempotency-key': toolId } }), 201);
      assert.equal(toolAck.event.payload.source_event_id, toolId);
      // Simulate a receipt written before source_event_id shipped. Replay may
      // derive only from this exact immutable receipt key.
      await pool.query(
        `UPDATE chat_agent_sync_receipts
         SET result=result #- '{event,payload,source_event_id}'::text[]
         WHERE conversation_id=$1 AND owner_user_id=$2 AND event_id=$3`,
        [conversationId, users.owner, toolId],
      );
      const toolReplay = await json(await request(ownerToken, 'POST', syncPath, toolBody, { headers: { 'idempotency-key': toolId } }), 200);
      assert.equal(toolReplay.replayed, true);
      assert.equal(toolReplay.event.sequence, toolAck.event.sequence);
      assert.equal(toolReplay.event.payload.source_event_id, toolId);
      assert.equal((await request(ownerToken, 'POST', syncPath, {
        ...toolBody, tool: { name: 'read_file', status: 'failed' },
      }, { headers: { 'idempotency-key': toolId } })).status, 409);
      assert.doesNotMatch(JSON.stringify((await pool.query('SELECT payload FROM chat_collaboration_events WHERE conversation_id=$1 ORDER BY sequence', [conversationId])).rows), /must-not-store|arguments/);

      // Registration after a simulated lost ACK/restart resolves the same mapping.
      const replay = await json(await request(ownerToken, 'POST', registerPath, registrationBody), 200);
      assert.equal(replay.conversation_id, conversationId);
      assert.equal(replay.replayed, true);

      const share = await createShare(conversationId, 'viewer');
      await accept(share, users.viewer);
      const participantPage = await json(await request(ownerToken, 'GET', `/api/chat/conversations/${conversationId}/collaborators`, null), 200);
      assert.equal(participantPage.participants.length, 1);
      assert.equal(participantPage.participants[0].role, 'viewer');
      const actor = await mint({ user: users.viewer });
      const events = await json(await request(actor, 'GET', `/api/chat/conversations/${conversationId}/collaboration/events?after=0&limit=100`, null), 200);
      assert.ok(events.events.some(event => event.event_type === 'owner.message.synced' && event.payload.content === 'Durable owner answer'));
      for (const relation of ['viewer', 'reviewer', 'editor', 'admin', 'owner']) {
        assert.equal((await check(pool, { object: `conversation:${conversationId}`, relation, subject: `user:${users.viewer}` })).allowed, false);
      }
    });

    await t.test('revisioned owner sync updates one canonical message with CAS, ordered catch-up, and exact legacy adoption', async () => {
      const registerPath = '/api/chat/agent-conversations/register';
      const registration = await json(await request(ownerToken, 'POST', registerPath, {
        local_conversation_id: 'revisioned-owner-stream-0001', title: 'Revision stream proof', model_id: 'fixture-model',
      }), 201);
      const conversationId = registration.conversation_id;
      const syncPath = `/api/chat/conversations/${conversationId}/collaboration/v2/owner-events`;
      const legacySyncPath = `/api/chat/conversations/${conversationId}/collaboration/owner-events`;
      const missingRevisionId = 'message-owner-missing-v2-fields';
      assert.equal((await request(ownerToken, 'POST', syncPath, {
        event_id: missingRevisionId, kind: 'assistant', content: 'must refuse before write',
      }, { headers: { 'idempotency-key': missingRevisionId } })).status, 400);
      assert.equal(Number((await pool.query(
        'SELECT count(*) count FROM chat_agent_sync_receipts WHERE conversation_id=$1 AND event_id=$2',
        [conversationId, missingRevisionId],
      )).rows[0].count), 0);
      const sendRevision = (body) => request(ownerToken, 'POST', syncPath, body, { headers: { 'idempotency-key': body.event_id } });
      const source = 'message-owner-stream-0001';
      const rev1Body = {
        event_id: 'message-owner-stream-r0001', kind: 'assistant', content: 'Par',
        source_message_id: source, revision: 1, expected_revision: 0, state: 'streaming',
      };
      const rev1 = await json(await sendRevision(rev1Body), 201);
      const rev2 = await json(await sendRevision({
        ...rev1Body, event_id: 'message-owner-stream-r0002', content: 'Partial answer', revision: 2, expected_revision: 1,
      }), 201);
      const rev3Body = {
        ...rev1Body, event_id: 'message-owner-stream-r0003', content: 'Complete answer', revision: 3, expected_revision: 2, state: 'complete',
      };
      const rev3 = await json(await sendRevision(rev3Body), 201);
      assert.equal(rev1.message.id, rev2.message.id);
      assert.equal(rev2.message.id, rev3.message.id);
      assert.deepEqual([rev1.event.payload.revision, rev2.event.payload.revision, rev3.event.payload.revision], [1, 2, 3]);
      assert.deepEqual([rev1.event.payload.state, rev2.event.payload.state, rev3.event.payload.state], ['streaming', 'streaming', 'complete']);
      assert.equal(rev3.event.payload.source_message_id, source);
      assert.equal(rev3.event.payload.legacy_adopted, false);
      assert.equal(rev3.message.source_message_id, source);
      assert.equal(rev3.message.revision, 3);
      assert.equal(rev3.message.state, 'complete');
      const canonical = (await pool.query(
        'SELECT id,content,source_revision,source_state FROM chat_messages WHERE conversation_id=$1 AND source_message_id=$2',
        [conversationId, source],
      )).rows;
      assert.equal(canonical.length, 1);
      assert.equal(canonical[0].id, rev1.message.id);
      assert.equal(canonical[0].content, 'Complete answer');
      assert.equal(Number(canonical[0].source_revision), 3);
      assert.equal(canonical[0].source_state, 'complete');

      const replay = await json(await sendRevision(rev3Body), 200);
      assert.equal(replay.replayed, true);
      assert.equal(replay.event.sequence, rev3.event.sequence);
      assert.equal((await sendRevision({ ...rev3Body, content: 'changed lost ACK payload' })).status, 409);
      const gap = await json(await sendRevision({
        ...rev3Body, event_id: 'message-owner-stream-r0005', content: 'gap', revision: 5, expected_revision: 4,
      }), 409);
      assert.equal(gap.code, 'sync_revision_conflict');
      assert.equal(gap.current_revision, 3);
      assert.equal((await sendRevision({
        ...rev3Body, event_id: 'message-owner-stream-invalid-gap', content: 'invalid gap', revision: 5, expected_revision: 3,
      })).status, 400);
      assert.equal((await sendRevision({
        ...rev3Body, event_id: 'message-owner-stream-role-change', kind: 'user', revision: 4, expected_revision: 3,
      })).status, 409);
      assert.equal((await sendRevision({
        ...rev3Body, event_id: 'message-owner-stream-state-regression', content: 'cannot reopen', revision: 4, expected_revision: 3, state: 'streaming',
      })).status, 409);
      assert.equal((await sendRevision({
        event_id: 'tool-owner-version-contamination', kind: 'tool', tool: { name: 'search', status: 'started' },
        source_message_id: 'tool-source-contamination', revision: 1, expected_revision: 0, state: 'streaming',
      })).status, 400);
      assert.equal((await sendRevision({
        event_id: 'message-owner-partial-version', kind: 'assistant', content: 'partial fields', source_message_id: 'partial-version-source', revision: 1,
      })).status, 400);

      const contenders = await Promise.all(['alpha', 'beta'].map((content, index) => sendRevision({
        ...rev3Body, event_id: `message-owner-stream-r0004-${index}`, content, revision: 4, expected_revision: 3, state: 'complete',
      })));
      assert.deepEqual(contenders.map(response => response.status).sort(), [201, 409]);
      const afterRace = (await pool.query(
        'SELECT id,content,source_revision FROM chat_messages WHERE conversation_id=$1 AND source_message_id=$2', [conversationId, source],
      )).rows[0];
      assert.equal(afterRace.id, rev1.message.id);
      assert.equal(Number(afterRace.source_revision), 4);
      assert.ok(['alpha', 'beta'].includes(afterRace.content));

      const ownerEvents = await json(await request(ownerToken, 'GET', `/api/chat/conversations/${conversationId}/collaboration/events?after=0&limit=100`, null), 200);
      const revisions = ownerEvents.events.filter(event => event.event_type === 'owner.message.synced' && event.payload.source_message_id === source);
      assert.deepEqual(revisions.map(event => event.payload.revision), [1, 2, 3, 4]);
      assert.equal(new Set(revisions.map(event => event.message_id)).size, 1);
      assert.ok(revisions.every((event, index) => index === 0 || Number(event.sequence) > Number(revisions[index - 1].sequence)));

      const legacySource = 'message-owner-legacy-0001';
      const legacy = await json(await request(ownerToken, 'POST', legacySyncPath, {
        event_id: legacySource, kind: 'assistant', content: 'Legacy partial',
      }, { headers: { 'idempotency-key': legacySource } }), 201);
      const adopted = await json(await sendRevision({
        event_id: 'message-owner-legacy-r0001', kind: 'assistant', content: 'Adopted complete',
        source_message_id: legacySource, revision: 1, expected_revision: 0, state: 'complete',
      }), 201);
      assert.equal(adopted.message.id, legacy.message.id);
      assert.equal(adopted.event.payload.legacy_adopted, true);
      assert.equal(Number((await pool.query(
        'SELECT count(*) count FROM chat_messages WHERE conversation_id=$1 AND id=$2', [conversationId, legacy.message.id],
      )).rows[0].count), 1);
      const adoptedCatchup = await json(await request(ownerToken, 'GET', `/api/chat/conversations/${conversationId}/collaboration/events?after=${legacy.event.sequence}&limit=100`, null), 200);
      assert.ok(adoptedCatchup.events.some(event => event.message_id === legacy.message.id
        && event.payload.source_message_id === legacySource && event.payload.revision === 1 && event.payload.legacy_adopted === true));

      const legacyToolId = 'tool-owner-legacy-no-message';
      await json(await request(ownerToken, 'POST', legacySyncPath, {
        event_id: legacyToolId, kind: 'tool', tool: { name: 'search', status: 'completed' },
      }, { headers: { 'idempotency-key': legacyToolId } }), 201);
      const beforeAmbiguous = Number((await pool.query('SELECT count(*) count FROM chat_messages WHERE conversation_id=$1', [conversationId])).rows[0].count);
      const ambiguous = await json(await sendRevision({
        event_id: 'message-owner-ambiguous-r0001', kind: 'assistant', content: 'must not guess',
        source_message_id: legacyToolId, revision: 1, expected_revision: 0, state: 'complete',
      }), 409);
      assert.equal(ambiguous.code, 'sync_legacy_adoption_conflict');
      assert.equal(Number((await pool.query('SELECT count(*) count FROM chat_messages WHERE conversation_id=$1', [conversationId])).rows[0].count), beforeAmbiguous);

      const strictToolId = 'tool-owner-strict-v2-event';
      const strictTool = await json(await request(ownerToken, 'POST', syncPath, {
        event_id: strictToolId, kind: 'tool', tool: { name: 'search', status: 'completed' },
      }, { headers: { 'idempotency-key': strictToolId } }), 201);
      assert.equal(strictTool.event.payload.source_event_id, strictToolId);

      const wrongClient = await mint({ client: 'xeno-agent-interface' });
      assert.equal((await request(wrongClient, 'POST', syncPath, {
        event_id: 'message-owner-wrong-client-r0002', kind: 'assistant', content: 'must not update',
        source_message_id: legacySource, revision: 2, expected_revision: 1, state: 'complete',
      }, { headers: { 'idempotency-key': 'message-owner-wrong-client-r0002' } })).status, 404);
      assert.equal((await pool.query('SELECT content FROM chat_messages WHERE id=$1', [legacy.message.id])).rows[0].content, 'Adopted complete');
    });

    await t.test('public token preview is sanitized and token material is never stored', async () => {
      const conversationId = await makeConversation();
      const share = await createShare(conversationId, 'viewer');
      const preview = await json(await request(null, 'GET', `/api/chat/share/${share.token}`, null), 200);
      assert.equal(preview.share.mode, 'live');
      assert.equal(preview.share.participant_role, 'viewer');
      assert.deepEqual(preview.share.messages.map((message) => message.role), ['user', 'assistant']);
      assert.doesNotMatch(JSON.stringify(preview), /private system instruction|grant=private/);
      await pool.query(
        `INSERT INTO chat_messages(conversation_id,user_id,created_by_user_id,role,content,message_index)
         SELECT $1,$2,$2,'assistant',repeat('x',3000),value FROM generate_series(3,112) value`,
        [conversationId, users.owner],
      );
      const bounded = await json(await request(null, 'GET', `/api/chat/share/${share.token}`, null), 200);
      assert.equal(bounded.share.messages.length, 100);
      assert.ok(bounded.share.messages.every((message) => message.content.length <= 2048));
      const stored = (await pool.query('SELECT share_token,token_digest FROM chat_shared_conversations WHERE id=$1', [share.id])).rows[0];
      assert.equal(stored.share_token, null);
      assert.notEqual(stored.token_digest, share.token);
      assert.equal((await request(null, 'POST', `/api/chat/share/${share.token}/accept`, {})).status, 401);
      assert.equal((await request(null, 'GET', '/api/chat/share/not-a-token', null)).status, 404);
      const workspaceConversation = await makeWorkspaceConversation();
      const workspaceShare = await createShare(workspaceConversation, 'viewer', 'live', 'workspace');
      assert.equal((await request(null, 'GET', `/api/chat/share/${workspaceShare.token}`, null)).status, 404);
      const outsider = await mint({ user: users.outsider });
      assert.equal((await request(outsider, 'POST', `/api/chat/share/${workspaceShare.token}/accept`, {})).status, 404);
    });

    await t.test('viewer, commenter and contributor are exact collaboration roles with no ordinary chat authority', async () => {
      const cases = [
        ['viewer', users.viewer, 404, 404],
        ['commenter', users.commenter, 201, 404],
        ['contributor', users.contributor, 201, 201],
      ];
      for (const [role, user, commentStatus, messageStatus] of cases) {
        const conversationId = await makeConversation(role);
        const share = await createShare(conversationId, role);
        const { actor } = await accept(share, user);
        assert.equal((await entry(actor, user, conversationId, { kind: 'comment', content: `${role} comment` })).status, commentStatus);
        assert.equal((await entry(actor, user, conversationId, { kind: 'message', content: `${role} message` })).status, messageStatus);
        for (const relation of ['viewer', 'reviewer', 'editor', 'admin', 'owner']) {
          assert.equal((await check(pool, { object: `conversation:${conversationId}`, relation, subject: `user:${user}` })).allowed, false);
        }
        const ordinary = `/api/chat/conversations/${conversationId}/messages`;
        assert.equal((await request(actor, 'POST', ordinary, { role: 'user', content: 'must not bypass collaboration route' })).status, 404);
        const admin = `/api/chat/conversations/${conversationId}/share`;
        assert.equal((await request(actor, 'POST', admin, { mode: 'live', role: 'viewer' })).status, 404);
      }
    });

    await t.test('idempotent concurrent append has one message and monotonic event ordering', async () => {
      const conversationId = await makeConversation('ordering');
      const share = await createShare(conversationId, 'contributor');
      const { actor } = await accept(share, users.racer);
      const missingActorKey = crypto.randomUUID();
      const entryPath = `/api/chat/conversations/${conversationId}/collaboration/v2/entries`;
      assert.equal((await request(actor, 'POST', entryPath, { kind: 'message', content: 'missing actor binding' }, {
        headers: { 'idempotency-key': missingActorKey },
      })).status, 400);
      assert.equal(Number((await pool.query(
        'SELECT count(*) count FROM chat_collaboration_idempotency WHERE conversation_id=$1 AND idempotency_key=$2',
        [conversationId, missingActorKey],
      )).rows[0].count), 0);
      const legacyEntryPath = `/api/chat/conversations/${conversationId}/collaboration/entries`;
      const legacyEntryKey = crypto.randomUUID();
      const legacyEntryBody = { kind: 'message', content: 'legacy route remains replayable' };
      const legacyEntry = await json(await request(actor, 'POST', legacyEntryPath, legacyEntryBody, {
        headers: { 'idempotency-key': legacyEntryKey },
      }), 201);
      const legacyEntryReplay = await json(await request(actor, 'POST', legacyEntryPath, legacyEntryBody, {
        headers: { 'idempotency-key': legacyEntryKey },
      }), 200);
      assert.equal(legacyEntryReplay.event.sequence, legacyEntry.event.sequence);
      assert.equal(legacyEntryReplay.event.payload.source_event_id, legacyEntryKey);
      const key = crypto.randomUUID();
      const duplicates = await Promise.all(Array.from({ length: 8 }, () => entry(actor, users.racer, conversationId, { kind: 'message', content: 'exactly once' }, key)));
      assert.deepEqual(duplicates.map((response) => response.status).sort(), [200, 200, 200, 200, 200, 200, 200, 201]);
      const duplicateResults = await Promise.all(duplicates.map(response => response.json()));
      assert.equal(new Set(duplicateResults.map(result => result.event.sequence)).size, 1);
      assert.ok(duplicateResults.every(result => result.event.payload.source_event_id === key));
      const messageSequence = duplicateResults[0].event.sequence;
      assert.equal(Number((await pool.query("SELECT count(*) count FROM chat_messages WHERE conversation_id=$1 AND content='exactly once'", [conversationId])).rows[0].count), 1);
      await pool.query(
        `UPDATE chat_collaboration_idempotency
         SET result=result #- '{event,payload,source_event_id}'::text[]
         WHERE conversation_id=$1 AND actor_user_id=$2 AND idempotency_key=$3`,
        [conversationId, users.racer, key],
      );
      const legacyReplayResponse = await entry(actor, users.racer, conversationId, { kind: 'message', content: 'exactly once' }, key);
      const legacyReplay = await json(legacyReplayResponse, 200);
      assert.equal(legacyReplay.replayed, true);
      assert.equal(legacyReplay.event.sequence, messageSequence);
      assert.equal(legacyReplay.event.payload.source_event_id, key);
      await pool.query(
        `UPDATE chat_collaboration_idempotency
         SET result=jsonb_set(result,'{event,payload,source_event_id}',to_jsonb('different-operation-id'::text))
         WHERE conversation_id=$1 AND actor_user_id=$2 AND idempotency_key=$3`,
        [conversationId, users.racer, key],
      );
      assert.equal((await entry(actor, users.racer, conversationId, { kind: 'message', content: 'exactly once' }, key)).status, 409);
      assert.equal((await entry(actor, users.racer, conversationId, { kind: 'message', content: 'changed payload' }, key)).status, 409);
      assert.equal((await entry(actor, users.owner, conversationId, { kind: 'message', content: 'exactly once' }, key)).status, 409);
      const commentKey = crypto.randomUUID();
      const commentAck = await json(await entry(actor, users.racer, conversationId, { kind: 'comment', content: 'exact comment identity' }, commentKey), 201);
      assert.equal(commentAck.event.payload.source_event_id, commentKey);
      const commentReplay = await json(await entry(actor, users.racer, conversationId, { kind: 'comment', content: 'exact comment identity' }, commentKey), 200);
      assert.equal(commentReplay.event.sequence, commentAck.event.sequence);
      assert.equal(commentReplay.event.payload.source_event_id, commentKey);
      const concurrent = await Promise.all(Array.from({ length: 6 }, (_, index) => entry(actor, users.racer, conversationId, { kind: 'message', content: `ordered-${index}` })));
      assert.ok(concurrent.every((response) => response.status === 201));
      const eventsPath = `/api/chat/conversations/${conversationId}/collaboration/events?after=0&limit=200`;
      const events = await json(await request(actor, 'GET', eventsPath, null), 200);
      assert.deepEqual(events.events.map((event) => Number(event.sequence)), Array.from({ length: events.events.length }, (_, index) => index + 1));
      const caughtUp = await json(await request(actor, 'GET', `/api/chat/conversations/${conversationId}/collaboration/events?after=${events.cursor}`, null), 200);
      assert.equal(caughtUp.events.length, 0);
      assert.equal((await request(actor, 'GET', `/api/chat/conversations/${conversationId}/collaboration/events?after=${events.current_cursor + 1}`, null)).status, 409);
      const baseSequence = events.current_cursor;
      await pool.query(
        `INSERT INTO chat_collaboration_events(conversation_id,sequence,event_type,payload)
         SELECT $1,$2+value,'owner.message.synced',jsonb_build_object('kind','message','role','assistant','content',repeat('z',32768),'message_index',1000+value)
         FROM generate_series(1,200) value`,
        [conversationId, baseSequence],
      );
      await pool.query('UPDATE chat_collaboration_event_heads SET last_sequence=$2+200 WHERE conversation_id=$1', [conversationId, baseSequence]);
      let bytePageCursor = baseSequence;
      const bytePagedSequences = [];
      do {
        const boundedEventsResponse = await request(actor, 'GET', `/api/chat/conversations/${conversationId}/collaboration/events?after=${bytePageCursor}&limit=200`, null);
        const boundedEventsText = await boundedEventsResponse.text(); assert.equal(boundedEventsResponse.status, 200);
        const boundedEvents = JSON.parse(boundedEventsText);
        assert.ok(Buffer.byteLength(boundedEventsText, 'utf8') < 1_100_000);
        assert.ok(boundedEvents.events.length > 0 && boundedEvents.events.length < 200);
        assert.equal(Number(boundedEvents.events[0].sequence), bytePageCursor + 1);
        assert.equal(Number(boundedEvents.events.at(-1).sequence), boundedEvents.cursor);
        bytePagedSequences.push(...boundedEvents.events.map(event => Number(event.sequence)));
        bytePageCursor = boundedEvents.cursor;
        if (!boundedEvents.has_more) break;
      } while (bytePagedSequences.length <= 200);
      assert.equal(bytePageCursor, baseSequence + 200);
      assert.deepEqual(bytePagedSequences, Array.from({ length: 200 }, (_, index) => baseSequence + index + 1));
      const indexes = (await pool.query('SELECT message_index FROM chat_messages WHERE conversation_id=$1 ORDER BY message_index', [conversationId])).rows.map((row) => row.message_index);
      assert.equal(new Set(indexes).size, indexes.length);
    });

    await t.test('accept/revoke and write/revoke races are linearizable and revocation is immediate', async () => {
      const conversationId = await makeConversation('race');
      const share = await createShare(conversationId, 'contributor');
      const racerToken = await mint({ user: users.outsider });
      const acceptPath = `/api/chat/share/${share.token}/accept`;
      const revokePath = `/api/chat/conversations/${conversationId}/shares/${share.id}/live`;
      const [accepted, revoked] = await Promise.all([
        request(racerToken, 'POST', acceptPath, {}), request(ownerToken, 'DELETE', revokePath, null),
      ]);
      assert.equal(revoked.status, 200);
      assert.ok([200, 404].includes(accepted.status));
      assert.equal(Number((await pool.query('SELECT count(*) count FROM chat_live_participants WHERE conversation_id=$1 AND revoked_at IS NULL', [conversationId])).rows[0].count), 0);
      assert.equal(Number((await pool.query("SELECT count(*) count FROM relationship_tuples WHERE object_type='conversation' AND object_id=$1 AND subject_id=$2 AND relation LIKE 'collaboration_%'", [conversationId, users.outsider])).rows[0].count), 0);

      const secondConversation = await makeConversation('write-race');
      const secondShare = await createShare(secondConversation, 'contributor');
      const { actor } = await accept(secondShare, users.outsider);
      const write = entry(actor, users.outsider, secondConversation, { kind: 'message', content: 'linearized write' });
      const revoke = request(ownerToken, 'DELETE', `/api/chat/conversations/${secondConversation}/collaborators/${users.outsider}`, null);
      const outcomes = await Promise.all([write, revoke]);
      assert.equal(outcomes[1].status, 200);
      assert.ok([201, 404].includes(outcomes[0].status));
      assert.equal((await entry(actor, users.outsider, secondConversation, { kind: 'message', content: 'after revoke' })).status, 404);
    });

    await t.test('live mutations require DPoP and collaboration scope', async () => {
      const conversationId = await makeConversation('authority');
      const path = `/api/chat/conversations/${conversationId}/share`;
      const body = { mode: 'live', role: 'viewer' };
      assert.equal((await request(ownerToken, 'POST', path, body, { withProof: false })).status, 401);
      assert.equal((await request(await mint({ bound: false }), 'POST', path, body)).status, 401);
      assert.equal((await request(await mint({ scope: 'team:read' }), 'POST', path, body)).status, 403);
      const replayProof = proof(ownerToken, 'POST', path);
      assert.equal((await request(ownerToken, 'POST', path, body, { proof: replayProof })).status, 200);
      assert.equal((await request(ownerToken, 'POST', path, body, { proof: replayProof })).status, 401);
      assert.equal((await request(ownerToken, 'POST', path, { ...body, role: 'admin' })).status, 400);
      const share = await createShare(conversationId, 'contributor');
      const { actor } = await accept(share, users.contributor);
      assert.equal((await entry(actor, users.contributor, conversationId, { kind: 'message', content: 'x'.repeat(32769) })).status, 400);
      const allowed = await Promise.all(Array.from({ length: 30 }, (_, index) => (
        entry(actor, users.contributor, conversationId, { kind: 'comment', content: `bounded-${index}` })
      )));
      assert.ok(allowed.every((response) => response.status === 201));
      assert.equal((await entry(actor, users.contributor, conversationId, { kind: 'comment', content: 'over rate' })).status, 429);
    });

    await t.test('snapshot mode remains explicitly copy-on-accept compatible', async () => {
      const conversationId = await makeConversation('snapshot');
      const share = await createShare(conversationId, 'viewer', 'snapshot');
      assert.equal(share.mode, 'snapshot');
      const { result } = await accept(share, users.viewer);
      assert.notEqual(result.conversation.id, conversationId);
      assert.equal(result.conversation.messages.length, 2);
      assert.equal((await pool.query('SELECT mode,share_token FROM chat_shared_conversations WHERE id=$1', [share.id])).rows[0].mode, 'snapshot');
      assert.equal((await pool.query('SELECT share_token FROM chat_shared_conversations WHERE id=$1', [share.id])).rows[0].share_token, null);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await pool.end();
  }
});
