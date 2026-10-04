// FUND-13 against real PostgreSQL: five capabilities, five people, and every cross-check.
//
// PROVEN: contribute / plan / approve / spend / refund are separate capabilities (each person is refused the
// others); no one approves a budget they proposed, will spend, or whose spender they own; no budget can
// exceed the milestone maximum contributors authorized, and a second approved budget cannot enlarge the
// first; a spend needs the NAMED spender, stays inside the per-run limit and maximum, and its approval is a
// live permission (an approver who stops being an owner stops the spending).
// AUTOMATION: an agent budget cannot be approved by the agent's owner, and an independent owner can approve it.
// The agent's own spend path -- admission as an agent principal in a workspace project, within the
// grant, with the pool paying and the agent's owner untouched -- is proven in
// workforce-funding-agent-spend.test.mjs, which cites FUND-13 alongside this file.
// Real admission, canonical reservation and service-receipt settlement proof.
// Provider-bound dispatch remains unimplemented; no complete funding requirement is cited.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash,generateKeyPairSync} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
import {installBillingProviderFixture} from './fixtures/billing-provider-fixture.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.STRIPE_SECRET_KEY='sk_test_localfixture';process.env.STRIPE_PUBLISHABLE_KEY='pk_test_localfixture';
process.env.STRIPE_EXPECTED_ACCOUNT_ID='acct_fixture';process.env.STRIPE_EXPECTED_MODE='test';
process.env.JWT_SECRET ||= 'publication-milestone-local-fixture';
const fixture=installBillingProviderFixture();
const {handleEvent}=await import('../src/server/services/billingService.js');
const funding=await import('../src/server/services/workforceFunding.js');
const {admitRun}=await import('../src/server/services/workforceRunAdmission.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');
const {createAuthorizedProject,userPrincipal}=await import('../src/server/services/chatProjectAuthority.js');

