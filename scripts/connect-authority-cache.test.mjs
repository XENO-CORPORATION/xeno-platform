// The Connect adapter reuses a GRANTED authority for at most 30 s per token and workspace, never past the token's
// expiry, never a refusal, and still checks the answer against the verified token every time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlatformAuthority } from '../integrations/xeno-connect/platform-authority.mjs';

function rig({ refuse = false } = {}) {
  let t = 1_000_000; const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body); calls.push(body);
    if (refuse) return new Response(JSON.stringify({ error: 'suspended' }), { status: 403 });
    return new Response(JSON.stringify({ principalId: 'u1', consumerId: 'xeno-storage', workspaceId: body.workspaceId, membershipActive: true }), { status: 200 });
  };
  const a = createPlatformAuthority({ platformOrigin: 'http://127.0.0.1:9', serviceToken: 'x'.repeat(40), lookupLink: async () => null, fetchImpl, now: () => t });
  const req = (ws = 'w1', tok = 'tokA') => ({ url: `/v1/connect/workspaces/${ws}/x`, params: { workspaceId: ws }, headers: { authorization: `DPoP ${tok}` } });
  return { a, calls, req, tick: (ms) => { t += ms; }, at: () => t };
}
const claims = (t, extra = {}) => ({ sub: 'u1', client_id: 'xeno-storage', exp: Math.floor((t + 600_000) / 1000), ...extra });

test('a granted answer is reused for 30 s, then asked again', async () => {
  const r = rig();
  for (let i = 0; i < 15; i++) { await r.a.resolveVerifiedToken(claims(r.at()), r.req()); r.tick(2000); } // a drive polling every 2 s
  assert.equal(r.calls.length, 1, 'one ask for 30 s of polling');
  await r.a.resolveVerifiedToken(claims(r.at()), r.req());
  assert.equal(r.calls.length, 2, 'asked again once 30 s have passed');
});

test('the reuse is per token AND per workspace', async () => {
  const r = rig();
  await r.a.resolveVerifiedToken(claims(r.at()), r.req('w1', 'tokA'));
  await r.a.resolveVerifiedToken(claims(r.at()), r.req('w2', 'tokA'));
  await r.a.resolveVerifiedToken(claims(r.at()), r.req('w1', 'tokB'));
  assert.equal(r.calls.length, 3);
});

test('never past the token expiry', async () => {
  const r = rig();
  const c = claims(r.at(), { exp: Math.floor((r.at() + 5000) / 1000) });
  await r.a.resolveVerifiedToken(c, r.req()); r.tick(6000);
  await r.a.resolveVerifiedToken(c, r.req());
  assert.equal(r.calls.length, 2);
});

test('a refusal is never cached', async () => {
  const r = rig({ refuse: true });
  await assert.rejects(r.a.resolveVerifiedToken(claims(r.at()), r.req()), /refused/);
  await assert.rejects(r.a.resolveVerifiedToken(claims(r.at()), r.req()), /refused/);
  assert.equal(r.calls.length, 2);
});

test('a cached answer is still checked against the verified token', async () => {
  const r = rig();
  await r.a.resolveVerifiedToken(claims(r.at()), r.req());
  await assert.rejects(r.a.resolveVerifiedToken(claims(r.at(), { sub: 'someone-else' }), r.req()), /mismatch/);
});
