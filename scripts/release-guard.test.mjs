#!/usr/bin/env node
/*
 * release-guard.test.mjs — tests for the publisher safety gates.
 * Run: node --test scripts/release-guard.test.mjs
 *
 * EVERY test here reproduces a defect that actually shipped, and every one of them
 * FAILS against the pre-2026-07-26 publisher (which had no gate at all) and passes
 * against this one. That is the standard: a gate without a test proving it catches
 * the real bug is not a gate — the lesson from check-packed-manifest.sh, whose path
 * bug made it report the first package's verdict for every package.
 *
 * Hermetic: no network, no R2, no rclone. Fixtures are built in a temp dir. Every
 * "secret" is an obvious fake of the right SHAPE, assembled at runtime so the literal
 * never appears contiguously in this source file.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

import { loadPatterns, scanArtifact, scanBuffer, isOpaqueArtifact } from './lib/secret-scan.mjs';
import {
  verifyFeedAgainstArtifacts,
  describeArtifact,
  parseUpdaterFeed,
  rewriteFeedRefs,
} from './lib/feed-integrity.mjs';
import { verifyPublishedChain, resolveRef } from './lib/live-verify.mjs';
import { R2Publisher, GateError } from './lib/r2-upload.mjs';

const PATTERNS = loadPatterns();

// ── obvious fakes, assembled at runtime ──────────────────────────────────────
const FAKE_XENO_KEY = ['xeno-', 'deadbeef'.repeat(6)].join('');       // xeno- + 48 hex
const FAKE_ANTHROPIC = ['sk-', 'ant-', 'A'.repeat(40)].join('');
const FAKE_AWS = ['AKIA', 'Z'.repeat(16)].join('');
const FAKE_RESEND = ['re_', 'Ab1_', 'Cd2E'.repeat(8)].join('');

function tmp(prefix = 'guard-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  return d;
}

// ── minimal ZIP writer (mirrors the reader: stored + deflate) ────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** @param {{name:string, data:Buffer|string, store?:boolean}[]} entries */
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const method = e.store ? 0 : 8;
    const body = method === 0 ? raw : deflateRawSync(raw);
    const name = Buffer.from(e.name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc32(raw), 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc32(raw), 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

/** Minimal Electron .asar writer (pickle header + JSON index + concatenated bodies). */
function makeAsar(files) {
  const index = { files: {} };
  const bodies = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const buf = Buffer.from(content, 'utf8');
    index.files[name] = { size: buf.length, offset: String(offset) };
    bodies.push(buf);
    offset += buf.length;
  }
  const json = Buffer.from(JSON.stringify(index), 'utf8');
  const pad = (4 - (json.length % 4)) % 4;
  const headerPayload = 4 + json.length + pad;   // [strLen][string][padding]
  const headerPickle = 4 + headerPayload;        // + its own size field
  const head = Buffer.alloc(16 + json.length + pad);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(headerPickle, 4);
  head.writeUInt32LE(headerPayload, 8);
  head.writeUInt32LE(json.length, 12);
  json.copy(head, 16);
  return Buffer.concat([head, ...bodies]);
}

function makeTgz(files) {
  const blocks = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, 'utf8');
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124);
    header.write('00000000000\0', 136);
    header.write('        ', 148);           // checksum placeholder
    header.write('0', 156);
    header.write('ustar\x0000', 257);
    let sum = 0;
    for (const b of header) sum += b;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const sha512b64 = (buf) => createHash('sha512').update(buf).digest('base64');

// ═══════════════════════════════════════════════════════════════════════════
// GATE 1 — SECRETS IN ARTIFACT BYTES
//
// THE INCIDENT: three extension ZIPs on updates.xenostudio.ai carried a live
// `xeno-` platform API key in bundled JS. Built 2026-03-13, key removed from
// SOURCE 2026-07-10, artifacts uploaded 2026-07-14 anyway, still serving 200 on
// 2026-07-26. The repo's own check-no-secrets.mjs was green throughout, because
// it scanned the REPO and the publish path never touches CI.
// ═══════════════════════════════════════════════════════════════════════════

