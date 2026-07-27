#!/usr/bin/env node
/*
 * amend-release-entry.mjs — correct the METADATA or NOTES of a release entry
 * that is already live in `apps/<slug>/releases.json`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The two publishers only ever move a feed FORWARD:
 *   · `xeno-release.mjs`      prepends a new entry (dedupe is by version+channel,
 *                             so it cannot re-channel an existing entry — it would
 *                             add a SECOND row for the same version);
 *   · `publish-cli-releases.mjs` regenerates entries from npm + RELEASE_NOTES.
 *
 * Neither can fix a published claim. And a published claim is exactly the thing
 * that most needs fixing: `releases.json` is MACHINE-READ (the site's release
 * feed, the `/product/<slug>/download/<os>` redirect, XENO Hub), so a wrong
 * `channel` or a false sentence in `notes` keeps being served until it is edited
 * in place. Before this script the only way to do that was a hand-written
 * `rclone copyto` — i.e. straight past the gated choke point, unsnapshotted, with
 * no plan and no structural guard. That is the shape of the 2026-07-26 incident.
 *
 * SAFETY POSTURE (all of it deliberate)
 * -------------------------------------
 *  · DRY-RUN BY DEFAULT. Without `--confirm` nothing is written, ever.
 *  · AMEND, NEVER REWRITE. A structural guard proves the result has the same
 *    entries, in the same order, with every non-target entry byte-identical and
 *    the target's `version`/`date`/`assets` untouched. Anything else refuses.
 *  · SCHEMA-VALIDATED. `type`/`channel`/`severity` are checked against the enums
 *    in `src/lib/productCatalog.ts`. This matters more than it looks: an
 *    unrecognised `type` does not render as "unknown" — `ReleaseFeed.tsx` falls
 *    through to the purple **Release** badge, so a typo would publish a *stronger*
 *    claim than the one being corrected.
 *  · GATED WRITE. The upload goes through `scripts/lib/r2-upload.mjs`, which
 *    secret-scans the bytes and `snapshotPointer()`s the current object to
 *    `_snapshots/<key>/<ISO8601>.json` before overwriting. R2 has no object
 *    versioning; that snapshot is the only undo that exists.
 *  · INERT ON IMPORT. `main()` runs only as the process entry point.
 *
 * WHERE A CORRECTION ACTUALLY SURFACES (check before choosing a field)
 * -------------------------------------------------------------------
 * `ReleaseFeed.tsx` renders `version`, `type` (badge), `channel === 'beta'`
 * (Beta pill), `latest` (Latest pill), `title` (inline on the collapsed row),
 * `date`, `notes` and the asset links. It does NOT render `severity` — words
 * placed there alone are invisible. Put what a user must read in `title`/`notes`.
 *
 * Usage:
 *   node scripts/amend-release-entry.mjs --app <slug> --version <x.y.z> \
 *     [--set-channel stable|beta] [--set-type release|patch|hotfix] \
 *     [--set-severity normal|critical] [--set-latest true|false] \
 *     [--set-title "..."] [--set-notes "..." | --set-notes-file FILE] \
 *     [--sync-version-json-notes] [--confirm]
 *
 * `--sync-version-json-notes` re-derives ONLY the `notes` field of the product's
 * `version.json` (the Hub update prompt) from the amended entry, using the same
 * `title || notes` / 400-char rule as `xeno-release.mjs`. It refuses unless
 * `version.json` already points at this exact version, so it can never repoint
 * an updater at a different build.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { updatesOrigin } from '../src/server/config/hosts.js';
import { R2Publisher } from './lib/r2-upload.mjs';

const PUBLIC = process.env.XENO_UPDATES_BASE || updatesOrigin();
const REMOTE = process.env.XENO_R2_REMOTE || 'r2:xeno-hub-releases';

export const TYPES = ['release', 'patch', 'hotfix'];
export const CHANNELS = ['stable', 'beta'];
export const SEVERITIES = ['normal', 'critical'];

/** Fields this tool is allowed to touch. `version`, `date` and `assets` are NOT here. */
const AMENDABLE = ['channel', 'type', 'severity', 'latest', 'title', 'notes'];

export class AmendRefused extends Error {
  constructor(message) { super(message); this.name = 'AmendRefused'; }
}

