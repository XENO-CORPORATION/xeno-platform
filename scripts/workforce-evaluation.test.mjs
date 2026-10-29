/**
 * XENO-WORKFORCE-01 LIFE-04 -- an evaluation is DERIVED from evidence for a stated window, never stored.
 *
 *   LIFE-04: "Evaluation is EVIDENCE-DERIVED, never a rating column. ... An evaluation is a projection over
 *            those records for a stated window, not a stored score. A stored score is an unfalsifiable
 *            claim, and this estate's standing rule is that a claim without its procedure is not evidence."
 *
 * The spec's own scenario group, T104-T106: "An evaluation is requested for a stated window; the same
 * window is re-requested after new evidence; a stored score is attempted: the projection is derived from
 * admissions, receipts, contributions, reviewer decisions and handoffs (LIFE-04) and is reproducible for
 * the window -- no rating column may exist." And its §17 note: "a stored evaluation score must fail
 * T104-T106." Each of the three is its own case here, and the third is asserted against the schema.
 *
 * Runs on the migrated schema (TEST_DATABASE_URL) against services/workforceEvaluation.js, with real
 * admissions, leases, revocations, handoffs and decision records, written by the services that write them
 * wherever such a service exists (admission, step authorization, revocation), and as rows where the
 * record's only writer is not yet built (handoffs, decisions).
 *
 * Mutation-checked 2026-09-27, each fails the named assertion; restored passes:
 *   - admissions after the window are counted in it     -> "a run admitted after the window is not counted in it"
 *   - a handoff is read in its CURRENT state            -> "a handoff is counted in the state it was in at the window's end"
 *   - a revocation after the window counts as a stop    -> "a stop after the window is not a stop in it"
 *   - active-at-end ignores an ancestor's stop          -> "a run fenced by a stopped parent is not active at the end"
 *   - decisions ignore the responsible account          -> "an agent's decision is answered for by its owner"
 *   - the scope filter is dropped                       -> "another workspace's runs are not this scope's evidence"
 *   - an ordinary member may read                       -> "an evaluation is read by an administrator or its subject"
 *   - the unrecorded sources are not declared           -> "what cannot be seen is said, not silently omitted"
 * Each specific property is asserted BEFORE the whole-answer comparison ("the same window reads the same after
 * new evidence"), so a defect is reported by the property it breaks rather than as an unexplained diff.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, generateKeyPairSync } from 'node:crypto';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;

test('an evaluation is a projection over evidence for a stated window, never a stored score (LIFE-04)', { skip: !url, timeout: 120000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(() => pool.end());
  assert.ok((await pool.query("SELECT to_regclass('workforce_run_admissions') AS v")).rows[0].v, 'this suite runs on the migrated schema');
  const { admitRun } = await import('../src/server/services/workforceRunAdmission.js');
  const { authorizeRunStep, revokeRun } = await import('../src/server/services/workforceRunAuthority.js');
  const { readWorkforceEvaluation, EVALUATION_NOT_RECORDED } = await import('../src/server/services/workforceEvaluation.js');

  const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const signingKey = { kid: 'evaluation-test', privatePem: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
  const marker = `eval-${randomUUID().slice(0, 8)}`;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const explicit = (caps) => ({ schemaVersion: 1, mode: 'explicit', capabilities: caps });
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$1,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const ctx = (actorUserId) => ({ actorUserId, clientId: 'xeno-agent-interface' });
  const tuple = (id, rel, u) => pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
    VALUES('workspace',$1,$2,'user',$3)`, [id, rel, u]);
  const now = async () => (await pool.query('SELECT clock_timestamp() AS t')).rows[0].t;
  const pause = () => new Promise((r) => setTimeout(r, 25));
  // A step's time is its lease's signed `iat` -- whole seconds -- so the window is stated on second
  // boundaries, as a real caller asking about a day or an hour would. The next boundary, and a wait past it:
  const boundary = async () => {
    const t = new Date(await now());
    const next = new Date(Math.floor(t.getTime() / 1000) * 1000 + 1000);
    await new Promise((r) => setTimeout(r, next.getTime() - t.getTime() + 60));
    return next.toISOString();
  };

  const owner = await user('owner'), worker = await user('worker'), member = await user('member'), stranger = await user('stranger');
  const lenderOwner = await user('lender');
  await pool.query('INSERT INTO credit_accounts(user_id,balance) VALUES($1,50000000),($2,50000000)', [owner, worker]);
  // Admission's budget term reads eligible credit_grants lots (utils/usageCreditFunding.js
  // allocateFunding), not the cached credit_accounts.balance alone -- fund a real paid lot +
  // overflow-on per payer, idempotently (deterministic grant id, replace not accumulate).
  for (const u of [owner, worker]) {
    await pool.query(`INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)
      ON CONFLICT (user_id) DO UPDATE SET enabled=true`, [u]);
    await pool.query(`INSERT INTO credit_grants(id,user_id,amount_micro,remaining_micro,kind,source_ref)
      VALUES(md5('test-fund:'||$1::text)::uuid,$1::uuid,50000000,50000000,'paid','test-fund')
      ON CONFLICT (id) DO UPDATE SET amount_micro=EXCLUDED.amount_micro, remaining_micro=EXCLUDED.remaining_micro`, [u]);
  }
  const ws = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-ws`])).rows[0].id;
  const elsewhere = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [owner, `${marker}-else`])).rows[0].id;
  const lender = (await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id', [lenderOwner, `${marker}-lender`])).rows[0].id;
  for (const [w, rel, u] of [[ws, 'owner', owner], [ws, 'editor', worker], [ws, 'viewer', member], [elsewhere, 'owner', owner], [elsewhere, 'editor', worker]]) await tuple(w, rel, u);
  // An agent principal of the worker's: its decisions are answered for by the worker (LIFE-07).
  const agentUser = await user('agent');
  await pool.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role) VALUES($1,$2,'personal')", [agentUser, worker]);

  const resource = async (name) => {
    const id = randomUUID();
    await pool.query(`INSERT INTO workforce_resources(id,kind,owner_workspace_id,name) VALUES($1,'agent',$2,$3)`, [id, lender, name]);
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)`,
      [id, { instructions: name, skills: [], requestedCapabilities: ['files.read'], secretReferences: [] }, hash(`${id}:1`)]);
    return id;
  };
  const assign = async (resourceId, workspaceId) => {
    const rev = (await pool.query('SELECT revision FROM workforce_resources WHERE id=$1', [resourceId])).rows[0].revision;
    const a = (await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_workspace_id,
      resource_revision,policy) VALUES($1,'agent',$2,$3,$4,$5) RETURNING id`, [resourceId, workspaceId, lender, rev, explicit(['files.read'])])).rows[0].id;
    await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted', revision=revision+1, source_approved_by_user_id=$2,
      source_approved_at=clock_timestamp(), target_accepted_by_user_id=$2, accepted_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`, [a, owner]);
    return a;
  };
  const scout = await resource('Scout');
  const scoutIn = await assign(scout, ws), scoutElsewhere = await assign(scout, elsewhere);
  const admit = async (assignment, { parent, ceiling = 100_000, actor = worker } = {}) => (await admitRun(pool, ctx(actor), {
    operationId: randomUUID(), agent: { resourceId: scout, version: 1, contentHash: hash(`${scout}:1`) },
    target: { kind: 'workspace', assignmentId: assignment }, capabilities: ['files.read'], budget: { ceilingMicro: String(ceiling) },
    ...(parent ? { parent: { admissionId: parent } } : {}) })).admission.admissionId;
  const step = (admissionId, operation = 'provider_dispatch', capability) =>
    authorizeRunStep(pool, ctx(worker), { admissionId, operation, ...(capability ? { capability } : {}) }, { signingKey });
  const decide = (decider, responsible, kind, subjectType, subjectId, evidence = []) => pool.query(`INSERT INTO workforce_operations(actor_user_id,client_id,
      operation_id,request_hash,kind,subject_type,subject_id,deciding_principal_id,responsible_account_id,authority,evidence,workspace_id)
    VALUES($1,'c',$2,$3,$4,$5,$6,$1,$7,'test',$8,$9) RETURNING operation_id`,
  [decider, randomUUID(), hash(randomUUID()), kind, subjectType, subjectId, responsible, JSON.stringify(evidence), ws]);
  const offer = (source, target) => pool.query(`INSERT INTO workforce_handoffs(source_principal_id,target_principal_id,work_ref_type,work_ref_id,
      source_workspace_id,target_workspace_id) VALUES($1,$2,'task',$3,$4,$4) RETURNING id`, [source, target, randomUUID(), ws]);
  const read = (actor, subject, window, owner_ = { type: 'workspace', id: ws }) =>
    readWorkforceEvaluation(pool, ctx(actor), { owner: owner_, subject, window, expectedActorAccountId: actor });
  const asAgent = { kind: 'agent', resourceId: scout };
  const asWorker = { kind: 'principal', userId: worker };

  // ── the evidence inside the window ───────────────────────────────────────────────────────────────
  const since = await boundary();
  const root = await admit(scoutIn, { ceiling: 1_000_000 });
  const child = await admit(scoutIn, { parent: root });
  const stopped = await admit(scoutIn);
  await step(root); await step(root, 'privileged_call', 'files.read'); await step(child);
  await revokeRun(pool, ctx(worker), stopped);
  await admit(scoutElsewhere); // another workspace: not this scope's evidence
  const sent = (await offer(worker, member)).rows[0].id;
  const received = (await offer(owner, worker)).rows[0].id;
  await pool.query(`UPDATE workforce_handoffs SET state='accepted', accepted_at=clock_timestamp(), payer_account_id=$2, revision=revision+1 WHERE id=$1`, [received, worker]);
  const madeByWorker = (await decide(worker, worker, 'member.admit', 'membership', randomUUID(), [{ kind: 'review', ref: 'x' }])).rows[0].operation_id;
  const madeByAgent = (await decide(agentUser, worker, 'member.promote', 'membership', randomUUID())).rows[0].operation_id;
  const aboutScout = (await decide(owner, owner, 'division.assign', 'resource', scout)).rows[0].operation_id;
  // XENO Tasks in the scope, in the shapes xenoTasks.js writes (status from/to, 'delegated' to an agent's user id).
  const project = async (w) => (await pool.query(`INSERT INTO chat_projects(user_id,owner_user_id,workspace_id,created_by_user_id,updated_by_user_id,name)
    VALUES(NULL,NULL,$1,$2,$2,'Eval') RETURNING id`, [w, owner])).rows[0].id;
  const proj = await project(ws), projElsewhere = await project(elsewhere);
  const task = async (p, reporter, assignee = null, delegate = null) => (await pool.query(`INSERT INTO tasks(title,project_id,reporter_id,assignee_id,delegate_id)
    VALUES('t',$1,$2,$3,$4) RETURNING id`, [p, reporter, assignee, delegate])).rows[0].id;
  const ev = (id, actor, kind, from = null, to = null, at = null) => pool.query(`INSERT INTO task_events(task_id,actor_id,actor_kind,kind,from_value,to_value,created_at)
    VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::timestamptz, clock_timestamp()))`, [id, actor, actor === agentUser ? 'agent' : 'human', kind, from, to, at]);
  const delegated = async (reporter) => { const id = await task(proj, reporter, worker, agentUser);
    await ev(id, reporter, 'created'); await ev(id, reporter, 'delegated', null, agentUser); await ev(id, agentUser, 'status', 'todo', 'in_progress'); return id; };
  // A: an agent does it, the worker reviews and accepts it (inside a minute)
  const taskA = await delegated(worker);
  await ev(taskA, agentUser, 'status', 'in_progress', 'in_review'); await ev(taskA, worker, 'comment'); await ev(taskA, worker, 'status', 'in_review', 'done');
  // B: an agent closes it itself -- never reviewed
  const taskB = await delegated(worker);
  await ev(taskB, agentUser, 'status', 'in_progress', 'done');
  // E: the task entered review before the window; the worker asks for changes inside it (well over a minute later)
  const taskE = await delegated(worker);
  await ev(taskE, agentUser, 'status', 'in_progress', 'in_review', new Date(Date.parse(since) - 120_000).toISOString());
  await ev(taskE, worker, 'status', 'in_review', 'in_progress');
  // C: the owner gives the worker a task; the worker does it and submits it for review
  const taskC = await task(proj, owner, worker);
  await ev(taskC, owner, 'created'); await ev(taskC, owner, 'assigned', null, worker);
  await ev(taskC, worker, 'status', 'todo', 'in_progress'); await ev(taskC, worker, 'status', 'in_progress', 'in_review');
  // Another workspace's task is not this scope's evidence
  const away = await task(projElsewhere, worker, worker); await ev(away, worker, 'created'); await ev(away, worker, 'status', 'todo', 'done');
  // Spend, as the gateway records it (usage names the PAYER, never a workspace): the worker pays 1000 directly and
  // 2500 through its agent; the owner's 9000 is someone else's; the agent's media log holds 700 committed and 300
  // released (not spent).
  const usage = (payer, cost, agent = null) => pool.query(`INSERT INTO api_usage_logs(user_id,request_id,endpoint,method,provider,model,status,actual_cost_micro,dimensions)
    VALUES($1,$2,'/v1/chat/completions','POST','openai','m','completed',$3,$4)`, [payer, randomUUID(), cost, agent ? JSON.stringify({ agent_user_id: agent }) : null]);
  await usage(worker, 1000); await usage(worker, 2500, agentUser); await usage(owner, 9000, agentUser);
  await pool.query(`INSERT INTO agent_spend_log(agent_user_id,payer_user_id,kind,amount_micro) VALUES($1,$2,'image',700),($1,$2,'video',300)`, [agentUser, worker]);
  await pool.query(`UPDATE agent_spend_log SET state='released' WHERE agent_user_id=$1 AND amount_micro=300`, [agentUser]);
  // An agent DEFINITION linked to the agent's account: its report is read through that account.
  const linked = (await pool.query(`INSERT INTO workforce_resources(kind,owner_workspace_id,name) VALUES('agent',$1,'Linked') RETURNING id`, [ws])).rows[0].id;
  await pool.query(`UPDATE agent_identities SET workforce_resource_id=$1, workforce_resource_kind='agent' WHERE user_id=$2`, [linked, agentUser]);
  // The reporting line owner → worker → member, a division holding the member, a team naming the worker.
  const division = (await pool.query(`INSERT INTO workforce_divisions(workspace_id,key,name,created_by_user_id) VALUES($1,'mix','Mix',$2) RETURNING id`, [ws, owner])).rows[0].id;
  const team = (await pool.query(`INSERT INTO workforce_resources(kind,owner_workspace_id,name) VALUES('team',$1,'Crew') RETURNING id`, [ws])).rows[0].id;
  await pool.query(`INSERT INTO workforce_employee_profiles(workspace_id,principal_id,manager_principal_id,team_resource_id,updated_by_user_id) VALUES($1,$2,$3,$4,$3)`, [ws, worker, owner, team]);
  await pool.query(`INSERT INTO workforce_employee_profiles(workspace_id,principal_id,manager_principal_id,division_id,updated_by_user_id) VALUES($1,$2,$3,$4,$3)`, [ws, member, worker, division]);
  const until = await boundary();
  const window = { since, until };

  let first;
  await t.test('LIFE-04: an evaluation for a stated window is derived from the records inside it', async () => {
    first = await read(owner, asAgent, window);
    assert.deepEqual(first.window, window, 'the window is the one asked for');
    assert.deepEqual(first.runs, { admitted: 3, children: 1, activeAtEnd: 2, stopped: { stopped_by_actor: 1, stopped_by_target: 0, authority_lost: 0 } },
      'another workspace\'s runs are not this scope\'s evidence');
    assert.deepEqual(first.steps, { privilegedCalls: 1, providerDispatches: 2 });
    assert.deepEqual([...first.records.admissions].sort(), [root, child, stopped].sort(), 'every run counted is named, so the count can be checked');
    assert.deepEqual(first.decisions, { byRelation: { about: { 'division.assign': 1 } }, withEvidence: 0 });
    assert.deepEqual(first.records.decisions, [aboutScout]);
    assert.equal(first.handoffs, null, 'an agent resource has no handoffs; a principal does');
    assert.equal(Object.hasOwn(first, 'score'), false);

    const person = await read(owner, asWorker, window);
    assert.deepEqual(person.handoffs, { sent: { offered: 1, accepted: 0, declined: 0, expired: 0 }, received: { offered: 0, accepted: 1, declined: 0, expired: 0 } });
    assert.deepEqual([...person.records.handoffs].sort(), [sent, received].sort());
    assert.deepEqual(person.decisions.byRelation, { made: { 'member.admit': 1 }, answeredFor: { 'member.promote': 1 } },
      'an agent\'s decision is answered for by its owner');
    assert.equal(person.decisions.withEvidence, 1, 'a decision that carried evidence is counted as such');
    assert.deepEqual([...person.records.decisions].sort(), [madeByWorker, madeByAgent].sort());
    assert.equal(person.runs.admitted, 3, 'the worker admitted the three runs in this scope');
    assert.equal(first.tasks, null, 'an agent definition has no task identity');
  });

  await t.test('LIFE-04: what a person directed, did and reviewed in XENO Tasks, apart from what agents did', async () => {
    const person = await read(owner, asWorker, window);
    assert.deepEqual(person.tasks.mine, { created: 3, delegatedToAgents: 3, assignedToOthers: 0, started: 1, submittedForReview: 1, closedWithoutReview: 0, comments: 1 },
      'another workspace\'s tasks are not this scope\'s evidence');
    assert.deepEqual({ ...person.tasks.reviews, medianSeconds: typeof person.tasks.reviews.medianSeconds },
      { accepted: 1, changesRequested: 1, decidedWithinAMinute: 1, medianSeconds: 'number' },
      'a review is timed from the task\'s entry into review, even when that was before the window');
    assert.ok(person.tasks.reviews.medianSeconds >= 55, 'the median sits between a seconds-long and a two-minute review');
    assert.deepEqual(person.tasks.outcomes, { done: 2, viaAgent: 2, acceptedByHuman: 1, closedByAgent: 1, neverReviewed: 1 },
      'work an agent closed itself is told apart from work a person accepted');
    assert.deepEqual([...person.records.tasks].sort(), [taskA, taskB].sort(), 'every outcome counted is named');
    const agent = await read(owner, { kind: 'principal', userId: agentUser }, window);
    assert.deepEqual(agent.tasks.mine, { created: 0, delegatedToAgents: 0, assignedToOthers: 0, started: 3, submittedForReview: 1, closedWithoutReview: 1, comments: 0 },
      'the agent\'s own actions are its own');
    assert.equal(agent.tasks.outcomes.done, 2, 'and it answers for the tasks delegated to it');
  });

  await t.test('LIFE-04: credits as charged — paid directly, through agents, as an agent, and agent media apart', async () => {
    const personal = { type: 'user', id: worker };
    const person = await read(worker, asWorker, window, personal);
    assert.equal(person.spend.usage, 'counted');
    assert.deepEqual(person.spend.paid, { micro: '3500', requests: 2, viaAgentsMicro: '2500' }, 'what the person paid; someone else\'s spend is not theirs');
    assert.deepEqual(person.spend.byAgent, [{ agentUserId: agentUser, micro: '2500', requests: 1 }], 'what went through which agent');
    assert.deepEqual(person.spend.asAgent, { micro: '0', requests: 0 });
    const agent = await read(worker, { kind: 'principal', userId: agentUser }, window, personal);
    assert.deepEqual(agent.spend.asAgent, { micro: '2500', requests: 1 }, 'what the agent spent acting for this owner only');
    assert.equal(agent.spend.agentMediaMicro, '700', 'committed media counts; released media does not');
    // In a workspace the usage ledger cannot be placed, so it does not count there -- and the answer says so;
    // what IS tied to the workspace is the charge on the runs admitted in it.
    const inWs = await read(owner, asWorker, window);
    assert.equal(inWs.spend.usage, 'not-tied-to-workspace');
    assert.deepEqual(inWs.spend.paid, { micro: '0', requests: 0, viaAgentsMicro: '0' }, 'usage never counts in a workspace');
    const held = (await pool.query(`SELECT coalesce(sum(h.amount_micro) FILTER (WHERE h.state='held'),0)::text AS r, coalesce(sum(h.settled_micro) FILTER (WHERE h.state='settled'),0)::text AS s
      FROM workforce_run_admissions a JOIN workforce_run_holds wh ON wh.admission_id=a.id JOIN credit_holds h ON h.id=wh.hold_row_id
      WHERE a.target_workspace_id=$1 AND a.actor_user_id=$2 AND a.parent_admission_id IS NULL AND a.admitted_at >= $3 AND a.admitted_at < $4`, [ws, worker, since, until])).rows[0];
    assert.deepEqual(inWs.spend.runs, { settledMicro: held.s, reservedMicro: held.r }, 'run charges are the ledger holds of the runs admitted here');
    assert.ok(BigInt(held.r) + BigInt(held.s) > 0n, 'and there are some');
  });

  await t.test('LIFE-04: an agent definition is reported through its agent account', async () => {
    const def = await read(owner, { kind: 'agent', resourceId: linked }, window);
    assert.equal(def.actingPrincipal, agentUser, 'it says which account acts for it');
    assert.equal(def.tasks.mine.started, 3, 'its tasks are the account\'s');
    assert.equal(def.spend.usage, 'not-tied-to-workspace');
    const bare = await read(owner, asAgent, window);
    assert.equal(bare.actingPrincipal, null);
    assert.deepEqual([bare.tasks, bare.spend], [null, null], 'a definition with no account has neither, and says so');
    assert.deepEqual(bare.notRecorded, ['contributions', 'tasks', 'spend']);
  });

  await t.test('LIFE-04: a manager reads the people below them; a roster is one row per member', async () => {
    const { readWorkforceRoster } = await import('../src/server/services/workforceEvaluation.js');
    assert.equal((await read(worker, { kind: 'principal', userId: member }, window)).subject.userId, member, 'a manager reads their report');
    const refusal = (p) => p.then(() => 'allowed', (e) => e.code);
    assert.equal(await refusal(read(member, asWorker, window)), 'not_found', 'a report does not read their manager');
    const roster = (actor, group) => readWorkforceRoster(pool, ctx(actor), { owner: { type: 'workspace', id: ws }, group, window, expectedActorAccountId: actor });
    const mine = await roster(worker, { kind: 'reports', id: worker });
    assert.deepEqual(mine.members.map((m) => m.principalId), [member], 'a person reads their own reports');
    const all = await roster(owner, { kind: 'reports', id: owner });
    assert.deepEqual(all.members.map((m) => m.principalId).sort(), [worker, member].sort(), 'reports at every level');
    const w = all.members.find((m) => m.principalId === worker);
    assert.deepEqual([w.tasksCreated, w.delegatedToAgents, w.reviewDecisions, w.done, w.neverReviewed, w.closedByAgent, w.spentMicro],
      [3, 3, 2, 2, 1, 1, (await read(owner, asWorker, window)).spend.runs.settledMicro], 'a row is that member\'s own evaluation');
    assert.equal(all.total.spentMicro, all.members.reduce((a, m) => a + BigInt(m.spentMicro), 0n).toString(), 'the total is the sum of the rows');
    assert.deepEqual((await roster(owner, { kind: 'division', id: division })).members.map((m) => m.principalId), [member], 'a division holds its people');
    assert.deepEqual((await roster(owner, { kind: 'team', id: team })).members.map((m) => m.principalId), [worker], 'a team holds its people');
    assert.equal(await refusal(roster(member, { kind: 'reports', id: worker })), 'not_found', 'nobody reads someone else\'s reports unless an admin');
    assert.equal(await refusal(roster(worker, { kind: 'division', id: division })), 'not_found', 'a division roster is an admin\'s');
  });

  await t.test('LIFE-04: the same window reads the same after new evidence arrives', async () => {
    await pause();
    // New evidence AFTER the window, of every kind the projection reads.
    const late = await admit(scoutIn);
    await step(late); await step(root);
    await revokeRun(pool, ctx(worker), root);            // fences root AND its child -- but after the window
    await pool.query(`UPDATE workforce_handoffs SET state='accepted', accepted_at=clock_timestamp(), payer_account_id=$2, revision=revision+1 WHERE id=$1`, [sent, member]);
    await decide(owner, owner, 'division.transfer', 'resource', scout);
    await decide(worker, worker, 'member.remove', 'membership', randomUUID());

    const again = await read(owner, asAgent, window);
    // The specific properties first, so a defect in one is reported by name; then the whole answer.
    assert.equal(again.runs.admitted, 3, 'a run admitted after the window is not counted in it');
    assert.equal(again.runs.stopped.stopped_by_actor, 1, 'a stop after the window is not a stop in it');
    assert.equal(again.runs.activeAtEnd, 2, 'a run stopped after the window was active at its end');
    const strip = ({ derivedAt, settledBefore, closed, ...rest }) => rest;
    assert.deepEqual(strip(again), strip(first), 'the same window reads the same after new evidence');
    const person = await read(owner, asWorker, window);
    assert.deepEqual(person.handoffs.sent, { offered: 1, accepted: 0, declined: 0, expired: 0 },
      'a handoff is counted in the state it was in at the window\'s end');

    // A window that includes the new evidence DOES see it -- the projection is not frozen, it is bounded.
    const wider = await read(owner, asAgent, { since, until: await boundary() });
    assert.equal(wider.runs.admitted, 4);
    assert.equal(wider.runs.stopped.stopped_by_actor, 2);
    assert.equal(wider.runs.activeAtEnd, 1, 'a run fenced by a stopped parent is not active at the end');
    assert.equal(wider.steps.providerDispatches, 4);
  });

  await t.test('LIFE-04: a recent window says it may still move; an old one says it is closed', async () => {
    const r = await read(owner, asAgent, window);
    assert.equal(r.closed, false, 'a window ending minutes ago is not yet closed');
    assert.ok(Date.parse(r.settledBefore) < Date.parse(r.derivedAt));
    const old = await read(owner, asAgent, { since: '2026-01-01T00:00:00Z', until: '2026-02-01T00:00:00Z' });
    assert.equal(old.closed, true, 'a window well before the read is closed');
    assert.deepEqual([old.runs.admitted, old.steps.providerDispatches], [0, 0], 'and an empty window is zero, derived rather than defaulted');
  });

  await t.test('LIFE-04: what cannot be seen is said, not silently omitted or estimated', async () => {
    const r = await read(owner, asAgent, window);
    assert.deepEqual(r.notRecorded, ['contributions', 'tasks', 'spend'], 'what cannot be seen is said, not silently omitted');
    assert.deepEqual([...EVALUATION_NOT_RECORDED, 'tasks', 'spend'], r.notRecorded);
    assert.deepEqual((await read(owner, asWorker, window)).notRecorded, ['contributions'], 'a person\'s tasks and spend are read');
    // Each source named there is genuinely absent: when one is built, this fails and the projection must read it.
    for (const table of ['workforce_contributions']) {
      assert.equal((await pool.query('SELECT to_regclass($1) AS t', [table])).rows[0].t, null,
        `${table} now exists -- the evaluation must read it and stop declaring it unrecorded`);
    }
  });

  await t.test('LIFE-04: no rating column exists, and a read writes nothing', async () => {
    const stored = (await pool.query(`SELECT c.table_name || '.' || c.column_name AS ref FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
      WHERE c.table_schema = current_schema() AND t.table_type='BASE TABLE'
        AND (c.table_name LIKE 'workforce%' OR c.table_name IN ('agent_identities','workspaces','relationship_tuples'))
        AND c.column_name ~ '(rating|score|evaluation|performance|grade|rank|merit|kpi)'`)).rows;
    assert.deepEqual(stored, [], 'no rating column may exist');
    const tables = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema()
      AND table_name ~ '^workforce.*(evaluation|rating|score|performance)'`)).rows;
    assert.deepEqual(tables, [], 'no evaluation is stored anywhere');
    const counts = async () => (await pool.query(`SELECT (SELECT count(*) FROM workforce_run_admissions) a, (SELECT count(*) FROM workforce_run_leases) l,
      (SELECT count(*) FROM workforce_run_revocations) r, (SELECT count(*) FROM workforce_operations) o, (SELECT count(*) FROM workforce_handoffs) h`)).rows[0];
    const before = await counts();
    await read(owner, asAgent, window); await read(worker, asWorker, window);
    assert.deepEqual(await counts(), before, 'an evaluation read admits, leases, revokes, decides and hands off nothing');
  });

  await t.test('LIFE-04: an evaluation is read by an administrator of the scope, or by its own subject', async () => {
    assert.equal((await read(worker, asWorker, window)).runs.admitted, 3, 'a principal may read its own evaluation');
    const refusal = (p) => p.then(() => 'allowed', (e) => JSON.stringify({ code: e.code, status: e.status, details: e.details }));
    const missing = await refusal(read(stranger, asAgent, window, { type: 'workspace', id: randomUUID() }));
    assert.notEqual(missing, 'allowed');
    for (const [actor, subject, message] of [
      [member, asAgent, 'an evaluation is read by an administrator or its subject'],
      [member, asWorker, 'an evaluation is read by an administrator or its subject'],
      [worker, asAgent, 'an editor does not read an agent\'s evaluation'],
      [stranger, asWorker, 'a stranger does not read anyone\'s'],
    ]) assert.equal(await refusal(read(actor, subject, window)), missing, message);
    // Asking for someone else's personal scope reads nothing either.
    assert.equal(await refusal(read(worker, asAgent, window, { type: 'user', id: owner })), missing);
    await assert.rejects(readWorkforceEvaluation(pool, ctx(owner), { owner: { type: 'workspace', id: ws }, subject: asAgent, window, expectedActorAccountId: worker }),
      (e) => e.details?.reason === 'actor_precondition_mismatch');
    for (const bad of [{ since: until, until: since }, { since, until: '2099-01-01T00:00:00Z' }, { since: 'yesterday', until }, { since, until, score: 5 }]) {
      await assert.rejects(read(owner, asAgent, bad), (e) => e.code === 'bad_input', 'a window is stated, bounded and nothing else');
    }
  });
});
