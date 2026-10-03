/**
 * ONE composer, two placements (approved design: orchestrator/previews/chat-input-hybrid.html).
 *
 * The main chat and the project page used to disagree: the project page faked `isActive=false` to get a
 * compact box, so it rendered the "in a conversation" shape (controls underneath) on a page with no
 * conversation, while the empty chat rendered the controls inside the box. These gates pin the fix:
 * every composer surface goes through the one render function and says which placement it wants, and
 * the geometry is stated once, after the older `!important` rules, so it wins.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const llm = read('src/components/playground/Chat/ChatWithLLM.tsx');
const empty = read('src/components/playground/Chat/ChatEmptyState.tsx');
const css = read('src/components/playground/Chat/chat-composer.css');
const main = read('src/main.tsx');

test('exactly one ChatEmptyState (the composer) is rendered by ChatWithLLM, and both surfaces call it', () => {
  assert.equal((llm.match(/<ChatEmptyState\b/g) ?? []).length, 1, 'a second composer render would be a copy');
  assert.match(llm, /renderPrimaryComposer\(\)/, 'the main chat mounts the shared composer');
  assert.match(llm, /renderPrimaryComposer\(\{ forceCompact: true \}\)/, 'the project page mounts the same composer');
});

test('placement is its own axis: home puts the controls inside, dock puts them under the plate', () => {
  assert.match(empty, /const controlsInside = resolvedPlacement === 'home'/);
  assert.match(empty, /controlsInside && controls && <div data-composer-controls="inside"/);
  assert.match(empty, /!controlsInside && controls && <div data-composer-controls="below"/);
  assert.match(empty, /data-composer-placement=\{resolvedPlacement\}/);
  assert.match(empty, /if \(!hero\) \{/, 'the hero is decided by showHero, not by the placement');
});

test('the project page is a home without a hero (it must not fake isActive to be compact)', () => {
  assert.match(llm, /placement=\{options\?\.forceCompact \|\| messages\.length === 0 \? 'home' : 'dock'\}/);
  assert.match(llm, /showHero=\{!options\?\.forceCompact && messages\.length === 0\}/);
});

test('the geometry is the approved one: 12px plate, 14px field, 28px/7px controls, 11/12/9 and 12/14 padding', () => {
  assert.match(css, /\[data-chat-composer-shell\] \{\s*border-radius: 12px !important;/);
  assert.match(css, /font-size: 14px !important;/);
  assert.match(css, /placement="dock"\] \[data-chat-composer-shell\] \.chat-input-container \{\s*padding: 12px 14px !important;/);
  assert.match(css, /placement="home"\] \[data-chat-composer-shell\] \.chat-input-container \{\s*padding: 11px 12px 0 !important;/);
  assert.match(css, /\.xeno-icon-btn \{\s*width: 28px !important;\s*height: 28px !important;\s*border-radius: 7px !important;/);
  assert.match(css, /--chat-shell-shadow/);
});

test('the stylesheet loads AFTER index.css, otherwise the older 18px metrics block wins', () => {
  const index = main.indexOf("import './index.css'");
  const composer = main.indexOf("chat-composer.css'");
  assert.ok(index > -1 && composer > index, 'chat-composer.css must be imported after index.css');
});

test('the field grows to the approved 220px and starts at one row', () => {
  assert.match(llm, /rows=\{1\}/);
  assert.match(llm, /const maxHeight = 220;/);
});