/**
 * Amend exactly one entry. PURE — no network, no R2, no process exit — so the
 * structural invariant below is testable hermetically.
 *
 * @param {object[]} feed     the live releases.json array
 * @param {string} version    the entry to amend
 * @param {object} changes    subset of AMENDABLE
 * @returns {{next: object[], plan: {field:string,from:any,to:any}[]}}
 * @throws {AmendRefused} on anything that is not a pure in-place field edit
 */
export function amendEntry({ feed, version, changes }) {
  if (!Array.isArray(feed)) throw new AmendRefused('the live feed is not an array — refusing to write');
  if (!feed.length) throw new AmendRefused('the live feed is EMPTY — this tool amends, it does not seed');

  for (const k of Object.keys(changes)) {
    if (!AMENDABLE.includes(k)) throw new AmendRefused(`"${k}" is not amendable (allowed: ${AMENDABLE.join(', ')})`);
  }
  if (changes.type !== undefined && !TYPES.includes(changes.type)) {
    throw new AmendRefused(
      `type "${changes.type}" is not one of ${TYPES.join('|')}. ReleaseFeed.tsx renders an ` +
      'unrecognised type as the "Release" badge, so this would publish a STRONGER claim, not a corrected one.',
    );
  }
  if (changes.channel !== undefined && !CHANNELS.includes(changes.channel)) {
    throw new AmendRefused(`channel "${changes.channel}" is not one of ${CHANNELS.join('|')} — nothing renders it`);
  }
  if (changes.severity !== undefined && !SEVERITIES.includes(changes.severity)) {
    throw new AmendRefused(`severity "${changes.severity}" is not one of ${SEVERITIES.join('|')}`);
  }
  if (changes.notes !== undefined && !String(changes.notes).trim()) {
    throw new AmendRefused('notes are REQUIRED and must be non-empty');
  }

  const matches = feed.filter((r) => r && r.version === version);
  if (matches.length === 0) {
    throw new AmendRefused(
      `no entry with version "${version}" in the live feed (have: ${feed.map((r) => r?.version).join(', ')})`,
    );
  }
  if (matches.length > 1) {
    throw new AmendRefused(`${matches.length} entries carry version "${version}" — ambiguous, refusing`);
  }

  const target = matches[0];
  const plan = [];
  const next = feed.map((r) => {
    if (r !== target) return JSON.parse(JSON.stringify(r));
    const copy = JSON.parse(JSON.stringify(r));
    for (const [field, to] of Object.entries(changes)) {
      const from = copy[field];
      if (JSON.stringify(from) === JSON.stringify(to)) continue; // already correct — not a change
      plan.push({ field, from, to });
      copy[field] = to;
    }
    return copy;
  });

  // ── The structural guard. An amend may change nothing else, at all. ──────────
  if (next.length !== feed.length) throw new AmendRefused('entry count changed — refusing');
  for (let i = 0; i < feed.length; i++) {
    const before = feed[i];
    const after = next[i];
    if (before.version !== after.version) throw new AmendRefused(`entry ${i} changed version — refusing`);
    if (before !== target) {
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new AmendRefused(`entry ${after.version} is not the target but changed — refusing`);
      }
      continue;
    }
    if (before.date !== after.date) throw new AmendRefused('date is not amendable — refusing');
    if (JSON.stringify(before.assets) !== JSON.stringify(after.assets)) {
      throw new AmendRefused('assets are not amendable — an installer link must never move — refusing');
    }
  }
  return { next, plan };
}

/** version.json's notes rule, verbatim from xeno-release.mjs buildVersionJson(). */
export function derivedPointerNotes(entry) {
  return (entry.title || entry.notes || '').slice(0, 400);
}

/* ── CLI plumbing ──────────────────────────────────────────────────────────── */

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : undefined;
}
function fail(m) { throw new AmendRefused(m); }

async function fetchJson(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new AmendRefused(`GET ${url} → ${r.status}`);
  return r.json();
}

/** Line-level diff, so a notes rewrite is auditable without dumping both blobs. */
function diffLines(from, to) {
  const a = String(from ?? '').split('\n');
  const b = String(to ?? '').split('\n');
  const keep = new Set(b);
  const out = [];
  for (const line of a) if (!keep.has(line)) out.push(`      - ${line}`);
  const had = new Set(a);
  for (const line of b) if (!had.has(line)) out.push(`      + ${line}`);
  return out;
}

