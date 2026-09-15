import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer';
const out=await build({stdin:{contents:"import React from 'react';import {createRoot} from 'react-dom/client';import Card from './src/components/account/AccountUsageCredits';createRoot(document.getElementById('root')).render(<Card onBuyCredits={()=>window.bought=true}/>);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,format:'iife',loader:{'.css':'empty'},write:false});
let enabled=false;let saves=0;
const html=`<!doctype html><style>:root{--xeno-theme-border:#343434;--xeno-theme-surface:#181818;--xeno-theme-text:#eeeeee;--xeno-theme-text-muted:#aaaaaa;--xeno-theme-surface-subtle:#252525}body{background:#101010;margin:24px;font:14px system-ui}.xeno-page-button{padding:10px;border:1px solid #555;border-radius:6px;background:#222;color:white}${readFileSync('src/components/account/account-usage-credits.css','utf8')}</style><div id="root"></div><script>${out.outputFiles[0].text}</script>`;
const server=http.createServer(async(req,res)=>{
 if(req.url.startsWith('/api/')) {
  if(req.method==='PATCH'){let s='';for await(const d of req)s+=d;enabled=JSON.parse(s).enabled;saves++;}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({metered:true,plan:'pro',usedPercent:100,resetsAt:'2026-09-21T00:00:00Z',exhausted:true,usageCreditsEnabled:enabled,usageCreditsBalance:500,canManageUsageCredits:true}));
 }else{res.setHeader('content-type','text/html');res.end(html);}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
 browser=await puppeteer.launch({headless:true});const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:400,height:850});await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('[role=switch]');
 assert.equal(await page.$eval('[role=switch]',el=>el.getAttribute('aria-checked')),'false');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.click('[role=switch]');await page.waitForFunction(()=>document.querySelector('[role=switch]').getAttribute('aria-checked')==='true');
 assert.equal(saves,1);await page.reload();await page.waitForSelector('[role=switch][aria-checked=true]');
 await page.focus('[role=switch]');await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('[role=switch]').getAttribute('aria-checked')==='false');
 assert.equal(saves,2);
 await page.screenshot({path:join(tmpdir(),'usage-credit-mobile.png'),fullPage:true});
 await page.setViewport({width:1280,height:900});await page.screenshot({path:join(tmpdir(),'usage-credit-desktop.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS mobile layout, real switch, persisted reload, keyboard toggle, no page errors');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
