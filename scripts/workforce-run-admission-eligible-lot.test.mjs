/**
 * XENO-WORKFORCE-01 RUN-02 budget term -- the eligible-lot check.
 *
 * The non-pool payer check in admitRun() (services/workforceRunAdmission.js) reused to read
 * credit_accounts.balance minus a second, independently-summed credit_holds total -- ignoring
 * lot kind (paid vs allowance), the overflow preference (usage_credit_preferences.enabled), and
 * quarantine. It now calls the SAME allocator the canonical hold/spend paths use
 * (utils/usageCreditFunding.js allocateFunding), as a precondition read only: it writes nothing,
 * and admission still reserves no funds for the personal path -- see the module header on why.
 *
 * This suite proves exactly what that change must and must not do:
 *   - overflow OFF, only a PAID lot funded          -> refused (QUOTA_EXCEEDED)
 *   - overflow OFF, an ALLOWANCE lot funded          -> admitted
 *   - overflow ON, a PAID lot funded                 -> admitted (INSUFFICIENT_CREDITS only past it)
 *   - a lot-backed allocation (credit_hold_funding)   -> reduces what a second admission may approve
 *   - a legacy hold (no credit_hold_funding row)      -> reduces it the same way
 *   - a quarantined origin                            -> is skipped as if it were not there
 *   - a refusal writes NOTHING (no admission row, no new credit_holds row)
 *   - a SUCCESSFUL personal-target admission ALSO writes no credit_holds row (RUN-02's budget
 *     term is an approval, not a reservation, on this path -- dispatch-time metering is separate
 *     and unbuilt; the production Interface stays gated closed until it lands).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;

test('admission\'s budget term is the canonical eligible-lot check, not a raw balance sum', { skip: !url, timeout: 120000 }, async (t) => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(() => pool.end());
  assert.ok((await pool.query("SELECT to_regclass('workforce_run_admissions') AS t")).rows[0].t, 'this suite runs on the migrated schema');
  const { admitRun } = await import('../src/server/services/workforceRunAdmission.js');

  const marker = `elig-${randomUUID().slice(0, 8)}`;
  const hash = (s) => createHash('sha256').update(s).digest('hex');
  const user = async (s) => (await pool.query(`INSERT INTO users(username,email,password_hash,display_name,email_verified)
    VALUES($1,$2,'test-only',$1,TRUE) RETURNING id`, [`${marker}-${s}`, `${marker}-${s}@example.test`])).rows[0].id;
  const agentResource = async (owner, s) => {
    const id = randomUUID(), content = { instructions: s, skills: [], requestedCapabilities: ['files.read'], secretReferences: [] };
    await pool.query(`INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,$3)`, [id, owner, `${marker}-${s}`]);
    await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash) VALUES($1,1,$2,$3)`,
      [id, content, hash(`${id}:1`)]);
    return { id, version: 1, contentHash: hash(`${id}:1`) };
  };
  const ctx = (actorUserId) => ({ actorUserId, clientId: 'test-eligible-lot' });
  const admitPersonal = (owner, agent, ceilingMicro) => admitRun(pool, ctx(owner), {
    operationId: randomUUID(), agent: { resourceId: agent.id, version: agent.version, contentHash: agent.contentHash },
    target: { kind: 'personal', ownerUserId: owner }, capabilities: ['files.read'], budget: { ceilingMicro },
  });
  // balance defaults to 0 -- a drifted/never-synced cache, the exact case the conservation bound
  // below (admitRun's own raw balance-minus-held check, restored alongside the allocator) exists
  // to catch. Every case that means to be FUNDED passes the real total explicitly.
  const account = async (owner, balance = 0n) => { await pool.query('INSERT INTO credit_accounts(user_id,balance) VALUES($1,$2)', [owner, balance]); };
  const overflow = async (owner, enabled) => pool.query(`INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,$2)
    ON CONFLICT (user_id) DO UPDATE SET enabled=$2`, [owner, enabled]);
  const grant = async (owner, micro, kind = 'paid') => (await pool.query(
    `INSERT INTO credit_grants(user_id,amount_micro,remaining_micro,kind) VALUES($1,$2,$2,$3) RETURNING id`,
    [owner, micro, kind])).rows[0].id;
  const legacyHold = (owner, micro) => pool.query(`INSERT INTO credit_holds(user_id,hold_id,surface,operation,amount_micro,settled_micro,state,expires_at)
    VALUES($1,$2,'test','test',$3,0,'held',now()+interval '1 hour')`, [owner, randomUUID(), micro]);
  const lotBackedHold = async (owner, grantId, micro) => {
    const h = (await pool.query(`INSERT INTO credit_holds(user_id,hold_id,surface,operation,amount_micro,settled_micro,state,expires_at)
      VALUES($1,$2,'test','test',$3,0,'held',now()+interval '1 hour') RETURNING id`, [owner, randomUUID(), micro])).rows[0].id;
    await pool.query('INSERT INTO credit_hold_funding(hold_row_id,grant_id,reserved_micro,draw_order) VALUES($1,$2,$3,0)', [h, grantId, micro]);
  };
  const quarantine = (grantId) => pool.query(`INSERT INTO workforce_funding_origin_quarantine(event_id,payment_intent,grant_id,reason,liability_micro)
    VALUES($1,$2,$3,'refund',0)`, [randomUUID(), `pi_${randomUUID()}`, grantId]);
  const admissionCount = async (owner) => Number((await pool.query('SELECT count(*) AS c FROM workforce_run_admissions WHERE target_owner_user_id=$1', [owner])).rows[0].c);
  const holdCount = async (owner) => Number((await pool.query('SELECT count(*) AS c FROM credit_holds WHERE user_id=$1', [owner])).rows[0].c);
  const refuses = (p) => assert.rejects(p, (e) => e.code === 'needs_approval' && e.details?.reason === 'budget_exceeds_available', 'ineligible or unbacked funds cannot authorize admission');

  await t.test('overflow OFF, a paid-only lot refuses', async () => {
    const owner = await user('paid-off'), agent = await agentResource(owner, 'a');
    await account(owner, 2_000_000n); await overflow(owner, false); await grant(owner, 2_000_000n, 'paid');
    const before = await admissionCount(owner);
    await refuses(admitPersonal(owner, agent, '1000000'));
    assert.equal(await admissionCount(owner), before, 'a refusal writes no admission');
    assert.equal(await holdCount(owner), 0, 'a refusal creates no hold');
  });

  await t.test('overflow OFF, an allowance lot is eligible', async () => {
    const owner = await user('allow-off'), agent = await agentResource(owner, 'a');
    await account(owner, 2_000_000n); await overflow(owner, false); await grant(owner, 2_000_000n, 'allowance');
    const admission = (await admitPersonal(owner, agent, '1000000')).admission;
    assert.ok(admission.admissionId, 'an allowance lot funds admission even with overflow off');
    assert.equal(await holdCount(owner), 0, 'a successful personal-target admission reserves no funds (approval, not a hold)');
  });

  await t.test('overflow ON, a paid lot is eligible', async () => {
    const owner = await user('paid-on'), agent = await agentResource(owner, 'a');
    await account(owner, 2_000_000n); await overflow(owner, true); await grant(owner, 2_000_000n, 'paid');
    const admission = (await admitPersonal(owner, agent, '1000000')).admission;
    assert.ok(admission.admissionId, 'overflow on lets a paid lot fund the ceiling');
  });

  await t.test('a lot-backed allocation reduces what remains eligible', async () => {
    const owner = await user('lot-alloc'), agent = await agentResource(owner, 'a');
    await account(owner, 1_500_000n); await overflow(owner, true);
    const g = await grant(owner, 1_500_000n, 'paid');
    await lotBackedHold(owner, g, 1_000_000n); // only 500,000 of the 1,500,000 lot remains free
    await refuses(admitPersonal(owner, agent, '1000000'));
    const admission = (await admitPersonal(owner, agent, '500000')).admission;
    assert.ok(admission.admissionId, 'the remainder after the allocation is still admitted');
  });

  await t.test('a legacy hold (no credit_hold_funding row) reduces it the same way', async () => {
    const owner = await user('legacy'), agent = await agentResource(owner, 'a');
    await account(owner, 1_500_000n); await overflow(owner, true); await grant(owner, 1_500_000n, 'paid');
    await legacyHold(owner, 1_000_000n);
    await refuses(admitPersonal(owner, agent, '1000000'));
    const admission = (await admitPersonal(owner, agent, '500000')).admission;
    assert.ok(admission.admissionId, 'the remainder after the legacy hold is still admitted');
  });

  await t.test('a quarantined origin is skipped as if it were not there', async () => {
    const owner = await user('quarantine'), agent = await agentResource(owner, 'a');
    // The cached balance reflects BOTH grants -- quarantine is a rule the allocator applies,
    // never a subtraction from the cache -- so it stays high enough that only the allocator,
    // never the conservation bound, is what refuses the first admission below.
    await account(owner, 5_500_000n); await overflow(owner, true);
    const good = await grant(owner, 500_000n, 'paid');
    const bad = await grant(owner, 5_000_000n, 'paid');
    await quarantine(bad);
    await refuses(admitPersonal(owner, agent, '1000000')); // only the 500,000 good lot is eligible
    const admission = (await admitPersonal(owner, agent, '500000')).admission;
    assert.ok(admission.admissionId, 'the non-quarantined lot alone still funds within its own limit');
  });

  await t.test('a grants ledger that drifts ahead of the cached balance is still bounded', async () => {
    // credit_accounts.balance is documented as "the cached total" of unexpired credit_grants
    // (src/server/database/migrate-account-v2.js) -- a cache, which can desync from the ledger it
    // mirrors (a missed write, a partial migration). Aggregate zero, a positive eligible grant:
    // the allocator ALONE would admit this (a real paid lot, overflow on, well over the ceiling).
    // holdV2 (creditLedgerV2.js) never trusts the allocator alone either -- it checks
    // balance-minus-held FIRST, independently, before calling it. This is that same bound,
    // restored here: it must refuse what the allocator-only version of this fix would have let
    // through, which is exactly the drift scenario this case exists to prove is still caught.
    const owner = await user('drift'), agent = await agentResource(owner, 'a');
    await account(owner, 0n); await overflow(owner, true); await grant(owner, 2_000_000n, 'paid');
    await refuses(admitPersonal(owner, agent, '1000000'));
    // The reverse (balance positive, grants aggregate insufficient/zero) is already exercised
    // by the very first case above at overflow-off: a funded balance with a paid-only lot and
    // overflow off leaves the allocator with zero ELIGIBLE lots even though remaining_micro is
    // positive and the cached balance would happily cover the ceiling alone.
  });

  await t.test('a frozen account still refuses before the allocator runs', async () => {
    const owner = await user('frozen'), agent = await agentResource(owner, 'a');
    await pool.query('INSERT INTO credit_accounts(user_id,balance,is_frozen) VALUES($1,0,true)', [owner]);
    await overflow(owner, true); await grant(owner, 2_000_000n, 'paid');
    await assert.rejects(admitPersonal(owner, agent, '1000000'), (e) => e.code === 'needs_approval' && e.details?.reason === 'payer_cannot_fund');
  });
});
