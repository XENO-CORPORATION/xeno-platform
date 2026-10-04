// FORGE-03 against real PostgreSQL: GitHub through approved Apps
// with minimum permissions and short-lived scoped tokens; maintainer
// credentials never reach outside execution; installation action and
// human/agent attribution stay separate and auditable.
//
// PROVEN: App approval needs maintainer authority and gates
// installation; permissions above the minimum refuse at install and
// at mint; tokens cap at an hour, scope to repositories, and refuse
// unknown, expired and out-of-scope use; agent execution receives
// installation tokens only — maintainer credential kinds refuse, as
// do non-agent subjects; every installation action journals the
// installation actor apart from the attributed human or agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {approveGithubApp,registerInstallation,mintInstallationToken,requestExecutionCredentials,
 verifyInstallationToken,recordInstallationAction,readInstallationLedger}=await import('../src/server/services/forgeGithubApp.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('FORGE-03: approved Apps, least privilege, scoped tokens, separated attribution',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`f3-${randomUUID().slice(0,8)}`;
 const user=async (s,patch={})=>{const x=`${marker}-${s}`;return(await pool.query(
  `INSERT INTO users(username,email,display_name,password_hash,is_active) VALUES($1,$2,$1,'t',$3) RETURNING id`,
  [x,x+'@example.test',patch.isActive??true])).rows[0].id;};
 const owner=await user('owner'),dev=await user('dev'),bot=await user('bot');
 const stranger=await user('stranger'),frozen=await user('frozen',{isActive:false});
 await pool.query(`INSERT INTO agent_identities(user_id,owner_user_id,agent_role) VALUES($1,$2,'research')`,[bot,dev]);
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 const app=`app-${marker}`,inst=`inst-${marker}`,repo=`atlas-${marker}`;
 await assert.rejects(approveGithubApp(pool,{appId:app,name:'Atlas App',actorUserId:stranger,projectId:project}),
  e=>/app_approval_not_authorized/.test(e.message),'a stranger approves nothing');
 const approved=await approveGithubApp(pool,{appId:app,name:'Atlas App',actorUserId:owner,projectId:project});
 assert.equal(approved.approved,true,'the App approves under maintainer authority');
 await assert.rejects(registerInstallation(pool,{appId:`ghost-${marker}`,installationId:`x-${marker}`,
  account:'o',permissions:{contents:'read'},actorUserId:owner,projectId:project}),
  e=>/app_not_approved/.test(e.message),'an unapproved App installs nowhere');
 await assert.rejects(registerInstallation(pool,{appId:app,installationId:`x-${marker}`,
  account:'o',permissions:{contents:'write'},actorUserId:owner,projectId:project}),
  e=>/installation_permissions_excessive/.test(e.message),'above-minimum permissions refuse at install');
 await assert.rejects(registerInstallation(pool,{appId:app,installationId:inst,account:'o',
  permissions:{contents:'read'},actorUserId:stranger,projectId:project}),
  e=>/installation_not_authorized/.test(e.message),'a stranger registers nothing');
 const installation=await registerInstallation(pool,{appId:app,installationId:inst,account:'octo',
  permissions:{contents:'read',pull_requests:'write'},actorUserId:owner,projectId:project});
 assert.equal(installation.installation_id,inst,'the installation registers at minimum');
 await assert.rejects(registerInstallation(pool,{appId:app,installationId:inst,account:'o',
  permissions:{contents:'read'},actorUserId:owner,projectId:project}),
  e=>/installation_exists/.test(e.message),'a duplicate installation refuses');
 await assert.rejects(mintInstallationToken(pool,{installationId:inst,actorUserId:owner,forUserId:dev,
  repositories:[repo],permissions:{contents:'read'},ttlSeconds:7200}),
  e=>/token_ttl_excessive/.test(e.message),'an hour-plus token refuses');
 await assert.rejects(mintInstallationToken(pool,{installationId:inst,actorUserId:owner,forUserId:dev,
  repositories:[repo],permissions:{checks:'read'},ttlSeconds:600}),
  e=>/token_permissions_excessive/.test(e.message),'a token cannot exceed its installation');
 await assert.rejects(mintInstallationToken(pool,{installationId:inst,actorUserId:owner,forUserId:frozen,
  repositories:[repo],permissions:{contents:'read'},ttlSeconds:600}),
  e=>/token_subject_not_usable/.test(e.message),'a token needs a usable subject');
 const minted=await mintInstallationToken(pool,{installationId:inst,actorUserId:owner,forUserId:dev,
  repositories:[repo],permissions:{contents:'read'},ttlSeconds:600});
 assert.ok(minted.token.length>=64,'the token issues');
 assert.ok(new Date(minted.expiresAt)-new Date()<700000,'the token dies young');
 await assert.rejects(requestExecutionCredentials(pool,{kind:'maintainer-pat',agentUserId:bot,
  installationId:inst,actorUserId:owner,repositories:[repo],permissions:{contents:'read'}}),
  e=>/maintainer_credentials_never_leave/.test(e.message),'maintainer credentials never leave');
 await assert.rejects(requestExecutionCredentials(pool,{kind:'installation-token',agentUserId:dev,
  installationId:inst,actorUserId:owner,repositories:[repo],permissions:{contents:'read'}}),
  e=>/execution_subject_must_be_agent/.test(e.message),'execution credentials need an agent subject');
 const agentToken=await requestExecutionCredentials(pool,{kind:'installation-token',agentUserId:bot,
  installationId:inst,actorUserId:owner,repositories:[repo],permissions:{contents:'read'}});
 await assert.rejects(recordInstallationAction(pool,{token:agentToken.token,action:'read',
  target:`${repo}@r1`,repository:`other-${marker}`}),e=>/token_repository_out_of_scope/.test(e.message),
  'an out-of-scope repository refuses');
 const entry=await recordInstallationAction(pool,{token:agentToken.token,action:'read',
  target:`${repo}@r1`,repository:repo});
 assert.equal(entry.acted_as,`installation:${inst}`,'the ledger acts as the installation');
 assert.equal(String(entry.attributed_user_id),String(bot),'the ledger attributes the agent');
 assert.equal(entry.attributed_kind,'agent','the ledger keeps the agent kind');
 await recordInstallationAction(pool,{token:minted.token,action:'read',target:`${repo}@r2`,repository:repo});
 const ledger=await readInstallationLedger(pool,inst);
 assert.equal(ledger.length,2,'both actions journal');
 assert.ok(ledger.every(e=>e.actedAs===`installation:${inst}`),'every entry acts as the installation');
 assert.deepEqual(ledger.map(e=>e.attributedKind),['agent','human'],'attribution stays per-actor');
 await assert.rejects(verifyInstallationToken(pool,'0'.repeat(64)),e=>/token_unknown/.test(e.message),
  'an unknown token refuses');
 const {createHash}=await import('node:crypto');
 const staleDigest=createHash('sha256').update(minted.token).digest('hex');
 await pool.query(`UPDATE github_app_tokens SET created_at=now()-interval '2 hours',
  expires_at=now()-interval '1 second' WHERE token_digest=$1`,[staleDigest]);
 await assert.rejects(verifyInstallationToken(pool,minted.token),e=>/token_expired/.test(e.message),
  'an expired token refuses');
});
