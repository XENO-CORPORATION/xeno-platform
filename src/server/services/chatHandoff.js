/**
 * Hand work from a chat to an agent: `@Atlas do X` in the chat composer (owner, 2026-10-16).
 *
 * A handoff is not a new kind of record. It is a task — raised from this chat, filed where the chat lives (its
 * project, or the person's own tasks for a loose chat), delegated to the agent — and, when the person may run the
 * agent and the cloud runner can, a cloud run of that agent on it. So everything the task system already enforces
 * applies unchanged: the agent must be able to see the project, only the person accepts the work, the division
 * boundary holds, and the run bills the person within its budget.
 *
 * The chat only records a HANDLE (the task key) in its turn; the card reads the task live, as the reader.
 */
import * as tasks from './xenoTasks.js';
import * as agents from './platformAgents.js';
import * as cloudRuns from './agentCloudRuns.js';
import { requireResourceRelation, userPrincipal } from './chatProjectAuthority.js';

export class HandoffError extends Error {
  constructor(message, code, status = 400) { super(message); this.code = code; this.status = status; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The first line, as a task title: short, and never empty. */
export function titleOf(prompt) {
  const line = String(prompt || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line.length > 120 ? line.slice(0, 117).trimEnd() + '…' : line;
}

export async function handOff(db, me, conversationId, { agentId, prompt, run = true } = {}, opts = {}) {
  if (!UUID.test(String(conversationId || ''))) throw new HandoffError('Conversation not found', 'conversation_not_found', 404);
  const text = String(prompt || '').trim();
  if (!text) throw new HandoffError('Write what the agent should do', 'prompt_required');
  if (text.length > 20000) throw new HandoffError('The prompt is longer than 20,000 characters', 'prompt_too_long');
  // writing into the chat needs the same right as sending a message in it
  await requireResourceRelation(db, userPrincipal(me.id), 'conversation', conversationId, 'reviewer');
  const convo = (await db.query('SELECT id, project_id, title FROM chat_conversations WHERE id = $1 AND deleted_at IS NULL', [conversationId])).rows[0];
  if (!convo) throw new HandoffError('Conversation not found', 'conversation_not_found', 404);
  const agent = await agents.get(db, me, String(agentId || ''));          // seen by this person, or agent_not_found

  const body = `${text}\n\n— Handed off from the chat "${convo.title || 'Untitled'}" (/workspace/apps/chat/${convo.project_id ? `projects/${convo.project_id}/c/` : ''}${convo.id}).`;
  let task = await tasks.createTask(db, me, { title: titleOf(text), body, source: 'chat', conversationId: convo.id, ...(convo.project_id ? { projectId: convo.project_id } : {}) });
  try { task = await tasks.delegateTask(db, me, task.key, { agentId: agent.userId }); }
  catch (e) {
    // the task stays (it is the person's, filed where the chat lives); the delegation's reason is what they need
    if (e instanceof tasks.TaskError) return { task: { key: task.key, title: task.title, status: task.status }, agent: { id: agent.id, name: agent.name }, delegated: false, reason: e.message, run: null };
    throw e;
  }
  let started = null, runNote = null;
  if (run && agent.rights && (agent.rights.runner || agent.rights.manage)) {
    try { started = await cloudRuns.start(db, me, agent.id, { taskKey: task.key }, opts); }
    catch (e) { if (e instanceof cloudRuns.AgentRunError || e instanceof tasks.TaskError) runNote = e.message; else throw e; }
  } else if (run) runNote = `You can’t run ${agent.name}; it will pick the task up itself.`;
  return {
    task: { key: task.key, title: task.title, status: task.status },
    agent: { id: agent.id, name: agent.name },
    delegated: true,
    run: started ? { id: started.id, state: started.state } : null,
    ...(runNote ? { runNote } : {}),
  };
}
