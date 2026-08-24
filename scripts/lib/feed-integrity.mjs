/**
 * feed-integrity.mjs — prove an electron-updater feed actually resolves.
 *
 * WHY THIS EXISTS
 * ---------------
 * A silently-dead auto-update channel is the single most repeated defect in this
 * ecosystem. Every instance found by hand on 2026-07-25/26 is a case this module
 * now catches mechanically:
 *
 *   motion, workflow  `latest.yml` referenced a HYPHENATED filename while the
 *                     uploaded installer used SPACES → electron-updater 404.
 *                     The sha512 matched, which is the tell that only the NAME
 *                     was wrong and a feed rewrite — not a rebuild — was correct.
 *   shell             needed `beta.yml`, not `latest.yml`; the publisher only
 *                     knew about `latest*.yml` and warned-and-continued.
 *   shell (2nd stage) the copy inside `v<version>/` must carry BARE filenames;
 *                     prefixing it produced `v<v>/v<v>/<file>` → 404.
 *
 * The distinction this module encodes, and which an agent must be able to act on
 * without a human:
 *
 *   FEED_FILENAME_MISMATCH  the bytes are right, the name in the feed is wrong
 *                           → REWRITE the feed. No rebuild.
 *   FEED_CHECKSUM_MISMATCH  the feed describes different bytes than the artifact
 *                           → REBUILD. Never hand-edit a checksum to make a gate pass.
 */
