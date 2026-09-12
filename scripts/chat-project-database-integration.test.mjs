import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import express from 'express';

import { check, writeTuples } from '../src/server/utils/authzReBAC.js';
import {
  createAuthorizedProject,
  linkAssetToProject,
  requireResourceRelation,
  unlinkAssetFromProject,
  userPrincipal,
} from '../src/server/services/chatProjectAuthority.js';
import {
  createAuthorizedLibraryContentPath,
  getAuthorizedLibraryFile,
  listLibraryItems,
  registerManagedLibraryFile,
  verifyAuthorizedLibraryContentRequest,
} from '../src/server/services/libraryAssets.js';
import { assembleProjectContext } from '../src/server/services/chatProjectContext.js';
import chatRoutes from '../src/server/routes/chatRoutes.js';
import { extractAsset } from '../src/server/services/library/assetExtractors.js';
import { ingestLibraryAsset } from '../src/server/services/library/assetIngestionService.js';
import {
  claimScheduledRun,
  dispatchDueScheduledRuns,
  executeScheduledRunWithFailureRecording,
  publishMessages,
} from '../src/server/workers/chatScheduledWorker.js';

process.env.LIBRARY_CONTENT_SECRET ||= 'integration-test-library-content-secret';

const connectionString = process.env.TEST_DATABASE_URL;
const pool = connectionString ? new pg.Pool({ connectionString, max: 6 }) : null;
const marker = `spec-${Date.now()}-${Math.random().toString(16).slice(2)}`;
let ownerId;
let outsiderId;
let workspaceId;
let personalProject;
let workspaceProject;
let asset;
let tempDirectory;
let managedTempDirectory;

test.before(async () => {
  if (!pool) return;
  const owner = await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'test-only','$1',TRUE,NOW()) RETURNING id`,
    [`${marker}-owner`, `${marker}-owner@example.test`],
  );
  ownerId = owner.rows[0].id;
  outsiderId = (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'test-only','$1',TRUE,NOW()) RETURNING id`,
    [`${marker}-outsider`, `${marker}-outsider@example.test`],
  )).rows[0].id;
  workspaceId = (await pool.query(
    `INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$3) RETURNING id`,
    [ownerId, marker, marker],
  )).rows[0].id;
  await writeTuples(pool, { writes: [
    { object: `workspace:${workspaceId}`, relation: 'owner', subject: `user:${ownerId}` },
    { object: `workspace:${workspaceId}`, relation: 'viewer', subject: `user:${outsiderId}` },
  ] });
  tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'xeno-chat-project-'));
  managedTempDirectory = path.join(process.cwd(), 'uploads', marker);
  await fs.mkdir(managedTempDirectory, { recursive: true });
});

test.after(async () => {
  if (tempDirectory) await fs.rm(tempDirectory, { recursive: true, force: true });
  if (managedTempDirectory) await fs.rm(managedTempDirectory, { recursive: true, force: true });
  if (pool) await pool.end();
});

test('transactional project creation enforces personal and workspace authority', { skip: !pool }, async () => {
  personalProject = await createAuthorizedProject(pool, {
    principal: userPrincipal(ownerId), name: `${marker} personal`, customInstructions: 'Use the project truth.',
  });
  workspaceProject = await createAuthorizedProject(pool, {
    principal: userPrincipal(ownerId), workspaceId, name: `${marker} workspace`,
  });
  assert.equal(personalProject.owner_user_id, ownerId);
  assert.equal(personalProject.workspace_id, null);
  assert.equal(workspaceProject.owner_user_id, null);
  assert.equal(workspaceProject.workspace_id, workspaceId);
  await assert.rejects(
    createAuthorizedProject(pool, { principal: userPrincipal(outsiderId), workspaceId, name: 'forbidden' }),
    /access denied/i,
  );
});

