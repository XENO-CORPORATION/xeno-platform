/**
 * skills.js — the skills library (docs/AGENT-IDENTITY-SKILLS-CORPUS.md D2/D3/D4/D7, owner 2026-10-24).
 *
 * A skill is the open Agent Skills format every agent CLI already reads: a SKILL.md whose front-matter names it
 * (`name`, lowercase-hyphen, ≤64) and says when to use it (`description`, ≤1024), a body the agent loads only when it
 * decides to use the skill, and optional files beside it. No new format.
 *
 *   - A skill belongs to a person or a workspace (its editors write it, its members use it).
 *   - Every version is immutable and hashed (SHA-256 over its files); an agent version pins {id, version, hash}
 *     (XENO-WORKFORCE-01 OWN-03), so what an agent runs never changes under it.
 *   - Nothing is saved that carries a secret, or a SKILL.md that tries to take over the agent (Anima's own scanners).
 *   - An agent sees only the skills pinned to its current version: their name and description in its brief, the full
 *     text through `skills_get` when it decides to use one.
 */
import { createHash, randomBytes } from 'node:crypto';
import { scanForInjection, blockingFindings } from '@xenosystem/anima-mind';
import { check } from '../utils/authzReBAC.js';
import { bundleDigestOf, fileEntry, sha256Of, sidecarProblems, revisionProblems, verifyBundle, describeBlock, reviewField, detectBundles, MAX_BUNDLE_FILES, MAX_BUNDLE_BYTES } from '../vendor/xeno-corpus/corpus-skill-format.mjs';
import { scanBytes, PER_FILE_RULE_CAP } from '../vendor/xeno-corpus/corpus-secret-rules.mjs';
import { scanFileBytes } from '../vendor/xeno-corpus/corpus-skill-risk.mjs';

export class SkillError extends Error { constructor(message, code, status = 400, details) { super(message); this.name = 'SkillError'; this.code = code; this.status = status; this.details = details; } }

const PUBLIC_ID = /^skl_[0-9a-f]{32}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SEMVER = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;
// XENO Corpus's own bundle limits, from the vendored module (surveySkills reads the same constants): a skill a person keeps
// in Claude Code, Codex or their Corpus is accepted here as it is there. Migration 20261031130000 holds the file count too.
const MAX_FILES = MAX_BUNDLE_FILES, MAX_BUNDLE = MAX_BUNDLE_BYTES;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

// ───────────────────────────── the format

/** SKILL.md front-matter: `name` and `description` (single-line, optionally quoted), the rest is the body. */
export function parseSkillMd(text) {
  const m = String(text || '').replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new SkillError('A SKILL.md starts with front-matter: ---, a name and a description, then ---', 'invalid_skill_md');
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/); if (!kv) continue;
    let v = kv[2].trim(); if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    fm[kv[1]] = v;
  }
  const name = String(fm.name || '').trim(), description = String(fm.description || '').trim();
  if (!NAME.test(name)) throw new SkillError('The skill’s name is lowercase letters, numbers and hyphens, at most 64', 'invalid_skill_name');
  if (!description || description.length > 1024) throw new SkillError('The skill needs a description of at most 1,024 characters: when should an agent use it?', 'invalid_skill_description');
  return { name, description, body: m[2].trim() };
}

/** Text is UTF-8 with no NUL, decoded so that re-encoding gives back the exact bytes (a BOM is kept, not eaten). */
export function asText(buf) {
  let t; try { t = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf); } catch { return null; }
  return t.includes('\0') ? null : t;
}
export const isBinary = (f) => f && typeof f.content !== 'string' && typeof f.sha256 === 'string';
/** A stored file's bytes (text files are their UTF-8; a binary file's come from skill_objects). */
export const sizeOf = (f) => (isBinary(f) ? Number(f.bytes) : Buffer.byteLength(f.content, 'utf8'));

/**
 * The files of a version, SKILL.md first; paths are relative and inside the skill; size-capped. A file arrives as
 *   { path, content }        text typed in the editor
 *   { path, base64 }         the exact bytes of an uploaded file — text if they are UTF-8, otherwise a binary file
 *   { path, sha256 }         a binary file already stored, and only one `reuse` names (a previous version's, a package's)
 * → { files, objects }: the stored list ({ path, content } or { path, sha256, bytes }) and the new bytes to store.
 * The digest of a binary file is always computed here from its bytes; a client never names one it did not send.
 */
async function prepareFiles(db, files, { reuse = new Set() } = {}) {
  if (!Array.isArray(files) || !files.length) throw new SkillError('A skill needs at least its SKILL.md', 'skill_md_required');
  if (files.length > MAX_FILES) throw new SkillError(`A skill has at most ${MAX_FILES} files`, 'too_many_files');
  const seen = new Set(), objects = new Map(); let all = 0;
  const out = [];
  for (const f of files) {
    const path = String((f && f.path) || '').replace(/\\/g, '/').trim();
    if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').some((seg) => !seg || seg === '..' || seg === '.') || path.length > 200) throw new SkillError(`“${path || '(empty)'}” is not a path inside the skill`, 'invalid_path');
    if (seen.has(path)) throw new SkillError(`${path} is listed twice`, 'duplicate_path');
    seen.add(path);
    let entry;
    if (typeof f.content === 'string') {
      if (f.content.includes('\0')) throw new SkillError(`${path} is not text; upload it as a file so its bytes are kept`, 'not_text');
      entry = { path, content: f.content };
    } else if (typeof f.base64 === 'string') {
      if (!B64.test(f.base64) || f.base64.length % 4) throw new SkillError(`${path} did not arrive as base64`, 'invalid_file');
      const buf = Buffer.from(f.base64, 'base64');
      const t = asText(buf);
      if (t !== null) entry = { path, content: t };
      else {
        if (path === 'SKILL.md') throw new SkillError('SKILL.md must be UTF-8 text', 'not_text');
        const digest = sha256Of(buf);
        objects.set(digest, buf);
        entry = { path, sha256: digest, bytes: buf.length };
      }
    } else if (typeof f.sha256 === 'string' && DIGEST.test(f.sha256) && reuse.has(f.sha256)) {
      const o = (await db.query('SELECT size FROM skill_objects WHERE sha256 = $1', [f.sha256])).rows[0];
      if (!o) throw new SkillError(`${path}’s stored bytes are missing`, 'object_missing', 409);
      entry = { path, sha256: f.sha256, bytes: o.size };
    } else throw new SkillError(`${path} has no content`, 'invalid_file');
    all += sizeOf(entry);
    out.push(entry);
  }
  if (all > MAX_BUNDLE) throw new SkillError('A skill is at most 32 MB', 'skill_too_large');
  const skill = out.find((f) => f.path === 'SKILL.md');
  if (!skill || isBinary(skill)) throw new SkillError('A skill needs a SKILL.md at its top level', 'skill_md_required');
  return { files: [skill, ...out.filter((f) => f !== skill).sort((a, b) => a.path.localeCompare(b.path))], objects };
}

