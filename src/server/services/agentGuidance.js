/**
 * What an agent is told when it works a task — INHERITED, so nobody has to write instructions for it (owner,
 * 2026-10-16: "instructions should be inherited … no need for us to add them, but if we want we could").
 *
 * Layers, broadest first; every layer is the people's own words, already written for something else:
 *   1. XENO's default way of working a task (always present, so an agent with nothing set still behaves);
 *   2. the PROJECT's instructions — the same `custom_instructions` its chats follow;
 *   3. the AREA's standing instruction — the task owner's `areas.<area>.instructions`, the same one area chats use;
 *   4. the AGENT's own instructions, when someone wrote them (its current version).
 * Above all of them, WHO it is: its persona (an Anima Mind, identityOf), when it has one.
 * A narrower layer refines a broader one; none replaces XENO's floor (never accept your own work).
 *
 * One function, used by every place an agent reads a task — the MCP get/claim tools and the cloud run prompt — so
 * a local agent and a cloud run of the same agent are told the same thing.
 */
import { composePersonaPrompt } from '@xenosystem/anima-mind';

const DEFAULT = [
  'Work in small, checkable steps and keep the task updated as you go (report what you are doing; ask when you need a decision, then wait).',
  'When you finish, comment with what you changed and how you checked it, then send the task for review.',
  'You never accept your own work: the person who created the task does.',
  'To ask another agent or a person something, comment on the task and @mention them (for example "@release-bot which files in this folder do you still need?"). They are told, and their answer comes back as a reply you see in list_events.',
].join('\n');
const MAX = 16000;   // a persona can be long; the layers after it still fit

async function projectInstructions(db, projectId) {
  if (!projectId) return '';
  const r = (await db.query('SELECT custom_instructions FROM chat_projects WHERE id = $1 AND is_archived = FALSE', [projectId])).rows[0];
  return String((r && r.custom_instructions) || '').trim();
}
async function areaInstructions(db, ownerUserId, area) {
  if (!ownerUserId || !area) return '';
  const r = (await db.query(`SELECT settings->'areas'->$2->>'instructions' AS t FROM user_settings WHERE user_id = $1`, [ownerUserId, String(area)]).catch(() => ({ rows: [] }))).rows[0];
  return String((r && r.t) || '').trim();
}
/**
 * WHO the agent is (docs/AGENT-IDENTITY-SKILLS-CORPUS.md D1): its current version's persona, composed by Anima's own
 * composePersonaPrompt — never a copy of it — so a Mind reads the same in XENO, in Anima and in every CLI. '' when the
 * agent has no persona: the layers below still tell it how to work.
 */
export async function identityOf(db, agentUserId) {
  if (!agentUserId) return '';
  const r = (await db.query(`SELECT v.content->'persona' AS persona, COALESCE(u.display_name, u.username) AS name FROM agent_identities ai
      JOIN users u ON u.id = ai.user_id JOIN workforce_agent_versions v ON v.resource_id = ai.workforce_resource_id
     WHERE ai.user_id = $1 ORDER BY v.version DESC LIMIT 1`, [agentUserId]).catch(() => ({ rows: [] }))).rows[0];
  const pr = r && r.persona;
  if (!pr || !(pr.role || pr.body)) return '';
  return composePersonaPrompt({ manifest: { name: r.name, role: pr.role || undefined }, body: { raw: String(pr.body || ''), sections: [] } }).trim();
}
async function agentInstructions(db, agentUserId) {
  if (!agentUserId) return '';
  const r = (await db.query(`SELECT v.content->>'instructions' AS t FROM agent_identities ai
      JOIN workforce_agent_versions v ON v.resource_id = ai.workforce_resource_id
     WHERE ai.user_id = $1 ORDER BY v.version DESC LIMIT 1`, [agentUserId]).catch(() => ({ rows: [] }))).rows[0];
  return String((r && r.t) || '').trim();
}

/**
 * The guidance for `agentUserId` working the task row `t` (a tasks row: project_id, effective_area / area,
 * owner_user_id, reporter_id). Returns the layers that apply, each named, plus one joined text for a prompt.
 */
export async function guidanceFor(db, t, agentUserId) {
  const projectId = t.project_id || (t.project && t.project.id) || null;
  const area = t.effective_area || t.area || null;
  // whose area settings: the project's owner for a project task, else the task's owner (a personal task)
  let owner = t.owner_user_id || null;
  if (!owner && !projectId && t.key) { const n = Number(String(t.key).slice(2)); const r = (await db.query('SELECT owner_user_id FROM tasks WHERE number = $1', [n]).catch(() => ({ rows: [] }))).rows[0]; owner = (r && r.owner_user_id) || null; }
  if (projectId) { const p = (await db.query('SELECT COALESCE(owner_user_id, user_id) AS user_id FROM chat_projects WHERE id = $1', [projectId]).catch(() => ({ rows: [] }))).rows[0]; owner = (p && p.user_id) || owner; }
  // who it is comes first: everything after refines how it works, never who it is
  const layers = [];
  const who = await identityOf(db, agentUserId); if (who) layers.push({ from: 'identity', text: who });
  layers.push({ from: 'xeno', text: DEFAULT });
  const proj = await projectInstructions(db, projectId); if (proj) layers.push({ from: 'project', text: proj });
  const ar = await areaInstructions(db, owner, area); if (ar) layers.push({ from: 'area', text: ar });
  const own = await agentInstructions(db, agentUserId); if (own) layers.push({ from: 'agent', text: own });
  // the task's folders: where its inputs are and where results go (taskFolders.js)
  if (Array.isArray(t.folders) && t.folders.length) layers.push({ from: 'folders', text: t.folders.map((f) => `- ${f.name} (folder ${f.id}) — ${f.role === 'editor' ? 'read the inputs here and save your results here' : 'read the inputs here'}`).join('\n') + '\nList and read them with the library tools (library_list_files, library_get_file).' });
  const label = { identity: 'Who you are', xeno: 'How to work a XENO task', project: 'From the project', area: 'From the area', agent: 'Your own instructions', folders: 'This task’s folders in Storage' };
  let text = layers.map((l) => `${label[l.from]}:\n${l.text}`).join('\n\n');
  if (text.length > MAX) text = text.slice(0, MAX) + '\n…';
  return { layers: layers.map((l) => l.from), text };
}

export const _internals = { DEFAULT };