test('canonical asset hashes bytes, links without copying, and revokes an issued grant on unlink', { skip: !pool }, async () => {
  const storagePath = path.join(tempDirectory, `${marker}.md`);
  await fs.writeFile(storagePath, '# XENO\nThe project-only launch code is ORBIT-7429.\n', 'utf8');
  asset = await registerManagedLibraryFile(pool, {
    userId: ownerId,
    filename: `${marker}.md`,
    originalName: 'project-truth.md',
    mimeType: 'text/markdown',
    fileSize: (await fs.stat(storagePath)).size,
    storagePath,
    metadata: { source: 'integration-test' },
  });
  assert.match(asset.content_sha256, /^[a-f0-9]{64}$/);
  const relation = await linkAssetToProject(pool, {
    principal: userPrincipal(ownerId), projectId: personalProject.id, assetId: asset.id,
  });
  assert.equal(relation.asset_id, asset.id);
  assert.equal(await getAuthorizedLibraryFile(pool, userPrincipal(outsiderId), asset.id), null);
  assert.equal(await createAuthorizedLibraryContentPath(pool, {
    assetId: asset.id, principal: userPrincipal(ownerId), projectId: personalProject.id, ttlSeconds: 300,
  }), null, 'quarantined bytes must not receive a signed capability');
  await pool.query(
    "UPDATE library_asset_ingestions SET state='ready',extractor_id='test',extractor_version='1',completed_at=NOW() WHERE asset_id=$1",
    [asset.id],
  );
  const signed = await createAuthorizedLibraryContentPath(pool, {
    assetId: asset.id, principal: userPrincipal(ownerId), projectId: personalProject.id, ttlSeconds: 300,
  });
  const url = new URL(signed.path, 'https://xenostudio.ai');
  assert.ok(await verifyAuthorizedLibraryContentRequest(pool, {
    assetId: asset.id,
    grantId: url.searchParams.get('grant'),
    expires: url.searchParams.get('expires'),
    download: false,
    signature: url.searchParams.get('sig'),
  }));
  await unlinkAssetFromProject(pool, { principal: userPrincipal(ownerId), projectId: personalProject.id, assetId: asset.id });
  assert.equal(await verifyAuthorizedLibraryContentRequest(pool, {
    assetId: asset.id,
    grantId: url.searchParams.get('grant'),
    expires: url.searchParams.get('expires'),
    download: false,
    signature: url.searchParams.get('sig'),
  }), null);
});

test('launch-format ingestion records durable ready or unsupported outcomes after a clean scan', { skip: !pool }, async () => {
  const docx = await Packer.toBuffer(new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun('Durable DOCX fact INDIGO-64')] })] }],
  }));
  const cases = [
    { name: 'facts.md', mime: 'text/markdown', body: '# Fact\nDurable Markdown fact GREEN-11', expected: /GREEN-11/ },
    { name: 'agent.ts', mime: 'application/javascript', body: 'export const fact = "BLUE-22";', expected: /BLUE-22/ },
    { name: 'facts.csv', mime: 'text/csv', body: 'key,value\nfact,RED-33', expected: /RED-33/ },
    { name: 'facts.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', body: docx, expected: /INDIGO-64/ },
    { name: 'text.pdf', mime: 'application/pdf', body: '%PDF text fixture', expected: /VIOLET-55/ },
    { name: 'scan.pdf', mime: 'application/pdf', body: '%PDF scan fixture', expected: /ORANGE-66/ },
  ];
  const runTool = async (executable, args) => {
    const tool = String(executable);
    if (tool.includes('pdfinfo')) return 'Pages: 1\n';
    if (tool.includes('pdftotext')) return String(args[1]).endsWith('text.pdf') ? 'Text PDF fact VIOLET-55\f' : '\f';
    if (tool.includes('pdftoppm')) {
      await fs.writeFile(`${args.at(-1)}.png`, 'rendered');
      return '';
    }
    if (tool.includes('identify')) return '800 600';
    if (tool.includes('tesseract')) return 'Image PDF fact ORANGE-66';
    throw new Error(`unexpected extractor tool ${tool}`);
  };
  const semanticIndexer = async (db, ingestionId) => (await db.query(
    "UPDATE library_asset_ingestions SET semantic_status='disabled' WHERE id=$1 RETURNING *",
    [ingestionId],
  )).rows[0];

  for (const entry of cases) {
    const storagePath = path.join(managedTempDirectory, entry.name);
    await fs.writeFile(storagePath, entry.body);
    const registered = await registerManagedLibraryFile(pool, {
      userId: ownerId,
      filename: `${marker}-${entry.name}`,
      originalName: entry.name,
      mimeType: entry.mime,
      fileSize: (await fs.stat(storagePath)).size,
      storagePath,
      metadata: { source: 'ingestion-contract-test' },
    });
    await ingestLibraryAsset(pool, registered.id, {
      scanner: async () => {},
      extractor: (request) => extractAsset({ ...request, runTool }),
      semanticIndexer,
    });
    const state = (await pool.query(
      `SELECT i.state,i.error_code,string_agg(c.content,' ' ORDER BY c.ordinal) AS content
       FROM library_asset_ingestions i LEFT JOIN library_asset_chunks c ON c.ingestion_id=i.id
       WHERE i.asset_id=$1 GROUP BY i.id`,
      [registered.id],
    )).rows[0];
    assert.equal(state.state, 'ready', entry.name);
    assert.equal(state.error_code, null, entry.name);
    assert.match(state.content, entry.expected, entry.name);
  }

  const storagePath = path.join(managedTempDirectory, 'unsupported.bin');
  await fs.writeFile(storagePath, 'not a supported document');
  const unsupported = await registerManagedLibraryFile(pool, {
    userId: ownerId,
    filename: `${marker}-unsupported.bin`,
    originalName: 'unsupported.bin',
    mimeType: 'application/octet-stream',
    fileSize: (await fs.stat(storagePath)).size,
    storagePath,
    metadata: { source: 'ingestion-contract-test' },
  });
  await assert.rejects(ingestLibraryAsset(pool, unsupported.id, {
    scanner: async () => {},
    semanticIndexer,
  }), (error) => error.code === 'unsupported_type');
  const failed = (await pool.query(
    'SELECT state,error_code FROM library_asset_ingestions WHERE asset_id=$1',
    [unsupported.id],
  )).rows[0];
  assert.deepEqual(failed, { state: 'unsupported', error_code: 'unsupported_type' });
});

