/**
 * XENO-WORKFORCE-01 MKT-04 -- team packages, sold as listing kind `team` (D22).
 *
 *   "Exported team packages include authorized configuration and redistributable dependencies only.
 *    Exclude human corporate memberships, credentials, active sessions, private Soul and
 *    non-redistributable nested agents. Import creates a licensed instance with provenance, not the
 *    seller's corporate team identity."
 *
 * Two acts, each one transaction, each authorized against live ReBAC in that transaction:
 *
 *   exportTeamPackage   a manager of the team's OWNER (the human for a personal team, an `admin` of the
 *                       owning workspace) builds the package from ONE canonical team (D21) and attaches
 *                       it to a draft version of their own `team` listing. The package is BUILT from an
 *                       allowlist -- see buildPackage -- so nothing the source rows carry can leak into it.
 *                       It then travels the existing rails: submit (automated checks), admin review,
 *                       publication. The database refuses to publish a package holding anything else.
 *
 *   importTeamPackage   a buyer with an ACTIVE entitlement to that listing creates, from a PUBLISHED
 *                       version, a NEW team owned by themselves or by a workspace they administer, with
 *                       NEW agents created from the packaged definitions. Nothing is copied from the
 *                       seller's team: not its id, not its creator, not its assignments. The new team is
 *                       in no workspace until its owner assigns it (ASN-04). Provenance comes from the
 *                       marketplace rows the entitlement names, never from the request.
 *
 * "Authorized configuration" means the package describes what the team IS -- the agent definitions and
 * the function each member serves -- and never what it was ALLOWED to do somewhere: assignments, member
 * sets, participations and policies are grants made by one workspace, and a grant does not travel.
 *
 * Agents perform neither act. Export gives a company's team configuration to strangers and import
 * binds a purchase to an owner; both are decisions a person answers for, the same line OWN-05 draws.
 */
import { randomUUID } from 'node:crypto';
import { resolvePrincipal } from './agentIdentity.js';
import { check } from '../utils/authzReBAC.js';
import { authorityTransaction, lockWorkspaceAuthority, operationHash } from './workspaceOperationReceipts.js';
import { normalizeOwnerScope } from './workforceScope.js';

export class TeamPackageError extends Error {
  constructor(code, reason, extra = {}) {
    super(reason);
    this.name = 'TeamPackageError';
    this.code = code;
    this.status = { bad_input: 400, denied: 403, not_found: 404, conflict: 409 }[code] ?? 500;
    this.details = Object.freeze({ schemaVersion: 1, reason, ...extra });
  }
}
const fail = (code, reason, extra) => { throw new TeamPackageError(code, reason, extra); };

export const TEAM_PACKAGE_FORMAT = 'xeno-team-package';

/** Licences whose own terms permit passing a definition on. Mirrors marketplace_licence_redistributable(). */
export const REDISTRIBUTABLE_LICENCES = Object.freeze(new Set([
  'Apache-2.0', 'MIT', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MPL-2.0', 'CC0-1.0', 'CC-BY-4.0', 'Unlicense',
  'LicenseRef-XENO-Marketplace-Redistributable',
]));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, field) => {
  if (typeof value !== 'string' || !UUID.test(value)) fail('bad_input', `invalid_${field}`);
  return value.toLowerCase();
};
const version = (value) => {
  if (typeof value !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$/.test(value)) fail('bad_input', 'invalid_version');
  return value;
};

async function humanActor(db, actorUserId) {
  const principal = await resolvePrincipal(db, actorUserId);
  if (!principal?.usable) fail('denied', 'actor_unavailable');
  if (principal.kind !== 'human') fail('denied', 'team_packages_require_a_human');
  return principal;
}

/** May this human act for this owner scope? A person for themselves; an admin for a workspace. */
async function managesScope(db, actorUserId, scope) {
  if (scope.type === 'user') return scope.id === actorUserId;
  const status = (await db.query('SELECT status FROM workspaces WHERE id=$1 FOR SHARE', [scope.id])).rows[0]?.status;
  if (status !== 'active') return false;
  const verdict = await check(db, { object: `workspace:${scope.id}`, relation: 'admin', subject: `user:${actorUserId}` });
  return verdict.allowed && ['direct', 'role-hierarchy'].includes(verdict.via);
}
const ownerOf = (row) => (row.owner_user_id ? { type: 'user', id: row.owner_user_id } : { type: 'workspace', id: row.owner_workspace_id });

