import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import router from '../src/server/routes/v2LedgerRoutes.js';
import { updateUsageCredits } from '../src/server/services/usageCreditsService.js';

const human={id:'u',username:'user',role:'user',status:'active',is_active:true};
function poolFor(row=human) {
 let enabled=false;const events=[];const writes=[];
 const query=async(sql,p=[])=>{
  if(sql.includes('LEFT JOIN agent_identities'))return {rows:row?[row]:[]};
  if(sql.startsWith('INSERT INTO usage_credit_preferences')){enabled=p[1];writes.push(p);return {rows:[]};}
  if(sql.startsWith('INSERT INTO usage_credit_consent_events')){events.push(p);return {rows:[]};}
  if(sql.includes('SELECT plan, status, current_period_end'))return {rows:[{plan:'pro',status:'active'}]};
  if(sql.includes('AS granted'))return {rows:[{granted:'2000000000',remaining:'0',other:'1000000'}]};
  if(sql.includes('AS enabled'))return {rows:[{enabled,credits:'1000000'}]};
  if(sql.includes('relationship_tuples'))return {rows:[]};
  if(sql.startsWith('CREATE TABLE'))return {rows:[]};
  if(sql.startsWith('SELECT id FROM credit_accounts'))return {rows:[{id:'acct'}]};
  if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
  throw Error('Unexpected SQL: '+sql);
 };
 return {query,previewReadOnly:true,connect:async()=>({query,release(){}}),events,writes};
}
test('only a usable human owner may change usage-credit consent',async()=>{
 for(const row of [null,{...human,role:'service'},{...human,id:'agent',owner_user_id:'u',agent_status:'active',owner_is_active:true,owner_status:'active',owner_role:'user'},{...human,is_active:false}]) {
  const db=poolFor(row);await assert.rejects(()=>updateUsageCredits(db,'actor',true));assert.equal(db.writes.length,0);
 }
});
test('consent requires an actual boolean, never a truthy string',async()=>{
 for(const value of ['true',1,null,undefined,{}])await assert.rejects(()=>updateUsageCredits(poolFor(),'u',value),{code:'BAD_REQUEST'});
});
test('HTTP account toggle saves ON and OFF with audit evidence and returns fresh quota',async()=>{
 const db=poolFor();const app=express();app.use(express.json());app.use((req,_res,next)=>{req.db=db;req.user={id:'u'};next();});app.use('/ledger',router);
 const server=await new Promise(r=>{const s=app.listen(0,'127.0.0.1',()=>r(s));});
 try {
  const base=`http://127.0.0.1:${server.address().port}/ledger`;
  let response=await fetch(base+'/quota');let q=await response.json();assert.equal(response.status,200);assert.equal(q.usageCreditsEnabled,false);assert.equal(q.usageCreditsBalance,1);
  for(const enabled of [true,false]){response=await fetch(base+'/usage-credits',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled})});q=await response.json();assert.equal(response.status,200,JSON.stringify(q));assert.equal(q.usageCreditsEnabled,enabled);assert.equal(q.canManageUsageCredits,true);assert.equal(q.usedPercent,100);}
  assert.deepEqual(db.events,[['u',true],['u',false]]);
 } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
