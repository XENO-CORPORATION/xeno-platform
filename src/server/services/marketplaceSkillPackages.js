/**
 * Skills on the XENO Marketplace (listing kind `skill`; docs/AGENT-IDENTITY-SKILLS-CORPUS.md D3, /isg 2026-10-24).
 *
 * The same rails as team packages (marketplaceTeamPackages.js), for one SKILL.md and its files:
 *
 *   exportSkillPackage  a developer who can CHANGE a skill in their library builds a package from one of its versions and
 *                       attaches it to a draft version of their own `skill` listing. The package is BUILT here from the
 *                       library -- a caller-supplied package is refused -- and scanned again (secrets, take-over
 *                       instructions in any file). It then travels the existing rails: submit (automated checks), admin
 *                       review, publication. The database refuses to publish anything but a well-formed, licensed package.
 *
 *   installSkill        a person with an ACTIVE entitlement puts a PUBLISHED version into their own or a workspace's
 *                       library, scanned again on the way in. The first install creates the skill; a later one adds that
 *                       version. Nothing updates by itself: agents keep the version they pinned until a person moves them.
 *
 * Why these rules (the /isg benchmark): open registries without scanning or identity are how ClawHavoc's malicious skills
 * spread; VS Code's "verified" tick proved only domain ownership; npm and Hugging Face pin exact versions and never
 * update anyone silently. Agents perform neither act.
 */
import * as skills from './skills.js';
import * as svc from './marketplaceService.js';

export class SkillPackageError extends Error {
  constructor(message, code, status = 400, details) { super(message); this.name = 'SkillPackageError'; this.code = code; this.status = status; this.details = details; }
}
export const SKILL_PACKAGE_FORMAT = 'xeno-skill-package';
const SEMVER = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
// a person publishes and installs; an agent or a service never does, whatever else is true
const personOnly = (me) => { if (!me || me.kind !== 'human') throw new SkillPackageError('A person publishes and installs skills; an agent can only use the ones it is given', 'not_allowed', 403); };

/** The package a `skill` version sells: exactly the allowlisted shape marketplace_skill_package_valid() checks. */
export function buildPackage(skill) {
  return { format: SKILL_PACKAGE_FORMAT, schemaVersion: 1, name: skill.name, description: skill.description,
    files: skill.files.map((f) => (skills.isBinary(f) ? { path: f.path, sha256: f.sha256, bytes: f.bytes } : { path: f.path, content: f.content })) };
}

export async function exportSkillPackage(db, me, { listing, skillId, version, releaseNotes = null }) {
  personOnly(me);
  if (!listing || listing.kind !== 'skill') throw new SkillPackageError('Not a skill listing', 'not_a_skill_listing', 400);
  let s;
  try { s = await skills.get(db, me, skillId, { version: version || undefined }); }
  catch (e) { if (e instanceof skills.SkillError) throw new SkillPackageError(e.message, e.code, e.status); throw e; }
  if (!s.canEdit) throw new SkillPackageError('Only someone who can change this skill publishes it', 'not_allowed', 403);
  const files = s.files.map((f) => (skills.isBinary(f) ? { path: f.path, sha256: f.sha256, bytes: f.bytes } : { path: f.path, content: f.content }));
  try { skills.assertSafe(files); } catch (e) { if (e instanceof skills.SkillError) throw new SkillPackageError(e.message, e.code, e.status, e.details); throw e; }
  const pkg = buildPackage({ ...s, files });
  const hash = skills.hashOf(files);
  if (hash !== s.hash) throw new SkillPackageError('The skill’s files do not match its recorded hash', 'hash_mismatch', 409);
  if (!SEMVER.test(s.version)) throw new SkillPackageError('A version is three numbers', 'invalid_version');
  const clash = (await db.query('SELECT 1 FROM marketplace_listing_versions WHERE listing_id = $1 AND version = $2', [listing.id, s.version])).rows[0];
  if (clash) throw new SkillPackageError(`Version ${s.version} is already on this listing. Publish a new version of the skill first.`, 'version_exists', 409);
  const manifest = { name: s.name, scripts: skills.executablesOf(files), files: files.length, sourceSkill: s.id };
  const row = (await db.query(`INSERT INTO marketplace_listing_versions
      (listing_id, version, release_notes, declared_capabilities, manifest, has_native_binary, license, skill_package, skill_package_hash)
     VALUES ($1, $2, $3, '[]'::jsonb, $4::jsonb, false, $5, $6::jsonb, $7) RETURNING id, version, created_at`,
    [listing.id, s.version, releaseNotes ? String(releaseNotes).slice(0, 10000) : null, JSON.stringify(manifest), listing.license || null, JSON.stringify(pkg), hash])).rows[0];
  return { version: { id: row.id, version: row.version, hash, scripts: manifest.scripts, createdAt: row.created_at } };
}