/**
 * The package, from the allowlist and nothing else. Every field is read by NAME from the definition it
 * belongs to and written into a fresh object; no source row, and no field the allowlist does not name,
 * reaches the result.
 *
 * Two different kinds of member, handled differently on purpose:
 *   * a PRINCIPAL membership -- a person, or an agent identity -- is a fact about the seller's company,
 *     not configuration. It is left out, and counted in the seller's report, never in the package.
 *   * an AGENT DEFINITION is configuration, and it goes only if the seller may hand it on. A definition
 *     owned by someone else is not theirs to export; one they imported under terms that do not permit
 *     redistribution is not theirs to resell. Both are EXCLUDED, as MKT-04 says, and each exclusion is
 *     named with its reason in the seller's report. The version is a draft until the seller submits it,
 *     so a team that shrank is submitted knowingly, never discovered by a buyer.
 * An authored definition keeps the licence it declares when that licence is redistributable, so its
 * attribution travels; otherwise it carries none and the version's licence governs, because the seller
 * who wrote it is its licensor.
 */
export function buildPackage(team, members, { versionLicence, owner }) {
  if (typeof versionLicence !== 'string' || !versionLicence.trim()) fail('conflict', 'license_required');
  const definitions = members.filter((m) => m.member_resource_id !== null);
  const principals = members.length - definitions.length;
  const excluded = [];
  const out = [];
  definitions.forEach((m) => {
    const licence = m.license?.identifier ?? null;
    const imported = m.provenance?.source === 'imported';
    const agentOwner = m.owner_user_id ? { type: 'user', id: m.owner_user_id } : { type: 'workspace', id: m.owner_workspace_id };
    if (agentOwner.type !== owner.type || agentOwner.id !== owner.id) { excluded.push({ member: m.name, reason: 'not_the_sellers_agent' }); return; }
    if (!m.content) { excluded.push({ member: m.name, reason: 'no_definition' }); return; }
    if (imported && !REDISTRIBUTABLE_LICENCES.has(licence)) { excluded.push({ member: m.name, reason: 'not_redistributable', license: licence }); return; }
    const content = m.content;
    out.push({
      key: `member-${out.length + 1}`,
      name: String(m.name),
      role: m.role,
      license: REDISTRIBUTABLE_LICENCES.has(licence) ? licence : null,
      definition: {
        instructions: typeof content.instructions === 'string' ? content.instructions : '',
        skills: Array.isArray(content.skills)
          ? content.skills.map((x) => ({ id: String(x.id), version: String(x.version), hash: String(x.hash) })) : [],
        requestedCapabilities: Array.isArray(content.requestedCapabilities) ? content.requestedCapabilities.map(String) : [],
        // NAMES only. A `ref` is an id in the SELLER's vault; it never leaves.
        secretNames: Array.isArray(content.secretReferences) ? content.secretReferences.map((r) => String(r.name)).sort() : [],
      },
    });
  });
  // Nothing left to sell is a refusal, not an empty package.
  if (!out.length) fail('conflict', 'team_has_no_exportable_agents', { excludedMemberships: principals, excluded });
  return {
    package: {
      format: TEAM_PACKAGE_FORMAT, schemaVersion: 1,
      team: { name: String(team.name), description: String(team.description ?? '') },
      members: out,
    },
    excludedMemberships: principals,
    excluded,
  };
}

/** Lock the owner scope, the team and its members, and read what the export may see. */
async function loadTeam(db, teamId) {
  const team = (await db.query(`SELECT * FROM workforce_resources WHERE id=$1 AND kind='team'`, [teamId])).rows[0];
  if (!team) fail('not_found', 'team_not_found');
  return team;
}
async function loadMembers(db, teamId) {
  // The CURRENT definition of each active agent member. Revoked members are history, not configuration.
  return (await db.query(`SELECT m.id AS membership_id, m.role, m.member_resource_id, m.member_principal_id,
      r.name, r.owner_user_id, r.owner_workspace_id, v.content, v.license, v.provenance
    FROM workforce_team_memberships m
    LEFT JOIN workforce_resources r ON r.id = m.member_resource_id
    LEFT JOIN LATERAL (SELECT content, license, provenance FROM workforce_agent_versions
      WHERE resource_id = m.member_resource_id ORDER BY version DESC LIMIT 1) v ON true
    WHERE m.team_id=$1 AND m.state='active'
    ORDER BY m.created_at, m.id`, [teamId])).rows;
}