/** Write new objects once. The table's CHECK recomputes each digest, so bytes can never sit under another name. */
async function storeObjects(db, objects) {
  for (const [digest, buf] of objects) await db.query('INSERT INTO skill_objects (sha256, bytes, size) VALUES ($1, $2, $3) ON CONFLICT (sha256) DO NOTHING', [digest, buf, buf.length]);
}
const digestsOf = (files) => new Set((files || []).filter(isBinary).map((f) => f.sha256));

/** The content hash a pin names: SHA-256 over the files in their stored order (a binary file by its digest). */
export const hashOf = (files) => createHash('sha256').update(JSON.stringify(files.map((f) => [f.path, isBinary(f) ? f.sha256 : f.content]))).digest('hex');

/** XENO Corpus's bundle digest (D240, vendored code — never re-implemented here): what Corpus and the platform both
 *  call "this exact skill". A text file's entry is computed from its UTF-8 bytes; a binary file's digest was computed
 *  from its bytes when it was stored. Stored beside content_hash until pins move over (expand/contract). */
export const bundleDigestOf_ = (files) => bundleDigestOf(files.map((f) => (isBinary(f) ? { rel: f.path, sha256: f.sha256 } : fileEntry(f.path, Buffer.from(f.content, 'utf8')))));

/** D7: a skill is instructions an agent follows, so it may not carry a secret or try to take the agent over. Text
 *  files are read; a binary file is data no agent follows as instructions, and is listed to the person instead. */
// Instructions an agent reads as prose. A take-over attempt in one of these refuses the skill; the same pattern in a
// script, a lockfile or data is listed for a person to read instead (a lockfile is full of URLs; that is not exfiltration).
const INSTRUCTIONS = /(^|\/)[^/.]+$|\.(md|mdx|markdown|txt|rst)$/i;
/** What a finding means, in words a person reads before deciding (the rule ids are Corpus's and Anima's). */
const WORDS = {
  'fetch-from-ip-or-paste-into-shell': 'downloads code from a bare address or a paste site and runs it',
  'decoded-into-shell': 'decodes hidden code and runs it',
  'reverse-shell': 'opens a remote shell to another machine',
  'crypto-miner': 'runs a cryptocurrency miner',
  'fake-password-prompt': 'asks for your password in a fake dialog',
  'invisible-tag-characters': 'hides instructions in invisible characters',
  'reads-credentials-and-sends': 'reads stored credentials and sends them out',
  'fetch-into-shell': 'downloads code and runs it',
  'reads-credential-store': 'reads stored credentials (keys, cookies, a keychain)',
  'starts-at-login': 'makes something start on its own at login',
  'disables-protection': 'switches off a malware or app-safety protection',
  'trojan-source-bidi': 'contains text that reads differently from how it runs',
  'ships-a-program': 'includes a program nobody can read',
  'ships-an-archive': 'includes an archive with more files inside',
  'bare-ip-url': 'talks to a bare internet address',
  'zero-width-characters': 'contains invisible characters',
  'large-encoded-blob': 'contains a large encoded blob',
  'makes-executable': 'makes a file executable',
};
const says = (x) => (x.check === 'secret' ? `secret-shaped material (${x.rule})` : x.check === 'instructions' ? `instructions that try to steer the agent (${x.rule})` : WORDS[x.rule] || x.rule);
const where = (x) => `${x.file}${x.line ? ':' + x.line : ''}`;

/**
 * Every check a skill gets before it is saved, as one report — nothing is stored and nothing is run:
 *   secret        XENO Corpus's secret gate (D236, vendored corpus-secret-rules.mjs) over every file's bytes
 *   instructions  Anima's take-over scanner over every text file (only instruction files can refuse)
 *   code          XENO Corpus's malicious-skill rules (vendored corpus-skill-risk.mjs): what the files would DO —
 *                 download-and-run, reverse shells, credential theft, miners, programs and archives, hidden text
 * Each finding is { check, level: block | confirm | review, file, line, rule, says } — never the matched text.
 * `objects` holds the bytes of binary files new in this version; a reused one was checked when it was first stored.
 */
export function inspect(allFiles, objects = new Map()) {
  const out = [];
  const push = (x) => out.push({ ...x, says: says(x) });
  for (const f of allFiles) {
    const buf = isBinary(f) ? objects.get(f.sha256) : Buffer.from(f.content, 'utf8');
    if (!buf) continue;
    const perRule = new Map();
    for (const x of scanBytes(buf)) { const n = (perRule.get(x.rule) || 0) + 1; perRule.set(x.rule, n); if (n <= PER_FILE_RULE_CAP) push({ check: 'secret', level: x.severity === 'block' ? 'block' : 'review', file: f.path, line: x.line, rule: x.rule }); }
    for (const x of scanFileBytes(f.path, buf)) push({ check: 'code', level: x.severity, file: f.path, line: x.line, rule: x.rule, category: x.category });
    if (!isBinary(f)) {
      for (const x of blockingFindings(scanForInjection(f.content, { source: f.path }))) {
        const level = INSTRUCTIONS.test(f.path) ? (x.severity === 'dangerous' ? 'block' : 'confirm') : 'review';
        push({ check: 'instructions', level, file: f.path, line: x.line || 0, rule: x.rule || x.id || 'pattern' });
      }
    }
  }
  return { block: out.filter((x) => x.level === 'block'), confirm: out.filter((x) => x.level === 'confirm'), review: out.filter((x) => x.level === 'review') };
}

