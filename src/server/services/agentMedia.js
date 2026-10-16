/**
 * agentMedia.js — what a platform agent can MAKE and USE beyond Tasks: Images, Video, Library and Chat (a model
 * call). Each is the SAME service the person's own screens use, called as the agent:
 *
 *   Images, Video  mediaGenerations.js — an agent's generation is always a PROPOSAL (the service forces it). It runs
 *                  only when approved: by its owner on the Generate page as before, or by its DIVISION's agent budget
 *                  when a workspace admin has turned on "approve within budget" (approveWithinBudget below).
 *   Library        libraryAssets.js / chatProjectAuthority.js — the agent reads what its projects hold and what it
 *                  made, and can attach what it made to one of its projects. Nothing else: no person's private files.
 *   Chat           one model call (meterPremiumChat) billed to the agent's owner and logged against its division.
 *
 * Money: the owner pays (billingSubjectFor), exactly as every agent spend already does. The DIVISION BUDGET is a
 * limit on top of that, not a wallet (DIV-07): every agent spend reserves its maximum in agent_spend_log inside the
 * division's lock, and is refused when the division's window would exceed its limit.
 */
import crypto from 'node:crypto';
import { resolvePrincipal } from './agentIdentity.js';
import { userPrincipal, requireResourceRelation, withTransaction, linkAssetToProject } from './chatProjectAuthority.js';
import * as gens from './mediaGenerations.js';
import { generationCatalog, tariffFor } from './mediaGenerationCatalog.js';
import { getAuthorizedLibraryFile } from './libraryAssets.js';
import { retrieveAuthorizedAssetChunks } from './library/assetRetrievalService.js';
import { check } from '../utils/authzReBAC.js';
import { meterPremiumChat } from '../utils/inferenceMeter.js';
import { xenoChatCompletion } from '../utils/xenoChat.js';
import { MICRO_PER_CREDIT } from '../utils/creditLedgerV2.js';
import { estimateChatCostMicro } from '../utils/creditCosts.js';
import { budgetOf, reserve, release, BudgetError } from './divisionAgentBudget.js';
export { budgetOf, setBudget, divisionSpend } from './divisionAgentBudget.js';

