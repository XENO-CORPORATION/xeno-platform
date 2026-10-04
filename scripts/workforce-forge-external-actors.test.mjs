// FORGE-06 against real PostgreSQL: external PRs and issues keep
// working with no XENO account; the public provider identity is
// mirrored as an external actor and never becomes a users row.
// Verified identity linking plus explicit per-scope consent gate
// XENO spending, private access and agent execution, and ownership
// is never derived from an external login.
//
// PROVEN: recording external contributors and their works leaves
// the users table untouched; unlinked actors are refused every
// privileged capability; linking requires self plus a verified
// method and proof; consent requires the linked user and is
// scope-specific; revocation closes the scope again; attribution
// always reports external provenance and unlinked logins own
// nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
const {recordExternalActor,attributeExternalWork,linkExternalIdentity,
 grantExternalConsent,revokeExternalConsent,requireExternalCapability,
 readExternalAttribution,externalOwns}=await import('../src/server/services/forgeExternalActors.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');

test('FORGE-06: external actors without accounts, verified linking, consent-gated capabilities',{skip:!url,timeout:180000},async t=>{
 const pool=new pg.Pool({connectionString:url,max:10});t.after(()=>pool.end());
 await runAllMigrations(pool);
 const marker=`f6-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await pool.query(
  `INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'t') RETURNING id`,
  [x,x+'@example.test'])).rows[0].id;};
 const users=async()=>(await pool.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n;
 const owner=await user('owner'),stranger=await user('stranger');
 const before=await users();
 const octo=await recordExternalActor(pool,{provider:'github',providerActorId:`u-${marker}`,
  login:`octo-${marker}`,displayName:'Octo Cat',profileUrl:`https://example.test/octo-${marker}`});
 const redo=await recordExternalActor(pool,{provider:'github',providerActorId:`u-${marker}`,
  login:`octo-${marker}`});
 assert.equal(redo.id,octo.id,'re-recording the same provider identity never duplicates');
 const pr=await attributeExternalWork(pool,{actorId:octo.id,kind:'pull_request',ref:`repo#1-${marker}`});
 assert.equal(pr.recorded,true,'the external pull request records without an account');
 await attributeExternalWork(pool,{actorId:octo.id,kind:'issue',ref:`repo#2-${marker}`});
 assert.equal(await users(),before,'no billable user is auto-created');
 await assert.rejects(requireExternalCapability(pool,{actorId:octo.id,scope:'spending'}),
  e=>/external_unlinked/.test(e.message),'unlinked spending refuses');
 await assert.rejects(requireExternalCapability(pool,{actorId:octo.id,scope:'private_access'}),
  e=>/external_unlinked/.test(e.message),'unlinked private access refuses');
 await assert.rejects(requireExternalCapability(pool,{actorId:octo.id,scope:'agent_execution'}),
  e=>/external_unlinked/.test(e.message),'unlinked agent execution refuses');
 await assert.rejects(linkExternalIdentity(pool,{actorId:octo.id,userId:owner,actorUserId:stranger,
  method:'oauth',proofRef:`proof-${marker}`}),e=>/external_link_not_self/.test(e.message),
  'linking by someone else refuses');
 await assert.rejects(linkExternalIdentity(pool,{actorId:octo.id,userId:owner,actorUserId:owner,
  method:'trust-me',proofRef:`proof-${marker}`}),e=>/external_link_unverified/.test(e.message),
  'linking by an unknown method refuses');
 await assert.rejects(linkExternalIdentity(pool,{actorId:octo.id,userId:owner,actorUserId:owner,
  method:'oauth',proofRef:'  '}),e=>/external_link_unverified/.test(e.message),
  'linking without proof refuses');
 const solo=await recordExternalActor(pool,{provider:'github',providerActorId:`solo-${marker}`,
  login:`solo-${marker}`});
 await assert.rejects(grantExternalConsent(pool,{actorId:solo.id,scope:'spending',grantedByUserId:owner}),
  e=>/external_unlinked/.test(e.message),'consent on an unlinked actor refuses');
 const linked=await linkExternalIdentity(pool,{actorId:octo.id,userId:owner,actorUserId:owner,
  method:'oauth',proofRef:`proof-${marker}`});
 assert.equal(linked.verified_link,true,'verified self-linking records');
 await assert.rejects(linkExternalIdentity(pool,{actorId:octo.id,userId:stranger,actorUserId:stranger,
  method:'oauth',proofRef:`proof2-${marker}`}),e=>/external_link_exists/.test(e.message),
  'a second link refuses');
 await assert.rejects(grantExternalConsent(pool,{actorId:octo.id,scope:'spending',grantedByUserId:stranger}),
  e=>/external_consent_not_self/.test(e.message),'consent by someone else refuses');
 await assert.rejects(requireExternalCapability(pool,{actorId:octo.id,scope:'spending'}),
  e=>/external_consent_missing/.test(e.message),'linking alone never enables spending');
 await grantExternalConsent(pool,{actorId:octo.id,scope:'spending',grantedByUserId:owner});
 const spend=await requireExternalCapability(pool,{actorId:octo.id,scope:'spending'});
 assert.equal(spend.userId,owner,'explicit spending consent enables spending');
 await assert.rejects(requireExternalCapability(pool,{actorId:octo.id,scope:'private_access'}),
  e=>/external_consent_missing/.test(e.message),'spending consent never implies private access');
 await grantExternalConsent(pool,{actorId:octo.id,scope:'private_access',grantedByUserId:owner});
 assert.equal((await requireExternalCapability(pool,{actorId:octo.id,scope:'private_access'})).userId,
  owner,'explicit private-access consent enables private access');
 await assert.rejects(requireExternalCapability(pool,{actorId:octo.id,scope:'agent_execution'}),
  e=>/external_consent_missing/.test(e.message),'agent execution stays closed without its consent');
 await revokeExternalConsent(pool,{actorId:octo.id,scope:'spending',revokedByUserId:owner});
 await assert.rejects(requireExternalCapability(pool,{actorId:octo.id,scope:'spending'}),
  e=>/external_consent_missing/.test(e.message),'revocation closes spending again');
 await assert.rejects(revokeExternalConsent(pool,{actorId:octo.id,scope:'spending',revokedByUserId:owner}),
  e=>/external_consent_missing/.test(e.message),'revoking a closed scope reports missing');
 const unattributed=await readExternalAttribution(pool,solo.id);
 assert.equal(unattributed.kind,'external','the unlinked actor reports external provenance');
 assert.equal(unattributed.userId,null,'the unlinked actor reports no user');
 assert.equal(externalOwns(unattributed,owner),false,'an unlinked login owns nothing');
 assert.equal(externalOwns(unattributed,stranger),false,'an unlinked login owns nothing for anyone');
 const attributed=await readExternalAttribution(pool,octo.id);
 assert.equal(attributed.kind,'linked','the linked actor reports its link');
 assert.equal(attributed.userId,owner,'the linked actor names its user');
 assert.deepEqual(attributed.works.map(w=>w.kind).sort(),['issue','pull_request'],
  'the attribution keeps both external works');
 assert.equal(externalOwns(attributed,stranger),false,'a linked login owns nothing belonging to others');
 assert.equal(externalOwns(attributed,owner),true,'a linked login owns only what its user owns');
});