/**
 * The gate at save. A secret, or anything at block level, refuses the whole skill whatever anyone says. A confirm-level
 * finding refuses until the PERSON has read it and saved anyway (`acknowledge: true`, sent only by a person's own
 * request — GitHub push protection's model); it is then kept with the version, marked acknowledged. Review-level
 * findings are kept with the version (Corpus's reviewField shape) for whoever reads or installs the skill.
 */
function assertSafe(allFiles, objects = new Map(), { acknowledge = false } = {}) {
  const r = inspect(allFiles, objects);
  const secrets = r.block.filter((x) => x.check === 'secret');
  if (secrets.length) throw new SkillError(`This skill was not saved: it contains ${describeBlock(secrets)}. A skill is read by every agent that uses it.`, 'skill_has_secret', 422, secrets.slice(0, 20).map((x) => ({ file: x.file, line: x.line, rule: x.rule })));
  const list = (xs) => xs.slice(0, 12).map((x) => `${where(x)} — ${x.says}`);
  if (r.block.length) throw new SkillError(`This skill was not saved: it ${r.block[0].says} (${where(r.block[0])})${r.block.length > 1 ? ` and ${r.block.length - 1} more` : ''}. No one can save a skill that does this.`, 'skill_unsafe', 422, { findings: list(r.block), items: r.block.slice(0, 20), canAcknowledge: false });
  if (r.confirm.length && !acknowledge) throw new SkillError(`Read this before saving: the skill ${r.confirm[0].says} (${where(r.confirm[0])})${r.confirm.length > 1 ? ` and ${r.confirm.length - 1} more` : ''}. If that is what you meant, save it anyway.`, 'skill_unsafe', 422, { findings: list(r.confirm), items: r.confirm.slice(0, 20), canAcknowledge: true });
  const kept = [...r.confirm.map((x) => ({ ...x, acknowledged: true })), ...r.review];
  const f = reviewField({ review: kept });
  // Corpus's record keeps file, line and rule; ours also says which check, what it means, and whether a person said yes
  if (f.review) f.review = f.review.map((x, i) => ({ ...x, check: kept[i].check, says: kept[i].says, ...(kept[i].acknowledged ? { acknowledged: true } : {}) }));
  return f.review ? f : null;
}