test('scanner absence keeps the durable asset quarantined with no extracted chunks', { skip: !pool }, async () => {
  const storagePath = path.join(managedTempDirectory, 'scanner-down.md');
  await fs.writeFile(storagePath, 'This content must never reach extraction while the scanner is down.');
  const registered = await registerManagedLibraryFile(pool, {
    userId: ownerId,
    filename: `${marker}-scanner-down.md`,
    originalName: 'scanner-down.md',
    mimeType: 'text/markdown',
    fileSize: (await fs.stat(storagePath)).size,
    storagePath,
    metadata: { source: 'scanner-contract-test' },
  });
  let extractorCalled = false;
  await assert.rejects(ingestLibraryAsset(pool, registered.id, {
    scanner: async () => { throw Object.assign(new Error('scanner missing'), { code: 'scanner_unavailable' }); },
    extractor: async () => { extractorCalled = true; throw new Error('must not run'); },
  }), (error) => error.code === 'scanner_unavailable');
  assert.equal(extractorCalled, false);
  const state = (await pool.query(
    `SELECT i.state,i.error_code,COUNT(c.id)::int AS chunks
     FROM library_asset_ingestions i LEFT JOIN library_asset_chunks c ON c.ingestion_id=i.id
     WHERE i.asset_id=$1 GROUP BY i.id`,
    [registered.id],
  )).rows[0];
  assert.deepEqual(state, { state: 'quarantined', error_code: 'scanner_unavailable', chunks: 0 });
});

test('authorized lexical context returns the unique fact and exact instruction revision', { skip: !pool }, async () => {
  await linkAssetToProject(pool, { principal: userPrincipal(ownerId), projectId: personalProject.id, assetId: asset.id });
  const ingestion = (await pool.query(
    `UPDATE library_asset_ingestions SET state='ready',extractor_id='test',extractor_version='1',completed_at=NOW()
     WHERE asset_id=$1 RETURNING id`, [asset.id],
  )).rows[0];
  await pool.query(
    `INSERT INTO library_asset_chunks(ingestion_id,asset_id,ordinal,content,token_count,source_locator)
     VALUES($1,$2,0,$3,12,'{"line":2}'::jsonb)`,
    [ingestion.id, asset.id, 'The project-only launch code is ORBIT-7429.'],
  );
  const conversationId = (await pool.query(
    `INSERT INTO chat_conversations(user_id,title,model_id,project_id) VALUES($1,'Context test','gpt-5.6',$2) RETURNING id`,
    [ownerId, personalProject.id],
  )).rows[0].id;
  await writeTuples(pool, { writes: [{ object: `conversation:${conversationId}`, relation: 'parent', subject: `project:${personalProject.id}` }] });
  const context = await assembleProjectContext({
    db: pool, principal: userPrincipal(ownerId), projectId: personalProject.id,
    conversationId, query: 'What is ORBIT-7429?', modelId: 'gpt-5.6', maxInputTokens: 8_000,
  });
  assert.equal(context.instructionRevision, 1);
  assert.match(context.contentBlocks[0].content, /ORBIT-7429/);
  assert.equal(context.manifest.sources[0].asset_id, asset.id);
  assert.match(context.manifest.sources[0].chunk_id, /^[0-9a-f-]{36}$/i);
  assert.equal(context.manifest.sources[0].display_name, 'project-truth.md');
  assert.deepEqual(context.manifest.sources[0].locator, { line: 2 });
});