test('THE INCIDENT: a xeno- platform key in bundled JS inside a ZIP is detected', async () => {
  const dir = tmp('ext-leak-');
  const zip = makeZip([
    { name: 'manifest.json', data: JSON.stringify({ name: 'XENO', version: '1.0.0' }) },
    // Exactly the shape that shipped: a minified bundle with the key inlined.
    { name: 'background/service-worker.js', data: `const A="${FAKE_XENO_KEY}";fetch("https://api.xenostudio.ai/v1/models",{headers:{Authorization:"Bearer "+A}});` },
    { name: 'content.js', data: 'console.log("clean");' },
  ]);
  writeFileSync(join(dir, 'xeno-extension-1.0.0.zip'), zip);

  const result = await scanArtifact(join(dir, 'xeno-extension-1.0.0.zip'), { patterns: PATTERNS });
  assert.equal(result.coverage, 'structural', 'the ZIP must be opened, not treated as opaque bytes');
  assert.ok(result.entriesScanned >= 3);
  const hit = result.findings.find((f) => f.patternId === 'xeno-platform-key');
  assert.ok(hit, 'the platform key must be found');
  assert.match(hit.entry, /service-worker\.js$/, 'the finding must name the entry INSIDE the zip');
  rmSync(dir, { recursive: true, force: true });
});

test('a finding is REDACTED — the secret is never returned', async () => {
  const findings = scanBuffer(Buffer.from(`KEY="${FAKE_XENO_KEY}"`), PATTERNS);
  assert.equal(findings.length >= 1, true);
  for (const f of findings) {
    assert.equal(JSON.stringify(f).includes(FAKE_XENO_KEY), false, 'the raw secret leaked into a finding');
    assert.match(f.preview, /^.{4}…$/);
    assert.match(f.fingerprint, /^[a-f0-9]{8}$/);
  }
});

test('the reserved ACP redaction sentinel is not treated as an OpenAI credential', () => {
  const findings = scanBuffer(
    Buffer.from('sk-XENOLOCALFAKEKEY0000000000000000'),
    PATTERNS,
  );
  assert.equal(findings.some((finding) => finding.patternId === 'openai-key'), false);
});

test('a Resend-shaped token is detected while an exact audited binary-symbol fingerprint is ignored', () => {
  assert.ok(
    scanBuffer(Buffer.from(`token=${FAKE_RESEND}`), PATTERNS)
      .some((finding) => finding.patternId === 'resend-key'),
    'the audited exemption must not weaken ordinary Resend-key detection',
  );

  const nativeSymbol = ['re_', 'electron_native_symbol_1_with_underscores_and_tail'].join('');
  const ignoredHash = createHash('sha256').update(nativeSymbol).digest('hex');
  const patterns = [{
    id: 'resend-key',
    name: 'Resend API key',
    rx: /\bre_[A-Za-z0-9_\-]{24,}\b/g,
    ignoreSha256: [ignoredHash],
  }];
  assert.deepEqual(scanBuffer(Buffer.from(nativeSymbol), patterns), []);
  assert.equal(
    scanBuffer(Buffer.from(`${nativeSymbol}x`), patterns).length,
    1,
    'the exemption is exact, not a prefix or pattern bypass',
  );
});

test('a clean ZIP passes the scan', async () => {
  const dir = tmp('clean-');
  writeFileSync(join(dir, 'clean.zip'), makeZip([
    { name: 'manifest.json', data: '{"name":"ok"}' },
    { name: 'lib/app.js', data: 'export const token = process.env.XENO_API_KEY;' },
  ]));
  const result = await scanArtifact(join(dir, 'clean.zip'), { patterns: PATTERNS });
  assert.deepEqual(result.findings, []);
  assert.equal(result.coverage, 'structural');
  rmSync(dir, { recursive: true, force: true });
});

test('a key hidden inside app.asar inside a ZIP is found (nested containers)', async () => {
  const dir = tmp('nested-');
  const asar = makeAsar({
    'index.js': 'require("./config");',
    'config.js': `module.exports={key:"${FAKE_ANTHROPIC}"};`,
  });
  writeFileSync(join(dir, 'bundle.zip'), makeZip([{ name: 'resources/app.asar', data: asar, store: true }]));
  const result = await scanArtifact(join(dir, 'bundle.zip'), { patterns: PATTERNS });
  const hits = result.findings.filter((f) => f.patternId === 'anthropic-key');
  assert.ok(hits.length, 'must recurse zip → asar');
  // The asar index is scanned as bytes too, so the same secret surfaces at the asar
  // level as well. What matters is that the recursion pinpoints the exact FILE — that
  // is what makes the failure output actionable ("which source file do I fix?").
  assert.ok(
    hits.some((h) => /app\.asar!config\.js$/.test(h.entry)),
    `expected a finding naming the nested file, got: ${hits.map((h) => h.entry).join(', ')}`,
  );
  rmSync(dir, { recursive: true, force: true });
});

