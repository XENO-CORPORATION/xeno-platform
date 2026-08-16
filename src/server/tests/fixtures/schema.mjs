/**
 * One source of truth for test table definitions: the baseline migration.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * Three DB suites each hand-rolled their own `CREATE TABLE user_sessions`, and
 * all three drifted as production grew columns — breaking CI for two days:
 *
 *   auth-token-confusion  lost `last_active_at` when session liveness shipped
 *   account-recovery      missing `device_type`, `browser`, `os`
 *   erasure               had no forum tables at all
 *
 * A fixture that hand-rolls a schema production gets from migrations is correct
 * only until someone adds a column, and NOTHING links the two. This is the link:
 * the fixture now reads the same file the database was built from, so a new
 * column arrives in the tests the moment it arrives in the schema.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 *
 * It does not run the whole 2,358-line baseline. A suite that creates 42 tables
 * to test two is slower, and — worse — stops telling you what it actually
 * depends on. Naming the tables keeps that visible; getting their SHAPE from the
 * migration is what removes the drift.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(__dirname, '..', '..', 'database', 'migrations');

/*
 * ALL migrations, in filename order — not just the baseline.
 *
 * The first version read only `00000000000000-baseline.sql` and could not find
 * `forum_posts`, because the forum arrived in later migrations. A helper that
 * silently knows about half the schema is worse than one that knows none of it:
 * the suites it serves would look linked and drift anyway.
 */
let sql = null;
const source = () => (sql ??= readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(join(MIGRATIONS, f), 'utf8'))
  .join('\n'));

/**
 * The `CREATE TABLE` statement for one table, exactly as the migration declares
 * it — schema qualifier stripped so it lands in the test database's default
 * schema.
 *
 * Throws if the table is absent. That is the point: a typo, or a table that has
 * been renamed out from under a suite, must fail loudly here rather than
 * silently produce a fixture with no table in it.
 */
export function tableDDL(name) {
  const src = source();
  const re = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?(?:public\\.)?${name}\\s*\\(`, 'i');
  const m = src.match(re);
  if (!m) throw new Error(`tableDDL: ${name} is not declared in the baseline migration`);

  // Walk to the matching close paren. A depth counter rather than a regex,
  // because column definitions contain parentheses — varchar(255), DEFAULT
  // now(), numeric(12,2) — and a lazy `\)` stops at the first of them.
  let depth = 0;
  let i = m.index + m[0].length - 1;
  for (; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = src.slice(m.index, i + 1);
  const create = `${body.replace(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?/i, 'CREATE TABLE IF NOT EXISTS ')};`;

  /*
   * Columns added AFTER the table was created.
   *
   * `forum_threads.fixed_in_version`, `forum_subscriptions.last_push_at` and
   * friends all arrived by ALTER, so a CREATE-only extractor would reproduce
   * exactly the drift this module exists to remove — the table would look right
   * and be a month out of date.
   *
   * Emitted as separate IF NOT EXISTS statements: order-independent, and
   * harmless when the CREATE already carried the column.
   */
  // ⚠️ TWO STAGES, because one ALTER can add SEVERAL columns:
  //
  //     ALTER TABLE forum_threads
  //       ADD COLUMN IF NOT EXISTS fixed_in_version varchar(64),
  //       ADD COLUMN IF NOT EXISTS fixed_at         timestamptz;
  //
  // A single regex anchored on `ALTER TABLE <name>` captures only the FIRST
  // clause — which is how the first version of this found `fixed_in_version`
  // and silently dropped `fixed_at`. Isolate the statement, then read every
  // clause inside it.
  const stmtRe = new RegExp(
    String.raw`ALTER TABLE\s+(?:ONLY\s+)?(?:public\.)?${name}\b[^;]*;`, 'gi',
  );
  const colRe = /ADD COLUMN\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z0-9_]*)\s+([^;,]+)/gi;

  const alters = [];
  for (const [stmt] of src.matchAll(stmtRe)) {
    for (const [, col, type] of stmt.matchAll(colRe)) {
      alters.push(`ALTER TABLE ${name} ADD COLUMN IF NOT EXISTS ${col} ${type.trim()};`);
    }
  }

  return [create, ...alters].join('\n');
}

/** Several tables, in the order given. */
export function tablesDDL(...names) {
  return names.map(tableDDL).join('\n');
}

/**
 * Assert a table's declaration carries the columns a code path writes.
 *
 * Belt and braces: `tableDDL` already guarantees the fixture matches the
 * migration, so this only fires if the MIGRATION is missing something the code
 * writes — which is a real defect, and one the application would hit in
 * production rather than in a test.
 */
export function assertColumns(name, columns) {
  const ddl = tableDDL(name);
  const missing = columns.filter((c) => !new RegExp(`(^|[\\s,(])${c}\\s`, 'm').test(ddl));
  if (missing.length) {
    throw new Error(
      `${name} is missing ${missing.join(', ')} in the baseline migration — `
      + 'the application writes these columns, so production is missing them too',
    );
  }
}
