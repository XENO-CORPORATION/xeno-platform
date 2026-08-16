#!/usr/bin/env node
/**
 * WP12 — the in-app report INTAKE, proven end to end.
 *
 * `/api/forum/report/preflight` and `/api/forum/report` are built, mounted and
 * auth-gated. They have never been called: the client half lives in the desktop
 * apps and does not exist yet, so a repo-wide search for consumers finds
 * nothing. In this codebase that is not a neutral fact — it is the exact
 * condition under which eleven features have shipped broken.
 *
 * So this exercises the whole intake contract against the real database before
 * a single app is asked to depend on it:
 *
 *   1. preflight FINDS an existing thread            (dedup can happen at all)
 *   2. a report with no join CREATES a feedback thread, with the context turned
 *      into real TAGS rather than prose                        (§4.1)
 *   3. a report WITH a join adds a reply and creates NO second thread
 *   4. 🔴 the joined report raises DISTINCT REPORTERS to 2, and that thread then
 *      appears in Loop D's `rising` section
 *
 * Step 4 is the one that matters. Steps 1–3 prove the endpoints work; step 4
 * proves the collector feeds the aggregate — which is the entire claim of
 * Phase 3, and the only part that cannot be verified by reading either file.
 *
 * ── SAFETY ──────────────────────────────────────────────────────────────────
 *
 *   • Dry-run by DEFAULT; `--confirm` required.
 *   • 🔴 NOTHING IS EVER COMMITTED — one transaction, always rolled back. The
 *     Record is permanent, and a proof has no business publishing to it.
 */

import crypto from 'crypto';
import pg from 'pg';

const CONFIRM = process.argv.includes('--confirm');

let failures = 0;
const pass = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { console.log(`  FAIL  ${m}`); failures += 1; };

/**
 * Run a step and turn a THROW into a labelled failure.
 *
 * 🔴 Written after mutation-checking scored a mutation as "caught nothing".
 * Disabling the join path made `submitReport` fall through to a code path that
 * throws `title is required`, so the proof died mid-run — and a harness
 * counting `FAIL` lines saw zero and reported the gate broken open. It was not;
 * the harness was.
 *
 * Two rules came out of it, and both are general:
 *   • A CRASHED RUN IS NOT A PASSING RUN. Any harness reading a proof's output
 *     must read its EXIT CODE too, or a process that dies before printing
 *     anything scores perfectly.
 *   • A proof should fail in its own vocabulary. "expected a join, got: title
 *     is required" names the broken behaviour; a stack trace makes the reader
 *     work out which assertion never got to run.
 */
async function step(label, fn) {
  try {
    return await fn();
  } catch (err) {
    fail(`${label} — threw instead: ${err.message}`);
    return null;
  }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function service(name) {
  const dir = process.env.FORUM_SERVICE_DIR;
  const candidates = dir
    ? [new URL(`${dir.replace(/\/$/, '')}/${name}`, 'file:///').href]
    : [`../src/server/services/${name}`, `../services/${name}`];
  for (const p of candidates) {
    try { return await import(p); } catch (err) {
      if (err.code !== 'ERR_MODULE_NOT_FOUND') throw err;
    }
  }
  throw new Error(`cannot locate ${name} in either layout`);
}

/**
 * A second reporter, cloned from a real row.
 *
 * Built by copying an existing user and overriding only the identity columns,
 * rather than by hand-writing an INSERT. A hand-written one encodes today's
 * NOT NULL set and breaks silently the next time a column is added — and the
 * failure would look like "the report path is broken" rather than "the fixture
 * is stale".
 */
async function cloneUser(client, sourceId, label) {
  const { rows: cols } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' ORDER BY ordinal_position`,
  );
  const names = cols.map((c) => c.column_name);
  const uniq = crypto.randomBytes(4).toString('hex');

  const select = names.map((n) => {
    if (n === 'id') return 'gen_random_uuid() AS id';
    if (n === 'email') return `'proof-${uniq}@example.invalid' AS email`;
    if (['handle', 'username', 'display_name'].includes(n)) return `'${label}${uniq}' AS ${n}`;
    return `"${n}"`;
  }).join(', ');

  const { rows } = await client.query(
    `INSERT INTO users (${names.map((n) => `"${n}"`).join(', ')})
     SELECT ${select} FROM users WHERE id = $1 RETURNING id`,
    [sourceId],
  );
  return rows[0].id;
}

const client = await pool.connect();
let began = false;

