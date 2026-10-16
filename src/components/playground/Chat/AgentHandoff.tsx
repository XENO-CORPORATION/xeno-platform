/**
 * `@agent` in the chat: hand the prompt to one of your platform agents (owner, 2026-10-16).
 *
 * Typing `@` lists your agents beside the generate types (Image, Video…). Picking one puts the composer in
 * hand-off mode: the box says who it goes to, and Send hands the prompt over instead of asking the model. The
 * server (services/chatHandoff.js) files a task where this chat lives, delegates it to the agent and starts its
 * cloud run when you may run it. The chat keeps only the task key; the card below reads the task live.
 */
import React, { useEffect, useState } from 'react';
import './agentHandoff.css';
import { generationAuthHeaders } from '@/lib/generations';

export type HandoffAgent = { id: string; name: string; division: string | null; canRun: boolean; presence?: string; canTakeWork?: boolean };
export type HandoffResult = {
  task: { key: string; title: string; status: string };
  agent: { id: string; name: string };
  delegated: boolean; reason?: string; folders?: string[]; folderNote?: string;
  run: { id: string; state: string } | null; runNote?: string;
};

const api = async (method: string, path: string, body?: unknown, signal?: AbortSignal) => {
  const r = await fetch(path, { method, credentials: 'same-origin', signal, headers: { ...generationAuthHeaders(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'The request failed'), { code: j.code, status: r.status });
  return j;
};

let cache: { at: number; list: HandoffAgent[] } | null = null;
/** Your agents, for the @ list. Kept for a minute so typing does not refetch. */
export async function loadHandoffAgents(): Promise<HandoffAgent[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.list;
  const j = await api('GET', '/api/agents');
  const list = (j.agents || []).filter((a: { status?: string; paused?: string }) => a.status !== 'retired' && !a.paused)
    .map((a: { id: string; name: string; division?: { name: string } | null; rights?: { runner?: boolean; manage?: boolean } }) => ({ id: a.id, name: a.name, division: a.division ? a.division.name : null, canRun: !!(a.rights && (a.rights.runner || a.rights.manage)) }));
  // presence (agentPresence.js): who can take work now, so the @ list says it before you hand anything over
  try { const pr = await api('GET', '/api/agents/presence'); const by = new Map((pr.agents || []).map((x: { id: string; label: string; canTakeWork: boolean }) => [x.id, x]));
    for (const a of list) { const x = by.get(a.id) as { label: string; canTakeWork: boolean } | undefined; if (x) { a.presence = x.label; a.canTakeWork = x.canTakeWork; } } } catch { /* the list still works without it */ }
  cache = { at: Date.now(), list };
  return list;
}
export const agentMatches = (list: HandoffAgent[], q: string) => list.filter((a) => !q || a.name.toLowerCase().startsWith(q.toLowerCase()) || a.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q.toLowerCase())));

export type HandoffFolder = { id: string; name: string; path: string; team: string | null };
let folderCache: { at: number; list: HandoffFolder[] } | null = null;
/** Your Storage folders, for `#folder` while handing off (taskFolders.linkableFolders). */
export async function loadHandoffFolders(): Promise<HandoffFolder[]> {
  if (folderCache && Date.now() - folderCache.at < 30_000) return folderCache.list;
  const j = await api('GET', '/api/tasks/folders/linkable');
  folderCache = { at: Date.now(), list: j.folders || [] };
  return folderCache.list;
}
export const folderMatches = (list: HandoffFolder[], q: string) => list.filter((f) => !q || f.name.toLowerCase().startsWith(q.toLowerCase()) || f.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q.toLowerCase())));
/** `#wea` at the caret → the query; null when the caret is not on a #word. */
export function hashQuery(text: string, caret: number): { q: string; start: number } | null {
  const m = text.slice(0, caret).match(/(^|\s)#([^\s#]{0,60})$/);
  return m ? { q: m[2], start: caret - m[2].length - 1 } : null;
}

export const sendHandoff = (conversationId: string, agentId: string, prompt: string, folders: { id: string; role?: string }[] = []): Promise<HandoffResult> =>
  api('POST', `/api/chat/conversations/${encodeURIComponent(conversationId)}/handoff`, { agentId, prompt, ...(folders.length ? { folders } : {}) }).then((j) => j.handoff);

const STATUS: Record<string, string> = { raised: 'Raised', todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', in_review: 'In review', done: 'Done', cancelled: 'Cancelled' };

/** The handoff in the conversation: the task, its live status, and where to follow it. */
export function ChatHandoffCard({ taskKey, agentName }: { taskKey: string; agentName: string }) {
  const [task, setTask] = useState<{ title: string; status: string; delegate?: { name: string } | null; session?: { state?: string; note?: string } | null } | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const c = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try { const j = await api('GET', `/api/tasks/${encodeURIComponent(taskKey)}`, undefined, c.signal); setTask(j.task); if (!['done', 'cancelled'].includes(j.task.status)) timer = setTimeout(load, 15_000); }
      catch (e) { if (c.signal.aborted) return; if ((e as { status?: number }).status === 404) setGone(true); else timer = setTimeout(load, 30_000); }
    };
    void load(); return () => { c.abort(); clearTimeout(timer); };
  }, [taskKey]);
  const open = () => { const path = `/workspace/tasks/${taskKey}`; if (window.parent !== window) window.parent.location.assign(path); else window.location.assign(path); };
  return (
    <div className="chat-handoff" data-chat-handoff={taskKey}>
      <span className="chat-handoff-ic" aria-hidden="true">@</span>
      <div className="chat-handoff-b">
        <small>Handed to <b>{agentName}</b> · {taskKey}</small>
        <b>{gone ? 'Not available — deleted, or not shared with you' : task ? task.title : '…'}</b>
        {task && !gone && <small className="chat-handoff-st" data-status={task.status}>{STATUS[task.status] || task.status}{task.session && task.session.note ? ` — ${task.session.note}` : ''}</small>}
      </div>
      {!gone && <button type="button" className="chat-handoff-open" onClick={open}>Open task</button>}
    </div>
  );
}
