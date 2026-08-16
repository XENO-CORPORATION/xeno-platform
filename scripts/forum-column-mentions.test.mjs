/**
 * Every forum column must be MENTIONED somewhere in the server.
 *
 * ── THE DEFECT THIS EXISTS FOR, WHICH HAS HAPPENED FOUR TIMES ───────────────
 *
 *   forum_flags.*            write-only — reports went in, nothing could read one
 *   forum_subscriptions.*    read-only — the ranker scored a signal nothing wrote
 *   ...predicate             modelled, zero rows, no behaviour
 *   forum_threads.locked_by  modelled and never written: a locked thread could
 *   forum_threads.locked_at  not say who locked it or when (fixed 2026-08-16)
 *
 * A column nobody names is a schema decision the application never made. It is
 * not always a bug — but it is always unexamined, and four times out of four it
 * was hiding one.
 *
 * ── WHY THIS CHECK AND NOT THE AMBITIOUS ONE ────────────────────────────────
 *
 * 🔴 The obvious version — "classify every column as read or written, and flag
 * the one-sided ones" — WAS BUILT AND THROWN AWAY. It cannot work here: reads go
 * through `SELECT t.*` and JS serialization, so no SQL scan can decide the read
 * side. Its first run produced 35 findings, several falsifiable from memory.
 *
 * What is left after narrowing is decidable and boring: does this column's NAME
 * appear anywhere in the server source — SQL, serializer, anywhere? That found
 * three columns; one was a real defect and two were explained in a line.
 *
 *   Narrow the question until it is decidable. A precise check that answers
 *   less is worth more than an ambitious one that cries wolf, because the
 *   ambitious one gets muted and then deleted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', 'src', 'server');
const MIGRATIONS = join(SERVER, 'database', 'migrations');

/** Columns the DATABASE maintains, which the application has no reason to name. */
const DB_MAINTAINED = new Set(['id', 'created_at', 'updated_at', 'search_vector']);

/** Columns deliberately unmentioned, each with the reason on the record. */
const ALLOWED = {
  'forum_impressions.first_shown':
    'DEFAULT now() — set by the database on insert; the application only ever updates last_shown.',
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Columns declared by the migrations.
 *
 * Deliberately simple: the body of `CREATE TABLE forum_x (...)` and any
 * `ADD COLUMN [IF NOT EXISTS] name`. Anything it cannot parse is simply not
 * checked — under-reporting is the safe direction for a gate, over-reporting is
 * what gets one deleted.
 */
function declaredColumns() {
  const cols = new Map();
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8').replace(/--.*$/gm, '');

    for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(forum_\w+)\s*\(([\s\S]*?)\n\s*\);/gi)) {
      const table = m[1].toLowerCase();
      for (const line of m[2].split('\n')) {
        const c = line.trim().match(/^([a-z_][a-z0-9_]*)\s+[A-Z]/i);
        if (!c) continue;
        if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|INDEX)$/i.test(c[1])) continue;
        cols.set(`${table}.${c[1].toLowerCase()}`, f);
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE (forum_\w+)[\s\S]*?ADD COLUMN (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)/gi)) {
      cols.set(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`, f);
    }
  }
  return cols;
}

const SOURCE = walk(SERVER).map((f) => readFileSync(f, 'utf8')).join('\n');

test('the migrations parse into a plausible schema', () => {
  // If the parser silently matched nothing, every assertion below would pass.
  const cols = declaredColumns();
  assert.ok(cols.size > 60, `only ${cols.size} forum columns parsed — the parser, not the schema`);
  for (const known of ['forum_threads.short_id', 'forum_posts.body', 'forum_flags.reason']) {
    assert.ok(cols.has(known), `expected to find ${known}`);
  }
});

test('🔴 every forum column is mentioned somewhere in the server', () => {
  const cols = declaredColumns();
  const unmentioned = [];

  for (const [key, migration] of cols) {
    const [, column] = key.split('.');
    if (DB_MAINTAINED.has(column)) continue;
    if (key in ALLOWED) continue;
    if (!new RegExp(`\\b${column}\\b`).test(SOURCE)) unmentioned.push(`${key}  (${migration})`);
  }

  assert.deepEqual(unmentioned, [],
    'These columns exist in the schema and are named NOWHERE in the server — not in a query, '
    + 'not in a serializer. Either wire them up, or add them to ALLOWED with the reason. '
    + '"Modelled ahead of behaviour" has hidden four defects in this feature alone.');
});

test('every ALLOWED entry still exists, and still carries a reason', () => {
  // An allow-list that outlives its entries is how exceptions become permanent.
  const cols = declaredColumns();
  for (const [key, reason] of Object.entries(ALLOWED)) {
    assert.ok(cols.has(key), `${key} is allow-listed but no longer declared — remove the entry`);
    assert.ok(reason && reason.length > 20, `${key} needs a real reason, not a placeholder`);
  }
});
