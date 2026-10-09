/**
 * What an AREA of the XENO workspace remembers for its chats: the model a new chat opens with, and a
 * standing instruction (owner's rule, 2026-10-03, confirmed 2026-10-09: each area has its own chats).
 *
 *   node --test scripts/chat-area-defaults.test.mjs
 *
 * The first tests are the rules themselves, on the pure module. The last ones are reachability: the chat
 * must actually use them, in the places named, or the module is correct and connected to nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); } };
const { readAreaModel, readAreaSettings, writeAreaModelLocal, areaInstructions, withAreaInstructions, MAX_AREA_INSTRUCTIONS } = await import('../src/components/playground/Chat/chatAreaDefaults.ts');

test('an area’s model comes from the account, then this browser, and never from another area', () => {
  const map = readAreaSettings({ areas: { dev: { model: 'strong-1' }, office: { model: '' } } });
  assert.equal(readAreaModel('dev', map), 'strong-1');
  assert.equal(readAreaModel('office', map), null, 'an empty record is no record');
  assert.equal(readAreaModel('studio', map), null, 'an area with nothing remembered has no default');
  writeAreaModelLocal('studio', 'fast-2');
  assert.equal(readAreaModel('studio', map), 'fast-2', 'this browser is the fast path');
  assert.equal(readAreaModel('social', map), null, 'what Studio remembers is not Social’s');
  writeAreaModelLocal('dev', 'local-only');
  assert.equal(readAreaModel('dev', map), 'strong-1', 'the account’s record wins over this browser’s');
});

test('no area, or a malformed one, has no defaults', () => {
  const map = readAreaSettings({ areas: { dev: { model: 'm', instructions: 'x' } } });
  for (const bad of [null, '', 'Dev', 'two words', '../dev', 'x'.repeat(41)]) {
    assert.equal(readAreaModel(bad, map), null);
    assert.equal(areaInstructions(bad, map), '');
  }
  writeAreaModelLocal('Bad Area', 'm');
  assert.ok(![...store.keys()].some((k) => k.includes('Bad Area')), 'a malformed area writes nothing');
});

test('settings that are missing or malformed read as no areas', () => {
  for (const s of [null, undefined, {}, { areas: null }, { areas: 'x' }, { areas: ['dev'] }]) assert.deepEqual(readAreaSettings(s), {});
  const map = readAreaSettings({ areas: { dev: { model: 7, instructions: { a: 1 } } } });
  assert.equal(areaInstructions('dev', map), '', 'an instruction that is not text is none');
  store.clear();
  assert.equal(readAreaModel('dev', map), null, 'a model id that is not text is none');
});

test('the area’s instruction goes ahead of the person’s saved prompt, named as theirs', () => {
  const map = readAreaSettings({ areas: { dev: { instructions: '  Answer as an engineer.  ' } } });
  assert.equal(areaInstructions('dev', map), 'Answer as an engineer.');
  const both = withAreaInstructions('Be brief.', 'dev', map, 'Dev');
  assert.match(both, /^Standing instructions for this part of the workspace \(Dev\), written by the user:\nAnswer as an engineer\.\n\nBe brief\.$/);
  assert.equal(withAreaInstructions('Be brief.', 'office', map), 'Be brief.', 'an area with none leaves the saved prompt as it is');
  assert.equal(withAreaInstructions('Be brief.', null, map), 'Be brief.', 'no area, no area instruction');
  assert.equal(withAreaInstructions(null, 'dev', map).endsWith('Answer as an engineer.'), true);
  const long = readAreaSettings({ areas: { dev: { instructions: 'x'.repeat(MAX_AREA_INSTRUCTIONS + 500) } } });
  assert.equal(areaInstructions('dev', long).length, MAX_AREA_INSTRUCTIONS, 'an instruction is capped');
});

// ── reachability: the chat uses them ─────────────────────────────────────────────────────────
const chat = readFileSync(new URL('../src/components/playground/Chat/ChatWithLLM.tsx', import.meta.url), 'utf8');

test('a pick made inside an area is saved as that area’s, and leaves the account-wide default alone', () => {
  const start = chat.indexOf('const handleModelSelect = async');
  const body = chat.slice(start, chat.indexOf('syncTogglesForModel(model);', start));
  assert.match(body, /const pickedInArea = embedArea\(\);/);
  assert.match(body, /if \(pickedInArea\) \{[\s\S]*saveSettingsToDb\(`areas\.\$\{pickedInArea\}\.model`, model\.id\);[\s\S]*\} else \{[\s\S]*saveSettingsToDb\('models\.defaultModel', model\.id\);/);
  const inArea = body.slice(body.indexOf('if (pickedInArea) {'), body.indexOf('} else {'));
  assert.ok(!inArea.includes('models.defaultModel'), 'the account-wide default is not written from inside an area');
});

test('the area’s model is put on a new chat only, when the list, the settings or the area arrive', () => {
  assert.match(chat, /if \(!isWorkspaceEmbed\(\) \|\| openConversationRef\.current\) return;/, 'never on an open conversation, which keeps its own model');
  assert.match(chat, /readAreaModel\(embedArea\(\), areaSettingsRef\.current\) \|\| accountDefaultModelRef\.current \|\| readLastModelId\(\)/,
    'an area with nothing remembered, and Overview, fall back to the account default: never the last area’s model');
  assert.match(chat, /if \(!activeConversationId && !isModelsLoading\) applyAreaModel\(\);/);
  assert.match(chat, /areaSettingsRef\.current = readAreaSettings\(settings\);[\s\S]{0,220}applyAreaModel\(\);/);
  assert.match(chat, /if \(data\.type === 'area' \|\| data\.type === 'area-settings'\) applyAreaModel\(\);/);
  assert.match(chat, /event\.origin !== window\.location\.origin \|\| event\.source !== window\.parent/, 'only the workspace page may say so');
});

test('the area’s instruction is sent with the turn', () => {
  assert.match(chat, /buildChatSystemPrompt\(\s*emptyStateMode,[\s\S]{0,200}withAreaInstructions\(savedSystemPrompt, embedArea\(\), areaSettingsRef\.current\),/);
});