test('interactive context handles are response-bound, single-use, and reload only safe citations', { skip: !pool }, async () => {
  const conversationId = (await pool.query(
    `INSERT INTO chat_conversations(
       user_id,owner_user_id,created_by_user_id,project_id,title,model_id,interface_id
     ) VALUES($1,NULL,$1,$2,$3,'xeno-test','playground') RETURNING id`,
    [ownerId, personalProject.id, `${marker} context-bound conversation`],
  )).rows[0].id;
  await writeTuples(pool, { writes: [
    { object: `conversation:${conversationId}`, relation: 'owner', subject: `user:${ownerId}` },
    { object: `conversation:${conversationId}`, relation: 'parent', subject: `project:${personalProject.id}` },
  ] });
  const content = 'The answer cites [Project source 1].';
  const safeSources = [{
    asset_id: asset.id,
    chunk_id: crypto.randomUUID(),
    ordinal: 0,
    locator: { format: 'text/markdown', line_start: 1, line_end: 2 },
    display_name: 'project-truth.md',
    mime_type: 'text/markdown',
    digest: crypto.createHash('sha256').update('safe source').digest('hex'),
    token_count: 8,
  }];
  const makeContext = async (response) => (await pool.query(
    `INSERT INTO chat_generation_contexts(
       conversation_id,project_id,user_id,request_hash,response_hash,context_manifest,safe_sources
     ) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) RETURNING id`,
    [
      conversationId,
      personalProject.id,
      ownerId,
      crypto.createHash('sha256').update(`request:${response}`).digest('hex'),
      crypto.createHash('sha256').update(response).digest('hex'),
      JSON.stringify({ schema_version: 1, sources: safeSources, hidden_policy: 'must never reload' }),
      JSON.stringify(safeSources),
    ],
  )).rows[0].id;
  const contextId = await makeContext(content);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; req.user = { id: ownerId, email: `${marker}@example.test` }; next(); });
  app.use(chatRoutes);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const persisted = await fetch(`${base}/conversations/${conversationId}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'assistant', content, context_record_id: contextId }),
    });
    assert.equal(persisted.status, 200);
    const persistedBody = await persisted.json();
    assert.deepEqual(persistedBody.message.project_sources, safeSources);

    const reused = await fetch(`${base}/conversations/${conversationId}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'assistant', content, context_record_id: contextId }),
    });
    assert.equal(reused.status, 409);
    assert.equal((await reused.json()).code, 'invalid_context_record');

    const mismatchContext = await makeContext('the provider-owned response');
    const mismatch = await fetch(`${base}/conversations/${conversationId}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'assistant', content: 'forged replacement', context_record_id: mismatchContext }),
    });
    assert.equal(mismatch.status, 409);
    assert.equal((await mismatch.json()).code, 'invalid_context_record');
    const unconsumed = (await pool.query(
      'SELECT consumed_message_id FROM chat_generation_contexts WHERE id=$1', [mismatchContext],
    )).rows[0];
    assert.equal(unconsumed.consumed_message_id, null);

    const reloaded = await fetch(`${base}/conversations/${conversationId}`);
    assert.equal(reloaded.status, 200);
    const reloadedBody = await reloaded.json();
    const assistant = reloadedBody.conversation.messages.find((message) => message.id === persistedBody.message.id);
    assert.deepEqual(assistant.project_sources, safeSources);
    assert.equal('context_manifest' in assistant, false);
    assert.doesNotMatch(JSON.stringify(assistant), /must never reload/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('account Library lists workspace assets only through current ReBAC membership', { skip: !pool }, async () => {
  const storagePath = path.join(tempDirectory, `${marker}-workspace.txt`);
  await fs.writeFile(storagePath, 'Workspace Library truth', 'utf8');
  const workspaceAsset = await registerManagedLibraryFile(pool, {
    userId: ownerId,
    workspaceId,
    filename: `${marker}-workspace.txt`,
    originalName: 'workspace-truth.txt',
    mimeType: 'text/plain',
    fileSize: (await fs.stat(storagePath)).size,
    storagePath,
  });
  const before = await listLibraryItems(pool, outsiderId, { query: 'workspace-truth' });
  assert.equal(before.items.some((item) => item.asset_id === workspaceAsset.id), true);
  await pool.query(
    `DELETE FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND subject_type='user' AND subject_id=$2`,
    [workspaceId, outsiderId],
  );
  const after = await listLibraryItems(pool, outsiderId, { query: 'workspace-truth' });
  assert.equal(after.items.some((item) => item.asset_id === workspaceAsset.id), false);
});

test('two dispatchers create one logical run for one occurrence', { skip: !pool }, async () => {
  const task = (await pool.query(
    `INSERT INTO chat_scheduled_tasks(
      user_id,created_by_user_id,run_as_user_id,project_id,title,prompt,model_id,cadence,cadence_label,
      status,next_run_at,schedule_kind,timezone,timezone_source,dtstart_local,rrule
     ) VALUES($1,$1,$1,$2,'Concurrency','Run once','gpt-5.6','daily','Every day','active',NOW()-INTERVAL '1 second',
       'recurring','UTC','user_confirmed',date_trunc('second',NOW() AT TIME ZONE 'UTC'),'FREQ=DAILY') RETURNING *`,
    [ownerId, personalProject.id],
  )).rows[0];
  await writeTuples(pool, { writes: [{ object: `schedule:${task.id}`, relation: 'parent', subject: `project:${personalProject.id}` }] });
  const [a, b] = await Promise.all([dispatchDueScheduledRuns(pool), dispatchDueScheduledRuns(pool)]);
  assert.equal(a.length + b.length, 1);
  const count = await pool.query('SELECT count(*)::int AS count FROM chat_scheduled_runs WHERE task_id=$1', [task.id]);
  assert.equal(count.rows[0].count, 1);
  await pool.query("UPDATE chat_scheduled_runs SET status='succeeded',completed_at=NOW() WHERE task_id=$1", [task.id]);
});

test('scheduled run history is authorized and exposes only the safe projection', { skip: !pool }, async () => {
  const task = (await pool.query(
    `INSERT INTO chat_scheduled_tasks(
      user_id,created_by_user_id,run_as_user_id,project_id,title,prompt,model_id,cadence,cadence_label,
      status,next_run_at,schedule_kind,timezone,timezone_source,dtstart_local,rrule
     ) VALUES($1,$1,$1,$2,'History','Inspect history','gpt-5.6','daily','Every day','paused',NOW()+INTERVAL '1 day',
       'recurring','UTC','user_confirmed',date_trunc('second',NOW() AT TIME ZONE 'UTC'),'FREQ=DAILY') RETURNING *`,
    [ownerId, personalProject.id],
  )).rows[0];
  await writeTuples(pool, { writes: [{ object: `schedule:${task.id}`, relation: 'parent', subject: `project:${personalProject.id}` }] });
  await pool.query(
    `INSERT INTO chat_scheduled_runs(
       task_id,occurrence_key,scheduled_for,status,attempt_count,error_code,error_message,context_manifest
     ) VALUES($1,'manual:history',NOW(),'failed',1,'provider_private_failure',
       'provider said sk-live-secret for asset 6ba7b810-cafe-4bad-a11e-123456789abc',
       '{"sources":[{"content":"PRIVATE-CONTEXT"}]}'::jsonb)`,
    [task.id],
  );

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.db = pool; req.user = { id: ownerId }; next(); });
  app.use(chatRoutes);
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/scheduled/${task.id}/runs`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.runs.length, 1);
    assert.equal(body.runs[0].error_message, 'Scheduled execution failed.');
    assert.equal('context_manifest' in body.runs[0], false);
    assert.doesNotMatch(JSON.stringify(body), /sk-live-secret|PRIVATE-CONTEXT|6ba7b810/i);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('revoked project access fails a scheduled run before context or provider disclosure', { skip: !pool }, async () => {
  const revokedProject = await createAuthorizedProject(pool, {
    principal: userPrincipal(ownerId), name: `${marker} revoked schedule project`, customInstructions: 'PRIVATE-SCHEDULE-INSTRUCTION',
  });
  await pool.query(
    `INSERT INTO account_activations(user_id,activated_at,method)
     VALUES($1,NOW(),'admin') ON CONFLICT(user_id) DO NOTHING`, [ownerId],
  );
  const task = (await pool.query(
    `INSERT INTO chat_scheduled_tasks(
      user_id,created_by_user_id,run_as_user_id,project_id,title,prompt,model_id,cadence,cadence_label,
      status,next_run_at,schedule_kind,timezone,timezone_source,dtstart_local,rrule
     ) VALUES($1,$1,$1,$2,'Revoked','Do not disclose','gpt-5.6','daily','Every day','active',NOW()+INTERVAL '1 day',
       'recurring','UTC','user_confirmed',date_trunc('second',NOW() AT TIME ZONE 'UTC'),'FREQ=DAILY') RETURNING *`,
    [ownerId, revokedProject.id],
  )).rows[0];
  const run = (await pool.query(
    `INSERT INTO chat_scheduled_runs(task_id,occurrence_key,scheduled_for,status,attempt_count,lease_owner,lease_expires_at)
     VALUES($1,'manual:revoked',NOW(),'leased',1,'authorization-test',NOW()+INTERVAL '2 minutes') RETURNING *`,
    [task.id],
  )).rows[0];
  await pool.query(
    `DELETE FROM relationship_tuples
     WHERE object_type='project' AND object_id=$1 AND relation='owner'
       AND subject_type='user' AND subject_id=$2`,
    [revokedProject.id, ownerId],
  );
  await assert.rejects(
    executeScheduledRunWithFailureRecording(pool, run),
    (error) => error.code === 'resource_not_found',
  );
  const recorded = (await pool.query(
    'SELECT status,error_code,context_manifest,conversation_id FROM chat_scheduled_runs WHERE id=$1', [run.id],
  )).rows[0];
  assert.deepEqual(recorded, {
    status: 'failed', error_code: 'resource_not_found', context_manifest: null, conversation_id: null,
  });
  const paused = (await pool.query(
    'SELECT status,paused_reason FROM chat_scheduled_tasks WHERE id=$1', [task.id],
  )).rows[0];
  assert.deepEqual(paused, { status: 'paused', paused_reason: 'resource_not_found' });
});