test('FUND-13: contribute, plan, approve, spend and refund are separate capabilities; no one escalates their own authority or enlarges what contributors authorized',{skip:!url,timeout:120000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const user=async()=>{const x=randomUUID();return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const owner=await user(),planner=await user(),approver=await user(),contributor=await user();
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(owner),name:'Funded admission'});
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'editor','user',$3)`,[project.id,approver,planner]);
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Runner')",[resource,owner]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,personal_owner_user_id,consented_by_user_id,consented_at,responsibility,policy)
 VALUES($1,'agent',$2,'personal',$3,$3,now(),'worker',$4) RETURNING id`,[resource,project.id,owner,{schemaVersion:1,mode:'explicit',capabilities:['files.read']}])).rows[0].id;
 const campaign=await funding.createFundingCampaign(pool,ctx(owner),{operationId:randomUUID(),projectId:project.id,beneficiary:'Delivery',cancellationTerms:'Cancel unused work.',refundTerms:'Return with original expiry.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(owner),{campaignId:campaign.id,key:'first',title:'First',criteria:['Tests'],thresholdMicro:'2000000',budgetMaxMicro:'4000000'});
 await funding.openFundingCampaign(pool,ctx(owner),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(owner),{campaignId:campaign.id,milestoneId:milestone.id});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const proposal=await funding.proposeFundingBudget(pool,ctx(planner),{operationId:randomUUID(),poolId:p.id,spenderUserId:owner,maximumMicro:'4000000',perRunMicro:'2000000',purpose:'First milestone',termsHash:offer.consentHash,...price});
 const outsider=await user(),extra=await user();
 const refused=async(promise,reasons,message)=>{try{await promise;}catch(e){const r=e.details?.reason??e.message;assert.ok(reasons.includes(r),`${message}: refused as ${r??e.message}, expected ${reasons.join('|')}`);return;}assert.fail(`${message}: was allowed`);};
 const propose=(actor,over={})=>funding.proposeFundingBudget(pool,ctx(actor),{operationId:randomUUID(),poolId:p.id,spenderUserId:owner,maximumMicro:'4000000',perRunMicro:'2000000',purpose:'Roles',termsHash:offer.consentHash,...price,...over});

 const viewer=await user();
 await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'viewer','user',$2)",[project.id,viewer]);
 // ── PLAN is its own capability: it needs the project's editor relation, and nothing else grants it.
 await refused(propose(outsider),['pool_not_found','not_found','project_not_found','funding_pool_not_found'],'a stranger cannot plan a budget');
 await refused(propose(viewer),['project_not_found'],'a viewer can read the project but cannot plan its budget');
 await refused(propose(contributor),['pool_not_found','not_found','project_not_found','funding_pool_not_found'],'contributing is not planning: a contributor has no say in the budget');
 // ── A budget can never exceed what the contributors authorized (the milestone maximum).
 await refused(propose(planner,{maximumMicro:'4000001'}),['budget_exceeds_contributor_limit'],'a planner cannot ask for more than contributors authorized');
 await refused(propose(planner,{maximumMicro:'1000000',perRunMicro:'2000000'}),['invalid_budget'],'a run limit above the budget maximum is not a budget');
 // ── APPROVE is independent: the proposer, the spender, and the spender's owner can never approve.
 const own=await propose(planner,{spenderUserId:planner});
 await refused(funding.decideFundingBudget(pool,ctx(planner),{budgetId:own.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'}),['project_not_found','pool_not_found','not_found'],'a planner (editor) cannot approve at all: approval needs the owner relation');
 const byApprover=await propose(approver,{spenderUserId:owner,purpose:'Proposed by the approver'});
 await refused(funding.decideFundingBudget(pool,ctx(approver),{budgetId:byApprover.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'}),['independent_budget_approval_required'],'an owner cannot approve a budget they proposed themselves');
 const forOwner=await propose(approver,{spenderUserId:approver});
 const spendsAsApprover=await propose(planner,{spenderUserId:approver,purpose:'Names the approver as spender'});
 await refused(funding.decideFundingBudget(pool,ctx(approver),{budgetId:spendsAsApprover.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'}),['independent_budget_approval_required'],'an owner cannot approve a budget that names them as the spender, even when someone else proposed it');
 await refused(funding.decideFundingBudget(pool,ctx(approver),{budgetId:forOwner.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'}),['independent_budget_approval_required'],'an approver cannot approve a budget that spends as themselves');
 await refused(funding.decideFundingBudget(pool,ctx(contributor),{budgetId:own.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'}),['pool_not_found','not_found','project_not_found','funding_pool_not_found'],'a contributor cannot approve');
 await refused(funding.decideFundingBudget(pool,ctx(planner),{budgetId:proposal.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'}),['project_not_found'],'an editor cannot approve: approval needs the owner relation');
 // ── AUTOMATION: an agent spends only under a budget someone ELSE approved. Its owner cannot.
 const {resolvePrincipal,createAgent}=await import('../src/server/services/agentIdentity.js');
 // The agent's owner is a project OWNER too, so only the independence rule -- not a missing relation -- can stop them.
 const short='ao'+randomUUID().slice(0,6);
 const agentOwner=(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[short,short+'@example.test'])).rows[0].id;
 await pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id) VALUES('project',$1,'owner','user',$2)",[project.id,agentOwner]);
 const made=await createAgent(pool,await resolvePrincipal(pool,agentOwner),{name:'f13',displayName:'Funding agent',agentRole:'worker',agentOrigin:'test'});
 const agentId=(await pool.query('SELECT id FROM users WHERE username=$1',[made.agent.handle])).rows[0]?.id;
 assert.ok(agentId,'fixture: the agent has a principal id');
 const forAgent=await propose(planner,{spenderUserId:agentId});
 await refused(funding.decideFundingBudget(pool,ctx(agentOwner),{budgetId:forAgent.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'}),['independent_budget_approval_required'],"an agent's owner cannot approve the agent's own budget");
 // ── Approval by an independent owner works, and a SECOND approved budget cannot silently replace or enlarge it.
 await funding.decideFundingBudget(pool,ctx(approver),{budgetId:proposal.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const bigger=await propose(planner,{maximumMicro:'4000000',perRunMicro:'4000000',purpose:'Bigger'});
 await refused(funding.decideFundingBudget(pool,ctx(approver),{budgetId:bigger.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'}),['pool_already_has_active_budget'],'an approved budget cannot be enlarged by approving another beside it');
 await refused(funding.revokeFundingBudget(pool,ctx(planner),{budgetId:proposal.id,expectedRevision:'2'}),['project_not_found'],'a planner cannot revoke the approval');
 const request=(amount='2000000',extra={})=>({operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:amount,fundingBudgetId:proposal.id},...extra});
 const reject=(promise,reason,message)=>assert.rejects(promise,e=>e.details?.reason===reason,message);
 if(!(await pool.query("SELECT to_regclass('billing_charges') AS relation")).rows[0].relation) {
  await reject(admitRun(pool,ctx(owner),request('1000000')),'pool_insufficient_eligible_funds','a new installation refuses absent paid evidence without an SQL failure');
 }
 const marker=randomUUID().replaceAll('-','');
 const s={id:'cs_'+marker,mode:'payment',payment_status:'paid',payment_intent:'pi_'+marker,client_reference_id:contributor,customer:'cus_'+marker,
 amount_total:500,currency:'eur',metadata:{xenoUserId:contributor,credits:'5',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+marker,'checkout.session.completed',s),{provider:fixture.provider});
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET enabled=true',[contributor]);
 const contribute=amountMicro=>funding.contributeFunding(pool,ctx(contributor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro,consentHash:offer.consentHash,confirmed:true});
 // Two contributions: the first is kept unspent so its contributor can take it back; the second funds the run.
 const first=await contribute('1000000');
 await contribute('3000000');
 // ── REFUND is the contributor's alone: nobody who manages, plans, approves or spends can return it.
 for (const [who,name] of [[owner,'the project owner'],[planner,'a planner'],[approver,'an approver'],[outsider,'a stranger']]) {
   await refused(funding.returnFundingContribution(pool,ctx(who),{contributionId:first.id}),['Contribution not found'],`${name} cannot return someone else's contribution`);
 }
 assert.equal((await funding.returnFundingContribution(pool,ctx(contributor),{contributionId:first.id})).state,'returned','the contributor can take back what is unspent');
 // ── SPEND is the named spender's alone, inside the approved limits.
 await refused(admitRun(pool,ctx(planner),request('1000000')),['target_not_found'],'a planner has no standing to run in the project owner personal project');
 await refused(admitRun(pool,ctx(contributor),request('1000000')),['target_not_found'],'a contributor has no standing in the project to spend its budget');
 await refused(admitRun(pool,ctx(owner),request('2000001')),['funding_run_limit'],'a run above the approved per-run limit is refused');
 const spent=await admitRun(pool,ctx(owner),request('1000000'));
 assert.equal(spent.admission.payer.kind,'project_pool','the named spender spends from the pool, within the limit');
 // ── An approval is a LIVE permission: when its approver stops being an owner, spending stops.
 await pool.query("DELETE FROM relationship_tuples WHERE object_type='project' AND object_id=$1 AND relation='owner' AND subject_id=$2",[project.id,approver]);
 await refused(admitRun(pool,ctx(owner),request('1000000')),['funding_approval_not_live'],'a spend needs its approver to still hold the owner relation');
 // ── The budget NAMES its spender. An independent owner swaps in a budget naming someone else; the project
 // owner -- who has every other standing -- is refused, because the budget is not theirs to spend.
 await funding.revokeFundingBudget(pool,ctx(agentOwner),{budgetId:proposal.id,expectedRevision:'2'});
 const forExtra=await propose(planner,{spenderUserId:extra,purpose:'Names someone else'});
 await funding.decideFundingBudget(pool,ctx(agentOwner),{budgetId:forExtra.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 await refused(admitRun(pool,ctx(owner),{...request('1000000'),budget:{ceilingMicro:'1000000',fundingBudgetId:forExtra.id}}),['funding_budget_unavailable'],'the project owner cannot spend a budget that names someone else');
 // Positive control: the refusals above are not blanket. An independent OWNER can approve an agent budget.
 await funding.revokeFundingBudget(pool,ctx(agentOwner),{budgetId:forExtra.id,expectedRevision:'2'});
 assert.equal((await funding.decideFundingBudget(pool,ctx(owner),{budgetId:forAgent.id,operationId:randomUUID(),decision:'approved',expectedRevision:'1'})).state,'approved','an owner independent of the proposer, the agent and its owner can approve');
});
