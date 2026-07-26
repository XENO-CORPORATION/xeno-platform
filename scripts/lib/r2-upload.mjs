/**
 * r2-upload.mjs — THE choke point. Every write to Cloudflare R2 goes through here.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this module there were FIVE independent `rclone` call sites across
 * xeno-release.mjs, publish-cli-releases.mjs, publish-extension-releases.mjs,
 * seed-releases.mjs and publish-local-model-catalog.mjs — and no choke point.
 * A gate added to any one of them covered none of the others. The 2026-07 key
 * leak went out through `publish-extension-releases.mjs`, which does
 * `rclone copy <downloaded dir> r2:…/apps/extension/<tag>/` and never looks at
 * a single byte it is uploading.
 *
 * The fix is structural, not procedural: **there is no exported way to invoke
 * rclone that does not scan first.** The scan is inside the uploader, so an
 * agent cannot forget it, cannot sequence it wrongly, and cannot publish past a
 * finding. `runRclone` is module-private on purpose. If you find yourself adding
 * an "unchecked" export, you are re-creating the incident.
 *
 * POLICY (fail-closed)
 * --------------------
 *  - Any secret-shaped match in an artifact  → hard refusal, always.
 *  - An artifact whose payload could not be opened structurally → refusal,
 *    unless the caller passes `allowUnscannablePayload` (a deliberate, logged,
 *    per-run decision). NSIS/dmg/AppImage payloads are LZMA/squashfs; the honest
 *    answer is that a raw byte scan does not cover them, so the publisher demands
 *    the adjacent `*-unpacked/` tree (which electron-builder always emits) or an
 *    explicit acknowledgement.
 *  - `v<version>/` keys are immutable: if the key already exists with different
 *    bytes, refuse. "Never overwrite an installer" was prose in the runbook and
 *    `rclone copyto` happily clobbers.
 *  - Moving pointers (JSON/YML) always get `Cache-Control: no-cache` — the header
 *    is applied by the method, so it cannot be forgotten (publish-local-model-catalog
 *    forgot it, and its manifest ships cacheable to this day).
 */