test('expired leases reconcile ambiguous calls and resume staged results', { skip: !pool }, async () => {
  const task = (await pool.query(
    `INSERT INTO chat_scheduled_tasks(
      user_id,created_by_user_id,run_as_user_id,project_id,title,prompt,model_id,cadence,cadence_label,
      status,next_run_at,schedule_kind,timezone,timezone_source,dtstart_local,rrule
     ) VALUES($1,$1,$1,$2,'Recovery','Recover','gpt-5.6','daily','Every day','paused',NOW()+INTERVAL '1 day',
       'recurring','UTC','user_confirmed',date_trunc('second',NOW() AT TIME ZONE 'UTC'),'FREQ=DAILY') RETURNING *`,
    [ownerId, personalProject.id],
  )).rows[0];
  const ambiguous = (await pool.query(
    `INSERT INTO chat_scheduled_runs(task_id,occurrence_key,scheduled_for,status,attempt_count,lease_owner,lease_expires_at)
     VALUES($1,'manual:ambiguous',NOW(),'running',1,'dead-worker',NOW()-INTERVAL '1 minute') RETURNING id`,
    [task.id],
  )).rows[0];
  const staged = (await pool.query(
    `INSERT INTO chat_scheduled_runs(task_id,occurrence_key,scheduled_for,status,attempt_count,lease_owner,lease_expires_at,result_staging)
     VALUES($1,'manual:staged',NOW(),'running',1,'dead-worker',NOW()-INTERVAL '1 minute','{"content":"recovered"}'::jsonb) RETURNING id`,
    [task.id],
  )).rows[0];
  let claimed;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    claimed = await claimScheduledRun(pool, 'replacement-worker', 30);
    if (!claimed || claimed.id === staged.id) break;
    await pool.query("UPDATE chat_scheduled_runs SET status='cancelled',completed_at=NOW(),lease_owner=NULL,lease_expires_at=NULL WHERE id=$1", [claimed.id]);
  }
  assert.equal(claimed?.id, staged.id);
  assert.equal(claimed.result_staging.content, 'recovered');
  const ambiguousState = await pool.query('SELECT status,error_code FROM chat_scheduled_runs WHERE id=$1', [ambiguous.id]);
  assert.deepEqual(ambiguousState.rows[0], { status: 'reconciliation_required', error_code: 'ambiguous_worker_loss' });
});