export function exportTeamPackage(pool, { actorUserId, teamId, listingId, version: requestedVersion, releaseNotes = null }) {
  const actor = uuid(actorUserId, 'actor');
  const team = uuid(teamId, 'team');
  const listing = uuid(listingId, 'listing');
  const v = version(requestedVersion);
  if (releaseNotes !== null && (typeof releaseNotes !== 'string' || releaseNotes.length > 10000)) fail('bad_input', 'invalid_release_notes');
  return authorityTransaction(pool, async (db) => {
    const row = (await db.query(`SELECT owner_user_id, owner_workspace_id FROM workforce_resources WHERE id=$1 AND kind='team'`, [team])).rows[0];
    if (!row) fail('not_found', 'team_not_found');
    const owner = ownerOf(row);
    if (owner.type === 'workspace') await lockWorkspaceAuthority(db, owner.id);
    await db.query('SELECT id FROM workforce_resources WHERE id=$1 FOR SHARE', [team]);
    await humanActor(db, actor);
    // Configuration is authorized for export by whoever may give the TEAM away -- the owner's manager.
    // A workspace editor may build a team; only its admin may hand the configuration to strangers.
    if (!(await managesScope(db, actor, owner))) fail('denied', 'not_the_team_owner_manager');
    const teamRow = await loadTeam(db, team);
    if (teamRow.status !== 'active') fail('conflict', 'team_archived');

    const listingRow = (await db.query(`SELECT l.*, d.user_id AS developer_user_id FROM marketplace_listings l
      LEFT JOIN marketplace_developers d ON d.id = l.developer_id WHERE l.id=$1 FOR UPDATE OF l`, [listing])).rows[0];
    if (!listingRow) fail('not_found', 'listing_not_found');
    if (listingRow.kind !== 'team') fail('bad_input', 'listing_is_not_a_team_listing');
    if (listingRow.developer_user_id !== actor) fail('denied', 'not_your_listing');

    const { package: pkg, excludedMemberships, excluded } = buildPackage(teamRow, await loadMembers(db, team), { versionLicence: listingRow.license, owner });
    const hash = operationHash(pkg);
    if ((await db.query('SELECT 1 FROM marketplace_listing_versions WHERE listing_id=$1 AND version=$2', [listing, v])).rowCount) {
      fail('conflict', 'version_exists');
    }
    const inserted = (await db.query(`INSERT INTO marketplace_listing_versions
        (listing_id, version, release_notes, declared_capabilities, manifest, license, team_package, team_package_hash)
      VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8) RETURNING id, version, license, team_package_hash, created_at`,
    [listing, v, releaseNotes,
      JSON.stringify([...new Set(pkg.members.flatMap((m) => m.definition.requestedCapabilities))].sort()),
      JSON.stringify({ format: TEAM_PACKAGE_FORMAT, schemaVersion: 1, members: pkg.members.length }),
      listingRow.license, JSON.stringify(pkg), hash])).rows[0];
    // The seller's report says what stayed behind; the package itself carries no trace of it.
    return { versionId: inserted.id, version: inserted.version, license: inserted.license, packageHash: hash, package: pkg,
      excluded: { memberships: excludedMemberships, agents: excluded } };
  });
}

/**
 * Import the published package the entitlement buys into a new team owned by `owner`.
 * Idempotent per (entitlement, version, owner): a second import returns the first instance.
 */
