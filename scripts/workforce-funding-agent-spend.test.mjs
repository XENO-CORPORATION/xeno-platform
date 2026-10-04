// FUND-13 automation clause against real PostgreSQL: an agent itself spends under a bounded
// policy grant issued by an authorized approver.
//
// PROVEN: in a workspace project, an agent -- admitted via an accepted assignment plus a
// workspace participation, acting under its own agent principal -- spends from the pool within
// the per-run limit and maximum; it is refused over the limit, under a budget naming someone
// else, and after its approver loses the owner relation; the reservation lands on the POOL
// account, and the agent owner's personal balance carries no hold and no debit.
// SIBLING: workforce-funding-roles.test.mjs proves the human capability separation and the
// approval independence of agent budgets; this file proves the agent's own spend path.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
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
const {resolvePrincipal,createAgent}=await import('../src/server/services/agentIdentity.js');

test('FUND-13: an agent spends only under a bounded grant its approver issued; the pool pays, its owner is untouched',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);await migrateAccountV2(pool);
 const marker=`agsp-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const wsOwner=await user('wsowner'),planner=await user('planner'),approver=await user('approver'),
   contributor=await user('contributor'),agentOwner=await user('agentowner');
 const ctx=actorUserId=>({actorUserId,clientId:'xeno-agent-interface'});
 const refused=async(promise,reasons,message)=>{try{await promise;}catch(e){const r=e.details?.reason??e.message;assert.ok(reasons.includes(r),`${message}: refused as ${r??e.message}, expected ${reasons.join('|')}`);return;}assert.fail(`${message}: was allowed`);};

 // ── Workspace, workspace project, and the agent's own standing in it.
 const ws=(await pool.query('INSERT INTO workspaces(owner_user_id,name,slug) VALUES($1,$2,$2) RETURNING id',[wsOwner,marker])).rows[0].id;
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('workspace',$1,'owner','user',$2)`,[ws,wsOwner]);
 const made=await createAgent(pool,await resolvePrincipal(pool,agentOwner),{name:'f13a',displayName:'Spend agent',agentRole:'worker',agentOrigin:'test'});
 const agentId=(await pool.query('SELECT id FROM users WHERE username=$1',[made.agent.handle])).rows[0]?.id;
 assert.ok(agentId,'fixture: the agent has a principal id');
 // Agents receive exactly the explicit relation, so seeing AND acting need two direct grants.
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('workspace',$1,'viewer','agent',$2),('workspace',$1,'editor','agent',$2)`,[ws,agentId]);
 const project=await createAuthorizedProject(pool,{principal:userPrincipal(wsOwner),workspaceId:ws,name:'Agent spend'});
 assert.equal(project.workspace_id,ws,'fixture: the project belongs to the workspace');
 await pool.query(`INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)
 VALUES('project',$1,'owner','user',$2),('project',$1,'owner','user',$3),('project',$1,'editor','user',$4)`,
  [project.id,wsOwner,approver,planner]);

 // ── Agent resource, accepted assignment, workspace participation narrowing it.
 const resource=randomUUID(),hash=createHash('sha256').update(resource).digest('hex');
 await pool.query("INSERT INTO workforce_resources(id,kind,owner_user_id,name) VALUES($1,'agent',$2,'Spender')",[resource,agentOwner]);
 await pool.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,provenance)
 VALUES($1,1,$2,$3,'{}')`,[resource,{instructions:'test',requestedCapabilities:['files.read']},hash]);
 const policy={schemaVersion:1,mode:'explicit',capabilities:['files.read']};
 const rev=(await pool.query('SELECT revision FROM workforce_resources WHERE id=$1',[resource])).rows[0].revision;
 const assignment=(await pool.query(`INSERT INTO workforce_workspace_assignments(resource_id,resource_kind,workspace_id,source_owner_user_id,
 source_owner_workspace_id,resource_revision,policy,member_set_revision) VALUES($1,'agent',$2,$3,NULL,$4,$5,NULL) RETURNING id`,
  [resource,ws,agentOwner,rev,policy])).rows[0].id;
 await pool.query(`UPDATE workforce_workspace_assignments SET state='accepted', revision=revision+1, source_approved_by_user_id=$2,
 source_approved_at=clock_timestamp(), target_accepted_by_user_id=$2, accepted_at=clock_timestamp(), updated_at=clock_timestamp() WHERE id=$1`,[assignment,wsOwner]);
 const part=(await pool.query(`INSERT INTO workforce_project_participations(resource_id,resource_kind,project_id,target_kind,workspace_id,assignment_id,responsibility,policy,created_by_user_id)
 VALUES($1,'agent',$2,'workspace',$3,$4,'worker',$5,$6) RETURNING id`,[resource,project.id,ws,assignment,policy,wsOwner])).rows[0].id;

 // ── Funding: milestone, paid contribution, and a budget naming the AGENT as spender.
 const campaign=await funding.createFundingCampaign(pool,ctx(wsOwner),{operationId:randomUUID(),projectId:project.id,beneficiary:'Delivery',cancellationTerms:'Cancel unused work.',refundTerms:'Return with original expiry.',deliverableLicense:'MIT'});
 const milestone=await funding.createFundingMilestone(pool,ctx(wsOwner),{campaignId:campaign.id,key:'first',title:'First',criteria:['Tests'],thresholdMicro:'2000000',budgetMaxMicro:'4000000'});
 await funding.openFundingCampaign(pool,ctx(wsOwner),{campaignId:campaign.id});
 const offer=await funding.readFundingOffer(pool,ctx(wsOwner),{campaignId:campaign.id,milestoneId:milestone.id});
 const p=(await pool.query('SELECT * FROM workforce_funding_pools WHERE milestone_id=$1',[milestone.id])).rows[0];
 const price=await funding.readFundingPrice(pool,ctx(planner),{poolId:p.id,model:'claude-opus-5'});
 const propose=(actor,over={})=>funding.proposeFundingBudget(pool,ctx(actor),{operationId:randomUUID(),poolId:p.id,spenderUserId:agentId,maximumMicro:'4000000',perRunMicro:'2000000',purpose:'Agent spend',termsHash:offer.consentHash,...price,...over});
 const approve=(actor,budgetId)=>funding.decideFundingBudget(pool,ctx(actor),{budgetId,operationId:randomUUID(),decision:'approved',expectedRevision:'1'});
 const revoke=(actor,budgetId)=>funding.revokeFundingBudget(pool,ctx(actor),{budgetId,expectedRevision:'2'});
 const mk=randomUUID().replaceAll('-','');
 const s={id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,client_reference_id:contributor,customer:'cus_'+mk,
 amount_total:500,currency:'eur',metadata:{xenoUserId:contributor,credits:'5',kind:'credits'}};
 await handleEvent(pool,fixture.event('evt_'+mk,'checkout.session.completed',s),{provider:fixture.provider});
 await pool.query('INSERT INTO usage_credit_preferences(user_id,enabled) VALUES($1,true) ON CONFLICT(user_id) DO UPDATE SET enabled=true',[contributor]);
 await funding.contributeFunding(pool,ctx(contributor),{operationId:randomUUID(),campaignId:campaign.id,milestoneId:milestone.id,amountMicro:'4000000',consentHash:offer.consentHash,confirmed:true});
 const budget=await propose(planner);
 await approve(approver,budget.id);

 // ── The agent spends within the grant.
 const request=(amount,budgetId)=>({operationId:randomUUID(),agent:{resourceId:resource,version:1,contentHash:hash},
 target:{kind:'project',projectId:project.id,participationId:part},capabilities:['files.read'],budget:{ceilingMicro:amount,fundingBudgetId:budgetId}});
 const spent=await admitRun(pool,ctx(agentId),request('1000000',budget.id));
 assert.equal(spent.admission.payer.kind,'project_pool','the agent spends from the pool, within the limit');
 // ── The pool pays: the reservation sits on the pool account, and the agent owner carries nothing.
 const fundingRow=(await pool.query('SELECT * FROM workforce_run_funding WHERE admission_id=$1',[spent.admission.admissionId])).rows[0];
 assert.ok(fundingRow,'the spend leaves a pool funding row');
 assert.equal(fundingRow.pool_id,p.id,'the funding row names the project pool');
 assert.equal(String(fundingRow.reserved_micro),'1000000','the reservation equals the admitted ceiling');
 const hold=(await pool.query('SELECT * FROM credit_holds WHERE id=$1',[fundingRow.hold_row_id])).rows[0];
 assert.equal(hold.user_id,p.account_owner_id,'the hold sits on the pool account, not on any person');
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM credit_holds WHERE user_id=$1",[agentOwner])).rows[0].n,0,
  'the agent owner carries no hold for the run');
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM credit_transactions WHERE user_id=$1 AND type='debit'",[agentOwner])).rows[0].n,0,
  'the agent owner is never debited for the run');

 // ── Bounded means bounded: over the per-run limit is refused.
 await refused(admitRun(pool,ctx(agentId),request('2000001',budget.id)),['funding_run_limit'],'the agent cannot spend over its per-run limit');

 // ── Someone else's budget is not the agent's: it names the workspace owner instead.
 await revoke(wsOwner,budget.id);
 const other=await propose(planner,{spenderUserId:wsOwner,purpose:'Names someone else'});
 await approve(approver,other.id);
 await refused(admitRun(pool,ctx(agentId),request('1000000',other.id)),['funding_budget_unavailable'],'the agent cannot spend a budget that names someone else');

 // ── The approval is live: when its approver stops being an owner, the agent's spending stops.
 await revoke(wsOwner,other.id);
 const renewed=await propose(planner,{purpose:'Renewed for the agent'});
 await approve(approver,renewed.id);
 await pool.query("DELETE FROM relationship_tuples WHERE object_type='project' AND object_id=$1 AND relation='owner' AND subject_id=$2",[project.id,approver]);
 await refused(admitRun(pool,ctx(agentId),request('1000000',renewed.id)),['funding_approval_not_live'],'the agent cannot spend once its approver is no longer an owner');
});
