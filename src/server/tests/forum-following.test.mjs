/**
 * Community's Following view on real Postgres: /api/forum/me names the threads this person follows, and only those.
 *
 *   - a thread you follow is listed; one you stopped following isn't; someone else's follow isn't yours
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/forum-following.test.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import * as write from '../services/forumWrite.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `ff${process.pid}`;
let passed = 0; const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log(`  ok  ${m}`); };
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$1,true,true,'x') RETURNING id, username, display_name, role`, [`${tag}${s}`, `${tag}${s}@example.test`])).rows[0];

async function main() {
  await runAllMigrations(pool);
  const space = (await pool.query(`INSERT INTO forum_spaces (slug, name, kind) VALUES ($1, $1, 'discussion') RETURNING slug`, [`${tag}sp`])).rows[0];
  const me = await user('me'), other = await user('other');
  const thread = async (n) => {
    const { rows } = await pool.query(`INSERT INTO forum_threads (short_id, space_id, slug, title, author_id) SELECT $1, id, $1, $2, $3 FROM forum_spaces WHERE slug = $4 RETURNING short_id`, [`${tag}${n}`.slice(0, 12), `Thread ${n}`, other.id, space.slug]);
    return rows[0].short_id;
  };
  const a = await thread('a'), b = await thread('b'), c = await thread('c');
  ok((await write.followedThreadShortIds(pool, me.id)).length === 0, 'no follows, none listed');
  await write.setThreadSubscription(pool, me, a, true);
  await write.setThreadSubscription(pool, me, b, true);
  await write.setThreadSubscription(pool, other, c, true);
  const mine = await write.followedThreadShortIds(pool, me.id);
  ok(mine.includes(a) && mine.includes(b), 'the threads I follow are listed');
  ok(!mine.includes(c), 'someone else’s follow isn’t mine');
  await write.setThreadSubscription(pool, me, b, false);
  const after = await write.followedThreadShortIds(pool, me.id);
  ok(after.includes(a) && !after.includes(b), 'a thread I stopped following goes');
  console.log(`\nforum-following: ${passed} checks passed`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end().catch(() => {}); process.exit(1); });
