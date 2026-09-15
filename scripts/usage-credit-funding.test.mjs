import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateFunding, consumeFunding, saveHoldFunding, readHoldFunding } from '../src/server/utils/usageCreditFunding.js';

function fixture({ enabled, lots = [], legacy = '0' } = {}) {
  const stored = [];
  const taken = [];
  return { stored, taken, async query(sql, p=[]) {
    if (sql.startsWith('SELECT enabled')) return { rows: enabled === undefined ? [] : [{enabled}] };
    if (sql.startsWith('SELECT g.id')) {
      assert.match(sql,/h.state='held'/);
      assert.match(sql,/g.expires_at>now\(\)/);
      assert.match(sql,/ORDER BY g.priority,g.expires_at ASC NULLS LAST,g.created_at,g.id FOR UPDATE OF g/);
      return { rows: lots };
    }
    if (sql.includes('AS reserved')) return {rows:[{reserved:legacy}]};
    if (sql.startsWith('DELETE FROM credit_hold_funding')) { stored.length=0; return {rows:[]}; }
    if (sql.startsWith('INSERT INTO credit_hold_funding')) { stored.push({grant_id:p[1],reserved_micro:p[2]}); return {rows:[]}; }
    if (sql.startsWith('SELECT grant_id')) return {rows:stored};
    if (sql.startsWith('UPDATE credit_grants')) { taken.push(p); return {rows:[{id:p[1]}]}; }
    throw Error(sql);
  }};
}
const lots = [{id:'a',kind:'allowance',available:'100'},{id:'promo',kind:'promo',available:'50'},{id:'paid',kind:'paid',available:'1000'}];
test('absent preference is OFF despite a funded paid balance',async()=>{
  await assert.rejects(()=>allocateFunding(fixture({lots}), 'u',101),e=>e.code==='QUOTA_EXCEEDED' && !!e.resetsAt);
});
test('explicit OFF uses allowance but never overflows',async()=>{
  const f=fixture({enabled:false,lots});
  assert.deepEqual(await allocateFunding(f,'u',100),[{grantId:'a',amountMicro:'100'}]);
  await assert.rejects(()=>allocateFunding(f,'u',101),{code:'QUOTA_EXCEEDED'});
});
test('ON reserves allowance then promo then purchased credits',async()=>{
  assert.deepEqual(await allocateFunding(fixture({enabled:true,lots}),'u',175),[
    {grantId:'a',amountMicro:'100'},{grantId:'promo',amountMicro:'50'},{grantId:'paid',amountMicro:'25'}]);
});
test('ON but empty wallet returns credit exhaustion, not quota refusal',async()=>{
  await assert.rejects(()=>allocateFunding(fixture({enabled:true}),'u',1),{code:'INSUFFICIENT_CREDITS'});
});
test('legacy holds reserve capacity too',async()=>{
  await assert.rejects(()=>allocateFunding(fixture({lots,legacy:'90'}),'u',11),{code:'QUOTA_EXCEEDED'});
});
test('concurrent reservations reduce the eligible allowance',async()=>{
  await assert.rejects(()=>allocateFunding(fixture({lots:[{...lots[0],available:'20'},lots[2]]}),'u',21),{code:'QUOTA_EXCEEDED'});
});
test('settle uses reserved funding, not a newly changed toggle',async()=>{
  const f=fixture({enabled:true,lots});
  const funding=await allocateFunding(f,'u',175);
  await saveHoldFunding(f,'hold',funding);
  const reserved=await readHoldFunding(f,'hold');
  await consumeFunding(f,reserved,130);
  assert.deepEqual(f.taken,[['100','a'],['30','promo']]);
});
test('settlement fails rather than silently consuming unreserved funds',async()=>{
  await assert.rejects(()=>consumeFunding(fixture(),[{grantId:'a',amountMicro:'5'}],6),{code:'FUNDING_CONFLICT'});
});
