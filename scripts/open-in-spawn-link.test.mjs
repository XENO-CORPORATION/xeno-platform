// The "Open in Spawn" link (platform-agents.js) must match the closed shape Spawn's `spawn open-link` accepts
// (agreed 2026-10-15): only agent / issuer / program, issuer exactly xenosystem.ai or xenostudio.ai, no credential.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../prototypes/xeno-workspace/platform-agents.js', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('const SPAWN_ISSUERS'), src.indexOf('const EFFORTS'));
const make = (origin) => new Function('location', `${body}; return spawnLink;`)({ origin });
const AGT = 'agt_' + '0123456789abcdef'.repeat(2);

test('emits the agreed closed shape on the two production issuers', () => {
  for (const origin of ['https://xenosystem.ai', 'https://xenostudio.ai']) {
    const u = new URL(make(origin)(AGT, 'codex'));
    assert.equal(u.protocol, 'xeno-spawn:'); assert.equal(u.host || u.pathname.replace(/^\/\//, ''), 'bind');
    assert.deepEqual([...u.searchParams.keys()], ['agent', 'issuer', 'program']);
    assert.equal(u.searchParams.get('issuer'), origin); assert.equal(u.searchParams.get('agent'), AGT);
  }
  assert.equal(new URL(make('https://xenosystem.ai')(AGT)).searchParams.has('program'), false);
});
test('no link where Spawn would refuse it', () => {
  assert.equal(make('http://localhost:5173')(AGT), null);
  assert.equal(make('https://xenosystem.ai')('agt_NOTHEX'), null);
  assert.equal(make('https://xenosystem.ai')('usr_' + AGT.slice(4)), null);
});
test('the rendered button uses the builder, never a hand-written link', () => {
  assert.equal((src.match(/xeno-spawn:\/\//g) || []).length, 1);
});

// The copyable commands must be Spawn's real CLI: `spawn profiles bind <agt_id> --agent claude|codex`, then
// `spawn <program> --profile <program>/<name>`, where <name> is bind's own cleanup of the agent name (agentBinding.js).
const cmds = (() => {
  const b = src.slice(src.indexOf('const SPAWN_PROGRAMS'), src.indexOf('const EFFORTS'));
  return new Function(`${b}; return { spawnCommands, spawnProfileName };`)();
})();
test('copy commands are Spawn\'s bind and launch, with the profile bind will create', () => {
  const a = { id: AGT, name: 'Release <Bot> #2' };
  assert.deepEqual(cmds.spawnCommands(a, 'codex'), {
    launch: `spawn codex --agent ${AGT}`,
    bind: `spawn profiles bind ${AGT} --agent codex`,
  });
  assert.equal(cmds.spawnProfileName({ id: AGT, name: '!!!' }), 'xeno-agent-01234567');
  assert.equal(cmds.spawnProfileName({ id: AGT, name: 'x'.repeat(60) }).length, 48);
});

test('the Spawn release that ships --agent is named before this can merge', () => {
  assert.doesNotMatch(src, /__SPAWN_RELEASE__/);
});