async function main() {
  const app = arg('app') || fail('missing --app (R2 folder / product slug)');
  const version = arg('version') || fail('missing --version');
  const confirm = process.argv.includes('--confirm');
  const syncPointer = process.argv.includes('--sync-version-json-notes');

  const changes = {};
  if (arg('set-channel') !== undefined) changes.channel = arg('set-channel');
  if (arg('set-type') !== undefined) changes.type = arg('set-type');
  if (arg('set-severity') !== undefined) changes.severity = arg('set-severity');
  if (arg('set-title') !== undefined) changes.title = arg('set-title');
  if (arg('set-notes') !== undefined) changes.notes = arg('set-notes');
  if (arg('set-notes-file') !== undefined) changes.notes = readFileSync(arg('set-notes-file'), 'utf8').trim();
  if (arg('set-latest') !== undefined) {
    const v = arg('set-latest');
    if (v !== 'true' && v !== 'false') fail('--set-latest takes exactly true|false');
    changes.latest = v === 'true';
  }
  if (!Object.keys(changes).length) fail('nothing to change — pass at least one --set-*');

  const key = `apps/${app}/releases.json`;
  const feed = await fetchJson(`${PUBLIC}/${key}`);
  const { next, plan } = amendEntry({ feed, version, changes });

  console.log(`\namend-release-entry: ${key} — v${version}${confirm ? '' : '  [DRY RUN]'}`);
  console.log(`  ${feed.length} entr${feed.length === 1 ? 'y' : 'ies'} live → ${next.length} after (guard: no add, no drop, no reorder)`);
  if (!plan.length) {
    console.log('\n  NO-OP — every requested value is already what is published. Nothing to write.');
    return;
  }
  console.log('\n  Plan:');
  for (const { field, from, to } of plan) {
    if (field === 'notes') {
      console.log(`    notes: ${String(from).length} chars → ${String(to).length} chars`);
      for (const l of diffLines(from, to)) console.log(l);
    } else {
      console.log(`    ${field}: ${JSON.stringify(from)} → ${JSON.stringify(to)}`);
    }
  }
  for (const r of next) {
    if (r.version === version) continue;
    console.log(`    KEEP  ${r.version} (verbatim)`);
  }

  // version.json — notes only, and only when it already points at THIS version.
  let pointer = null;
  if (syncPointer) {
    const pKey = `apps/${app}/version.json`;
    const live = await fetchJson(`${PUBLIC}/${pKey}`);
    if (live.version !== version) {
      throw new AmendRefused(
        `--sync-version-json-notes: ${pKey} points at ${live.version}, not ${version}. ` +
        'Refusing — this flag may only re-describe the build the pointer already names.',
      );
    }
    const amended = next.find((r) => r.version === version);
    const notes = derivedPointerNotes(amended);
    if (notes !== live.notes) {
      pointer = { key: pKey, body: { ...live, notes } };
      console.log(`\n  ${pKey} (notes only — version/date/OS keys untouched):`);
      console.log(`    notes: ${JSON.stringify(live.notes)} → ${JSON.stringify(notes)}`);
    } else {
      console.log(`\n  ${pKey}: notes already correct — not rewriting.`);
    }
  }

  if (!confirm) {
    console.log('\n  DRY RUN — nothing was written. Re-run with --confirm to apply.');
    return;
  }

  const r2 = new R2Publisher({ remote: REMOTE, dryRun: false });
  console.log('');
  // No trailing newline: byte-for-byte the same serialization the publishers emit
  // (`JSON.stringify(x, null, 2)`), so an amend never shows up as a whitespace diff.
  await r2.putPointer(JSON.stringify(next, null, 2), key, { label: key });
  if (pointer) await r2.putPointer(JSON.stringify(pointer.body, null, 2), pointer.key, { label: pointer.key });
  console.log(`\n✓ Amended ${key}. Page: https://xenostudio.ai/product/${app}/releases`);
  console.log(`  Feed: ${PUBLIC}/${key}`);
  console.log('  The previous object was snapshotted to _snapshots/ — verify it before you walk away.');
}

// Inert on import: on 2026-07-26 a bare `import()` of a sibling script executed it
// and wiped four products' release histories. ESM has no load-without-execute mode.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`\namend-release-entry: REFUSED — ${e.message}`);
    console.error('  Nothing was written.');
    process.exitCode = 1;
  });
}
