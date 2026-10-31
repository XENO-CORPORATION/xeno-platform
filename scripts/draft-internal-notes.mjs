#!/usr/bin/env node
/**
 * Backfill: draft the staff-only INTERNAL release note for every recorded deploy that has none, from the PRs it
 * shipped (services/releaseInternalNotes.js). Each is marked `drafted_from_history`.
 *
 *   DATABASE_URL=… node scripts/draft-internal-notes.mjs                 # DRY-RUN (default): counts, writes nothing
 *   DATABASE_URL=… node scripts/draft-internal-notes.mjs --confirm       # writes
 *       [--pr-json prs.json]   PR texts from a file ([{number,title,body,url}]) instead of `gh pr list`
 *       [--no-gh]              do not call GitHub at all (notes say the PR text was not collected)
 *
 * Runs on the WORKSTATION (it needs this repo's git history and `gh`); point DATABASE_URL at the database to fill.
 * Idempotent: only deploys with no note are touched, and a second run finds none. Never edits an existing note.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectNoteSources } from './lib/internal-note-sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (k) => argv.includes(k);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function prTexts() {
  if (opt('--pr-json')) return new Map(JSON.parse(readFileSync(opt('--pr-json'), 'utf8')).map((p) => [Number(p.number), p]));
  if (has('--no-gh')) return new Map();
  const r = spawnSync('gh', ['pr', 'list', '--repo', 'XENO-CORPORATION/xeno-platform', '--state', 'merged', '--limit', '5000', '--json', 'number,title,body,url'],
    { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) { console.error(`draft-internal-notes: gh could not list PRs (${String(r.stderr).trim().slice(0, 200)}); drafting without PR text`); return new Map(); }
  return new Map(JSON.parse(r.stdout).map((p) => [Number(p.number), p]));
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pg = (await import('pg')).default;
  const notes = await import('../src/server/services/releaseInternalNotes.js');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const todo = await notes.deploysWithoutNote(pool);
    const texts = todo.some((d) => d.prs.length) ? prTexts() : new Map();
    const c = { deploys: todo.length, recorded: 0, reconstructed: 0, withPrs: 0, prs: 0, prText: 0, migrations: 0, unknownCommit: 0 };
    const known = (s) => !!s && spawnSync('git', ['cat-file', '-e', `${s}^{commit}`], { cwd: ROOT }).status === 0;
    const plan = todo.map((d) => {
      c[d.provenance] = (c[d.provenance] || 0) + 1;
      if (d.prs.length) c.withPrs += 1;
      c.prs += d.prs.length; c.prText += d.prs.filter((n) => texts.has(n)).length; c.migrations += d.migrations.length;
      if (!known(d.sha)) c.unknownCommit += 1;
      return d;
    });
    console.log(`internal release notes to draft from history: ${JSON.stringify(c)}`);
    if (!has('--confirm')) { console.log('DRY-RUN — nothing written. Pass --confirm to draft them.'); return; }
    const n = { drafted: 0, kept: 0 };
    for (const d of plan) {
      const sources = collectNoteSources({ git, prText: (num) => texts.get(num) || null, previousSha: known(d.previousSha) ? d.previousSha : null, sha: d.sha, prs: d.prs, migrations: d.migrations });
      const { action } = await notes.draftForDeploy(pool, d.id, sources, { provenance: 'drafted_from_history' });
      n[action === 'drafted' ? 'drafted' : 'kept'] += 1;
    }
    console.log(`drafted ${n.drafted} internal note(s) from history; ${n.kept} already had one`);
  } finally { await pool.end(); }
}

main().catch((e) => { console.error(`draft-internal-notes: ${e.message}`); process.exit(1); });