test('a key inside a .tgz (npm pack) is found', async () => {
  const dir = tmp('tgz-');
  writeFileSync(join(dir, 'pkg.tgz'), makeTgz({
    'package/package.json': '{"name":"x"}',
    'package/dist/index.js': `const k="${FAKE_AWS}";`,
  }));
  const result = await scanArtifact(join(dir, 'pkg.tgz'), { patterns: PATTERNS });
  assert.ok(result.findings.some((f) => f.patternId === 'aws-access-key-id'));
  rmSync(dir, { recursive: true, force: true });
});

test('a UTF-16 encoded key is found (Windows resources / .rc strings)', () => {
  const findings = scanBuffer(Buffer.from(`token=${FAKE_XENO_KEY}`, 'utf16le'), PATTERNS);
  assert.ok(findings.some((f) => f.patternId === 'xeno-platform-key'));
});

// ═══════════════════════════════════════════════════════════════════════════
// GATE 1/2 — THE UPLOADER REFUSES. This is the structural claim: the scan lives
// INSIDE the uploader, so no caller can publish past a finding.
// ═══════════════════════════════════════════════════════════════════════════

test('R2Publisher.putArtifact REFUSES a poisoned artifact and uploads nothing', async () => {
  const dir = tmp('refuse-');
  const file = join(dir, 'xeno-extension-1.0.0.zip');
  writeFileSync(file, makeZip([{ name: 'bg.js', data: `var k="${FAKE_XENO_KEY}";` }]));

  // dryRun:true means rclone is never invoked even on the happy path, so this test
  // isolates the REFUSAL: the gate throws before any upload is recorded.
  const r2 = new R2Publisher({ remote: 'r2:test-bucket', dryRun: true });
  await assert.rejects(
    () => r2.putArtifact(file, 'apps/extension/v1.0.0/xeno-extension-1.0.0.zip'),
    (e) => e instanceof GateError && /secret-shaped/.test(e.message),
  );
  assert.deepEqual(r2.uploads, [], 'nothing may be recorded as uploaded after a refusal');
  rmSync(dir, { recursive: true, force: true });
});

test('R2Publisher.putDirectory REFUSES if ANY file in the mirror is poisoned', async () => {
  // This is the exact call shape of publish-extension-releases.mjs:
  // `rclone copy <downloaded release dir> r2:…/apps/extension/<tag>/`.
  const dir = tmp('mirror-');
  writeFileSync(join(dir, 'clean-1.0.0.zip'), makeZip([{ name: 'a.js', data: 'ok' }]));
  writeFileSync(join(dir, 'poisoned-1.0.0.zip'), makeZip([{ name: 'bg.js', data: `k="${FAKE_XENO_KEY}"` }]));

  const r2 = new R2Publisher({ remote: 'r2:test-bucket', dryRun: true });
  await assert.rejects(() => r2.putDirectory(dir, 'apps/extension/v1.0.0/'), GateError);
  assert.deepEqual(r2.uploads, []);
  rmSync(dir, { recursive: true, force: true });
});

