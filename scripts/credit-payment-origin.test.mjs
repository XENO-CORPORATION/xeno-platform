// Payment origins and the contribution lifecycle, on real PostgreSQL and real HTTP.
// FUND-04 is cited at the conservation/replay test after its behavioural proof.
// This is not a claim that funded execution, budget approval, gifts or reporting UI are complete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { requireProofDatabase } from './lib/workforce-proof-database.mjs';
import { installBillingProviderFixture } from './fixtures/billing-provider-fixture.mjs';

const url = process.env.TEST_DATABASE_URL;
if (url) requireProofDatabase(url);
if (process.env.NODE_ENV === 'production') throw new Error('Payment origin proof requires an isolated test environment');
process.env.STRIPE_SECRET_KEY = 'sk_test_localfixture';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_localfixture';
process.env.STRIPE_EXPECTED_ACCOUNT_ID = 'acct_fixture';
process.env.STRIPE_EXPECTED_MODE = 'test';
const fixture = installBillingProviderFixture();
const { handleEvent } = await import('../src/server/services/billingService.js');
const { addGrant } = await import('../src/server/utils/creditLedgerV2.js');
const { migrateAccountV2 } = await import('../src/server/database/migrate-account-v2.js');

test('payment origins bind settled monetary evidence to the exact lot atomically', { skip: !url }, async t => {
  const pool = new pg.Pool({ connectionString: url, max: 6 });
  t.after(() => pool.end());
  const { runAllMigrations } = await import('../src/server/services/migrationRunner.js');
  await runAllMigrations(pool);
  await migrateAccountV2(pool);
  const {readFile}=await import('node:fs/promises');
  const fundingSql=await readFile(new URL('../src/server/database/migrations/20260928120000-workforce-funding-foundation.sql',import.meta.url),'utf8');
  const [fundingUp,fundingDown]=fundingSql.split(/^--\s*DOWN\b/im);
  const budgetSql=await readFile(new URL('../src/server/database/migrations/20260928130000-workforce-funding-budgets.sql',import.meta.url),'utf8');
  const [budgetUp,budgetDown]=budgetSql.split(/^--\s*DOWN\b/im);
  const priceSql=await readFile(new URL('../src/server/database/migrations/20260928140000-workforce-budget-price-pin.sql',import.meta.url),'utf8');
  const [priceUp,priceDown]=priceSql.split(/^--\s*DOWN\b/im);
  const runSql=await readFile(new URL('../src/server/database/migrations/20260928150000-workforce-funded-admissions.sql',import.meta.url),'utf8');
  const [runUp,runDown]=runSql.split(/^--\s*DOWN\b/im);
  await t.test('funding schema rolls back only while empty',async()=>{
    const db=await pool.connect();
    try {
      // Roll back dependants first, exactly as the migration runner does.
      await db.query('BEGIN');await db.query(runDown);await db.query(priceDown);await db.query(budgetDown);await db.query(fundingDown);
      assert.equal((await db.query("SELECT to_regclass('workforce_funding_campaigns') AS t")).rows[0].t,null,'empty funding rollback removes its schema');
      await db.query(fundingUp);await db.query(budgetUp);await db.query(priceUp);await db.query(runUp);await db.query('COMMIT');
    } finally {await db.query('ROLLBACK');db.release();}
  });
  const marker = randomUUID().replaceAll('-', '');
  const user = async tag => (await pool.query(`INSERT INTO users(username,email,password_hash,email_verified,display_name)
    VALUES($1,$2,'fixture-only',true,$1) RETURNING id`, [marker + tag, `${marker}${tag}@example.test`])).rows[0].id;
  const alice = await user('a');
  const session = (tag, patch = {}) => ({ id: `cs_${marker}${tag}`, mode: 'payment', payment_status: 'paid',
    payment_intent: `pi_${marker}${tag}`, client_reference_id: alice, customer: `cus_${marker}`,
    amount_total: 500, currency: 'eur', metadata: { xenoUserId: alice, credits: '5', kind: 'credits' }, ...patch });
  const event = (tag, s) => fixture.event(`evt_${marker}${tag.replaceAll('-', '_')}`, 'checkout.session.completed', s);
  const run = e => handleEvent(pool, e, { provider: fixture.provider });
  const rows = async () => (await pool.query(`SELECT p.*,g.user_id,g.source_ref,g.kind,g.amount_micro AS grant_micro
    FROM credit_grant_payment_origins p JOIN credit_grants g ON g.id=p.grant_id ORDER BY p.checkout_session`)).rows;

  await t.test('absence of payment history refuses eligibility without fabricating an origin', async () => {
    const {allocateContributionFunding}=await import('../src/server/utils/usageCreditFunding.js');
    const db=await pool.connect();
    try {
      await db.query('BEGIN');
      await assert.rejects(allocateContributionFunding(db,alice,'1'),{code:'INSUFFICIENT_CONTRIBUTABLE_CREDITS'},
        'a fresh installation has no verified payment origin');
    } finally {await db.query('ROLLBACK');db.release();}
  });

  await t.test('a settled checkout records exact provider, mode, payment, lot and monetary amount', async () => {
    const s = session('paid');
    await run(event('paid', s));
    const [origin] = await rows();
    assert.ok(origin, 'a paid fulfillment records its payment origin');
    assert.deepEqual([origin.provider_account, origin.provider_mode, origin.payment_intent, origin.checkout_session,
      origin.paid_minor, origin.currency, origin.amount_micro, origin.grant_micro, origin.user_id],
    ['acct_fixture', 'test', s.payment_intent, s.id, '500', 'eur', '5000000', '5000000', alice],
    'payment origin describes the exact purchased lot');
    await run(event('paid', s));
    await run(event('second-event', s));
    assert.equal((await rows()).length, 1, 'replayed checkout cannot mint a second payment origin');
  });

  await t.test('paid labels, fake references and zero-price promotions do not prove paid origin', async () => {
    await addGrant(pool, alice, { amountMicro: 1000, kind: 'paid', sourceRef: 'backfill' });
    await addGrant(pool, alice, { amountMicro: 1000, kind: 'paid', sourceRef: `stripe:checkout:cs_fake_${marker}` });
    await run(event('free', session('free', { payment_status: 'no_payment_required', amount_total: 0, payment_intent: null })));
    await run(event('zero', session('zero', { amount_total: 0 })));
    await run(event('missing-money', session('missing-money', { amount_total: undefined })));
    await run(event('missing-pi', session('missing-pi', { payment_intent: null })));
    await run(event('invalid-currency', session('invalid-currency', { currency: 'EUR' })));
    await run(event('pending', session('pending', { payment_status: 'unpaid' })));
    assert.deepEqual((await rows()).map(r => r.checkout_session), [session('paid').id],
      'only a positive settled payment has transferable origin');
    const promo = (await pool.query('SELECT amount_micro FROM credit_grants WHERE source_ref=$1', [`stripe:checkout:${session('free').id}`])).rows;
    assert.equal(promo[0]?.amount_micro, '5000000', 'zero-price fulfillment still grants usable credits without transfer evidence');
  });

  await t.test('origin recording and fulfillment roll back together on a write failure', async () => {
    await pool.query(`CREATE FUNCTION reject_fixture_origin() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture origin write failed'; END $$;
      CREATE TRIGGER reject_fixture_origin BEFORE INSERT ON credit_grant_payment_origins
      FOR EACH ROW EXECUTE FUNCTION reject_fixture_origin()`);
    const s = session('rollback'), e = event('rollback', s);
    const before = (await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1', [alice])).rows[0].balance;
    try {
      await assert.rejects(run(e), /fixture origin write failed/, 'origin failure aborts the fulfillment');
      assert.equal((await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1', [alice])).rows[0].balance, before,
        'origin failure rolls back the credit balance');
      for (const [table, field, value] of [['billing_events','event_id',e.id], ['billing_charges','payment_intent',s.payment_intent],
        ['credit_grants','source_ref',`stripe:checkout:${s.id}`], ['credit_transactions','reference_id',`stripe:checkout:${s.id}`]]) {
        assert.equal((await pool.query(`SELECT count(*)::int n FROM ${table} WHERE ${field}=$1`, [value])).rows[0].n, 0,
          'origin failure leaves no claimed event, charge, lot or journal entry');
      }
    } finally {
      await pool.query('DROP TRIGGER reject_fixture_origin ON credit_grant_payment_origins; DROP FUNCTION reject_fixture_origin()');
    }
    await run(e);
    assert.equal((await rows()).filter(r => r.checkout_session === s.id).length, 1,
      'the same checkout can retry after a rolled-back origin write');
  });

  await t.test('origin evidence is immutable and cannot be attached to a different lot amount', async () => {
    const [origin] = await rows();
    await assert.rejects(pool.query('UPDATE credit_grant_payment_origins SET paid_minor=paid_minor+1 WHERE grant_id=$1', [origin.grant_id]),
      { code: '23514' }, 'payment origins cannot be rewritten');
    await assert.rejects(pool.query('DELETE FROM credit_grant_payment_origins WHERE grant_id=$1', [origin.grant_id]),
      { code: '23514' }, 'payment origins cannot be erased');
    await assert.rejects(pool.query('TRUNCATE credit_grant_payment_origins'), { code: '23514' }, 'payment origins cannot be truncated');
    await addGrant(pool, alice, { amountMicro: 1000, kind: 'paid', sourceRef: `stripe:checkout:cs_guard_${marker}` });
    const grant = (await pool.query('SELECT id FROM credit_grants WHERE source_ref=$1', [`stripe:checkout:cs_guard_${marker}`])).rows[0].id;
    await assert.rejects(pool.query(`INSERT INTO credit_grant_payment_origins
      (grant_id,provider_account,provider_mode,payment_intent,checkout_session,event_id,paid_minor,currency,amount_micro)
      VALUES($1,'acct_fixture','test',$2,$3,$4,1,'eur',2000)`, [grant, `pi_guard_${marker}`, `cs_guard_${marker}`, `evt_guard_${marker}`]),
    { code: '23514' }, 'payment origin cannot overstate its lot');
    const before = await rows();
    await migrateAccountV2(pool);
    assert.deepEqual(await rows(), before, 'startup replay preserves payment evidence without backfilling old paid labels');
  });

  await t.test('contribution selection rechecks origin, refunds, expiry, consent and commitments', async () => {
    const { allocateContributionFunding } = await import('../src/server/utils/usageCreditFunding.js');
    await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)', [alice]);
    const select = async (amount, prepare = async () => {}) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await prepare(client);
        return await allocateContributionFunding(client, alice, amount);
      } finally { await client.query('ROLLBACK'); client.release(); }
    };
    const verified = await rows();
    const total = String(verified.reduce((n, r) => n + BigInt(r.amount_micro), 0n));
    const picked = await select(total);
    assert.deepEqual(new Set(picked.allocations.map(a => a.originGrantId)), new Set(verified.map(r => r.grant_id)),
      'contributions select only payment-backed lots');
    assert.equal(picked.allocations.reduce((n,a) => n + BigInt(a.amountMicro), 0n).toString(), total);
    await assert.rejects(select(String(BigInt(total) + 1n)), { code: 'INSUFFICIENT_CONTRIBUTABLE_CREDITS' },
      'unproven paid and promotional lots cannot cover a contribution shortfall');
    await assert.rejects(select('1', c => c.query('UPDATE credit_accounts SET is_frozen=true WHERE user_id=$1', [alice])),
      { code: 'CONTRIBUTION_ACCOUNT_UNAVAILABLE' }, 'a frozen account cannot contribute');
    await assert.rejects(select('1', c => c.query('UPDATE usage_credit_preferences SET enabled=false WHERE user_id=$1', [alice])),
      { code: 'CONTRIBUTION_CONSENT_REQUIRED' }, 'contribution consent is rechecked inside the transaction');
    await assert.rejects(select('1', c => c.query('UPDATE credit_grants SET expires_at=now()-interval \'1 second\' WHERE user_id=$1', [alice])),
      { code: 'INSUFFICIENT_CONTRIBUTABLE_CREDITS' }, 'expired paid value cannot contribute');
    await assert.rejects(select(total, c => c.query('UPDATE billing_charges SET refunded_micro=1 WHERE payment_intent=$1', [verified[0].payment_intent])),
      { code: 'INSUFFICIENT_CONTRIBUTABLE_CREDITS' }, 'a refunded origin is quarantined rather than relabelled');
    const unaffected = await select('1', c => c.query('UPDATE billing_charges SET refunded_micro=1 WHERE payment_intent=$1', [verified[0].payment_intent]));
    assert.ok(unaffected.allocations.every(a => a.originGrantId !== verified[0].grant_id), 'unrelated paid origins remain available');
    await assert.rejects(select('1', c => c.query("UPDATE billing_account_binding SET mode='live'")),
      { code: 'INSUFFICIENT_CONTRIBUTABLE_CREDITS' }, 'payment evidence from another mode cannot fund contributions');
    await assert.rejects(select(total, async c => {
      const h = (await c.query(`INSERT INTO credit_holds(user_id,account_id,hold_id,surface,operation,amount_micro,expires_at)
        VALUES($1,$2,'origin-held','test','test',1,now()-interval '1 hour') RETURNING id`, [alice, picked.accountId])).rows[0];
      await c.query('INSERT INTO credit_hold_funding(hold_row_id,grant_id,reserved_micro,draw_order) VALUES($1,$2,1,0)', [h.id,verified[0].grant_id]);
    }), { code: 'INSUFFICIENT_CONTRIBUTABLE_CREDITS' }, 'an unresolved allocated hold stays committed past its expiry');
    await assert.rejects(select(total, c => c.query(`INSERT INTO credit_holds(user_id,account_id,hold_id,surface,operation,amount_micro,expires_at)
      VALUES($1,$2,'legacy-held','test','test',1,now()-interval '1 hour')`, [alice, picked.accountId])),
    { code: 'INSUFFICIENT_CONTRIBUTABLE_CREDITS' }, 'an unresolved legacy hold stays committed past its expiry');
    assert.deepEqual(await rows(), verified, 'allocation inspection writes no origin evidence');
  });
  await t.test('contributions conserve lots and ledger value under replay, concurrency and rollback (FUND-04)', async () => {
    const svc = await import('../src/server/services/workforceFunding.js');
    const { createAuthorizedProject, userPrincipal } = await import('../src/server/services/chatProjectAuthority.js');
    const { verifyChainV2, recordUsageV2 } = await import('../src/server/utils/creditLedgerV2.js');
    // Deliberately retain PostgreSQL microseconds: a JS Date round-trip would truncate this.
    await pool.query("UPDATE credit_grants SET expires_at=date_trunc('day',now())+interval '30 days 0.123456 seconds' WHERE id IN (SELECT grant_id FROM credit_grant_payment_origins)");
    const manager = await user('manager');
    const project = await createAuthorizedProject(pool, { principal:userPrincipal(manager), name:'Funding proof' });
    const ctx = actorUserId => ({actorUserId,clientId:'xeno-web'});
    await assert.rejects(svc.createFundingCampaign(pool,ctx(alice),{operationId:randomUUID(),projectId:project.id,
      beneficiary:'Not mine',cancellationTerms:'Cancel',refundTerms:'Return',deliverableLicense:'MIT'}),
      e=>e.details?.reason==='project_not_found','only a current project administrator may solicit its funding');
    const campaign = await svc.createFundingCampaign(pool,ctx(manager), {operationId:randomUUID(),projectId:project.id,
      beneficiary:'Project owner',cancellationTerms:'Undelivered work may be cancelled.',
      refundTerms:'Unused uncommitted value returns with original expiry.',deliverableLicense:'MIT'});
    const milestone = await svc.createFundingMilestone(pool,ctx(manager),{campaignId:campaign.id,key:'first',title:'First deliverable',
      criteria:['A reviewer accepts the executable result.'],thresholdMicro:'1000000',budgetMaxMicro:'5000000'});
    await svc.openFundingCampaign(pool,ctx(manager),{campaignId:campaign.id});
    const offer = await svc.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id});
    assert.equal(offer.terms.refundTerms,'Unused uncommitted value returns with original expiry.','contributor previews return and expiry terms');
    const pause=await svc.setFundingCampaignStatus(pool,ctx(manager),{campaignId:campaign.id,status:'paused',expectedRevision:'2'});
    await assert.rejects(svc.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id}),
      e=>e.details?.reason==='campaign_not_found','paused campaigns accept no new contribution consent');
    await svc.setFundingCampaignStatus(pool,ctx(manager),{campaignId:campaign.id,status:'open',expectedRevision:pause.revision});
    await pool.query('UPDATE chat_projects SET is_archived=true WHERE id=$1',[project.id]);
    await assert.rejects(svc.readFundingOffer(pool,ctx(alice),{campaignId:campaign.id,milestoneId:milestone.id}),
      e=>e.details?.reason==='campaign_not_found','archived projects cannot solicit new contributions');
    await pool.query('UPDATE chat_projects SET is_archived=false WHERE id=$1',[project.id]);
    const poolRow=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
    const cash = async id => (await pool.query('SELECT balance FROM credit_accounts WHERE user_id=$1',[id])).rows[0].balance;
    const sourceBefore=BigInt(await cash(alice)),destBefore=BigInt(await cash(poolRow.id));
    const beforeTuples=(await pool.query('SELECT * FROM relationship_tuples ORDER BY object_type,object_id,relation,subject_type,subject_id')).rows;
    const request={operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'1234567',consentHash:offer.consentHash,confirmed:true};
    const first=await svc.contributeFunding(pool,ctx(alice),request);
    assert.equal(first.state,'confirmed','contribution acknowledges only committed funds');
    const rollbackProbe=await pool.connect();
    try {
      await rollbackProbe.query('BEGIN');
      await assert.rejects(rollbackProbe.query(fundingDown),{code:'23514'},'populated funding rollback refuses to erase history');
    } finally {await rollbackProbe.query('ROLLBACK');rollbackProbe.release();}
    assert.deepEqual([String(sourceBefore-BigInt(await cash(alice))),String(BigInt(await cash(poolRow.id))-destBefore)],
      [request.amountMicro,request.amountMicro],'contribution conserves exact micro-credits across ledger accounts');
    const links=(await pool.query(`SELECT l.*,s.expires_at::text AS source_expiry,d.expires_at::text AS destination_expiry,
      d.kind,d.remaining_micro FROM workforce_contribution_lots l JOIN credit_grants s ON s.id=l.origin_grant_id
      JOIN credit_grants d ON d.id=l.pool_grant_id WHERE contribution_id=$1`,[first.id])).rows;
    assert.ok(links.length>0,'contribution retains its origin-lot lineage');
    await assert.rejects(pool.query(`INSERT INTO workforce_contribution_lots
      (contribution_id,origin_grant_id,pool_grant_id,amount_micro,origin_kind)
      VALUES($1,$2,$3,1,'paid')`,[first.id,randomUUID(),randomUUID()]),
      {code:'23514'},'confirmed contributions cannot acquire unrelated origin lots');
    assert.ok(links.every(l=>l.source_expiry===l.destination_expiry&&l.kind==='contribution'),'pool lots inherit exact expiry and restricted kind');
    assert.deepEqual((await pool.query('SELECT * FROM relationship_tuples ORDER BY object_type,object_id,relation,subject_type,subject_id')).rows,
      beforeTuples,'a contribution grants no project or workspace authority');
    assert.equal((await verifyChainV2(pool,alice)).ok,true,'contributor journal chain remains valid');
    assert.equal((await verifyChainV2(pool,poolRow.id)).ok,true,'pool journal chain remains valid');
    await assert.rejects(recordUsageV2(pool,poolRow.id,{transactionId:randomUUID(),costMicro:1}),{code:'RESTRICTED_ACCOUNT'},
      'ordinary spending cannot consume contributed value');
    const snapshot=async()=>({source:await cash(alice),dest:await cash(poolRow.id),
      count:(await pool.query('SELECT count(*)::int n FROM workforce_funding_contributions')).rows[0].n});
    const before=await snapshot();
    const replies=await Promise.all(Array.from({length:5},()=>svc.contributeFunding(pool,ctx(alice),request)));
    assert.ok(replies.every(r=>r.id===first.id&&r.replayed),'retries return one contribution');
    assert.deepEqual(await snapshot(),before,'retries move no additional value');
    await assert.rejects(svc.contributeFunding(pool,ctx(alice),{...request,amountMicro:'1234568'}),
      e=>e.details?.reason==='operation_payload_conflict','changed-payload replay conflicts');
    const read=await svc.readFundingContribution(pool,ctx(alice),{operationId:request.operationId});
    assert.equal(read.id,first.id,'lost response reconciles by the original operation');
    assert.equal((await svc.readFundingContribution(pool,ctx(manager),{operationId:request.operationId})).state,'not-observed',
      'another actor cannot read a contribution receipt');
    await assert.rejects(svc.contributeFunding(pool,ctx(alice),{...request,operationId:randomUUID(),consentHash:'f'.repeat(64)}),
      e=>e.details?.reason==='funding_terms_changed','a contribution binds the terms actually confirmed');
    await assert.rejects(svc.contributeFunding(pool,ctx(alice),{...request,operationId:randomUUID(),confirmed:false}),
      e=>e.details?.reason==='explicit_confirmation_required','a contribution requires explicit confirmation');
    await pool.query(`CREATE FUNCTION reject_pool_credit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.kind='contribution' THEN RAISE EXCEPTION 'fixture pool write failed'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_pool_credit BEFORE INSERT ON credit_grants FOR EACH ROW EXECUTE FUNCTION reject_pool_credit()`);
    const failed={...request,operationId:randomUUID(),amountMicro:'100'};
    try {
      await assert.rejects(svc.contributeFunding(pool,ctx(alice),failed),/fixture pool write failed/,'destination failure aborts contribution');
      assert.deepEqual(await snapshot(),before,'destination failure rolls back source debit and pending receipt');
    } finally { await pool.query('DROP TRIGGER reject_pool_credit ON credit_grants; DROP FUNCTION reject_pool_credit()'); }
    assert.equal((await svc.contributeFunding(pool,ctx(alice),failed)).state,'confirmed','rolled-back contribution can retry unchanged');
    const racedBefore=BigInt(await cash(poolRow.id));
    const raced=await Promise.allSettled(Array.from({length:3},()=>svc.contributeFunding(pool,ctx(alice),
      {...request,operationId:randomUUID(),amountMicro:'4000000'})));
    assert.equal(raced.filter(r=>r.status==='fulfilled').length,2,`distinct concurrent contributions cannot overspend paid lots: ${raced.filter(r=>r.status==='rejected').map(r=>r.reason.code+': '+r.reason.message).join('; ')}`);
    assert.ok(raced.filter(r=>r.status==='rejected').every(r=>r.reason.code==='INSUFFICIENT_CONTRIBUTABLE_CREDITS'),
      'the losing contribution fails for insufficient paid value, not a deadlock');
    assert.equal(BigInt(await cash(poolRow.id))-racedBefore,8000000n,'only the two funded contributions move value');
    assert.equal((await verifyChainV2(pool,alice)).ok,true,'concurrent contributions preserve the source journal');
    assert.equal((await verifyChainV2(pool,poolRow.id)).ok,true,'concurrent contributions preserve the pool journal');
    const uncertain={...request,operationId:randomUUID(),amountMicro:'100'};
    let dropped=false;
    const lostCommit={connect:async()=>{
      const c=await pool.connect();
      return {release:()=>c.release(),query:async(sql,...args)=>{
        const result=await c.query(sql,...args);
        if(sql==='COMMIT'&&!dropped){dropped=true;throw new Error('fixture lost commit acknowledgement');}
        return result;
      }};
    }};
    await assert.rejects(svc.contributeFunding(lostCommit,ctx(alice),uncertain),
      e=>e.details?.reason==='contribution_state_uncertain','lost commit acknowledgement is uncertain, never a confirmed failure');
    const reconciled=await svc.readFundingContribution(pool,ctx(alice),{operationId:uncertain.operationId});
    assert.equal(reconciled.state,'confirmed','lost commit acknowledgement reconciles the durable receipt');
    const afterUncertain=await snapshot();
    assert.equal((await svc.contributeFunding(pool,ctx(alice),uncertain)).id,reconciled.id,'retry uses the already committed operation');
    assert.deepEqual(await snapshot(),afterUncertain,'lost acknowledgement retry moves no additional credits');
    const { spawnSync }=await import('node:child_process');
    const restarted=spawnSync(process.execPath,['--input-type=module','-e',`
      import pg from 'pg';
      import { contributeFunding } from './src/server/services/workforceFunding.js';
      const p=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
      try { console.log(JSON.stringify(await contributeFunding(p,JSON.parse(process.env.PROOF_CONTEXT),JSON.parse(process.env.PROOF_REQUEST)))); }
      finally { await p.end(); }
    `],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:30000,
      env:{...process.env,PROOF_CONTEXT:JSON.stringify(ctx(alice)),PROOF_REQUEST:JSON.stringify(uncertain)}});
    assert.equal(restarted.status,0,`a restarted process can reconcile the contribution: ${restarted.stderr}`);
    assert.deepEqual([JSON.parse(restarted.stdout).id,JSON.parse(restarted.stdout).replayed],[reconciled.id,true],
      'process restart preserves the original contribution identity');
    assert.deepEqual(await snapshot(),afterUncertain,'process restart cannot duplicate contribution value');
    await assert.rejects(pool.query('UPDATE workforce_funding_campaigns SET beneficiary=$2 WHERE id=$1',[campaign.id,'Other beneficiary']),
      {code:'23514'},'existing consent cannot be retargeted');
    await assert.rejects(pool.query('DELETE FROM workforce_funding_contributions WHERE id=$1',[first.id]),
      {code:'23514'},'contribution receipts cannot be deleted');
    const beforeReturn=await snapshot();
    const held=(await pool.query(`INSERT INTO credit_holds(user_id,account_id,hold_id,surface,operation,amount_micro,expires_at)
      VALUES($1,$2,'pool-unresolved','test','test',1,now()-interval '1 hour') RETURNING id`,[poolRow.id,poolRow.account_id])).rows[0].id;
    await assert.rejects(svc.returnFundingContribution(pool,ctx(alice),{contributionId:first.id}),
      {code:'CONTRIBUTION_RESERVED'},'unresolved pool work blocks a return even after lease expiry');
    assert.deepEqual(await snapshot(),beforeReturn,'refused return changes no balance');
    // The fixture proves settlement explicitly; no production path treats expiry as settlement.
    await pool.query("UPDATE credit_holds SET state='settled' WHERE id=$1",[held]);
    const returned=await svc.returnFundingContribution(pool,ctx(alice),{contributionId:first.id});
    assert.equal(returned.amountMicro,request.amountMicro,'unused contribution returns in full without a fee');
    assert.deepEqual([String(BigInt(await cash(alice))-BigInt(beforeReturn.source)),String(BigInt(beforeReturn.dest)-BigInt(await cash(poolRow.id)))],
      [request.amountMicro,request.amountMicro],'return conserves exact micro-credits');
    const afterReturn=await snapshot();
    assert.equal((await svc.returnFundingContribution(pool,ctx(alice),{contributionId:first.id})).replayed,true,'a return is idempotent');
    assert.deepEqual(await snapshot(),afterReturn,'return replay moves no value');
    const returnLinks=(await pool.query(`SELECT s.expires_at::text AS source_expiry,l.origin_expires_at::text AS accepted_expiry,d.remaining_micro
      FROM workforce_contribution_lots l JOIN credit_grants s ON s.id=l.origin_grant_id JOIN credit_grants d ON d.id=l.pool_grant_id
      WHERE contribution_id=$1`,[first.id])).rows;
    assert.ok(returnLinks.every(l=>l.source_expiry===l.accepted_expiry&&l.remaining_micro==='0'),'return restores the original lot without resetting expiry');
    await assert.rejects(svc.returnFundingContribution(pool,ctx(manager),{contributionId:reconciled.id}),
      {code:'CONTRIBUTION_NOT_FOUND'},'a manager cannot redirect a contributor return');
    assert.equal((await verifyChainV2(pool,alice)).ok,true,'return preserves the contributor journal');
    assert.equal((await verifyChainV2(pool,poolRow.id)).ok,true,'return preserves the pool journal');

    const shortOwner=await user('short');
    const shortSession=session('short',{client_reference_id:shortOwner,customer:`cus_${marker}short`,
      metadata:{xenoUserId:shortOwner,credits:'5',kind:'credits'}});
    await run(event('short',shortSession));
    await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true)',[shortOwner]);
    const shortLot=(await pool.query("UPDATE credit_grants SET expires_at=clock_timestamp()+interval '3 seconds' WHERE user_id=$1 RETURNING id",[shortOwner])).rows[0].id;
    const shortContribution=await svc.contributeFunding(pool,ctx(shortOwner),{...request,operationId:randomUUID(),amountMicro:'5000000'});
    assert.equal(await cash(shortOwner),'0');
    // Wait for actual database time, without rewriting a single expiry/provenance field.
    for(let i=0;i<60;i++) {
      if((await pool.query('SELECT expires_at<=clock_timestamp() AS expired FROM credit_grants WHERE id=$1',[shortLot])).rows[0].expired)break;
      await new Promise(r=>setTimeout(r,100));
    }
    assert.equal((await pool.query('SELECT expires_at<=clock_timestamp() AS expired FROM credit_grants WHERE id=$1',[shortLot])).rows[0].expired,true);
    const expiredReturn=await svc.returnFundingContribution(pool,ctx(shortOwner),{contributionId:shortContribution.id});
    assert.deepEqual([expiredReturn.amountMicro,expiredReturn.expiredMicro,await cash(shortOwner)],['5000000','5000000','0'],
      'expired return remains expired rather than reviving spendable balance');
    await addGrant(pool,shortOwner,{amountMicro:1,kind:'promo',sourceRef:`after-expiry-${marker}`});
    assert.equal((await pool.query("SELECT count(*)::int n FROM credit_grants WHERE user_id=$1 AND source_ref='backfill'",[shortOwner])).rows[0].n,0,
      'expired return cannot trigger a fresh paid backfill');
    assert.equal((await verifyChainV2(pool,shortOwner)).ok,true,'expiry-classified return preserves the journal');

    const originForDispute=(await pool.query(`SELECT o.payment_intent,o.grant_id FROM workforce_contribution_lots l
      JOIN credit_grant_payment_origins o ON o.grant_id=l.origin_grant_id WHERE l.contribution_id=$1`,[reconciled.id])).rows[0];
    const balancesBeforeDispute=await snapshot();
    const dispute=fixture.event(`evt_${marker}dispute`,'charge.dispute.funds_withdrawn',
      {payment_intent:originForDispute.payment_intent,amount:500});
    const disputeResult=await run(dispute);
    assert.equal(disputeResult.reconciliationRequired,true,'contributed payment loss is recorded for reconciliation');
    assert.deepEqual(await snapshot(),balancesBeforeDispute,'chargeback cannot debit unrelated personal or pool value');
    const quarantine=(await pool.query('SELECT * FROM workforce_funding_origin_quarantine WHERE event_id=$1',[dispute.id])).rows[0];
    assert.equal(quarantine.grant_id,originForDispute.grant_id,'chargeback traces the exact contributed origin');
    assert.equal(quarantine.liability_micro,'5000000','unfunded loss remains explicit rather than charged to another contributor');
    await run(dispute);
    assert.equal((await pool.query('SELECT count(*)::int n FROM workforce_funding_origin_quarantine WHERE event_id=$1',[dispute.id])).rows[0].n,1,
      'a repeated dispute creates one quarantine record');
    await assert.rejects(svc.returnFundingContribution(pool,ctx(alice),{contributionId:reconciled.id}),
      {code:'CONTRIBUTION_ORIGIN_QUARANTINED'},'quarantined-origin value cannot escape through return');
    const disputedRead=await svc.readFundingContribution(pool,ctx(alice),{operationId:uncertain.operationId});
    assert.deepEqual([disputedRead.availability,disputedRead.reconciliationRequired],['quarantined',true],
      'contribution read-back reports quarantined origin instead of spendable success');
    const { allocateFunding }=await import('../src/server/utils/usageCreditFunding.js');
    const db=await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query('SELECT id FROM credit_accounts WHERE user_id=$1 FOR UPDATE',[alice]);
      const plan=await allocateFunding(db,alice,1);
      assert.ok(plan.every(l=>l.grantId!==originForDispute.grant_id),'ordinary spending excludes quarantined origin lots');
    } finally {await db.query('ROLLBACK');db.release();}

  });

  await t.test('journal order follows account serialization, not transaction start time', async () => {
    const {addGrantTx,verifyChainV2}=await import('../src/server/utils/creditLedgerV2.js');
    const id=await user('order'),early=await pool.connect();
    try {
      await early.query('BEGIN');
      await early.query('SELECT now()');
      // This transaction began later but commits its journal entry first.
      await addGrant(pool,id,{amountMicro:100,sourceRef:`order-first-${marker}`});
      await addGrantTx(early,id,{amountMicro:100,sourceRef:`order-second-${marker}`});
      await addGrantTx(early,id,{amountMicro:100,sourceRef:`order-third-${marker}`});
      await early.query('COMMIT');
      const order=(await pool.query('SELECT reference_id FROM credit_transactions WHERE user_id=$1 ORDER BY created_at,id',[id])).rows.map(r=>r.reference_id);
      assert.deepEqual(order,[`order-first-${marker}`,`order-second-${marker}`,`order-third-${marker}`],
        'journal sequence follows lock acquisition even when transaction starts are reversed');
      assert.equal((await verifyChainV2(pool,id)).ok,true,'one transaction writing twice preserves the journal chain');
    } finally {await early.query('ROLLBACK');early.release();}
  });

  await t.test('funding is reachable only through authenticated, sender-bound, recent account commands', async () => {
    const express = (await import('express')).default;
    const { createRequire } = await import('node:module');
    const { generateKeyPairSync, randomBytes } = await import('node:crypto');
    const jwt = createRequire(new URL('../src/server/package.json',import.meta.url))('jsonwebtoken');
    const { jwkThumbprint, accessTokenHash } = await import('../src/server/utils/dpop.js');
    const { issuer } = await import('../src/server/config/hosts.js');
    const { getSigningKey } = await import('../src/server/utils/oidcProvider.js');
    const { createAuthorizedProject,userPrincipal } = await import('../src/server/services/chatProjectAuthority.js');
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
    const { default: router } = await import('../src/server/routes/workforceRoutes.js');
    const signer=await getSigningKey(pool),proofKey=generateKeyPairSync('ec',{namedCurve:'P-256'});
    const jwk=proofKey.publicKey.export({format:'jwk'}),jkt=jwkThumbprint(jwk),sid=randomUUID();
    const now=Math.floor(Date.now()/1000);
    await pool.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch) VALUES($1,0) ON CONFLICT DO NOTHING',[alice]);
    await pool.query(`INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at)
      VALUES($1,$2,0,to_timestamp($3),$4,now()+interval '1 hour')`,[sid,alice,now,jkt]);
    const mint=({bound=true,scope='openid workforce:read workforce:manage ledger:spend',authTime=now}={})=>jwt.sign({sub:alice,sid,auth_epoch:0,
      auth_time:authTime,client_id:'xeno-agent-interface',scope,typ:'at+jwt',...(bound?{cnf:{jkt}}:{})},signer.privatePem,
      {algorithm:signer.alg,keyid:signer.kid,audience:'xeno-api',expiresIn:'5m',header:{typ:'at+jwt'}});
    const app=express();app.use((req,_res,next)=>{req.db=pool;next();});app.use('/api/workforce',router);
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>server.close());
    const call=async(path,body,{credential=mint(),proof=true,scheme='DPoP'}={})=>{
      const full='/api/workforce/funding'+path,headers={'content-type':'application/json',authorization:`${scheme} ${credential}`};
      if(proof)headers.dpop=jwt.sign({jti:randomUUID(),htm:'POST',htu:issuer()+full,ath:accessTokenHash(credential),iat:now},
        proofKey.privateKey,{algorithm:'ES256',header:{typ:'dpop+jwt',jwk}});
      const r=await fetch(`http://127.0.0.1:${server.address().port}${full}`,{method:'POST',headers,body:JSON.stringify(body)});
      return {status:r.status,body:await r.json().catch(()=>null),cache:r.headers.get('cache-control')};
    };
    const p=await createAuthorizedProject(pool,{principal:userPrincipal(alice),name:'HTTP campaign'});
    const draft={operationId:randomUUID(),projectId:p.id,beneficiary:'Project',cancellationTerms:'Cancel undelivered work.',
      refundTerms:'Return unused value under its original expiry.',deliverableLicense:'MIT'};
    // Prove the route exists before refusal checks: a missing route is not an auth denial.
    const created=await call('/campaigns',draft);
    assert.equal(created.status,200,`funding campaign route is mounted: ${JSON.stringify(created.body)}`);
    assert.equal((await call('/campaigns',draft,{credential:jwt.sign({userId:alice},process.env.JWT_SECRET),scheme:'Bearer',proof:false})).status,401,
      'legacy bearer credentials cannot allocate funding');
    assert.equal((await call('/campaigns',draft,{credential:mint({bound:false}),scheme:'Bearer',proof:false})).status,401,
      'unbound accounts cannot allocate funding');
    assert.equal((await call('/campaigns',draft,{credential:mint({scope:'workforce:read'})})).status,403,'funding mutation requires management scope');
    assert.equal((await call('/campaigns',draft,{credential:mint({authTime:now-3600})})).status,401,'funding mutation requires recent authentication');
    assert.equal((await call('/campaigns',{...draft,actorUserId:randomUUID()})).status,400,'funding actor comes from the authenticated context');
    assert.equal(created.cache,'no-store','funding receipts are not cached');
    const m=await call('/milestones',{campaignId:created.body.result.id,key:'ship',title:'Ship',criteria:['Review accepted'],thresholdMicro:'1000',budgetMaxMicro:'10000'});
    assert.equal(m.status,200,`milestone route works: ${JSON.stringify(m.body)}`);
    const target={campaignId:created.body.result.id,milestoneId:m.body.result.id};
    assert.equal((await call('/campaigns/open',{campaignId:target.campaignId})).status,200,'campaign opening is reachable');
    const offer=await call('/offers/read',target);
    assert.equal(offer.status,200,'funding terms can be previewed');
    const request={...target,operationId:randomUUID(),amountMicro:'1000',consentHash:offer.body.result.consentHash,confirmed:true};
    assert.equal((await call('/contributions',request,{credential:mint({authTime:now-3600})})).status,401,
      'contribution requires recent authentication at the money-moving endpoint');
    assert.equal((await call('/contributions',{...request,confirmed:false})).status,400,'HTTP funding requires explicit consent');
    const configurationOnly=mint({scope:'openid workforce:read workforce:manage'});
    assert.equal((await call('/contributions',request,{credential:configurationOnly})).status,403,
      'workforce configuration scope cannot transfer credits');
    const funded=await call('/contributions',request);
    assert.deepEqual([funded.status,funded.body.result?.state],[200,'confirmed'],'HTTP contribution reaches the real ledger');
    assert.equal((await call('/contributions/return',{contributionId:funded.body.result.id},{credential:configurationOnly})).status,403,
      'workforce configuration scope cannot return credits');
    const returned=await call('/contributions/return',{contributionId:funded.body.result.id});
    assert.deepEqual([returned.status,returned.body.result?.state,returned.body.result?.amountMicro],[200,'returned','1000'],
      'HTTP return reaches the original contributor and exact amount');
    assert.equal((await call('/contributions/read',{operationId:request.operationId})).body.result.id,funded.body.result.id,
      'HTTP read reconciles the exact committed contribution');
    await pool.query('DELETE FROM oauth_session_state WHERE sid=$1',[sid]);
    assert.equal((await call('/contributions',{...request,operationId:randomUUID()})).status,401,'revoked sessions cannot move project funds');
  });

});
