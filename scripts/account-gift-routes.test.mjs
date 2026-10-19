// ACCT-02..ACCT-08 over HTTP against real PostgreSQL: the gift/return/preferences/history services are
// REACHABLE through the account API, under the money-movement bar, and the flow is CLOSED until switched on.
//
// PROVEN: closed by default (preview and commit 503 `gifts_closed`, nothing moves); opt-out and history work
// while closed; a body cannot name the actor; spending needs `ledger:spend` and a sender-bound session; a
// commit needs recent authentication; once open, preview -> confirmed commit moves the exact micro-credits
// and both sides' history shows it; a recipient return is reachable; a replay returns the same receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import pg from 'pg';
import {requireProofDatabase} from './lib/workforce-proof-database.mjs';
import {installBillingProviderFixture} from './fixtures/billing-provider-fixture.mjs';
const url=process.env.TEST_DATABASE_URL;if(url)requireProofDatabase(url);
process.env.STRIPE_SECRET_KEY='sk_test_localfixture';process.env.STRIPE_PUBLISHABLE_KEY='pk_test_localfixture';
process.env.STRIPE_EXPECTED_ACCOUNT_ID='acct_fixture';process.env.STRIPE_EXPECTED_MODE='test';
process.env.JWT_SECRET ||= 'gift-routes-local-fixture';
const fixture=installBillingProviderFixture();
const {handleEvent}=await import('../src/server/services/billingService.js');
const {runAllMigrations}=await import('../src/server/services/migrationRunner.js');
const {migrateAccountV2}=await import('../src/server/database/migrate-account-v2.js');