import { createHash } from 'node:crypto';
import { statSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * electron-builder names the update-metadata file after the CHANNEL, which it
 * derives from the semver PRERELEASE tag — not from anything the publisher says.
 *   0.6.4          → latest.yml
 *   0.1.0-beta.1   → beta.yml
 *   2.0.0-alpha.3  → alpha.yml
 *   1.0.0-rc.1     → rc.yml
 */
export function deriveChannel(version) {
  const pre = String(version).split('-')[1];
  if (!pre) return 'latest';
  const tag = pre.split('.')[0].toLowerCase();
  return /^[a-z][a-z0-9]*$/.test(tag) ? tag : 'latest';
}

/** The three per-OS feed filenames for a channel (`latest` == the stable channel). */
export function channelFeedNames(channel) {
  const c = channel === 'stable' ? 'latest' : channel;
  return { windows: `${c}.yml`, mac: `${c}-mac.yml`, linux: `${c}-linux.yml` };
}

/**
 * Parse the subset of an electron-builder feed we must verify. Deliberately a
 * line-oriented reader, not a YAML parser: the feed is machine-generated with a
 * fixed shape, and pulling in a YAML dependency into the publish path would be a
 * supply-chain surface for no benefit.
 */
export function parseUpdaterFeed(text) {
  const lines = text.split('\n');
  const feed = { version: null, releaseDate: null, topPath: null, topSha512: null, files: [], refs: [] };
  let current = null;
  lines.forEach((line, i) => {
    const unquote = (v) => (/^(['"]).*\1$/.test(v) ? v.slice(1, -1) : v);
    let m;
    if ((m = line.match(/^version:\s*(.+?)\s*$/))) feed.version = unquote(m[1]);
    else if ((m = line.match(/^releaseDate:\s*(.+?)\s*$/))) feed.releaseDate = unquote(m[1]);
    else if ((m = line.match(/^path:\s*(.+?)\s*$/))) {
      feed.topPath = unquote(m[1]);
      feed.refs.push({ kind: 'path', value: feed.topPath, line: i + 1 });
    } else if ((m = line.match(/^sha512:\s*(.+?)\s*$/))) feed.topSha512 = unquote(m[1]);
    else if ((m = line.match(/^\s*-\s+url:\s*(.+?)\s*$/))) {
      current = { url: unquote(m[1]), sha512: null, size: null, line: i + 1 };
      feed.files.push(current);
      feed.refs.push({ kind: 'files.url', value: current.url, line: i + 1 });
    } else if (current && (m = line.match(/^\s+sha512:\s*(.+?)\s*$/))) current.sha512 = unquote(m[1]);
    else if (current && (m = line.match(/^\s+size:\s*(\d+)\s*$/))) current.size = Number(m[1]);
  });
  return feed;
}

/**
 * Rewrite installer references for a target LAYOUT.
 *
 *   'slug-root'   the feed lives at apps/<slug>/<channel>.yml, so refs must be
 *                 `v<version>/<file>` (electron-updater resolves them against
 *                 publish.url = apps/<slug>/, and installers live one dir down).
 *   'version-dir' the feed lives at apps/<slug>/v<version>/<channel>.yml, so refs
 *                 must be BARE filenames — they already resolve inside that dir.
 *
 * Both directions are idempotent, and both are exercised by tests, because
 * getting this backwards is precisely the double-prefix 404 seen on 2026-07-26.
 * sha512/size are never touched: they hash CONTENT, not the path.
 */
export function rewriteFeedRefs(text, version, layout = 'slug-root') {
  const prefix = `v${version}/`;
  return text.split('\n').map((line) => {
    const m = line.match(/^(\s*(?:-\s+url|url|path):\s+)(.+?)\s*$/);
    if (!m) return line;
    const head = m[1];
    const val = m[2];
    const q = /^(['"]).*\1$/.test(val) ? val[0] : '';
    let inner = q ? val.slice(1, -1) : val;
    if (!inner) return line;
    if (layout === 'version-dir') {
      // Strip any leading path segments — the feed sits in the version dir already.
      const bare = inner.split('/').pop();
      inner = bare;
    } else {
      if (inner.includes('/')) return line; // already carries a path segment
      inner = prefix + inner;
    }
    return `${head}${q}${inner}${q}`;
  }).join('\n');
}

/** Back-compat alias: the original single-purpose helper. */
export function rewriteLatestYml(text, version) {
  return rewriteFeedRefs(text, version, 'slug-root');
}

/**
 * Hash a file of ANY size, without loading it into memory.
 *
 * 🔴 These used `readFileSync`, which is capped at Node's ~2 GiB Buffer limit:
 *
 *   RangeError [ERR_FS_FILE_TOO_LARGE]: File size (2783446304) is greater than 2 GiB
 *
 * So the gated publisher physically could not take a model weight — 2.78 GB for Qwen 3.8 4B,
 * 21.7 GB for Ornith. That is not a cosmetic limit: it is why `publish-local-model-catalog.mjs`
 * shells `rclone copyto` directly and references `r2-upload.mjs` ZERO times. Every model ever
 * published to R2 therefore went up UNGATED — no secret scan, no immutability check — past the
 * single choke point that ABSOLUTE RULE §2b exists to enforce.
 *
 * A gate that cannot accept the payload does not get bypassed occasionally; it gets bypassed
 * permanently, and the bypass becomes the normal path. Fixing the gate is what removes the reason
 * to route around it.
 *
 * Deliberately SYNCHRONOUS. `describeArtifact` and its callers are sync, and making these async
 * would ripple through the publisher for no benefit — chunked `readSync` streams just as well and
 * produces a byte-identical digest.
 */
function hashFileSync(file, algorithm) {
  const hash = createHash(algorithm);
  const fd = openSync(file, 'r');
  try {
    // 1 MiB: large enough that syscall overhead is irrelevant next to disk throughput, small
    // enough that hashing a 21.7 GB model costs a megabyte of RSS rather than a gigabyte.
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead;
    while ((bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    closeSync(fd);
  }
  return hash;
}

/** electron-builder writes sha512 as BASE64 of the raw digest, not hex. */
export function sha512Base64(file) {
  return hashFileSync(file, 'sha512').digest('base64');
}

export function sha256Hex(file) {
  return hashFileSync(file, 'sha256').digest('hex');
}

/**
 * Static (pre-upload) verification of a feed against the artifacts being published.
 *
 * @param {object}   o
 * @param {string}   o.feedText   the feed exactly as it will be uploaded
 * @param {string}   o.version
 * @param {'slug-root'|'version-dir'} o.layout
 * @param {{name:string,path:string,size:number,sha512:string}[]} o.artifacts
 *        every file this publish uploads into `v<version>/` (installer + blockmap)
 * @returns {{ok:boolean, problems:{code:string,ref:string,message:string,fix:string}[]}}
 */
export function verifyFeedAgainstArtifacts({ feedText, version, layout, artifacts }) {
  const feed = parseUpdaterFeed(feedText);
  const problems = [];
  const byName = new Map(artifacts.map((a) => [a.name, a]));
  const bySha = new Map(artifacts.map((a) => [a.sha512, a]));

  if (feed.version && feed.version !== version) {
    problems.push({
      code: 'FEED_VERSION_MISMATCH',
      ref: `version: ${feed.version}`,
      message: `the feed declares version ${feed.version} but this publish is ${version}`,
      fix: `REBUILD — the feed came from a different build. Do not edit the version line.`,
    });
  }
  if (!feed.refs.length) {
    problems.push({
      code: 'FEED_NO_REFS',
      ref: '(none)',
      message: 'the feed references no installer at all',
      fix: 'REBUILD — electron-builder emitted an empty feed.',
    });
  }

  for (const ref of feed.refs) {
    const value = ref.value;
    const bare = value.split('/').pop();
    const dir = value.includes('/') ? value.slice(0, value.lastIndexOf('/') + 1) : '';

    // --- layout ---------------------------------------------------------
    if (layout === 'slug-root' && dir !== `v${version}/`) {
      problems.push({
        code: dir ? 'FEED_REF_WRONG_PREFIX' : 'FEED_REF_MISSING_VERSION_PREFIX',
        ref: `${ref.kind} line ${ref.line}: ${value}`,
        message: dir
          ? `ref carries prefix "${dir}" but this feed lives at the slug root, so it must be "v${version}/"`
          : `ref is a bare filename; at the slug root it resolves to apps/<slug>/${bare}, which does not exist`,
        fix: `REWRITE the feed ref to "v${version}/${bare}". No rebuild needed.`,
      });
    }
    if (layout === 'version-dir' && dir) {
      problems.push({
        code: 'FEED_REF_UNEXPECTED_PREFIX',
        ref: `${ref.kind} line ${ref.line}: ${value}`,
        message: `this feed lives INSIDE v${version}/, so prefix "${dir}" resolves to v${version}/${dir}${bare} — a double prefix that 404s`,
        fix: `REWRITE the feed ref to the bare filename "${bare}". No rebuild needed.`,
      });
    }

    // --- does the referenced file exist in this publish? ------------------
    if (!byName.has(bare)) {
      const entry = feed.files.find((f) => f.url === value);
      const twin = entry?.sha512 ? bySha.get(entry.sha512) : undefined;
      if (twin) {
        problems.push({
          code: 'FEED_FILENAME_MISMATCH',
          ref: `${ref.kind} line ${ref.line}: ${value}`,
          message: `no artifact named "${bare}" is being uploaded, but the sha512 matches "${twin.name}" — the BYTES are correct and only the NAME in the feed is wrong (this is the motion/workflow hyphen-vs-space defect)`,
          fix: `REWRITE the feed ref to "${layout === 'version-dir' ? twin.name : `v${version}/${twin.name}`}". A rebuild is NOT required.`,
        });
      } else {
        problems.push({
          code: 'FEED_REF_UNRESOLVABLE',
          ref: `${ref.kind} line ${ref.line}: ${value}`,
          message: `the feed references "${bare}", which is not among the artifacts being uploaded (${[...byName.keys()].join(', ') || 'none'})`,
          fix: `REBUILD — the feed and the artifacts come from different builds.`,
        });
      }
      continue;
    }

    // --- checksum + size --------------------------------------------------
    const artifact = byName.get(bare);
    const entry = feed.files.find((f) => f.url === value);
    const declaredSha = entry?.sha512 ?? (ref.kind === 'path' ? feed.topSha512 : null);
    if (declaredSha && declaredSha !== artifact.sha512) {
      problems.push({
        code: 'FEED_CHECKSUM_MISMATCH',
        ref: `${ref.kind} line ${ref.line}: ${value}`,
        message: `the feed's sha512 does not match the bytes of "${artifact.name}" — the feed describes a DIFFERENT build`,
        fix: `REBUILD and re-run the publisher. Never hand-edit a checksum to make this pass: it exists to stop shipping a feed that points at bytes nobody verified.`,
      });
    }
    if (entry?.size != null && entry.size !== artifact.size) {
      problems.push({
        code: 'FEED_SIZE_MISMATCH',
        ref: `${ref.kind} line ${ref.line}: ${value}`,
        message: `the feed declares size ${entry.size} but "${artifact.name}" is ${artifact.size} bytes`,
        fix: `REBUILD — a size disagreement means the feed and the artifact are from different builds.`,
      });
    }
  }

  return { ok: problems.length === 0, problems, feed };
}

/** Describe a local artifact the way the feed verifier wants it. */
export function describeArtifact(path) {
  return {
    name: basename(path),
    path,
    size: statSync(path).size,
    sha512: sha512Base64(path),
    sha256: sha256Hex(path),
  };
}

export function formatFeedProblems(problems) {
  return problems.map((p) => [
    `  ✖ [${p.code}] ${p.ref}`,
    `      ${p.message}`,
    `      → ${p.fix}`,
  ].join('\n')).join('\n');
}
