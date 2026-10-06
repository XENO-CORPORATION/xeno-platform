import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--allow-file-access-from-files'] }); const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 }); const errs=[]; p.on('pageerror', e=>errs.push(e.message));
const url = pathToFileURL(path.resolve('index.html')).href; await p.goto(url+'#/studio/p/chat'); await new Promise(r=>setTimeout(r,900));
await p.screenshot({path:'box-empty.png',clip:{x:420,y:700,width:920,height:200}});
await p.click('.live-chat textarea'); await p.keyboard.type('Make the hero image warmer');
await new Promise(r=>setTimeout(r,250)); await p.screenshot({path:'box-typed.png',clip:{x:420,y:700,width:920,height:200}});
console.log('errors', errs); await b.close();
