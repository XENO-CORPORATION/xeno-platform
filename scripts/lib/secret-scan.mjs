/**
 * secret-scan.mjs — scan ARTIFACT BYTES for secrets before they reach R2.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-07-14 three publicly downloadable extension ZIPs were uploaded to
 * updates.xenostudio.ai carrying a LIVE XENO platform API key inside bundled JS.
 * The key had been removed from source on 2026-07-10 and the repo's own guardrail
 * (xeno-extension/scripts/check-no-secrets.mjs, wired into that repo's CI) was
 * working the whole time. It did not matter: the artifacts were built on
 * 2026-03-13, before the guardrail existed, and `publish-extension-releases.mjs`
 * uploads a directory of pre-built GitHub release assets straight to R2 — a path
 * that never touches CI.
 *
 * The lesson: **scanning the repo proves nothing about what ships.** This module
 * scans the bytes that are actually uploaded, and it can look INSIDE containers,
 * because "a key hardcoded in bundled JS inside a ZIP" is invisible to a scan of
 * the compressed bytes.
 *
 * DESIGN
 * ------
 * - Pattern set is SHARED and updatable: scripts/lib/secret-patterns.json, plus
 *   an optional merge-only overlay via $XENO_SECRET_PATTERNS.
 * - Containers are unpacked in-process with zero dependencies:
 *     .zip / .xpi / .crx-as-zip / .asar-in-zip  → central-directory reader + inflateRaw
 *     .tar / .tgz / .tar.gz / .npm-pack         → gunzip + 512-byte tar headers
 *     .asar (Electron archive)                  → pickle header + JSON index
 *     directories                               → recursive walk
 * - Everything else (NSIS .exe, .dmg, .AppImage) is LZMA/squashfs-compressed and
 *   cannot be opened without external tooling. Those get a streaming RAW byte scan
 *   and are reported with `coverage: 'raw'` — see COVERAGE below. We do not pretend
 *   a raw scan of a compressed installer is a payload scan.
 * - Findings are REDACTED: a match is reported as its first 4 chars plus a short
 *   SHA-256 fingerprint, never the secret. Two findings of the same secret share a
 *   fingerprint, so you can correlate occurrences without ever printing the value.
 *
 * COVERAGE (the honest part)
 * --------------------------
 *   'structural' — the container was opened and every entry scanned.
 *   'raw'        — opaque bytes only; a compressed payload could still hide a secret.
 *   'partial'    — opened, but at least one entry could not be scanned (too large,
 *                  unsupported compression, corrupt). Treated as NOT clean by the
 *                  caller's fail-closed policy.
 *
 * The caller (r2-upload.mjs) decides policy. This module only reports facts.
 */
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { inflateRawSync, gunzipSync } from 'node:zlib';
import { join, basename, extname, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Entries larger than this are not buffered into memory; they degrade coverage. */
const MAX_ENTRY_BYTES = 96 * 1024 * 1024;
/** Streaming raw-scan chunk + the carry-over that lets a match span two chunks. */
const RAW_CHUNK = 1024 * 1024;
const RAW_CARRY = 4096;

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Load the shared pattern set. An overlay file (via `extraPath` or
 * $XENO_SECRET_PATTERNS) is MERGED on top — it can add patterns but can never
 * remove or weaken a built-in one. A gate you can switch off from the
 * environment is not a gate.
 */
export function loadPatterns(extraPath = process.env.XENO_SECRET_PATTERNS) {
  const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
  const base = read(join(HERE, 'secret-patterns.json'));
  const sets = [base];
  if (extraPath && existsSync(extraPath)) sets.push(read(extraPath));

  const byId = new Map();
  for (const p of base.patterns ?? []) {
    if (!p?.id || !p?.re) continue;
    byId.set(p.id, {
      id: p.id,
      name: p.name ?? p.id,
      re: p.re,
      flags: p.flags ?? 'g',
      note: p.note,
      ignoreSha256: Array.isArray(p.ignoreSha256) ? p.ignoreSha256 : [],
      builtin: true,
    });
  }
  // The overlay is ADDITIVE ONLY. Re-using a built-in id would silently swap that
  // pattern's regex — a way to disable the xeno-platform-key rule from an environment
  // variable, which is precisely the kind of hole this module exists to close.
  for (const set of sets.slice(1)) {
    for (const p of set.patterns ?? []) {
      if (!p?.id || !p?.re) continue;
      if (byId.get(p.id)?.builtin) {
        console.warn(
          `secret-scan: overlay pattern "${p.id}" collides with a built-in and was IGNORED. ` +
          'An overlay may add patterns; it may not replace or weaken one. Use a different id.',
        );
        continue;
      }
      byId.set(p.id, {
        id: p.id,
        name: p.name ?? p.id,
        re: p.re,
        flags: p.flags ?? 'g',
        note: p.note,
        ignoreSha256: [],
      });
    }
  }
  // Compile once; `g` regexes are stateful, so each scan resets lastIndex.
  return [...byId.values()].map((p) => ({ ...p, rx: new RegExp(p.re, p.flags.includes('g') ? p.flags : `${p.flags}g`) }));
}

/** Redact a match: never return the secret itself. */
function redact(match) {
  const fp = createHash('sha256').update(match).digest('hex').slice(0, 8);
  return { preview: `${match.slice(0, 4)}…`, length: match.length, fingerprint: fp };
}

/**
 * Scan a string for every pattern. Returns redacted findings.
 * Both a latin1 and a utf16le decoding of a buffer are passed through here, so a
 * key stored as UTF-16 (common in Windows binaries and .rc resources) is caught.
 */
export function scanText(text, patterns, where = {}) {
  const out = [];
  for (const p of patterns) {
    p.rx.lastIndex = 0;
    let m;
    while ((m = p.rx.exec(text)) !== null) {
      const matchSha256 = createHash('sha256').update(m[0]).digest('hex');
      if (p.ignoreSha256?.includes(matchSha256)) {
        if (m[0].length === 0) p.rx.lastIndex += 1;
        continue;
      }
      out.push({ patternId: p.id, pattern: p.name, ...redact(m[0]), offset: m.index, ...where });
      if (m[0].length === 0) p.rx.lastIndex += 1;
      if (out.length > 200) return out; // a flood is already a hard fail
    }
  }
  return out;
}

/** Scan a Buffer as both latin1 (byte-preserving) and utf16le. */
export function scanBuffer(buf, patterns, where = {}) {
  const findings = scanText(buf.toString('latin1'), patterns, where);
  if (buf.length >= 2) {
    for (const f of scanText(buf.toString('utf16le'), patterns, { ...where, encoding: 'utf16le' })) {
      if (!findings.some((x) => x.patternId === f.patternId && x.fingerprint === f.fingerprint)) findings.push(f);
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Container readers — dependency-free
// ---------------------------------------------------------------------------

/**
 * Minimal ZIP reader: walks the central directory and inflates each entry.
 * Deliberately not a full implementation — anything it cannot handle throws, and
 * the caller degrades coverage to 'partial' rather than silently reporting clean.
 */
export function* readZipEntries(buf) {
  // End of central directory: scan backwards for 0x06054b50 (comment may follow).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip (no end-of-central-directory record)');

  const count = buf.readUInt16LE(eocd + 10);
  let cd = buf.readUInt32LE(eocd + 16);
  if (cd === 0xffffffff || count === 0xffff) throw new Error('zip64 archives are not supported by the built-in reader');

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(cd) !== 0x02014b50) throw new Error(`corrupt central directory at entry ${i}`);
    const method = buf.readUInt16LE(cd + 10);
    const compSize = buf.readUInt32LE(cd + 20);
    const uncompSize = buf.readUInt32LE(cd + 24);
    const nameLen = buf.readUInt16LE(cd + 28);
    const extraLen = buf.readUInt16LE(cd + 30);
    const commentLen = buf.readUInt16LE(cd + 32);
    const localOff = buf.readUInt32LE(cd + 42);
    const name = buf.slice(cd + 46, cd + 46 + nameLen).toString('utf8');
    cd += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // directory entry

    const read = () => {
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error(`corrupt local header for ${name}`);
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.slice(start, start + compSize);
      if (method === 0) return raw;
      if (method === 8) return inflateRawSync(raw);
      throw new Error(`unsupported zip compression method ${method} for ${name}`);
    };
    yield { name, size: uncompSize, read };
  }
}

/** Minimal tar reader (ustar/gnu), operating on an already-decompressed buffer. */
export function* readTarEntries(buf) {
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.slice(off, off + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive
    const rawName = header.slice(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.slice(345, 500).toString('utf8').replace(/\0.*$/, '');
    const sizeField = header.slice(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeField, 8) || 0;
    const typeflag = String.fromCharCode(header[156]);
    const name = prefix ? `${prefix}/${rawName}` : rawName;
    const dataStart = off + 512;
    off = dataStart + Math.ceil(size / 512) * 512;
    if (typeflag !== '0' && typeflag !== '\0' && typeflag !== '7') continue; // only regular files
    if (!name) continue;
    yield { name, size, read: () => buf.slice(dataStart, dataStart + size) };
  }
}

/**
 * Electron `.asar` reader. Format: 4-byte pickle size, 4-byte header-payload
 * size, 4-byte header string size, then the JSON index; file bodies follow at
 * `headerEnd + offset`. This matters because an Electron installer's real
 * payload is app.asar, and a `*-unpacked/` tree next to the installer contains it.
 */
export function* readAsarEntries(buf) {
  if (buf.length < 16) throw new Error('not an asar (too small)');
  const headerPickleSize = buf.readUInt32LE(0);
  if (headerPickleSize !== 4) throw new Error('not an asar (bad pickle header)');
  const headerStringSize = buf.readUInt32LE(12);
  const headerEnd = 16 + headerStringSize;
  const index = JSON.parse(buf.slice(16, headerEnd).toString('utf8'));
  const baseOffset = headerEnd + ((4 - (headerStringSize % 4)) % 4);

  function* walk(node, prefix) {
    for (const [name, child] of Object.entries(node.files ?? {})) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (child.files) yield* walk(child, path);
      else if (typeof child.offset === 'string') {
        const start = baseOffset + Number(child.offset);
        const size = child.size ?? 0;
        yield { name: path, size, read: () => buf.slice(start, start + size) };
      }
    }
  }
  yield* walk(index, '');
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

const ZIP_EXT = new Set(['.zip', '.xpi', '.crx', '.vsix', '.jar', '.nupkg']);
const TAR_EXT = new Set(['.tar']);
const TGZ_EXT = new Set(['.tgz', '.gz']);

/**
 * Formats whose payload is compressed with something we cannot open in-process
 * (NSIS/LZMA, squashfs, HFS, MSI CFB, …). For these, and ONLY these, a raw byte
 * scan is genuinely incomplete — so they report `coverage: 'raw'` and the
 * publisher's fail-closed policy demands the unpacked sidecar or an explicit
 * acknowledgement. For any other plain file the raw scan reads every byte, which
 * IS complete coverage.
 */
const OPAQUE_EXT = new Set([
  '.exe', '.msi', '.dmg', '.pkg', '.appimage', '.deb', '.rpm', '.snap',
  '.7z', '.xz', '.zst', '.bz2', '.cab', '.iso', '.squashfs',
]);

export function isOpaqueArtifact(name) {
  return OPAQUE_EXT.has(extname(String(name).toLowerCase()));
}

function containerKind(name) {
  const lower = name.toLowerCase();
  const ext = extname(lower);
  if (ZIP_EXT.has(ext)) return 'zip';
  if (lower.endsWith('.asar')) return 'asar';
  if (lower.endsWith('.tar.gz') || TGZ_EXT.has(ext)) return 'tgz';
  if (TAR_EXT.has(ext)) return 'tar';
  return null;
}

/** Scan an in-memory container, recursing into nested containers (bounded depth). */
function scanContainerBuffer(buf, kind, label, patterns, state, depth) {
  let iter;
  try {
    if (kind === 'zip') iter = readZipEntries(buf);
    else if (kind === 'asar') iter = readAsarEntries(buf);
    else if (kind === 'tar') iter = readTarEntries(buf);
    else if (kind === 'tgz') iter = readTarEntries(gunzipSync(buf));
    else throw new Error(`unknown container kind ${kind}`);
  } catch (e) {
    state.unscanned.push({ entry: label, reason: e.message });
    return;
  }

  try {
    for (const entry of iter) {
      const entryLabel = `${label}!${entry.name}`;
      if (entry.size > MAX_ENTRY_BYTES) {
        state.unscanned.push({ entry: entryLabel, reason: `entry is ${entry.size} bytes (> ${MAX_ENTRY_BYTES})` });
        continue;
      }
      let data;
      try { data = entry.read(); } catch (e) {
        state.unscanned.push({ entry: entryLabel, reason: e.message });
        continue;
      }
      state.entriesScanned += 1;
      state.findings.push(...scanBuffer(data, patterns, { entry: entryLabel }));
      const nested = containerKind(entry.name);
      if (nested && depth < 4) scanContainerBuffer(data, nested, entryLabel, patterns, state, depth + 1);
    }
  } catch (e) {
    state.unscanned.push({ entry: label, reason: `container walk aborted: ${e.message}` });
  }
}

/** Streaming raw-byte scan for artifacts we cannot open (NSIS, dmg, AppImage). */
async function scanRawStream(path, patterns, state) {
  await new Promise((resolve, reject) => {
    let carry = Buffer.alloc(0);
    let base = 0;
    const s = createReadStream(path, { highWaterMark: RAW_CHUNK });
    s.on('error', reject);
    s.on('data', (chunk) => {
      const buf = Buffer.concat([carry, chunk]);
      for (const f of scanBuffer(buf, patterns, { entry: basename(path) })) {
        f.offset += base - carry.length;
        state.findings.push(f);
      }
      carry = buf.slice(Math.max(0, buf.length - RAW_CARRY));
      base += chunk.length;
    });
    s.on('end', resolve);
  });
  state.entriesScanned += 1;
}

/**
 * Scan one local artifact (file or directory).
 * @returns {{path:string, coverage:'structural'|'raw'|'partial', entriesScanned:number,
 *            findings:object[], unscanned:{entry:string,reason:string}[]}}
 */
export async function scanArtifact(path, { patterns = loadPatterns(), sidecarUnpacked = true } = {}) {
  const state = { findings: [], unscanned: [], entriesScanned: 0 };
  const st = statSync(path);

  if (st.isDirectory()) {
    for (const file of walkFiles(path)) {
      const sub = await scanArtifact(file, { patterns, sidecarUnpacked: false });
      // Entry paths are always reported with forward slashes so a finding reads the
      // same on every platform and can be pasted straight into a grep.
      const rel = relative(path, file).split(sep).join('/');
      state.findings.push(...sub.findings.map((f) => ({
        ...f,
        entry: `${rel}${f.entry && f.entry !== basename(file) ? `!${f.entry.split('!').slice(1).join('!')}` : ''}`,
      })));
      state.unscanned.push(...sub.unscanned);
      state.entriesScanned += sub.entriesScanned;
    }
    return finish(path, state, 'structural');
  }

  const kind = containerKind(path);
  if (kind) {
    if (st.size > MAX_ENTRY_BYTES) {
      state.unscanned.push({ entry: basename(path), reason: `container is ${st.size} bytes (> ${MAX_ENTRY_BYTES})` });
      await scanRawStream(path, patterns, state);
      return finish(path, state, 'raw');
    }
    scanContainerBuffer(readFileSync(path), kind, basename(path), patterns, state, 0);
    return finish(path, state, 'structural');
  }

  // Not a container. A raw byte scan reads every byte, which is COMPLETE coverage
  // for a plain file — it is only incomplete when the format hides a compressed
  // payload (NSIS, dmg, AppImage). Those get the sidecar treatment below.
  await scanRawStream(path, patterns, state);
  const opaque = isOpaqueArtifact(path);
  let coverage = opaque ? 'raw' : 'structural';
  if (opaque && sidecarUnpacked) {
    const sidecars = findUnpackedSidecars(path);
    for (const dir of sidecars) {
      const sub = await scanArtifact(dir, { patterns, sidecarUnpacked: false });
      state.findings.push(...sub.findings.map((f) => ({ ...f, entry: `${basename(dir)}/${f.entry}` })));
      state.unscanned.push(...sub.unscanned);
      state.entriesScanned += sub.entriesScanned;
    }
    if (sidecars.length) coverage = 'structural';
    state.sidecars = sidecars;
  }
  return finish(path, state, coverage);
}

function finish(path, state, coverage) {
  return {
    path,
    coverage: state.unscanned.length ? 'partial' : coverage,
    entriesScanned: state.entriesScanned,
    findings: state.findings,
    unscanned: state.unscanned,
    sidecars: state.sidecars ?? [],
  };
}

/**
 * An electron-builder installer sits next to its unpacked payload
 * (`win-unpacked/`, `mac/<App>.app`, `linux-unpacked/`). Scanning that tree —
 * including `resources/app.asar` — is the only way to see inside an NSIS/dmg
 * artifact without external tooling.
 */
export function findUnpackedSidecars(installerPath) {
  const dir = dirname(installerPath);
  const out = [];
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names) {
    const full = join(dir, n);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (/-unpacked$/i.test(n) || /^mac(-arm64)?$/i.test(n) || n.toLowerCase().endsWith('.app')) out.push(full);
  }
  return out;
}

export function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}

/** Human-readable, agent-parseable rendering of a scan result. */
export function formatScanResult(result) {
  const lines = [];
  const rel = result.path.split(sep).slice(-2).join('/');
  if (result.findings.length) {
    lines.push(`  ✖ SECRET-SHAPED STRINGS in ${rel} (${result.findings.length}):`);
    const seen = new Set();
    for (const f of result.findings) {
      const key = `${f.patternId}:${f.fingerprint}:${f.entry}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`      ${f.pattern} [${f.patternId}] ${f.preview} len=${f.length} fp=${f.fingerprint}`);
      lines.push(`        in: ${f.entry} @${f.offset}${f.encoding ? ` (${f.encoding})` : ''}`);
    }
  }
  for (const u of result.unscanned) lines.push(`  ⚠ NOT SCANNED: ${u.entry} — ${u.reason}`);
  return lines.join('\n');
}
