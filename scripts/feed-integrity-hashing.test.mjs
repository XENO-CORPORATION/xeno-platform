#!/usr/bin/env node
/**
 * Artifact hashing must not be capped by Node's ~2 GiB Buffer limit.
 *
 * 🔴 `sha512Base64` / `sha256Hex` used `readFileSync`, so the GATED publisher physically could not
 * accept a model weight:
 *
 *   RangeError [ERR_FS_FILE_TOO_LARGE]: File size (2783446304) is greater than 2 GiB
 *
 * Qwen 3.8 4B is 2.78 GB and Ornith 1.5 35B A3B is 21.7 GB. That limit is why
 * `publish-local-model-catalog.mjs` shells `rclone copyto` directly and references
 * `r2-upload.mjs` ZERO times — so every model ever published to R2 went up UNGATED, past the
 * single choke point ABSOLUTE RULE §2b exists to enforce: no secret scan, no immutability check.
 *
 * The lesson is more general than the bug: **a gate that cannot accept the payload is not
 * bypassed occasionally, it is bypassed permanently**, and the bypass quietly becomes the normal
 * path. Same shape as the CLI release smoke that demanded a signature only release-mode
 * certification could produce, and failed every run until it read as noise.
 *
 * Run: node scripts/feed-integrity-hashing.test.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256Hex, sha512Base64 } from './lib/feed-integrity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
let checked = 0;
const check = (name, ok, detail) => {
  checked++;
  if (!ok) { failures++; console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

// 1. The digests must be byte-identical to the buffered implementation they replaced. A chunked
//    hash that is merely "close" is worthless: these values go into update feeds users verify.
const dir = mkdtempSync(join(tmpdir(), 'feed-hash-'));
try {
  // Deliberately NOT a round multiple of the 1 MiB chunk — an off-by-one in the final partial
  // read is exactly the bug chunking introduces, and a neat size would hide it.
  const sample = join(dir, 'sample.bin');
  const bytes = Buffer.alloc(1024 * 1024 * 2 + 12345);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
  writeFileSync(sample, bytes);

  check(
    'sha256 matches the buffered implementation',
    sha256Hex(sample) === createHash('sha256').update(readFileSync(sample)).digest('hex')
  );
  check(
    'sha512 matches the buffered implementation (base64, as electron-builder writes it)',
    sha512Base64(sample) === createHash('sha512').update(readFileSync(sample)).digest('base64')
  );

  // 2. An empty file must still hash, not throw — `readSync` returns 0 immediately.
  const empty = join(dir, 'empty.bin');
  writeFileSync(empty, Buffer.alloc(0));
  check(
    'an empty file hashes to the empty digest',
    sha256Hex(empty) === createHash('sha256').update(Buffer.alloc(0)).digest('hex')
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// 3. The hashers must not go back to reading the whole file. Verifying the >2 GiB behaviour
//    directly would mean writing a 2 GiB file on every run; asserting the mechanism is the
//    honest trade, and it is the mechanism that regresses.
const src = readFileSync(join(here, 'lib', 'feed-integrity.mjs'), 'utf8');
const hashers = src.slice(src.indexOf('function hashFileSync'), src.indexOf('export function verifyFeedAgainstArtifacts'));
check('hashing streams rather than buffering the file', /readSync\(/.test(hashers) && !/readFileSync\(/.test(hashers),
  /readFileSync\(/.test(hashers) ? 'readFileSync is back in the hashing path — the 2 GiB cap returns with it' : '');

if (!checked) { console.error('  FAIL  gate ran no checks'); process.exit(1); }
console.log(`\n${failures ? 'FAILED' : 'PASS'}  ${checked} check(s), ${failures} failed`);
process.exitCode = failures ? 1 : 0;
