// Browser REDs for the history milestone (XENO FRAMEWORK - DECISION.md: F-04 to F-13 and F-18).
// Each check names the symptom it guards. Every scenario starts from a fresh page and a fresh store, and a thrown
// error is reported as a FAIL with its message, so one symptom cannot hide another.
import { createRequire } from 'node:module'; import path from 'node:path'; import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url); const puppeteer = require('puppeteer');
const b = await puppeteer.launch({ headless: true, args: ['--allow-file-access-from-files'], protocolTimeout: 60000 });
const url = pathToFileURL(path.resolve('index.html')).href, wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', m); };
const check = async (name, fn) => { try { await fn(); } catch (e) { ok(false, `${name} — threw: ${String(e.message).split('\n')[0]}`); } };
const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900 });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const reset = async (pg, hash = '#/overview/g/library') => {
  await pg.goto(url);
  await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('xw.introSeen', JSON.stringify({ studio: 1, office: 1, social: 1, corpo: 1, dev: 1, tools: 1 })); localStorage.setItem('xw.workspace', '"xeno"'); });
  await pg.goto(url + hash); await pg.reload(); await wait(1000);
};
const live = (pg) => pg.evaluate(() => window.XENO_PG_LIBRARY.items.filter((f) => !f.trashedAt).length);
const stored = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem('xw.db.v1')).library.filter((f) => f.trashedAt).length);
const trash = async (pg) => { await pg.evaluate(() => document.querySelector('#main [data-pg-file]').click()); await wait(300); await pg.keyboard.press('Delete'); await wait(450); };
const key = async (pg, k, mods = []) => { for (const m of mods) await pg.keyboard.down(m); await pg.keyboard.press(k); for (const m of mods) await pg.keyboard.up(m); await wait(350); };
// a pointer press is a gesture: it takes the reading the next change is measured from
const gesture = (pg) => pg.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
// a change whose redo has nothing to write: settle the store first, so the record captures no storage write
const storeOnlyRecord = (pg, label, withFn) => pg.evaluate((l, w) => { window.XENO_DB.save(); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); window.XENO_HIST.record(l, w ? () => {} : null); }, label, withFn);

await check('F-04 a failed write keeps the entry, and the second failure retires it', async () => {
  await reset(p); const n0 = await live(p);
  await trash(p); await p.evaluate(() => window.XENO_DB.reload());          // a reload makes the stored path the one used
  await p.evaluate(() => { window.__set = Storage.prototype.setItem; window.__fail = true; Storage.prototype.setItem = function (k, v) { if (window.__fail) throw new Error('storage full'); return window.__set.call(this, k, v); }; });
  const first = await p.evaluate(() => { let threw = null; try { window.XENO_HIST.undo(); } catch (e) { threw = e.message; } return { threw, can: window.XENO_HIST.canUndo() }; });
  ok(first.threw === null, `F-04 a failed write does not escape from undo (${first.threw ?? 'nothing escaped'})`);
  ok(first.can === true, `F-04 a failed undo keeps its entry (canUndo ${first.can})`);
  const second = await p.evaluate(() => { let threw = null; try { window.XENO_HIST.undo(); } catch (e) { threw = e.message; } const t = [...document.querySelectorAll('#xw-toasts .xh-toast')].map((x) => x.textContent).join(' | '); return { threw, can: window.XENO_HIST.canUndo(), t }; });
  ok((second.threw !== null || /couldn.t be undone/.test(second.t)) && second.can === false, `F-04 the second consecutive failure attempts the write and retires the entry (attempt ${second.threw ?? (/couldn.t be undone/.test(second.t) ? 'refused' : 'none')}, canUndo ${second.can})`);
  await p.evaluate(() => { Storage.prototype.setItem = window.__set; window.__fail = false; });
  const n4 = await live(p);
  ok(n4 === n0 - 1, `F-04 the failed undos changed nothing in the store (live ${n4}, expected ${n0 - 1})`);
});

await check('F-05 a redo that cannot run says so', async () => {
  await reset(p);
  await storeOnlyRecord(p, 'mem', true);
  const pre = await p.evaluate(() => { const e = window.XENO_HIST.list()[0]; return { before: e.before ?? null, after: e.after ?? null }; });
  ok(pre.before === null && pre.after === null, 'F-05 fixture: the record stores nothing, so its redo has nothing to write');
  await key(p, 'z', ['Control']); await key(p, 'z', ['Control', 'Shift']);
  const toasts = await p.evaluate(() => [...document.querySelectorAll('#xw-toasts .xh-toast')].map((t) => t.textContent));
  ok(toasts.some((t) => /That couldn.t be redone/.test(t)), `F-05 a redo that cannot run says so (toasts: ${toasts.join(' | ').slice(0, 120)})`);
});

await check('F-06 a record with nothing to take back offers no Undo', async () => {
  await reset(p);
  await storeOnlyRecord(p, 'nothing stored', false);
  const r = await p.evaluate(() => { const t = [...document.querySelectorAll('#xw-toasts .xh-toast')].find((x) => x.textContent.includes('nothing stored')); return { undo: !!t?.querySelector('[data-h="undo"]'), can: window.XENO_HIST.canUndo() }; });
  ok(!r.undo && !r.can, `F-06 a record with nothing to take back offers no Undo (Undo button ${r.undo}, canUndo ${r.can})`);
});

await check('F-07 an undo’s own writes are not recorded as the next change', async () => {
  await reset(p); await trash(p);
  await key(p, 'z', ['Control']);                       // the undo writes the store back; no gesture takes a new reading
  const keys = await p.evaluate(() => { window.XENO_HIST.record('probe', null); const e = window.XENO_HIST.list()[0]; return Object.keys(e.before || {}); });
  ok(!keys.includes('xw.db.v1'), `F-07 the undo's own writes are not recorded as the next change (probe holds ${keys.join(', ') || 'nothing'})`);
});

