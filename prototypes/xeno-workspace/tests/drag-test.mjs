import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--allow-file-access-from-files'] }); const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 }); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
const w = ms=>new Promise(r=>setTimeout(r,ms)); const url = pathToFileURL(path.resolve('index.html')).href;
await p.goto(url); await p.evaluate(()=>{try{localStorage.clear()}catch{}}); await p.goto(url+'#/studio/p/chat'); await w(800);
await p.click('.live-chat [data-part="effort"]'); await w(300);
const box = async k => (await p.$(`#aptrack .ef3-cell[data-k="${k}"]`)).boundingBox();
const b0 = await box(0), b5 = await box(5);
await p.mouse.move(b0.x+4, b0.y+10); await p.mouse.down(); const seen=[];
for (let x=b0.x+4; x<=b5.x+b5.width+40; x+=6){ await p.mouse.move(x, b0.y+10); seen.push(await p.evaluate(()=>document.querySelector('#apmenu .ef3-labels span.cur').textContent)); }
await p.mouse.up(); await w(300);
const after = await p.evaluate(()=>document.querySelector('#apmenu .ef3-labels span.cur').textContent);
console.log('levels seen', [...new Set(seen)].join(' > '), '| final', after, '| menu open', await p.evaluate(()=>document.getElementById('apmenu').classList.contains('show')));
await p.screenshot({ path:'drag-ultra.png', clip:{x:880,y:600,width:440,height:300} });
await p.mouse.move(b0.x+30, b0.y+10); await p.mouse.down(); await p.mouse.move(b0.x+60, b0.y+10); await p.mouse.up(); await w(300);
await p.screenshot({ path:'drag-low.png', clip:{x:880,y:600,width:440,height:300} });
console.log('errors', errs); await b.close();
