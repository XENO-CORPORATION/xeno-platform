/**
 * Selling one agent, as listing kind `mind` (XENO-WORKFORCE-01 MKT-03, MKT-05, MKT-07, MKT-08).
 *
 *   exportAgentDefinition   someone who manages an agent's owner builds a version of their own `mind` listing from it. Built from an allowlist,
 *                           so nothing the agent's rows carry can leak in. Then the existing rails: submit, checks, a person's review, publication.
 *   markServing             what review approves is also what a rental may run: it sets the reviewed serving material, which nothing did before.
 *   importAgent             a buyer with a live, non-rental entitlement makes a NEW agent from a published version. It carries provenance and the
 *                           licence, which later revisions inherit, so a copy bought under terms that forbid resale can't be sold on.
 *
 * Two ways to sell, and they're different rights (MKT-01). A BUYER gets a copy of the definition and runs it as their own. A RENTER gets neither:
 * the platform runs reviewed serving material plus that renter's own partition (marketplaceRentalPartitions.js), and the seller reads none of it (MKT-08).
 *
 * WHAT NEVER TRAVELS: memory and the Soul (the agent's earned self, D3), credentials, sessions, admissions, grants. Secrets go by name, and the buyer
 * binds their own. A definition holding secret-shaped text, or instructions that try to take over whoever runs them, is refused at build: Corpus's
 * and Anima's own scanners, never copies of them, because a seller's words become a stranger's system prompt.
 *
 * A skill pin travels as an id, version and hash, and the buyer may not hold that skill. So an import leaves it out and reports it: an agent with a
 * skill its owner can't read isn't something to hand over quietly.
 */
import { MIND_FORMAT_VERSION, createMind, serializeMind, validateMindText, scanMind, blockingFindings, composePersonaPrompt } from '@xenosystem/anima-mind';
import * as agents from './platformAgents.js';
import { REDISTRIBUTABLE_LICENCES, humanActor, managesScope } from './marketplaceTeamPackages.js';
import { authorityTransaction, lockWorkspaceAuthority, operationHash } from './workspaceOperationReceipts.js';
import { scanBytes } from '../vendor/xeno-corpus/corpus-secret-rules.mjs';

export const AGENT_PACKAGE_FORMAT = 'xeno-agent-package';
/** A claim older than this belongs to a process that died, so another import may take over. */
const CLAIM_STALE_MS = 10 * 60_000;

