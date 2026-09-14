/**
 * Chat search reaches Web Context DIRECTLY, never through Cloudflare.
 *
 * ## The defect this pins, measured 2026-09-14
 *
 * Web Context runs on the same host as the platform backend (`xeno-web-context-api-1`, bound
 * to 127.0.0.1:8091), yet `XENO_WEB_CONTEXT_URL` pointed at `https://web-context.xenostudio.ai`.
 * Every chat search therefore left the machine, crossed Cloudflare's edge and came back:
 *
 *   127.0.0.1:8091             -> 0.001 s
 *   web-context.xenostudio.ai  -> 0.151 s   (server: cloudflare)
 *
 * and in one real turn four of six searches failed on intermittent 502 HTML pages from that
 * edge. We are not on an Enterprise plan, so the proxy's timeouts and error pages are not
 * ours to tune — for a call that never needed to leave the box.
 *
 * ## The route, and why this one
 *
 * The backend joins Web Context's OWN `frontend` network from the platform compose file and
 * calls the API container by name. A throwaway container on that network reached the API in
 * 3 ms, and PostgreSQL (on Web Context's `data` network) stayed unreachable from it.
 *
 * 🔴 Web Context's overlay is NOT modified, deliberately. Its qualified test
 * (tests/production-deployment.test.mjs) asserts the overlay never declares `networks:` —
 * "network isolation stays exactly as the base file defines it". Joining from THIS side
 * honours that instead of deleting an assertion to go green.
 *
 * ## What each half protects
 *
 *   - the validator exemption is an explicit ALLOWLIST of single-label container names,
 *     never a private-IP heuristic — `10.x` also carries VPN traffic that crosses a wire;
 *   - the retry is for gateway faults and dropped connections only, never a 429;
 *   - only the backend joins the network, because it is the only caller of that token;
 *   - the deploy refuses to swap when the network is missing, because the auto-rollback
 *     would run the same failing `up` and could not recover.
 *
 * Mutation-checked 2026-09-14, each against a green control — see the commit message.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createChatWebContextService } from '../src/server/services/chatWebContext.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * ⚠️ Normalised to LF and prefixed with a newline, both deliberately. The compose file is
 * authored on Windows and checked out CRLF, and in a JS regex `.` does not match a carriage
 * return, so a block match silently stops at the first line ending. And `services:` is the
 * file's very first line, so a search for a newline followed by `services:` finds nothing
 * without the leading newline. The first draft of this test had both bugs and failed against
 * a correct compose file. remote-deploy.sh normalises CRLF before building, so reading the
 * files this way matches what the box actually runs.
 */
const CRLF = new RegExp(String.fromCharCode(13) + String.fromCharCode(10), 'g');
const LF = String.fromCharCode(10);
const readLf = (...parts) => LF + readFileSync(join(ROOT, ...parts), 'utf8').replace(CRLF, LF);
const COMPOSE = readLf('docker-compose.yml');
const DEPLOY = readLf('scripts', 'remote-deploy.sh');

const REQUIRED_SCOPES = [
  'account:read', 'search:execute', 'jobs:write', 'jobs:read', 'jobs:control', 'artifacts:read',
];
const INPUT = {
  actorId: 'user-1',
  conversationId: '00000000-0000-4000-8000-000000000001',
  userMessageId: '00000000-0000-4000-8000-000000000002',
  query: 'latest survival game released',
  count: 2,
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});

/**
 * A production-shaped service. Production refuses a plaintext token env, so the credential is
 * a mounted file here exactly as it is on the box.
 */
function productionService({ url, internalHosts, searchResponses = [], sleeps = [] }) {
  const calls = [];
  let searchIndex = 0;
  const fetchImpl = async (input, init = {}) => {
    const target = new URL(input);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ origin: target.origin, path: target.pathname, body });
    if (target.pathname === '/v1/account') {
      return json({ tokenId: 't', tenantId: 'tenant-1', scopes: REQUIRED_SCOPES, quota: {} });
    }
    if (target.pathname === '/v1/search') {
      const next = searchResponses[Math.min(searchIndex, searchResponses.length - 1)];
      searchIndex += 1;
      if (next instanceof Error) throw next;
      return next ?? json({ requestId: 'r', terminalReason: 'completed', items: [] });
    }
    throw new Error(`unexpected request ${target.href}`);
  };
  const service = createChatWebContextService({
    env: {
      NODE_ENV: 'production',
      XENO_CHAT_WEB_CONTEXT_ENABLED: 'true',
      XENO_WEB_CONTEXT_URL: url,
      ...(internalHosts === undefined ? {} : { XENO_WEB_CONTEXT_INTERNAL_HOSTS: internalHosts }),
      XENO_WEB_CONTEXT_TOKEN_FILE: '/run/secrets/xeno_web_context_token',
    },
    readFileSync: () => 'mounted-token',
    fetchImpl,
    sleep: async (ms) => { sleeps.push(ms); },
    random: () => 0.5,
  });
  return { service, calls, sleeps };
}

