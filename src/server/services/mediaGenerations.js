import { localLibraryPath } from './storageObjects.js';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolvePrincipal } from './agentIdentity.js';
import { currentArea } from '../utils/resourceArea.js';
import { prepareAccountQuota } from './usageCreditsService.js';
import { requireResourceRelation, userPrincipal, withTransaction } from './chatProjectAuthority.js';
import { getAuthorizedLibraryFile, sniffMime } from './libraryAssets.js';
import { mediaGateway } from '../utils/mediaGenerationGateway.js';
import { generationError, validateGenerationRequest, requestHash, tariffFor, UUID } from './mediaGenerationCatalog.js';

export const MAX_REFERENCE_BYTES=20*1024*1024;
export const MAX_REFERENCES_TOTAL_BYTES=48*1024*1024;
export async function generationActor(db,value){
  const id=typeof value==='string'?value:value?.id;
  if(!UUID.test(id||''))throw generationError('invalid_actor',403);
  const actor=await resolvePrincipal(db,id);
  if(!actor?.usable||!['human','agent'].includes(actor.kind))throw generationError('actor_unavailable',403);
  return {...actor,payerId:actor.owner?.id||actor.id};
}
export async function assertGenerationPlacement(db,actor,request){
  const principal=userPrincipal(actor.id);
  if(request.projectId)await requireResourceRelation(db,principal,'project',request.projectId,'editor');
  if(request.conversationId){
    await requireResourceRelation(db,principal,'conversation',request.conversationId,'editor');
    const row=(await db.query('SELECT project_id FROM chat_conversations WHERE id=$1 AND deleted_at IS NULL',[request.conversationId])).rows[0];
    if(!row||row.project_id!==request.projectId)throw generationError('conversation_project_mismatch',404);
  }
}
// Canonical asset IDs only. Realpath defeats a planted symlink/junction; bounded handle reads
// defeat stat/read TOCTOU growth. No LLM-controlled file path or remote reference URL is accepted.
export async function readGenerationReferences(db,actor,ids,{uploadsDir=null}={}){
  let total=0;const references=[];
  // The uploads folder is mounted at two paths in the containers (compose: /app/uploads and /app/src/server/uploads),
  // and an asset's stored path may name either. Both are the managed store; nothing else is.
  const here=path.dirname(fileURLToPath(import.meta.url));
  const roots=(await Promise.all((uploadsDir?[uploadsDir]:[path.resolve(here,'../uploads'),path.resolve('src/server/uploads')]).map(dir=>fs.realpath(dir).catch(()=>null)))).filter(Boolean);
  for(const id of ids){
    const file=await getAuthorizedLibraryFile(db,userPrincipal(actor.id),id);
    if(!file)throw generationError('reference_forbidden',404);
    if(!file.ingestion_safe)throw generationError('reference_not_ready',409);
    if(!['image/png','image/jpeg','image/webp'].includes(file.mime_type)||Number(file.file_size)>MAX_REFERENCE_BYTES)throw generationError('invalid_reference_media',422);
    await localLibraryPath(db,file);   // XENO Storage: bring the bytes back from the object store when the cached copy is gone
    const real=await fs.realpath(file.storage_path).catch(()=>null);
    if(!real||!roots.some(root=>real.startsWith(`${root}${path.sep}`)))throw generationError('reference_path_forbidden',422);
    const handle=await fs.open(real,'r');let bytes;
    try{
      const stat=await handle.stat();if(!stat.isFile()||stat.size>MAX_REFERENCE_BYTES)throw generationError('reference_too_large',413);
      const buffer=Buffer.alloc(MAX_REFERENCE_BYTES+1);let read=0;
      while(read<buffer.length){const chunk=await handle.read(buffer,read,buffer.length-read,null);if(!chunk.bytesRead)break;read+=chunk.bytesRead;}
      if(read>MAX_REFERENCE_BYTES||read!==Number(file.file_size))throw generationError('reference_changed',409);
      bytes=buffer.subarray(0,read);
    }finally{await handle.close();}
    if(!bytes.length||sniffMime(bytes,'application/octet-stream')!==file.mime_type||crypto.createHash('sha256').update(bytes).digest('hex')!==file.content_sha256)throw generationError('reference_changed',409);
    total+=bytes.length;if(total>MAX_REFERENCES_TOTAL_BYTES)throw generationError('references_too_large',413);
    references.push(`data:${file.mime_type};base64,${bytes.toString('base64')}`);
  }
  return references;
}
/**
 * The gateway refuses a queued job that carries inline media (`asset_required`), so a reference is uploaded
 * to its asset store and the job names it by id. The bytes are the same verified bytes read above — one
 * reader, two postures — and an upload that cannot be completed fails the generation rather than falling
 * back to an inline payload the gateway will refuse anyway.
 * Returns `{asset_id}` entries, which is what `rejectUnsafeQueuedMedia` and the image routes accept.
 */
