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
import { redactSecrets, summarizeRedactions, scanForInjection, blockingFindings, formatFinding } from '@xenosystem/anima-mind';
import { check } from '../utils/authzReBAC.js';

export class SkillError extends Error { constructor(message, code, status = 400, details) { super(message); this.name = 'SkillError'; this.code = code; this.status = status; this.details = details; } }

const PUBLIC_ID = /^skl_[0-9a-f]{32}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SEMVER = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/;
const MAX_FILE = 256 * 1024, MAX_TOTAL = 1024 * 1024, MAX_FILES = 64;

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

/** The files of a version, SKILL.md first; paths are relative, inside the skill, text only and size-capped. */
function normalizeFiles(files) {
  if (!Array.isArray(files) || !files.length) throw new SkillError('A skill needs at least its SKILL.md', 'skill_md_required');
  if (files.length > MAX_FILES) throw new SkillError(`A skill has at most ${MAX_FILES} files`, 'too_many_files');
  const seen = new Set(); let total = 0;
  const out = files.map((f) => {
    const path = String((f && f.path) || '').replace(/\\/g, '/').trim();
    if (!path || path.startsWith('/') || path.split('/').some((seg) => !seg || seg === '..' || seg === '.') || path.length > 200) throw new SkillError(`“${path || '(empty)'}” is not a path inside the skill`, 'invalid_path');
    if (seen.has(path)) throw new SkillError(`${path} is listed twice`, 'duplicate_path');
    seen.add(path);
    if (typeof f.content !== 'string' || f.content.includes('\0')) throw new SkillError(`${path} must be text`, 'not_text');
    const size = Buffer.byteLength(f.content, 'utf8'); total += size;
    if (size > MAX_FILE) throw new SkillError(`${path} is larger than 256 KB`, 'file_too_large');
    return { path, content: f.content };
  });
  if (total > MAX_TOTAL) throw new SkillError('A skill is at most 1 MB', 'skill_too_large');
  const skill = out.find((f) => f.path === 'SKILL.md');
  if (!skill) throw new SkillError('A skill needs a SKILL.md at its top level', 'skill_md_required');
  return [skill, ...out.filter((f) => f !== skill).sort((a, b) => a.path.localeCompare(b.path))];
}

/** The content hash a pin names: SHA-256 over the files in their stored order. */
export const hashOf = (files) => createHash('sha256').update(JSON.stringify(files.map((f) => [f.path, f.content]))).digest('hex');

/** D7: a skill is instructions an agent follows, so it may not carry a secret or try to take the agent over. */
function assertSafe(files) {
  for (const f of files) {
    const r = redactSecrets(f.content);
    if (r.redacted) throw new SkillError(`${f.path} contains what looks like a secret (${summarizeRedactions(r.hits)}). Remove it: a skill is read by every agent that uses it.`, 'skill_has_secret', 422);
  }
  const blocking = blockingFindings(scanForInjection(files[0].content, { source: 'SKILL.md' }));
  if (blocking.length) throw new SkillError('This SKILL.md contains instructions that try to take over the agent using it', 'skill_unsafe', 422, blocking.slice(0, 5).map(formatFinding));
}

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
  if (write && !(await canWrite(db, me, s))) throw new SkillError('Only its owner, or an editor of its workspace, changes this skill', 'not_allowed', 403);
  return s;
}
const humanOnly = (me) => { if (!me || me.kind !== 'human') throw new SkillError('A person makes and changes skills; an agent can only use them', 'not_allowed', 403); };

const shape = (s, v, withFiles = false) => ({
  id: s.public_id, name: s.name, description: s.description,
  owner: s.owner_user_id ? { kind: 'personal' } : { kind: 'workspace', workspaceId: String(s.workspace_id) },
  version: v ? v.version : null, hash: v ? v.content_hash : null, files: v ? (withFiles ? v.files : v.files.map((f) => ({ path: f.path, size: Buffer.byteLength(f.content, 'utf8') }))) : [],
  createdAt: s.created_at, updatedAt: s.updated_at,
});
const latest = async (db, skillId) => {
  const vs = (await db.query('SELECT * FROM skill_versions WHERE skill_id = $1', [skillId])).rows;
  return vs.sort((a, b) => cmpSemver(b.version, a.version))[0] || null;
};

// ───────────────────────────── the library

