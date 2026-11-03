/**
 * A long response must notice the person leaving: res 'close', never req 'close' alone.
 *
 * Node emits req 'close' once the request has been read. A handler that awaits anything first (a body, a lookup, an
 * upstream fetch) and only then adds req.on('close') has already missed it, so the listener never fires. Found
 * 2026-11-03: chat placed credit holds after a person left (#1101), and the same shape left a XENO Compute command
 * running after its caller left, Places and agent-presence timers running forever, and remote-run subscribers piling up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('after an await, req "close" never fires when the person leaves; res "close" does', async () => {
  const fired = { req: false, res: false };
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      await wait(30);   // the upstream call, the lookup: anything awaited before the stream starts
      req.on('close', () => { fired.req = true; });
      res.on('close', () => { fired.res = true; });
      res.writeHead(200, { 'content-type': 'application/x-ndjson' }); res.write('{"started":true}\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await new Promise((resolve) => {
      const r = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/' }, (resp) => {
        resp.once('data', () => { r.destroy(); setTimeout(resolve, 150); });   // the person leaves mid-stream
      });
      r.on('error', () => {}); r.end('{"command":"sleep 600"}');
    });
    assert.equal(fired.res, true, 'res "close" tells the server the person left');
    assert.equal(fired.req, false, 'req "close" had already fired before the listener was added, so it never fires again');
  } finally { server.close(); }
});

test('no server code relies on req "close" alone to notice a person leaving', () => {
  const root = path.resolve(here, '../src/server');
  const files = [];
  const walk = (d) => { for (const n of readdirSync(d)) { if (n === 'node_modules' || n === 'tests' || n === 'vendor') continue; const p = path.join(d, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(m?js)$/.test(n)) files.push(p); } };
  walk(root);
  const offenders = files.filter((f) => { const s = readFileSync(f, 'utf8'); return /req\.on\(\s*'close'/.test(s) && !/res\.on\(\s*'close'/.test(s); })
    .map((f) => path.relative(root, f));
  assert.deepEqual(offenders, [], `listen on res 'close' (req 'close' may already have fired): ${offenders.join(', ')}`);
});
