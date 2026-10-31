// Real Postgres proof. DATABASE_URL must name a disposable test database.
import pg from 'pg';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {runAllMigrations} from '../services/migrationRunner.js';
import {seedForum} from '../database/seeds/forum-seed.js';
import {submitReviewedReport,recoverReport,readEvidence,validateReport} from '../services/forumReportIntake.js';
import {publishTicket,getTicket} from '../services/forumTickets.js';
if(!process.env.DATABASE_URL)throw new Error('Disposable DATABASE_URL is required');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
const actors=[];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const evidence=()=>({id:randomUUID(),name:'selected-area.png',type:'image/png',bytes:png.length,sha256:createHash('sha256').update(png).digest('hex'),data:png.toString('base64')});
const draft=(visibility='private',attachments=[evidence()])=>({schema:'xeno.report/2',product:'workspace',kind:'bug',visibility,title:'Report capture test fixture',body:'Only disposable test content.',context:{repro:'Open the test fixture.',attachments}});
const refused=(fn,code)=>assert.rejects(fn,e=>e.code===code);
try{
  await runAllMigrations(pool);await seedForum(pool);
  for(const [name,role,kind] of [['reporter','user','human'],['other','user','human'],['staff','moderator','human'],['product-agent','user','agent'],['grant-issuer','moderator','human']]){
    const handle=`report-proof-${name}-${randomUUID().slice(0,8)}`;
    const row=(await pool.query("INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at,role) VALUES($1,$2,'fixture',$1,true,now(),$3) RETURNING id",[handle,handle+'@example.test',role])).rows[0];actors.push({...row,kind,role,username:handle});
  }
  const [owner,other,staff,agent,issuer]=actors;
  const input=draft(),id=randomUUID();
  const [a,b]=await Promise.all([submitReviewedReport(pool,owner,input,id),submitReviewedReport(pool,owner,input,id)]);
  assert.equal(a.shortId,b.shortId);assert.equal(a.private,true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM forum_report_submissions WHERE reporter_id=$1',[owner.id])).rows[0].n,1);
  assert.equal((await recoverReport(pool,owner,id)).state,'committed');assert.equal((await recoverReport(pool,other,id)).state,'not_observed');
  await refused(()=>submitReviewedReport(pool,owner,{...input,body:'Changed payload'},id),'report_conflict');
  assert.deepEqual((await readEvidence(pool,owner,input.context.attachments[0].id)).content,png);
  await readEvidence(pool,staff,input.context.attachments[0].id);
  await refused(()=>readEvidence(pool,null,input.context.attachments[0].id),'evidence_not_found');
  await refused(()=>readEvidence(pool,other,input.context.attachments[0].id),'evidence_not_found');
  await refused(()=>readEvidence(pool,{...agent,username:'workspace-dev',role:'admin'},input.context.attachments[0].id),'evidence_not_found');
  await refused(()=>getTicket(pool,{...agent,username:'workspace-dev',role:'admin'},a.shortId),'ticket_not_found');
  await pool.query('INSERT INTO forum_report_product_grants(agent_id,product,granted_by) VALUES($1,$2,$3)',[agent.id,'workspace',issuer.id]);
  await pool.query('DELETE FROM users WHERE id=$1',[issuer.id]);
  assert.equal((await pool.query('SELECT granted_by FROM forum_report_product_grants WHERE agent_id=$1',[agent.id])).rows[0].granted_by,null);
  await readEvidence(pool,agent,input.context.attachments[0].id);
  await getTicket(pool,agent,a.shortId);
  const published=await publishTicket(pool,owner,a.shortId);
  const post=(await pool.query('SELECT p.body FROM forum_posts p JOIN forum_threads t ON t.id=p.thread_id WHERE t.short_id=$1 AND p.position=1',[published.thread.shortId])).rows[0];
  assert.ok(!post.body.includes('/report/evidence/'));await refused(()=>readEvidence(pool,null,input.context.attachments[0].id),'evidence_not_found');
  const pub=draft('public'),pubReceipt=await submitReviewedReport(pool,owner,pub,randomUUID());
  await readEvidence(pool,null,pub.context.attachments[0].id);
  const joined=draft('public');joined.joinShortId=pubReceipt.shortId;
  const joinedReceipt=await submitReviewedReport(pool,other,joined,randomUUID());assert.ok(joinedReceipt.postId);
  await pool.query("UPDATE forum_posts SET status='hidden' WHERE id=$1",[joinedReceipt.postId]);
  await refused(()=>readEvidence(pool,null,joined.context.attachments[0].id),'evidence_not_found');
  await readEvidence(pool,null,pub.context.attachments[0].id);
  const rollback=draft();rollback.context.attachments[0].id=input.context.attachments[0].id;
  const before=(await pool.query('SELECT count(*)::int AS n FROM forum_tickets WHERE reporter_id=$1',[other.id])).rows[0].n;
  await assert.rejects(()=>submitReviewedReport(pool,other,rollback,randomUUID()));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM forum_tickets WHERE reporter_id=$1',[other.id])).rows[0].n,before);
  for(const change of [a=>a.sha256='0'.repeat(64),a=>a.type='image/jpeg',a=>a.bytes++,a=>a.name='bad\nname']){const invalid=draft();change(invalid.context.attachments[0]);assert.throws(()=>validateReport(invalid));}
  await refused(()=>submitReviewedReport(pool,{...owner,kind:'service'},draft(),randomUUID()),'report_auth_required');
  await pool.query("INSERT INTO forum_report_submissions(reporter_id,submission_id,request_hash,receipt) SELECT $1,gen_random_uuid(),'fixture','{}'::jsonb FROM generate_series(1,10)",[other.id]);
  await refused(()=>submitReviewedReport(pool,other,draft(),randomUUID()),'report_rate_limit');
  console.log('PASS real Postgres: atomic replay, conflict, recovery ownership, private/public evidence, explicit agent grants, private publication, exact hidden reply, rollback, invalid media, service refusal and quota');
}finally{await pool.end();}
