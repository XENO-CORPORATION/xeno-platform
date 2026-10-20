/**
 * XENO Places — the DEVICES in the building: the desk computer, its monitor, and the floor TV.
 *
 *   agentBrief(db, me, placeId, pid)            → who the agent at this desk is, and whether `me` may talk to it
 *   prepareAgentTurn(db, me, placeId, pid, b)   → the body for ONE chat turn with that agent (the caller hands it to
 *                                                 the platform's own /api/ai/chat/stream handler — no second inference path)
 *   computer(db, me, placeId, pid)              → the occupant's live run as their monitor shows it (computerState)
 *   floorBoard(db, me, placeId, divisionId)     → the floor TV: projects, objectives and spend vs budget
 *
 * Every function opens the place through places.get first, so it answers only about people and floors in the
 * viewer's SCOPED snapshot: an agent on a closed floor is "not found", never "you may not see it".
 *
 * Who may do what — each rule is the owning service's own, never restated looser here:
 *   - talk to an agent: the `runner` right on it (platformAgents.getWith), the same right that starts a cloud run.
 *     The turn runs on the TALKER's account (their credits, their model routing) with the agent's current
 *     instructions as the system prompt. The client never supplies those instructions, so a page cannot make an
 *     agent say something it was not told to be.
 *   - the monitor's detail (step, tools, text): the run's owner or a building admin — the rule that already shows a
 *     run's title (places.buildSnapshot). Everyone else sees the status only.
 *   - the floor TV: the division home's scoped read (divisionHome.js), so unseen projects arrive as counts and the
 *     spend ledger stays closed to non-admins; the meter is shown to everyone on the floor.
 */
import * as places from './places.js';
import * as agents from './platformAgents.js';
import { agentsApiBaseUrl, mintDelegatedAccessToken, revokeDelegatedSession } from './marketplaceBroker.js';
import { readScoped } from './scopedReads.js';
import { PLATFORM_DEFAULT_MODEL } from './workspaceArea.js';
import { RUN_ACTOR } from './agentCloudRuns.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE = ['starting', 'queued', 'running'];
const err = (code, reason, message) => ({ ok: false, error: { code, reason, message } });

async function open(db, me, placeId) {
  const r = await places.call(db, me, 'places.get', { placeId });
  if (!r.ok) return r;
  return { ok: true, place: r.result.place, snap: r.result.spec.snap, access: r.result.access };
}
function occupant(o, pid) {
  const p = UUID.test(String(pid || '')) ? o.snap.principals.find((x) => x.id === pid) : null;
  return p || null;
}

async function talkable(db, me, pid) {
  const row = (await db.query('SELECT public_id FROM agent_identities WHERE user_id = $1', [pid])).rows[0];
  if (!row) return null;
  try { return await agents.getWith(db, me, row.public_id, 'runner'); }
  catch (e) { if (e instanceof agents.AgentError) return false; throw e; }
}

export async function agentBrief(db, me, placeId, pid) {
  const o = await open(db, me, placeId); if (!o.ok) return o;
  const p = occupant(o, pid);
  if (!p || !p.isAgent) return err('not_found', 'no_such_agent', 'There is no agent at that desk.');
  const a = await talkable(db, me, pid);
  return { ok: true, result: { principalId: pid, name: p.displayName, canTalk: !!a, agentId: a ? a.id : null,
    model: a ? (a.runtime && a.runtime.model) || PLATFORM_DEFAULT_MODEL : null,
    ...(a ? {} : { reason: 'You can see this agent but not talk to it. Its owner can let you run it.' }) } };
}

const MODEL = /^[A-Za-z0-9._:/-]{1,100}$/;
export async function prepareAgentTurn(db, me, placeId, pid, body = {}) {
  const o = await open(db, me, placeId); if (!o.ok) return o;
  const p = occupant(o, pid);
  if (!p || !p.isAgent) return err('not_found', 'no_such_agent', 'There is no agent at that desk.');
  const a = await talkable(db, me, pid);
  if (!a) return err('denied', 'cannot_talk', 'You can see this agent but not talk to it.');
  const raw = Array.isArray(body.messages) ? body.messages : [];
  if (!raw.length || raw.length > 80) return err('bad_input', 'messages_invalid', 'Send between 1 and 80 messages.');
  const messages = [];
  for (const m of raw) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || m.content.length > 32768) return err('bad_input', 'messages_invalid', 'Each message is a user or assistant turn with text.');
    messages.push({ role: m.role, content: m.content });
  }
  if (messages[messages.length - 1].role !== 'user') return err('bad_input', 'messages_invalid', 'The last message is the person’s.');
  const model = (a.runtime && a.runtime.model) || (typeof body.model === 'string' && MODEL.test(body.model) ? body.model : PLATFORM_DEFAULT_MODEL);
  const systemPrompt = [`You are ${a.name}, a XENO agent working in ${o.place.name}. You are talking with ${me.name || 'a colleague'} at your desk. Answer as ${a.name}.`,
    a.instructions ? `Your instructions:\n${a.instructions}` : ''].filter(Boolean).join('\n\n');
  return { ok: true, result: { agentId: a.id, body: { model, messages, systemPrompt, ...(typeof body.requestId === 'string' && body.requestId.length <= 100 ? { requestId: body.requestId } : {}) } } };
}

