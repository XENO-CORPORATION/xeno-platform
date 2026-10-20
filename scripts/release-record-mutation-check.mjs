#!/usr/bin/env node
/**
 * Mutation check for the release record's leak and approval gates: remove each protection and prove
 * src/server/tests/release-record.test.mjs FAILS, then restore the file byte for byte.
 *
 *   node scripts/release-record-mutation-check.mjs postgres://…/db_a postgres://…/db_b postgres://…/db_c postgres://…/db_d
 *
 * One fresh database per mutation (the test runs every migration). Exits 1 if any mutation survives.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVC = join(ROOT, 'src/server/services/releaseRecord.js');
const MIG = join(ROOT, 'src/server/database/migrations/20261023100000-release-record.sql');
const MUTATIONS = [
  ['a customer sees notes for features that are not live', SVC, `WHERE n.state = 'approved' AND f.status = 'live' AND (`, `WHERE n.state = 'approved' AND (`],
  ['staff reads are open to everyone', SVC, `const needRead = (u) => { if (!canRead(u)) throw notFound(); };`, `const needRead = () => {};`],
  ['an agent may approve (service check removed)', SVC, `  if (!isStaff(u)) throw new ReleaseError('Only a person on XENO staff may do this', 'human_staff_only', 403);\n`, ''],
  ['the database approval trigger is gone', MIG, 'CREATE TRIGGER release_note_approval_guard BEFORE INSERT OR UPDATE ON release_notes FOR EACH ROW EXECUTE FUNCTION release_note_approval_guard();', ''],
  ['the customer read passes rows through', SVC, `return r.rows.map((x) => ({ id: x.id, title: x.title, body: x.body, date: iso(x.approved_at) }));`, `return r.rows.map((x) => ({ ...x, date: iso(x.approved_at) }));`],
];
const urls = process.argv.slice(2);
if (urls.length < MUTATIONS.length) { console.error(`need ${MUTATIONS.length} database URLs`); process.exit(2); }
let survived = 0;
MUTATIONS.forEach(([name, file, from, to], i) => {
  const orig = readFileSync(file, 'utf8');
  const text = orig.replace(/\r\n/g, '\n');
  if (!text.includes(from)) { console.error(`mutation "${name}": anchor not found`); survived += 1; return; }
  try {
    writeFileSync(file, text.replace(from, to));
    const r = spawnSync(process.execPath, [join(ROOT, 'src/server/tests/release-record.test.mjs')], { env: { ...process.env, DATABASE_URL: urls[i] }, encoding: 'utf8' });
    const failed = r.status !== 0;
    const why = (/(FAIL: [^\n]+)/.exec(r.stderr + r.stdout) || [])[1] || '';
    console.log(`${failed ? 'killed  ' : 'SURVIVED'}  ${name}${why ? '  — ' + why : ''}`);
    if (!failed) survived += 1;
  } finally { writeFileSync(file, orig); }
});
console.log(survived ? `${survived} mutation(s) survived` : 'every mutation was caught');
process.exit(survived ? 1 : 0);