test('scheduled publish repairs a partial role and persists its redacted context manifest once', { skip: !pool }, async () => {
  const conversationId = (await pool.query(
    `INSERT INTO chat_conversations(user_id,title,model_id,project_id) VALUES($1,'Publish recovery','gpt-5.6',$2) RETURNING id`,
    [ownerId, personalProject.id],
  )).rows[0].id;
  const task = (await pool.query(
    `INSERT INTO chat_scheduled_tasks(
      user_id,created_by_user_id,run_as_user_id,project_id,conversation_id,title,prompt,model_id,cadence,cadence_label,
      status,next_run_at,schedule_kind,timezone,timezone_source,dtstart_local,rrule
     ) VALUES($1,$1,$1,$2,$3,'Publish','Question','gpt-5.6','daily','Every day','paused',NOW()+INTERVAL '1 day',
       'recurring','UTC','user_confirmed',date_trunc('second',NOW() AT TIME ZONE 'UTC'),'FREQ=DAILY') RETURNING *`,
    [ownerId, personalProject.id, conversationId],
  )).rows[0];
  const run = (await pool.query(
    `INSERT INTO chat_scheduled_runs(task_id,occurrence_key,scheduled_for,status,attempt_count,conversation_id,result_staging)
     VALUES($1,'manual:partial',NOW(),'leased',1,$2,'{"content":"Answer"}'::jsonb) RETURNING *`,
    [task.id, conversationId],
  )).rows[0];
  await pool.query(
    `INSERT INTO chat_messages(conversation_id,user_id,role,content,model_id,message_index,scheduled_run_id)
     VALUES($1,$2,'user','Question','gpt-5.6',0,$3)`,
    [conversationId, ownerId, run.id],
  );
  const contextManifest = {
    schema_version: 1,
    project_id: personalProject.id,
    instructions_revision: 1,
    sources: [{ asset_id: asset.id, chunk_id: '11111111-2222-4333-8444-555555555555', locator: { line: 2 }, display_name: 'project-truth.md' }],
  };
  await publishMessages(pool, { run, task, conversationId, assistantText: 'Answer', contextManifest });
  await publishMessages(pool, { run, task, conversationId, assistantText: 'Answer', contextManifest });
  const rows = await pool.query(
    `SELECT role,content,message_index FROM chat_messages WHERE scheduled_run_id=$1 ORDER BY message_index`,
    [run.id],
  );
  assert.deepEqual(rows.rows, [
    { role: 'user', content: 'Question', message_index: 0 },
    { role: 'assistant', content: 'Answer', message_index: 1 },
  ]);
  const manifests = await pool.query(
    `SELECT cm.project_id,cm.context_manifest->'sources' AS sources
     FROM chat_message_context_manifests cm
     JOIN chat_messages m ON m.id=cm.message_id
     WHERE m.scheduled_run_id=$1`,
    [run.id],
  );
  assert.equal(manifests.rows.length, 1);
  assert.equal(manifests.rows[0].project_id, personalProject.id);
  assert.deepEqual(manifests.rows[0].sources, contextManifest.sources);
});

