import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { REQUIRED_ENV, checkEnv, enforceEnv } from '../src/server/config/requiredEnv.js';
import { render } from '../src/server/services/metrics.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** A fully-populated environment for a role, so each test removes exactly one thing. */
function fullEnv(role, extra = {}) {
  const spec = REQUIRED_ENV[role];
  const env = { NODE_ENV: 'production' };
  for (const e of [...spec.required, ...spec.expected]) env[e.key] = `live-value-for-${e.key}`;
  return { ...env, ...extra };
}

/** Captures what enforceEnv would log and whether it would exit. */
function harness() {
  const lines = [];
  let exitCode = null;
  return {
    lines,
    get exitCode() { return exitCode; },
    opts: {
      exit: (code) => { exitCode = code; },
      log: { error: (m) => lines.push(m), warn: (m) => lines.push(m) },
    },
  };
}

test('a fully configured process is clean', () => {
  for (const role of Object.keys(REQUIRED_ENV)) {
    assert.deepEqual(checkEnv(role, fullEnv(role)), { missingRequired: [], forbidden: [], missingExpected: [] }, role);
  }
});

test('an EMPTY value counts as missing — REGISTRATION_OPEN= closed signup for twelve days', () => {
  const r = checkEnv('backend', fullEnv('backend', { REGISTRATION_OPEN: '', DB_HOST: '   ' }));
  assert.deepEqual(r.missingExpected, ['REGISTRATION_OPEN']);
  assert.deepEqual(r.missingRequired, ['DB_HOST']);
});

test('a default committed to git is caught in either tier', () => {
  const r = checkEnv('chat-workers', fullEnv('chat-workers', {
    DB_PASSWORD: 'xenostudio_password',
    JWT_SECRET: 'xenostudio-super-secret-jwt-key-change-in-production',
  }));
  assert.deepEqual(r.forbidden.sort(), ['DB_PASSWORD', 'JWT_SECRET']);
});

test('production + missing REQUIRED key refuses to boot, naming the key and never a value', () => {
  const h = harness();
  const env = fullEnv('backend');
  delete env.SECRET_BOX_KEY;
  enforceEnv('backend', { env, ...h.opts });
  assert.equal(h.exitCode, 1);
  assert.ok(h.lines.some((l) => l.includes('SECRET_BOX_KEY')), 'the missing key is named');
  assert.ok(h.lines.some((l) => l.includes('environment:')), 'the log points at the compose block');
  assert.ok(!h.lines.join('\n').includes('live-value-for-'), 'no value may reach a log line');
});

test('production + missing EXPECTED key boots, but loudly', () => {
  const h = harness();
  const env = fullEnv('backend');
  delete env.RESEND_API_KEY;
  const r = enforceEnv('backend', { env, ...h.opts });
  assert.equal(h.exitCode, null, 'a degraded feature must not become a total outage');
  assert.deepEqual(r.missingExpected, ['RESEND_API_KEY']);
  assert.ok(h.lines.some((l) => l.startsWith('FATAL-CONFIG') && l.includes('RESEND_API_KEY')));
});

test('a committed default in an EXPECTED key still refuses — a secret that works is never "degraded"', () => {
  const h = harness();
  enforceEnv('chat-workers', { env: fullEnv('chat-workers', { JWT_SECRET: 'xenostudio-super-secret-jwt-key-change-in-production' }), ...h.opts });
  assert.equal(h.exitCode, 1);
});

test('outside production nothing ever exits', () => {
  const h = harness();
  enforceEnv('backend', { env: { NODE_ENV: 'development' }, ...h.opts });
  assert.equal(h.exitCode, null);
});

/*
 * 🔴 THE 2026-08-24 GATE. A key in .env reaches a container only if the service's
 * compose `environment:` block names it. Every key the manifest depends on must be
 * named there — otherwise the check would be guarding a key compose never passes,
 * and production would refuse to boot (required) or page forever (expected).
 */
function composeEnvKeys(service) {
  const compose = read('../docker-compose.yml').replace(/\r\n/g, '\n');
  const start = compose.indexOf(`\n  ${service}:\n`);
  assert.ok(start >= 0, `service ${service} not found in docker-compose.yml`);
  const rest = compose.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z0-9][a-z0-9_-]*:\n|\n[a-z]/);
  const block = next >= 0 ? rest.slice(0, next + 1) : rest;
  const keys = new Set();
  for (const m of block.matchAll(/^\s+-\s*([A-Z][A-Z0-9_]*)\s*=/gm)) keys.add(m[1]);
  for (const m of block.matchAll(/^\s{6,}([A-Z][A-Z0-9_]*)\s*:/gm)) keys.add(m[1]);
  assert.ok(keys.size > 0, `parsed no environment keys for ${service} — the parser is broken, not the compose file`);
  return keys;
}

for (const role of Object.keys(REQUIRED_ENV)) {
  test(`every ${role} manifest key is PASSED by its compose environment block`, () => {
    const passed = composeEnvKeys(role);
    const spec = REQUIRED_ENV[role];
    const notPassed = [...spec.required, ...spec.expected].map((e) => e.key).filter((k) => !passed.has(k));
    assert.deepEqual(notPassed, [], `named in requiredEnv.js but not passed by docker-compose.yml → ${role}.environment`);
  });
}

/*
 * Built, tested, and unreachable is the shape this estate keeps shipping. The
 * manifest is worthless unless both processes actually run it before they serve.
 */
test('the backend enforces its manifest before it listens, and exports the result', () => {
  const src = read('../src/server/index.js');
  const call = src.indexOf("enforceEnv('backend')");
  assert.ok(call > 0, 'index.js must call enforceEnv("backend")');
  const listen = src.search(/\b(?:app|server|httpServer)\.listen\(/);
  assert.ok(listen > call, 'the check must run before the server listens');
  assert.match(src, /configMissing:\s*\(\)\s*=>\s*configCheck\.missingExpected/, '/metrics must export the degraded keys');
});

test('chat-workers enforces its manifest before its first query', () => {
  const src = read('../src/server/workers/chatProjectWorkerProcess.js');
  const call = src.indexOf("enforceEnv('chat-workers')");
  const firstQuery = src.indexOf('pool.query(');
  assert.ok(call > 0, 'the worker must call enforceEnv("chat-workers")');
  assert.ok(firstQuery > call, 'the check must run before the pool is used');
});

test('/metrics always emits the count, including zero, and names each missing key', () => {
  const clean = render({ configMissing: () => [] });
  assert.match(clean, /^xeno_config_expected_missing_count 0$/m, 'zero must be emitted so the alert has a series');
  const degraded = render({ configMissing: () => ['RESEND_API_KEY', 'REGISTRATION_OPEN'] });
  assert.match(degraded, /^xeno_config_expected_missing_count 2$/m);
  assert.match(degraded, /^xeno_config_expected_missing\{key="RESEND_API_KEY"\} 1$/m);
});

test('the alert rule exists and reads the metric the backend emits', () => {
  const rules = read('../observability/slo-rules.yml');
  // `\r?` — a fresh checkout on Windows (core.autocrlf=true) carries CRLF in the working tree while
  // the index holds LF; it is the same rule either way, and this gate is about the rule.
  assert.match(rules, /alert: XenoExpectedConfigMissing\r?\n\s+expr: max\(xeno_config_expected_missing_count\) > 0/);
});
