// NFR-08 against the real workforce components in jsdom: full keyboard
// navigation, labelled controls, non-color-only statuses and accessible
// focus recovery across scoped navigation and dialogs. The TSX sources
// bundle at proof time with the repo's own esbuild and render through
// React in jsdom; every assertion below drives the real components.
//
// PROVEN: the scope nav is a labelled landmark; every option is a button
// with a text name and exactly one is tabbable (roving tabindex);
// ArrowDown/ArrowUp/Home/End move focus and activation selects; every status
// renders a distinct text word plus a distinct glyph (never color alone);
// the dialog is labelled and modal, opens with focus inside, traps Tab
// both directions, closes on Escape and restores focus to its opener.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const {JSDOM} = require('jsdom');

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const entry = path.join(here, '..', 'src', 'components', 'workforce', 'nfr08-proof-entry.tsx');

test('NFR-08: keyboard nav, labelled controls, text statuses, focus recovery', {timeout: 180000}, async () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfr08-'));
  const outfile = path.join(outdir, 'bundle.mjs');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile,
    logLevel: 'silent',
  });
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {url: 'http://localhost/'});
  for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'KeyboardEvent', 'MouseEvent', 'Event', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    globalThis[key] = dom.window[key] ?? globalThis[key];
  }
  Object.defineProperty(globalThis, 'navigator', {value: dom.window.navigator, configurable: true, writable: true});
  // React's scheduler owns MessageChannel ports that keep the Node event
  // loop alive forever; the proof tracks and closes them at teardown so
  // the runner exits naturally. Message delivery is unaffected.
  const schedulerPorts = [];
  const NativeMessageChannel = globalThis.MessageChannel;
  globalThis.MessageChannel = function (...args) {
    const mc = new NativeMessageChannel(...args);
    schedulerPorts.push(mc.port1, mc.port2);
    return mc;
  };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const {render, keyDown, click, scopes} = await import(pathToFileURL(outfile).href);

  try {
  // Element identity compares as booleans: assert.equal on two jsdom
  // elements makes a failure inspect the whole document (minutes of CPU).
  // Scoped navigation: labelled landmark, named controls, roving tabindex.
  const api = await render('nav');
  const nav = document.querySelector('nav');
  assert.equal(nav?.getAttribute('aria-label'), 'Workforce scopes', 'the scope nav is a labelled landmark');
  const buttons = Array.from(document.querySelectorAll('nav button'));
  assert.equal(buttons.length, scopes.length, 'every scope renders one option');
  for (const button of buttons) {
    assert.match(button.textContent ?? '', /\S/, 'every option has a text name');
  }
  assert.deepEqual(buttons.map((b) => b.tabIndex), [0, -1, -1], 'exactly one option is tabbable');
  assert.equal(buttons[0].getAttribute('aria-current'), 'true', 'the active option carries aria-current');

  // Arrow keys move, Enter activates.
  buttons[0].focus();
  await keyDown(document.activeElement, 'ArrowDown');
  assert.ok(document.activeElement === buttons[1], 'ArrowDown moves to the next option');
  await keyDown(document.activeElement, 'ArrowUp');
  assert.ok(document.activeElement === buttons[0], 'ArrowUp moves back');
  await keyDown(document.activeElement, 'End');
  assert.ok(document.activeElement === buttons[2], 'End jumps to the last option');
  await keyDown(document.activeElement, 'Home');
  assert.ok(document.activeElement === buttons[0], 'Home jumps to the first option');
  // jsdom does not synthesize native Enter-to-click activation, so the
  // proof focuses by keyboard and drives the activation handler directly —
  // the same onSelect the browser's native Enter would call.
  buttons[1].focus();
  await keyDown(document.activeElement, 'ArrowDown');
  assert.ok(document.activeElement === buttons[2], 'arrows keep working after refocus');
  await click(document.activeElement);
  assert.equal(api.selected(), scopes[2].id, 'activating the focused option selects it');

  // Statuses: distinct words and distinct glyphs, never color alone.
  const words = Array.from(document.querySelectorAll('.scope-status-word')).map((el) => el.textContent);
  const glyphs = Array.from(document.querySelectorAll('.scope-status-glyph')).map((el) => el.textContent);
  assert.deepEqual(words, ['Active', 'Paused', 'Blocked'], 'every status renders its text word');
  assert.equal(new Set(glyphs).size, glyphs.length, 'every status has a distinct glyph');
  assert.equal(new Set(words).size, words.length, 'every status word is distinct');

  // Dialog: labelled, modal, focus in on open, trapped, restored on close.
  await render('dialog');
  const opener = document.querySelector('#dialog-opener');
  opener.focus();
  await click(opener);
  const dialog = document.querySelector('[role="dialog"]');
  assert.ok(dialog, 'the dialog opens');
  assert.equal(dialog.getAttribute('aria-modal'), 'true', 'the dialog is modal');
  assert.equal(dialog.getAttribute('aria-labelledby'), dialog.querySelector('h2').id, 'the dialog is labelled by its title');
  assert.ok(dialog.contains(document.activeElement), 'opening moves focus inside the dialog');
  const focusables = Array.from(dialog.querySelectorAll('button, input'));
  focusables[focusables.length - 1].focus();
  await keyDown(document.activeElement, 'Tab');
  assert.ok(document.activeElement === focusables[0], 'Tab on the last control wraps to the first');
  focusables[0].focus();
  const shiftTab = new dom.window.KeyboardEvent('keydown', {key: 'Tab', shiftKey: true, bubbles: true, cancelable: true});
  await api.dispatch(document.activeElement, shiftTab);
  assert.ok(document.activeElement === focusables[focusables.length - 1], 'Shift+Tab on the first control wraps to the last');
  await keyDown(document.activeElement, 'Escape');
  assert.equal(document.querySelector('[role="dialog"]'), null, 'Escape closes the dialog');
  assert.ok(document.activeElement === opener, 'closing restores focus to the opener');
  } finally {
    fs.rmSync(outdir, {recursive: true, force: true});
    for (const port of schedulerPorts) {
      try { port.close(); } catch {}
    }
    dom.window.close();
    await esbuild.stop();
  }
});
