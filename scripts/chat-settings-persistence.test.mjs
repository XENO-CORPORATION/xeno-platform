import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeSettingPath, setNestedSetting } from '../src/server/utils/userSettings.js';

test('a nested setting is created from an empty document and siblings are preserved', () => {
  const first = setNestedSetting({}, 'chat.wideMode', true);
  assert.deepEqual(first, { chat: { wideMode: true } });
  const second = setNestedSetting(first, 'chat.alignment', 'right');
  assert.deepEqual(second, { chat: { wideMode: true, alignment: 'right' } });
  assert.deepEqual(first, { chat: { wideMode: true } }, 'merge mutated its input');
});

test('legacy comma paths normalize while unsafe paths are rejected', () => {
  assert.deepEqual(normalizeSettingPath('chat,wideMode'), ['chat', 'wideMode']);
  assert.deepEqual(normalizeSettingPath('chat.fontSize'), ['chat', 'fontSize']);
  assert.throws(() => normalizeSettingPath('chat.__proto__.polluted'));
  assert.throws(() => normalizeSettingPath('chat..'));
});

test('the route locks the row instead of relying on jsonb_set to invent parents', () => {
  const route = readFileSync(new URL('../src/server/routes/userDataRoutes.js', import.meta.url), 'utf8');
  const patch = route.slice(route.indexOf("router.patch('/settings'"), route.indexOf('// USER FILES OPERATIONS'));
  assert.match(patch, /SELECT settings FROM user_settings WHERE user_id = \$1 FOR UPDATE/);
  assert.match(patch, /setNestedSetting/);
  assert.match(patch, /client\.query\('COMMIT'\)/);
  assert.doesNotMatch(patch, /settings\s*=\s*jsonb_set/);
});

test('chat preferences debounce independently and persist font size', () => {
  const chat = readFileSync(new URL('../src/components/playground/Chat/ChatWithLLM.tsx', import.meta.url), 'utf8');
  assert.match(chat, /useRef<Map<string, NodeJS\.Timeout>>/);
  assert.match(chat, /debouncedSaveSetting\('chat\.wideMode'/);
  assert.match(chat, /debouncedSaveSetting\('chat\.alignment'/);
  assert.match(chat, /debouncedSaveSetting\('chat\.fontSize'/);
  assert.match(chat, /settings\.chat\.fontSize/);
});
