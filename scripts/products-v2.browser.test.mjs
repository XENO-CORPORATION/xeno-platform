import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import puppeteer from 'puppeteer';

test('all 46 product documents have working shared navigation on desktop and phone', { timeout: 120000 }, async () => {
  const root = resolve('public');
  const server = createServer(async (req, res) => {
    try {
      let address = new URL(req.url, 'http://local').pathname;
      if (address === '/products') address = '/product-pages/index.html';
      else if (/^\/product\/[a-z0-9-]+$/.test(address)) address = `/product-pages/${address.split('/').at(-1)}/index.html`;
      const path = resolve(root, '.' + address);
      if (!path.startsWith(root + sep)) throw new Error('outside public');
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream');
      res.end(await readFile(path));
    } catch { res.writeHead(404); res.end('missing'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const slugs = ['index', ...(await readdir('public/product-pages', { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name)];
  let browser;
  let next = 0;
  const passed = [];
  try {
    browser = await puppeteer.launch({ headless: true });
    await Promise.all(Array.from({ length: 4 }, async () => {
      const page = await browser.newPage();
      while (next < slugs.length) {
        const slug = slugs[next++];
        const errors = [];
        page.removeAllListeners('pageerror');
        page.on('pageerror', error => errors.push(error.message));
        await page.setViewport({ width: 1440, height: 1000 });
        await page.goto(`http://127.0.0.1:${server.address().port}/${slug === 'index' ? 'products' : 'product/' + slug}`, { waitUntil: 'load' });
        await page.waitForSelector('[data-marketing-header] [data-product-trigger]');
        assert.equal(await page.$$eval('header a[href="#"],footer a[href="#"]', els => els.length), 0, slug);
        for (const href of ['/docs', '/pricing', '/blog', '/forum', '/auth']) {
          assert.ok(await page.$(`header a[href="${href}"]`), `${slug}: ${href}`);
        }
        for (const id of ['products', 'marketplace', 'solutions']) {
          await page.hover(`[data-nav-trigger="${id}"]`);
          await page.waitForFunction(key => document.querySelector(`[data-nav-menu="${key}"]`).hasAttribute('data-open'), {}, id);
          assert.equal(await page.$eval(`[data-nav-menu="${id}"]`, el => el.inert), false, `${slug}: ${id}`);
        }
        await page.focus('[data-product-trigger]');
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.$eval('[data-product-menu]', el => el.contains(document.activeElement)), true, slug);
        await page.keyboard.press('Escape');
        assert.equal(await page.$eval('[data-product-trigger]', el => el === document.activeElement), true, slug);
        await page.setViewport({ width: 390, height: 844, hasTouch: true });
        const clipped = await page.$$eval('header .marketing-topbar a,header .marketing-topbar button', els => els.filter(el => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && (r.left < 0 || r.right > innerWidth);
        }).map(el => el.textContent));
        assert.deepEqual(clipped, [], `${slug}: mobile header clips controls`);
        await page.tap('[data-nav-trigger="mobile"]');
        assert.equal(await page.$eval('[data-nav-menu="mobile"]', el => el.inert), false, slug);
        for (const href of ['/marketplace', '/#uses', '/docs', '/pricing', '/blog', '/forum']) {
          assert.ok(await page.$(`[data-nav-menu="mobile"] a[href="${href}"]`), `${slug}: mobile ${href}`);
        }
        await page.tap('[data-nav-trigger="mobile"]');
        assert.equal(await page.$eval('[data-nav-menu="mobile"]', el => el.inert), true, slug);
        await page.tap('[data-product-trigger]');
        assert.equal(await page.$eval('[data-product-menu]', el => el.inert), false, slug);
        await page.tap('[data-product-trigger]');
        assert.deepEqual(errors, [], `${slug}: renderer errors`);
        passed.push(slug);
      }
      await page.close();
    }));
    assert.equal(passed.length, 46);
    console.log(`Verified ${passed.length} documents: desktop menus, keyboard, phone controls, navigation links and no renderer errors.`);
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
});