test('a clean directory mirror is allowed through', async () => {
  const dir = tmp('mirror-ok-');
  writeFileSync(join(dir, 'a-1.0.0.zip'), makeZip([{ name: 'a.js', data: 'ok' }]));
  writeFileSync(join(dir, 'manifest.json'), '{"ok":true}');
  const r2 = new R2Publisher({ remote: 'r2:test-bucket', dryRun: true });
  const files = await r2.putDirectory(dir, 'apps/extension/v1.0.0/');
  assert.equal(files.length, 2);
  assert.equal(r2.uploads.length, 2);
  rmSync(dir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// GATE 2 — COVERAGE. An opaque installer's payload is LZMA/squashfs; a raw byte
// scan does not see it. Fail closed rather than report a false "clean".
// ═══════════════════════════════════════════════════════════════════════════

test('isOpaqueArtifact classifies installer formats whose payload cannot be opened', () => {
  assert.equal(isOpaqueArtifact('XENO Shell Setup 0.1.0-beta.1.exe'), true);
  assert.equal(isOpaqueArtifact('XENO-Pixel-0.6.4.dmg'), true);
  assert.equal(isOpaqueArtifact('XENO-Motion-0.3.4.AppImage'), true);
  assert.equal(isOpaqueArtifact('app.js'), false);
  assert.equal(isOpaqueArtifact('latest.yml'), false);
});

test('an opaque installer with NO unpacked sidecar is refused (coverage gate)', async () => {
  const dir = tmp('opaque-');
  const exe = join(dir, 'XENO Pixel Setup 0.6.4.exe');
  writeFileSync(exe, Buffer.from('MZ\x90\x00 opaque NSIS payload'));

  const result = await scanArtifact(exe, { patterns: PATTERNS });
  assert.equal(result.coverage, 'raw', 'an .exe with no sidecar is raw-only coverage');

  const r2 = new R2Publisher({ remote: 'r2:test-bucket', dryRun: true });
  await assert.rejects(
    () => r2.putArtifact(exe, 'apps/pixel/v0.6.4/XENO Pixel Setup 0.6.4.exe'),
    (e) => e instanceof GateError && /could not be scanned structurally/.test(e.message),
  );
  rmSync(dir, { recursive: true, force: true });
});

test('the adjacent win-unpacked/ tree restores coverage AND is itself scanned', async () => {
  const dir = tmp('sidecar-');
  const exe = join(dir, 'XENO Pixel Setup 0.6.4.exe');
  writeFileSync(exe, Buffer.from('MZ\x90\x00 opaque NSIS payload'));
  mkdirSync(join(dir, 'win-unpacked', 'resources'), { recursive: true });
  writeFileSync(join(dir, 'win-unpacked', 'resources', 'app.asar'),
    makeAsar({ 'main.js': `const k="${FAKE_XENO_KEY}";` }));

  const result = await scanArtifact(exe, { patterns: PATTERNS });
  assert.equal(result.sidecars.length, 1, 'win-unpacked/ must be discovered');
  assert.ok(
    result.findings.some((f) => f.patternId === 'xeno-platform-key' && /app\.asar/.test(f.entry)),
    'a key inside resources/app.asar must be found via the sidecar',
  );
  rmSync(dir, { recursive: true, force: true });
});

test('--allow-unscannable-payload is the ONLY way past the coverage gate', async () => {
  const dir = tmp('ack-');
  const exe = join(dir, 'XENO Sound Setup 0.2.0.exe');
  writeFileSync(exe, Buffer.from('MZ opaque'));
  const r2 = new R2Publisher({ remote: 'r2:test-bucket', dryRun: true, allowUnscannablePayload: true });
  await r2.putArtifact(exe, 'apps/sound/v0.2.0/XENO Sound Setup 0.2.0.exe');
  assert.equal(r2.uploads.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// GATE 3 — FEED INTEGRITY.
//
// THE DEFECTS: motion + workflow shipped a latest.yml naming a HYPHENATED file
// while the artifact used SPACES (auto-update 404). Their sha512 MATCHED, which
// is what made a filename fix correct rather than a rebuild. If the checksum had
// differed, a rebuild was required. The gate must tell those two apart.
// ═══════════════════════════════════════════════════════════════════════════

function feedFor({ name, sha512, size, version, prefix = true }) {
  const ref = prefix ? `v${version}/${name}` : name;
  return [
    `version: ${version}`,
    'files:',
    `  - url: ${ref}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${ref}`,
    `sha512: ${sha512}`,
    "releaseDate: '2026-07-21T22:41:20.244Z'",
    '',
  ].join('\n');
}

function artifactFixture(dir, name, body = 'INSTALLER BYTES') {
  const p = join(dir, name);
  writeFileSync(p, body);
  return describeArtifact(p);
}

test('MOTION/WORKFLOW: hyphenated feed name + spaced artifact = FEED_FILENAME_MISMATCH (rewrite, no rebuild)', () => {
  const dir = tmp('feedname-');
  const real = artifactFixture(dir, 'XENO Motion Setup 0.3.4.exe');
  // The feed as it actually was on R2: hyphens where the artifact has spaces.
  const feedText = feedFor({
    name: 'XENO-Motion-Setup-0.3.4.exe', sha512: real.sha512, size: real.size, version: '0.3.4',
  });

  const check = verifyFeedAgainstArtifacts({
    feedText, version: '0.3.4', layout: 'slug-root', artifacts: [real],
  });
  assert.equal(check.ok, false, 'today\'s publisher uploads this happily — it must be refused');
  const p = check.problems.find((x) => x.code === 'FEED_FILENAME_MISMATCH');
  assert.ok(p, `expected FEED_FILENAME_MISMATCH, got ${check.problems.map((x) => x.code).join(',')}`);
  // The actionable distinction an agent must be able to make without a human:
  assert.match(p.message, /BYTES are correct/);
  assert.match(p.fix, /REWRITE/);
  assert.doesNotMatch(p.fix, /REBUILD/);
  assert.match(p.fix, /v0\.3\.4\/XENO Motion Setup 0\.3\.4\.exe/, 'the fix must name the correct ref verbatim');
  rmSync(dir, { recursive: true, force: true });
});

test('wrong BYTES = FEED_CHECKSUM_MISMATCH and demands a REBUILD, not a rewrite', () => {
  const dir = tmp('feedsum-');
  const real = artifactFixture(dir, 'XENO Motion Setup 0.3.4.exe', 'THE BYTES WE ARE UPLOADING');
  const feedText = feedFor({
    name: 'XENO Motion Setup 0.3.4.exe',
    sha512: sha512b64(Buffer.from('A COMPLETELY DIFFERENT BUILD')),
    size: real.size,
    version: '0.3.4',
  });

  const check = verifyFeedAgainstArtifacts({
    feedText, version: '0.3.4', layout: 'slug-root', artifacts: [real],
  });
  assert.equal(check.ok, false);
  const p = check.problems.find((x) => x.code === 'FEED_CHECKSUM_MISMATCH');
  assert.ok(p);
  assert.match(p.fix, /REBUILD/);
  assert.match(p.fix, /Never hand-edit a checksum/);
  rmSync(dir, { recursive: true, force: true });
});

test('size drift is caught even when the name matches', () => {
  const dir = tmp('feedsize-');
  const real = artifactFixture(dir, 'App Setup 1.0.0.exe');
  const feedText = feedFor({ name: 'App Setup 1.0.0.exe', sha512: real.sha512, size: real.size + 4096, version: '1.0.0' });
  const check = verifyFeedAgainstArtifacts({ feedText, version: '1.0.0', layout: 'slug-root', artifacts: [real] });
  assert.ok(check.problems.some((p) => p.code === 'FEED_SIZE_MISMATCH'));
  rmSync(dir, { recursive: true, force: true });
});

test('a bare filename at the slug root = FEED_REF_MISSING_VERSION_PREFIX (the browser defect)', () => {
  const dir = tmp('feedbare-');
  const real = artifactFixture(dir, 'XENO Browser Setup 0.2.0.exe');
  const feedText = feedFor({ name: real.name, sha512: real.sha512, size: real.size, version: '0.2.0', prefix: false });
  const check = verifyFeedAgainstArtifacts({ feedText, version: '0.2.0', layout: 'slug-root', artifacts: [real] });
  const p = check.problems.find((x) => x.code === 'FEED_REF_MISSING_VERSION_PREFIX');
  assert.ok(p);
  assert.match(p.fix, /v0\.2\.0\//);
  rmSync(dir, { recursive: true, force: true });
});

test('SHELL: a PREFIXED ref inside v<version>/ = FEED_REF_UNEXPECTED_PREFIX (double-prefix 404)', () => {
  const dir = tmp('feedshell-');
  const real = artifactFixture(dir, 'XENO Shell Setup 0.1.0-beta.1.exe');
  // The wrong thing: the slug-root copy uploaded into the version dir unchanged.
  const feedText = feedFor({
    name: real.name, sha512: real.sha512, size: real.size, version: '0.1.0-beta.1', prefix: true,
  });
  const check = verifyFeedAgainstArtifacts({
    feedText, version: '0.1.0-beta.1', layout: 'version-dir', artifacts: [real],
  });
  const p = check.problems.find((x) => x.code === 'FEED_REF_UNEXPECTED_PREFIX');
  assert.ok(p, `expected FEED_REF_UNEXPECTED_PREFIX, got ${check.problems.map((x) => x.code).join(',')}`);
  assert.match(p.message, /double prefix/);
  assert.match(p.fix, /bare filename/);
  rmSync(dir, { recursive: true, force: true });
});

test('SHELL: BOTH layouts verify clean when each is rewritten for its own target', () => {
  const dir = tmp('feedshellok-');
  const real = artifactFixture(dir, 'XENO Shell Setup 0.1.0-beta.1.exe');
  const raw = feedFor({ name: real.name, sha512: real.sha512, size: real.size, version: '0.1.0-beta.1', prefix: false });

  for (const layout of ['slug-root', 'version-dir']) {
    const text = rewriteFeedRefs(raw, '0.1.0-beta.1', layout);
    const check = verifyFeedAgainstArtifacts({ feedText: text, version: '0.1.0-beta.1', layout, artifacts: [real] });
    assert.equal(check.ok, true, `${layout} should verify clean: ${JSON.stringify(check.problems)}`);
  }
  rmSync(dir, { recursive: true, force: true });
});

test('a feed built for a different version is caught', () => {
  const dir = tmp('feedver-');
  const real = artifactFixture(dir, 'App Setup 1.0.0.exe');
  const feedText = feedFor({ name: real.name, sha512: real.sha512, size: real.size, version: '0.9.9' })
    .replace('v0.9.9/', 'v1.0.0/');
  const check = verifyFeedAgainstArtifacts({ feedText, version: '1.0.0', layout: 'slug-root', artifacts: [real] });
  assert.ok(check.problems.some((p) => p.code === 'FEED_VERSION_MISMATCH'));
  rmSync(dir, { recursive: true, force: true });
});

test('a feed referencing an artifact that is not in this publish at all', () => {
  const dir = tmp('feedghost-');
  const real = artifactFixture(dir, 'App Setup 1.0.0.exe');
  const feedText = feedFor({
    name: 'Something Else 1.0.0.exe', sha512: sha512b64(Buffer.from('other')), size: 1, version: '1.0.0',
  });
  const check = verifyFeedAgainstArtifacts({ feedText, version: '1.0.0', layout: 'slug-root', artifacts: [real] });
  const p = check.problems.find((x) => x.code === 'FEED_REF_UNRESOLVABLE');
  assert.ok(p);
  assert.match(p.fix, /REBUILD/);
  rmSync(dir, { recursive: true, force: true });
});

test('the blockmap sidecar is verified alongside the installer', () => {
  const dir = tmp('feedblock-');
  const exe = artifactFixture(dir, 'App Setup 1.0.0.exe', 'exe bytes');
  const bm = artifactFixture(dir, 'App Setup 1.0.0.exe.blockmap', 'blockmap bytes');
  const feedText = [
    'version: 1.0.0',
    'files:',
    `  - url: v1.0.0/${exe.name}`,
    `    sha512: ${exe.sha512}`,
    `    size: ${exe.size}`,
    `  - url: v1.0.0/${bm.name}`,
    `    sha512: ${sha512b64(Buffer.from('STALE BLOCKMAP'))}`,
    `    size: ${bm.size}`,
    `path: v1.0.0/${exe.name}`,
    `sha512: ${exe.sha512}`,
    '',
  ].join('\n');
  const check = verifyFeedAgainstArtifacts({ feedText, version: '1.0.0', layout: 'slug-root', artifacts: [exe, bm] });
  assert.ok(check.problems.some((p) => p.code === 'FEED_CHECKSUM_MISMATCH' && /blockmap/.test(p.ref)));
  rmSync(dir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// GATE 5 — LIVE VERIFICATION. Static checks reason about local files; only this
// proves the objects landed under the keys the feed names.
// ═══════════════════════════════════════════════════════════════════════════

const FEED_URL = 'https://updates.xenostudio.ai/apps/motion/latest.yml';

function fakeHttp(routes) {
  return async (url, init = {}) => {
    const key = String(url);
    const route = routes[key];
    if (!route) return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
    if (init.headers?.Range) {
      if (route.size == null) return { ok: false, status: 404, headers: new Headers(), text: async () => '' };
      return {
        ok: true, status: 206,
        headers: new Headers({ 'content-range': `bytes 0-0/${route.size}` }),
        text: async () => '',
      };
    }
    return { ok: true, status: 200, headers: new Headers(), text: async () => route.body ?? '' };
  };
}

test('LIVE: a resolvable chain passes (feed 200 → installer 206 with matching size)', async () => {
  const body = feedFor({ name: 'XENO Motion Setup 0.3.4.exe', sha512: 'x==', size: 88828981, version: '0.3.4' });
  const result = await verifyPublishedChain({
    feedUrl: FEED_URL,
    expectedVersion: '0.3.4',
    expectedFiles: [{ name: 'XENO Motion Setup 0.3.4.exe', size: 88828981 }],
    expectedBody: body,
    parseFeed: parseUpdaterFeed,
    fetchImpl: fakeHttp({
      [FEED_URL]: { body },
      'https://updates.xenostudio.ai/apps/motion/v0.3.4/XENO%20Motion%20Setup%200.3.4.exe': { size: 88828981 },
    }),
  });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.ok(result.steps.some((s) => s.startsWith('installer 206')));
});

test('LIVE: the feed 200s but the installer 404s → LIVE_INSTALLER_404, "THE RELEASE IS BROKEN"', async () => {
  // This is the motion/workflow production state: feed healthy, download dead.
  const body = feedFor({ name: 'XENO-Motion-Setup-0.3.4.exe', sha512: 'x==', size: 88828981, version: '0.3.4' });
  const result = await verifyPublishedChain({
    feedUrl: FEED_URL,
    expectedVersion: '0.3.4',
    expectedFiles: [{ name: 'XENO Motion Setup 0.3.4.exe', size: 88828981 }],
    parseFeed: parseUpdaterFeed,
    fetchImpl: fakeHttp({
      [FEED_URL]: { body },
      // only the SPACED key exists on R2; the hyphenated ref resolves nowhere
      'https://updates.xenostudio.ai/apps/motion/v0.3.4/XENO%20Motion%20Setup%200.3.4.exe': { size: 88828981 },
    }),
  });
  assert.equal(result.ok, false);
  const p = result.problems.find((x) => x.code === 'LIVE_INSTALLER_404');
  assert.ok(p, `expected LIVE_INSTALLER_404, got ${result.problems.map((x) => x.code).join(',')}`);
  assert.match(p.fix, /THE RELEASE IS BROKEN/);
});

test('LIVE: bytes on R2 differ in size from what we uploaded → LIVE_SIZE_MISMATCH', async () => {
  const body = feedFor({ name: 'App Setup 1.0.0.exe', sha512: 'x==', size: 1000, version: '1.0.0' });
  const url = 'https://updates.xenostudio.ai/apps/x/latest.yml';
  const result = await verifyPublishedChain({
    feedUrl: url,
    expectedVersion: '1.0.0',
    expectedFiles: [{ name: 'App Setup 1.0.0.exe', size: 1000 }],
    parseFeed: parseUpdaterFeed,
    fetchImpl: fakeHttp({
      [url]: { body },
      'https://updates.xenostudio.ai/apps/x/v1.0.0/App%20Setup%201.0.0.exe': { size: 999999 },
    }),
  });
  assert.ok(result.problems.some((p) => p.code === 'LIVE_SIZE_MISMATCH'));
});

test('LIVE: an unreachable feed is a hard failure, not a warning', async () => {
  const url = 'https://updates.xenostudio.ai/apps/ghost/beta.yml';
  const result = await verifyPublishedChain({
    feedUrl: url, expectedVersion: '1.0.0', parseFeed: parseUpdaterFeed, fetchImpl: fakeHttp({}),
  });
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].code, 'LIVE_FEED_UNREACHABLE');
});

test('LIVE: a stale feed advertising an older version is caught', async () => {
  const url = 'https://updates.xenostudio.ai/apps/x/latest.yml';
  const body = feedFor({ name: 'App Setup 0.9.0.exe', sha512: 'x==', size: 10, version: '0.9.0' });
  const result = await verifyPublishedChain({
    feedUrl: url,
    expectedVersion: '1.0.0',
    parseFeed: parseUpdaterFeed,
    fetchImpl: fakeHttp({
      [url]: { body },
      'https://updates.xenostudio.ai/apps/x/v0.9.0/App%20Setup%200.9.0.exe': { size: 10 },
    }),
  });
  assert.ok(result.problems.some((p) => p.code === 'LIVE_FEED_VERSION_MISMATCH'));
});

test('resolveRef URL-encodes exactly as electron-updater does (spaces → %20)', () => {
  assert.equal(
    resolveRef('https://updates.xenostudio.ai/apps/shell/v0.1.0-beta.1/', 'XENO Shell Setup 0.1.0-beta.1.exe'),
    'https://updates.xenostudio.ai/apps/shell/v0.1.0-beta.1/XENO%20Shell%20Setup%200.1.0-beta.1.exe',
  );
  assert.equal(
    resolveRef('https://updates.xenostudio.ai/apps/pixel/', 'v0.6.4/XENO Pixel Setup 0.6.4.exe'),
    'https://updates.xenostudio.ai/apps/pixel/v0.6.4/XENO%20Pixel%20Setup%200.6.4.exe',
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Pattern-set hygiene
// ═══════════════════════════════════════════════════════════════════════════

test('the shared pattern set loads and covers the xeno platform key', () => {
  const ids = PATTERNS.map((p) => p.id);
  assert.ok(ids.includes('xeno-platform-key'));
  assert.ok(ids.includes('anthropic-key'));
  assert.ok(ids.includes('private-key-block'));
});

test('an env overlay can ADD a pattern', () => {
  const dir = tmp('patterns-');
  const overlay = join(dir, 'extra.json');
  writeFileSync(overlay, JSON.stringify({ patterns: [{ id: 'acme', name: 'ACME', re: 'ACME-[0-9]{10}' }] }));
  const merged = loadPatterns(overlay);
  const ids = merged.map((p) => p.id);
  assert.ok(ids.includes('acme'), 'overlay pattern must be added');
  assert.ok(ids.includes('xeno-platform-key'), 'a built-in pattern must survive the overlay');
  assert.equal(merged.length, PATTERNS.length + 1);
  rmSync(dir, { recursive: true, force: true });
});

test('an env overlay CANNOT weaken a built-in by re-using its id', () => {
  // Without this, $XENO_SECRET_PATTERNS is a way to switch off the rule that catches
  // the platform key — a gate you can disable from the environment is not a gate.
  const dir = tmp('patterns-evil-');
  const overlay = join(dir, 'evil.json');
  writeFileSync(overlay, JSON.stringify({
    patterns: [{ id: 'xeno-platform-key', name: 'neutered', re: 'THIS_WILL_NEVER_MATCH_ANYTHING' }],
  }));
  const merged = loadPatterns(overlay);
  const rule = merged.find((p) => p.id === 'xeno-platform-key');
  assert.equal(rule.re, 'xeno-[a-f0-9]{40,}', 'the built-in regex must be untouched');
  // and it must still catch the real thing
  assert.ok(scanBuffer(Buffer.from(`k="${FAKE_XENO_KEY}"`), merged).some((f) => f.patternId === 'xeno-platform-key'));
  rmSync(dir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// seed-releases.mjs — the destructive bootstrap.
//
// THE INCIDENT (2026-07-26, caused while building these gates): a bare
// `import('./scripts/seed-releases.mjs')` — no args, no intent to publish — ran
// main() on the DEFAULT slug list and REPLACED the releases.json histories of hub,
// pixel, motion and sound with one synthesised entry each. R2 has no object
// versioning, so it was irreversible. Two properties are now pinned.
// ═══════════════════════════════════════════════════════════════════════════

test('seed-releases REFUSES to flatten a slug that already has a history', async () => {
  const { main } = await import('./seed-releases.mjs');
  const fetchJson = async (url) => {
    if (url.endsWith('version.json')) return { version: '0.5.16', date: '2026-07-20', windows: 'x.exe' };
    // 25 entries — the real shape of apps/agent-cli/releases.json
    return Array.from({ length: 25 }, (_, i) => ({ version: `0.4.${i}`, notes: 'n' }));
  };
  const uploads = [];
  const makePublisher = () => ({ uploads, putPointer: async (_c, key) => uploads.push({ key }) });

  const result = await main(['agent-cli', '--confirm'], { fetchJson, makePublisher });
  assert.equal(result.seeded, 0, 'must not seed over an existing history');
  assert.equal(result.refused[0].existingCount, 25);
  assert.deepEqual(result.wrote, [], 'NOTHING may be written');
});

test('seed-releases still bootstraps a slug with NO history (its actual purpose)', async () => {
  const { main } = await import('./seed-releases.mjs');
  const fetchJson = async (url) => {
    if (url.endsWith('version.json')) return { version: '0.1.0', date: '2026-07-26', windows: 'New Setup 0.1.0.exe' };
    throw new Error('HTTP 404'); // no releases.json yet
  };
  const uploads = [];
  const makePublisher = () => ({ uploads, putPointer: async (_c, key) => uploads.push({ key }) });

  const result = await main(['newproduct', '--confirm'], { fetchJson, makePublisher });
  assert.equal(result.seeded, 1);
  assert.deepEqual(result.wrote, ['apps/newproduct/releases.json']);
});

test('seed-releases writes NOTHING without --confirm (plan by default)', async () => {
  const { main } = await import('./seed-releases.mjs');
  const fetchJson = async (url) => {
    if (url.endsWith('version.json')) return { version: '0.1.0', windows: 'a.exe' };
    throw new Error('HTTP 404');
  };
  const uploads = [];
  // dryRun must be true when --confirm is absent; assert on what the publisher is told.
  const makePublisher = ({ dryRun }) => {
    assert.equal(dryRun, true, 'no --confirm must mean dryRun');
    return { uploads, putPointer: async (_c, key) => uploads.push({ key }) };
  };
  await main(['newproduct'], { fetchJson, makePublisher });
});

test('ordinary release text does not trip the gate (no false-positive flood)', () => {
  const notes = [
    '- Fixed auth token refresh loop',
    '- New `--json` output for scripting',
    'Set XENO_API_KEY in your environment, e.g. export XENO_API_KEY=your-key-here',
    'sha512: 02puZ+5DbwEENyUWIXu1wJiA1NcafxOAco0RIrV8dXBh2H/lJIacZFasgAJA1f7FtrsLDASP1+cQq2cyda6UlA==',
    'https://updates.xenostudio.ai/apps/shell/v0.1.0-beta.1/XENO Shell Setup 0.1.0-beta.1.exe',
  ].join('\n');
  assert.deepEqual(scanBuffer(Buffer.from(notes), PATTERNS), []);
});