export async function installSkill(db, me, { listingId, versionId = null, workspaceId = null, name = null }) {
  personOnly(me);
  const listing = await svc.getListingById(db, listingId);
  if (!listing || listing.kind !== 'skill' || listing.status !== 'published') throw new SkillPackageError('Skill not found', 'skill_not_found', 404);
  const ent = await svc.getActiveEntitlement(db, me.id, listing.id);
  if (!ent) throw new SkillPackageError('Get this skill first (it is free, or buy it), then install it', 'not_entitled', 402);
  const v = (await db.query(`SELECT * FROM marketplace_listing_versions WHERE listing_id = $1 AND published_at IS NOT NULL AND ${versionId ? 'id = $2' : 'version = $2'}`,
    [listing.id, versionId || listing.current_version])).rows[0];
  if (!v || !v.skill_package) throw new SkillPackageError('That version is not published', 'version_not_found', 404);
  const files = v.skill_package.files;
  if (skills.hashOf(files) !== v.skill_package_hash) throw new SkillPackageError('This version’s files do not match its published hash', 'hash_mismatch', 409);
  try {
    const out = await skills.installVersion(db, me, { workspaceId, files, version: v.version, origin: { listingId: listing.id }, name });
    if (out.installed === 'new') await db.query('UPDATE marketplace_listings SET install_count = install_count + 1 WHERE id = $1', [listing.id]);
    return out;
  } catch (e) { if (e instanceof skills.SkillError) throw new SkillPackageError(e.message, e.code, e.status, e.details); throw e; }
}

/** What a person sees before getting a skill: who publishes it, its versions, its files and which of them are scripts. */
export async function preview(db, listingId) {
  const listing = await svc.getListingById(db, listingId);
  if (!listing || listing.kind !== 'skill' || listing.status !== 'published') throw new SkillPackageError('Skill not found', 'skill_not_found', 404);
  const dev = listing.developer_id ? (await db.query('SELECT display_name, slug, trust_tier FROM marketplace_developers WHERE id = $1', [listing.developer_id])).rows[0] : null;
  const vs = (await db.query(`SELECT id, version, skill_package, skill_package_hash, release_notes, published_at FROM marketplace_listing_versions
     WHERE listing_id = $1 AND published_at IS NOT NULL ORDER BY published_at DESC`, [listing.id])).rows;
  const cur = vs.find((x) => x.version === listing.current_version) || vs[0];
  const pricing = await svc.getPricing(db, listing.id);
  return {
    listing: { id: listing.id, slug: listing.slug, title: listing.title, summary: listing.summary, license: listing.license, trustTier: listing.trust_tier, installCount: Number(listing.install_count || 0),
      publisher: dev ? { name: dev.display_name, handle: dev.slug, trustTier: dev.trust_tier } : null,
      pricing: (pricing || []).map(svc.serializePricing) },
    current: cur ? { id: cur.id, version: cur.version, hash: cur.skill_package_hash, bundleDigest: skills.bundleDigestOf_(cur.skill_package.files), name: cur.skill_package.name, description: cur.skill_package.description,
      skillMd: cur.skill_package.files[0].content, files: cur.skill_package.files.map((f) => f.path), scripts: skills.executablesOf(cur.skill_package.files), releaseNotes: cur.release_notes } : null,
    versions: vs.map((x) => ({ id: x.id, version: x.version, hash: x.skill_package_hash, publishedAt: x.published_at })),
  };
}