/** Files that can run as code: shown to a person before they install or pin the skill. Never executed here. */
const EXEC_EXT = /\.(sh|bash|zsh|ps1|psm1|bat|cmd|py|js|mjs|cjs|ts|rb|pl|php|exe)$/i;
export const executablesOf = (files) => files.filter((f) => EXEC_EXT.test(f.path) || (!isBinary(f) && /^#!/.test(f.content))).map((f) => f.path);
export { assertSafe, prepareFiles, storeObjects };

const cmpSemver = (a, b) => { const x = a.match(SEMVER).slice(1).map(Number), y = b.match(SEMVER).slice(1).map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

// ───────────────────────────── who may do what

async function canWrite(db, me, s) {
  if (s.owner_user_id) return String(s.owner_user_id) === String(me.id);
  return (await check(db, { object: `workspace:${s.workspace_id}`, relation: 'editor', subject: `user:${me.id}` })).allowed;
}
async function canRead(db, me, s) {
  if (s.owner_user_id) return String(s.owner_user_id) === String(me.id);
  return (await check(db, { object: `workspace:${s.workspace_id}`, relation: 'viewer', subject: `user:${me.id}` })).allowed;
}
async function row(db, me, publicId, write = false) {
  if (!PUBLIC_ID.test(String(publicId || ''))) throw new SkillError('Skill not found', 'skill_not_found', 404);
  const s = (await db.query('SELECT * FROM skills WHERE public_id = $1 AND archived_at IS NULL', [publicId])).rows[0];
  if (!s || !(await canRead(db, me, s))) throw new SkillError('Skill not found', 'skill_not_found', 404);
  if (s.origin_listing_id) { const o = (await db.query('SELECT current_version, slug FROM marketplace_listings WHERE id = $1', [s.origin_listing_id])).rows[0]; if (o) { s.origin_latest = o.current_version; s.origin_slug = o.slug; } }
  if (write && !(await canWrite(db, me, s))) throw new SkillError('Only its owner, or an editor of its workspace, changes this skill', 'not_allowed', 403);
  return s;
}
// a pool hands out one client for the transaction; a client (inside one already) runs it in place
async function withTx(db, fn) {
  if (typeof db.connect !== 'function' || typeof db.release === 'function') return fn(db);
  const c = await db.connect();
  try { await c.query('BEGIN'); const r = await fn(c); await c.query('COMMIT'); return r; }
  catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; }
  finally { c.release(); }
}
const humanOnly = (me) => { if (!me || me.kind !== 'human') throw new SkillError('A person makes and changes skills; an agent can only use them', 'not_allowed', 403); };

const shape = (s, v, withFiles = false) => ({
  id: s.public_id, name: s.name, description: s.description,
  owner: s.owner_user_id ? { kind: 'personal' } : { kind: 'workspace', workspaceId: String(s.workspace_id) },
  // installed from the Marketplace: which listing, the version installed last, and the latest it has published
  origin: s.origin_listing_id ? { listingId: String(s.origin_listing_id), version: s.origin_version, latest: s.origin_latest || null, slug: s.origin_slug || null } : null,
  source: s.source || null,
  review: v && v.review ? v.review : null,
  scripts: v ? executablesOf(v.files) : [],
  version: v ? v.version : null, hash: v ? v.content_hash : null, bundleDigest: v ? v.bundle_digest || bundleDigestOf_(v.files) : null, files: v ? (withFiles ? v.files : v.files.map((f) => ({ path: f.path, size: sizeOf(f), ...(isBinary(f) ? { binary: true } : {}) }))) : [],
  createdAt: s.created_at, updatedAt: s.updated_at,
});
const latest = async (db, skillId) => {
  const vs = (await db.query('SELECT * FROM skill_versions WHERE skill_id = $1', [skillId])).rows;
  return vs.sort((a, b) => cmpSemver(b.version, a.version))[0] || null;
};

// ───────────────────────────── the library

/** A new skill from its files (or just a SKILL.md), as version 1.0.0 (or the version given). */
const TOOLS = new Set(['claude', 'codex', 'agy', 'workspace', 'xeno-cli', 'plugin', 'unknown']);
/** Where a skill a person uploaded came from: the tool whose folder it was in, never a path on their machine. */
const folderSource = (s) => (s && s.kind === 'folder' && TOOLS.has(s.tool) ? { kind: 'folder', tool: s.tool } : null);

export async function create(db, me, { workspaceId = null, files, skillMd, version = '1.0.0', acknowledge = false, source: given = null, as: rename = null } = {}, { source = folderSource(given) } = {}) {
  humanOnly(me);
  const { files: fs, objects } = await prepareFiles(db, files || [{ path: 'SKILL.md', content: skillMd }]);
  const meta = parseSkillMd(fs[0].content);
  if (!SEMVER.test(String(version))) throw new SkillError('A version is three numbers, like 1.0.0', 'invalid_version');
  const review = assertSafe(fs, objects, { acknowledge: acknowledge === true });
  if (workspaceId && !(await check(db, { object: `workspace:${workspaceId}`, relation: 'editor', subject: `user:${me.id}` })).allowed) throw new SkillError('Only an editor of that workspace adds skills to it', 'not_allowed', 403);
  // a second skill with the same name (Claude Code's and Codex's copies differ) goes in under another name; its SKILL.md
  // keeps its own, recorded so later versions of it from the same folder are still recognised as this skill
  const name = rename ? String(rename).trim() : meta.name;
  if (!NAME.test(name)) throw new SkillError('The skill’s name is lowercase letters, numbers and hyphens, at most 64', 'invalid_skill_name');
  const src = name !== meta.name ? { ...(source || { kind: 'upload' }), declaredName: meta.name } : source;
  const publicId = 'skl_' + randomBytes(16).toString('hex');
  try {
    return await withTx(db, async (c) => {
      await storeObjects(c, objects);
      const s = (await c.query(`INSERT INTO skills (public_id, owner_user_id, workspace_id, name, description, created_by_user_id, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [publicId, workspaceId ? null : me.id, workspaceId, name, meta.description, me.id, src ? JSON.stringify(src) : null])).rows[0];
      const v = (await c.query(`INSERT INTO skill_versions (skill_id, version, files, content_hash, created_by_user_id, bundle_digest, review) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [s.id, version, JSON.stringify(fs), hashOf(fs), me.id, bundleDigestOf_(fs), review ? JSON.stringify(review) : null])).rows[0];
      return shape(s, v);
    });
  } catch (e) {
    if (e && e.code === '23505') throw new SkillError(`There is already a skill named ${name} here. Publish a new version of it, or add this one under another name.`, 'skill_name_taken', 409);
    throw e;
  }
}

/** A new version: same name, a higher version number, its own hash. Earlier versions stay exactly as they were. */
export async function addVersion(db, me, publicId, { files, skillMd, version, acknowledge = false } = {}) {
  humanOnly(me);
  const s = await row(db, me, publicId, true);
  // a binary file kept from an earlier version of THIS skill is named by its digest, not uploaded again
  const prior = new Set((await db.query('SELECT files FROM skill_versions WHERE skill_id = $1', [s.id])).rows.flatMap((r) => [...digestsOf(r.files)]));
  const { files: fs, objects } = await prepareFiles(db, files || [{ path: 'SKILL.md', content: skillMd }], { reuse: prior });
  const meta = parseSkillMd(fs[0].content);
  if (meta.name !== s.name && !(s.source && s.source.declaredName === meta.name)) throw new SkillError(`A new version keeps the name ${s.name}; a different name is a different skill`, 'skill_renamed');
  const cur = await latest(db, s.id);
  const next = version || (cur ? cur.version.replace(SEMVER, (_, a, b, c) => `${a}.${b}.${Number(c) + 1}`) : '1.0.0');
  if (!SEMVER.test(String(next))) throw new SkillError('A version is three numbers, like 1.0.1', 'invalid_version');
  if (cur && cmpSemver(next, cur.version) <= 0) throw new SkillError(`The new version must be higher than ${cur.version}`, 'version_not_higher', 409);
  const review = assertSafe(fs, objects, { acknowledge: acknowledge === true });
  const hash = hashOf(fs);
  if (cur && cur.content_hash === hash) throw new SkillError('Nothing changed since the last version', 'skill_unchanged', 409);
  return withTx(db, async (c) => {
    await storeObjects(c, objects);
    const v = (await c.query(`INSERT INTO skill_versions (skill_id, version, files, content_hash, created_by_user_id, bundle_digest, review) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [s.id, next, JSON.stringify(fs), hash, me.id, bundleDigestOf_(fs), review ? JSON.stringify(review) : null])).rows[0];
    const u = (await c.query('UPDATE skills SET description = $2, updated_at = now() WHERE id = $1 RETURNING *', [s.id, meta.description])).rows[0];
    return shape(u, v);
  });
}

/** The skills this person can use: their own and their workspaces' (or one workspace's), newest first. */
export async function list(db, me, { workspaceId = null } = {}) {
  // the workspaces this person is in (any relation on it, or owning it); canRead below is still the check that decides
  const mine = `(SELECT t.object_id::uuid FROM relationship_tuples t WHERE t.object_type = 'workspace' AND t.subject_type = 'user' AND t.subject_id = $1::text
      UNION SELECT w.id FROM workspaces w WHERE w.owner_user_id = $1)`;
  const rows = (await db.query(`SELECT s.*, ol.current_version AS origin_latest, ol.slug AS origin_slug FROM skills s LEFT JOIN marketplace_listings ol ON ol.id = s.origin_listing_id WHERE s.archived_at IS NULL AND (${workspaceId ? `s.workspace_id = $2 AND s.workspace_id IN ${mine}` : `s.owner_user_id = $1 OR s.workspace_id IN ${mine}`}) ORDER BY s.updated_at DESC LIMIT 500`,
    workspaceId ? [me.id, workspaceId] : [me.id])).rows;
  const out = [];
  for (const s of rows) if (await canRead(db, me, s)) out.push(shape(s, await latest(db, s.id)));
  return out;
}

/** One skill with its files: its latest version, or the version asked for, and the list of versions. */
export async function get(db, me, publicId, { version } = {}) {
  const s = await row(db, me, publicId);
  const vs = (await db.query('SELECT version, content_hash, bundle_digest, created_at FROM skill_versions WHERE skill_id = $1', [s.id])).rows.sort((a, b) => cmpSemver(b.version, a.version));
  const v = version ? (await db.query('SELECT * FROM skill_versions WHERE skill_id = $1 AND version = $2', [s.id, String(version)])).rows[0] : await latest(db, s.id);
  if (!v) throw new SkillError('No such version', 'version_not_found', 404);
  return { ...shape(s, v, true), canEdit: await canWrite(db, me, s), versions: vs.map((x) => ({ version: x.version, hash: x.content_hash, bundleDigest: x.bundle_digest, createdAt: x.created_at })) };
}

/**
 * INTERNAL (marketplaceSkillPackages.installSkill): put a Marketplace version into a person's or workspace's library.
 * The first install creates the skill; a later one adds that version to the same skill. Nothing an agent pinned
 * changes: pins name a version, and this only ever adds one. The caller has already checked the entitlement.
 */
export async function installVersion(db, me, { workspaceId = null, files, version, origin, name: rename }) {
  humanOnly(me);
  // a published package names its binary files by digest; their bytes were stored when it was published
  const { files: fs, objects } = await prepareFiles(db, files, { reuse: digestsOf(files) });
  const meta = parseSkillMd(fs[0].content);
  const review = assertSafe(fs, objects);
  await storeObjects(db, objects);
  if (workspaceId && !(await check(db, { object: `workspace:${workspaceId}`, relation: 'editor', subject: `user:${me.id}` })).allowed) throw new SkillError('Only an editor of that workspace adds skills to it', 'not_allowed', 403);
  const own = workspaceId ? ['workspace_id = $1', workspaceId] : ['owner_user_id = $1', me.id];
  const mine = (await db.query(`SELECT * FROM skills WHERE ${own[0]} AND origin_listing_id = $2 AND archived_at IS NULL`, [own[1], origin.listingId])).rows[0];
  const hash = hashOf(fs);
  if (mine) {
    const have = (await db.query('SELECT * FROM skill_versions WHERE skill_id = $1 AND version = $2', [mine.id, version])).rows[0];
    if (!have) await db.query(`INSERT INTO skill_versions (skill_id, version, files, content_hash, created_by_user_id, bundle_digest, review) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [mine.id, version, JSON.stringify(fs), hash, me.id, bundleDigestOf_(fs), review ? JSON.stringify(review) : null]);
    else if (have.content_hash !== hash) throw new SkillError('This library already holds a different version under that number', 'version_conflict', 409);
    const u = (await db.query('UPDATE skills SET origin_version = $2, description = $3, updated_at = now() WHERE id = $1 RETURNING *', [mine.id, version, meta.description])).rows[0];
    return { ...shape(u, (await db.query('SELECT * FROM skill_versions WHERE skill_id = $1 AND version = $2', [mine.id, version])).rows[0]), installed: have ? 'already' : 'updated' };
  }
  const name = rename ? String(rename).trim() : meta.name;
  if (!NAME.test(name)) throw new SkillError('The skill’s name is lowercase letters, numbers and hyphens, at most 64', 'invalid_skill_name');
  try {
    const s = (await db.query(`INSERT INTO skills (public_id, owner_user_id, workspace_id, name, description, created_by_user_id, origin_listing_id, origin_version)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`, ['skl_' + randomBytes(16).toString('hex'), workspaceId ? null : me.id, workspaceId, name, meta.description, me.id, origin.listingId, version])).rows[0];
    const v = (await db.query(`INSERT INTO skill_versions (skill_id, version, files, content_hash, created_by_user_id, bundle_digest, review) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [s.id, version, JSON.stringify(fs), hash, me.id, bundleDigestOf_(fs), review ? JSON.stringify(review) : null])).rows[0];
    return { ...shape(s, v), installed: 'new' };
  } catch (e) {
    if (e && e.code === '23505') throw new SkillError(`Your library already has a skill named ${name}. Install it under another name.`, 'skill_name_taken', 409);
    throw e;
  }
}

/**
 * Import a skill folder from GitHub (a public repo): https://github.com/<owner>/<repo>/tree/<ref>/<path>. Only the GitHub
 * API host is ever fetched, so a link cannot point the server anywhere else; text files only, the same limits and scans
 * as any other skill. It lands as version 1.0.0 in the library, for a person to read before any agent uses it.
 */
export async function importFromGitHub(db, me, { url, workspaceId = null, acknowledge = false } = {}, { fetchImpl = fetch } = {}) {
  humanOnly(me);
  const m = String(url || '').trim().match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/tree\/([A-Za-z0-9_.\/-]+?)\/((?:[^/?#]+\/?)+)$/);
  if (!m) throw new SkillError('Give a link to a skill folder on GitHub, like https://github.com/owner/repo/tree/main/skills/my-skill', 'invalid_github_url');
  const [, owner, repo, ref, dir] = m;
  const files = [];
  const walk = async (path, depth) => {
    if (depth > 4 || files.length > MAX_FILES) return;
    const r = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'xeno-skills-import' } });
    if (!r.ok) throw new SkillError(r.status === 404 ? 'That folder was not found on GitHub (it must be public)' : `GitHub answered ${r.status}`, 'github_unavailable', 502);
    const items = await r.json();
    if (!Array.isArray(items)) throw new SkillError('That link is a file, not a skill folder', 'invalid_github_url');
    for (const it of items) {
      if (it.type === 'dir') await walk(it.path, depth + 1);
      else if (it.type === 'file') {
        if (it.size > MAX_BUNDLE) throw new SkillError(`${it.path} is larger than 32 MB`, 'file_too_large');
        const raw = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/contents/${it.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, { headers: { accept: 'application/vnd.github.raw', 'user-agent': 'xeno-skills-import' } });
        if (!raw.ok) throw new SkillError(`Could not read ${it.path} from GitHub`, 'github_unavailable', 502);
        // the exact bytes: text stays text, an image or a font is stored as it is (never decoded into text)
        const rel = it.path.slice(dir.replace(/\/$/, '').length + 1);
        if (typeof raw.arrayBuffer === 'function') files.push({ path: rel, base64: Buffer.from(await raw.arrayBuffer()).toString('base64') });
        else files.push({ path: rel, content: await raw.text() });
      }
    }
  };
  await walk(dir.replace(/\/$/, ''), 0);
  return create(db, me, { workspaceId, files, acknowledge }, { source: { kind: 'github', url: String(url).trim() } });
}

/** One file of a version as its exact bytes: a text file's UTF-8, a binary file's stored object. */
export async function readFile(db, me, publicId, { version, path } = {}) {
  const s = await row(db, me, publicId);
  const v = version ? (await db.query('SELECT * FROM skill_versions WHERE skill_id = $1 AND version = $2', [s.id, String(version)])).rows[0] : await latest(db, s.id);
  if (!v) throw new SkillError('No such version', 'version_not_found', 404);
  const f = v.files.find((x) => x.path === String(path || 'SKILL.md'));
  if (!f) throw new SkillError(`${s.name} has no file ${path}`, 'file_not_found', 404);
  return { path: f.path, ...(await bytesOf(db, f)) };
}
/** The bytes a stored entry names, verified on the way out (Corpus's readObjectVerified rule). */
export async function bytesOf(db, f) {
  if (!isBinary(f)) return { binary: false, bytes: Buffer.from(f.content, 'utf8') };
  const o = (await db.query('SELECT bytes FROM skill_objects WHERE sha256 = $1', [f.sha256])).rows[0];
  if (!o || sha256Of(o.bytes) !== f.sha256) throw new SkillError(`${f.path}’s stored bytes are missing`, 'object_missing', 500);
  return { binary: true, bytes: o.bytes, sha256: f.sha256 };
}

/**
 * Import ONE skill from a XENO Corpus store (`<corpus>/skills/`), its whole history included. The person picks the
 * folder; their browser sends, for one skill, exactly what Corpus keeps for it:
 *   name        the stored name (`<name>.skill.json`)
 *   sidecar     that file's text            revisions  `<name>.revisions.jsonl`'s text (optional)
 *   files       [{ rel, base64 }]: `<name>/…`, the working copy      objects  [{ sha256, base64 }]: `.objects/<hex>`
 * Nothing the client says is trusted. Corpus's own vendored checks run on the raw bytes — sidecarProblems on the
 * record, revisionProblems on every log line, verifyBundle on the working copy and on every recoverable revision
 * rebuilt from its objects — and ANY problem refuses the whole import (refuse, never redact: Corpus D235). Every
 * version saved here is then re-digested and must equal Corpus's own bundle digest for it, so what lands is provably
 * the same bytes Corpus holds. Recoverable revisions become versions 1.0.0, 1.0.1, … in order, dated as Corpus dated
 * them. Importing the same Corpus skill again adds only the revisions this library does not have yet.
 * A variant (`<name>@<tool>`) is refused for now: which copy an agent uses waits on the owner's call (Corpus D240).
 */
export async function importFromCorpus(db, me, { name, sidecar, revisions = null, files = [], objects = [], workspaceId = null, as: rename = null, acknowledge = false } = {}) {
  humanOnly(me);
  const refuse = (problems) => { throw new SkillError(`This Corpus skill was not imported: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` and ${problems.length - 3} more` : ''}`, 'corpus_invalid', 422, problems.slice(0, 20)); };
  let rec; try { rec = JSON.parse(String(sidecar || '')); } catch { refuse([`${name}.skill.json is not JSON`]); }
  const sp = sidecarProblems(rec, { fileName: `${name}.skill.json` });
  if (sp.length) refuse(sp);
  if (rec.name.includes('@')) throw new SkillError(`${rec.name} is another tool’s copy of ${rec.variantOf}. Which copy an agent uses is not decided yet, so variants are not imported; import ${rec.variantOf} instead.`, 'corpus_variant', 409);
  const log = [];
  String(revisions || '').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    let e; try { e = JSON.parse(line); } catch { refuse([`${name}.revisions.jsonl line ${i + 1} is not JSON`]); }
    const rp = revisionProblems(e); if (rp.length) refuse(rp.map((x) => `revisions line ${i + 1}: ${x}`));
    log.push(e);
  });
  const decode = (b64, what) => { if (typeof b64 !== 'string' || !B64.test(b64) || b64.length % 4) refuse([`${what} did not arrive as base64`]); return Buffer.from(b64, 'base64'); };
  if (!Array.isArray(files) || !Array.isArray(objects) || objects.length > 4096) refuse(['files and objects must be lists']);
  const current = files.map((f) => ({ rel: String(f && f.rel), bytes: decode(f && f.base64, String(f && f.rel)) }));
  const cur = verifyBundle(current, { bundleDigest: rec.bundleDigest, files: rec.files });
  if (!cur.ok) refuse(cur.problems);
  const store = new Map();
  for (const o of objects) {
    const buf = decode(o && o.base64, 'an object');
    if (sha256Of(buf) !== (o && o.sha256)) refuse([`OBJECT_DIGEST_MISMATCH: .objects/${String(o && o.sha256).replace(/^sha256:/, '').slice(0, 12)}`]);
    store.set(o.sha256, buf);
  }
  // every recoverable revision, rebuilt from its objects and verified like the working copy; then the working copy
  const versions = [];
  for (const [i, e] of log.entries()) {
    if (!Array.isArray(e.manifest) || !e.bundleDigest) continue;
    const missing = e.manifest.filter((m) => !store.has(m.sha256)).map((m) => `OBJECT_MISSING: revision ${i + 1} ${m.rel}`);
    if (missing.length) refuse(missing);
    const vb = verifyBundle(e.manifest.map((m) => ({ rel: m.rel, bytes: store.get(m.sha256) })), { bundleDigest: e.bundleDigest, files: e.manifest });
    if (!vb.ok) refuse(vb.problems.map((x) => `revision ${i + 1}: ${x}`));
    if (!versions.length || versions[versions.length - 1].digest !== e.bundleDigest) versions.push({ digest: e.bundleDigest, at: e.at, files: e.manifest.map((m) => ({ rel: m.rel, bytes: store.get(m.sha256) })) });
  }
  if (!versions.length || versions[versions.length - 1].digest !== rec.bundleDigest) versions.push({ digest: rec.bundleDigest, at: log.length ? log[log.length - 1].at : null, files: current });
  if (versions.length > 200) versions.splice(0, versions.length - 200);
  // each version through the platform's own rules, and proven to be Corpus's bytes by its digest
  const prepared = [];
  for (const v of versions) {
    const p = await prepareFiles(db, v.files.map((f) => ({ path: f.rel, base64: Buffer.from(f.bytes).toString('base64') })));
    if (bundleDigestOf_(p.files) !== v.digest) refuse([`SKILL_DIGEST_MISMATCH: stored ${bundleDigestOf_(p.files)}, Corpus ${v.digest}`]);
    const review = assertSafe(p.files, p.objects, { acknowledge: acknowledge === true });
    prepared.push({ ...p, review, meta: parseSkillMd(p.files[0].content), digest: v.digest, at: v.at && Number.isFinite(Date.parse(v.at)) ? new Date(v.at) : null });
  }
  const meta = prepared[prepared.length - 1].meta;
  if (workspaceId && !(await check(db, { object: `workspace:${workspaceId}`, relation: 'editor', subject: `user:${me.id}` })).allowed) throw new SkillError('Only an editor of that workspace adds skills to it', 'not_allowed', 403);
  const source = { kind: 'corpus', name: rec.name, bundleDigest: rec.bundleDigest };
  const own = workspaceId ? ['workspace_id = $1', workspaceId] : ['owner_user_id = $1', me.id];
  try {
    return await withTx(db, async (c) => {
      for (const p of prepared) await storeObjects(c, p.objects);
      let s = (await c.query(`SELECT * FROM skills WHERE ${own[0]} AND archived_at IS NULL AND source->>'kind' = 'corpus' AND source->>'name' = $2 FOR UPDATE`, [own[1], rec.name])).rows[0];
      const fresh = !s;
      if (fresh) {
        const nm = rename ? String(rename).trim() : meta.name;
        if (!NAME.test(nm)) throw new SkillError('The skill’s name is lowercase letters, numbers and hyphens, at most 64', 'invalid_skill_name');
        s = (await c.query(`INSERT INTO skills (public_id, owner_user_id, workspace_id, name, description, created_by_user_id, source)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, ['skl_' + randomBytes(16).toString('hex'), workspaceId ? null : me.id, workspaceId, nm, meta.description, me.id, JSON.stringify(source)])).rows[0];
      }
      const have = (await c.query('SELECT version, bundle_digest, files FROM skill_versions WHERE skill_id = $1', [s.id])).rows;
      const known = new Set(have.map((h) => h.bundle_digest || bundleDigestOf_(h.files)));
      let next = have.length ? have.map((h) => h.version).sort(cmpSemver).pop() : null;
      let added = 0, last = null;
      for (const p of prepared) {
        if (known.has(p.digest)) continue;
        next = next ? next.replace(SEMVER, (_, a, b, x) => `${a}.${b}.${Number(x) + 1}`) : '1.0.0';
        last = (await c.query(`INSERT INTO skill_versions (skill_id, version, files, content_hash, created_by_user_id, bundle_digest, created_at, review)
          VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, now()), $8) RETURNING *`, [s.id, next, JSON.stringify(p.files), hashOf(p.files), me.id, p.digest, p.at, p.review ? JSON.stringify(p.review) : null])).rows[0];
        known.add(p.digest); added++;
      }
      if (added) s = (await c.query('UPDATE skills SET description = $2, source = $3, updated_at = now() WHERE id = $1 RETURNING *', [s.id, meta.description, JSON.stringify(source)])).rows[0];
      return { ...shape(s, last || (await latest(c, s.id))), imported: fresh ? 'new' : added ? 'updated' : 'already', versionsAdded: added };
    });
  } catch (e) {
    if (e && e.code === '23505') throw new SkillError(`There is already a skill named ${rename || meta.name} here. Import it under another name.`, 'skill_name_taken', 409);
    throw e;
  }
}

