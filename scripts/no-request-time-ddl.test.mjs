/**
 * The running app connects as xeno_app, which cannot change the schema (src/server/database/runtime-role.js). A statement
 * that creates or alters anything outside the migrate job's code would fail in production, on the request that reached
 * it, and nowhere earlier: tests run as a superuser. So the source is checked here.
 *
 * Three helpers keep a create-if-missing fallback for bare test databases. Each must ask tablesPresent first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', 'src', 'server');
const SKIP_DIRS = new Set(['node_modules', 'tests', 'vendor', 'data', 'uploads', 'database', 'scripts']);
const MIGRATE_JOB_CODE = new Set(['services/migrationRunner.js', 'services/migrationService.js', 'migrate-legacy-library-images.js']);
const GUARDED_FALLBACKS = new Set(['services/billingSchema.js', 'middleware/inHouseDailyLimit.js', 'utils/billingAccountBinding.js']);
const DDL = /\b(CREATE\s+(?:UNIQUE\s+)?(?:TEMP\s+|TEMPORARY\s+)?(?:TABLE|INDEX|TYPE|EXTENSION|FUNCTION|OR\s+REPLACE|TRIGGER|SEQUENCE|VIEW|MATERIALIZED)|ALTER\s+(?:TABLE|TYPE|FUNCTION|ROLE)|DROP\s+(?:TABLE|INDEX|TRIGGER|FUNCTION|TYPE|VIEW)|TRUNCATE\s+[a-z_]|REFRESH\s+MATERIALIZED)\b/;

function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) sources(path.join(dir, entry.name), out); }
    else if (/\.(js|mjs)$/.test(entry.name)) out.push(path.join(dir, entry.name));
  }
  return out;
}
const rel = (file) => path.relative(root, file).split(path.sep).join('/');

test('no code the running app executes changes the schema', () => {
  const offenders = [];
  for (const file of sources(root)) {
    const name = rel(file);
    if (MIGRATE_JOB_CODE.has(name) || GUARDED_FALLBACKS.has(name)) continue;
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return; // a comment naming a statement is not one
      if (DDL.test(line)) offenders.push(`${name}:${i + 1}: ${line.trim().slice(0, 90)}`);
    });
  }
  assert.deepEqual(offenders, [], `DDL at request time; move it to database/migrations/:\n${offenders.join('\n')}`);
});

test('each create-if-missing fallback asks whether the tables exist first', () => {
  for (const name of GUARDED_FALLBACKS) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    const ask = source.indexOf('tablesPresent(');
    const create = source.search(/CREATE TABLE IF NOT EXISTS/);
    assert.ok(ask > 0 && create > 0 && ask < create, `${name} must call tablesPresent before its CREATE`);
  }
});

test('the runtime role cannot be given the journal, the chain, or the re-seal', () => {
  const source = fs.readFileSync(path.join(root, 'database', 'runtime-role.js'), 'utf8');
  assert.match(source, /REVOKE UPDATE, DELETE ON credit_transactions/);
  assert.match(source, /REVOKE INSERT, UPDATE, DELETE ON ledger_chain_heads, ledger_chain_epochs/);
  assert.match(source, /REVOKE EXECUTE ON FUNCTION ledger_chain_reseal/);
  assert.match(source, /NOSUPERUSER/);
});

test('the migrate job is the only compose service that holds the superuser credential', () => {
  const compose = fs.readFileSync(path.resolve(root, '..', '..', 'docker-compose.yml'), 'utf8');
  const live = compose.split(/\r?\n/).filter((line) => !/^\s*#/.test(line)).join('\n');
  const services = live.split(/\n(?=  [a-z][a-z0-9-]*:\n)/);
  const holders = services
    .filter((block) => !block.startsWith('  postgres:'))
    .filter((block) => /POSTGRES_PASSWORD|DB_USER=postgres/.test(block))
    .map((block) => block.trim().split(':')[0]);
  assert.deepEqual(holders, ['migrate'], `superuser credential in: ${holders.join(', ')}`);
  for (const service of ['backend', 'chat-workers']) {
    const block = services.find((b) => b.startsWith(`  ${service}:`));
    assert.match(block, /DB_USER=xeno_app/, `${service} connects as xeno_app`);
  }
});
