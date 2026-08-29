import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

test('database cutover defaults to dry-run and requires the observed live image', () => {
  const local = read('scripts/deploy-chat-database.mjs');
  assert.match(local, /execute: false/);
  assert.match(local, /--expected-db-image is required with --execute/);
  assert.match(local, /qualification and backup volumes are retained/);
});

test('cutover uses the pinned pgvector and rollback Postgres images', () => {
  const remote = read('scripts/remote-chat-database-cutover.sh');
  assert.match(remote, /pgvector\/pgvector:0\.8\.6-pg15-bookworm@sha256:a947c45c/);
  assert.match(remote, /postgres:15-alpine@sha256:a2c20749/);
  assert.match(remote, /live DB image drift/);
});

test('production-shaped restore precedes quiesced production cutover', () => {
  const remote = read('scripts/remote-chat-database-cutover.sh');
  assert.match(remote, /docker exec -i xenostudio-postgres pg_restore --list - < "\$output"/);
  assert.doesNotMatch(remote, /docker cp "\$output" xenostudio-postgres:/);
  assert.match(remote, /QUAL_VOLUME="xeno-chat-pgvector-qual-\$SHA-\$STAMP"/);
  assert.match(remote, /QUAL_CONTAINER="xeno-chat-pgvector-qual-\$SHORT-\$STAMP"/);
  const restore = remote.indexOf('production-shaped restore qualification passed');
  const stop = remote.indexOf('docker compose stop backend');
  const quiesced = remote.indexOf('quiesced backup captured');
  const recreate = remote.indexOf('force-recreate postgres');
  assert.ok(restore > 0);
  assert.ok(stop > restore);
  assert.ok(quiesced > stop);
  assert.ok(recreate > quiesced);
});

test('API stays stopped on migration failure and rollback restores a separate volume', () => {
  const remote = read('scripts/remote-chat-database-cutover.sh');
  assert.match(remote, /cutover failed before API restart; restoring quiesced backup/);
  assert.match(remote, /xeno-platform-postgres-rollback-\$SHA/);
  assert.match(remote, /compose DB is intentionally not reconciled/);
  assert.match(remote, /pre-cutover failure restarted the unchanged backend/);
  assert.match(remote, /umask 077/);
});
