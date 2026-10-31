/**
 * agentMind.js — an agent's identity as an Anima Mind (docs/AGENT-IDENTITY-SKILLS-CORPUS.md D1).
 *
 * The persona lives in the agent's version (`persona: { role, body }`, workforceAgentRevision.js); this module turns it
 * into and out of a `mind.xeno`, Anima's own file format, with Anima's own parser, serializer and injection scanner —
 * never copies of them. So a Mind written in Anima becomes a XENO agent, and an agent can be taken into Anima.
 *
 *   exportMind  → the agent as mind.xeno text (its current persona; Anima's default body when it has none)
 *   importMind  → validate + scan a mind.xeno, then save its role and body as the agent's next version
 *   briefOf     → exactly what the agent is told before any task: who it is, how to work, its own instructions
 */
import { MIND_FORMAT_VERSION, createMind, serializeMind, validateMindText, scanMind, blockingFindings, formatFinding } from '@xenosystem/anima-mind';
import * as agents from './platformAgents.js';
import { guidanceFor } from './agentGuidance.js';

export class MindError extends Error { constructor(message, code, status = 400, details) { super(message); this.name = 'MindError'; this.code = code; this.status = status; this.details = details; } }

const slug = (s) => String(s || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'agent';

export async function exportMind(db, me, publicId) {
  const a = await agents.get(db, me, publicId);
  const base = createMind({ id: slug(a.name), name: a.name, role: (a.persona && a.persona.role) || a.description || undefined });
  const raw = a.persona && a.persona.body ? a.persona.body : base.body.raw;
  return { filename: `${slug(a.name)}.mind.xeno`,
    text: serializeMind({ manifest: { ...base.manifest, xeno_mind_version: MIND_FORMAT_VERSION }, body: { raw, sections: [] } }) };
}

export async function importMind(db, me, publicId, text) {
  if (typeof text !== 'string' || !text.trim()) throw new MindError('Paste or upload a mind.xeno', 'mind_required');
  if (text.length > 64 * 1024) throw new MindError('A mind.xeno is at most 64 KB', 'mind_too_large');
  const v = validateMindText(text);
  if (!v.ok) throw new MindError('This is not a valid mind.xeno', 'invalid_mind', 400, v.errors.map((e) => String(e.message || e.path || e)).slice(0, 10));
  // a Mind someone else wrote is untrusted text that becomes a system prompt: refuse what Anima itself would refuse
  const blocking = blockingFindings(scanMind(v.mind));
  if (blocking.length) throw new MindError('This Mind contains instructions that try to take over the agent, so it was not imported', 'mind_unsafe', 422, blocking.slice(0, 5).map(formatFinding));
  return agents.update(db, me, publicId, { persona: { role: v.mind.manifest.role || '', body: v.mind.body.raw } });
}

/** What the agent is told before any particular task. A task adds its project's and area's instructions to this. */
export async function briefOf(db, me, publicId) {
  const a = await agents.get(db, me, publicId);
  const g = await guidanceFor(db, {}, a.userId);
  return { layers: g.layers, text: g.text };
}
