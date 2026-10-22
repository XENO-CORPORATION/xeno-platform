import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import puppeteer from 'puppeteer';

test('homepage hover navigation, previews and responsive geometry', { timeout: 90000 }, async () => {
  const publicRoot = resolve('public');
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = createServer(async (req, res) => {
    try {
      const path = resolve(publicRoot, '.' + new URL(req.url, 'http://localhost').pathname);
      if (!path.startsWith(publicRoot + sep)) throw new Error('outside public');
      const bytes = await readFile(path);
      res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
      res.end(bytes);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(origin + '/home-v21/index.html', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-product-menu] a[href="/product/pixel"]', { timeout: 30000 });
    await page.waitForFunction(() => !document.documentElement.classList.contains('intro-pending'));
    assert.equal(await page.$eval('[data-product-menu]', el => el.inert), true);
    await page.hover('[data-product-trigger]');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-product-menu]')).opacity === '1');
    assert.equal(await page.$eval('[data-product-trigger]', el => el.getAttribute('aria-expanded')), 'true');
    assert.ok((await page.$eval('[data-product-menu]', el => getComputedStyle(el).transitionDuration)).split(', ').every(duration => duration === '0.2s'));
    await page.hover('[data-product-menu] a[href="/product/pixel"]');
    assert.equal(await page.$eval('[data-product-menu]', el => el.inert), false);
    // Returning across header whitespace used to leave an older close timer alive.
    const pause = ms => new Promise(done => setTimeout(done, ms));
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.hover('[data-product-trigger]');
      const trigger = await page.$eval('[data-product-trigger]', el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, bottom: r.bottom }; });
      await page.mouse.move(trigger.x, trigger.bottom + 3);
      await pause(70);
      await page.hover('[data-product-menu] a[href="/product/pixel"]');
      await pause(400);
      assert.equal(await page.$eval('[data-product-menu]', el => el.inert), false, `re-entry ${attempt} must cancel every pending close`);
    }
    const card = await page.$eval('.home-products-card', el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, background: getComputedStyle(el).backgroundColor }; });
    assert.ok(card.left > 0 && card.right < 1920 && card.width <= 1260, 'old floating card is centered with outside space');
    assert.equal(card.background, 'rgb(21, 21, 21)');
    await page.hover('.home-product-row[href="/product/docs"]');
    await pause(220);
    const highlight = await page.evaluate(() => {
      const row = document.querySelector('.home-product-row[href="/product/docs"]').getBoundingClientRect();
      const highlight = document.querySelector('.home-products-highlight').getBoundingClientRect();
      return { dx: Math.abs(row.left - highlight.left), dy: Math.abs(row.top - highlight.top) };
    });
    assert.ok(highlight.dx < 1 && highlight.dy < 1, 'sliding highlight follows the hovered product');
    await page.mouse.move(1900, 900);
    await pause(500);
    assert.equal(await page.$eval('[data-product-menu]', el => el.inert), true, 'leaving the menu closes it');
    await page.hover('[data-product-trigger]');
    await page.hover('.home-product-row[href="/product/pixel"]');
    const hrefs = await page.$$eval('[data-product-menu] a', els => els.map(el => el.getAttribute('href')));
    for (const href of hrefs) {
      assert.match(href, /^\/(?:product\/[a-z0-9-]+|products)$/);
      // The SPA supplies catalog-only pages; the imported pages supply the rest.
      const catalog = await readFile('src/lib/productCatalog.ts', 'utf8');
      if (href.startsWith('/product/')) {
        const slug = href.split('/').at(-1);
        try { await readFile(`public/product-pages/${slug}/index.html`); }
        catch { assert.ok(catalog.includes(`slug: '${slug}'`), `missing destination ${href}`); }
      }
    }
    await page.click('[data-product-menu] a[href="/product/pixel"]');
    await page.waitForFunction(() => location.pathname === '/product/pixel');
    await page.goto(origin + '/home-v21/index.html', { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-product-trigger]');
    await page.waitForFunction(() => !document.documentElement.classList.contains('intro-pending'));
    await page.focus('[data-product-trigger]');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.$eval('[data-product-menu]', el => el.contains(document.activeElement)), true,
      await page.evaluate(() => JSON.stringify({ focused: document.activeElement.outerHTML.slice(0,250), open: document.querySelector('[data-product-menu]').outerHTML.slice(0,220), visibility: getComputedStyle(document.querySelector('[data-product-menu]')).visibility })));
    await page.keyboard.press('Escape');
    assert.equal(await page.$eval('[data-product-trigger]', el => el === document.activeElement), true);
    assert.equal(await page.$eval('[data-product-menu]', el => el.inert), true);
    // Exercise the real Chat handler, not just the preview helper.
    await page.evaluate(() => document.querySelector('[data-panels]').scrollIntoView());
    const chatInput = await page.$('input[placeholder*="Ask"],textarea[placeholder*="Ask"]');
    assert.ok(chatInput, 'chat composer rendered');
    await chatInput.type('Help me plan a launch');
    await chatInput.press('Enter');
    await page.waitForSelector('dialog[open]');
    assert.match(await page.$eval('dialog', el => el.textContent), /AI Chat[\s\S]*Your prompt has not been sent/);
    assert.equal(await page.$eval('dialog a', el => el.getAttribute('href')), '/auth');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog'));
    for (const feature of ['code', 'workflow', 'image', 'video', 'comms', 'sdk', 'shell']) {
      await page.evaluate(key => window.xenoHomePreview(key), feature);
      assert.match(await page.$eval('dialog', el => el.textContent), /PREPARED EXAMPLE/);
      await page.evaluate(()=>document.querySelector('dialog button')?.click());
    }
    const geometry = [];
    for (const width of [1920, 1440, 768, 390]) {
      await page.setViewport({ width, height: 1000, hasTouch: width === 390 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForFunction(w => document.documentElement.clientWidth === w, {}, width);
      const result = await page.evaluate(() => {
        const section = document.querySelector('#pricing > div');
        const rect = section.getBoundingClientRect();
        return { viewport: innerWidth, left: rect.left, right: rect.right, padding: parseFloat(getComputedStyle(section).paddingLeft), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(result.overflow, false, `page overflow at ${width}`);
      assert.ok(result.padding >= 16 && result.padding <= 28);
      assert.ok(result.left < 1 && result.right >= width - 1);
      const stack=await page.$eval('#stack > div > div',n=>({padding:parseFloat(getComputedStyle(n).paddingLeft),width:n.getBoundingClientRect().width}));assert.equal(stack.padding,0);assert.ok(Math.abs(stack.width-width)<1);geometry.push({...result,stack});
    }
    await page.tap('[data-product-trigger]');
    assert.equal(await page.$eval('[data-product-menu]', el => el.inert), false);
    await page.tap('[data-product-trigger]');
    assert.equal(await page.$eval('[data-product-menu]', el => el.inert), true);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    assert.equal(await page.$eval('[data-product-menu]', el => getComputedStyle(el).transitionDuration), '0s');
    await page.setViewport({ width: 1440, height: 1000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.hover('[data-product-trigger]');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-product-menu]')).opacity === '1');
    const radiusViolations = await page.$$eval('[style]', els => els.filter(el => {
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius);
      return radius > 8 && el.getBoundingClientRect().width > 0;
    }).map(el => ({ tag: el.tagName, radius: getComputedStyle(el).borderTopLeftRadius })));
    assert.deepEqual(radiusViolations, [], 'rendered corners stay small');
    await mkdir('.xeno/homepage-evidence', { recursive: true });
    await page.screenshot({ path: '.xeno/homepage-evidence/products-menu.png' });
    assert.deepEqual(errors, [], 'no renderer exceptions');
    console.log(JSON.stringify({ productLinks: hrefs.length, geometry, rendererErrors: errors }));
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
});
