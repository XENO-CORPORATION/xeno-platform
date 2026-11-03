/**
 * Would a definition be safe to hand a stranger? One rule for every listing that carries agent definitions
 * (kind `mind` in marketplaceAgentPackages.js, kind `team` in marketplaceTeamPackages.js), because a seller's
 * words become a buyer's system prompt either way.
 *
 * Secret-shaped text is found by Corpus's scanner and take-over instructions by Anima's, never by copies of them.
 * Returns null when it is safe, or { reason, rules? } naming why not. Each caller refuses in its own error type.
 */
import { MIND_FORMAT_VERSION, createMind, serializeMind, validateMindText, scanMind, blockingFindings } from '@xenosystem/anima-mind';
import { scanBytes } from '../vendor/xeno-corpus/corpus-secret-rules.mjs';

/** A persona as it travels: { role, body } with string values, or null when the agent has none. */
export function personaOf(content) {
  const p = content?.persona;
  return p && (p.role || p.body) ? { role: String(p.role || ''), body: String(p.body || '') } : null;
}

export function definitionSafetyFinding(persona, instructions) {
  const text = [persona?.role, persona?.body, instructions].filter(Boolean).join('\n\n');
  const secrets = scanBytes(Buffer.from(text, 'utf8'));
  if (secrets.length) return { reason: 'definition_has_secret', rules: [...new Set(secrets.map((x) => x.rule))].slice(0, 5) };
  const base = createMind({ id: 'listing', name: 'Listing', role: persona?.role || undefined });
  const v = validateMindText(serializeMind({ manifest: { ...base.manifest, xeno_mind_version: MIND_FORMAT_VERSION }, body: { raw: text || base.body.raw, sections: [] } }));
  const unsafe = v.ok ? blockingFindings(scanMind(v.mind)) : [];
  return unsafe.length ? { reason: 'definition_unsafe' } : null;
}
