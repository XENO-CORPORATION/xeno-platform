/**
 * XENO-WORKFORCE-01 NFR-09: "No new third-party distributed service is required solely for
 * normalization. Keep boundaries modular within existing deployables unless measured needs justify
 * extraction."
 *
 * Two properties make that true, and each is a thing a later change could quietly break:
 *
 *   1. The workforce surface lives INSIDE the existing backend. It is mounted by
 *      src/server/index.js -- the process Dockerfile.backend builds -- and there is no workforce
 *      service in docker-compose.yml. A workforce worker or sidecar would be a new deployable.
 *   2. Nothing the workforce code loads reaches a client for a distributed service. The whole
 *      transitive import graph, from every workforce route and service, is walked and every
 *      third-party package it reaches must be on an allowlist of HTTP-framework and auth
 *      libraries. That is how a Redis queue, a message bus or a search cluster would arrive:
 *      as one import in one helper, three files away from the workforce module that uses it.
 *
 * It persists to PostgreSQL through the pool the backend already hands it (req.db), so the
 * graph contains no database driver of its own -- which is also asserted, because a workforce
 * module constructing its own `pg.Pool` would be a second connection budget to the same server.
 *
 * What this does NOT prove: that a future measured need could not justify extraction. NFR-09
 * permits that; this gate turns it from a silent drift into a deliberate edit of ALLOWED below.
 *
 * Mutation-checked 2026-09-23, each against a clean 5/5: importing ioredis into workforceScope,
 * importing an unlisted package there, a require() there, a `workforce-worker` compose service,
 * and unmounting the router from index.js -- every one fails its own check (3/5), and restoring
 * returns 5/5. The first clean run failed on `crypto` imported without `node:`, which is why
 * builtins are decided by Node's own list rather than by the prefix.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/** HTTP framework and request authentication -- in-process libraries, none of them a service. */
const ALLOWED = new Set(['express', 'express-rate-limit', 'jsonwebtoken']);

/** Clients for distributed services this backend could reach for. Named so a failure says WHY. */
const DISTRIBUTED = ['ioredis', 'redis', 'bull', 'bullmq', 'kafkajs', 'amqplib', 'nats', 'meilisearch',
  '@elastic/elasticsearch', 'mongodb', '@aws-sdk/client-sqs', '@google-cloud/pubsub', 'pg'];

const SPECIFIER = /(?:^|[\s;(=])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;(=])import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|[\s;])import\s+['"]([^'"]+)['"]/gm;

function workforceRoots() {
  const out = [];
  for (const dir of ['src/server/routes', 'src/server/services']) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      if (/workforce/i.test(name) && name.endsWith('.js')) out.push(`${dir}/${name}`);
    }
  }
  return out.sort();
}

/** Walk every relative import from `roots`; return the files reached and the bare packages. */
function importGraph(roots) {
  const files = new Set();
  const packages = new Map();
  const loaders = [];
  const visit = (file) => {
    if (files.has(file)) return;
    files.add(file);
    const text = read(file);
    // A graph walked through ESM syntax alone is blind to require(). Refuse rather than miss it.
    if (/\brequire\s*\(|\bcreateRequire\b/.test(text)) loaders.push(file);
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      // A Node builtin is part of the runtime, not a dependency, with or without the `node:` prefix
      // (middleware/auth.js imports bare 'crypto'). Node's own list decides, not a guess.
      if (!specifier || specifier.startsWith('node:') || builtinModules.includes(specifier.split('/')[0])) continue;
      if (specifier.startsWith('.')) {
        visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)));
      } else {
        const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
        if (!packages.has(name)) packages.set(name, file);
      }
    }
  };
  roots.forEach(visit);
  return { files, packages, loaders };
}

test('the workforce surface is part of the existing backend, not a new deployable (NFR-09)', async (t) => {
  const roots = workforceRoots();

  await t.test('there is a workforce surface to check', () => {
    // A gate over an empty set passes forever. The router and at least one service must be found.
    assert.ok(roots.includes('src/server/routes/workforceRoutes.js'), `workforce router not found among ${roots.join(', ')}`);
    assert.ok(roots.some((f) => f.startsWith('src/server/services/')), 'no workforce service found');
  });

  await t.test('it is mounted by the backend process that Dockerfile.backend builds', () => {
    const index = read('src/server/index.js');
    assert.match(index, /import\s+workforceRoutes\s+from\s+['"]\.\/routes\/workforceRoutes\.js['"]/);
    assert.match(index, /app\.use\(\s*['"]\/api\/workforce['"][^)]*workforceRoutes\s*\)/);
    const dockerfile = read('Dockerfile.backend');
    assert.match(dockerfile, /^COPY\s+(?:--\S+\s+)*src\/server\/\s/m, 'Dockerfile.backend no longer copies src/server');
  });

  await t.test('no compose service exists for the workforce', () => {
    const services = [...read('docker-compose.yml').matchAll(/^ {2}([a-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
    assert.ok(services.includes('backend'), `compose parse found no backend service: ${services.join(', ')}`);
    assert.deepEqual(services.filter((s) => /workforce/i.test(s)), []);
  });

  await t.test('every package the workforce code reaches is an in-process library', () => {
    const { files, packages, loaders } = importGraph(roots);
    assert.ok(files.size > roots.length, 'the walk reached nothing beyond its roots; the import pattern is broken');
    assert.deepEqual(loaders, [], 'a reached module loads code outside ESM import syntax; this walk cannot see what it loads');
    const distributed = [...packages].filter(([name]) => DISTRIBUTED.includes(name)).map(([name, from]) => `${name} (via ${from})`);
    assert.deepEqual(distributed, [], 'workforce code reaches a distributed-service client');
    const unexpected = [...packages].filter(([name]) => !ALLOWED.has(name)).map(([name, from]) => `${name} (via ${from})`);
    assert.deepEqual(unexpected, [], 'workforce code reaches a package outside the reviewed allowlist');
  });
});
