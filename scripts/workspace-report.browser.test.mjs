import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import puppeteer from 'puppeteer';
test('report composer guards keys, reviews exact redacted text, captures locally and recovers one submission',{timeout:60000},async()=>{
  let signedIn=true,lose=false;const calls=[],errors=[];
  const server=createServer(async(req,res)=>{
    const p=new URL(req.url,'http://local').pathname;
    res.setHeader('Cache-Control','no-store');
    if(p.startsWith('/api/')){
      res.setHeader('Content-Type','application/json');let body='';for await(const c of req)body+=c;
      if(p==='/api/auth/me'){res.statusCode=signedIn?200:401;return res.end(JSON.stringify(signedIn?{success:true,user:{id:'11111111-1111-4111-8111-111111111111',username:'test-user'}}:{error:'Sign in'}));}
      calls.push({path:p,body,headers:req.headers});
      if(p.endsWith('/preflight'))return res.end('{"candidates":[]}');
      if(p.includes('/submissions/'))return res.end('{"state":"committed","receipt":{"shortId":"abcd1234","private":true}}');
      if(lose){req.socket.destroy();return;}
      return res.end(JSON.stringify({success:true,private:JSON.parse(body).visibility==='private',shortId:'abcd1234'}));
    }
    if(p.endsWith('.js')||p.endsWith('.css')){try{res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript; charset=utf-8':'text/css; charset=utf-8');return res.end(await readFile('prototypes/xeno-workspace/'+p.split('/').at(-1)));}catch{res.statusCode=404;return res.end();}}
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><input id="typing"><div contenteditable id="editor">Editor</div><div class="xterm" tabindex="0" id="terminal">Terminal</div><link rel="stylesheet" href="/workspace/report.css"><script src="/workspace/report-client.js"></script><script src="/workspace/report-capture.js"></script><script src="/workspace/report-view.js"></script>');
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await puppeteer.launch({headless:true});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  const base=`http://127.0.0.1:${server.address().port}`;
  const shiftR=async()=>{await page.keyboard.down('Shift');await page.keyboard.press('R');await page.keyboard.up('Shift');};
  const button=async text=>page.evaluate(t=>[...document.querySelectorAll('.xreport button')].find(b=>b.textContent===t)?.click(),text);
  try{
    await page.goto(base+'/');await shiftR();assert.equal(await page.$('.xreport'),null);
    await page.goto(base+'/workspace/studio/pixel?secret=hidden#private');
    for(const selector of ['#typing','#editor','#terminal']){await page.focus(selector);await shiftR();assert.equal(await page.$('.xreport'),null,selector);}
    await page.evaluate(()=>document.activeElement.blur());await page.keyboard.press('F1');assert.equal(await page.$('.xreport'),null);
    await shiftR();await page.waitForSelector('.xreport[open]');
    await page.type('.xreport input:not([type=checkbox])','The export preview is broken');
    await page.type('.xreport textarea','Bearer secret-abcdefghijklmnop should be redacted');
    await page.select('.xreport select:last-of-type','private').catch(()=>{});
    await page.evaluate(()=>{const s=document.querySelectorAll('.xreport select')[1];s.value='private';s.dispatchEvent(new Event('change',{bubbles:true}));});
    await button('Review report');await page.waitForFunction(()=>!document.querySelector('.xreport footer button:last-child').disabled);
    const preview=await page.$eval('.xr-review pre',n=>n.textContent);assert.ok(!preview.includes('secret-abcdefghijklmnop'));assert.ok(!preview.includes('secret=hidden'));assert.ok(preview.includes('/workspace/studio/pixel'));
    assert.equal(calls.filter(c=>c.path==='/api/forum/report').length,0);
    // Capture a deterministic real canvas stream; area is cropped by the user's drag.
    await page.evaluate(()=>{navigator.mediaDevices.getDisplayMedia=window.mockShare=async options=>{window.captureOptions=options;const c=document.createElement('canvas');c.width=800;c.height=600;const x=c.getContext('2d');x.fillStyle='#ff0000';x.fillRect(0,0,800,600);const stream=c.captureStream(20);let frame=0;const timer=setInterval(()=>{x.fillStyle=++frame%2?'#ff0000':'#00ff00';x.fillRect(0,0,800,600);stream.getVideoTracks()[0].requestFrame?.();},40);stream.getTracks()[0].addEventListener('ended',()=>clearInterval(timer));window.capturedTracks=stream.getTracks();return stream;};});
    await button('Select area');await page.waitForSelector('.xreport-area[open] canvas');
    const rect=await page.$eval('.xreport-area canvas',n=>{const b=n.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height};});
    await page.mouse.move(rect.x+rect.width*.1,rect.y+rect.height*.1);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.5,rect.y+rect.height*.5,{steps:4});await page.mouse.up();
    await page.evaluate(()=>[...document.querySelectorAll('.xreport-area button')].find(b=>b.textContent==='Use selected area').click());await page.waitForSelector('.xr-attachment img');
    assert.equal(await page.evaluate(()=>window.captureOptions.audio),false);assert.ok(await page.evaluate(()=>window.capturedTracks.every(t=>t.readyState==='ended')));
    const size=await page.$eval('.xr-attachment img',async n=>{await n.decode();return[n.naturalWidth,n.naturalHeight];});assert.deepEqual(size,[320,240]);
    await button('Review report');await page.waitForFunction(()=>!document.querySelector('.xreport footer button:last-child').disabled);
    await mkdir('.xeno/report-evidence',{recursive:true});await page.screenshot({path:'.xeno/report-evidence/review.png'});lose=true;await button('Send report');await page.waitForFunction(()=>!document.querySelector('.xreport footer button:nth-last-child(3)').hidden);
    assert.ok(await page.$eval('.xreport textarea',n=>n.disabled));
    const sent=calls.find(c=>c.path==='/api/forum/report');const data=JSON.parse(sent.body);assert.equal(data.visibility,'private');assert.equal(data.context.attachments.length,1);assert.ok(!sent.body.includes('secret-abcdefghijklmnop'));assert.equal(sent.headers['x-xeno-report-actor'],'11111111-1111-4111-8111-111111111111');
    const attempts=calls.filter(c=>c.path==='/api/forum/report');assert.ok(attempts.length>=1);assert.ok(attempts.every(c=>c.headers['idempotency-key']===sent.headers['idempotency-key']&&c.body===sent.body));await button('Check submission');await page.waitForSelector('.xr-success');assert.match(await page.$eval('.xr-success',n=>n.textContent),/Private report sent/);assert.equal(calls.filter(c=>c.path==='/api/forum/report').length,attempts.length);
    await button('Close');lose=false;await shiftR();await page.waitForSelector('.xreport[open]');
    await button('Record · 30s');await page.waitForSelector('.xreport-recording',{timeout:3000}).catch(async e=>{console.log(await page.evaluate(()=>({text:document.querySelector('.xreport')?.textContent,media:typeof MediaRecorder})));throw e;});await new Promise(r=>setTimeout(r,1200));await page.click('.xreport-recording button');await page.waitForSelector('.xr-attachment video',{timeout:3000}).catch(async e=>{console.log(await page.evaluate(()=>({text:document.querySelector('.xreport')?.textContent})));throw e;});assert.ok(await page.evaluate(()=>window.capturedTracks.every(t=>t.readyState==='ended')));
    await page.evaluate(()=>{navigator.mediaDevices.getDisplayMedia=async()=>{throw new DOMException('Permission denied','NotAllowedError');};});await button('Screenshot');await page.waitForFunction(()=>document.querySelector('.xreport[open] .xr-error')?.textContent.includes('Permission denied'));assert.ok(await page.$('.xr-attachment video'));
    await page.evaluate(()=>{navigator.mediaDevices.getDisplayMedia=window.mockShare;const Original=MediaRecorder;window.MediaRecorder=class extends Original{start(){throw new Error('Recorder startup refused');}};});await button('Record · 30s');await page.waitForFunction(()=>document.querySelector('.xreport[open] .xr-error')?.textContent.includes('Recorder startup refused'));assert.equal(await page.$('.xreport-recording'),null);assert.ok(await page.evaluate(()=>window.capturedTracks.every(t=>t.readyState==='ended')));
    await button('Close');await button('Discard draft');signedIn=false;await shiftR();await new Promise(r=>setTimeout(r,150));assert.equal(await page.$('.xreport'),null);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(r=>server.close(r));}
});