/** Before saving: every check a skill would get, run on its files, with nothing stored. Same input as create. */
export async function preflight(db, me, { files } = {}) {
  humanOnly(me);
  const { files: fs, objects } = await prepareFiles(db, files);
  const meta = parseSkillMd(fs[0].content);
  const r = inspect(fs, objects);
  const level = r.block.length ? 'block' : r.confirm.length ? 'confirm' : r.review.length ? 'review' : 'clean';
  const strip = (xs) => xs.slice(0, 30).map(({ check: c, level: l, file, line, rule, says: w }) => ({ check: c, level: l, file, line, rule, says: w }));
  return { name: meta.name, level, block: strip(r.block), confirm: strip(r.confirm), review: strip(r.review), scripts: executablesOf(fs) };
}

/**
 * Which skills are in a folder a person picked — one skill, a tool's skills (Claude Code, Codex, agy, XENO CLI, a plugin),
 * a project or repository, or a Corpus store — decided by XENO Corpus's detectBundles (vendored; the same rules
 * surveySkills applies on a disk). The page sends only paths, sizes and each SKILL.md's text; nothing is stored.
 *   entries: [{ rel, bytes, text? }]  → Corpus's result: layout, store, roots, bundles (with declaredName, description), skipped
 */
export function detect(me, { entries = [] } = {}) {
  humanOnly(me);
  if (!Array.isArray(entries) || entries.length > 200_000) throw new SkillError('That folder has too many files to look through (at most 200,000)', 'too_many_files');
  let text = 0;
  const clean = entries.map((e) => {
    const rel = String((e && e.rel) || '');
    const out = { rel, bytes: Math.max(0, Number(e && e.bytes) || 0) };
    // only a SKILL.md's text is read (its front matter decides whether it is a skill); anything else sent is ignored
    if (typeof (e && e.text) === 'string' && /(^|\/)SKILL\.md$/.test(rel)) { text += e.text.length; out.text = e.text; }
    return out;
  });
  if (text > 64 * 1024 * 1024) throw new SkillError('The SKILL.md files in that folder are too large to read at once', 'too_large');
  return detectBundles(clean);
}

