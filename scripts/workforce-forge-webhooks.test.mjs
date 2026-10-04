// FORGE-05 against real PostgreSQL: webhooks authenticate,
// deduplicate durably and reconcile in sequence; outbound creates
// and merges resolve by stable reference after ambiguity; uninstall,
// suspension and revocation stop privileged calls and mark bindings.
//
// PROVEN: forged deliveries refuse while signed ones apply;
// redelivery replays the stored outcome and body-swaps conflict;
// a skipped sequence holds with its gap until the fill arrives and
// cascades in order, and late redeliveries report stale; outbound
// references begin once, look up unknown, then resolve confirmed or
// failed; suspension by webhook stops minting and verification and
// marks the binding until an authorized unsuspend restores both;
// repository revocation poisons scoped tokens; uninstall is terminal
// for standing, calls and bindings alike.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {deriveWebhookSecret,signWebhookBody,receiveWebhook,readWebhookDeliveries,
 beginOutboundOp,resolveOutboundOp,lookupOutboundOp,setInstallationStanding,
 revokeRepositoryAccess}=await import('../src/server/services/forgeWebhooks.js');
const {approveGithubApp,registerInstallation,mintInstallationToken,verifyInstallationToken,
 recordInstallationAction}=await import('../src/server/services/forgeGithubApp.js');
