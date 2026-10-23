#!/usr/bin/env node
/**
 * Mutation check for Dev › Automate = XENO Workflow (services/xenoWorkflow.js): remove each protection and prove
 * src/server/tests/xeno-workflow.test.mjs FAILS, then restore the file byte for byte.
 *
 *   node scripts/automate-mutation-check.mjs <one fresh database URL per mutation — 11>
 *
 * One fresh database per mutation (the test runs every migration). Exits 1 if any mutation survives.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SVC = join(ROOT, 'src/server/services/xenoWorkflow.js');
const MIG = join(ROOT, 'src/server/database/migrations/20261029100000-workspace-workflows.sql');
const TEST = join(ROOT, 'src/server/tests/xeno-workflow.test.mjs');
const MUTATIONS = [
  ['the run assertion no longer binds the body', SVC, `run_id: String(runId), body_sha256: crypto.createHash('sha256').update(body).digest('hex')`, `run_id: String(runId), body_sha256: 'x'`],
  ['an agent may turn a workflow on (service check removed)', SVC, `  if (sc.kind !== 'human') throw new AutomateError('Only a person turns a workflow on', 'human_required', 403);\n`, ''],
  ['the database human-enabler trigger is gone', MIG, `CREATE TRIGGER workspace_workflows_human_enabler BEFORE INSERT OR UPDATE ON workspace_workflows\n  FOR EACH ROW EXECUTE FUNCTION workspace_workflows_human_enabler();`, ''],
  ['the workflow agent is granted its whole scope, not its capabilities', SVC, `if (capabilities.length) await creds.grant(db, w.agent_user_id, w.workspace_id, capabilities);`, `if (capabilities.length) await creds.grant(db, w.agent_user_id, w.workspace_id, creds.capabilitiesForScopes(['tasks:write']));`],
  ['the run key is not revoked when the run ends', SVC, `  if (run.key_id) await creds.revokeRunKey(db, run.key_id);\n`, ''],
  ['a re-delivery mints a new key (no reuse)', SVC, `if (run.key_enc) { try { credential = decrypt(run.key_enc); } catch { credential = null; } }`, `void decrypt;`],
  ['the enabler is not re-checked before a run', SVC, `|| !(await isAdmin(db, w.workspace_id, w.enabled_by))) {`, `|| false) {`],
  ['the workflow’s own agent re-triggers it (loop guard removed)', SVC, `    if (actorId && w.agent_user_id && String(w.agent_user_id) === String(actorId)) continue;\n`, ''],
  ['a ticket event carries its title', SVC, `kind: ticket.kind, priority: ticket.priority || null, createdAt`, `kind: ticket.kind, title: ticket.title, priority: ticket.priority || null, createdAt`],
  ['an irreversible action is accepted', SVC, `    if (cap.class === 'irreversible') throw new AutomateError(`, `    if (false) throw new AutomateError(`],
  ['a secret typed into a node is accepted', SVC, `if (typeof v === 'string' && v.trim() && !v.startsWith('$cred:')) throw`, `if (false) throw`],
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
    const r = spawnSync(process.execPath, [TEST], { env: { ...process.env, DATABASE_URL: urls[i] }, encoding: 'utf8' });
    const failed = r.status !== 0;
    const why = (/(FAIL: [^\n]+)/.exec(r.stderr + r.stdout) || [])[1] || (failed ? (r.stderr || '').split('\n').find((l) => /Error/.test(l)) || '' : '');
    console.log(`${failed ? 'killed  ' : 'SURVIVED'}  ${name}${why ? '  — ' + why : ''}`);
    if (!failed) survived += 1;
  } finally { writeFileSync(file, orig); }
});
console.log(survived ? `${survived} mutation(s) survived` : 'every mutation was caught');
process.exit(survived ? 1 : 0);
