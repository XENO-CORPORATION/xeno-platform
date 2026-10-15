import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withTransaction, userPrincipal, linkAssetToProject } from '../services/chatProjectAuthority.js';
import { generationActor, assertGenerationPlacement, uploadGenerationReferences } from '../services/mediaGenerations.js';
import { validateGenerationRequest, gatewayBody, generationError } from '../services/mediaGenerationCatalog.js';
import { registerManagedLibraryFile, getAuthorizedLibraryFile, sniffMime } from '../services/libraryAssets.js';
import { prepareAccountQuota } from '../services/usageCreditsService.js';
import { holdV2Tx, settleHoldV2, voidHoldV2 } from '../utils/creditLedgerV2.js';
import { mediaGateway } from '../utils/mediaGenerationGateway.js';
import { fetchMediaResult, MAX_RESULT_BYTES } from '../utils/mediaResultFetch.js';
import { resolveEntitlements } from '../utils/entitlementGate.js';
import { watermarkBuffer } from '../utils/watermark.js';
const uploads=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../uploads');
const terminal=['succeeded','failed','cancelled'];
async function update(db,row,values){
  const entries=Object.entries(values),set=entries.map(([key],i)=>`${key}=$${i+3}`).join(',');
  const result=await db.query(`UPDATE media_generations SET ${set},updated_at=now() WHERE id=$1 AND lease_owner=$2 RETURNING *`,[row.id,row.lease_owner,...entries.map(([,v])=>v)]);
  if(!result.rows[0])throw generationError('generation_lease_lost',409);Object.assign(row,result.rows[0]);
}
async function outputBytes(item,type,options){
  let result;
  if(typeof item.b64_json==='string'){
    if(item.b64_json.length>Math.ceil(MAX_RESULT_BYTES*4/3)+4||! /^[A-Za-z0-9+/]*={0,2}$/.test(item.b64_json))throw generationError('result_too_large',413);
    result={bytes:Buffer.from(item.b64_json,'base64'),mime:item.mime_type|| (type==='video'?'video/mp4':'image/png')};
  }else if(typeof item.url==='string') result=await (options.fetchResult||fetchMediaResult)(item.url);
  else throw generationError('invalid_provider_result',502);
  if(!result.bytes.length||result.bytes.length>MAX_RESULT_BYTES)throw generationError('result_too_large',413);
  const mime=type==='image'?sniffMime(result.bytes,'application/octet-stream'):result.mime;
  if(type==='image'&&!['image/png','image/jpeg','image/webp'].includes(mime))throw generationError('invalid_provider_result',502);
  if(type==='video'&&(mime!=='video/mp4'||result.bytes.subarray(4,8).toString()!=='ftyp'))throw generationError('invalid_provider_result',502);
  return {...result,mime};
}
async function importOutputs(db,row,options){
  const items=row.provider_result?.data;
  if(!Array.isArray(items)||items.length!==1)throw generationError('invalid_provider_result',502);
  const dir=options.uploadsDir||uploads;await fs.mkdir(dir,{recursive:true});
  for(let ordinal=0;ordinal<items.length;ordinal++){
    if((await db.query('SELECT 1 FROM media_generation_outputs WHERE generation_id=$1 AND ordinal=$2',[row.id,ordinal])).rowCount)continue;
    const result=await outputBytes(items[ordinal],row.request.type,options);
    // Free output is watermarked FAIL-CLOSED, as in chatImageTool: a clean file never reaches a Free account.
    if((await (options.resolveEntitlements||resolveEntitlements)(db,row.owner_user_id))?.watermark){
      if(row.request.type!=='image')throw generationError('plan_watermark_unsupported',403);
      result.bytes=await (options.watermark||watermarkBuffer)(result.bytes);
      if(!result.bytes?.length)throw generationError('watermark_failed',502);
    }
    const extension={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4'}[result.mime];
    const filename=`generation-${row.id}-${ordinal}.${extension}`,storagePath=path.join(dir,filename);
    const temporary=`${storagePath}.${crypto.randomUUID()}.tmp`;await fs.writeFile(temporary,result.bytes,{flag:'wx'});await fs.rename(temporary,storagePath);
    await withTransaction(db,async tx=>{
      const locked=(await tx.query('SELECT lease_owner FROM media_generations WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
      if(locked?.lease_owner!==row.lease_owner)throw generationError('generation_lease_lost',409);
      if((await tx.query('SELECT 1 FROM media_generation_outputs WHERE generation_id=$1 AND ordinal=$2',[row.id,ordinal])).rowCount)return;
      const asset=await registerManagedLibraryFile(tx,{transaction:true,userId:row.owner_user_id,filename,originalName:filename,mimeType:result.mime,fileSize:result.bytes.length,storagePath,area:row.request.area,metadata:{source:'media-generation',generationId:row.id,model:row.request.model,prompt:row.request.prompt}});
      await tx.query('INSERT INTO media_generation_outputs(generation_id,ordinal,asset_id) VALUES ($1,$2,$3)',[row.id,ordinal,asset.id]);
      await tx.query('UPDATE media_generations SET result_asset_ids=array_append(result_asset_ids,$2),updated_at=now() WHERE id=$1',[row.id,asset.id]);
    });
  }
  row.result_asset_ids=(await db.query('SELECT result_asset_ids FROM media_generations WHERE id=$1',[row.id])).rows[0].result_asset_ids;
  for(const assetId of row.result_asset_ids){
    const file=await getAuthorizedLibraryFile(db,userPrincipal(row.owner_user_id),assetId);
    if(!file?.ingestion_safe){await update(db,row,{state:'importing',error_code:'output_scan_pending'});return false;}
    if(row.project_id)await linkAssetToProject(db,{principal:userPrincipal(row.owner_user_id),projectId:row.project_id,assetId});
  }
  return true;
}
async function finishFailure(db,row,state,code){
  const hold=(await db.query('SELECT state FROM credit_holds WHERE user_id=$1 AND hold_id=$2',[row.owner_user_id,row.hold_id])).rows[0];
  if(hold?.state==='held')await voidHoldV2(db,row.owner_user_id,row.hold_id);
  // what an agent reserved against its division for this generation is given back: nothing was charged
  await db.query(`UPDATE agent_spend_log SET state='released' WHERE ref=$1 AND state='reserved'`,[`generation:${row.id}`]).catch(e=>console.error('[media] release division budget',e.message));
  await withTransaction(db,async tx=>{await update(tx,row,{state,error_code:code});await tx.query('UPDATE credit_holds SET media_committed=false WHERE media_generation_id=$1 AND state<>\'held\'',[row.id]);});
}
async function execute(db,row,options){
  const gateway=options.gateway||mediaGateway;
  if(row.provider_result){
    if(!await importOutputs(db,row,options))return;
    await settleHoldV2(db,row.owner_user_id,row.hold_id,Number(row.retail_cost_micro),{model:row.request.model,provider:'xeno',dimensions:{usage_source:'unit',units:row.result_asset_ids.length,route_path:'premium',generation_id:row.id}});
    const hold=(await db.query('SELECT state FROM credit_holds WHERE user_id=$1 AND hold_id=$2',[row.owner_user_id,row.hold_id])).rows[0];
    if(hold?.state!=='settled')throw generationError('generation_settlement_unresolved',503);
    await withTransaction(db,async tx=>{await update(tx,row,{state:'succeeded',error_code:null});await tx.query('UPDATE credit_holds SET media_committed=false WHERE media_generation_id=$1',[row.id]);});return;
  }
  if(!row.gateway_request){
    if(row.cancel_requested_at){await finishFailure(db,row,'cancelled',null);return;}
    const actor=await generationActor(db,row.actor_user_id);await assertGenerationPlacement(db,actor,row.request);
    await prepareAccountQuota(db,row.actor_user_id);
    const {descriptor}=await validateGenerationRequest(row.request,{models:gateway.models});
    const identity=await gateway.identity(db);
    // The gateway credential's wallet carries provider COST; this hold is the person's retail CHARGE:
    // two ledgers with two meanings. The payer is recorded for audit, never used to refuse.
    if(!identity?.payerId)throw generationError('gateway_payer_unavailable',503);
    // A plan whose output must be watermarked cannot take a type we cannot watermark: refuse BEFORE any hold or provider call.
    if(row.request.type!=='image'&&(await (options.resolveEntitlements||resolveEntitlements)(db,row.owner_user_id))?.watermark)throw generationError('plan_watermark_unsupported',403);
    // A queued job refuses inline media, so the references become gateway assets and the job names their ids.
    // With no references this is the plain path and nothing is uploaded.
    const references=row.request.referenceAssetIds.length
      ? await uploadGenerationReferences(db,actor,row.request.referenceAssetIds,{...options,uploadsDir:options.uploadsDir||uploads,gateway})
      : [];
    const payload={endpoint:descriptor.endpoint,body:gatewayBody(row.request,references),metadata:{platform_generation_id:row.id}};
    await withTransaction(db,async tx=>{
      const locked=(await tx.query('SELECT * FROM media_generations WHERE id=$1 FOR UPDATE',[row.id])).rows[0];
      if(locked.lease_owner!==row.lease_owner)throw generationError('generation_lease_lost',409);
      if(locked.cancel_requested_at){await update(tx,row,{state:'cancel_requested',cancel_requested_at:locked.cancel_requested_at});return;}
      const existing=(await tx.query('SELECT state FROM credit_holds WHERE user_id=$1 AND hold_id=$2 FOR UPDATE',[row.owner_user_id,row.hold_id])).rows[0];
      if(existing&&existing.state!=='held')throw generationError('hold_not_active',409);
      await holdV2Tx(tx,row.owner_user_id,{holdId:row.hold_id,amountMicro:Number(row.retail_cost_micro),surface:'xeno_platform',operation:`generation.${row.request.type}`,expiresInSeconds:900});
      await tx.query('UPDATE credit_holds SET media_generation_id=$3,media_committed=true WHERE user_id=$1 AND hold_id=$2 AND state=\'held\'',[row.owner_user_id,row.hold_id,row.id]);
      await update(tx,row,{state:'submitting',gateway_request:payload,gateway_payer_id:identity.payerId,error_code:null});
    });
    if(!row.gateway_request)return;
  }
  // Intent/bytes/key are durable before this call. A lost ACK replays the SAME key and payload.
  let job;
  if(!row.gateway_job_id){
    try{job=await gateway.submit(row.gateway_request,row.gateway_key);}catch(error){if(error.definitive){await finishFailure(db,row,'failed','gateway_refused');return;}await update(db,row,{state:row.cancel_requested_at?'cancel_requested':'reconciling',error_code:'provider_acceptance_unknown'});return;}
    if(!job?.id)throw generationError('provider_acceptance_unknown',502);
    await update(db,row,{gateway_job_id:job.id,upstream_billing:job.billing||null,state:'running',error_code:null});
  }
  // Re-read cancellation after network awaits: a concurrent user cancel cannot be overwritten
  // by a stale leased snapshot. Even if a worker missed it, the persisted intent remains durable.
  row.cancel_requested_at=(await db.query('SELECT cancel_requested_at FROM media_generations WHERE id=$1',[row.id])).rows[0]?.cancel_requested_at;
  job=await gateway.status(row.gateway_job_id);
  if(row.cancel_requested_at&&!['succeeded','failed','cancelled','expired'].includes(job.status))job=await gateway.cancel(row.gateway_job_id);
  await update(db,row,{upstream_billing:job.billing||null});
  if(job.status==='succeeded'){
    const result=await gateway.result(row.gateway_job_id);
    await update(db,row,{provider_result:result,state:'importing',error_code:null});
    return execute(db,row,options);
  }
  if(['failed','cancelled','expired'].includes(job.status)){await finishFailure(db,row,job.status==='cancelled'?'cancelled':'failed',job.status==='cancelled'?null:'provider_failed');return;}
  await update(db,row,{state:row.cancel_requested_at?'cancel_requested':(['queued','running'].includes(job.status)?'running':'reconciling'),error_code:null});
}
export async function runMediaGenerationBatch(db,options={}){
  const token=crypto.randomUUID();
  const rows=await withTransaction(db,async tx=>(await tx.query(`UPDATE media_generations SET lease_owner=$1,lease_expires_at=now()+interval '180 seconds' WHERE id IN (SELECT id FROM media_generations WHERE state NOT IN ('awaiting_approval','succeeded','failed','cancelled') AND next_attempt_at<=now() AND (lease_expires_at IS NULL OR lease_expires_at<now()) ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING *`,[token,Math.min(options.limit||2,10)])).rows);
  for(const row of rows){
    try{await execute(db,row,options);}catch(error){
      if(error.code==='generation_lease_lost')continue;
      // Storage, scan, network, settlement faults after durable submit are pending, never failed.
      if(row.gateway_request)await update(db,row,{state:row.provider_result?'importing':row.cancel_requested_at?'cancel_requested':'reconciling',error_code:row.provider_result?'output_import_pending':'provider_reconciliation_pending'});
      else await finishFailure(db,row,'failed',['INSUFFICIENT_CREDITS','USAGE_CREDITS_DISABLED','gateway_payer_unavailable','plan_watermark_unsupported','reference_forbidden','reference_not_ready'].includes(error.code)?error.code:'generation_admission_refused');
    }finally{await db.query(`UPDATE media_generations SET lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=now()+interval '5 seconds' WHERE id=$1 AND lease_owner=$2`,[row.id,token]);}
  }
  return rows.length;
}
export function startMediaGenerationWorker(db,options={}){
  let busy=false,stopped=false;
  const tick=async()=>{if(busy||stopped)return;busy=true;try{await runMediaGenerationBatch(db,options);}catch(error){console.error('[MediaGenerations] worker failure',error.code||'database_unavailable');}finally{busy=false;}};
  const timer=setInterval(tick,5000);timer.unref?.();void tick();return ()=>{stopped=true;clearInterval(timer);};
}