import { execFileSync } from 'node:child_process';
import { statSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { loadPatterns, scanArtifact, formatScanResult, walkFiles } from './secret-scan.mjs';
import { describeArtifact } from './feed-integrity.mjs';

/** PRIVATE. Never export this. See the header. */
function runRclone(args, { dryRun, label }) {
  if (dryRun) {
    console.log(`  [dry-run] rclone ${args.join(' ')}`);
    return;
  }
  execFileSync('rclone', args, { stdio: 'inherit' });
  if (label) console.log(`  ↑ ${label}`);
}

/**
 * Read-only R2 probe for the immutability check; safe in dry-run.
 *
 * Distinguishes "the object is not there" (the normal case — proceed) from "the probe
 * itself failed" (rclone missing, remote misconfigured, permissions). The second must
 * NOT be silently treated as "not there": that turns the immutability gate into a
 * no-op exactly when the environment is broken.
 *
 * @returns {{status:'found', entry:object}|{status:'absent'}|{status:'unknown', reason:string}}
 */
function statRemote(remoteKey) {
  try {
    const out = execFileSync('rclone', ['lsjson', remoteKey], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const list = JSON.parse(out);
    return Array.isArray(list) && list.length ? { status: 'found', entry: list[0] } : { status: 'absent' };
  } catch (e) {
    const text = `${e.stderr ?? ''}${e.message ?? ''}`;
    if (/not found|doesn't exist|does not exist/i.test(text)) return { status: 'absent' };
    return { status: 'unknown', reason: (text.split('\n').find(Boolean) ?? 'rclone probe failed').trim().slice(0, 200) };
  }
}

export class GateError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'GateError';
    this.detail = detail;
  }
}

export class R2Publisher {
  /**
   * @param {object} o
   * @param {string} o.remote                 e.g. 'r2:xeno-hub-releases'
   * @param {boolean} o.dryRun
   * @param {boolean} [o.allowUnscannablePayload]
   * @param {boolean} [o.allowOverwrite]      escape hatch for the immutability rule
   */
  constructor({ remote, dryRun = false, allowUnscannablePayload = false, allowOverwrite = false }) {
    this.remote = remote;
    this.dryRun = dryRun;
    this.allowUnscannablePayload = allowUnscannablePayload;
    this.allowOverwrite = allowOverwrite;
    this.patterns = loadPatterns();
    this.scanned = [];
    this.uploads = [];
    /**
     * Clearances, keyed by path + size + mtime. This exists so a caller can gate
     * everything UP FRONT (before any upload) and then upload, without paying for a
     * second scan of a 180 MB installer. It does NOT weaken the invariant: putArtifact
     * still calls gate(), and gate() only returns a cached clearance for bytes that
     * have not changed since they were cleared.
     */
    this.cleared = new Map();
  }

  /**
   * Run the secret gate over one local path. Throws GateError on any finding.
   * Returns the scan result so the caller can report coverage.
   */
  async gate(path, { requireStructural = true } = {}) {
    let stamp = '';
    try {
      const st = statSync(path);
      stamp = `${path}|${st.size}|${st.mtimeMs}|${requireStructural}`;
      const hit = this.cleared.get(stamp);
      if (hit) return hit;
    } catch { /* fall through to a full scan */ }

    const result = await scanArtifact(path, { patterns: this.patterns });
    this.scanned.push(result);

    if (result.findings.length) {
      console.error(`\n✖ SECRET GATE — refusing to upload ${path}`);
      console.error(formatScanResult(result));
      console.error(
        '\n  This artifact carries a secret-shaped string. It is NOT publishable.\n' +
        '  Removing the secret from SOURCE is not enough — a pre-existing artifact keeps it\n' +
        '  (2026-03-13 build + 2026-07-10 source fix + 2026-07-14 upload = a live key on the CDN).\n' +
        '  REBUILD the artifact from clean source, then re-run. If the match is a false positive,\n' +
        '  narrow the pattern in scripts/lib/secret-patterns.json — do not bypass the gate.',
      );
      throw new GateError(`secret-shaped string in ${basename(path)}`, result);
    }

    if (requireStructural && result.coverage !== 'structural') {
      const why = result.unscanned.length
        ? result.unscanned.map((u) => `      ${u.entry} — ${u.reason}`).join('\n')
        : '      the artifact is an opaque compressed installer (NSIS / dmg / AppImage);\n' +
          '      a raw byte scan does NOT see its compressed payload.';
      if (!this.allowUnscannablePayload) {
        console.error(`\n✖ COVERAGE GATE — refusing to upload ${path} (coverage: ${result.coverage})`);
        console.error(why);
        console.error(
          '\n  Fix, in order of preference:\n' +
          '    1. Publish from the packager output directory so the adjacent unpacked tree\n' +
          "       (release/win-unpacked/, mac/<App>.app, linux-unpacked/) sits next to the\n" +
          '       installer. It contains resources/app.asar, which IS scanned.\n' +
          '    2. If the payload genuinely cannot be opened, re-run with\n' +
          '       --allow-unscannable-payload and record WHY in the release notes.\n' +
          '  This is fail-closed by design: an unscanned payload is how the extension leak shipped.',
        );
        throw new GateError(`payload of ${basename(path)} could not be scanned structurally`, result);
      }
      console.warn(`  ⚠ coverage ${result.coverage} for ${basename(path)} — ACKNOWLEDGED via --allow-unscannable-payload`);
      console.warn(why);
    }
    if (stamp) this.cleared.set(stamp, result);
    return result;
  }

  /** Immutability: refuse to replace an existing versioned artifact with different bytes. */
  assertNotClobbering(localPath, key) {
    if (this.allowOverwrite) return;
    if (!/\/v[^/]+\//.test(`/${key}`)) return; // only versioned artifact keys are immutable
    const probe = statRemote(`${this.remote}/${key}`);
    if (probe.status === 'unknown') {
      if (!this.warnedImmutability) {
        this.warnedImmutability = true;
        console.warn(
          `  ⚠ immutability check UNAVAILABLE (${probe.reason}).\n` +
          '    Could not ask R2 whether these keys already exist, so an existing immutable\n' +
          '    installer would be silently overwritten. Fix the rclone remote before a real publish.',
        );
      }
      return;
    }
    if (probe.status === 'absent') return;
    const remote = probe.entry;
    const localSize = statSync(localPath).size;
    if (remote.Size === localSize) return; // same bytes, benign re-run
    throw new GateError(
      `IMMUTABILITY GATE — ${key} already exists on R2 with a different size ` +
      `(remote ${remote.Size} vs local ${localSize}). Installers are immutable: overwriting one ` +
      `silently changes what every existing download link serves, and no checksum anybody published ` +
      `still matches. Cut a NEW version instead, or pass --allow-overwrite if you are certain.`,
      { key, remoteSize: remote.Size, localSize },
    );
  }

  /**
   * Upload an immutable artifact (installer, blockmap, mirrored asset).
   * Scans, checks immutability, then uploads. There is no path that skips step one.
   */
  async putArtifact(localPath, key, { requireStructural = true, label } = {}) {
    await this.gate(localPath, { requireStructural });
    this.assertNotClobbering(localPath, key);
    runRclone(['copyto', localPath, `${this.remote}/${key}`, '--no-traverse'], { dryRun: this.dryRun, label });
    this.uploads.push({ key, path: localPath, kind: 'artifact' });
    return describeArtifact(localPath);
  }

  /**
   * Upload a moving pointer (releases.json, version.json, <channel>.yml).
   * `Cache-Control: no-cache` is applied by this method — callers cannot forget it.
   */
  /**
   * Snapshot the CURRENT remote object before it is overwritten.
   *
   * WHY THIS EXISTS — R2 has NO object versioning. Verified 2026-07-26 against an
   * account-admin R2 token: there is no `/versioning` route, the bucket object exposes
   * only {name, creation_date, location, storage_class, jurisdiction}, and Cloudflare's
   * own S3-compatibility table marks PutBucketVersioning / GetBucketVersioning ❌.
   * So an overwritten POINTER is gone — and pointers are the only objects we overwrite
   * (installers live under an immutable `v<version>/`, enforced by the immutability gate).
   *
   * On 2026-07-26 a stray `import()` of seed-releases.mjs replaced releases.json for
   * hub/pixel/motion/sound. Only a stale local copy made partial reconstruction possible;
   * some entries carry placeholder notes permanently. See
   * `docs/engineering-learnings.md` → "Importing a module to check its syntax EXECUTES it".
   *
   * Snapshots are keyed `_snapshots/<key>/<ISO8601>.<ext>` inside the same bucket. They are
   * bytes-only copies, cost pennies (pointers are KB), and are NOT gated — the bytes are
   * already live, so scanning them would refuse a rescue of an already-published object.
   * A snapshot failure NEVER blocks the publish: losing history is bad, being unable to
   * ship a fix is worse.
   */
  async snapshotPointer(key, { label } = {}) {
    const probe = statRemote(`${this.remote}/${key}`);
    if (probe.status === 'absent') {
      console.log(`  snapshot: ${key} does not exist yet (first publish) — nothing to preserve`);
      return null;
    }
    if (probe.status === 'unknown') {
      // Same discipline as the immutability gate: a BROKEN probe must not read as "nothing
      // to back up". Warn explicitly so a failed backup is never mistaken for a skipped one.
      console.warn(`  ⚠ snapshot: could not probe ${key} (${probe.reason}). Overwriting WITHOUT a backup.`);
      return null;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dot = key.lastIndexOf('.');
    const ext = dot > key.lastIndexOf('/') ? key.slice(dot) : '';
    const dest = `_snapshots/${key}/${stamp}${ext}`;
    try {
      // Server-side copy: no download, no re-upload of bytes that are already live.
      runRclone(['copyto', `${this.remote}/${key}`, `${this.remote}/${dest}`, '--no-traverse'], {
        dryRun: this.dryRun,
        label: label ?? `snapshot ${key}`,
      });
      console.log(`  snapshot: ${key} → ${dest}`);
      return dest;
    } catch (err) {
      // Deliberately non-fatal. Losing history is bad; being unable to ship a fix is worse.
      console.warn(`  ⚠ snapshot of ${key} FAILED (${err?.message ?? err}). The overwrite is NOT undoable — continuing.`);
      return null;
    }
  }

  async putPointer(contents, key, { label } = {}) {
    const tmp = mkdtempSync(join(tmpdir(), 'xeno-r2-'));
    const file = join(tmp, basename(key));
    writeFileSync(file, contents);
    await this.gate(file, { requireStructural: false }); // JSON/YML: text, always fully scanned
    // Preserve the outgoing bytes BEFORE clobbering them. R2 gives us no undo.
    await this.snapshotPointer(key, { label: label ? `${label} (pre-overwrite)` : undefined });
    runRclone(
      ['copyto', file, `${this.remote}/${key}`, '--header-upload', 'Cache-Control: no-cache', '--no-traverse'],
      { dryRun: this.dryRun, label },
    );
    this.uploads.push({ key, path: file, kind: 'pointer', snapshotted: true });
    return file;
  }

  /**
   * Mirror a whole local directory (the extension release-asset path). EVERY file
   * is scanned individually — this is the exact call site that leaked the key.
   */
  async putDirectory(localDir, keyPrefix, { requireStructural = true } = {}) {
    if (!existsSync(localDir)) throw new GateError(`directory not found: ${localDir}`);
    const files = [...walkFiles(localDir)];
    if (!files.length) throw new GateError(`refusing to mirror an empty directory: ${localDir}`);
    for (const f of files) await this.gate(f, { requireStructural });
    runRclone(['copy', localDir, `${this.remote}/${keyPrefix}`, '--no-traverse'], {
      dryRun: this.dryRun,
      label: `${files.length} file(s) → ${keyPrefix}`,
    });
    for (const f of files) this.uploads.push({ key: `${keyPrefix}${basename(f)}`, path: f, kind: 'artifact' });
    return files;
  }

  /** Summary line for the release report. */
  coverageSummary() {
    const by = { structural: 0, raw: 0, partial: 0 };
    for (const s of this.scanned) by[s.coverage] = (by[s.coverage] ?? 0) + 1;
    const entries = this.scanned.reduce((n, s) => n + s.entriesScanned, 0);
    return `secret gate: ${this.scanned.length} artifact(s), ${entries} entr(ies) scanned ` +
      `(structural ${by.structural}, raw ${by.raw}, partial ${by.partial}) — 0 findings`;
  }
}