const searchCalls = (calls) => calls.filter((c) => c.path === '/v1/search');
const refusedAsInsecure = (error) => error.code === 'web_context_unavailable'
  && /HTTPS outside local development/.test(error.message);

// ── The validator exemption ─────────────────────────────────────────────────

test('🔴 production reaches an ALLOWLISTED container name over plain HTTP', async () => {
  const { service, calls } = productionService({
    url: 'http://xeno-web-context-api-1:8080',
    internalHosts: 'xeno-web-context-api-1',
  });
  await service.searchAndFetch(INPUT);
  assert.equal(searchCalls(calls).length, 1, 'the search must run');
  assert.ok(
    calls.every((c) => c.origin === 'http://xeno-web-context-api-1:8080'),
    'every request goes to the container directly — nothing reaches a public hostname',
  );
});

test('🔴 a DOTTED host is refused over HTTP even when it is allowlisted', async () => {
  // The exemption is confined to container-name resolution by structure, not by trust in the
  // allowlist: a public FQDN can never be exempted from HTTPS, even by a configuration mistake.
  const { service, calls } = productionService({
    url: 'http://web-context.xenostudio.ai',
    internalHosts: 'web-context.xenostudio.ai',
  });
  await assert.rejects(service.searchAndFetch(INPUT), refusedAsInsecure);
  assert.equal(calls.length, 0, 'the bearer token must never be sent in plaintext to that host');
});

test('🔴 a raw IP is refused over HTTP even when it is allowlisted', async () => {
  // Not a private-range heuristic: 10.x also carries VPN and overlay traffic that crosses a
  // physical wire, where a plaintext bearer token would be exposed.
  const { service, calls } = productionService({
    url: 'http://10.253.90.2:8080',
    internalHosts: '10.253.90.2',
  });
  await assert.rejects(service.searchAndFetch(INPUT), refusedAsInsecure);
  assert.equal(calls.length, 0);
});

test('a container name that is NOT allowlisted is refused over HTTP', async () => {
  const { service, calls } = productionService({
    url: 'http://some-other-container:8080',
    internalHosts: 'xeno-web-context-api-1',
  });
  await assert.rejects(service.searchAndFetch(INPUT), refusedAsInsecure);
  assert.equal(calls.length, 0);
});

test('with no allowlist at all, production HTTP stays refused exactly as before', async () => {
  const { service, calls } = productionService({ url: 'http://xeno-web-context-api-1:8080' });
  await assert.rejects(service.searchAndFetch(INPUT), refusedAsInsecure);
  assert.equal(calls.length, 0);
});

// ── The retry ───────────────────────────────────────────────────────────────

const DIRECT = { url: 'http://xeno-web-context-api-1:8080', internalHosts: 'xeno-web-context-api-1' };

test('🔴 a gateway fault is retried once, with the SAME idempotency key', async () => {
  const { service, calls, sleeps } = productionService({
    ...DIRECT,
    searchResponses: [
      json({ error: { code: 'BAD_GATEWAY', message: 'upstream' } }, 502),
      json({ requestId: 'r', terminalReason: 'completed', items: [] }),
    ],
  });
  await service.searchAndFetch(INPUT);
  const searches = searchCalls(calls);
  assert.equal(searches.length, 2, 'one retry after the 502');
  assert.equal(
    searches[0].body.idempotencyKey, searches[1].body.idempotencyKey,
    'a retry with a new key could be charged twice by the provider',
  );
  assert.equal(sleeps.length, 1, 'the retry waits before trying again');
  assert.ok(sleeps[0] >= 150 && sleeps[0] <= 400, `jittered backoff, got ${sleeps[0]} ms`);
});

test('a dropped connection (no HTTP status at all) is retried', async () => {
  const { service, calls } = productionService({
    ...DIRECT,
    searchResponses: [
      new TypeError('fetch failed'),
      json({ requestId: 'r', terminalReason: 'completed', items: [] }),
    ],
  });
  await service.searchAndFetch(INPUT);
  assert.equal(searchCalls(calls).length, 2);
});

test('the retry is bounded: two gateway faults fail the search', async () => {
  const { service, calls } = productionService({
    ...DIRECT,
    searchResponses: [json({ error: { code: 'X' } }, 503)],
  });
  await assert.rejects(service.searchAndFetch(INPUT));
  assert.equal(searchCalls(calls).length, 2, 'never more than one retry');
});