export async function uploadGenerationReferences(db,actor,ids,{uploadsDir=null,gateway=mediaGateway,read=readGenerationReferences}={}){
  const raw=await read(db,actor,ids,{uploadsDir});
  const uploaded=[];
  for(const dataUrl of raw){
    const comma=dataUrl.indexOf(',');
    const mimeType=dataUrl.slice(5,dataUrl.indexOf(';'));
    const id=await gateway.uploadAsset({bytes:Buffer.from(dataUrl.slice(comma+1),'base64'),mimeType});
    uploaded.push({asset_id:id});
  }
  return uploaded;
}
function signingSecret(options){const secret=options.quoteSecret||process.env.JWT_SECRET;if(!secret)throw generationError('quote_unavailable',503);return secret;}
function tokenFor(payload,options){const data=Buffer.from(JSON.stringify(payload)).toString('base64url');return `${data}.${crypto.createHmac('sha256',signingSecret(options)).update(`media-quote:v1:${data}`).digest('base64url')}`;}
function verifyQuote(token,{actor,payer,hash,tariff},options){
  if(typeof token!=='string'||token.length>3000)throw generationError('invalid_quote',409);
  const [data,signature,...extra]=token.split('.');if(extra.length||!data||!signature)throw generationError('invalid_quote',409);
  let payload;try{payload=JSON.parse(Buffer.from(data,'base64url').toString('utf8'));}catch{throw generationError('invalid_quote',409);}
  const expected=tokenFor(payload,options).split('.')[1];
  const a=Buffer.from(signature),b=Buffer.from(expected);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw generationError('invalid_quote',409);
  if(payload.actor!==actor||payload.payer!==payer||payload.requestHash!==hash)throw generationError('quote_changed',409);
  if(!Number.isFinite(payload.expiresAt)||payload.expiresAt<=(options.now?.()??Date.now()))throw generationError('quote_expired',409);
  if(payload.tariffRevision!==tariff.revision||payload.maxRetailMicro!==tariff.maxRetailMicro)throw generationError('quote_changed',409);
  return payload;
}
export async function quoteGeneration(db,value,input,options={}){
  const actor=await generationActor(db,value);
  const {request}=await validateGenerationRequest(input,{models:options.gateway?.models||mediaGateway.models});
  await assertGenerationPlacement(db,actor,request);
  await readGenerationReferences(db,actor,request.referenceAssetIds,options);
  const tariff=(options.tariff||tariffFor)(request.type,request.model);
  const payload={actor:options.approvalActorId||actor.id,payer:actor.payerId,requestHash:requestHash(request),tariffRevision:tariff.revision,maxRetailMicro:tariff.maxRetailMicro,expiresAt:(options.now?.()??Date.now())+300000};
  return {quoteToken:tokenFor(payload,options),requestHash:payload.requestHash,tariffRevision:tariff.revision,maxRetailCredits:tariff.maxRetailCredits,expiresAt:new Date(payload.expiresAt).toISOString()};
}
export function generationView(row){return {id:row.id,type:row.request.type,state:row.state,request:row.request,requestHash:row.request_hash,version:row.version,quote:row.quote,resultAssetIds:row.result_asset_ids,error:row.error_code?{code:row.error_code}:null,favorite:row.favorite===true,area:row.area??null,retailCostMicro:Number(row.retail_cost_micro),upstreamBilling:row.upstream_billing,createdAt:row.created_at,updatedAt:row.updated_at,url:`/workspace/studio/generate/${row.request.type}/g/${row.id}`};}
export async function createGeneration(db,value,input,options={}){return create(db,value,input,false,options);}
export async function proposeGeneration(db,value,input,options={}){return create(db,value,input,true,options);}
async function create(db,value,input,forceProposal,options){
  const actor=await generationActor(db,value);
  if(typeof input.requestKey!=='string'||! /^[A-Za-z0-9:_.-]{1,160}$/.test(input.requestKey))throw generationError('invalid_request_key');
  const {request}=await validateGenerationRequest(input,{models:options.gateway?.models||mediaGateway.models});
  const hash=requestHash(request);
  const prior=(await db.query('SELECT * FROM media_generations WHERE owner_user_id=$1 AND request_key=$2',[actor.payerId,input.requestKey])).rows[0];
  if(prior){if(prior.request_hash!==hash||prior.actor_user_id!==actor.id)throw generationError('request_key_conflict',409);return generationView(prior);}
  await assertGenerationPlacement(db,actor,request);await readGenerationReferences(db,actor,request.referenceAssetIds,options);
  const proposal=forceProposal||actor.kind==='agent';
  const tariff=(options.tariff||tariffFor)(request.type,request.model);
  const quote=proposal?await quoteGeneration(db,actor.id,request,{...options,approvalActorId:actor.payerId}):null;
  if(!proposal)verifyQuote(input.quoteToken,{actor:actor.id,payer:actor.payerId,hash,tariff},options);
  if(!proposal)await prepareAccountQuota(db,actor.id);
  const id=crypto.randomUUID();
  return withTransaction(db,async tx=>{
    const row=(await tx.query(`INSERT INTO media_generations(id,owner_user_id,actor_user_id,request_key,request,request_hash,quote,state,project_id,conversation_id,hold_id,gateway_key,retail_cost_micro,approved_by_user_id,approved_at,area)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CASE WHEN $14::uuid IS NOT NULL THEN now() END,$15)
      ON CONFLICT(owner_user_id,request_key) DO NOTHING RETURNING *`,[id,actor.payerId,actor.id,input.requestKey,request,hash,quote||{quoteToken:input.quoteToken,requestHash:hash,tariffRevision:tariff.revision,maxRetailCredits:tariff.maxRetailCredits},proposal?'awaiting_approval':'queued',request.projectId,request.conversationId,`media:${id}`,`platform-media:${id}`,tariff.maxRetailMicro,proposal?null:actor.id,options.area===undefined?currentArea():options.area])).rows[0];
    const result=row||(await tx.query('SELECT * FROM media_generations WHERE owner_user_id=$1 AND request_key=$2',[actor.payerId,input.requestKey])).rows[0];
    if(result.request_hash!==hash||result.actor_user_id!==actor.id)throw generationError('request_key_conflict',409);
    return generationView(result);
  });
}
async function ownedRow(db,actor,id,lock=false){
  if(!UUID.test(id||''))throw generationError('generation_not_found',404);
  // a generation the person removed from their history reads as not found to them; the row itself is kept
  const row=(await db.query(`SELECT * FROM media_generations WHERE id=$1 AND owner_user_id=$2 AND removed_at IS NULL ${lock?'FOR UPDATE':''}`,[id,actor.payerId])).rows[0];
  if(!row||(actor.kind==='agent'&&row.actor_user_id!==actor.id))throw generationError('generation_not_found',404);
  return row;
}
export async function getGeneration(db,value,id){return generationView(await ownedRow(db,await generationActor(db,value),id));}
/** `area`: { filter:false } everything (Overview) · { filter:true, area:'dev' } one area · { filter:true, area:null } in no area. */
export async function listGenerations(db,value,{type=null,projectId=null,conversationId=null,favorite=false,area={filter:false,area:null}}={}){
  const actor=await generationActor(db,value);if((projectId&&!UUID.test(projectId))||(conversationId&&!UUID.test(conversationId)))throw generationError('invalid_placement');
  const rows=(await db.query(`SELECT * FROM media_generations WHERE owner_user_id=$1 AND ($2::text IS NULL OR request->>'type'=$2) AND ($3::uuid IS NULL OR project_id=$3) AND ($4::uuid IS NULL OR actor_user_id=$4) AND ($5::uuid IS NULL OR conversation_id=$5) AND removed_at IS NULL AND ($6::boolean IS NOT TRUE OR favorite) AND (NOT $7::boolean OR area IS NOT DISTINCT FROM $8::text) ORDER BY created_at DESC LIMIT 100`,[actor.payerId,type,projectId,actor.kind==='agent'?actor.id:null,conversationId,favorite===true,area.filter===true,area.area??null])).rows;
  return rows.map(generationView);
}
export async function approveGeneration(db,value,id,input,options={}){
  const actor=await generationActor(db,value);if(actor.kind!=='human')throw generationError('human_approval_required',403);
  await prepareAccountQuota(db,actor.id);
  return withTransaction(db,async tx=>{
    const row=await ownedRow(tx,actor,id,true);
    if(input.requestHash!==row.request_hash||input.version!==row.version)throw generationError('quote_changed',409);
    const tariff=(options.tariff||tariffFor)(row.request.type,row.request.model);
    verifyQuote(input.quoteToken,{actor:actor.id,payer:actor.payerId,hash:row.request_hash,tariff},options);
    if(row.state!=='awaiting_approval'){if(row.approved_by_user_id===actor.id)return generationView(row);throw generationError('generation_not_approvable',409);}
    await assertGenerationPlacement(tx,actor,row.request);await readGenerationReferences(tx,actor,row.request.referenceAssetIds,options);
    const updated=(await tx.query(`UPDATE media_generations SET state='queued',approved_by_user_id=$2,approved_at=now(),quote=$3,retail_cost_micro=$4,updated_at=now() WHERE id=$1 RETURNING *`,[id,actor.id,{quoteToken:input.quoteToken,requestHash:row.request_hash,tariffRevision:tariff.revision,maxRetailCredits:tariff.maxRetailCredits},tariff.maxRetailMicro])).rows[0];
    return generationView(updated);
  });
}
export async function cancelGeneration(db,value,id){
  const actor=await generationActor(db,value);
  return withTransaction(db,async tx=>{const row=await ownedRow(tx,actor,id,true);if(['succeeded','failed','cancelled'].includes(row.state))return generationView(row);
    return generationView((await tx.query(`UPDATE media_generations SET cancel_requested_at=now(),state=CASE WHEN state='awaiting_approval' THEN 'cancelled' ELSE 'cancel_requested' END,updated_at=now() WHERE id=$1 RETURNING *`,[id])).rows[0]);});
}
/** Mark or unmark a favorite. It changes nothing but the mark. */
export async function setGenerationFavorite(db,value,id,favorite){
  if(typeof favorite!=='boolean')throw generationError('invalid_favorite');
  const actor=await generationActor(db,value);await ownedRow(db,actor,id);
  return generationView((await db.query('UPDATE media_generations SET favorite=$2 WHERE id=$1 RETURNING *',[id,favorite])).rows[0]);
}
/** Remove a generation from the person's history. Work that is still running is refused: cancel it first,
    so nothing keeps running (and holding credits) out of sight. The row is kept as the record of the work
    and of what was charged; the result files stay in the Library, where they are managed. */
