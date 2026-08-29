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