test('project role hierarchy and child inheritance match the collaboration matrix', { skip: !pool }, async () => {
  const roleIds = {};
  for (const role of ['viewer', 'reviewer', 'editor', 'admin']) {
    roleIds[role] = (await pool.query(
      `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
       VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`,
      [`${marker}-${role}`, `${marker}-${role}@example.test`],
    )).rows[0].id;
  }
  const agentId = '11111111-2222-4333-8444-555555555555';
  await writeTuples(pool, { writes: [
    ...Object.entries(roleIds).map(([relation, id]) => ({
      object: `project:${personalProject.id}`, relation, subject: `user:${id}`,
    })),
    { object: `project:${personalProject.id}`, relation: 'editor', subject: `agent:${agentId}` },
  ] });

  const childConversationId = (await pool.query(
    `INSERT INTO chat_conversations(user_id,title,model_id,project_id)
     VALUES($1,'Role child','gpt-5.6',$2) RETURNING id`,
    [ownerId, personalProject.id],
  )).rows[0].id;
  await writeTuples(pool, { writes: [
    { object: `conversation:${childConversationId}`, relation: 'parent', subject: `project:${personalProject.id}` },
  ] });

  const expected = {
    viewer: { viewer: true, reviewer: false, editor: false, admin: false },
    reviewer: { viewer: true, reviewer: true, editor: false, admin: false },
    editor: { viewer: true, reviewer: true, editor: true, admin: false },
    admin: { viewer: true, reviewer: true, editor: true, admin: true },
  };
  for (const [heldRole, userId] of Object.entries(roleIds)) {
    for (const [requestedRole, allowed] of Object.entries(expected[heldRole])) {
      const projectVerdict = await check(pool, {
        object: `project:${personalProject.id}`, relation: requestedRole, subject: `user:${userId}`,
      });
      const childVerdict = await check(pool, {
        object: `conversation:${childConversationId}`, relation: requestedRole, subject: `user:${userId}`,
      });
      assert.equal(projectVerdict.allowed, allowed, `${heldRole} -> project ${requestedRole}`);
      assert.equal(childVerdict.allowed, allowed, `${heldRole} -> child ${requestedRole}`);
    }
  }
  assert.equal((await check(pool, {
    object: `project:${personalProject.id}`, relation: 'editor', subject: `agent:${agentId}`,
  })).allowed, true);
  assert.equal((await check(pool, {
    object: `project:${personalProject.id}`, relation: 'viewer', subject: `agent:${agentId}`,
  })).allowed, false, 'agents receive only the exact explicit relation');
  await assert.rejects(
    requireResourceRelation(pool, userPrincipal(outsiderId), 'project', personalProject.id, 'viewer'),
    /access denied/i,
  );
});