const {bindRepository}=await import('../src/server/services/forgeAdapter.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('FORGE-05: authenticated ordered webhooks, stable outbound refs, standing cascades',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`f5-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query(
  `INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id`,
  [x,x+'@example.test'])).rows[0].id;};
 const owner=await user('owner'),stranger=await user('stranger');
 const project=(await pool.query('INSERT INTO chat_projects(user_id,owner_user_id,name) VALUES($1,$1,$2) RETURNING id',[owner,'Atlas'])).rows[0].id;
 const app=`app-${marker}`,inst=`inst-${marker}`,repoA=`a-${marker}`,repoB=`b-${marker}`;
 await approveGithubApp(pool,{appId:app,name:'Atlas App',actorUserId:owner,projectId:project});
 await registerInstallation(pool,{appId:app,installationId:inst,account:'octo',
  permissions:{contents:'read'},actorUserId:owner,projectId:project});
 const binding=await bindRepository(pool,{projectId:project,actorUserId:owner,provider:'local',
  remoteId:`local:1-${marker}`,installationRef:inst});
 const secret=deriveWebhookSecret(inst);
 const send=(deliveryId,seq,event,bodyObj,signature=null)=>{
  const rawBody=JSON.stringify(bodyObj);
  return receiveWebhook(pool,{installationId:inst,deliveryId:`${marker}-${deliveryId}`,seq,event,rawBody,
   signature:signature??signWebhookBody(secret,rawBody)});
 };
 await assert.rejects(send('d0',1,'push',{n:0},'sha256:'+'0'.repeat(64)),
  e=>/webhook_unauthorized/.test(e.message),'a forged delivery refuses');
 const first=await send('d1',1,'push',{n:1});
 assert.equal(first.applied,true,'the signed delivery applies');
 const replay=await send('d1',1,'push',{n:1});
 assert.equal(replay.duplicate,true,'redelivery replays');
 assert.deepEqual(replay.outcome,first.outcome,'the replay returns the stored outcome');
 await assert.rejects(send('d1',1,'push',{n:999}),e=>/webhook_delivery_conflict/.test(e.message),
  'a body-swapped redelivery conflicts');
 const held=await send('d3',3,'push',{n:3});
 assert.equal(held.held,true,'the skipped sequence holds');
 assert.deepEqual([held.gapFrom,held.gapTo],[2,2],'the hold names its gap');
 const filled=await send('d2',2,'push',{n:2});
 assert.equal(filled.applied,true,'the fill applies');
 assert.deepEqual(filled.caughtUp,[3],'the fill cascades in order');
 assert.deepEqual((await readWebhookDeliveries(pool,inst)).map(d=>d.state),
  ['applied','applied','applied'],'every delivery ends applied');
 assert.deepEqual(await send('dx',1,'push',{n:1}),{stale:true,seq:1},'a late redelivery reports stale');
 const op1=await beginOutboundOp(pool,{externalRef:`op-${marker}-1`,installationId:inst,op:'merge'});
 assert.equal(op1.status,'unknown','the outbound op begins unknown');
 const op1b=await beginOutboundOp(pool,{externalRef:`op-${marker}-1`,installationId:inst,op:'merge'});
 assert.equal(op1b.status,'unknown','re-beginning never duplicates');
 assert.equal((await lookupOutboundOp(pool,`op-${marker}-1`)).status,'unknown','ambiguity reads back');
 await resolveOutboundOp(pool,{externalRef:`op-${marker}-1`,status:'confirmed',result:{sha:'abc'}});
 assert.equal((await lookupOutboundOp(pool,`op-${marker}-1`)).status,'confirmed','the lookup resolves');
 await beginOutboundOp(pool,{externalRef:`op-${marker}-2`,installationId:inst,op:'create'});
 await resolveOutboundOp(pool,{externalRef:`op-${marker}-2`,status:'failed',result:{code:500}});
 assert.equal((await lookupOutboundOp(pool,`op-${marker}-2`)).status,'failed','failures resolve too');
 const token=await mintInstallationToken(pool,{installationId:inst,actorUserId:owner,forUserId:owner,
  repositories:[repoA,repoB],permissions:{contents:'read'}});
 const suspended=await send('d4',4,'installation.suspended',{action:'suspended'});
 assert.equal(suspended.outcome.standing,'suspended','the webhook suspends the installation');
 const marked=(await pool.query(`SELECT status, unavailable_reason FROM forge_bindings WHERE id=$1`,[binding.id])).rows[0];
 assert.equal(marked.status,'unavailable','suspension marks the binding');
 assert.equal(marked.unavailable_reason,'installation_suspended','the mark names its cause');
 await assert.rejects(mintInstallationToken(pool,{installationId:inst,actorUserId:owner,forUserId:owner,
  repositories:[repoA],permissions:{contents:'read'}}),e=>/installation_suspended/.test(e.message),
  'suspension stops minting');
 await assert.rejects(verifyInstallationToken(pool,token.token),e=>/installation_suspended/.test(e.message),
  'suspension stops verification');
 await assert.rejects(setInstallationStanding(pool,{installationId:inst,standing:'active',
  actorUserId:stranger,projectId:project}),e=>/standing_not_authorized/.test(e.message),
  'a stranger restores nothing');
 await setInstallationStanding(pool,{installationId:inst,standing:'active',actorUserId:owner,projectId:project});
 assert.equal((await pool.query(`SELECT status FROM forge_bindings WHERE id=$1`,[binding.id])).rows[0].status,
  'available','unsuspend restores the binding');
 assert.ok(await verifyInstallationToken(pool,token.token),'verification resumes');
 await assert.rejects(revokeRepositoryAccess(pool,{installationId:inst,repository:repoA,
  actorUserId:stranger,projectId:project}),e=>/revocation_not_authorized/.test(e.message),
  'a stranger revokes nothing');
 await revokeRepositoryAccess(pool,{installationId:inst,repository:repoA,actorUserId:owner,projectId:project});
 await assert.rejects(recordInstallationAction(pool,{token:token.token,action:'read',
  target:`${repoA}@r1`,repository:repoA}),e=>/token_scope_revoked/.test(e.message),
  'revocation poisons the scoped token');
 const uninstalled=await send('d5',5,'installation.deleted',{action:'deleted'});
 assert.equal(uninstalled.outcome.standing,'uninstalled','the webhook uninstalls');
 await assert.rejects(setInstallationStanding(pool,{installationId:inst,standing:'active',
  actorUserId:owner,projectId:project}),e=>/uninstalled_terminal/.test(e.message),'uninstall is terminal');
 await assert.rejects(mintInstallationToken(pool,{installationId:inst,actorUserId:owner,forUserId:owner,
  repositories:[repoB],permissions:{contents:'read'}}),e=>/installation_uninstalled/.test(e.message),
  'uninstall stops minting');
 assert.equal((await pool.query(`SELECT unavailable_reason FROM forge_bindings WHERE id=$1`,[binding.id])).rows[0].unavailable_reason,
  'installation_uninstalled','uninstall marks the binding');
});
