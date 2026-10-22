import {redact} from './redaction.js';
export {redact} from './redaction.js';
export type ReportKind='bug'|'feature'|'feedback';
export type ReportVisibility='public'|'private';
export interface ReportAttachment {id:string;name:string;type:string;bytes:number;sha256:string;data:string}
export interface ReportContext {recentLog?:string[];repro?:string;attachments?:ReportAttachment[]}
export interface ReportPayload {
  schema:'xeno.report/1'|'xeno.report/2';kind:ReportKind;visibility:ReportVisibility;product:string;
  version?:string;buildId?:string;os?:string;title:string;body:string;joinShortId?:string;context:ReportContext;
}
export interface ReportDraft {kind:ReportKind;visibility:ReportVisibility;title:string;body:string;os?:string;joinShortId?:string;context?:ReportContext}
export interface ReportReceipt {ok?:boolean;shortId:string;private:boolean;joined?:boolean;postId?:string;url?:string}
export interface ReportClientOptions {
  baseUrl:string;product:string;version?:string;buildId?:string;
  getAccessToken:()=>string|null|Promise<string|null>;
  session?:{getUserId:()=>string|null;getCsrfToken:()=>string|null};
  collectContext?:()=>ReportContext|Promise<ReportContext>;
  fetch?:typeof globalThis.fetch;
}
export class ReportError extends Error {
  constructor(message:string,public code:string,public status=0){super(message);this.name='ReportError';}
}
export class ReportAuthRequired extends ReportError {
  constructor(){super('Sign in to send or read your reports','report_auth_required',401);this.name='ReportAuthRequired';}
}
export class ReportSubmissionUncertain extends ReportError {
  constructor(public submissionId:string){super('The submission response was lost. Recover or retry this same submission ID.','report_submission_uncertain');this.name='ReportSubmissionUncertain';}
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const keys=['schema','kind','visibility','product','version','buildId','os','title','body','joinShortId','context'];
function invalid(message:string):never {throw new ReportError(message,'invalid_report',400);}
function validate(payload:ReportPayload):void {
  if(!payload || typeof payload!=='object' || Array.isArray(payload) || Object.keys(payload).some(k=>!keys.includes(k))) invalid('Invalid report fields');
  if(!['xeno.report/1','xeno.report/2'].includes(payload.schema) || !['bug','feature','feedback'].includes(payload.kind) || !['public','private'].includes(payload.visibility)) invalid('Invalid report destination or kind');
  if(!/^[a-z0-9][a-z0-9-]{0,31}$/.test(payload.product)) invalid('Invalid product');
  for(const [key,max] of [['title',200],['body',16000],['version',32],['buildId',120],['os',120]] as const) {
    const value=payload[key];
    if(value!==undefined && (typeof value!=='string' || value.length>max)) invalid(`Invalid ${key}`);
    if(typeof value==='string' && redact(value,Number.MAX_SAFE_INTEGER)!==value) invalid('Compose and review the redacted payload before sending');
  }
  if(typeof payload.title!=='string' || payload.title.trim().length<8 || typeof payload.body!=='string' || !payload.body.trim()) invalid('A title and description are required');
  if(payload.joinShortId!==undefined && (payload.visibility!=='public' || !/^[a-z0-9]{4,32}$/.test(payload.joinShortId))) invalid('Only public reports can join an existing report');
  const c=payload.context;
  if(!c || typeof c!=='object' || Array.isArray(c) || Object.keys(c).some(k=>!['recentLog','repro','attachments'].includes(k))) invalid('Invalid context');
  if(c.recentLog!==undefined && (!Array.isArray(c.recentLog) || c.recentLog.length>200 || c.recentLog.some(s=>typeof s!=='string' || s.length>4000))) invalid('Invalid recent log');
  if(c.repro!==undefined && (typeof c.repro!=='string' || c.repro.length>10000)) invalid('Invalid reproduction steps');
  if(c.attachments!==undefined) {
    if(!Array.isArray(c.attachments) || c.attachments.length>3 || (payload.schema==='xeno.report/1' && c.attachments.length))invalid('Invalid attachments');
    let total=0;
    for(const a of c.attachments){
      if(!a || !uuid.test(a.id) || !/^[a-f0-9]{64}$/.test(a.sha256) || typeof a.name!=='string' || a.name.length>120 || !['image/png','image/jpeg','image/webp','video/webm','video/mp4'].includes(a.type) || !Number.isSafeInteger(a.bytes) || a.bytes<1 || a.bytes>8*1024*1024 || typeof a.data!=='string' || a.data.length!==4*Math.ceil(a.bytes/3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data))invalid('Invalid attachment');
      total+=a.bytes;
    }
    if(total>12*1024*1024)invalid('Attachments exceed 12 MiB');
  }
  if([...(c.recentLog??[]),c.repro??''].some(s=>redact(s,Number.MAX_SAFE_INTEGER)!==s)) invalid('Review redacted context before sending');
  if(JSON.stringify({...c,attachments:undefined}).length>12000) invalid('Context is too large');
  const env=[`- product: ${payload.product}`,payload.version?`- version: ${payload.version}`:null,payload.os?`- os: ${payload.os}`:null,payload.buildId?`- build: ${payload.buildId}`:null].filter(Boolean).join('\n');
  const contextText=JSON.stringify({...c,attachments:undefined});
  if(`${payload.body.trim()}\n\n---\n${env}${contextText}`.length>19000) invalid('Report and context are too large');
}
/** Pure serialization. The preview and POST body use this exact string. */
export function serializeReport(payload:ReportPayload):string {validate(payload);return JSON.stringify(payload,null,2);}
export function newReportSubmissionId():string {return globalThis.crypto.randomUUID();}

export function createReportClient(options:ReportClientOptions) {
  const origin=new URL(options.baseUrl);
  if(!/^[a-z0-9][a-z0-9-]{0,31}$/.test(options.product))invalid('Invalid product');
  if(origin.protocol!=='https:' && !(origin.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(origin.hostname)))
    throw new ReportError('Report credentials require HTTPS','invalid_report_origin');
  if(origin.username || origin.password || origin.search || origin.hash) throw new ReportError('Invalid report origin','invalid_report_origin');
  const base=origin.href.replace(/\/$/,'')+'/api/forum';
  if(options.session && (typeof location==='undefined' || origin.origin!==location.origin || origin.pathname!=='/'))invalid('Session reports require the current origin');
  const send=options.fetch??globalThis.fetch;
  const submissions=new WeakMap<object,string>();
  async function request(path:string,init:RequestInit={},submissionId?:string):Promise<any> {
    const token=await options.getAccessToken();
    if(!token && !options.session?.getUserId()) throw new ReportAuthRequired();
    const csrf=options.session?.getCsrfToken();
    const actor=options.session?.getUserId();
    let response:Response;
    try {response=await send(base+path,{...init,redirect:'error',...(options.session?{credentials:'same-origin' as RequestCredentials}:{}),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{'x-xeno-surface':'xeno-web',...(csrf?{'x-xeno-csrf':csrf}:{}),...(actor?{'x-xeno-report-actor':actor}:{})}),...(submissionId?{'Idempotency-Key':submissionId}:{})}});}
    catch {if(submissionId) throw new ReportSubmissionUncertain(submissionId);throw new ReportError('Report service could not be reached','report_service_unreachable');}
    if(response.status===401) throw new ReportAuthRequired();
    let body:any;
    try {body=await response.json();} catch {if(submissionId) throw new ReportSubmissionUncertain(submissionId);throw new ReportError('Invalid report service response','report_invalid_response',response.status);}
    if(!response.ok || body?.success===false) {
      if(submissionId && response.status>=500) throw new ReportSubmissionUncertain(submissionId);
      throw new ReportError(body?.error??'Report request failed',body?.code??'report_request_failed',response.status);
    }
    return body;
  }
  return {
    collectContext:async():Promise<ReportContext>=>options.collectContext?options.collectContext():{},
    compose(draft:ReportDraft) {
      const redactions:{field:string}[]=[];
      const clean=(text:string,field:string)=>{if(typeof text!=='string')invalid(`Invalid ${field}`);const result=redact(text,Number.MAX_SAFE_INTEGER);if(result!==text)redactions.push({field});return result;};
      const context:ReportContext={};
      if(draft.context?.recentLog!==undefined) context.recentLog=draft.context.recentLog.map((s,i)=>clean(s,`context.recentLog.${i}`));
      if(draft.context?.repro!==undefined) context.repro=clean(draft.context.repro,'context.repro');
      if(draft.context?.attachments!==undefined) context.attachments=draft.context.attachments.map(a=>Object.freeze({...a,name:clean(a.name,'attachment.name')}));
      if(draft.context && Object.keys(draft.context).some(k=>!['recentLog','repro','attachments'].includes(k)))invalid('Unknown context field');
      const payload:ReportPayload={schema:'xeno.report/2',product:options.product,kind:draft.kind,visibility:draft.visibility,
        title:clean(draft.title,'title').trim(),body:clean(draft.body,'body').trim(),context,
        ...(options.version!==undefined?{version:clean(options.version,'version')}:{}),
        ...(options.buildId!==undefined?{buildId:clean(options.buildId,'buildId')}:{}),
        ...(draft.os!==undefined?{os:clean(draft.os,'os')}:{}),...(draft.joinShortId!==undefined?{joinShortId:draft.joinShortId}:{})};
      validate(payload);
      if(context.recentLog)Object.freeze(context.recentLog);
      if(context.attachments)Object.freeze(context.attachments);
      Object.freeze(context);Object.freeze(payload);
      return {payload,redactions};
    },
    async preflight(title:string) {
      const clean=redact(title,240).trim();
      if(clean.length<8)return [];
      const result=await request('/report/preflight',{method:'POST',body:JSON.stringify({title:clean,product:options.product})});
      return result.candidates??[];
    },
    async submit(payload:ReportPayload,{submissionId}:{submissionId?:string}={}):Promise<ReportReceipt> {
      const body=serializeReport(payload);
      const id=submissionId??submissions.get(payload)??newReportSubmissionId();
      if(!uuid.test(id))invalid('Invalid submission ID');
      submissions.set(payload,id);
      const result=await request('/report',{method:'POST',body},id);
      if(typeof result?.shortId!=='string' || !/^[a-z0-9]{4,32}$/.test(result.shortId) || result.private!==(payload.visibility==='private'))throw new ReportSubmissionUncertain(id);
      return {...result,private:payload.visibility==='private',...(payload.visibility==='public'?{url:`${origin.origin}/forum/t/${result.shortId}`}:{})};
    },
    async recover(submissionId:string) {if(!uuid.test(submissionId))invalid('Invalid submission ID');return request(`/report/submissions/${encodeURIComponent(submissionId)}`);},
    async mine(){return request('/report/mine');},
    async notifications(){return request('/notifications?unread=true');},
  };
}
