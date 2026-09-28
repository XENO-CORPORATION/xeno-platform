// Budget proposals and independent decisions; not yet a complete FUND-13 citation.
// Dispatch/settlement must consume this approval before bounded automation is proven.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
import {runAllMigrations} from '../src/server/services/migrationRunner.js';
import {migrateAccountV2} from '../src/server/database/migrate-account-v2.js';
import {createAuthorizedProject,userPrincipal} from '../src/server/services/chatProjectAuthority.js';
import * as funding from '../src/server/services/workforceFunding.js';
const url=process.env.TEST_DATABASE_URL;
if(url)requireProofDatabase(url);

test('a budget is a bounded proposal until an independent current project owner decides', {skip:!url},async t=>{
  const pool=new pg.Pool({connectionString:url,max:8});t.after(()=>pool.end());
  await runAllMigrations(pool);await migrateAccountV2(pool);
  const {readFile}=await import('node:fs/promises');
  const migration=await readFile(new URL('../src/server/database/migrations/20260928130000-workforce-funding-budgets.sql',import.meta.url),'utf8');
  const [up,down]=migration.split('-- DOWN');
  const priceMigration=await readFile(new URL('../src/server/database/migrations/20260928140000-workforce-budget-price-pin.sql',import.meta.url),'utf8');
  const [priceUp,priceDown]=priceMigration.split('-- DOWN');
  const runMigration=await readFile(new URL('../src/server/database/migrations/20260928150000-workforce-funded-admissions.sql',import.meta.url),'utf8');
  const [runUp,runDown]=runMigration.split('-- DOWN');
  const settlementMigration=await readFile(new URL('../src/server/database/migrations/20260928160000-workforce-funding-settlements.sql',import.meta.url),'utf8');
  const [settlementUp,settlementDown]=settlementMigration.split('-- DOWN');
  await pool.query(settlementDown);await pool.query(runDown);await pool.query(priceDown);await pool.query(down);await pool.query(up);await pool.query(priceUp);await pool.query(runUp);await pool.query(settlementUp);
  assert.equal((await pool.query("SELECT to_regclass('workforce_funding_budgets') name")).rows[0].name,'workforce_funding_budgets',
    'empty budget migration rolls back and reapplies');
  const makeUser=async()=>{const s=randomUUID();return (await pool.query(`INSERT INTO users(username,email,password_hash,display_name)
    VALUES($1,$2,'test-only',$1) RETURNING id`,[s,s+'@example.test'])).rows[0].id;};
  const owner=await makeUser(),planner=await makeUser(),spender=await makeUser(),other=await makeUser();
  const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
  const project=await createAuthorizedProject(pool,{principal:userPrincipal(owner),name:'Budget independence'});
  await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
    VALUES('project',$1,'editor','user',$2),('project',$1,'viewer','user',$3)`,[project.id,planner,spender]);
  const campaign=await funding.createFundingCampaign(pool,ctx(owner),{operationId:randomUUID(),projectId:project.id,
    beneficiary:'Project deliverable',cancellationTerms:'Cancel undelivered work.',refundTerms:'Return unused credits with original expiry.',deliverableLicense:'MIT'});
  const milestone=await funding.createFundingMilestone(pool,ctx(owner),{campaignId:campaign.id,key:'m1',title:'Build',criteria:['Tests and reviewer acceptance'],
    thresholdMicro:'1000',budgetMaxMicro:'10000'});
  await funding.openFundingCampaign(pool,ctx(owner),{campaignId:campaign.id});
  const offer=await funding.readFundingOffer(pool,ctx(planner),{campaignId:campaign.id,milestoneId:milestone.id});
  const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
  const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
  const draft=(patch={})=>({operationId:randomUUID(),poolId:p.id,spenderUserId:spender,maximumMicro:'5000',perRunMicro:'1000',
    purpose:'Implement the accepted milestone',...price,termsHash:offer.consentHash,...patch});
  const reject=(fn,reason,message)=>assert.rejects(fn,e=>e.details?.reason===reason,message);
  let proposed;
  await t.test('planning and approval are separate, and both are bounded by contributor terms',async()=>{
    await reject(funding.proposeFundingBudget(pool,ctx(other),draft()),'project_not_found','an outsider cannot propose a project budget');
    await reject(funding.proposeFundingBudget(pool,ctx(spender),draft()),'project_not_found','viewer access is not budget-plan authority');
    await reject(funding.proposeFundingBudget(pool,ctx(planner),draft({maximumMicro:'10001'})),
      'budget_exceeds_contributor_limit','a planner cannot raise the contributor-authorized ceiling');
    await reject(funding.proposeFundingBudget(pool,ctx(planner),draft({termsHash:'f'.repeat(64)})),
      'funding_terms_changed','a proposal binds the contributor-visible terms');
    await reject(funding.proposeFundingBudget(pool,ctx(planner),draft({priceVersion:'tariff-fixture-v1'})),
      'funding_price_changed','an arbitrary price label cannot authorize spending');
    const request=draft();proposed=await funding.proposeFundingBudget(pool,ctx(planner),request);
    const persisted=(await pool.query('SELECT price_snapshot FROM workforce_funding_budgets WHERE id=$1',[proposed.id])).rows[0].price_snapshot;
    assert.equal(persisted.version,price.priceVersion,'the budget retains the exact approved tariff');
    assert.ok(!JSON.stringify(proposed).includes('MicroPerToken'),'public budget readback never publishes token rates');
    await assert.rejects(pool.query('UPDATE workforce_funding_budgets SET price_snapshot=NULL WHERE id=$1',[proposed.id]),{code:'23514'},
      'the tariff cannot be removed from an existing proposal');
    await assert.rejects(pool.query(priceDown),{code:'23514'},'rollback cannot erase retained price consent');
    assert.deepEqual([proposed.state,proposed.maximumMicro,proposed.perRunMicro],['proposed','5000','1000'],'planning creates no spending approval');
    assert.equal((await funding.proposeFundingBudget(pool,ctx(planner),request)).id,proposed.id,'proposal retry retains identity');
    await reject(funding.proposeFundingBudget(pool,ctx(planner),{...request,perRunMicro:'999'}),'operation_payload_conflict','changed proposal replay conflicts');
    const decision={budgetId:proposed.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'};
    await reject(funding.decideFundingBudget(pool,ctx(planner),decision),'project_not_found','a planner cannot approve merely by being an editor');
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'owner','user',$2)`,[project.id,planner]);
    await reject(funding.decideFundingBudget(pool,ctx(planner),decision),'independent_budget_approval_required',
      'even a project owner cannot approve their own proposal');
    const accepted=await funding.decideFundingBudget(pool,ctx(owner),decision);
    assert.deepEqual([accepted.state,accepted.decidedByUserId,accepted.spenderUserId],['approved',owner,spender],
      'independent owner approves exactly the named spender and limits');
    assert.equal((await funding.decideFundingBudget(pool,ctx(owner),decision)).replayed,true,'decision replay cannot create a second grant');
    assert.equal((await pool.query('SELECT count(*)::int n FROM credit_holds WHERE user_id=$1',[p.id])).rows[0].n,0,
      'approval is not an execution reservation');
    assert.equal((await pool.query('SELECT balance FROM credit_accounts WHERE id=$1',[p.account_id])).rows[0].balance,'0',
      'budget approval creates no money');
  });
  await t.test('duplicate approvals cannot multiply a pool ceiling and metadata is immutable',async()=>{
    const second=await funding.proposeFundingBudget(pool,ctx(planner),draft());
    await reject(funding.decideFundingBudget(pool,ctx(owner),{budgetId:second.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'}),
      'pool_already_has_active_budget','multiple proposals cannot multiply the active pool ceiling');
    await assert.rejects(pool.query('UPDATE workforce_funding_budgets SET maximum_micro=maximum_micro+1 WHERE id=$1',[proposed.id]),
      {code:'23514'},'approved budget cannot be widened in place');
    await assert.rejects(pool.query('DELETE FROM workforce_funding_budgets WHERE id=$1',[proposed.id]),{code:'23514'},'budget decisions are retained');
    await assert.rejects(pool.query(`INSERT INTO workforce_funding_budgets
      (pool_id,proposed_by_user_id,spender_user_id,client_id,operation_id,request_hash,terms_hash,maximum_micro,per_run_micro,purpose,price_version,state,decided_by_user_id,decision_operation_id,decided_at)
      SELECT pool_id,proposed_by_user_id,spender_user_id,client_id,$2,request_hash,terms_hash,maximum_micro,per_run_micro,purpose,price_version,'rejected',$3,$4,now()
      FROM workforce_funding_budgets WHERE id=$1`,[proposed.id,randomUUID(),owner,randomUUID()]),{code:'23514'},
      'database refuses a pre-decided proposal');
    await assert.rejects(pool.query(`INSERT INTO workforce_funding_budgets
      (pool_id,proposed_by_user_id,spender_user_id,client_id,operation_id,request_hash,terms_hash,maximum_micro,per_run_micro,purpose,price_version)
      SELECT pool_id,proposed_by_user_id,spender_user_id,client_id,$2,request_hash,terms_hash,10001,per_run_micro,purpose,price_version
      FROM workforce_funding_budgets WHERE id=$1`,[proposed.id,randomUUID()]),{code:'23514'},
      'database independently refuses a raised contributor ceiling');
    await assert.rejects(pool.query(`UPDATE workforce_funding_budgets SET state='approved',revision=revision+1,
      decided_by_user_id=proposed_by_user_id,decision_operation_id=$2,decided_at=now() WHERE id=$1`,[second.id,randomUUID()]),
      {code:'23514'},'database refuses self-approved budgets independently');
  });
  await t.test('legacy unpriced proposals stay retained but cannot gain spending approval',async()=>{
    const c=await funding.createFundingCampaign(pool,ctx(owner),{operationId:randomUUID(),projectId:project.id,
      beneficiary:'Legacy price',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
    const m=await funding.createFundingMilestone(pool,ctx(owner),{campaignId:c.id,key:'legacy',title:'Legacy',criteria:['Review'],thresholdMicro:'1000',budgetMaxMicro:'10000'});
    await funding.openFundingCampaign(pool,ctx(owner),{campaignId:c.id});
    const offer=await funding.readFundingOffer(pool,ctx(owner),{campaignId:c.id,milestoneId:m.id});
    const isolated=(await pool.query('SELECT id FROM workforce_funding_pools WHERE milestone_id=$1',[m.id])).rows[0].id;
    const source=await funding.proposeFundingBudget(pool,ctx(planner),draft({poolId:isolated,termsHash:offer.consentHash}));
    const legacy=(await pool.query(`INSERT INTO workforce_funding_budgets
      (pool_id,proposed_by_user_id,spender_user_id,client_id,operation_id,request_hash,terms_hash,maximum_micro,per_run_micro,purpose,price_version)
      SELECT pool_id,proposed_by_user_id,spender_user_id,client_id,$2,request_hash,terms_hash,maximum_micro,per_run_micro,purpose,'legacy-label'
      FROM workforce_funding_budgets WHERE id=$1 RETURNING id`,[source.id,randomUUID()])).rows[0];
    await reject(funding.decideFundingBudget(pool,ctx(owner),{budgetId:legacy.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'}),
      'funding_price_unpinned','legacy price labels cannot authorize new spend');
    const refused=await funding.decideFundingBudget(pool,ctx(owner),{budgetId:legacy.id,operationId:randomUUID(),decision:'rejected',expectedRevision:'1'});
    assert.equal(refused.state,'rejected','unpriced legacy proposals can still be resolved without inventing a tariff');
  });
  await t.test('an approver cannot grant to themselves through an owned agent',async()=>{
    const bot=await makeUser();
    await pool.query("INSERT INTO agent_identities(user_id,owner_user_id,agent_role,agent_origin) VALUES($1,$2,'other','budget-test')",[bot,owner]);
    const c=await funding.createFundingCampaign(pool,ctx(owner),{operationId:randomUUID(),projectId:project.id,
      beneficiary:'Independent agent check',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
    const m=await funding.createFundingMilestone(pool,ctx(owner),{campaignId:c.id,key:'independent',title:'Independent',criteria:['Review'],thresholdMicro:'1000',budgetMaxMicro:'10000'});
    await funding.openFundingCampaign(pool,ctx(owner),{campaignId:c.id});
    const terms=await funding.readFundingOffer(pool,ctx(owner),{campaignId:c.id,milestoneId:m.id});
    const isolated=(await pool.query('SELECT id FROM workforce_funding_pools WHERE milestone_id=$1',[m.id])).rows[0].id;
    const b=await funding.proposeFundingBudget(pool,ctx(planner),draft({spenderUserId:bot,poolId:isolated,termsHash:terms.consentHash}));
    await reject(funding.decideFundingBudget(pool,ctx(owner),{budgetId:b.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'}),
      'independent_budget_approval_required','an owner cannot approve spending by their own agent');
  });
  await t.test('the HTTP budget commands bind the actor, session, scope and retained decision',async()=>{
    const express=(await import('express')).default;
    const {createRequire}=await import('node:module');
    const {generateKeyPairSync,randomBytes}=await import('node:crypto');
    const jwt=createRequire(new URL('../src/server/package.json',import.meta.url))('jsonwebtoken');
    const {jwkThumbprint,accessTokenHash}=await import('../src/server/utils/dpop.js');
    const {issuer}=await import('../src/server/config/hosts.js');
    const {getSigningKey}=await import('../src/server/utils/oidcProvider.js');
    process.env.JWT_SECRET=randomBytes(32).toString('hex');
    const {default:router}=await import('../src/server/routes/workforceRoutes.js');
    const signer=await getSigningKey(pool),key=generateKeyPairSync('ec',{namedCurve:'P-256'});
    const jwk=key.publicKey.export({format:'jwk'}),jkt=jwkThumbprint(jwk),now=Math.floor(Date.now()/1000),sessions=new Map();
    for(const actor of [owner,planner,spender,other]) {
      const sid=randomUUID();sessions.set(actor,sid);
      await pool.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch) VALUES($1,0) ON CONFLICT DO NOTHING',[actor]);
      await pool.query(`INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at)
        VALUES($1,$2,0,to_timestamp($3),$4,now()+interval '1 hour')`,[sid,actor,now,jkt]);
    }
    const app=express();app.use((req,_res,next)=>{req.db=pool;next();});app.use('/api/workforce',router);
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
    const call=async(path,body,{actor=owner,scope='openid workforce:read workforce:manage ledger:spend',authTime=now,proof=true}={})=>{
      const token=jwt.sign({sub:actor,sid:sessions.get(actor),auth_epoch:0,auth_time:authTime,client_id:'xeno-agent-interface',scope,typ:'at+jwt',cnf:{jkt}},
        signer.privatePem,{algorithm:signer.alg,keyid:signer.kid,audience:'xeno-api',expiresIn:'5m',header:{typ:'at+jwt'}});
      const full='/api/workforce/funding'+path,headers={'content-type':'application/json',authorization:`DPoP ${token}`};
      if(proof)headers.dpop=jwt.sign({jti:randomUUID(),htm:'POST',htu:issuer()+full,ath:accessTokenHash(token),iat:now},
        key.privateKey,{algorithm:'ES256',header:{typ:'dpop+jwt',jwk}});
      const r=await fetch(`http://127.0.0.1:${server.address().port}${full}`,{method:'POST',headers,body:JSON.stringify(body)});
      return {status:r.status,body:await r.json().catch(()=>null),cache:r.headers.get('cache-control')};
    };
    const request=draft(),config={scope:'openid workforce:read workforce:manage'};
    const quote=await call('/budgets/price',{poolId:p.id,model:price.model},{actor:planner});
    assert.deepEqual([quote.status,quote.body?.result],[200,price],'HTTP price preview exposes an identity without internal rates');
    assert.equal((await call('/budgets/price',{poolId:p.id,model:price.model},{actor:other})).status,404,
      'price preview does not disclose an unreadable pool');
    assert.equal((await call('/budgets',{...request,priceVersion:'old-price'},{actor:planner})).status,409,
      'HTTP refuses stale tariff consent');
    const made=await call('/budgets',request,{actor:planner,...config});
    assert.equal(made.status,200,`HTTP budget proposal is mounted: ${JSON.stringify(made.body)}`);
    assert.equal(made.body.result.state,'proposed','HTTP planning grants no spending authority');
    assert.equal((await call('/budgets',request,{actor:planner})).body.result.id,made.body.result.id,'HTTP retry preserves proposal identity');
    assert.equal((await call('/budgets',{...draft(),actorUserId:owner},{actor:planner})).status,400,'HTTP cannot inject a budget actor');
    assert.equal((await call('/budgets',draft(),{actor:planner,authTime:now-3600})).status,401,'HTTP budget planning needs recent authentication');
    assert.equal((await call('/budgets',draft(),{actor:planner,proof:false})).status,401,'HTTP budgets require sender proof');
    const decision={budgetId:made.body.result.id,operationId:randomUUID(),decision:'rejected',expectedRevision:'1'};
    assert.equal((await call('/budgets/decide',decision,config)).status,403,'HTTP budget decision requires separate spending scope');
    assert.equal((await call('/budgets/decide',decision,{authTime:now-3600})).status,401,'HTTP budget decision needs recent authentication');
    assert.equal((await call('/budgets/decide',decision,{actor:planner})).status,403,'HTTP refuses planner self-approval');
    const rejected=await call('/budgets/decide',decision);
    assert.deepEqual([rejected.status,rejected.body.result?.state],[200,'rejected'],'HTTP decision reaches the durable budget');
    assert.equal((await call('/budgets/decide',decision)).body.result.replayed,true,'HTTP decision replay is durable');
    const read=await call('/budgets/read',{budgetId:decision.budgetId},{actor:spender});
    assert.deepEqual([read.status,read.body.result?.decidedByUserId,read.cache],[200,owner,'no-store'],'HTTP reader sees sanitized retained decision');
    assert.equal((await call('/budgets/read',{budgetId:decision.budgetId},{actor:other})).status,404,'HTTP outsider cannot read a decision');
    assert.equal((await call('/budgets/revoke',{budgetId:proposed.id,expectedRevision:'2'},config)).status,403,
      'HTTP revocation requires separate spending scope');
    assert.equal((await call('/budgets/revoke',{budgetId:proposed.id,expectedRevision:'2'},{authTime:now-3600})).status,401,
      'HTTP revocation needs recent authentication');
    // Revoke a second pool's accepted budget, leaving the first for the archived-project proof.
    const botBudget=(await pool.query('SELECT * FROM workforce_funding_budgets WHERE proposed_by_user_id=$1 AND spender_user_id<>$2',[planner,spender])).rows[0];
    const accepted=await call('/budgets/decide',{budgetId:botBudget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'},{actor:other});
    assert.equal(accepted.status,404,'an outsider cannot approve even an independent spender');
    await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'owner','user',$2)`,[project.id,other]);
    const approve=await call('/budgets/decide',{budgetId:botBudget.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'},{actor:other});
    assert.deepEqual([approve.status,approve.body.result?.state],[200,'approved'],'HTTP independent approval is reachable');
    const revoked=await call('/budgets/revoke',{budgetId:botBudget.id,expectedRevision:'2'});
    assert.deepEqual([revoked.status,revoked.body.result?.state],[200,'revoked'],'HTTP budget revocation is mounted and durable');
    await pool.query('DELETE FROM oauth_session_state WHERE sid=$1',[sessions.get(planner)]);
    assert.equal((await call('/budgets',draft(),{actor:planner})).status,401,'revoked sessions cannot propose budget authority');
  });
  await t.test('concurrent approvals serialize and a populated rollback preserves decisions',async()=>{
    const c=await funding.createFundingCampaign(pool,ctx(owner),{operationId:randomUUID(),projectId:project.id,
      beneficiary:'Approval race',cancellationTerms:'Cancel.',refundTerms:'Original expiry.',deliverableLicense:'MIT'});
    const m=await funding.createFundingMilestone(pool,ctx(owner),{campaignId:c.id,key:'race',title:'Race',criteria:['Review'],thresholdMicro:'1000',budgetMaxMicro:'10000'});
    await funding.openFundingCampaign(pool,ctx(owner),{campaignId:c.id});
    const terms=await funding.readFundingOffer(pool,ctx(owner),{campaignId:c.id,milestoneId:m.id});
    const racePool=(await pool.query('SELECT id FROM workforce_funding_pools WHERE milestone_id=$1',[m.id])).rows[0].id;
    const request=draft({poolId:racePool,termsHash:terms.consentHash});
    const replay=await Promise.all(Array.from({length:3},()=>funding.proposeFundingBudget(pool,ctx(planner),request)));
    assert.equal(new Set(replay.map(r=>r.id)).size,1,'concurrent proposal retry creates exactly one identity');
    const second=await funding.proposeFundingBudget(pool,ctx(planner),draft({poolId:racePool,termsHash:terms.consentHash}));
    const contenders=[replay[0],second].map(b=>({budgetId:b.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'}));
    const results=await Promise.allSettled(contenders.map(d=>funding.decideFundingBudget(pool,ctx(owner),d)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1,'concurrent decisions cannot multiply the pool ceiling');
    assert.equal(results.find(r=>r.status==='rejected').reason.details.reason,'pool_already_has_active_budget');
    const approved=results.find(r=>r.status==='fulfilled').value;
    await reject(funding.revokeFundingBudget(pool,ctx(owner),{budgetId:approved.id,expectedRevision:'1'}),'budget_revision_changed',
      'stale revocation cannot override a later budget revision');
    const before=(await pool.query('SELECT * FROM workforce_funding_budgets ORDER BY id')).rows;
    await assert.rejects(pool.query(down),{code:'23514'},'populated budget rollback refuses retained decisions');
    assert.deepEqual((await pool.query('SELECT * FROM workforce_funding_budgets ORDER BY id')).rows,before,
      'failed rollback leaves every decision intact');
  });
  await t.test('management authority is checked again after revocation',async()=>{
    await pool.query("DELETE FROM relationship_tuples WHERE object_type='project' AND object_id=$1 AND subject_id=$2",[project.id,planner]);
    await reject(funding.proposeFundingBudget(pool,ctx(planner),draft()),'project_not_found','revoked planners cannot propose more spending');
    assert.equal((await funding.readFundingBudget(pool,ctx(owner),{budgetId:proposed.id})).id,proposed.id,'authorized readers retain the decision history');
    await funding.setFundingCampaignStatus(pool,ctx(owner),{campaignId:campaign.id,status:'closed',expectedRevision:'2'});
    assert.equal((await funding.readFundingBudget(pool,ctx(owner),{budgetId:proposed.id})).state,'approved',
      'closed campaigns retain the original approval');
    await pool.query('UPDATE chat_projects SET is_archived=true WHERE id=$1',[project.id]);
    assert.equal((await funding.readFundingBudget(pool,ctx(owner),{budgetId:proposed.id})
      .catch(e=>assert.fail(`archived projects retain authorized decision history: ${e.message}`))).state,'approved',
      'archived projects retain authorized decision history');
    await reject(funding.proposeFundingBudget(pool,ctx(owner),draft()),'project_not_found','archiving blocks new budget authority');
    const revoked=await funding.revokeFundingBudget(pool,ctx(owner),{budgetId:proposed.id,expectedRevision:'2'})
      .catch(e=>assert.fail(`closing a campaign does not prevent revoking its budget: ${e.message}`));
    assert.equal(revoked.state,'revoked','closing a campaign does not prevent revoking its budget');
    assert.equal((await funding.revokeFundingBudget(pool,ctx(owner),{budgetId:proposed.id,expectedRevision:'2'})).replayed,true,
      'budget revocation is idempotent');
    assert.equal((await funding.readFundingBudget(pool,ctx(owner),{budgetId:proposed.id})).decidedByUserId,owner,
      'closed campaigns retain budget decision history');
  });
});
