import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import express from 'express';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {authMiddleware} from '../src/server/middleware/auth.js';
import {workspaceRoutes,workspaceInviteRoutes} from '../src/server/routes/workspaceRoutes.js';
import {migrateAccountV2} from '../src/server/database/migrate-account-v2.js';
import {getSigningKey} from '../src/server/utils/oidcProvider.js';
import {accessTokenHash,jwkThumbprint} from '../src/server/utils/dpop.js';
import {deliverWorkspaceInviteBatch,startWorkspaceInviteDeliveryWorker} from '../src/server/services/workspaceInviteDelivery.js';
import {setWorkspacePlan} from '../src/server/services/billingService.js';
import {lockWorkspaceAuthority} from '../src/server/services/workspaceOperationReceipts.js';
const jwt=createRequire(new URL('../src/server/package.json',import.meta.url))('jsonwebtoken');
const url=process.env.WORKSPACE_KEY_TEST_DATABASE_URL;
if(url){const target=new URL(url);if(!['127.0.0.1','localhost'].includes(target.hostname)||target.pathname!='/workspacekeyproof')throw new Error('Only owned loopback workspacekeyproof DB allowed');}
test('membership receipts share canonical transaction authority, real HTTP/DPoP and durable mail admission',{skip:!url},async t=>{
  const schema=`membership_${crypto.randomBytes(8).toString('hex')}`,pool=new pg.Pool({connectionString:url,options:`-c search_path=${schema}`,max:10});let server;
  try {
    await pool.query(`CREATE SCHEMA "${schema}";CREATE TABLE users(id uuid PRIMARY KEY,username text,email text,display_name text,avatar_url text,created_at timestamptz DEFAULT now(),email_verified boolean DEFAULT true,is_active boolean DEFAULT true);
      CREATE TABLE credit_transactions(user_id uuid,reference_type text,reference_id text);CREATE TABLE user_sessions(id uuid PRIMARY KEY,user_id uuid,expires_at timestamptz,last_active_at timestamptz DEFAULT now());
      CREATE TABLE api_keys(id uuid PRIMARY KEY,user_id uuid,key_prefix text,key_hash text,is_active boolean,expires_at timestamptz,last_used_at timestamptz,usage_count integer DEFAULT 0);
      CREATE TABLE account_activations(user_id uuid PRIMARY KEY,method text);`);
    await migrateAccountV2(pool);
    for(const name of ['20260711120000-workspaces.sql','20260904140000-workspace-api-keys.sql','20260904200000-workspace-key-operations.sql','20260904210000-workspace-membership-operations.sql','20260904220000-workspace-operation-abandonment.sql','20260904230000-account-workspace-operations.sql'])await pool.query((await fs.readFile(new URL(`../src/server/database/migrations/${name}`,import.meta.url),'utf8')).split('-- DOWN')[0]);
    const owner=crypto.randomUUID(),admin=crypto.randomUUID(),member=crypto.randomUUID(),viewer=crypto.randomUUID(),foreignOwner=crypto.randomUUID(),ws=crypto.randomUUID(),foreign=crypto.randomUUID();
    for(const [id,name]of[[owner,'owner'],[admin,'admin'],[member,'member'],[viewer,'viewer'],[foreignOwner,'foreign']])await pool.query('INSERT INTO users(id,username,email,display_name)VALUES($1,$2,$3,$2)',[id,name,`${name}@example.test`]);
    for(const [id,user]of[[ws,owner],[foreign,foreignOwner]])await pool.query(`INSERT INTO workspaces(id,owner_user_id,workspace_type,name,slug,metadata)VALUES($1::uuid,$2,'team','Membership proof',$1::text,$3)`,[id,user,JSON.stringify({billing:{plan:'team',status:'active',seat_limit:50}})]);
    const addRole=(user,role='viewer',workspace=ws)=>pool.query("INSERT INTO relationship_tuples(object_type,object_id,relation,subject_type,subject_id)VALUES('workspace',$1,$2,'user',$3) ON CONFLICT DO NOTHING",[workspace,role,user]);
    await addRole(owner,'owner');await addRole(admin,'admin');await addRole(member,'editor');await addRole(viewer);await addRole(foreignOwner,'owner',foreign);
    const pair=crypto.generateKeyPairSync('ec',{namedCurve:'P-256'}),jwk=pair.publicKey.export({format:'jwk'}),jkt=jwkThumbprint(jwk),signing=await getSigningKey(pool);
    const mint=async({user=owner,client='xeno-post',scope='team:read team:manage',bound=true}={})=>{
      const sid=crypto.randomUUID(),authTime=Math.floor(Date.now()/1000);
      await pool.query('INSERT INTO oauth_user_auth_epochs(user_id,epoch)VALUES($1,0)ON CONFLICT DO NOTHING',[user]);
      await pool.query("INSERT INTO oauth_session_state(sid,user_id,auth_epoch,auth_time,dpop_jkt,expires_at)VALUES($1,$2,0,to_timestamp($3),$4,now()+interval '1 hour')",[sid,user,authTime,bound?jkt:null]);
      return jwt.sign({sub:user,sid,auth_epoch:0,auth_time:authTime,client_id:client,scope,typ:'at+jwt',...(bound?{cnf:{jkt}}:{})},signing.privatePem,{algorithm:signing.alg,keyid:signing.kid,audience:'xeno-api',issuer:'https://xenostudio.ai',expiresIn:'10m',header:{typ:'at+jwt'}});
    };
    const proof=(token,method,path)=>jwt.sign({jti:crypto.randomUUID(),htm:method,htu:`https://xenostudio.ai${path}`,iat:Math.floor(Date.now()/1000),ath:accessTokenHash(token)},pair.privateKey,{algorithm:'ES256',header:{typ:'dpop+jwt',jwk}});
    let dropId;const app=express();app.use(express.json());app.use((req,res,next)=>{req.db=pool;const json=res.json.bind(res);res.json=value=>{if(dropId&&dropId===value.operation?.operation_id&&req.method!=='GET'){dropId=undefined;res.socket.destroy();return res;}return json(value);};next();});app.use('/api/workspaces',authMiddleware,workspaceRoutes);app.use('/api/workspace-invites',authMiddleware,workspaceInviteRoutes);
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const token=await mint(),base=`/api/workspaces/${ws}`;
    const request=(actor,method,path,body,dp)=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{authorization:`DPoP ${actor}`,'content-type':'application/json',...(dp===null?{}:{dpop:dp??proof(actor,method,path)})},...(body?{body:JSON.stringify(body)}:{})});
    const mutate=async(method,path,body,actor=token)=>{const res=await request(actor,method,base+path,body);assert.equal(res.status,200,JSON.stringify(await res.clone().json()));return res.json();};
    const read=async(op,actor=token)=>{const res=await request(actor,'GET',`${base}/membership-operations/${op}`);assert.equal(res.status,200);return res.json();};
    let invitation;
    await t.test('eight duplicates admit one invitation, one audit and one token-free mail request',async()=>{
      const operation_id=crypto.randomUUID(),body={operation_id,email:'invitee@example.test',role:'member'};
      const results=await Promise.all(Array.from({length:8},()=>mutate('POST','/invites',body)));
      assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal(new Set(results.map(r=>r.operation.result.invite.id)).size,1);
      invitation=results[0].operation.result.invite;
      assert.equal(Number((await pool.query('SELECT count(*) FROM workspace_invite_deliveries')).rows[0].count),1);
      assert.equal(Number((await pool.query("SELECT count(*) FROM workspace_audit WHERE action='invite.create'")).rows[0].count),1);
      const secret=(await pool.query('SELECT token FROM workspace_invites WHERE id=$1',[invitation.id])).rows[0].token;
      assert.ok(!JSON.stringify(results).includes(secret));assert.ok(!JSON.stringify((await pool.query('SELECT * FROM workspace_key_operations')).rows).includes(secret));assert.ok(!JSON.stringify((await pool.query('SELECT * FROM workspace_invite_deliveries')).rows).includes(secret));
      assert.deepEqual((await read(operation_id)).operation,results[0].operation);
      assert.equal((await request(token,'POST',base+'/invites',{...body,role:'admin'})).status,409);
    });
    await t.test('different intents with one operation ID cannot both mutate',async()=>{
      const operation_id=crypto.randomUUID();const replies=await Promise.all(['admin','viewer'].map(member_role=>request(token,'PATCH',`${base}/members/${member}`,{operation_id,member_role})));
      assert.deepEqual(replies.map(r=>r.status).sort(),[200,409]);
    });
    await t.test('lost HTTP ACK after actual role commit recovers and same-role assignment retains membership',async()=>{
      const operation_id=crypto.randomUUID();dropId=operation_id;
      await assert.rejects(request(token,'PATCH',`${base}/members/${member}`,{operation_id,member_role:'member'}));
      assert.equal((await read(operation_id)).operation.result.role,'member');
      const replay=await mutate('PATCH',`/members/${member}`,{operation_id,member_role:'member'});assert.equal(replay.replayed,true);
      const next=await mutate('PATCH',`/members/${member}`,{operation_id:crypto.randomUUID(),member_role:'member'});assert.ok(!next.operation.rejection);
      assert.equal((await pool.query("SELECT count(*)::int c FROM relationship_tuples WHERE object_id=$1 AND subject_id=$2 AND relation='editor'",[ws,member])).rows[0].c,1);
    });
    await t.test('transactional rejections are durable and replay cannot later execute corrected intent',async()=>{
      const operation_id=crypto.randomUUID(),body={operation_id,member_role:'owner'};
      const first=await mutate('PATCH',`/members/${member}`,body);assert.equal(first.operation.rejection,'invalid_membership_request');
      assert.equal((await read(operation_id)).state,'rejected');assert.equal((await mutate('PATCH',`/members/${member}`,body)).replayed,true);
      assert.equal((await request(token,'PATCH',`${base}/members/${member}`,{...body,member_role:'admin'})).status,409);
      const duplicate=await mutate('POST','/invites',{operation_id:crypto.randomUUID(),email:invitation.invited_email,role:'viewer'});assert.equal(duplicate.operation.rejection,'invite_already_pending');
    });
    await t.test('resend and revoke are atomic outcomes and do not repeat delivery admission',async()=>{
      const operation_id=crypto.randomUUID(),path=`/invites/${invitation.id}/resend`;
      const first=await mutate('POST',path,{operation_id});assert.equal(first.operation.result.delivery.state,'queued');
      assert.equal((await mutate('POST',path,{operation_id})).replayed,true);
      assert.equal(Number((await pool.query('SELECT count(*) FROM workspace_invite_deliveries')).rows[0].count),2);
      const revoke=await mutate('DELETE',`/invites/${invitation.id}`,{operation_id:crypto.randomUUID()});assert.equal(revoke.operation.result.invite.status,'revoked');
      let calls=0;await deliverWorkspaceInviteBatch(pool,{send:async()=>{calls++;return{success:true};}});assert.equal(calls,0);
      assert.equal(Number((await pool.query("SELECT count(*) FROM workspace_invite_deliveries WHERE state='skipped'")).rows[0].count),2);
    });
    await t.test('post-leave actor can read only its own historical outcome, never regain mutation authority',async()=>{
      const actor=await mint({user:viewer}),operation_id=crypto.randomUUID();
      await mutate('DELETE',`/members/${viewer}`,{operation_id},actor);
      assert.equal((await read(operation_id,await mint({user:viewer}))).state,'committed');
      assert.equal((await mutate('DELETE',`/members/${viewer}`,{operation_id},actor)).replayed,true);
      assert.equal((await request(actor,'DELETE',`${base}/members/${viewer}`,{operation_id:crypto.randomUUID()})).status,403);
      assert.equal((await read(operation_id)).state,'not-observed');
      assert.equal((await read(operation_id,await mint({user:viewer,client:'xeno-hub'}))).state,'not-observed');
    });
    await t.test('owner transfer commits tuples/entity/audit together and old owner can recover without another transfer',async()=>{
      const operation_id=crypto.randomUUID();dropId=operation_id;await assert.rejects(request(token,'POST',base+'/owner-transfer',{operation_id,new_owner_user_id:admin}));
      assert.equal((await read(operation_id)).operation.result.memberId,admin);
      assert.equal((await mutate('POST','/owner-transfer',{operation_id,new_owner_user_id:admin})).replayed,true);
      assert.equal((await request(token,'POST',base+'/owner-transfer',{operation_id:crypto.randomUUID(),new_owner_user_id:member})).status,403);
      assert.equal((await pool.query('SELECT owner_user_id FROM workspaces WHERE id=$1',[ws])).rows[0].owner_user_id,admin);
      const current=await mint({user:admin});await mutate('POST','/owner-transfer',{operation_id:crypto.randomUUID(),new_owner_user_id:owner},current);
    });
    await t.test('DPoP, scope, foreign tenant and role boundaries prevent new mutations',async()=>{
      const path=base+'/invites',body={operation_id:crypto.randomUUID(),email:'blocked@example.test',role:'member'};
      assert.equal((await request(token,'POST',path,body,null)).status,401);
      assert.equal((await request(await mint({bound:false}),'POST',path,body)).status,401);
      assert.equal((await request(await mint({scope:'team:read'}),'POST',path,body)).status,403);
      assert.equal((await request(await mint({user:foreignOwner}),'POST',path,body)).status,403);
      const dp=proof(token,'POST',path);assert.equal((await request(token,'POST',path,body,dp)).status,200);assert.equal((await request(token,'POST',path,body,dp)).status,401);
    });
    await t.test('audit failure rolls back mutation, receipt and mail admission',async()=>{
      await pool.query("CREATE FUNCTION reject_member_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned audit refusal'; END $$;CREATE TRIGGER reject_member_audit BEFORE INSERT ON workspace_audit FOR EACH ROW EXECUTE FUNCTION reject_member_audit()");
      const before=Number((await pool.query('SELECT count(*) FROM workspace_invites')).rows[0].count),op=crypto.randomUUID();
      try{assert.equal((await request(token,'POST',base+'/invites',{operation_id:op,email:'rollback@example.test',role:'member'})).status,503);}finally{await pool.query('DROP TRIGGER reject_member_audit ON workspace_audit');}
      assert.equal(Number((await pool.query('SELECT count(*) FROM workspace_invites')).rows[0].count),before);assert.equal((await read(op)).state,'not-observed');
    });
    await t.test('mail claims have one dispatcher, unknown delivery never auto-retries, and stop awaits abort settlement',async()=>{
      await deliverWorkspaceInviteBatch(pool,{send:async()=>({skipped:true})});
      const mailOperation=crypto.randomUUID();await mutate('POST','/invites',{operation_id:mailOperation,email:'mail@example.test',role:'member'});
      let calls=0;await Promise.all(Array.from({length:4},()=>deliverWorkspaceInviteBatch(pool,{send:async()=>{calls++;throw new Error('provider ACK lost');}})));assert.equal(calls,1);
      await deliverWorkspaceInviteBatch(pool,{send:async()=>{calls++;return{success:true};}});assert.equal(calls,1);
      assert.equal((await read(mailOperation)).delivery.state,'unknown');
      await mutate('POST','/invites',{operation_id:crypto.randomUUID(),email:'stop@example.test',role:'member'});
      let admitted;const started=new Promise(resolve=>admitted=resolve);let settled=false;
      const worker=startWorkspaceInviteDeliveryWorker(pool,{intervalMs:10,send:async(_db,_template,_to,_data,_user,{signal})=>{admitted();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));settled=true;throw new Error('aborted');}});
      await started;await worker.stop();assert.equal(settled,true);
      assert.ok((await pool.query("SELECT count(*)::int c FROM workspace_invite_deliveries WHERE state='unknown'")).rows[0].c>=2);
    });
    await t.test('new process recovers queued delivery but never repeats a previously admitted dispatch',async()=>{
      const operation_id=crypto.randomUUID();await mutate('POST','/invites',{operation_id,email:'restart@example.test',role:'viewer'});
      const child=spawn(process.execPath,[fileURLToPath(new URL('./fixtures/workspace-invite-delivery-child.mjs',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{SYSTEMROOT:process.env.SYSTEMROOT,WORKSPACE_KEY_TEST_DATABASE_URL:url,WORKSPACE_MEMBERSHIP_TEST_SCHEMA:schema}});
      let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
      const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Owned delivery child timed out'));},10000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});
      assert.equal(code,0,stderr);const proof=JSON.parse(stdout);assert.notEqual(proof.pid,process.pid);assert.equal(proof.calls,1);let calls=proof.calls;
      assert.equal((await read(operation_id)).delivery.state,'accepted');
      const crashed=crypto.randomUUID();await mutate('POST','/invites',{operation_id:crashed,email:'crashed@example.test',role:'member'});
      const outcome=await read(crashed);await pool.query("UPDATE workspace_invite_deliveries SET state='dispatching' WHERE id=$1",[outcome.delivery.id]);
      await deliverWorkspaceInviteBatch(pool,{send:async()=>{calls++;return{success:true};}});assert.equal(calls,1);assert.equal((await read(crashed)).delivery.state,'unknown');
    });
    await t.test('lost abandonment ACK is recoverable and never admits a delayed invitation',async()=>{
      const operation_id=crypto.randomUUID(),original={action:'invite.create',email:'abandoned@example.test',role:'viewer'};
      dropId=operation_id;
      await assert.rejects(request(token,'POST',`${base}/membership-operations/${operation_id}/abandon`,{request:original}));
      const outcome=await read(operation_id);assert.equal(outcome.state,'abandoned');
      const delayed=await mutate('POST','/invites',{operation_id,email:original.email,role:original.role});
      assert.deepEqual(delayed.operation,outcome.operation);
      assert.equal((await pool.query('SELECT count(*) FROM workspace_invites WHERE invited_email=$1',[original.email])).rows[0].count,'0');
      assert.equal((await request(token,'POST',`${base}/membership-operations/${operation_id}/abandon`,{request:{...original,role:'admin'}})).status,409);
    });
    await t.test('membership race preserves committed result or immutable abandonment',async()=>{
      for(let i=0;i<5;i++){
        const operation_id=crypto.randomUUID(),email=`race-abandon-${i}@example.test`;
        const responses=await Promise.all([request(token,'POST',base+'/invites',{operation_id,email,role:'viewer'}),request(token,'POST',`${base}/membership-operations/${operation_id}/abandon`,{request:{action:'invite.create',email,role:'viewer'}})]);
        const [mutation,abandonment]=await Promise.all(responses.map(res=>res.json()));
        assert.deepEqual(mutation.operation,abandonment.operation);
        const outcome=await read(operation_id);assert.deepEqual(outcome.operation,mutation.operation);
        assert.equal((await pool.query('SELECT count(*) FROM workspace_invites WHERE invited_email=$1',[email])).rows[0].count,outcome.state==='abandoned'?'0':'1');
      }
    });
    await t.test('removed actor can abandon only its own operation identity without regaining membership',async()=>{
      const actor=await mint({user:member}),operation_id=crypto.randomUUID();
      await pool.query("DELETE FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND subject_id=$2",[ws,member]);
      const original={action:'invite.create',email:'removed-abandon@example.test',role:'viewer'};
      const result=await request(actor,'POST',`${base}/membership-operations/${operation_id}/abandon`,{request:original});assert.equal(result.status,200);
      assert.equal((await read(operation_id,actor)).state,'abandoned');assert.equal((await read(operation_id)).state,'not-observed');
      assert.equal((await request(actor,'POST',base+'/invites',{operation_id:crypto.randomUUID(),email:original.email,role:original.role})).status,403);
      assert.equal((await pool.query('SELECT count(*) FROM workspace_invites WHERE invited_email=$1',[original.email])).rows[0].count,'0');
    });
    await t.test('committed and rejected membership outcomes win over later abandonment',async()=>{
      const operation_id=crypto.randomUUID(),email='terminal-abandon@example.test',original={action:'invite.create',email,role:'viewer'};
      const committed=await mutate('POST','/invites',{operation_id,email,role:'viewer'});
      const rejectedId=crypto.randomUUID(),rejected=await mutate('POST','/invites',{operation_id:rejectedId,email,role:'viewer'});
      assert.equal(rejected.operation.rejection,'invite_already_pending');
      for(const [id,expected]of[[operation_id,committed.operation],[rejectedId,rejected.operation]]){
        const response=await request(token,'POST',`${base}/membership-operations/${id}/abandon`,{request:original});assert.equal(response.status,200);
        const result=await response.json();assert.deepEqual(result.operation,expected);assert.equal(result.replayed,true);
      }
    });
    const inviteFixture=async({seats=2,recipient=null,email,expired=false}={})=>{
      const workspace=crypto.randomUUID(),invite=crypto.randomUUID(),account=recipient??crypto.randomUUID();
      if(!recipient)await pool.query('INSERT INTO users(id,username,email,display_name)VALUES($1,$2,$3,$2)',[account,account,email??`${account}@example.test`]);
      await pool.query("INSERT INTO workspaces(id,owner_user_id,workspace_type,name,slug,metadata)VALUES($1::uuid,$2,'team','Invite race',$1::text,$3)",[workspace,owner,JSON.stringify({billing:{plan:'team',status:'active',seat_limit:seats}})]);
      await addRole(owner,'owner',workspace);
      await pool.query("INSERT INTO workspace_invites(id,workspace_id,invited_by_user_id,invited_user_id,invited_email,role,token,expires_at)VALUES($1,$2,$3,$4,$5,'editor',$6,now()+$7::interval)",[invite,workspace,owner,account,email??`${account}@example.test`,crypto.randomBytes(24).toString('hex'),expired?'-1 hour':'1 day']);
      return {workspace,invite,account,actor:await mint({user:account})};
    };
    const accepted=async(f)=>Number((await pool.query("SELECT count(*) FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND subject_id=$2",[f.workspace,f.account])).rows[0].count)>0;
    await t.test('accept and receipted revoke serialize: revoked never grants membership',async()=>{
      for(let i=0;i<6;i++){
        const f=await inviteFixture();
        const replies=await Promise.all([request(f.actor,'POST',`/api/workspace-invites/${f.invite}/accept`,{}),request(token,'DELETE',`/api/workspaces/${f.workspace}/invites/${f.invite}`,{operation_id:crypto.randomUUID()})]);
        const state=(await pool.query('SELECT status FROM workspace_invites WHERE id=$1',[f.invite])).rows[0].status;
        assert.equal(await accepted(f),state==='accepted');assert.ok(['accepted','revoked'].includes(state));
        assert.equal(replies[1].status,200);assert.ok([200,409].includes(replies[0].status));
      }
    });
    await t.test('legacy accept versus decline and resend use the same invitation lock',async()=>{
      for(const opposite of ['decline','resend']){
        const f=await inviteFixture();
        const replies=await Promise.all([request(f.actor,'POST',`/api/workspace-invites/${f.invite}/accept`,{}),request(opposite==='decline'?f.actor:token,'POST',opposite==='decline'?`/api/workspace-invites/${f.invite}/decline`:`/api/workspaces/${f.workspace}/invites/${f.invite}/resend`,{})]);
        const state=(await pool.query('SELECT status FROM workspace_invites WHERE id=$1',[f.invite])).rows[0].status;
        assert.equal(await accepted(f),state==='accepted');assert.equal(replies.filter(r=>r.status===200).length,opposite==='resend'&&replies[1].status===200?2:1);
      }
    });
    await t.test('two invitees racing for the final seat cannot oversubscribe',async()=>{
      const f=await inviteFixture(),g=await inviteFixture();
      await pool.query('UPDATE workspace_invites SET workspace_id=$1 WHERE id=$2',[f.workspace,g.invite]);
      const replies=await Promise.all([f,g].map(v=>request(v.actor,'POST',`/api/workspace-invites/${v.invite}/accept`,{})));
      assert.deepEqual(replies.map(r=>r.status).sort(),[200,402]);
      assert.equal(Number((await pool.query("SELECT count(DISTINCT subject_id) FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1",[f.workspace])).rows[0].count),2);
    });
    await t.test('Stripe seat authority and invite acceptance share one ordered workspace gate',async()=>{
      for(let i=0;i<8;i++){
        const f=await inviteFixture({seats:2});
        let blocker;
        if(i===0){blocker=await pool.connect();await blocker.query('BEGIN');await lockWorkspaceAuthority(blocker,f.workspace);}
        let decisionSettled=false,billingSettled=false;
        const decisionFlight=request(f.actor,'POST',`/api/workspace-invites/${f.invite}/accept`,{}).finally(()=>{decisionSettled=true});
        const billingFlight=setWorkspacePlan(pool,f.workspace,{plan:'team',status:'active',subId:'sub_fixture',seats:1}).finally(()=>{billingSettled=true});
        if(blocker){await new Promise(resolve=>setTimeout(resolve,75));assert.equal(decisionSettled,false);assert.equal(billingSettled,false);await blocker.query('ROLLBACK');blocker.release();}
        const [decision]=await Promise.all([decisionFlight,billingFlight]);
        const member=await accepted(f),limit=Number((await pool.query("SELECT metadata->'billing'->>'seat_limit' value FROM workspaces WHERE id=$1",[f.workspace])).rows[0].value);
        assert.equal(limit,1);assert.equal(member,decision.status===200);assert.ok([200,402].includes(decision.status));
      }
    });
    await t.test('pinned recipient, inactive workspace and expiry refuse without granting membership',async()=>{
      const f=await inviteFixture({email:`${owner}@example.test`});
      await pool.query('UPDATE workspace_invites SET invited_email=$1 WHERE id=$2',['owner@example.test',f.invite]);
      assert.equal((await request(token,'POST',`/api/workspace-invites/${f.invite}/accept`,{})).status,404);
      const inbox=await (await request(token,'GET','/api/workspace-invites')).json();assert.ok(!inbox.invites.some(v=>v.id===f.invite));
      await pool.query("UPDATE workspaces SET status='archived' WHERE id=$1",[f.workspace]);
      assert.equal((await request(f.actor,'POST',`/api/workspace-invites/${f.invite}/accept`,{})).status,403);assert.equal(await accepted(f),false);
      const expired=await inviteFixture({expired:true});
      assert.equal((await request(expired.actor,'POST',`/api/workspace-invites/${expired.invite}/accept`,{})).status,410);
      assert.equal((await pool.query('SELECT status FROM workspace_invites WHERE id=$1',[expired.invite])).rows[0].status,'expired');assert.equal(await accepted(expired),false);
    });
    await t.test('legacy acceptance and creation roll back when their audit write fails',async()=>{
      const f=await inviteFixture(),before=Number((await pool.query('SELECT count(*) FROM workspaces')).rows[0].count);
      await pool.query("CREATE FUNCTION fail_lifecycle_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('invite.accept','workspace.create') THEN RAISE EXCEPTION 'fixture rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_lifecycle_audit BEFORE INSERT ON workspace_audit FOR EACH ROW EXECUTE FUNCTION fail_lifecycle_audit()");
      try{
        assert.equal((await request(f.actor,'POST',`/api/workspace-invites/${f.invite}/accept`,{})).status,500);
        assert.equal((await request(token,'POST','/api/workspaces',{name:'Failed atomic creation'})).status,500);
      }finally{await pool.query('DROP TRIGGER reject_lifecycle_audit ON workspace_audit');}
      assert.equal(await accepted(f),false);assert.equal((await pool.query('SELECT status FROM workspace_invites WHERE id=$1',[f.invite])).rows[0].status,'pending');
      assert.equal(Number((await pool.query('SELECT count(*) FROM workspaces')).rows[0].count),before);
    });
    await t.test('concurrent lazy personal provisioning creates one complete owner identity',async()=>{
      const f=await inviteFixture();
      const responses=await Promise.all(Array.from({length:6},()=>request(f.actor,'GET','/api/workspaces')));assert.ok(responses.every(v=>v.status===200));
      const personal=(await pool.query("SELECT id FROM workspaces WHERE owner_user_id=$1 AND workspace_type='personal'",[f.account])).rows;assert.equal(personal.length,1);
      assert.equal((await pool.query("SELECT count(*) FROM relationship_tuples WHERE object_type='workspace' AND object_id=$1 AND relation='owner' AND subject_id=$2",[personal[0].id,f.account])).rows[0].count,'1');
      assert.equal((await pool.query("SELECT count(*) FROM workspace_audit WHERE workspace_id=$1 AND action='workspace.create'",[personal[0].id])).rows[0].count,'1');
    });
    const accountOperation=async(actor,id,phase,body)=>{
      const path=`/api/workspace-invites/operations/${id}${phase?`/${phase}`:''}`,method=phase?'POST':'GET',response=await request(actor,method,path,phase?{request:body}:undefined);
      return {response,body:await response.clone().json()};
    };
    await t.test('account invite decision requires prepare and replays one immutable outcome',async()=>{
      const f=await inviteFixture(),op=crypto.randomUUID(),intent={action:'invite.accept',inviteId:f.invite};
      assert.equal((await accountOperation(f.actor,op,'execute',intent)).response.status,409);
      const prepared=await accountOperation(f.actor,op,'prepare',intent);assert.equal(prepared.body.operation.state,'prepared');
      const results=await Promise.all(Array.from({length:6},()=>accountOperation(f.actor,op,'execute',intent)));
      assert.equal(results.filter(r=>!r.body.replayed).length,1);assert.ok(results.every(r=>r.body.operation.state==='committed'));
      assert.equal(await accepted(f),true);assert.equal((await pool.query("SELECT count(*) FROM workspace_audit WHERE workspace_id=$1 AND action='invite.accept'",[f.workspace])).rows[0].count,'1');
      assert.equal((await accountOperation(f.actor,op,'prepare',{...intent,action:'invite.decline'})).response.status,409);
    });
    await t.test('prepared decision serializes against revoke and retains terminal receipt',async()=>{
      const f=await inviteFixture(),op=crypto.randomUUID(),intent={action:'invite.accept',inviteId:f.invite};await accountOperation(f.actor,op,'prepare',intent);
      const [decision]=await Promise.all([accountOperation(f.actor,op,'execute',intent),request(token,'DELETE',`/api/workspaces/${f.workspace}/invites/${f.invite}`,{operation_id:crypto.randomUUID()})]);
      assert.ok(['committed','rejected'].includes(decision.body.operation.state));
      const read=await accountOperation(f.actor,op);assert.deepEqual(read.body.operation,decision.body.operation);assert.equal(await accepted(f),decision.body.operation.state==='committed');
    });
    await t.test('abandonment wins over delayed preparation and execution without dispatch',async()=>{
      const f=await inviteFixture(),op=crypto.randomUUID(),intent={action:'invite.decline',inviteId:f.invite};
      const abandoned=await accountOperation(f.actor,op,'abandon',intent);assert.equal(abandoned.body.operation.state,'abandoned');
      for(const phase of ['prepare','execute'])assert.deepEqual((await accountOperation(f.actor,op,phase,intent)).body.operation,abandoned.body.operation);
      assert.equal((await pool.query('SELECT status FROM workspace_invites WHERE id=$1',[f.invite])).rows[0].status,'pending');
    });
    await t.test('workspace creation prepares durably, lost ACK reads back one owner identity',async()=>{
      await pool.query("INSERT INTO account_activations(user_id,method) VALUES($1,'fixture') ON CONFLICT DO NOTHING",[owner]);
      const op=crypto.randomUUID(),intent={action:'workspace.create',name:'Receipted team',workspace_type:'team'};
      const before=Number((await pool.query("SELECT count(*) FROM workspaces WHERE name=$1",[intent.name])).rows[0].count);
      await accountOperation(token,op,'prepare',intent);assert.equal(Number((await pool.query("SELECT count(*) FROM workspaces WHERE name=$1",[intent.name])).rows[0].count),before);
      dropId=op;await assert.rejects(accountOperation(token,op,'execute',intent));
      const outcome=await accountOperation(token,op);assert.equal(outcome.body.operation.state,'committed');
      const workspace=outcome.body.operation.result.workspace;assert.equal((await accountOperation(token,op,'execute',intent)).body.replayed,true);
      assert.equal(Number((await pool.query("SELECT count(*) FROM workspaces WHERE name=$1",[intent.name])).rows[0].count),before+1);
      assert.equal((await pool.query("SELECT count(*) FROM relationship_tuples WHERE object_id=$1 AND relation='owner'",[workspace.id])).rows[0].count,'1');
    });
    await t.test('failed account execution remains prepared and can be explicitly retried',async()=>{
      const f=await inviteFixture(),op=crypto.randomUUID(),intent={action:'invite.accept',inviteId:f.invite};await accountOperation(f.actor,op,'prepare',intent);
      await pool.query("CREATE FUNCTION fail_account_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='invite.accept' THEN RAISE EXCEPTION 'fixture account rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_account_audit BEFORE INSERT ON workspace_audit FOR EACH ROW EXECUTE FUNCTION fail_account_audit()");
      try{assert.equal((await accountOperation(f.actor,op,'execute',intent)).response.status,503);}finally{await pool.query('DROP TRIGGER reject_account_audit ON workspace_audit');}
      assert.equal((await accountOperation(f.actor,op)).body.state,'prepared');assert.equal(await accepted(f),false);
      assert.equal((await accountOperation(f.actor,op,'execute',intent)).body.operation.state,'committed');
    });
    await t.test('account receipts are actor/client/incarnation scoped and corrupt rows fail closed',async()=>{
      const f=await inviteFixture(),op=crypto.randomUUID(),intent={action:'invite.decline',inviteId:f.invite};await accountOperation(f.actor,op,'prepare',intent);
      assert.equal((await accountOperation(token,op)).body.state,'not-observed');
      const otherClient=await mint({user:f.account,client:'xeno-hub'});assert.equal((await accountOperation(otherClient,op)).body.state,'not-observed');
      const unbound=await mint({user:f.account,bound:false});assert.equal((await accountOperation(unbound,crypto.randomUUID(),'prepare',intent)).response.status,401);
      const underScoped=await mint({user:f.account,client:'xeno-agent-cli',scope:'team:manage'});assert.equal((await accountOperation(underScoped,crypto.randomUUID(),'prepare',intent)).response.status,403);
      await pool.query('ALTER TABLE account_workspace_operations DISABLE TRIGGER account_workspace_intent_immutable');
      await pool.query("UPDATE account_workspace_operations SET account_incarnation=repeat('0',64) WHERE operation_id=$1",[op]);
      await pool.query('ALTER TABLE account_workspace_operations ENABLE TRIGGER account_workspace_intent_immutable');
      assert.equal((await accountOperation(f.actor,op)).response.status,409);
    });
  } finally {if(server)await new Promise(resolve=>server.close(resolve));await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await pool.end();}
});