/** The monitor, from the run's own event log (xeno-agents-api). Pure: events → what the screen shows. */
export function computerState(events = []) {
  const tools = []; let text = '', needs = null, last = null;
  for (const e of events) {
    const t = String(e.type || ''), pl = e.payload || {};
    last = t;
    if (t === 'tool.started') tools.push({ name: String(pl.toolName || 'tool').slice(0, 60), status: 'running', input: preview(pl.inputPreview) });
    else if (t === 'tool.completed') {
      const open = [...tools].reverse().find((x) => x.status === 'running' && x.name === String(pl.toolName || x.name));
      if (open) { open.status = pl.success === false ? 'failed' : 'completed'; open.output = preview(pl.outputPreview); }
    } else if (t === 'model.text.delta') text += String(pl.text || pl.delta || '');
    else if (t === 'turn.started') text = '';
    else if (/permission\.requested|ask_user\.requested/.test(t)) needs = { kind: t.startsWith('ask_user') ? 'question' : 'permission', what: preview(pl.toolName || pl.question || '') };
    else if (/permission\.(granted|denied|resolved)|ask_user\.(answered|resolved)/.test(t)) needs = null;
    else if (t === 'run.status' && /waiting_for_(permission|user)/.test(String(pl.to || ''))) needs = needs || { kind: String(pl.to).endsWith('user') ? 'question' : 'permission', what: '' };
    else if (t === 'run.status' && pl.to === 'running') needs = null;
  }
  const running = [...tools].reverse().find((x) => x.status === 'running');
  const step = needs ? (needs.kind === 'question' ? 'Waiting for an answer' : 'Waiting for approval')
    : running ? `Using ${running.name}` : last === 'model.text.delta' ? 'Writing' : last === 'turn.completed' ? 'Finished a step' : last ? 'Working' : 'Starting';
  return { step, tools: tools.slice(-12), text: text.slice(-600), needsApproval: needs };
}
function preview(v) {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.replace(/\s+/g, ' ').slice(0, 140);
}

export async function computer(db, me, placeId, pid, { fetchImpl = fetch, env = process.env } = {}) {
  const o = await open(db, me, placeId); if (!o.ok) return o;
  const p = occupant(o, pid);
  if (!p) return err('not_found', 'no_such_occupant', 'Nobody by that id works here.');
  const row = p.isAgent ? (await db.query(`SELECT r.id, r.run_id, r.state, r.owner_user_id, r.created_at, 'T-' || t.number AS task_key, t.title
    FROM agent_cloud_runs r JOIN tasks t ON t.id = r.task_id WHERE r.agent_user_id = $1 AND r.state = ANY($2) ORDER BY r.created_at DESC LIMIT 1`, [pid, LIVE])).rows[0] : null;
  if (!row) return { ok: true, result: { principalId: pid, run: null, step: 'Idle', tools: [], text: '', needsApproval: null, detail: 'none' } };
  const see = o.access.permissions.includes('edit') || String(row.owner_user_id) === String(me.id);
  const run = { id: String(row.id), state: row.state, startedAt: row.created_at, task: see ? row.task_key : null, title: see ? row.title : '' };
  if (!see) return { ok: true, result: { principalId: pid, run, step: 'Working', tools: [], text: '', needsApproval: null, detail: 'closed' } };
  const base = agentsApiBaseUrl(env);
  if (!base || !row.run_id) return { ok: true, result: { principalId: pid, run, ...computerState([]), detail: 'pending' } };
  const { token, sid } = await mintDelegatedAccessToken(db, row.owner_user_id, {
    // the same delegated read agentCloudRuns.refresh makes, recorded against the run it was minted for
    actor: RUN_ACTOR, act: { sub: RUN_ACTOR, agent_run_id: String(row.id) },
    record: (s) => db.query('UPDATE agent_cloud_runs SET delegated_sids = array_append(delegated_sids, $2::uuid) WHERE id = $1', [row.id, s]),
  });
  try {
    let body = null;
    try {
      const res = await fetchImpl(`${base}/runs/${encodeURIComponent(row.run_id)}/events?tail=120`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
      body = res.ok ? await res.json().catch(() => null) : null;
    } catch { body = null; }
    if (!body || !Array.isArray(body.events)) return { ok: true, result: { principalId: pid, run, ...computerState([]), detail: 'unavailable' } };
    return { ok: true, result: { principalId: pid, run, ...computerState(body.events), seq: body.events.length ? body.events[body.events.length - 1].sequence : 0, detail: 'live' } };
  } finally { await revokeDelegatedSession(db, sid); }
}

export async function floorBoard(db, me, placeId, divisionId) {
  const o = await open(db, me, placeId); if (!o.ok) return o;
  const d = o.snap.divisions.find((x) => x.id === divisionId && !x.parentDivisionId);
  if (!d) return err('not_found', 'no_such_floor', 'That floor is not open to you.');
  let r;
  try { r = await readScoped(db, { scope: `division:${divisionId}`, key: 'home', actorUserId: String(me.id) }); }
  catch { return err('unavailable', 'home_unavailable', 'The floor board could not be read just now.'); }
  if (r.state === 'denied' || !r.rows || !r.rows[0]) return err('not_found', 'no_such_floor', 'That floor is not open to you.');
  if (r.state === 'unavailable') return err('unavailable', 'home_unavailable', 'The floor board could not be read just now.');
  const h = r.rows[0];
  return { ok: true, result: {
    divisionId, name: h.name, revision: r.revision,
    projects: { rows: (h.projects.rows || []).map((p) => ({ id: p.id, name: p.name })), hidden: h.projects.hidden || 0 },
    objectives: (h.objectives || []).map((x) => ({ id: x.id, title: x.title, status: x.status, goals: x.goals, goalsDone: x.goalsDone, progress: x.progress, windowEnd: x.windowEnd })),
    spend: { budget: h.spend && h.spend.budget ? h.spend.budget : null },
    runs: { live: (h.runs.rows || []).filter((x) => x.authority && x.authority.state === 'live').length, total: (h.runs.rows || []).length + (h.runs.hidden || 0) },
  } };
}
