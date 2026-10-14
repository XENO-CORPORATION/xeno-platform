import { createHash } from 'node:crypto';
import { getCreditCost } from '../utils/creditCosts.js';
import { xenoModelCatalog } from '../utils/xenoChat.js';
export const generationError = (code, status = 400) => Object.assign(new Error(code), { code, status });
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const option = (values, fallback) => ({ values, default: fallback });
const googleImage = ['nano_banana_2','nano_banana_pro','gemini-3.1-flash-image','gemini-3-pro-image'];
const googleVideo = ['veo_31_fast','veo_31_quality','veo_31_lite','veo-3.1-lite-generate-preview','veo-3.1-generate-preview','omni_11_flash','gemini-omni-1.1-flash'];
const gpt = ['gpt-image-2','gpt-image-2.5-flare','gpt-image-2.5-sunburst'];
// Gateway server.js buildGlabs*Request/Codex direct forwarding, read 2026-10-11.
// Intersect with RAW live /models; Grok absent until durable reference parity qualifies.
export function descriptorFor(id) {
  if (gpt.includes(id)) return { id,type:'image',endpoint:'/v1/images/generations',provider:'openai',
    settings:{ratio:option(['1:1','16:9','9:16','4:3','3:4','3:2','2:3'],'1:1'),quality:option(['low','medium','high','auto'],'medium')},references:{max:8},evidence:'gateway:codex-direct-image-forwarding:2026-10-11'};
  if (googleImage.includes(id)) return {id,type:'image',endpoint:'/v1/images/generations',provider:'google',settings:{ratio:option(['1:1','16:9','9:16','4:3','3:4'],'1:1')},references:{max:1},evidence:'gateway:glabs-image-forwarding:2026-10-11'};
  if (googleVideo.includes(id)) {
    const omni=['omni_11_flash','gemini-omni-1.1-flash'].includes(id);
    return {id,type:'video',endpoint:'/v1/videos/generations',provider:'google',settings:{ratio:option(['16:9','9:16'],'16:9'),mode:option(omni?['text_to_video','start_image','ingredients']:['text_to_video','start_image'],'text_to_video'),resolution:option(['720p'],'720p')},references:{max:omni?5:1},evidence:'gateway:glabs-video-forwarding:2026-10-11'};
  }
  return null;
}
export function tariffFor(type,model) {
  const maxRetailCredits=getCreditCost(type,model);
  const revision=createHash('sha256').update(JSON.stringify({version:1,type,model,maxRetailCredits})).digest('hex');
  return {revision,maxRetailCredits,maxRetailMicro:Math.round(maxRetailCredits*1_000_000)};
}
/**
 * The model each type starts on (owner, 2026-10-14: GPT Image 2.5 Sunburst for images). The Generate panel
 * and the chat both pick the catalog's FIRST model for a type the person has not chosen, so the order is a
 * product decision — it must not be whatever order the gateway happens to list. A house default that is not
 * available right now simply does not lead; the rest keep the gateway's order.
 */
export const HOUSE_DEFAULT_MODEL={image:'gpt-image-2.5-sunburst'};
export async function generationCatalog({models=xenoModelCatalog}={}) {
  let raw;try{raw=await models();}catch{throw generationError('catalog_unavailable',503);}
  if(!Array.isArray(raw)) throw generationError('catalog_unavailable',503);
  return {types:['image','video','audio','3d'].map(type=>{
    const qualified=raw.flatMap(row=>{
      const d=descriptorFor(row.id);
      if(!d||d.type!==type||row.execution?.endpoint!==d.endpoint||row.execution?.async!==true||row.available===false||row.enabled===false)return [];
      return [{...d,name:row.display_name||row.name||row.id,tariff:tariffFor(type,d.id)}];
    });
    const lead=qualified.findIndex(m=>m.id===HOUSE_DEFAULT_MODEL[type]);
    if(lead>0)qualified.unshift(...qualified.splice(lead,1));
    return {type,available:qualified.length>0,models:qualified,tariff:qualified[0]?.tariff||null,...(!qualified.length?{reason:type==='audio'||type==='3d'?'gateway_adapter_unqualified':'qualified_models_unavailable'}:{})};
  })};
}
export function canonicalJson(value){
  if(Array.isArray(value))return `[${value.map(canonicalJson).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const requestHash=value=>createHash('sha256').update(canonicalJson(value)).digest('hex');
export async function validateGenerationRequest(input,options={}){
  if(!input||typeof input!=='object'||Array.isArray(input))throw generationError('invalid_request');
  const keys=new Set(['type','model','prompt','settings','referenceAssetIds','projectId','conversationId','area','requestKey','quoteToken']);
  if(Object.keys(input).some(k=>!keys.has(k)))throw generationError('unsupported_parameter');
  const catalog=await generationCatalog(options);
  const descriptor=catalog.types.find(t=>t.type===input.type)?.models.find(m=>m.id===input.model);
  if(!descriptor)throw generationError('model_unavailable',422);
  if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>16000)throw generationError('invalid_prompt');
  const supplied=input.settings??{};
  if(!supplied||typeof supplied!=='object'||Array.isArray(supplied)||Object.keys(supplied).some(k=>!descriptor.settings[k]))throw generationError('unsupported_setting');
  const settings={};for(const [key,contract]of Object.entries(descriptor.settings)){const value=supplied[key]??contract.default;if(!contract.values.includes(value))throw generationError('unsupported_setting');settings[key]=value;}
  const refs=input.referenceAssetIds??[];
  if(!Array.isArray(refs)||refs.length>descriptor.references.max||new Set(refs).size!==refs.length||refs.some(id=>!UUID.test(id)))throw generationError('invalid_references');
  if(input.type==='video'&&((settings.mode==='text_to_video'&&refs.length)||(settings.mode==='start_image'&&refs.length!==1)||(settings.mode==='ingredients'&&!refs.length)))throw generationError('reference_mode_mismatch');
  for(const key of ['projectId','conversationId'])if(input[key]!=null&&!UUID.test(input[key]))throw generationError('invalid_placement');
  if(input.area!=null&&!/^[a-z][a-z0-9_-]{0,39}$/.test(input.area))throw generationError('invalid_area');
  return {request:{type:input.type,model:input.model,prompt:input.prompt,settings,referenceAssetIds:refs,projectId:input.projectId??null,conversationId:input.conversationId??null,area:input.area??null},descriptor};
}
export function gatewayBody(request,references){const {settings}=request;return {model:request.model,prompt:request.prompt,aspect_ratio:settings.ratio,...(settings.quality?{quality:settings.quality}:{}),...(request.type==='video'?{mode:settings.mode,resolution:[settings.resolution]}:{n:1}),...(references.length?{reference_images:references}:{})};}