export async function removeGeneration(db,value,id){
  const actor=await generationActor(db,value);
  return withTransaction(db,async tx=>{
    const row=await ownedRow(tx,actor,id,true);
    if(!['succeeded','failed','cancelled'].includes(row.state))throw generationError('generation_in_progress',409);
    await tx.query('UPDATE media_generations SET removed_at=now() WHERE id=$1',[id]);
    return {id,removed:true};
  });
}
export async function retryGeneration(db,value,id,input,options={}){
  const actor=await generationActor(db,value),row=await ownedRow(db,actor,id);
  if(!['failed','cancelled'].includes(row.state))throw generationError('generation_not_retryable',409);
  if(input.requestKey===row.request_key)throw generationError('new_request_key_required',409);
  return createGeneration(db,value,{...row.request,requestKey:input.requestKey,quoteToken:input.quoteToken},options);
}
export async function assertGenerationConversation(db,value,ids,conversationId){
  if(!Array.isArray(ids)||ids.length>100)throw generationError('invalid_generations');
  if(!ids.length)return; // an ordinary message save names no generation: no identity read, no query
  const actor=await generationActor(db,value);
  for(const id of new Set(ids)){const row=await ownedRow(db,actor,id);if(row.conversation_id!==conversationId)throw generationError('generation_conversation_mismatch',404);}
}
