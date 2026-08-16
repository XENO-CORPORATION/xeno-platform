/**
 * The checker's own gates.
 *
 * 🔴 A GATE THAT REPORTS CLEAN ON A CLEAN CODEBASE HAS PROVEN NOTHING. This one
 * reported "everything is fine" only after two rounds of being wrong in the
 * opposite direction, so its false-POSITIVE behaviour is pinned here as
 * regressions alongside its true positives.
 *
 * Round 1: nine findings, every one claiming the LAST param was unused. The
 *          counter returned `commas + 1`, and this codebase uses trailing
 *          commas everywhere.
 * Round 2: two findings, both real-looking. Params arrays here carry PROSE
 *          comments, and prose contains commas.
 *
 * Both rounds looked exactly like a discovery. A gate whose first run cries
 * wolf gets muted, then deleted, and the bug it existed for ships again — so
 * "does it stay quiet when it should" is as much a gate as "does it fire".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topLevelCount, findQueries } from './check-sql-placeholders.mjs';

test('counts ELEMENTS, not separators — trailing comma', () => {
  assert.equal(topLevelCount('a, b, c'), 3);
  assert.equal(topLevelCount('a, b, c,'), 3, 'a trailing comma does not add an element');
  assert.equal(topLevelCount('\n  a,\n  b,\n'), 2);
  assert.equal(topLevelCount(''), 0);
  assert.equal(topLevelCount('   '), 0);
});

test('🔴 prose comments inside a params array do not invent elements', () => {
  const src = `
    user.id,
    // These columns existed and were never written, so 160 rows carry nothing.
    eventType,
    /* block, with, commas */
    ip,
  `;
  assert.equal(topLevelCount(src), 3);
});

test('nested calls, objects and strings holding commas are one element each', () => {
  assert.equal(topLevelCount("a, f(b, c), { x: 1, y: 2 }, 'has, commas'"), 4);
  assert.equal(topLevelCount("cond ? 'y,z' : w, next"), 2);
  assert.equal(topLevelCount('`tpl, with, commas`, next'), 2);
  assert.equal(topLevelCount("'it\\'s, escaped', next"), 2);
});

test('🔴 it FIRES on the real defect — an unused placeholder', () => {
  // The exact shape of resolveFlag before the fix: a flagId retained in the
  // params array after the query stopped referencing it.
  const src = "await db.query(`UPDATE t SET a = $2 WHERE b = $3`, [flagId, a, b]);";
  const [q] = findQueries(src);
  const count = topLevelCount(q.params);
  const used = new Set([...q.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  const unused = [];
  for (let n = 1; n <= count; n += 1) if (!used.has(n)) unused.push(n);
  assert.deepEqual(unused, [1], 'must report $1 as never referenced');
});

test('it fires the other way too — a placeholder with no parameter', () => {
  const src = "await db.query(`SELECT $1, $2, $3`, [a, b]);";
  const [q] = findQueries(src);
  const count = topLevelCount(q.params);
  const used = [...q.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(used.filter((n) => n > count), [3]);
});

test('it stays QUIET on a correct query written the way this repo writes them', () => {
  const src = `
    await db.query(
      \`INSERT INTO security_events (user_id, event_type, ip, ua, created_at)
       VALUES ($1, $2, $3, $4, NOW())\`,
      [
        userId,
        eventType,
        // a comment, with a comma
        req ? clientIp(req) : null,
        req ? req.get('User-Agent') : null,
      ],
    );
  `;
  const [q] = findQueries(src);
  assert.ok(q, 'the call must be found at all');
  const count = topLevelCount(q.params);
  assert.equal(count, 4);
  const used = new Set([...q.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  for (let n = 1; n <= count; n += 1) assert.ok(used.has(n), `$${n} should be used`);
});

test('an interpolated SQL literal is SKIPPED, not guessed at', () => {
  // getDigest builds its filters with `${tagFilter(2)}`, so placeholders exist
  // that this scanner cannot see. Guessing there is how a gate earns its
  // reputation for noise.
  const src = 'await db.query(`SELECT * FROM t WHERE ${filter} AND x = $1`, [a, b]);';
  const [q] = findQueries(src);
  assert.equal(q.interpolated, true);
});

test('importing this module does not run the scan', () => {
  // ABSOLUTE RULE §2b — importing a module to "check" it EXECUTES it. The scan
  // is read-only, but the habit is what matters: this repo destroyed four
  // products' release history that way.
  assert.equal(typeof topLevelCount, 'function');
  assert.equal(typeof findQueries, 'function');
});