/**
 * Before a folder of skills is uploaded, what each one is to THIS library: already here byte for byte, a changed
 * version of a skill here, a name taken by a different skill, or new. The page sends each file's SHA-256 (not its
 * bytes); the bundle digest is computed here with Corpus's own code, so the page never re-implements the rule.
 *   bundles: [{ key, name, files: [{ rel, sha256 }] }]   → [{ key, bundleDigest, status, skill? }]
 */
export async function match(db, me, { workspaceId = null, bundles = [] } = {}) {
  humanOnly(me);
  if (!Array.isArray(bundles) || bundles.length > 1000) throw new SkillError('Give at most 1,000 skills at once', 'invalid_input');
  const mine = (await list(db, me, workspaceId ? { workspaceId } : {})).filter((s) => (workspaceId ? s.owner.kind === 'workspace' : s.owner.kind === 'personal'));
  const digests = new Map();
  for (const s of mine) {
    for (const v of (await db.query('SELECT bundle_digest, files FROM skill_versions sv JOIN skills k ON k.id = sv.skill_id WHERE k.public_id = $1', [s.id])).rows) digests.set(v.bundle_digest || bundleDigestOf_(v.files), s);
  }
  return bundles.map((b) => {
    let bundleDigest = null;
    try {
      if (!Array.isArray(b.files) || !b.files.length || b.files.length > MAX_FILES) throw new Error('files');
      bundleDigest = bundleDigestOf(b.files.map((f) => { if (!DIGEST.test(String(f.sha256))) throw new Error('sha256'); return { rel: String(f.rel), sha256: f.sha256 }; }));
    } catch { return { key: b.key, bundleDigest: null, status: 'invalid' }; }
    const same = digests.get(bundleDigest);
    if (same) return { key: b.key, bundleDigest, status: 'same', skill: { id: same.id, name: same.name, version: same.version } };
    const named = mine.find((s) => s.name === String(b.name || '')) || mine.find((s) => s.source && s.source.declaredName === String(b.name || ''));
    if (named && named.origin) return { key: b.key, bundleDigest, status: 'taken', skill: { id: named.id, name: named.name, version: named.version } };
    if (named) return { key: b.key, bundleDigest, status: 'changed', skill: { id: named.id, name: named.name, version: named.version } };
    return { key: b.key, bundleDigest, status: 'new' };
  });
}