export class MediaError extends Error { constructor(message, code, status = 400) { super(message); this.name = 'MediaError'; this.code = code; this.status = status; } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const credits = (micro) => Math.round(Number(micro) / MICRO_PER_CREDIT * 100) / 100;

/** The agent the caller is, with its division and owner. Only an agent uses these tools. */
export async function agentOf(db, actor) {
  if (!actor || actor.kind !== 'agent') throw new MediaError('These tools are for agents', 'agents_only', 403);
  const p = await resolvePrincipal(db, actor.id);
  if (!p || !p.usable) throw new MediaError('This agent cannot act right now', 'agent_unavailable', 403);
  const row = (await db.query(`SELECT o.division_id, d.name AS division_name, d.workspace_id
      FROM agent_identities ai LEFT JOIN workforce_division_ownership o ON o.resource_id = ai.workforce_resource_id
      LEFT JOIN workforce_divisions d ON d.id = o.division_id WHERE ai.user_id = $1`, [actor.id])).rows[0] || {};
  return { id: String(actor.id), ownerId: String(p.owner.id), divisionId: row.division_id ? String(row.division_id) : null, divisionName: row.division_name || null };
}

// the division budget lives in divisionAgentBudget.js (it stays import-free for the workforce graph)

// ───────────────────────────── images and video

const TYPE_FOR = { image: 'image', video: 'video' };

/** The models an agent may generate with, and what one costs at most. */
export async function mediaModels(db, actor, type) {
  await agentOf(db, actor);
  const cat = await generationCatalog();
  const t = cat.types.find((x) => x.type === TYPE_FOR[type]);
  if (!t || !t.available) return { models: [], reason: 'No model is available for this right now' };
  return { models: t.models.map((m) => ({ id: m.id, name: m.name, maxCredits: m.tariff ? m.tariff.maxRetailCredits : null, settings: m.settings || undefined })) };
}

/**
 * Generate an image or a video as the agent. It is a proposal; inside a division budget with "approve within budget"
 * on, it is approved at once on the owner's behalf and its maximum cost is reserved against the division. Otherwise
 * it waits for the owner, and the result says so.
 */
export async function generate(db, actor, type, { prompt, model, settings, projectId, referenceAssetIds, requestKey } = {}, options = {}) {
  const agent = await agentOf(db, actor);
  if (typeof prompt !== 'string' || !prompt.trim()) throw new MediaError('Say what to make in `prompt`', 'invalid_prompt');
  if (projectId && !UUID.test(String(projectId))) throw new MediaError('project_id is a project id', 'invalid_project');
  const cat = await generationCatalog(options.gateway ? { models: options.gateway.models } : {});
  const t = cat.types.find((x) => x.type === TYPE_FOR[type]);
  const chosen = model ? (t && t.models.find((m) => m.id === model)) : (t && t.models[0]);
  if (!chosen) throw new MediaError(model ? `${model} is not a ${type} model you can use. List them with ${type}_list_models.` : `No ${type} model is available right now`, 'model_unavailable', 422);
  const key = requestKey && /^[A-Za-z0-9:_.-]{1,120}$/.test(requestKey) ? `agent:${requestKey}` : `agent:${crypto.randomUUID()}`;
  const input = { type: TYPE_FOR[type], model: chosen.id, prompt: prompt.trim(), settings: settings && typeof settings === 'object' ? settings : {},
    referenceAssetIds: Array.isArray(referenceAssetIds) ? referenceAssetIds.map(String) : [], projectId: projectId || null, conversationId: null, requestKey: key };
  let g;
  try { g = await gens.proposeGeneration(db, agent.id, input, options); } catch (e) { throw asMediaError(e); }
  if (g.state !== 'awaiting_approval') return shape(g, agent);
  const b = await budgetOf(db, agent.divisionId);
  if (!b || !b.autoApprove) return shape(g, agent, { waiting: b ? 'approve_within_budget_off' : 'no_budget' });
  return shape(await approveWithinBudget(db, agent, g, options), agent);
}

/**
 * Approve an agent's proposal on its owner's behalf, inside its division's budget. The quote is re-made for the
 * OWNER (the person who pays), exactly as the owner's own Approve does, so the same verification runs; the only
 * difference is who pressed the button: the budget a workspace admin set.
 */
async function approveWithinBudget(db, agent, g, options) {
  const tariff = (options.tariff || tariffFor)(g.request.type, g.request.model);
  const spend = await withTransaction(db, (tx) => reserve(tx, agent, { kind: g.request.type, ref: `generation:${g.id}`, amountMicro: tariff.maxRetailMicro })).catch((e) => { throw asMediaError(e); });
  try {
    const quote = await gens.quoteGeneration(db, agent.ownerId, g.request, options);
    return await gens.approveGeneration(db, agent.ownerId, g.id, { requestHash: g.requestHash, version: g.version, quoteToken: quote.quoteToken }, options);
  } catch (e) {
    await release(db, spend.id);
    throw asMediaError(e);
  }
}

/** One of the agent's generations: its state, and its files once done. */
export async function getMedia(db, actor, id) {
  const agent = await agentOf(db, actor);
  try { return shape(await gens.getGeneration(db, agent.id, String(id || '')), agent); } catch (e) { throw asMediaError(e); }
}
export async function listMedia(db, actor, type) {
  const agent = await agentOf(db, actor);
  const rows = await gens.listGenerations(db, agent.id, { type: TYPE_FOR[type] || null });
  return rows.slice(0, 30).map((g) => shape(g, agent));
}

// a generation that failed or was cancelled releases what it reserved against the division
export async function settleReservations(db, generationIds) {
  if (!generationIds.length) return;
  await db.query(`UPDATE agent_spend_log l SET state = 'released' FROM media_generations g
    WHERE l.state = 'reserved' AND l.ref = 'generation:' || g.id::text AND g.id = ANY($1::uuid[]) AND g.state IN ('failed', 'cancelled')`, [generationIds]);
}

const SITE = process.env.SITE_URL || 'https://xenosystem.ai';
const WAIT = {
  approve_within_budget_off: 'It is waiting for its owner to approve it on the Generate page. (Its division has a budget, but "approve within budget" is off.)',
  no_budget: 'It is waiting for its owner to approve it on the Generate page. (Its division has no agent budget; a workspace admin can set one to let agents generate without waiting.)',
};
function shape(g, agent, { waiting } = {}) {
  const state = { awaiting_approval: 'waiting_for_approval', queued: 'running', submitting: 'running', running: 'running', reconciling: 'running', importing: 'running', cancel_requested: 'cancelling', succeeded: 'done', failed: 'failed', cancelled: 'cancelled' }[g.state] || g.state;
  return {
    id: g.id, type: g.type, state, model: g.request.model, prompt: g.request.prompt, project_id: g.request.projectId || null,
    max_credits: g.quote ? g.quote.maxRetailCredits : null,
    files: (g.resultAssetIds || []).map((id) => ({ asset_id: id, read_with: 'library_get_file' })),
    ...(state === 'waiting_for_approval' ? { note: WAIT[waiting] || WAIT.no_budget } : {}),
    ...(state === 'running' ? { note: `Check it again with ${g.type}_get in a few seconds.` } : {}),
    ...(g.error ? { error: g.error.code } : {}),
    url: SITE + g.url,
  };
}
function asMediaError(e) {
  if (e instanceof MediaError) return e;
  if (e instanceof BudgetError) return new MediaError(e.message, e.code, e.status);
  const code = e && (e.code || e.message) || 'failed';
  const say = {
    model_unavailable: 'That model is not available right now', invalid_request: 'The request was not valid', unsupported_parameter: 'One of the settings is not supported',
    actor_unavailable: 'This agent cannot act right now', generation_not_found: 'No such generation of yours', request_key_conflict: 'That request key was used for a different request',
    INSUFFICIENT_CREDITS: 'Its owner does not have enough credits for this', QUOTA_EXCEEDED: 'Its owner has used their plan’s allowance for now',
  }[code];
  const status = e && (e.status || e.http) || 400;
  return new MediaError(say || (e && e.message) || 'That did not work', String(code).slice(0, 60), status);
}

// ───────────────────────────── library

/**
 * What the agent can read in the Library: files attached to its projects (searchable), and the files it generated.
 * Never a person's private library — a file is reachable only through a project the agent was given, or because
 * the agent made it.
 */
export async function listFiles(db, actor, { projectId, query, folderId } = {}) {
  const agent = await agentOf(db, actor);
  const p = userPrincipal(agent.id);
  // a Storage folder a task gave it (taskFolders.js): the folder's files and sub-folders, as far as it may open them
  if (folderId) {
    if (!UUID.test(String(folderId))) throw new MediaError('folder is a folder id', 'invalid_folder');
    const f = (await db.query('SELECT id, name, workspace_id FROM storage_folders WHERE id = $1', [folderId])).rows[0];
    const may = f && ((await db.query(`SELECT 1 FROM storage_access WHERE kind = 'folder' AND target_id = $1 AND user_id = $2`, [folderId, agent.id])).rows.length
      || (f.workspace_id && (await check(db, { object: `workspace:${f.workspace_id}`, relation: 'viewer', subject: `user:${agent.id}` })).allowed));
    if (!may) throw new MediaError('No such folder you can open. A task gives you a folder while you work it.', 'folder_not_found', 404);
    const files = (await db.query(`SELECT f.id, f.original_name, f.mime_type, f.file_size, f.created_at FROM storage_item_folders i
        JOIN user_files f ON f.id = i.source_id AND f.deleted_at IS NULL WHERE i.source = 'file' AND i.folder_id = $1 ORDER BY lower(f.original_name) LIMIT 200`, [folderId])).rows;
    const subs = (await db.query('SELECT id, name FROM storage_folders WHERE parent_id = $1 ORDER BY lower(name) LIMIT 100', [folderId])).rows;
    return { folder: { id: String(f.id), name: f.name }, folders: subs.map((x) => ({ id: String(x.id), name: x.name })), files: files.map(fileRow) };
  }
  if (projectId) {
    if (!UUID.test(String(projectId))) throw new MediaError('project_id is a project id', 'invalid_project');
    await requireResourceRelation(db, p, 'project', projectId, 'viewer').catch(() => { throw new MediaError('You are not on that project', 'project_not_yours', 404); });
    if (query && String(query).trim()) {
      const hits = await retrieveAuthorizedAssetChunks(db, { principal: p, projectId, query: String(query).slice(0, 500), limit: 10 });
      const list = Array.isArray(hits) ? hits : (hits && (hits.chunks || hits.results)) || [];
      return { results: list.map((c) => ({ asset_id: c.asset_id || c.assetId, file: c.original_name || c.name || null, excerpt: String(c.content || c.text || '').slice(0, 1200) })) };
    }
    const rows = (await db.query(`SELECT f.id, f.original_name, f.mime_type, f.file_size, f.created_at FROM chat_project_assets a
      JOIN user_files f ON f.id = a.asset_id AND f.deleted_at IS NULL WHERE a.project_id = $1 ORDER BY a.created_at DESC LIMIT 100`, [projectId])).rows;
    return { files: rows.map(fileRow) };
  }
  const projects = (await db.query(`SELECT object_id FROM relationship_tuples WHERE object_type = 'project' AND subject_type = 'user' AND subject_id = $1`, [agent.id])).rows.map((r) => r.object_id);
  const fromProjects = projects.length ? (await db.query(`SELECT DISTINCT ON (f.id) f.id, f.original_name, f.mime_type, f.file_size, f.created_at, a.project_id FROM chat_project_assets a
      JOIN user_files f ON f.id = a.asset_id AND f.deleted_at IS NULL WHERE a.project_id = ANY($1::uuid[]) ORDER BY f.id, a.created_at DESC LIMIT 100`, [projects])).rows : [];
  const made = (await db.query(`SELECT f.id, f.original_name, f.mime_type, f.file_size, f.created_at FROM media_generations g
      JOIN user_files f ON f.id = ANY(g.result_asset_ids) AND f.deleted_at IS NULL WHERE g.actor_user_id = $1 ORDER BY f.created_at DESC LIMIT 50`, [agent.id])).rows;
  return { in_your_projects: fromProjects.map((r) => ({ ...fileRow(r), project_id: String(r.project_id) })), you_made: made.map(fileRow) };
}
const fileRow = (r) => ({ asset_id: String(r.id), name: r.original_name, type: r.mime_type, bytes: Number(r.file_size), created_at: r.created_at });

/** May the agent read this file? Through one of its projects, or because it made it. */
async function readableFile(db, agent, assetId) {
  if (!UUID.test(String(assetId || ''))) throw new MediaError('asset_id is a file id', 'invalid_asset');
  const own = (await db.query(`SELECT owner_user_id FROM media_generations WHERE actor_user_id = $1 AND $2::uuid = ANY(result_asset_ids) LIMIT 1`, [agent.id, assetId])).rows[0];
  const viaProject = (await check(db, { object: `library_asset:${assetId}`, relation: 'viewer', subject: `user:${agent.id}` })).allowed;
  if (!own && !viaProject) throw new MediaError('No such file you can read', 'file_not_found', 404);
  const f = await getAuthorizedLibraryFile(db, own ? userPrincipal(own.owner_user_id) : userPrincipal(agent.id), assetId);
  if (!f) throw new MediaError('No such file you can read', 'file_not_found', 404);
  return f;
}

/** A file's details, its link, and (for text) its content. */
export async function getFile(db, actor, assetId, { maxChars = 20000 } = {}) {
  const agent = await agentOf(db, actor);
  const f = await readableFile(db, agent, assetId);
  const out = { asset_id: String(f.id), name: f.original_name, type: f.mime_type, bytes: Number(f.file_size), url: `${SITE}/workspace/library?sel=${f.id}` };
  if (!f.ingestion_safe) return { ...out, note: 'It is still being checked; its content is not readable yet.' };
  if (/^text\/|json|xml|markdown|csv/i.test(f.mime_type || '')) {
    const text = (await db.query(`SELECT string_agg(c.content, '' ORDER BY c.ordinal) AS t FROM library_asset_chunks c
      JOIN library_asset_ingestions i ON i.id = c.ingestion_id AND i.state = 'ready' WHERE c.asset_id = $1`, [f.id]).catch(() => ({ rows: [{}] }))).rows[0]?.t;
    if (text) return { ...out, content: text.slice(0, maxChars), truncated: text.length > maxChars };
  }
  return out;
}

/** Attach a file the agent made to one of its projects, where the project's people (and agents) can see it. */
export async function attachFile(db, actor, assetId, projectId) {
  const agent = await agentOf(db, actor);
  if (!UUID.test(String(projectId || ''))) throw new MediaError('project_id is a project id', 'invalid_project');
  const made = (await db.query(`SELECT owner_user_id FROM media_generations WHERE actor_user_id = $1 AND $2::uuid = ANY(result_asset_ids) LIMIT 1`, [agent.id, String(assetId || '')])).rows[0];
  if (!made) throw new MediaError('You can only attach files you made', 'not_your_file', 403);
  await requireResourceRelation(db, userPrincipal(agent.id), 'project', projectId, 'editor').catch(() => { throw new MediaError('You cannot add files to that project', 'project_not_yours', 403); });
  try { await linkAssetToProject(db, { principal: userPrincipal(made.owner_user_id), projectId, assetId }); }
  catch { throw new MediaError('That file could not be added to the project', 'attach_failed', 409); }
  return { attached: true, asset_id: String(assetId), project_id: String(projectId) };
}

// ───────────────────────────── chat: one model call

const CHAT_MAX_OUTPUT = 4096;
/** Ask a XENO model one question. Billed to the agent's owner and counted against its division budget. */
export async function ask(db, actor, { prompt, model, system, maxTokens } = {}, options = {}) {
  const agent = await agentOf(db, actor);
  if (typeof prompt !== 'string' || !prompt.trim()) throw new MediaError('Write the question in `prompt`', 'invalid_prompt');
  if (prompt.length > 200_000) throw new MediaError('The prompt is too long (200,000 characters at most)', 'prompt_too_long');
  const m = String(model || process.env.AGENT_CHAT_DEFAULT_MODEL || 'gpt-6.1-sol');
  const cap = Math.min(Math.max(1, Number(maxTokens) || 1024), CHAT_MAX_OUTPUT);
  const messages = [...(system ? [{ role: 'system', content: String(system).slice(0, 20000) }] : []), { role: 'user', content: prompt }];
  // the most this call can cost: what the ledger will hold for it, reserved against the division first
  const est = Math.ceil(prompt.length / 3) + (system ? Math.ceil(String(system).length / 3) : 0);
  const requestId = `agent-ask:${crypto.randomUUID()}`;
  const spend = await withTransaction(db, (tx) => reserve(tx, agent, { kind: 'model', ref: requestId, amountMicro: options.maxMicro ?? estimateMicro(est, cap, m) })).catch((e) => { throw asMediaError(e); });
  const call = options.complete || ((args) => xenoChatCompletion(args));
  try {
    const metered = await (options.meter || meterPremiumChat)(db, agent.id, { model: m, provider: 'xeno', requestId, estInputTokens: est, maxTokens: cap, surface: 'agent_tools',
      run: async ({ maxOutputTokens }) => { const d = await call({ model: m, messages, max_tokens: maxOutputTokens }); return { content: d.choices?.[0]?.message?.content || '', usage: d.usage, model: d.model || m }; } });
    // the division is charged what was actually spent, not the reservation
    await db.query(`INSERT INTO agent_spend_log (agent_user_id, division_id, payer_user_id, kind, ref, amount_micro) VALUES ($1, $2, $3, 'model', $4, $5)`,
      [agent.id, agent.divisionId, agent.ownerId, requestId + ':actual', String(Math.round(metered.costMicro || 0))]);
    await release(db, spend.id);
    return { answer: metered.result.content, model: metered.result.model || m, credits: metered.creditsCharged };
  } catch (e) {
    await release(db, spend.id);
    throw asMediaError(e);
  }
}
// the same estimate the ledger reserves for this call, so the division is never charged less than the wallet holds
const estimateMicro = (inTok, outTok, m) => estimateChatCostMicro(m, { inputTokens: inTok, maxOutputTokens: outTok });