test('🔴 a 429 is NOT retried — a rate limit is a request to slow down', async () => {
  for (const status of [429, 400, 403]) {
    const { service, calls } = productionService({
      ...DIRECT,
      searchResponses: [json({ error: { code: 'NO' } }, status)],
    });
    await assert.rejects(service.searchAndFetch(INPUT));
    assert.equal(searchCalls(calls).length, 1, `HTTP ${status} must not be retried`);
  }
});

test('a cancelled search is not retried', async () => {
  const controller = new AbortController();
  controller.abort();
  const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const { service, calls } = productionService({ ...DIRECT, searchResponses: [abortError] });
  await assert.rejects(service.searchAndFetch({ ...INPUT, signal: controller.signal }));
  assert.equal(searchCalls(calls).length, 1, 'the caller went away; nobody is waiting for a retry');
});

// ── The deployment wiring ───────────────────────────────────────────────────

/** Every top-level service block in the compose file, keyed by name. */
function serviceBlocks(source) {
  const start = source.indexOf(`${LF}services:`);
  const end = source.search(/\nvolumes:\s*\n/);
  assert.ok(start >= 0 && end > start, 'compose must have a services: section followed by volumes:');
  const services = source.slice(start, end);
  const blocks = {};
  const headers = [...services.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)];
  headers.forEach((match, i) => {
    const stop = i + 1 < headers.length ? headers[i + 1].index : services.length;
    blocks[match[1]] = services.slice(match.index, stop);
  });
  return blocks;
}

const stripYamlComments = (s) => s.replace(/^\s*#.*$/gm, '');

test('🔴 the backend joins Web Context\'s own network, declared external with its exact name', () => {
  const blocks = serviceBlocks(COMPOSE);
  assert.ok(blocks.backend, 'the parser must find the backend service — a missing block would pass vacuously');
  assert.match(stripYamlComments(blocks.backend), /^\s+-\s+web-context\s*$/m,
    'the backend must join the web-context network');

  const topLevel = COMPOSE.slice(COMPOSE.search(/\nnetworks:\s*\n/));
  const block = stripYamlComments(topLevel).match(/^ {2}web-context:\s*\n((?: {4}.*\n?)+)/m);
  assert.ok(block, 'the web-context network must be declared at top level');
  assert.match(block[1], /^\s+name:\s*xeno-web-context_frontend\s*$/m,
    'it is Web Context\'s own frontend network — the one only its API sits on');
  assert.match(block[1], /^\s+external:\s*true\s*$/m,
    'external: the xeno-web-context project OWNS this network; compose here must never create it');
});

test('🔴 ONLY the backend joins it — no other service sits on a network carrying that token', () => {
  const blocks = serviceBlocks(COMPOSE);
  assert.ok(Object.keys(blocks).length >= 5, 'the parser must see the real service list, not an empty one');
  const joined = Object.entries(blocks)
    .filter(([, body]) => /^\s+-\s+web-context\s*$/m.test(stripYamlComments(body)))
    .map(([name]) => name);
  assert.deepEqual(joined, ['backend']);
});

test('🔴 the backend is configured for the DIRECT route, not the public hostname', () => {
  const backend = stripYamlComments(serviceBlocks(COMPOSE).backend || '');
  assert.match(
    backend, /XENO_WEB_CONTEXT_URL=\$\{XENO_WEB_CONTEXT_URL:-http:\/\/xeno-web-context-api-1:8080\}/,
    'the default must be the container, not https://web-context.xenostudio.ai via Cloudflare',
  );
  assert.match(
    backend, /XENO_WEB_CONTEXT_INTERNAL_HOSTS=\$\{XENO_WEB_CONTEXT_INTERNAL_HOSTS:-xeno-web-context-api-1\}/,
    'the allowlist must be in the service environment block — a value in .env alone reaches no '
    + 'container, and without it production refuses the plain-HTTP URL and every search fails',
  );
  assert.doesNotMatch(backend, /XENO_WEB_CONTEXT_URL=[^\n]*\bapi:8080/,
    'the generic `api` alias must not be used — Docker DNS could hand the token to another service');
});

test('🔴 the deploy refuses to swap the backend when that network is missing', () => {
  const preflight = DEPLOY.indexOf('docker network inspect xeno-web-context_frontend');
  assert.ok(preflight > 0, 'the backend deploy must check for the external network');
  assert.ok(
    preflight < DEPLOY.indexOf('dc up -d --no-deps --force-recreate'),
    'the check must run BEFORE the swap — the auto-rollback runs the same `up` and cannot recover',
  );
  const guard = DEPLOY.slice(preflight, preflight + 400);
  assert.match(guard, /exit [1-9]/, 'a missing network must stop the deploy, not warn');
  assert.doesNotMatch(
    DEPLOY, /docker network create[^\n]*xeno-web-context_frontend/,
    'never create it from this side — the web-context project could no longer manage it',
  );
});
