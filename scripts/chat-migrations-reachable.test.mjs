/**
 * Chat full-scale DDL must be discoverable by the migration runner.
 *
 * The six tables (artifacts, projects, files, scheduled, skills, memories)
 * existed as a file under `src/server/migrations/` and as service methods
 * that INSERTed into them. The runner never saw the file: it only reads
 * `src/server/database/migrations` and only keeps `^(\d{14})[-_](.+)\.sql$`.
 * So the schema was a file, the writes were code, and the tables were
 * created nowhere. Same shape as the forum write-back / 76 nodes: built,
 * tested, unreachable.
 *
 * This gate reuses the runner's own directory + regex. A rename that the
 * runner cannot see fails here. A `CREATE TABLE` for any of the six that
 * lives in a file the runner would skip also fails.
 *
 * Source-only. No live database.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = readFileSync(
  join(ROOT, 'src', 'server', 'services', 'migrationRunner.js'),
  'utf8',
);
const MIGRATIONS_DIR = join(ROOT, 'src', 'server', 'database', 'migrations');
const ORPHAN = join(ROOT, 'src', 'server', 'migrations', '015_chat_full_scale.sql');

const CHAT_TABLES = [
  'chat_artifacts',
  'chat_projects',
  'chat_project_files',
  'chat_scheduled_tasks',
  'chat_skills',
  'chat_user_memories',
];

/** Same filter the runner uses. If this drifts from source, the next test fails. */
const RUNNER_FILE_RE = /^(\d{14})[-_](.+)\.sql$/;

function discoverLikeRunner() {
  if (!existsSync(MIGRATIONS_DIR)) return [];
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => {
      const match = f.match(RUNNER_FILE_RE);
      if (!match) return null;
      return {
        version: match[1],
        name: match[2],
        filename: f,
        filepath: join(MIGRATIONS_DIR, f),
      };
    })
    .filter(Boolean);
}

function walkSql(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walkSql(p, acc);
    else if (name.name.endsWith('.sql')) acc.push(p);
  }
  return acc;
}

test('the runner still discovers only timestamped files in database/migrations', () => {
  assert.match(
    RUNNER,
    /path\.join\(__dirname,\s*['"]\.\.\/database\/migrations['"]\)/,
    'MIGRATIONS_DIR moved — this gate would otherwise certify a directory the runner no longer reads.',
  );
  assert.match(
    RUNNER,
    /\^\(\\d\{14\}\)\[-_\]\(\.\+\)\\\.sql\$/,
    'the filename regex changed — a 14-digit prefix is what makes a file exist to the runner.',
  );
});

test('the orphan 015_ copy is gone — that folder is not MIGRATIONS_DIR', () => {
  assert.equal(
    existsSync(ORPHAN),
    false,
    'src/server/migrations/015_chat_full_scale.sql is invisible to the runner. ' +
      'DDL that lives there is a schema that is never applied.',
  );
});

test('a discovered migration creates every chat full-scale table', () => {
  const discovered = discoverLikeRunner();
  assert.ok(discovered.length > 0, 'the runner directory is empty.');

  const bodies = discovered.map((m) => ({
    filename: m.filename,
    sql: readFileSync(m.filepath, 'utf8'),
  }));

  const missing = [];
  for (const table of CHAT_TABLES) {
    const hit = bodies.find((b) =>
      new RegExp(
        `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`,
        'i',
      ).test(b.sql),
    );
    if (!hit) missing.push(table);
  }
  assert.deepEqual(
    missing,
    [],
    `no discovered migration creates: ${missing.join(', ')}. ` +
      'A file the runner cannot see does not count.',
  );
});

test('chat full-scale DDL is idempotent and not self-transacted', () => {
  const discovered = discoverLikeRunner();
  const chatMig = discovered.find((m) => {
    const sql = readFileSync(m.filepath, 'utf8');
    return CHAT_TABLES.every((table) =>
      new RegExp(
        `CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+${table}\\b`,
        'i',
      ).test(sql),
    );
  });
  assert.ok(
    chatMig,
    'expected one discovered file to create all six chat tables.',
  );

  const sql = readFileSync(chatMig.filepath, 'utf8');
  assert.match(sql, /^--\s*UP\b/m, 'the runner strips -- UP; the file must have it.');
  assert.doesNotMatch(
    sql,
    /^\s*BEGIN\s*;/im,
    'the runner already wraps a transaction — BEGIN here double-wraps.',
  );
  assert.doesNotMatch(
    sql,
    /^\s*COMMIT\s*;/im,
    'the runner already commits — COMMIT here ends its transaction early.',
  );
});

test('no chat full-scale CREATE TABLE lives in a file the runner would skip', () => {
  const discoverable = new Set(discoverLikeRunner().map((m) => m.filepath));
  const hidden = [];

  for (const file of walkSql(join(ROOT, 'src', 'server'))) {
    const sql = readFileSync(file, 'utf8');
    const tables = CHAT_TABLES.filter((table) =>
      new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${table}\\b`, 'i').test(
        sql,
      ),
    );
    if (tables.length === 0) continue;
    if (!discoverable.has(file)) {
      hidden.push(`${file} (${tables.join(', ')})`);
    }
  }

  assert.deepEqual(
    hidden,
    [],
    `chat tables are created in files the runner skips:\n  ${hidden.join('\n  ')}`,
  );
});
