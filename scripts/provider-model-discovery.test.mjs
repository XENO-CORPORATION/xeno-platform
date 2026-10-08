import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProviderModels } from '../src/server/services/providerModelDiscovery.js';
import { discoverCredentialModels } from '../src/server/services/providerCredentials.js';
const response = body => ({status:200,body:JSON.stringify(body)});

test('Anthropic discovery uses key-scoped pagination and keeps only safe model metadata', async () => {
 const calls=[];
 const result=await fetchProviderModels({provider:'anthropic',secret:'fixture-secret'},async(url,options)=>{
  calls.push({url,options});
  return calls.length===1 ? response({data:[{id:'claude-example',secret:'hidden',display_name:'hidden'}],has_more:true,last_id:'claude-example'})
   : response({data:[{id:'claude-other',context_window:1000000,max_output_tokens:64000},{id:'unsafe fixture-secret'},{id:'fixture-secret'}],has_more:false});
 });
 assert.equal(calls[0].options.headers['x-api-key'],'fixture-secret');
 assert.equal(new URL(calls[1].url).searchParams.get('after_id'),'claude-example');
 assert.equal(calls[0].url.includes('fixture-secret'),false);
 assert.deepEqual(result.models,[{id:'claude-example'},{id:'claude-other',context_window:1000000,max_output_tokens:64000}]);
 assert.equal(result.complete,true);
});

test('Google catalogs normalize model ids and bounded limits',async()=>{
 const r=await fetchProviderModels({provider:'google',secret:'fixture'},async(url,options)=>{
  assert.equal(options.headers['x-goog-api-key'],'fixture');
  return response({models:[{name:'models/gemini-example',inputTokenLimit:12345,outputTokenLimit:1000}]});
 });
 assert.deepEqual(r.models,[{id:'gemini-example',context_window:12345,max_output_tokens:1000}]);
});

test('provider refusals, malformed catalogs and network errors never expose secrets or raw bodies',async()=>{
 for(const fixture of [{status:403,body:'fixture-secret'}, {status:404,body:'fixture-secret'},response({error:{message:'fixture-secret'}})]){
  await assert.rejects(fetchProviderModels({provider:'anthropic',secret:'fixture-secret'},async()=>fixture),e=>!e.message.includes('fixture-secret'));
 }
 await assert.rejects(fetchProviderModels({provider:'compatible',baseUrl:'https://example.test/v1',secret:'fixture-secret'},async()=>{throw new Error('Authorization fixture-secret')}),e=>e.code==='model_discovery_unavailable'&&!e.message.includes('fixture-secret'));
});

test('repeating pagination fails and response pagination cannot redirect credentials',async()=>{
 let count=0;
 await assert.rejects(fetchProviderModels({provider:'anthropic',secret:'fixture'},async url=>{
  assert.equal(new URL(url).hostname,'api.anthropic.com');count++;
  return response({data:[{id:'claude-example'}],has_more:true,last_id:'repeated'});
 }),e=>e.code==='model_catalog_invalid');
 assert.equal(count,2);
});

test('key ownership is checked before provider lookup or decrypt',async()=>{
 let sql,params;
 await assert.rejects(discoverCredentialModels({query:async(s,p)=>{sql=s;params=p;return {rows:[]}}},'owner','other-key'),e=>e.code==='credential_not_found');
 assert.match(sql,/id=\$1 AND user_id=\$2/);assert.deepEqual(params,['other-key','owner']);
});