/** A new skill from its files (or just a SKILL.md), as version 1.0.0 (or the version given). */
export async function create(db, me, { workspaceId = null, files, skillMd, version = '1.0.0' } = {}) {
  humanOnly(me);
  const fs = normalizeFiles(files || [{ path: 'SKILL.md', content: skillMd }]);
  const meta = parseSkillMd(fs[0].content);
  if (!SEMVER.test(String(version))) throw new SkillError('A version is three numbers, like 1.0.0', 'invalid_version');
  assertSafe(fs);
  if (workspaceId && !(await check(db, { object: `workspace:${workspaceId}`, relation: 'editor', subject: `user:${me.id}` })).allowed) throw new SkillError('Only an editor of that workspace adds skills to it', 'not_allowed', 403);
  const publicId = 'skl_' + randomBytes(16).toString('hex');
  try {
    const s = (await db.query(`INSERT INTO skills (public_id, owner_user_id, workspace_id, name, description, created_by_user_id)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`, [publicId, workspaceId ? null : me.id, workspaceId, meta.name, meta.description, me.id])).rows[0];
    const v = (await db.query(`INSERT INTO skill_versions (skill_id, version, files, content_hash, created_by_user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [s.id, version, JSON.stringify(fs), hashOf(fs), me.id])).rows[0];
    return shape(s, v);
  } catch (e) {
    if (e && e.code === '23505') throw new SkillError(`There is already a skill named ${meta.name} here. Publish a new version of it instead.`, 'skill_name_taken', 409);
    throw e;
  }
}

/** A new version: same name, a higher version number, its own hash. Earlier versions stay exactly as they were. */
export async function addVersion(db, me, publicId, { files, skillMd, version } = {}) {
  humanOnly(me);
  const s = await row(db, me, publicId, true);
  const fs = normalizeFiles(files || [{ path: 'SKILL.md', content: skillMd }]);
  const meta = parseSkillMd(fs[0].content);
  if (meta.name !== s.name) throw new SkillError(`A new version keeps the name ${s.name}; a different name is a different skill`, 'skill_renamed');
  const cur = await latest(db, s.id);
  const next = version || (cur ? cur.version.replace(SEMVER, (_, a, b, c) => `${a}.${b}.${Number(c) + 1}`) : '1.0.0');
  if (!SEMVER.test(String(next))) throw new SkillError('A version is three numbers, like 1.0.1', 'invalid_version');
  if (cur && cmpSemver(next, cur.version) <= 0) throw new SkillError(`The new version must be higher than ${cur.version}`, 'version_not_higher', 409);
  assertSafe(fs);
  const hash = hashOf(fs);
  if (cur && cur.content_hash === hash) throw new SkillError('Nothing changed since the last version', 'skill_unchanged', 409);
  const v = (await db.query(`INSERT INTO skill_versions (skill_id, version, files, content_hash, created_by_user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [s.id, next, JSON.stringify(fs), hash, me.id])).rows[0];
  const u = (await db.query('UPDATE skills SET description = $2, updated_at = now() WHERE id = $1 RETURNING *', [s.id, meta.description])).rows[0];
  return shape(u, v);
}

/** The skills this person can use: their own and their workspaces' (or one workspace's), newest first. */
export async function list(db, me, { workspaceId = null } = {}) {
  // the workspaces this person is in (any relation on it, or owning it); canRead below is still the check that decides
  const mine = `(SELECT t.object_id::uuid FROM relationship_tuples t WHERE t.object_type = 'workspace' AND t.subject_type = 'user' AND t.subject_id = $1::text
      UNION SELECT w.id FROM workspaces w WHERE w.owner_user_id = $1)`;
  const rows = (await db.query(`SELECT s.* FROM skills s WHERE s.archived_at IS NULL AND (${workspaceId ? `s.workspace_id = $2 AND s.workspace_id IN ${mine}` : `s.owner_user_id = $1 OR s.workspace_id IN ${mine}`}) ORDER BY s.updated_at DESC LIMIT 500`,
    workspaceId ? [me.id, workspaceId] : [me.id])).rows;
  const out = [];
  for (const s of rows) if (await canRead(db, me, s)) out.push(shape(s, await latest(db, s.id)));
  return out;
}

/** One skill with its files: its latest version, or the version asked for, and the list of versions. */
export async function get(db, me, publicId, { version } = {}) {
  const s = await row(db, me, publicId);
  const vs = (await db.query('SELECT version, content_hash, created_at FROM skill_versions WHERE skill_id = $1', [s.id])).rows.sort((a, b) => cmpSemver(b.version, a.version));
  const v = version ? (await db.query('SELECT * FROM skill_versions WHERE skill_id = $1 AND version = $2', [s.id, String(version)])).rows[0] : await latest(db, s.id);
  if (!v) throw new SkillError('No such version', 'version_not_found', 404);
  return { ...shape(s, v, true), canEdit: await canWrite(db, me, s), versions: vs.map((x) => ({ version: x.version, hash: x.content_hash, createdAt: x.created_at })) };
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
    if (!out.some((x) => x.id === s.public_id)) out.push({ id: s.public_id, version: v.version, hash: v.content_hash });
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
    const x = (await db.query(`SELECT s.public_id, s.name, s.description, v.version, v.content_hash, v.files FROM skills s
        JOIN skill_versions v ON v.skill_id = s.id AND v.version = $2 WHERE s.public_id = $1`, [p.id, p.version])).rows[0];
    if (x && x.content_hash === p.hash) out.push({ id: x.public_id, name: x.name, description: x.description, version: x.version, hash: x.content_hash, files: x.files });
  }
  return out;
}