try {
  const { rows: admins } = await client.query(
    "SELECT id, email FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1",
  );
  if (!admins.length) throw new Error('no admin account');
  console.log(`reporter 1: ${admins[0].email}`);

  if (!CONFIRM) {
    console.log('\nDRY RUN — would open a transaction, run the full intake contract');
    console.log('(preflight → create → join → aggregate) and ROLL BACK. Nothing is');
    console.log('committed even with --confirm. Re-run with --confirm to execute.');
    process.exit(0);
  }

  await client.query('BEGIN');
  began = true;

  const write = await service('forumWrite.js');
  const { getDigest, setPredicate } = await service('forumService.js');
  const { resolvePrincipal } = await service('agentIdentity.js');

  const actor = async (id) => {
    const p = await resolvePrincipal(client, id);
    return { id: p.id, username: p.handle, display_name: p.displayName, role: p.role, kind: p.kind, owner: p.owner };
  };

  const a1 = await actor(admins[0].id);
  const reporter2Id = await cloneUser(client, admins[0].id, 'proofuser');
  const a2 = await actor(reporter2Id);
  console.log(`reporter 2: cloned row ${reporter2Id.slice(0, 8)}… — never committed\n`);

  // ── 1. preflight sees the existing corpus ────────────────────────────────
  console.log('1. preflight — can a duplicate be found at all?');
  const candidates = await write.reportPreflight(client, {
    title: 'Pasted image looks completely wrong, blue and red are swapped',
    product: 'pixel',
  });
  if (!Array.isArray(candidates)) fail('preflight did not return an array');
  else if (!candidates.length) fail('preflight found NOTHING for a title that matches a seeded thread — every report becomes a duplicate');
  else pass(`preflight returned ${candidates.length} candidate(s): "${candidates[0].title.slice(0, 44)}…"`);

  // A short title must NOT trigger a search — the client calls this on keystroke.
  const tooShort = await write.reportPreflight(client, { title: 'crash', product: 'pixel' });
  if (tooShort.length) fail('preflight searched on a 5-character title — this runs on every keystroke');
  else pass('a too-short title returns nothing without searching');

  // ── 2. a fresh report creates a structured feedback thread ───────────────
  console.log('\n2. submit — a new report:');
  const created = await step('a new report must be accepted', () => write.submitReport(client, a1, {
    product: 'pixel',
    version: '0.6.3',
    os: 'Windows 11 26200',
    title: 'Export hangs at 98% on a 4K canvas with a smart object',
    body: 'Repro: open a 4K doc, add a smart object, File > Export. Progress reaches 98% and stops.',
  }));
  // Everything below reads the created thread, so there is nothing left to
  // prove if it did not appear. Stop with the failure already recorded.
  if (!created) throw new Error('report creation failed — see the FAIL above');
  if (!created?.shortId || created.joined) fail(`expected a created thread, got ${JSON.stringify(created)}`);
  else pass(`created thread ${created.shortId}`);

  const { rows: threadRows } = await client.query(
    `SELECT t.id, t.short_id, t.title, s.slug AS space,
            (SELECT string_agg(g.namespace || ':' || g.value, ' ' ORDER BY g.namespace)
               FROM forum_thread_tags tt JOIN forum_tags g ON g.id = tt.tag_id
              WHERE tt.thread_id = t.id) AS tags,
            (SELECT body FROM forum_posts p WHERE p.thread_id = t.id ORDER BY p.created_at LIMIT 1) AS first_post
       FROM forum_threads t JOIN forum_spaces s ON s.id = t.space_id
      WHERE t.short_id = $1`,
    [created.shortId],
  );
  const t = threadRows[0];

  if (t?.space !== 'feedback') fail(`the report landed in "${t?.space}", not the feedback space — Loop D's rising section only reads feedback`);
  else pass('it landed in the feedback space');

  const tags = (t?.tags || '').split(' ').filter(Boolean);
  for (const want of ['product:pixel', 'version:0.6.3', 'kind:bug']) {
    if (!tags.includes(want)) fail(`missing tag ${want} — context stayed as prose, so no aggregate can group by it (§4.1)`);
    else pass(`tag ${want}`);
  }

  if (!/Reported from the app/.test(t?.first_post || '')) fail('the machine-written environment block is missing');
  else if (!/- os: Windows 11 26200/.test(t.first_post)) fail('the OS did not survive into the body');
  else pass('the environment block is present and attributed to the app, not the reporter');

  // ── 3. a second reporter JOINS rather than duplicating ───────────────────
  console.log('\n3. join — a second person hits the same bug:');
  const before = await client.query('SELECT COUNT(*)::int AS n FROM forum_threads');
  const joined = await step('a second reporter must be able to JOIN', () => write.submitReport(client, a2, {
    product: 'pixel',
    joinShortId: created.shortId,
    body: 'Also on Linux, only when the canvas is above 4K.',
  }));
  const after = await client.query('SELECT COUNT(*)::int AS n FROM forum_threads');

  if (!joined?.joined) fail(`expected a join, got ${JSON.stringify(joined)}`);
  else pass('the report joined the existing thread');

  if (after.rows[0].n !== before.rows[0].n) fail(`a join created ${after.rows[0].n - before.rows[0].n} new thread(s) — the feedback space becomes a landfill`);
  else pass('no second thread was created');

  const { rows: reporters } = await client.query(
    `SELECT COUNT(DISTINCT author_id)::int AS n FROM forum_posts
      WHERE thread_id = $1 AND status = 'visible'`,
    [t.id],
  );
  if (reporters[0].n !== 2) fail(`distinct reporters = ${reporters[0].n}, expected 2 — the signal the ranker scores never moves`);
  else pass('distinct reporters = 2 — the count the ranker scores is real');

  // ── 4. 🔴 does the collector actually feed Loop D? ───────────────────────
  console.log('\n4. the join — does this reach a dev agent?');
  await setPredicate(client, admins[0].id, { tags: ['product:pixel'], max_per_hour: 4 });
  const digest = await getDigest(client, admins[0].id, { channel: 'push' });

  const rising = digest?.sections?.rising || [];
  const hit = rising.find((r) => r.shortId === created.shortId);
  if (!hit) {
    fail(`the reported thread is ABSENT from Loop D's rising section (${rising.length} row(s)) — the collector and the aggregate are not connected`);
  } else {
    pass(`it appears in \`rising\` with reporters=${hit.reporters}`);
    if (hit.reporters !== 2) fail(`rising reports ${hit.reporters} reporters, expected 2`);
    else pass('the aggregate counts DISTINCT REPORTERS, not replies');
    if (!hit.url?.startsWith('/forum/t/')) fail('no citable URL — an agent cannot hand a human a link');
    else pass('citable URL for the agent to cite');
  }
} finally {
  if (began) {
    await client.query('ROLLBACK').catch(() => {});
    console.log('\nROLLED BACK — no thread, post, user or subscription was committed.');
  }
  client.release();
  await pool.end();
}

console.log('');
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('WP12 intake: a report becomes a tagged thread, a second reporter joins it, and a dev agent sees "2 distinct people".');
