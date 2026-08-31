import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = join(
  ROOT,
  'src',
  'server',
  'database',
  'migrations',
  '20260829120000-chat-projects-core.sql',
);
const sql = readFileSync(migrationPath, 'utf8');
const onceRunAuthorizationSql = readFileSync(join(
  ROOT,
  'src',
  'server',
  'database',
  'migrations',
  '20260829134500-chat-once-run-gateway-authorization.sql',
), 'utf8');
const uniqueIndexRepairSql = readFileSync(join(
  ROOT,
  'src',
  'server',
  'database',
  'migrations',
  '20260829134400-repair-live-unique-index-drift.sql',
), 'utf8');
const manualRetrySql = readFileSync(join(
  ROOT,
  'src',
  'server',
  'database',
  'migrations',
  '20260829150000-chat-manual-run-retry.sql',
), 'utf8');

test('core migration is additive, discoverable, and vector-free', () => {
  assert.match(migrationPath, /database[\\/]migrations[\\/]\d{14}[-_].+\.sql$/);
  assert.match(sql, /^--\s*UP\b/m);
  assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT)\s*;/im);
  assert.doesNotMatch(sql, /\bVECTOR\s*(?:\(|,|\n)/i);
  assert.doesNotMatch(sql, /CREATE\s+EXTENSION\s+vector/i);
});

test('project and Library ownership cannot silently detach across deletion', () => {
  assert.match(sql, /chat_projects[\s\S]*owner_user_id[\s\S]*ON DELETE RESTRICT/i);
  assert.match(sql, /chat_projects_scope_check[\s\S]*owner_user_id IS NULL[\s\S]*workspace_id IS NULL/i);
  assert.match(sql, /chat_conversations_project_id_fkey[\s\S]*ON DELETE RESTRICT/i);
  assert.match(sql, /user_files_scope_check[\s\S]*owner_user_id IS NULL[\s\S]*workspace_id IS NULL/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS chat_project_assets/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS library_asset_link_grants/i);
});

test('ingestion and scheduler invariants are database-enforced', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS library_asset_ingestions/i);
  assert.match(sql, /NULLS NOT DISTINCT/i);
  assert.match(sql, /state IN \('queued', 'quarantined', 'scanning'/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS chat_scheduled_runs/i);
  assert.match(sql, /UNIQUE\(task_id, occurrence_key\)/i);
  assert.match(sql, /uq_chat_messages_scheduled_run_role/i);
  assert.match(sql, /uq_chat_messages_conversation_index/i);
  assert.match(sql, /reconciliation_required/i);
  assert.match(sql, /CREATE OR REPLACE VIEW chat_gateway_dispatch_authorizations/i);
  assert.match(sql, /security_barrier\s*=\s*true/i);
  assert.match(sql, /r\.status = 'running'[\s\S]*t\.status = 'active'[\s\S]*t\.run_as_user_id IS NOT NULL/i);
  assert.match(sql, /run_key UUID PRIMARY KEY REFERENCES chat_scheduled_runs\(id\) ON DELETE CASCADE/i);
  assert.match(sql, /user_id UUID NOT NULL,\s*\n\s*request_hash/i);
  assert.doesNotMatch(sql, /chat_gateway_run_requests[\s\S]{0,300}user_id UUID NOT NULL REFERENCES users/i);
  assert.match(sql, /REVOKE ALL ON chat_gateway_dispatch_authorizations FROM PUBLIC/i);
});

test('a dispatched one-time occurrence stays gateway-authorized without weakening manual pause', () => {
  assert.match(onceRunAuthorizationSql, /^--\s*UP\b/m);
  assert.match(onceRunAuthorizationSql, /security_barrier\s*=\s*true/i);
  assert.match(
    onceRunAuthorizationSql,
    /r\.status\s*=\s*'running'[\s\S]*t\.status\s*=\s*'active'[\s\S]*t\.status\s*=\s*'paused'[\s\S]*t\.paused_reason\s*=\s*'completed_once'/i,
  );
  assert.doesNotMatch(onceRunAuthorizationSql, /paused_by_user|cancelled_by_user|project_archived/i);
  assert.match(onceRunAuthorizationSql, /REVOKE ALL ON chat_gateway_dispatch_authorizations FROM PUBLIC/i);
});

test('live unique-index drift repair archives every removed physical row before reindexing', () => {
  assert.match(uniqueIndexRepairSql, /CREATE TABLE IF NOT EXISTS chat_data_repair_archive/i);
  assert.match(uniqueIndexRepairSql, /ROW_NUMBER\(\)[\s\S]*PARTITION BY object_type, object_id, relation, subject_type, subject_id/i);
  assert.match(uniqueIndexRepairSql, /ROW_NUMBER\(\)[\s\S]*PARTITION BY source_system, platform_user_id/i);
  assert.match(uniqueIndexRepairSql, /INSERT INTO chat_data_repair_archive[\s\S]*RETURNING source_row_id[\s\S]*DELETE FROM relationship_tuples/i);
  assert.match(uniqueIndexRepairSql, /INSERT INTO chat_data_repair_archive[\s\S]*RETURNING source_row_id[\s\S]*DELETE FROM external_identity_links/i);
  assert.match(uniqueIndexRepairSql, /REINDEX INDEX relationship_tuples_object_type_object_id_relation_subject__key/i);
  assert.match(uniqueIndexRepairSql, /REINDEX INDEX uq_eil_source_platform/i);
});

test('manual retries use a one-shot database authorization without resetting attempt history', () => {
  assert.match(manualRetrySql, /^--\s*UP\b/m);
  assert.match(manualRetrySql, /manual_retry_authorized BOOLEAN NOT NULL DEFAULT FALSE/i);
  const workerSource = readFileSync(join(ROOT, 'src', 'server', 'workers', 'chatScheduledWorker.js'), 'utf8');
  const routeSource = readFileSync(join(ROOT, 'src', 'server', 'routes', 'chatRoutes.js'), 'utf8');
  assert.match(workerSource, /attempt_count < t\.max_attempts OR r\.manual_retry_authorized=TRUE/i);
  assert.match(workerSource, /attempt_count = attempt_count \+ 1,[\s\S]*manual_retry_authorized = FALSE/i);
  assert.match(routeSource, /manual_retry_authorized=TRUE/i);
  assert.doesNotMatch(routeSource, /attempt_count\s*=\s*0/i);
});

test('every backfilled resource receives its concrete ReBAC relationship', () => {
  for (const resource of ['project', 'conversation', 'library_asset', 'schedule', 'artifact']) {
    assert.match(
      sql,
      new RegExp(`SELECT '${resource}'`),
      `${resource} relationship backfill is missing`,
    );
  }
  assert.match(sql, /'library_asset',[\s\S]*'parent',[\s\S]*'project'/i);
});

test('share and customization persistence is fail-closed', () => {
  assert.match(sql, /token_digest = encode\(sha256/i);
  assert.match(sql, /chat_shared_conversations_visibility_check/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS chat_connector_connections/i);
  assert.match(sql, /sealed_credentials LIKE 'v1\.%'/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS chat_plugin_installations/i);
});

test('interactive context records are request and response bound before single-use persistence', () => {
  assert.match(sql, /CREATE TABLE IF NOT EXISTS chat_generation_contexts/i);
  assert.match(sql, /request_hash TEXT NOT NULL/i);
  assert.match(sql, /response_hash TEXT CHECK/i);
  assert.match(sql, /consumed_message_id UUID/i);
  assert.match(sql, /expires_at TIMESTAMPTZ NOT NULL/i);
});
