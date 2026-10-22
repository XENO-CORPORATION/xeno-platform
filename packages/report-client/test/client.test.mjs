import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createReportClient,serializeReport,redact,ReportAuthRequired,ReportSubmissionUncertain,ReportError} from '../dist/index.js';
import {redactAcpText} from '../vendor/acp-text-redaction.js';
const draft={kind:'bug',visibility:'private',title:'Canvas text overlaps',body:'A label crosses its container'};
const config={baseUrl:'http://127.0.0.1:8900',product:'spawn',version:'0.1.0-rc.15',buildId:'5d8b127',getAccessToken:()=> 'fixture-token'};
const id='01234567-abcd-4567-8123-012345678901';
test('compose is pure, immutable and shares canonical redaction',()=>{
  let collected=0;const client=createReportClient({...config,collectContext(){collected++;return {};}});
  const context={repro:'Bearer secret-abcdefghijklmnop at C:\\Users\\bnkr\\repo',recentLog:['xeno-'+ 'a'.repeat(48),'sk-'+ 'b'.repeat(24),'cookie=secret','/home/bnkr/.config','/Users/bnkr/file']};
  const result=client.compose({...draft,context});
  assert.equal(collected,0); assert.deepEqual(client.compose({...draft,context}),result);
  for(const raw of context.recentLog)assert.equal(redact(raw),redactAcpText(raw));
  assert.doesNotMatch(serializeReport(result.payload),/bnkr|secret-abc|aaaaaaa|bbbbbbb|cookie=secret/);
  assert.equal(result.redactions.length,6);
  assert.equal(Object.isFrozen(result.payload.context.recentLog),true);
  assert.throws(()=>{result.payload.body='changed';},TypeError);
  assert.equal(context.repro.includes('bnkr'),true);
  assert.equal(Object.isFrozen(context),false);
});
test('three kinds and two visibilities carry only selected context',()=>{
  const client=createReportClient(config);
  for(const kind of ['bug','feature','feedback']) for(const visibility of ['public','private']) {
    const {payload}=client.compose({...draft,kind,visibility});
    assert.equal(payload.kind,kind);assert.equal(payload.visibility,visibility);assert.deepEqual(payload.context,{});
  }
});
test('quoted JSON credentials and OAuth token labels use the same canonical policy',()=>{
  for(const raw of ['{"password":"secret with spaces"}','access_token=opaquecredential','refreshToken: opaquecredential',"api_key='quoted secret'"]) {
    assert.equal(redact(raw),redactAcpText(raw));
    assert.doesNotMatch(redact(raw),/secret with spaces|opaquecredential|quoted secret/);
  }
});
test('the preview is the exact POST body and receipt visibility is verified',async()=>{
  let sent; const client=createReportClient({...config,fetch:async(url,init)=>{sent={url,init};return Response.json({success:true,ok:true,shortId:'ticket01',private:true});}});
  const {payload}=client.compose(draft);
  const receipt=await client.submit(payload,{submissionId:id});
  assert.equal(sent.init.body,serializeReport(payload));assert.equal(sent.init.headers['Idempotency-Key'],id);
  assert.equal(sent.init.headers.Authorization,'Bearer fixture-token');assert.equal(sent.init.redirect,'error');
  assert.equal(receipt.private,true);assert.equal(receipt.url,undefined);
});
test('signed-out submission, history, notifications and preflight refuse before network',async()=>{
  let calls=0;const client=createReportClient({...config,getAccessToken:()=>null,fetch:async()=>{calls++;throw new Error('unexpected');}});
  const {payload}=client.compose(draft);
  for(const fn of [()=>client.submit(payload),()=>client.mine(),()=>client.notifications(),()=>client.preflight(draft.title),()=>client.recover(id)])
    await assert.rejects(fn,ReportAuthRequired);
  assert.equal(calls,0);
});
test('lost response carries a stable ID; retry preserves ID and bytes',async()=>{
  const calls=[];const client=createReportClient({...config,fetch:async(url,init)=>{calls.push(init);if(calls.length===1)throw new Error('connection lost');return Response.json({ok:true,private:true,shortId:'ticket01'});}});
  const {payload}=client.compose(draft);
  let failedId;
  await assert.rejects(client.submit(payload),e=>{assert.ok(e instanceof ReportSubmissionUncertain);failedId=e.submissionId;return true;});
  await client.submit(payload);
  assert.equal(calls[0].headers['Idempotency-Key'],failedId);assert.deepEqual(calls[0],calls[1]);
});
test('a mismatched destination or malformed success is uncertain, never a receipt',async()=>{
  for(const body of [{ok:true,shortId:'public01',private:false},{ok:true,private:true}]) {
    const client=createReportClient({...config,fetch:async()=>Response.json(body)});
    await assert.rejects(client.submit(client.compose(draft).payload,{submissionId:id}),ReportSubmissionUncertain);
  }
});
test('raw secrets, extra fields, attachments and private joins cannot bypass compose',async()=>{
  let calls=0;const client=createReportClient({...config,fetch:async()=>{calls++;throw new Error('unexpected');}});
  const {payload}=client.compose(draft);
  for(const patch of [{body:'password=rawsecret'},{rawSecret:'raw'},{context:{attachments:[{name:'screen.png'}]}},{joinShortId:'public01'}])
    await assert.rejects(client.submit({...payload,...patch}),ReportError);
  assert.equal(calls,0);
});
test('receipt recovery uses the authenticated principal and exposes not_observed without declaring failure',async()=>{
  let target;const client=createReportClient({...config,fetch:async(url)=>{target=url;return Response.json({state:'not_observed',receipt:null});}});
  assert.deepEqual(await client.recover(id),{state:'not_observed',receipt:null});assert.match(target,/\/report\/submissions\//);
});
test('credential transport refuses insecure remote origins',()=>{
  assert.throws(()=>createReportClient({...config,baseUrl:'http://example.com'}),ReportError);
  assert.throws(()=>createReportClient({...config,baseUrl:'https://name:secret@example.com'}),ReportError);
});
test('packed runtime and declarations have no external source or native dependency',async()=>{
  const runtime=await readFile(new URL('../dist/index.js',import.meta.url),'utf8');
  const types=await readFile(new URL('../dist/index.d.ts',import.meta.url),'utf8');
  const redactionTypes=await readFile(new URL('../dist/redaction.d.ts',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/^import /m);assert.doesNotMatch(runtime,/from ['"](?:node:|path)/);
  assert.doesNotMatch(types+redactionTypes,/xeno-agent-interface|\.\.\/\.\.\//);
});