export class AgentPackageError extends Error {
  constructor(code, reason, status, extra = {}) { super(reason); this.name = 'AgentPackageError'; this.code = code; this.status = status; this.details = { reason, ...extra }; }
}
const refuse = (code, reason, status = 400, extra) => { throw new AgentPackageError(code, reason, status, extra); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Would running this be safe to hand a stranger? Secret-shaped text, and instructions that try to take the agent over, are refused by the scanners that own those rules. */
function assertSafeToHandOver(persona, instructions) {
  const text = [persona?.role, persona?.body, instructions].filter(Boolean).join('\n\n');
  const secrets = scanBytes(Buffer.from(text, 'utf8'));
  if (secrets.length) refuse('definition_has_secret', 'definition_has_secret', 422, { rules: [...new Set(secrets.map((x) => x.rule))].slice(0, 5) });
  const base = createMind({ id: 'listing', name: 'Listing', role: persona?.role || undefined });
  const v = validateMindText(serializeMind({ manifest: { ...base.manifest, xeno_mind_version: MIND_FORMAT_VERSION }, body: { raw: text || base.body.raw, sections: [] } }));
  const unsafe = v.ok ? blockingFindings(scanMind(v.mind)) : [];
  if (unsafe.length) refuse('definition_unsafe', 'definition_unsafe', 422);
}

/** The package, read by NAME from what it belongs to and written into a fresh object. No field the allowlist doesn't name reaches the result. */
export function buildAgentDefinition(resource, version) {
  if (!version?.content) refuse('no_definition', 'no_definition', 409);
  const c = version.content, licence = version.license?.identifier ?? null;
  // an agent bought under terms that forbid passing it on isn't the seller's to sell
  if (version.provenance?.source === 'imported' && !REDISTRIBUTABLE_LICENCES.has(licence)) refuse('not_redistributable', 'not_redistributable', 409, { license: licence });
  const instructions = typeof c.instructions === 'string' ? c.instructions : '';
  const persona = c.persona && (c.persona.role || c.persona.body) ? { role: String(c.persona.role || ''), body: String(c.persona.body || '') } : null;
  if (!instructions.trim() && !persona) refuse('agent_has_no_definition', 'agent_has_no_definition', 409);
  assertSafeToHandOver(persona, instructions);
  return {
    format: AGENT_PACKAGE_FORMAT, schemaVersion: 1,
    agent: { name: String(resource.name), description: String(resource.description ?? '') },
    persona,
    definition: {
      instructions,
      skills: Array.isArray(c.skills) ? c.skills.map((x) => ({ id: String(x.id), version: String(x.version), hash: String(x.hash) })) : [],
      requestedCapabilities: Array.isArray(c.requestedCapabilities) ? c.requestedCapabilities.map(String) : [],
      // NAMES only: a `ref` is an id in the SELLER's vault, and it never leaves
      secretNames: Array.isArray(c.secretReferences) ? c.secretReferences.map((r) => String(r.name)).sort() : [],
    },
  };
}

export function exportAgentDefinition(pool, { actorUserId, agentId, listing, version, releaseNotes = null }) {
  if (typeof agentId !== 'string' || !agentId) refuse('agent_required', 'agent_required');
  return authorityTransaction(pool, async (db) => {
    const r = (await db.query(`SELECT r.id, r.name, r.description, r.status, r.owner_user_id, r.owner_workspace_id FROM agent_identities ai
        JOIN workforce_resources r ON r.id = ai.workforce_resource_id WHERE ai.public_id = $1 AND ai.status <> 'retired'`, [agentId])).rows[0];
    if (!r) refuse('agent_not_found', 'agent_not_found', 404);
    const owner = r.owner_user_id ? { type: 'user', id: r.owner_user_id } : { type: 'workspace', id: r.owner_workspace_id };
    if (owner.type === 'workspace') await lockWorkspaceAuthority(db, owner.id);
    await humanActor(db, actorUserId);
    // who may give it away is who manages its owner. Someone else's agent reads as absent, not forbidden.
    if (!(await managesScope(db, actorUserId, owner))) refuse('agent_not_found', 'agent_not_found', 404);
    if (r.status !== 'active') refuse('agent_archived', 'agent_archived', 409);
    if (listing.kind !== 'mind') refuse('listing_is_not_a_mind_listing', 'listing_is_not_a_mind_listing');
    const current = (await db.query('SELECT content, license, provenance FROM workforce_agent_versions WHERE resource_id = $1 ORDER BY version DESC LIMIT 1', [r.id])).rows[0];
    const pkg = buildAgentDefinition(r, current);
    if ((await db.query('SELECT 1 FROM marketplace_listing_versions WHERE listing_id = $1 AND version = $2', [listing.id, version])).rowCount) refuse('version_exists', 'version_exists', 409);
    const hash = operationHash(pkg);
    const row = (await db.query(`INSERT INTO marketplace_listing_versions (listing_id, version, release_notes, declared_capabilities, manifest, license, agent_definition, agent_definition_hash)
      VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7::jsonb,$8) RETURNING id, version, license`,
    [listing.id, version, releaseNotes, JSON.stringify([...new Set(pkg.definition.requestedCapabilities)].sort()),
      JSON.stringify({ format: AGENT_PACKAGE_FORMAT, schemaVersion: 1 }), listing.license, JSON.stringify(pkg), hash])).rows[0];
    return { versionId: row.id, version: row.version, license: row.license, definitionHash: hash,
      leftOut: { secretsToBindByBuyer: pkg.definition.secretNames, skillsBuyersMustAdd: pkg.definition.skills.length } };
  });
}

/** What a rental runs: the agent as its persona and instructions compose it, and nothing else of the seller's. */
export function servingMaterialOf(pkg) {
  const who = pkg.persona ? composePersonaPrompt({ manifest: { name: pkg.agent.name, role: pkg.persona.role || undefined }, body: { raw: pkg.persona.body || '' } }) : `You are ${pkg.agent.name}.`;
  return [who, pkg.definition.instructions].filter((x) => x && x.trim()).join('\n\n');
}
/** Approving a version approves what it will serve. Servable only if the listing offers rental: nothing should run hosted that wasn't sold that way. */
export async function markServing(db, versionId, reviewerId) {
  const v = (await db.query('SELECT listing_id, agent_definition FROM marketplace_listing_versions WHERE id = $1', [versionId])).rows[0];
  if (!v?.agent_definition) return false;
  const rents = (await db.query(`SELECT 1 FROM marketplace_listing_pricing WHERE listing_id = $1 AND model = 'rental' AND is_active = true`, [v.listing_id])).rowCount > 0;
  await db.query(`UPDATE marketplace_listing_versions SET serving_material = $2, serving_material_reviewed_at = now(), serving_material_reviewed_by = $3, servable = $4 WHERE id = $1`,
    [versionId, servingMaterialOf(v.agent_definition), reviewerId, rents]);
  return rents;
}

const publicImport = (row) => ({ importId: row.id, listingId: row.listing_id, listingVersionId: row.listing_version_id, license: row.license, agentId: row.agent_public_id, requiredSecrets: row.required_secrets, importedAt: row.imported_at });

/** Claim, make, record. The claim is what stops two imports making two agents, and a failure gives it back. */
export async function importAgent(pool, { actorUserId, listingVersionId, workspaceId = null, acceptLicense }) {
  if (!UUID.test(String(listingVersionId || ''))) refuse('not_found', 'agent_package_not_found', 404);
  if (workspaceId !== null && !UUID.test(String(workspaceId))) refuse('bad_input', 'invalid_workspace');
  const claim = await authorityTransaction(pool, async (db) => {
    await humanActor(db, actorUserId);
    if (workspaceId && !(await managesScope(db, actorUserId, { type: 'workspace', id: workspaceId }))) refuse('denied', 'cannot_import_into_this_workspace', 403);
    const v = (await db.query(`SELECT v.*, l.kind AS listing_kind, l.developer_id, l.summary AS listing_summary FROM marketplace_listing_versions v
      JOIN marketplace_listings l ON l.id = v.listing_id WHERE v.id = $1 FOR SHARE OF v`, [listingVersionId])).rows[0];
    // an unpublished version is the seller's draft: it isn't for sale, so it isn't found either
    if (!v || v.listing_kind !== 'mind' || v.published_at === null || !v.agent_definition) refuse('not_found', 'agent_package_not_found', 404);
    if (typeof acceptLicense !== 'string' || acceptLicense !== v.license) refuse('license_not_accepted', 'license_not_accepted', 409, { license: v.license });
    const entitlement = (await db.query(`SELECT * FROM marketplace_entitlements WHERE user_id = $1 AND listing_id = $2 AND status = 'active' AND (expires_at IS NULL OR expires_at > now()) FOR SHARE`, [actorUserId, v.listing_id])).rows[0];
    if (!entitlement) refuse('no_active_entitlement', 'no_active_entitlement', 403);
    // a rental is hosted use, "not a downloadable private agent" (MKT-05)
    if (entitlement.kind === 'rental') refuse('rental_is_not_an_import', 'rental_is_not_an_import', 403);
    if (operationHash(v.agent_definition) !== v.agent_definition_hash) refuse('definition_integrity', 'definition_integrity', 409);
    const insert = () => db.query(`INSERT INTO marketplace_agent_imports (listing_id, listing_version_id, definition_hash, license, entitlement_id, seller_developer_id, imported_by_user_id, target_workspace_id, required_secrets)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
        ON CONFLICT (entitlement_id, listing_version_id, COALESCE(target_workspace_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING RETURNING *`,
    [v.listing_id, v.id, v.agent_definition_hash, v.license, entitlement.id, v.developer_id, actorUserId, workspaceId, JSON.stringify(v.agent_definition.definition.secretNames)]);
    let row = (await insert()).rows[0];
    if (!row) {
      const prior = (await db.query(`SELECT * FROM marketplace_agent_imports WHERE entitlement_id = $1 AND listing_version_id = $2 AND target_workspace_id IS NOT DISTINCT FROM $3`, [entitlement.id, v.id, workspaceId])).rows[0];
      if (prior?.agent_public_id) return { replayed: true, row: prior };
      if (prior && Date.now() - new Date(prior.imported_at).getTime() < CLAIM_STALE_MS) refuse('import_in_progress', 'import_in_progress', 409);
      await db.query('DELETE FROM marketplace_agent_imports WHERE id = $1', [prior?.id]);
      row = (await insert()).rows[0];
      if (!row) refuse('import_in_progress', 'import_in_progress', 409);
    }
    return { replayed: false, row, pkg: v.agent_definition, version: v.version, license: v.license, summary: v.listing_summary };
  });
  if (claim.replayed) return { replayed: true, skillsLeftOut: 0, ...publicImport(claim.row) };
  const me = { id: actorUserId, kind: 'human' };
  let made = null;
  try {
    const { pkg } = claim;
    made = await agents.create(pool, me, { name: pkg.agent.name, description: String(pkg.agent.description || claim.summary || '').slice(0, 500), instructions: pkg.definition.instructions, workspaceId,
      provenance: { source: 'imported', sourceVersion: claim.version }, license: { identifier: claim.license }, requestedCapabilities: pkg.definition.requestedCapabilities });
    if (pkg.persona) await agents.update(pool, me, made.id, { persona: pkg.persona });
    const row = (await pool.query('UPDATE marketplace_agent_imports SET agent_public_id = $2, imported_at = now() WHERE id = $1 RETURNING *', [claim.row.id, made.id])).rows[0];
    return { replayed: false, skillsLeftOut: pkg.definition.skills.length, ...publicImport(row) };
  } catch (e) {
    if (made) await agents.remove(pool, me, made.id).catch(() => {});
    await pool.query('DELETE FROM marketplace_agent_imports WHERE id = $1', [claim.row.id]).catch(() => {});
    throw e;
  }
}
