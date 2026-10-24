/**
 * XENO MCP `skills_*` — an agent reads the skills pinned to it (docs/AGENT-IDENTITY-SKILLS-CORPUS.md D4).
 *
 * Its brief lists each skill's name and when to use it; when one fits, the agent reads it here. Only the skills pinned
 * to the agent's current version, at the exact version and hash pinned — never another person's library, never a
 * newer version nobody accepted. Read-only: making and changing skills is a person's (skills.js).
 */
import { forAgent } from './skills.js';

export class SkillsMcpError extends Error { constructor(message, code) { super(message); this.name = 'SkillsMcpError'; this.code = code; } }

const ok = (data) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }], structuredContent: typeof data === 'string' ? { text: data } : data });

export const TOOLS = [
  {
    name: 'list', title: 'My skills',
    description: 'The skills you have: each one’s name, when to use it, its version and its files. Takes no arguments.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get', title: 'Read a skill',
    description: 'Read one of your skills by its name (or skl_ id): its SKILL.md, and any other file of it by path. Follow it when it fits what you are doing.',
    inputSchema: { type: 'object', properties: { skill: { type: 'string', description: 'The skill’s name or skl_ id' }, path: { type: 'string', description: 'A file inside the skill; SKILL.md when omitted' } }, required: ['skill'], additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
];

export async function callTool(db, actor, name, args = {}) {
  if (!actor || actor.kind !== 'agent') throw new SkillsMcpError('Skills are read by agents. Sign in as one of your agents to use them.', 'agents_only');
  const mine = await forAgent(db, actor.id);
  if (name === 'list') return ok({ skills: mine.map((s) => ({ id: s.id, name: s.name, description: s.description, version: s.version, files: s.files.map((f) => f.path) })) });
  if (name === 'get') {
    const key = String(args.skill || '').trim();
    const s = mine.find((x) => x.name === key || x.id === key);
    if (!s) throw new SkillsMcpError(`You have no skill called ${key || '(empty)'}. skills_list shows the ones you have.`, 'skill_not_found');
    const path = String(args.path || 'SKILL.md');
    const f = s.files.find((x) => x.path === path);
    if (!f) throw new SkillsMcpError(`${s.name} has no file ${path}. Its files: ${s.files.map((x) => x.path).join(', ')}`, 'file_not_found');
    return ok(`# ${s.name} ${s.version} — ${path}\n\n${f.content}`);
  }
  throw new SkillsMcpError(`Unknown tool ${name}`, 'unknown_tool');
}