test('deleting a workspace-project creator preserves scoped project history', { skip: !pool }, async () => {
  const creatorId = (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at)
     VALUES($1,$2,'test-only',$1,TRUE,NOW()) RETURNING id`,
    [`${marker}-creator`, `${marker}-creator@example.test`],
  )).rows[0].id;
  await writeTuples(pool, { writes: [
    { object: `workspace:${workspaceId}`, relation: 'editor', subject: `user:${creatorId}` },
  ] });
  const project = await createAuthorizedProject(pool, {
    principal: userPrincipal(creatorId), workspaceId, name: `${marker} creator deletion`,
  });
  const conversationId = (await pool.query(
    `INSERT INTO chat_conversations(user_id,created_by_user_id,title,model_id,project_id)
     VALUES($1,$1,'Creator retained conversation','gpt-5.6',$2) RETURNING id`,
    [creatorId, project.id],
  )).rows[0].id;
  const messageId = (await pool.query(
    `INSERT INTO chat_messages(conversation_id,user_id,created_by_user_id,role,content,message_index)
     VALUES($1,$2,$2,'user','Retained message',0) RETURNING id`,
    [conversationId, creatorId],
  )).rows[0].id;
  const artifactId = (await pool.query(
    `INSERT INTO chat_artifacts(
       user_id,created_by_user_id,conversation_id,message_id,project_id,title,kind,content
     ) VALUES($1,$1,$2,$3,$4,'Retained artifact','document','Retained content') RETURNING id`,
    [creatorId, conversationId, messageId, project.id],
  )).rows[0].id;
  const skillId = (await pool.query(
    `INSERT INTO chat_skills(
       user_id,created_by_user_id,conversation_id,name,summary,body,author,visibility
     ) VALUES($1,$1,$2,'Retained skill','Summary','Body','Creator','chat') RETURNING id`,
    [creatorId, conversationId],
  )).rows[0].id;
  await writeTuples(pool, { writes: [
    { object: `conversation:${conversationId}`, relation: 'parent', subject: `project:${project.id}` },
    { object: `artifact:${artifactId}`, relation: 'parent', subject: `project:${project.id}` },
    { object: `skill:${skillId}`, relation: 'parent', subject: `conversation:${conversationId}` },
  ] });
  await pool.query('DELETE FROM users WHERE id=$1', [creatorId]);
  const retained = (await pool.query(
    'SELECT workspace_id,owner_user_id,created_by_user_id,user_id FROM chat_projects WHERE id=$1',
    [project.id],
  )).rows[0];
  assert.deepEqual(retained, {
    workspace_id: workspaceId,
    owner_user_id: null,
    created_by_user_id: null,
    user_id: null,
  });
  assert.equal((await check(pool, {
    object: `project:${project.id}`, relation: 'viewer', subject: `user:${ownerId}`,
  })).allowed, true);
  const childRows = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM chat_conversations WHERE id=$1) conversations,
       (SELECT COUNT(*)::int FROM chat_messages WHERE id=$2) messages,
       (SELECT COUNT(*)::int FROM chat_artifacts WHERE id=$3) artifacts,
       (SELECT COUNT(*)::int FROM chat_skills WHERE id=$4) skills`,
    [conversationId, messageId, artifactId, skillId],
  );
  assert.deepEqual(childRows.rows[0], { conversations: 1, messages: 1, artifacts: 1, skills: 1 });
  const attribution = await pool.query(
    `SELECT c.user_id conversation_user, c.created_by_user_id conversation_creator,
            m.user_id message_user, m.created_by_user_id message_creator,
            a.user_id artifact_user, a.created_by_user_id artifact_creator,
            s.user_id skill_user, s.created_by_user_id skill_creator
     FROM chat_conversations c
     JOIN chat_messages m ON m.id=$2
     JOIN chat_artifacts a ON a.id=$3
     JOIN chat_skills s ON s.id=$4
     WHERE c.id=$1`,
    [conversationId, messageId, artifactId, skillId],
  );
  assert.deepEqual(attribution.rows[0], {
    conversation_user: null,
    conversation_creator: null,
    message_user: null,
    message_creator: null,
    artifact_user: null,
    artifact_creator: null,
    skill_user: null,
    skill_creator: null,
  });
  for (const [type, id] of [['conversation', conversationId], ['artifact', artifactId], ['skill', skillId]]) {
    assert.equal((await check(pool, {
      object: `${type}:${id}`, relation: 'viewer', subject: `user:${ownerId}`,
    })).allowed, true, `${type} remains reachable through project inheritance`);
  }
});
