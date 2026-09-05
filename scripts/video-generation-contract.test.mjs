import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/services/videoGenerationService.ts', import.meta.url), 'utf8');
function service(reply) {
  const calls = [];
  const exports = {};
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function('exports', 'require', compiled)(exports, (id) => {
    assert.equal(id, './xenoProxyRequest');
    return { postXenoRequest: async (...args) => {
      calls.push(args);
      return typeof reply === 'function' ? reply(...args) : reply;
    } };
  });
  return { api: exports.default, calls };
}

const model = 'fal-ai/veo2';
test('every declared video model dispatches its exact identity, never another vendor/version', async () => {
  const { api, calls } = service((_path, body) => ({ model: body.model, data: [{ url: 'https://media.example/video.mp4' }] }));
  for (const id of api.getAvailableVideoModels()) {
    const result = await api.generateVideo(id, { prompt: 'A test scene', image_url: 'https://media.example/frame.png' });
    assert.equal(result.success, true);
    assert.equal(calls.at(-1)[1].model, id);
    assert.equal(calls.at(-1)[0], '/videos/generate');
    assert.match(calls.at(-1)[1].requestId, /^[a-f0-9-]{36}$/);
  }
  assert.equal(new Set(calls.map(([, body]) => body.requestId)).size, calls.length);
});
test('unknown model, missing prompt and missing required frame never dispatch or spend', async () => {
  const { api, calls } = service(null);
  for (const [id, input] of [
    ['unknown', { prompt: 'Test' }],
    [model, { prompt: ' ' }],
    ['fal-ai/kling-video/v1.6/pro/image-to-video', { prompt: 'Test' }],
  ]) {
    assert.equal((await api.generateVideo(id, input)).success, false);
  }
  assert.equal(calls.length, 0);
});
test('malformed output, unsafe URLs and model substitutions never become successful results', async () => {
  for (const reply of [null, { data: {} }, { data: [] }, { data: [null] }, { data: [{}] },
    { data: [{ url: 'javascript:alert(1)' }] },
    { model: 'another-model', data: [{ url: 'https://media.example/v.mp4' }] },
  ]) {
    const { api } = service(reply);
    const result = await api.generateVideo(model, { prompt: 'Test' });
    assert.equal(result.success, false);
    assert.deepEqual(result.videos, []);
  }
});
test('backend credit/auth failures are preserved and are not retried automatically', async () => {
  const { api, calls } = service(() => { throw new Error('Insufficient credits'); });
  const result = await api.generateVideo(model, { prompt: 'Test' });
  assert.equal(result.error, 'Insufficient credits');
  assert.equal(result.success, false);
  assert.equal(calls.length, 1);
});
test('video UI uses canonical session authority and discards URL credentials without consuming them', () => {
  const ui = readFileSync(new URL('../src/components/playground/Generation/VideoGenerationInterface2.tsx', import.meta.url), 'utf8');
  assert.match(ui, /hasAuthSession\(\)/);
  assert.doesNotMatch(ui, /API_TOKENS|checkApiTokens|window\.XENO_API_KEY|params\.get\('xeno_token'\)/);
  assert.match(ui, /searchParams\.delete\('xeno_token'\)/);
  assert.match(ui, /if \(generationInFlight\.current\) return/);
  assert.match(ui, /finally \{\s*generationInFlight\.current = false/);
});