/** Archive: it leaves the library; agents that pinned a version keep working with it. */
export async function archive(db, me, publicId) {
  humanOnly(me);
  const s = await row(db, me, publicId, true);
  await db.query('UPDATE skills SET archived_at = now() WHERE id = $1', [s.id]);
  return { id: s.public_id, archived: true };
}

/** What an agent version pins for these choices: [{ id, version }] → [{ id, version, hash }], each readable by `me`. */
export async function resolvePins(db, me, choices) {
  if (!Array.isArray(choices)) throw new SkillError('Give the skills as a list', 'invalid_skills');
  if (choices.length > 64) throw new SkillError('An agent has at most 64 skills', 'too_many_skills');
  const out = [];
  for (const c of choices) {
    const s = await row(db, me, c && c.id);
    const v = c.version ? (await db.query('SELECT * FROM skill_versions WHERE skill_id = $1 AND version = $2', [s.id, String(c.version)])).rows[0] : await latest(db, s.id);
    if (!v) throw new SkillError(`${s.name} has no version ${c.version}`, 'version_not_found', 404);
    if (!out.some((x) => x.id === s.public_id)) out.push({ id: s.public_id, version: v.version, hash: v.content_hash, bundleDigest: v.bundle_digest || bundleDigestOf_(v.files) });
  }
  return out;
}