export function importTeamPackage(pool, { actorUserId, listingVersionId, owner: requestedOwner, acceptLicense, teamName = null }) {
  const actor = uuid(actorUserId, 'actor');
  const versionId = uuid(listingVersionId, 'listing_version');
  const owner = normalizeOwnerScope(requestedOwner);
  if (teamName !== null && (typeof teamName !== 'string' || !teamName.trim() || Buffer.byteLength(teamName, 'utf8') > 200)) {
    fail('bad_input', 'invalid_team_name');
  }
  return authorityTransaction(pool, async (db) => {
    if (owner.type === 'workspace') await lockWorkspaceAuthority(db, owner.id);
    await humanActor(db, actor);
    if (!(await managesScope(db, actor, owner))) fail('denied', 'cannot_import_into_this_owner');

    const v = (await db.query(`SELECT v.*, l.kind AS listing_kind, l.developer_id FROM marketplace_listing_versions v
      JOIN marketplace_listings l ON l.id = v.listing_id WHERE v.id=$1 FOR SHARE OF v`, [versionId])).rows[0];
    // An unpublished version is the seller's draft: it is not for sale, so it is not found either.
    if (!v || v.listing_kind !== 'team' || v.published_at === null || !v.team_package) fail('not_found', 'team_package_not_found');
    // "A licensed instance": the importer accepts THIS version's licence, by name. Accepting a licence the
    // version does not carry -- or none -- is refused, so no instance exists under terms nobody agreed to.
    if (typeof acceptLicense !== 'string' || acceptLicense !== v.license) fail('conflict', 'license_not_accepted', { license: v.license });

    // The entitlement is the BUYER's -- the actor's own -- and must be live now. A workspace does not
    // buy here; a person does, and places what they bought where they administer.
    const entitlement = (await db.query(`SELECT * FROM marketplace_entitlements WHERE user_id=$1 AND listing_id=$2
      AND status='active' AND (expires_at IS NULL OR expires_at > now()) FOR SHARE`, [actor, v.listing_id])).rows[0];
    if (!entitlement) fail('denied', 'no_active_entitlement');
    // A rental is hosted use of a serving version, "not a downloadable private agent" (MKT-05). Importing
    // would hand a renter a permanent copy of what they only rented.
    if (entitlement.kind === 'rental') fail('denied', 'rental_is_not_an_import');

    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
      [`team-import:${entitlement.id}:${versionId}:${owner.type}:${owner.id}`]);
    const prior = (await db.query(`SELECT * FROM marketplace_team_imports
      WHERE entitlement_id=$1 AND listing_version_id=$2 AND owner_type=$3 AND owner_id=$4`,
    [entitlement.id, versionId, owner.type, owner.id])).rows[0];
    if (prior) return { replayed: true, ...publicImport(prior) };

    const pkg = v.team_package;
    // The stored package is what review saw; re-hash it so a row that drifted cannot be imported.
    if (operationHash(pkg) !== v.team_package_hash) fail('conflict', 'team_package_integrity');

    const ownerCols = [owner.type === 'user' ? owner.id : null, owner.type === 'workspace' ? owner.id : null];
    const teamId = randomUUID();
    await db.query(`INSERT INTO workforce_resources(id,kind,owner_user_id,owner_workspace_id,created_by_user_id,name,description)
      VALUES($1,'team',$2,$3,$4,$5,$6)`, [teamId, ...ownerCols, actor, teamName?.trim() || pkg.team.name, pkg.team.description]);
    const agentIds = [];
    const requiredSecrets = {};
    for (const member of pkg.members) {
      const agentId = randomUUID();
      await db.query(`INSERT INTO workforce_resources(id,kind,owner_user_id,owner_workspace_id,created_by_user_id,name)
        VALUES($1,'agent',$2,$3,$4,$5)`, [agentId, ...ownerCols, actor, member.name]);
      // The definition as sold. Secrets arrive as names with NO binding: the buyer binds their own.
      const content = { instructions: member.definition.instructions, skills: member.definition.skills,
        requestedCapabilities: member.definition.requestedCapabilities, secretReferences: [] };
      const provenance = { source: 'imported', sourceVersion: v.version };
      const license = { identifier: member.license ?? v.license };
      await db.query(`INSERT INTO workforce_agent_versions(resource_id,version,content,content_hash,schema_version,provenance,license,created_by_user_id)
        VALUES($1,1,$2,$3,1,$4,$5,$6)`, [agentId, content, operationHash({ schemaVersion: 1, content, provenance, license }), provenance, license, actor]);
      // A member's function travels with the configuration it describes. Its admission does not: the new
      // team is in no workspace, so nothing is admitted anywhere until the buyer assigns it (ASN-04/05).
      await db.query(`INSERT INTO workforce_team_memberships(team_id,member_resource_id,member_resource_kind,role,created_by_user_id)
        VALUES($1,$2,'agent',$3,$4)`, [teamId, agentId, member.role, actor]);
      agentIds.push(agentId);
      requiredSecrets[agentId] = member.definition.secretNames;
    }
    const record = (await db.query(`INSERT INTO marketplace_team_imports(team_id,listing_id,listing_version_id,package_hash,license,
        entitlement_id,seller_developer_id,imported_by_user_id,owner_type,owner_id,member_agent_ids,required_secrets)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid[],$12::jsonb) RETURNING *`,
    [teamId, v.listing_id, versionId, v.team_package_hash, v.license, entitlement.id, v.developer_id, actor,
      owner.type, owner.id, agentIds, JSON.stringify(requiredSecrets)])).rows[0];
    if (owner.type === 'workspace') {
      await db.query(`INSERT INTO workspace_audit(workspace_id,actor_user_id,action,target,metadata) VALUES($1,$2,'team.imported',$3,$4)`,
        [owner.id, actor, `team:${teamId}`, { schemaVersion: 1, listingVersionId: versionId, packageHash: v.team_package_hash }]);
    }
    return { replayed: false, ...publicImport(record) };
  });
}

function publicImport(row) {
  return {
    importId: row.id, teamId: row.team_id, listingId: row.listing_id, listingVersionId: row.listing_version_id,
    packageHash: row.package_hash, license: row.license, owner: { type: row.owner_type, id: row.owner_id },
    memberAgentIds: row.member_agent_ids, requiredSecrets: row.required_secrets,
    importedAt: row.imported_at.toISOString(),
  };
}

/** The provenance of an imported team, to anyone who may manage its owner. */
export function readTeamImport(pool, { actorUserId, teamId }) {
  const actor = uuid(actorUserId, 'actor');
  const team = uuid(teamId, 'team');
  return authorityTransaction(pool, async (db) => {
    const row = (await db.query('SELECT * FROM marketplace_team_imports WHERE team_id=$1', [team])).rows[0];
    if (!row) fail('not_found', 'team_import_not_found');
    await humanActor(db, actor);
    if (!(await managesScope(db, actor, { type: row.owner_type, id: row.owner_id }))) fail('not_found', 'team_import_not_found');
    return publicImport(row);
  });
}
