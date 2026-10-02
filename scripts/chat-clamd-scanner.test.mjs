/**
 * The resident scanner: uploads are streamed to clamd (INSTREAM) instead of running `clamscan`.
 *
 * ## Why (2026-10-01)
 * `clamscan` reloads the whole signature database on every run — 16.7 s measured on a 5-byte file —
 * and the worker scanned one file at a time, so six attached images took two minutes to clear and
 * the composer could not send them before then. clamd keeps the database resident.
 *
 * These tests run against a REAL socket speaking clamd's protocol, and the fake daemon reassembles
 * the chunks it receives, so a framing mistake fails here instead of in production.
 *
 * Mutation-checked:
 *   - treat an unreachable daemon as clean           -> "unreachable falls back to the CLI" fails
 *   - drop the zero-length terminator chunk          -> the round-trip test times out / fails
 *   - read FOUND as anything but malware             -> "FOUND is malware" fails
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CHAT_ASSET_SCANNER = 'clamd-instream-v1';
const { scanFile, clamdInstream, interpretClamdReply } = await import('../src/server/services/library/assetIngestionService.js');

const dir = mkdtempSync(join(tmpdir(), 'clamd-test-'));
const fixture = join(dir, 'upload.bin');
const bytes = Buffer.alloc(200_000);
for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 31) % 251;
writeFileSync(fixture, bytes);
test.after(() => rmSync(dir, { recursive: true, force: true }));

/** A fake clamd: parses `zINSTREAM\0` + length-prefixed chunks + zero terminator, then answers. */
const fakeClamd = (answer) => new Promise((resolve) => {
  const received = [];
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    let commandRead = false;
    socket.on('data', (data) => {
      buf = Buffer.concat([buf, data]);
      if (!commandRead) {
        const nul = buf.indexOf(0);
        if (nul < 0) return;
        assert.equal(buf.subarray(0, nul).toString(), 'zINSTREAM');
        buf = buf.subarray(nul + 1);
        commandRead = true;
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) { socket.end(`${answer(Buffer.concat(received))}\0`); return; }
        if (buf.length < 4 + len) return;
        received.push(buf.subarray(4, 4 + len));
        buf = buf.subarray(4 + len);
      }
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, received }));
});

test('the file reaches clamd byte for byte, framed as INSTREAM, and OK is clean', async () => {
  const { server, port } = await fakeClamd((got) => (got.equals(bytes) ? 'stream: OK' : `stream: MISMATCH ${got.length} ERROR`));
  try {
    const reply = await clamdInstream(fixture, { host: '127.0.0.1', port, timeoutMs: 5000 });
    assert.equal(reply, 'stream: OK');
    assert.doesNotThrow(() => interpretClamdReply(reply));
  } finally { server.close(); }
});

test('FOUND is malware', async () => {
  const { server, port } = await fakeClamd(() => 'stream: Win.Test.EICAR_HDB-1 FOUND');
  try {
    await assert.rejects(
      scanFile(fixture, { instream: (p) => clamdInstream(p, { host: '127.0.0.1', port, timeoutMs: 5000 }) }),
      (error) => error.code === 'malware_detected',
    );
  } finally { server.close(); }
});

test('an ERROR reply (e.g. size limit) is a failure, never a pass', () => {
  assert.throws(() => interpretClamdReply('INSTREAM size limit exceeded. ERROR'), (e) => e.code === 'scanner_failed');
  assert.throws(() => interpretClamdReply(''), (e) => e.code === 'scanner_failed', 'an empty reply is not clean');
});

test('🔴 an unreachable daemon falls back to the CLI — it is never a pass', async () => {
  let cli = 0;
  await scanFile(fixture, {
    instream: () => Promise.reject(Object.assign(new Error('down'), { code: 'clamd_unreachable' })),
    execFileFn: async () => { cli += 1; },
  });
  assert.equal(cli, 1, 'the file was scanned by the CLI instead');
  await assert.rejects(
    scanFile(fixture, {
      instream: () => Promise.reject(Object.assign(new Error('down'), { code: 'clamd_unreachable' })),
      execFileFn: async () => { throw Object.assign(new Error('infected'), { code: 1 }); },
    }),
    (error) => error.code === 'malware_detected',
    'the fallback keeps the CLI verdict',
  );
});

test('a real refused connection is reported as unreachable', async () => {
  const probe = net.createServer(); await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const { port } = probe.address(); await new Promise((r) => probe.close(r));
  await assert.rejects(clamdInstream(fixture, { host: '127.0.0.1', port, timeoutMs: 3000 }), (e) => e.code === 'clamd_unreachable');
});
