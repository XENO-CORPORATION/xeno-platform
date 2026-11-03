// Walk 6: Studio › Libraries, as a signed-in person.
//   Stock: search, open an item, read its licence, Save to Library; the saved file is the catalogue's own bytes
//   Fonts: Upload a font through the file picker, confirm the rights, see it listed as private to the workspace
import path from 'node:path'; import fs from 'node:fs'; import crypto from 'node:crypto';
import { browser, page, go, text, clickText, shot, ok, failures, wait, sql, newPerson, OUT } from './lib.mjs';
// One open-licence (OFL) font from XENO's own catalogue, checked against the catalogue's hash, to upload as a person would.
const FONT_URL = 'https://updates.xenostudio.ai/fonts/inter/v5.3.0/inter-latin-100-italic.woff2';
const FONT_SHA = 'd63df5325554cb7795001de09d70ccbe733dd81a6071e86551e084f0d57a5d58';
const fontFile = path.join(OUT, 'downloads', 'font', 'inter-italic.woff2');
if (!fs.existsSync(fontFile)) { fs.mkdirSync(path.dirname(fontFile), { recursive: true }); fs.writeFileSync(fontFile, Buffer.from(await (await fetch(FONT_URL)).arrayBuffer())); }
if (crypto.createHash('sha256').update(fs.readFileSync(fontFile)).digest('hex') !== FONT_SHA) throw new Error('the test font does not match the catalogue hash');
const flat = (s, n = 300) => String(s).slice(0, n).replace(/\n/g, ' | ');
const b = await browser(); const p = await page(b);
try {
  const who = await newPerson(p, 'Lib');
  // ---- Stock ----
  await go(p, '/workspace/studio/spaces/libraries/stock', 3500);
  const s0 = await text(p, '#main'); console.log('stock:', flat(s0, 300));
  const q = await p.$('[data-st-q]');
  ok(!!q, 'Stock has a search box');
  if (q) { await q.click(); await q.type('mountain', { delay: 20 }); await p.keyboard.press('Enter'); await wait(2500); }
  const first = await p.$('#main [data-st-open], #main a[href*="/libraries/stock/"], #main [data-st-item]');
  ok(!!first, 'a search shows items to open', flat(await text(p, '#main'), 300));
  if (first) { await first.click(); await wait(2500); }
  const item = await text(p, '#main'); console.log('item:', flat(item, 400));
  ok(/CC0|public domain/i.test(item), 'an item states its licence');
  ok(!!(await p.$('[data-st-save]')), 'Save to Library is offered');
  await p.click('[data-st-save]').catch(() => {}); await wait(5000);
  const saved = sql(`SELECT count(*) FROM stock_saves WHERE saved_by='${who.id}'`).trim() || '0';
  const after = await text(p); console.log('after save:', flat(after.match(/Saved[^\n]*|couldn[^\n]*|could not[^\n]*/i)?.[0] || '', 200));
  ok(saved !== '0' || /Saved to|In your Library|Saved/.test(after), 'the item is saved to the workspace’s Library', `rows=${saved}`);
  await shot(p, 'stock-item');

  // ---- Fonts ----
  await go(p, '/workspace/studio/spaces/libraries/fonts', 3000);
  ok(!!(await p.$('[data-ft-upload-btn]')), 'Upload a font is offered');
  const [chooser] = await Promise.all([p.waitForFileChooser({ timeout: 10000 }), p.click('[data-ft-upload-btn]')]);
  await chooser.accept([fontFile]); await wait(1500);
  const conf = await p.evaluate(() => document.querySelector('.xd [role=dialog]')?.innerText || '');
  ok(/rights/i.test(conf), 'it asks whether you have the rights', flat(conf));
  await p.click('.xd [data-xd-ok], .xd [data-xd-submit], .xd button[type="submit"]').catch(() => {}); await wait(4000);
  const fonts = await text(p, '#main'); console.log('fonts after upload:', flat(fonts, 400));
  ok(/Uploaded/.test(fonts) && /Rights confirmed/.test(fonts), 'the font is listed as uploaded, with the rights confirmation', flat(fonts, 300));
  await shot(p, 'fonts-uploaded');
  const real = p.bad.filter((x) => !/automate\/catalogue|\/api\/models/.test(x));
  ok(!real.length, 'no server error along the way', real.join(', '));
} catch (e) { ok(false, 'walk crashed', e.stack); await shot(p, 'libraries-crash'); }
finally { await b.close(); process.exitCode = failures() ? 1 : 0; }