await check('F-08 after XENO_WF.reload, undo writes the recorded values instead of the stale closure', async () => {
  await reset(p); await gesture(p);
  await p.evaluate(() => { window.__probe = 0; localStorage.setItem('xw.probeKey', '1'); window.XENO_HIST.record('probe key', () => { window.__probe += 1; }); window.XENO_WF.reload(); });
  await key(p, 'z', ['Control']);
  const r = await p.evaluate(() => ({ closure: window.__probe, key: localStorage.getItem('xw.probeKey') }));
  ok(r.closure === 0 && r.key === null, `F-08 after XENO_WF.reload the closure is not run and the stored value is restored (closure ran ${r.closure}x, key ${r.key})`);
});

await check('F-09 an older toast Undo takes back its change and the newer ones', async () => {
  await reset(p); const n0 = await live(p);
  await trash(p); await trash(p);
  await p.evaluate(() => [...document.querySelectorAll('#xw-toasts .xh-toast')][0].querySelector('[data-h="undo"]').click());
  await wait(400);
  const n9 = await live(p);
  ok(n9 === n0, `F-09 an older toast's Undo takes back its own change as well as the newer ones (live ${n9}, expected ${n0})`);
});

await check('F-09 the older toast says how many changes its Undo takes back, and the count follows new changes', async () => {
  await reset(p);
  const labels = () => p.evaluate(() => [...document.querySelectorAll("#xw-toasts .xh-toast [data-h='undo']")].map((x) => x.textContent.trim()));
  await trash(p); const one = await labels();
  await trash(p); const two = await labels();
  ok(one.join('|') === 'Undo' && two.join('|') === 'Undo 2 changes|Undo', 'F-09 the count follows new changes: one toast says Undo, then the older one says Undo 2 changes (after one ' + JSON.stringify(one) + ', after two ' + JSON.stringify(two) + ')');
});

await check('F-10 Redo on a toast redoes through the change it names', async () => {
  await reset(p); const n0 = await live(p);
  await trash(p); await trash(p);
  await key(p, 'z', ['Control']); await key(p, 'z', ['Control']);
  const lb = await p.evaluate(() => window.XENO_HIST.list()[0].label);
  const clicked = await p.evaluate((label) => { const t = [...document.querySelectorAll('#xw-toasts .xh-toast')].find((x) => x.textContent.includes('Undid: ' + label)); const btn = t && t.querySelector('[data-h="redo"]'); if (!btn) return false; btn.click(); return true; }, lb);
  await wait(400);
  const n10 = await live(p);
  ok(clicked && n10 === n0 - 2, `F-10 Redo on the toast that names the newer change redoes through it (clicked ${clicked}, live ${n10}, expected ${n0 - 2})`);
});

await check('F-11 an undone change that a later change overtook offers no Redo to here', async () => {
  await reset(p); await trash(p);
  const lbl = await p.evaluate(() => window.XENO_HIST.list()[0].label);
  await key(p, 'z', ['Control']);
  await p.evaluate(() => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); window.XENO_HIST.record('a later change', null); });
  const row = await p.evaluate((label) => { window.XENO_HIST.toggle(true); const li = [...document.querySelectorAll('#xw-history li')].find((x) => x.querySelector('b')?.textContent === label); return li ? !!li.querySelector('[data-h="jump"]') : 'row missing'; }, lbl);
  ok(row === false, `F-11 an undone change that a later change overtook offers no Redo to here (button ${row})`);
});

await check('F-12 focus stays in the history drawer after Back to here', async () => {
  await reset(p); await trash(p); await trash(p);
  await p.evaluate(() => window.XENO_HIST.toggle(true));
  await p.evaluate(() => [...document.querySelectorAll('#xw-history [data-h="jump"]')][0].focus());
  await p.keyboard.press('Enter'); await wait(400);
  const f = await p.evaluate(() => { const d = document.getElementById('xw-history'); return { inDrawer: d.contains(document.activeElement), on: document.activeElement?.tagName }; });
  ok(f.inDrawer, `F-12 focus stays in the history drawer after Back to here (focus on ${f.on})`);
});

await check('F-13 Ctrl Alt Z is not the history undo', async () => {
  await reset(p); const n0 = await live(p);
  await trash(p);
  await key(p, 'z', ['Control', 'Alt']);
  const n13 = await live(p);
  ok(n13 === n0 - 1, `F-13 Ctrl Alt Z is not the history undo (live ${n13}, expected ${n0 - 1})`);
});

await check('F-18 undoing this window’s change keeps a change another window made', async () => {
  await reset(p);
  await gesture(p);                                      // this window's reading predates the other window's change
  const pB = await b.newPage(); await pB.setViewport({ width: 1440, height: 900 });
  await pB.goto(url + '#/overview/g/library'); await pB.reload(); await wait(1000);
  await trash(pB);                                       // another window trashes a file
  await wait(400);                                       // this window hears the storage event
  const afterB = await stored(p);
  await p.evaluate(() => window.XENO_HIST.record('probe another window', () => {}));  // no gesture here
  await p.evaluate(() => window.XENO_DB.reload());       // a reload between the record and the undo, as live sync does
  await p.evaluate(() => window.XENO_HIST.undo());
  const fin = await stored(p);
  ok(fin === afterB, `F-18 undoing this window's change keeps the change another window made (trashed in store ${fin}, expected ${afterB})`);
  await pB.close();
});

console.log(fails ? `${fails} FAILED` : 'ALL PASS', '| errors', errs.slice(0, 5));
await b.close(); process.exitCode = fails ? 1 : 0;
