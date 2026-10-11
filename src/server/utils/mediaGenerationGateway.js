import { XENO_API_BASE, XENO_API_KEY, xenoModelCatalog } from './xenoChat.js';
import crypto from 'node:crypto';
import { resolvePrincipal } from '../services/agentIdentity.js';
import { generationError, UUID } from '../services/mediaGenerationCatalog.js';
export function createMediaGateway({base=XENO_API_BASE,key=XENO_API_KEY,fetchImpl=fetch}={}) {
  const call=async(path,{method='GET',body,idempotencyKey}={})=>{
    if(!key)throw generationError('gateway_unavailable',503);
    const response=await fetchImpl(`${base}${path}`,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${key}`,...(body?{'Content-Type':'application/json'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const chunks=[];let bytes=0;
    const maxBytes=path.endsWith('/result')?180*1024*1024:1024*1024;
    if(Number(response.headers.get('content-length'))>maxBytes){await response.body?.cancel();throw generationError('gateway_result_too_large',502);}
    for await(const chunk of response.body){bytes+=chunk.length;if(bytes>maxBytes){await response.body.cancel().catch(()=>{});throw generationError('gateway_result_too_large',502);}chunks.push(chunk);}
    const text=Buffer.concat(chunks).toString('utf8');
    let data;try{data=JSON.parse(text);}catch{throw generationError('gateway_invalid_response',502);}
    if(!response.ok){const error=generationError('gateway_refused',response.status);error.definitive=[400,401,403,404,413,422,429].includes(response.status)&&data?.error?.request_accepted!==true;throw error;}
    return data;
  };
  const jobPath=id=>{if(typeof id!=='string'||! /^[A-Za-z0-9_-]{1,160}$/.test(id))throw generationError('gateway_invalid_job',502);return `/jobs/${encodeURIComponent(id)}`;};
  return {models:()=>base===XENO_API_BASE&&key===XENO_API_KEY?xenoModelCatalog():call('/models').then(v=>v.data),
    identity:async(db)=>{
      const normalized=String(key||'').trim().replace(/^Bearer\s+/i,'');
      if(!normalized)throw generationError('gateway_payer_unavailable',503);
      const hash=crypto.createHash('sha256').update(normalized).digest('hex');
      const row=(await db.query(`SELECT k.user_id FROM api_keys k JOIN users u ON u.id=k.user_id
        WHERE k.key_hash=$1 AND k.key_prefix=$2 AND k.is_active=true
        AND (k.expires_at IS NULL OR k.expires_at>now()) AND u.is_active=true LIMIT 1`,[hash,normalized.slice(0,16)])).rows[0];
      if(!UUID.test(row?.user_id||''))throw generationError('gateway_payer_unavailable',503);
      const principal=await resolvePrincipal(db,row.user_id);
      if(!principal?.usable)throw generationError('gateway_payer_unavailable',503);
      return {payerId:principal.owner?.id||principal.id,credentialActorId:principal.id};
    },
    submit:(payload,idempotencyKey)=>call('/jobs',{method:'POST',body:payload,idempotencyKey}),
    status:id=>call(jobPath(id)),result:id=>call(`${jobPath(id)}/result`),cancel:id=>call(`${jobPath(id)}/cancel`,{method:'POST',body:{}})};
}
export const mediaGateway=createMediaGateway();