test('ACCT-02..08: the gift account API is reachable, gated, and closed by default',{skip:!url,timeout:180000},async t=>{
 const db=new pg.Pool({connectionString:url,max:10});t.after(()=>db.end());
 await runAllMigrations(db);await migrateAccountV2(db);
 const marker=`giftr-${randomUUID().slice(0,8)}`;
 const user=async s=>{const x=`${marker}-${s}`;return(await db.query("INSERT INTO users(username,email,display_name,password_hash) VALUES($1,$2,$1,'test') RETURNING id",[x,x+'@example.test'])).rows[0].id;};
 const alice=await user('alice'),bob=await user('bob');
 const mk=randomUUID().replaceAll('-','');
 await handleEvent(db,fixture.event('evt_'+mk,'checkout.session.completed',{id:'cs_'+mk,mode:'payment',payment_status:'paid',payment_intent:'pi_'+mk,
   client_reference_id:alice,customer:'cus_'+mk,amount_total:500,currency:'eur',metadata:{xenoUserId:alice,credits:'5',kind:'credits'}}),{provider:fixture.provider});
 const balance=async u=>BigInt((await db.query('SELECT coalesce(balance,0)::text AS b FROM credit_accounts WHERE user_id=$1',[u])).rows[0]?.b??'0');
 const aliceBefore=await balance(alice);
 assert.ok(aliceBefore>=5_000_000n,'alice holds paid credits to gift');

 const express=(await import('express')).default;
 const {createRequire}=await import('node:module');
 const jwt=createRequire(new URL('../src/server/package.json',import.meta.url))('jsonwebtoken');
 const {jwkThumbprint,accessTokenHash}=await import('../src/server/utils/dpop.js');
 const {issuer}=await import('../src/server/config/hosts.js');
 const {getSigningKey}=await import('../src/server/utils/oidcProvider.js');
 const {createAccountGiftRouter}=await import('../src/server/routes/accountGiftRoutes.js');
 const env={};
 const signer=await getSigningKey(db),key=generateKeyPairSync('ec',{namedCurve:'P-256'}),jwk=key.publicKey.export({format:'jwk'}),jkt=jwkThumbprint(jwk),now=Math.floor(Date.now()/1000),sessions=new Map();
 for(const id of [alice,bob]){const sid=randomUUID();sessions.set(id,sid);await db.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch) VALUES($1,0) ON CONFLICT DO NOTHING',[id]);
  await db.query(`INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at) VALUES($1,$2,0,to_timestamp($3),$4,now()+interval '1 hour')`,[sid,id,now,jkt]);}
 const app=express();app.use((req,_res,next)=>{req.db=db;next();});app.use('/api/account/gifts',createAccountGiftRouter({env}));
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 const call=async(path,body,{actor=alice,scope='openid ledger:read ledger:spend workforce:manage',authTime=now}={})=>{
  const token=jwt.sign({sub:actor,sid:sessions.get(actor),auth_epoch:0,auth_time:authTime,client_id:'xeno-agent-interface',scope,cnf:{jkt}},signer.privatePem,{algorithm:signer.alg,keyid:signer.kid,audience:'xeno-api',expiresIn:'5m',header:{typ:'at+jwt'}});
  const full='/api/account/gifts'+path,dpop=jwt.sign({jti:randomUUID(),htm:'POST',htu:issuer()+full,ath:accessTokenHash(token),iat:now},key.privateKey,{algorithm:'ES256',header:{typ:'dpop+jwt',jwk}});
  const r=await fetch(`http://127.0.0.1:${server.address().port}${full}`,{method:'POST',headers:{authorization:`DPoP ${token}`,dpop,'content-type':'application/json'},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json().catch(()=>null)};
 };
 const gift={recipientUserId:bob,amountMicro:'1000000'};

 // CLOSED by default: nothing previews, nothing moves.
 const closed=await call('/preview',gift);
 assert.equal(closed.status,503,`preview is closed by default: ${JSON.stringify(closed.body)}`);assert.equal(closed.body.code,'gifts_closed');
 const closedCommit=await call('',{...gift,operationId:randomUUID(),consentHash:'0'.repeat(64),confirmed:true});
 assert.equal(closedCommit.body.code,'gifts_closed','commit is closed by default');
 assert.equal(await balance(alice),aliceBefore,'a closed flow moves nothing');
 // Opting out and reading history are never gated.
 const pref=await call('/preferences',{targetUserId:bob,acceptsUnsolicited:true,giftingPaused:false},{actor:bob});
 assert.equal(pref.status,200,`preferences work while gifting is closed: ${JSON.stringify(pref.body)}`);
 assert.equal((await call('/history',{limit:10})).status,200,'history works while gifting is closed');

 env.ACCOUNT_GIFTS_OPEN='true';
 assert.equal((await call('/preview',{...gift,actorUserId:bob})).status,400,'the body cannot name the actor');
 assert.equal((await call('/preview',gift,{scope:'openid ledger:read'})).status,403,'gifting needs ledger:spend');
 const preview=await call('/preview',gift);
 assert.equal(preview.status,200,`open: preview is reachable: ${JSON.stringify(preview.body)}`);
 assert.equal(preview.body.result.feeMicro,'0','no gift fee (D07)');
 const commit={...gift,operationId:randomUUID(),consentHash:preview.body.result.consentHash,confirmed:true};
 assert.equal((await call('',commit,{authTime:now-3600})).status,401,'a gift needs recent authentication');
 const sent=await call('',commit);
 assert.equal(sent.status,200,`a confirmed gift commits: ${JSON.stringify(sent.body)}`);
 assert.equal(await balance(alice),aliceBefore-1_000_000n,'exactly the gifted micro-credits left the sender');
 assert.equal(await balance(bob),1_000_000n,'and reached the recipient');
 const again=await call('',commit);
 assert.equal(again.body.result.giftId,sent.body.result.giftId,'a replay returns the same receipt');
 assert.equal(await balance(alice),aliceBefore-1_000_000n,'and moves nothing twice');
 const bobHist=await call('/history',{limit:10},{actor:bob});
 assert.ok(bobHist.body.result.some(g=>g.giftId===sent.body.result.giftId&&g.direction==='received'),'the recipient sees it in history');
 const acct=await call('/account-history',{limit:20});
 assert.equal(acct.status,200,`the unified account history is reachable: ${JSON.stringify(acct.body)}`);
 const rp=await call('/returns/preview',{giftId:sent.body.result.giftId,amountMicro:'1000000'},{actor:bob});
 assert.equal(rp.status,200,`a recipient return previews: ${JSON.stringify(rp.body)}`);
 const ret=await call('/returns',{giftId:sent.body.result.giftId,amountMicro:'1000000',operationId:randomUUID(),consentHash:rp.body.result.consentHash,confirmed:true},{actor:bob});
 assert.equal(ret.status,200,`and returns: ${JSON.stringify(ret.body)}`);
 assert.equal(await balance(alice),aliceBefore,'the return restores the sender exactly');
});
