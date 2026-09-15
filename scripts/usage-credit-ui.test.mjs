import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

test('usage toggle persists only confirmed consent, handles failures, and never enables on purchase',async t=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/overview/billing'});
  const old=new Map();
  for(const k of ['window','document','navigator','HTMLElement','Node']) {old.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:dom.window[k]});}
  const previousFetch=globalThis.fetch;const previousAct=globalThis.IS_REACT_ACT_ENVIRONMENT;
  globalThis.IS_REACT_ACT_ENVIRONMENT=true;
  let q={metered:true,plan:'pro',usedPercent:100,resetsAt:'2026-09-21T00:00:00Z',exhausted:true,usageCreditsEnabled:false,usageCreditsBalance:500,canManageUsageCredits:true};
  const patches=[];let fail=false;let buying=0;
  globalThis.fetch=async (_url,init={})=>{
    if(init.method==='PATCH') {patches.push(JSON.parse(init.body));if(fail)return new Response(JSON.stringify({error:{message:'Not saved'}}),{status:503});q={...q,usageCreditsEnabled:JSON.parse(init.body).enabled};}
    return new Response(JSON.stringify(q),{status:200});
  };
  let root,act;
  t.after(async()=>{if(root)await act(async()=>root.unmount());dom.window.close();globalThis.fetch=previousFetch;globalThis.IS_REACT_ACT_ENVIRONMENT=previousAct;for(const[k,v]of old){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}});
  const output=await build({entryPoints:['src/components/account/AccountUsageCredits.tsx'],bundle:true,format:'esm',jsx:'automatic',external:['react'],loader:{'.css':'empty'},write:false});
  const React=await import('react');({act}=await import('react-dom/test-utils'));const {createRoot}=await import('react-dom/client');
  // Resolve React through a file URL; a data module cannot resolve bare packages.
  const source=output.outputFiles[0].text.replaceAll('from "react"',`from ${JSON.stringify(import.meta.resolve('react'))}`).replaceAll('from "react/jsx-runtime"',`from ${JSON.stringify(import.meta.resolve('react/jsx-runtime'))}`);
  const {default:Card}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Card,{onBuyCredits:()=>buying++})));
  const toggle=()=>document.querySelector('[role=switch]');
  assert.equal(toggle().getAttribute('aria-checked'),'false');
  assert.match(document.body.textContent,/Weekly limit reached/);
  assert.match(document.body.textContent,/500/);
  const buy=[...document.querySelectorAll('button')].find(b=>b.textContent==='Buy credits');
  await act(async()=>buy.click());assert.equal(buying,1);assert.equal(patches.length,0);
  await act(async()=>toggle().click());assert.equal(toggle().getAttribute('aria-checked'),'true');
  assert.deepEqual(patches,[{enabled:true}]);
  fail=true;await act(async()=>toggle().click());assert.equal(toggle().getAttribute('aria-checked'),'true');assert.match(document.querySelector('[role=alert]').textContent,/Not saved/);
  fail=false;await act(async()=>toggle().click());assert.equal(toggle().getAttribute('aria-checked'),'false');
});

test('both account pages mount the shared consent control',()=>{
  for(const name of ['BillingPage','UsageAnalyticsPage'])assert.match(readFileSync(`src/components/account/${name}.tsx`,'utf8'),/<AccountUsageCredits\s/);
});
