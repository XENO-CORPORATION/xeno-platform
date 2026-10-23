import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(resolve('../../package.json'));
const puppeteer = require('puppeteer-core');
const source = readFileSync(new URL('../src/server/routes/oauth2Routes.js', import.meta.url), 'utf8');
const html = source.slice(source.indexOf('res.send(`<!doctype html>') + 'res.send(`'.length, source.indexOf('</script></body></html>`)') + '</script></body></html>'.length).replaceAll('${app}', 'XENO Agent CLI');

test('served consent design handles authorize/decline/account-switch, mobile, keyboard and reduced motion', async () => {
const executablePath = process.env.XENO_BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  assert.ok(executablePath, 'Set XENO_BROWSER_EXECUTABLE to an installed Chromium browser');
  const browser = await puppeteer.launch({ executablePath, headless:'new', args:['--disable-extensions','--no-first-run','--no-sandbox','--disable-gpu'] });
  const out = resolve('.xeno/auth-design-evidence'); mkdirSync(out, { recursive:true });
  try {
    for (const width of [390,1100]) {
      const page = await browser.newPage();
      await page.setViewport({width,height:1000});
      await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:'light'},{name:'prefers-reduced-motion',value:'reduce'}]);
      const posts = [];
      await page.setRequestInterception(true);
      page.on('request', async request => {
        const url = new URL(request.url());
        if(request.isNavigationRequest()) return request.respond({status:200,contentType:'text/html',body:html});
        if(url.pathname === '/api/oauth2/authorize') {
          posts.push(JSON.parse(request.postData()));
          return request.respond({status:400,contentType:'application/json',body:JSON.stringify({error:'consent_required',consent:{name:'XENO Agent CLI',accountLabel:'fixture@example.test',sendsTo:'this computer',agents:[],scopes:['tasks:read','tasks:write']}})});
        }
        return request.abort();
      });
      await page.goto('http://127.0.0.1:18181/api/oauth2/authorize?client_id=fixture&state=retained-state&code_challenge=fixture&redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fcallback');
      await page.waitForSelector('#consent:not(.hide)');
      assert.equal(await page.$eval('#cAccount', el=>el.textContent),'Signed in as fixture@example.test');
      assert.equal(await page.$eval('#cAllow', el=>el.textContent),'Authorize connection');
      assert.equal(await page.evaluate(()=>document.activeElement.id),'cAllow');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
      assert.equal(await page.$eval('.spin',el=>getComputedStyle(el).animationName),'none');
      await page.screenshot({path:resolve(out,`consent-${width}.png`),fullPage:true});
      await page.click('#cAllow');
      await page.waitForFunction(()=>!document.getElementById('consent').classList.contains('hide'));
      assert.equal(posts.at(-1).consent,true);
      assert.equal(posts.at(-1).state,'retained-state');
      await page.click('#cDeny');
      await new Promise(done=>setTimeout(done,80));
      assert.equal(posts.at(-1).deny,true);
      await page.click('#cSwitch');
      // Switching account goes through sign-in and returns to this authorization with prompt=login.
      await page.waitForFunction(()=>location.pathname==='/login');
      const resume = new URL(new URL(page.url()).searchParams.get('returnUrl'), 'http://127.0.0.1');
      assert.equal(resume.pathname,'/api/oauth2/authorize');
      assert.equal(resume.searchParams.get('prompt'),'login');
      assert.equal(resume.searchParams.get('state'),'retained-state');
      await page.close();
    }
    writeFileSync(resolve(out,'consent-preview.html'),html);
  } finally { await browser.close(); }
});