// ───────────────────────────── what an agent sees

/** The skills pinned to the agent's current version, with name and description — only pins whose hash still matches. */
export async function forAgent(db, agentUserId) {
  const r = (await db.query(`SELECT v.content->'skills' AS skills FROM agent_identities ai JOIN workforce_agent_versions v ON v.resource_id = ai.workforce_resource_id
     WHERE ai.user_id = $1 ORDER BY v.version DESC LIMIT 1`, [agentUserId])).rows[0];
  const pins = (r && Array.isArray(r.skills) ? r.skills : []).filter((p) => p && PUBLIC_ID.test(String(p.id)));
  const out = [];
  for (const p of pins) {
    const x = (await db.query(`SELECT s.public_id, s.name, s.description, v.version, v.content_hash, v.bundle_digest, v.files FROM skills s
        JOIN skill_versions v ON v.skill_id = s.id AND v.version = $2 WHERE s.public_id = $1`, [p.id, p.version])).rows[0];
    // a pin that names Corpus's digest is held to it too (expand step: both must match while both exist)
    if (x && x.content_hash === p.hash && (!p.bundleDigest || p.bundleDigest === (x.bundle_digest || bundleDigestOf_(x.files)))) out.push({ id: x.public_id, name: x.name, description: x.description, version: x.version, hash: x.content_hash, bundleDigest: x.bundle_digest || bundleDigestOf_(x.files), files: x.files });
  }
  return out;
}

/** Fill Corpus's bundle digest on versions made before it existed (migration 20261030150000 allows exactly this
 *  one write, once, from empty). Idempotent; returns how many it filled. */
export async function backfillBundleDigests(db) {
  const rows = (await db.query('SELECT skill_id, version, files FROM skill_versions WHERE bundle_digest IS NULL')).rows;
  for (const r of rows) await db.query('UPDATE skill_versions SET bundle_digest = $3 WHERE skill_id = $1 AND version = $2 AND bundle_digest IS NULL', [r.skill_id, r.version, bundleDigestOf_(r.files)]);
  return rows.length;
}
