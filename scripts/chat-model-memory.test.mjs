/**
 * The chat remembers its model — a refresh must not reset it.
 *
 * ## The defect (reported 2026-09-17)
 *
 * Every page load re-selected the hard-coded favourite (`gpt-5.6-terra`): a conversation held
 * on Grok came back on GPT, and a user who had picked a model chose it again after every
 * reload. `conversations.model_id` had been stored server-side since the first schema and was
 * READ BY NOTHING on the client; `UserSettings.models.defaultModel` was typed and WRITTEN BY
 * NOTHING. Built, typed, unreachable — the same shape this workspace keeps finding.
 *
 * ## The rule this pins (ChatGPT and Claude both behave this way)
 *
 *   conversation > user's explicit pick this session > account setting > this browser > fallback
 *
 * Each gate below was verified to FAIL when its line in ChatWithLLM.tsx is removed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const CHAT = readFileSync(new URL('../src/components/playground/Chat/ChatWithLLM.tsx', import.meta.url), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const code = stripComments(CHAT);

const slice = (from, to) => {
  const a = code.indexOf(from);
  assert.ok(a >= 0, `anchor not found: ${from}`);
  const b = code.indexOf(to, a);
  return code.slice(a, b < 0 ? undefined : b);
};

test('the catalogue load prefers the remembered model over the hard-coded favourite', () => {
  const load = slice('const loadModels = async () => {', 'loadModels();');
  const remembered = load.indexOf('findModelById(models, modelPreferenceRef.current.id)');
  const favourite = load.indexOf("m.id === 'gpt-5.6-terra'");
  assert.ok(remembered >= 0, 'the load must consult the remembered preference');
  assert.ok(favourite >= 0, 'the favourite stays as the fallback');
  assert.ok(remembered < favourite, 'the remembered model must be tried BEFORE the favourite — the other order is the defect');
  assert.match(load, /const preferred = remembered\s*\|\|/, 'the remembered model must short-circuit the fallback chain');
});

test('a reopened conversation comes back on the model it was last used with', () => {
  const load = slice('const handleLoadConversation = async (conversationId: string) => {', 'const handleRefreshConversation');
  assert.match(
    load, /preferModel\(fullConversation\.model_id, 'conversation'\)/,
    'the server row carries model_id; the client must read it, at the highest rank',
  );
});

test('the account default applies, but never outranks the conversation', () => {
  assert.match(code, /preferModel\(settings\.models\.defaultModel, 'settings'\)/, 'settings.models.defaultModel must be read on load');
  const rank = /MODEL_PREFERENCE_RANK[^=]*=\s*\{([^}]*)\}/.exec(code)?.[1] ?? '';
  const ranks = Object.fromEntries([...rank.matchAll(/(\w+):\s*(\d+)/g)].map(([, k, v]) => [k, Number(v)]));
  assert.ok(ranks.conversation > ranks.user && ranks.user > ranks.settings && ranks.settings > ranks.local && ranks.local > ranks.fallback,
    `ranks must be conversation > user > settings > local > fallback, got ${JSON.stringify(ranks)}`);
  const prefer = slice('const preferModel = useCallback(', '}, []);');
  assert.match(prefer, /MODEL_PREFERENCE_RANK\[source\] < MODEL_PREFERENCE_RANK\[current\.source\]/, 'a lower-ranked source arriving later must be ignored');
});

test('picking a model is remembered in the browser, the account and the conversation row', () => {
  const select = slice('const handleModelSelect = async (model: Model) => {', 'const syncTogglesForModel');
  assert.match(select, /writeLastModelId\(model\.id\)/, 'the browser fast path');
  assert.match(select, /saveSettingsToDb\('models\.defaultModel', model\.id\)/, 'the account default — what a NEW chat opens with, across devices');
  assert.match(select, /updateConversation\(dbConversationId, \{ model_id: model\.id \}\)/, 'the conversation row — what THIS chat reopens with');
  assert.match(select, /activeConversationId !== CHAT_DEMO_CONVERSATION_ID/, 'the demo conversation is not a server row');
});

test('the browser copy is read synchronously before any request returns', () => {
  assert.match(code, /const \[initialPreference\] = useState<ModelPreference>\(initialModelPreference\)/);
  assert.match(code, /localStorage\.getItem\(LAST_MODEL_STORAGE_KEY\)/);
});
