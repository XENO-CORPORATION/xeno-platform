import { createHash } from 'node:crypto';
import { ForumError } from './forumError.js';
import * as write from './forumWrite.js';
import * as tickets from './forumTickets.js';
import { authorityTransaction } from './workspaceOperationReceipts.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const bad = message => { throw new ForumError(message, 'invalid_report', 400); };
const sha = value => createHash('sha256').update(value).digest('hex');
const actorRequired = actor => { if (!actor?.id || !['human', 'agent'].includes(actor.kind)) throw new ForumError('Sign in to report', 'report_auth_required', 403); };
const metadata = row => ({ id: row.id, name: row.name, type: row.content_type, bytes: row.size_bytes, sha256: row.sha256, url: `/api/forum/report/evidence/${row.id}` });
function signature(type, bytes) {
  if (type === 'image/png') return bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (type === 'image/jpeg') return bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  if (type === 'image/webp') return bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP';
  if (type === 'video/webm') return bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  if (type === 'video/mp4') return bytes.toString('ascii',4,8)==='ftyp';
  return false;
}
export function validateReport(input) {
  if (!input || typeof input!=='object' || Array.isArray(input) || !['xeno.report/1','xeno.report/2'].includes(input.schema)) bad('Unsupported reviewed report schema');
  if (Object.keys(input).some(key => !['schema','kind','visibility','product','version','buildId','os','title','body','joinShortId','context'].includes(key))) bad('Unknown report field');
  if (!['bug','feature','feedback'].includes(input.kind) || !['public','private'].includes(input.visibility)) bad('Invalid kind or visibility');
  if (typeof input.product!=='string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(input.product)) bad('Invalid product');
  for (const [key,max] of [['title',200],['body',16000],['version',32],['buildId',120],['os',120]]) if (input[key]!==undefined && (typeof input[key]!=='string' || input[key].length>max)) bad(`Invalid ${key}`);
  if (!input.title?.trim() || input.title.trim().length<8 || !input.body?.trim()) bad('Title and description are required');
  if (input.joinShortId!==undefined && (input.visibility!=='public' || !/^[a-f0-9]{8}$/.test(input.joinShortId))) bad('Invalid duplicate report');
  const context=input.context || {};
  if (typeof context!=='object' || Array.isArray(context) || Object.keys(context).some(key=>!['recentLog','repro','attachments'].includes(key))) bad('Invalid context');
  if (context.repro!==undefined && (typeof context.repro!=='string' || context.repro.length>10000)) bad('Invalid reproduction steps');
  if (context.recentLog!==undefined && (!Array.isArray(context.recentLog) || context.recentLog.length>200 || context.recentLog.some(line=>typeof line!=='string'||line.length>4000))) bad('Invalid diagnostics');
  if (JSON.stringify({...context,attachments:undefined}).length>12000) bad('Context too large');
  const evidence=context.attachments || [];
  if (!Array.isArray(evidence) || evidence.length>3 || (input.schema==='xeno.report/1' && evidence.length)) bad('Invalid evidence count');
  const seen=new Set(); let total=0;
  const decoded=evidence.map(item=>{
    if (!item || typeof item!=='object' || Object.keys(item).some(key=>!['id','name','type','bytes','sha256','data'].includes(key)) || !UUID.test(item.id) || seen.has(item.id) || typeof item.name!=='string' || !item.name.length || item.name.length>120 || /[\r\n\x00-\x1f]/.test(item.name)) bad('Invalid evidence metadata');
    if (!Number.isSafeInteger(item.bytes) || item.bytes<1 || item.bytes>8*1024*1024 || typeof item.data!=='string' || item.data.length!==4*Math.ceil(item.bytes/3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) bad('Invalid evidence size');
    total+=item.bytes; if(total>12*1024*1024)bad('Evidence exceeds 12 MiB');
    const bytes=Buffer.from(item.data,'base64');
    if(bytes.length!==item.bytes || bytes.toString('base64')!==item.data || !signature(item.type,bytes) || sha(bytes)!==item.sha256) bad('Evidence does not match its reviewed type or hash');
    seen.add(item.id); return {...item,content:bytes};
  });
  const contextBody=[context.repro?`\n\n**Reproduction steps**\n${context.repro}`:'',context.recentLog?.length?`\n\n**Reviewed technical details**\n\n\`\`\`text\n${context.recentLog.join('\n')}\n\`\`\``:'',input.buildId?`\nBuild: ${input.buildId}`:''].join('');
  if((input.body+contextBody).length>19000)bad('Report and context too large');
  return {payload:input,decoded,body:input.body.trim()+contextBody,total};
}
export async function submitReviewedReport(pool,actor,input,submissionId) {
  actorRequired(actor);
  if(!UUID.test(submissionId || ''))bad('A UUID Idempotency-Key is required');
  const {decoded,body,total}=validateReport(input);
  // serialize consistently across JSON object key order.
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  const requestHash=sha(JSON.stringify(canonical(input)));
  const apply=async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`forum-report:${actor.id}`]);
    const prior=(await db.query('SELECT request_hash,receipt FROM forum_report_submissions WHERE reporter_id=$1 AND submission_id=$2',[actor.id,submissionId])).rows[0];
    if(prior){if(prior.request_hash!==requestHash)throw new ForumError('Submission ID already used for different content','report_conflict',409);return {...prior.receipt,replayed:true};}
    const count=Number((await db.query("SELECT count(*)::int AS count FROM forum_report_submissions WHERE reporter_id=$1 AND created_at>now()-interval '1 hour'",[actor.id])).rows[0].count);
    if(count>=(actor.kind==='agent'?3:10))throw new ForumError('Report limit reached. Try later.','report_rate_limit',429);
    const stored=Number((await db.query('SELECT COALESCE(sum(size_bytes),0) AS bytes FROM forum_report_evidence WHERE reporter_id=$1',[actor.id])).rows[0].bytes);
    if(stored+total>100*1024*1024)throw new ForumError('Report evidence storage limit reached','report_storage_limit',413);
    let receipt,postId=null,ticketId=null;
    if(input.visibility==='private'){
      const ticket=await tickets.createTicket(db,actor,{...input,body}); ticketId=ticket.id;
      receipt={ok:true,private:true,shortId:ticket.shortId};
    }else{
      const evidenceBody=decoded.length?'\n\n**Evidence**\n'+decoded.map(a=>`- [${a.name.replace(/[\[\]<>]/g,'')}](/api/forum/report/evidence/${a.id})`).join('\n'):'';
      receipt={...(await write.submitReport(db,actor,{...input,body:body+evidenceBody})),private:false};
      if(receipt.postId)postId=receipt.postId;
      else postId=(await db.query('SELECT p.id FROM forum_posts p JOIN forum_threads t ON t.id=p.thread_id WHERE t.short_id=$1 AND p.position=1',[receipt.shortId])).rows[0]?.id;
      if(!postId)throw new Error('Report post was not created');
    }
    const attachments=[];
    for(const item of decoded){
      const row=(await db.query('INSERT INTO forum_report_evidence(id,reporter_id,post_id,ticket_id,name,content_type,size_bytes,sha256,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,name,content_type,size_bytes,sha256',[item.id,actor.id,postId,ticketId,item.name,item.type,item.bytes,item.sha256,item.content])).rows[0];
      attachments.push(metadata(row));
    }
    receipt.attachments=attachments;
    await db.query('INSERT INTO forum_report_submissions(reporter_id,submission_id,request_hash,receipt) VALUES($1,$2,$3,$4::jsonb)',[actor.id,submissionId,requestHash,JSON.stringify(receipt)]);
    return receipt;
  };
  return typeof pool.release==='function'?apply(pool):authorityTransaction(pool,apply);
}
export async function recoverReport(db,actor,id){
  actorRequired(actor);if(!UUID.test(id))bad('Invalid submission ID');
  const row=(await db.query('SELECT receipt FROM forum_report_submissions WHERE reporter_id=$1 AND submission_id=$2',[actor.id,id])).rows[0];
  return {state:row?'committed':'not_observed',receipt:row?.receipt || null};
}
export async function readEvidence(db,actor,id){
  const missing=()=>{throw new ForumError('Evidence not found','evidence_not_found',404);};
  if(!UUID.test(id))return missing();
  const row=(await db.query('SELECT e.*,p.status AS post_status,t.status AS thread_status,s.status AS space_status,tk.reporter_id AS ticket_reporter,tk.product AS ticket_product FROM forum_report_evidence e LEFT JOIN forum_posts p ON p.id=e.post_id LEFT JOIN forum_threads t ON t.id=p.thread_id LEFT JOIN forum_spaces s ON s.id=t.space_id LEFT JOIN forum_tickets tk ON tk.id=e.ticket_id WHERE e.id=$1',[id])).rows[0];
  if(!row)return missing();
  const publicRead=row.post_id && row.post_status==='visible' && !['deleted','archived'].includes(row.thread_status) && row.space_status==='active';
  if(!publicRead){
    if(!row.ticket_id || !actor?.id)return missing();
    const reporter=String(actor.id)===String(row.ticket_reporter),staff=actor.kind==='human'&&['admin','moderator'].includes(actor.role);
    const granted=actor.kind==='agent'&&(await db.query('SELECT 1 FROM forum_report_product_grants WHERE agent_id=$1 AND product=$2',[actor.id,row.ticket_product])).rows.length>0;
    if(!reporter&&!staff&&!granted)return missing();
  }
  return {...metadata(row),content:row.content,private:!publicRead};
}
