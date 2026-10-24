// The project Files tab (prototypes/xeno-workspace/platform-project-files.js), run against a stubbed platform API.
// Run: node scripts/project-files-tab.test.mjs
import fs from 'node:fs'; import vm from 'node:vm'; import assert from 'node:assert/strict';
const src = fs.readFileSync(new URL('../prototypes/xeno-workspace/platform-project-files.js', import.meta.url), 'utf8');
const listeners = []; const api = async (m, u) => {
  if (u.endsWith('/storage')) return { ok: true, status: 200, d: { folder: { id: 'f-1', name: 'BUNKERVERSE', workspaceId: null }, usage: { bytes: 2955384, files: 1 } } };
  if (u.startsWith('/api/library/folders')) return { ok: true, d: { folders: [{ id: 'f-2', name: 'Art' }] } };
  return { ok: true, d: { assets: [{ name: 'hero.png', file_size: 2955384 }] } };
};
const win = { XENO_PLATFORM: { served: true, api }, XENO_PROJECT_TABS: ['Overview', 'Tasks', 'Resources', 'Activity'], XENO_PAGES: { repaint() { win.painted = (win.painted || 0) + 1; } } };
const document = { addEventListener: (...a) => listeners.push(a), getElementById: () => null, createElement: () => ({}), head: { appendChild() {} }, querySelector: () => ({}) };
vm.runInNewContext(src, { window: win, document, encodeURIComponent, console });
assert.deepEqual(win.XENO_PROJECT_TABS, ['Overview', 'Tasks', 'Files', 'Resources', 'Activity'], 'Files sits before Resources');
const h = { box: (i, t, b, a) => `<box>${t}|${b}|${a}</box>`, btn: (t, a) => `<button ${a}>${t}</button>` };
assert.match(win.XENO_PFILES.projectTab('Files', '', { id: 'p-1' }, h), /Opening the project folder/);
await new Promise((r) => setTimeout(r, 20));
const out = win.XENO_PFILES.projectTab('Files', '', { id: 'p-1' }, h);
assert.match(out, /BUNKERVERSE/); assert.match(out, /2\.8 MB/); assert.match(out, /href="\/workspace\/corpo\/apps\/storage\/f\/f-1"/);
assert.match(out, /Art/); assert.match(out, /hero\.png/); assert.ok(win.painted >= 1);
console.log('files tab renders');
