/**
 * The XENO platform capability catalogue — the declaration FORMAT (XENO AGENT CAPABILITY - SPEC.md §19.3).
 *
 * One declaration per capability. Every agent surface is GENERATED from these: the /api/mcp tool list
 * (services/xenoMcp.js), the human catalogue (docs/AGENT-CAPABILITIES.md) and — next — the typed tools in
 * @xenosystem/agent-sdk and the public OpenAPI. A tool written by hand beside the catalogue is a defect.
 *
 *   {
 *     name:        'tasks.task.create',      // §3 canonical <division>.<domain>.<verb>; lowercase snake segments, no `__`
 *     version:     '1.0.0',                  // semver of THIS capability's contract
 *     division:    'tasks',                  // owning division (== first segment)
 *     title:       'Raise a task',
 *     description: '…',                      // written for a MODEL: when to use it AND when not
 *     input:       { JSON Schema object },   // arguments
 *     reply:       { JSON Schema object },   // §11.1 the fields of `data` and what they mean
 *     class:       'safe' | 'undoable' | 'irreversible',          // §4
 *     mode:        'always' | 'on-screen-only' | 'headless-only', // §12.2a (platform capabilities are 'always')
 *     provenance:  'trusted' | 'untrusted',  // §5: does the reply carry user/third-party content?
 *     permission:  'tasks.task.create',      // §19.3 rule 3: one ReBAC relation per capability (defaults to name)
 *     cost:        { model: 'free' | 'fixed' | 'metered' | 'quoted', note? },
 *     idempotency: { strategy: 'key', key: '<input property>' }   // the caller's own key
 *                | { strategy: 'natural', note }                  // repeating it is harmless by construction
 *                | { strategy: 'none', note },                    // DEBT: a non-safe capability with no key yet
 *     preview:     { supported: boolean },   // §19.6: can answer "what would this do / cost" without acting
 *     agentsOnly:  boolean,                  // only an agent principal may call it
 *     aliases:     ['tasks_create_task'],    // §3 grandfathered wire names that keep being served
 *     bind:        { category, tool },       // the service row + tool that executes it (one code path)
 *     surfaces:    ['mcp', 'rest'],          // where it is generated: 'mcp' (/api/mcp), 'rest' (/api/v1/…), 'forum-mcp'
 *     scope:       'tasks:write',            // the xeno-workspace area scope it needs (capabilities/scopes.js); derived when absent
 *   }
 *
 * On the wire (§3.1) a canonical name travels with dots → `__`: tasks.task.create → tasks__task__create.
 */

export const CLASSES = Object.freeze(['safe', 'undoable', 'irreversible']);
export const MODES = Object.freeze(['always', 'on-screen-only', 'headless-only']);
export const COST_MODELS = Object.freeze(['free', 'fixed', 'metered', 'quoted']);
export const IDEMPOTENCY = Object.freeze(['key', 'natural', 'none']);
export const SURFACES = Object.freeze(['mcp', 'rest', 'forum-mcp']);
import { WORKSPACE_SCOPES, DIVISION_AREA, scopeFor } from './scopes.js';

const NAME = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

/** tasks.task.create → tasks__task__create. A total round trip with fromWire (§3.1). */
export const toWire = (name) => String(name).split('.').join('__');
export const fromWire = (wire) => String(wire).split('__').join('.');

/** Every problem with one declaration. Empty = valid. */
export function problemsOf(d) {
  const p = [];
  for (const k of ['name', 'version', 'division', 'title', 'description', 'input', 'reply', 'class', 'mode', 'provenance', 'permission', 'cost', 'idempotency', 'preview', 'bind', 'surfaces', 'scope']) {
    if (d[k] === undefined || d[k] === null || d[k] === '') p.push(`${d.name || '?'}: missing ${k}`);
  }
  if (p.length) return p;
  if (!NAME.test(d.name) || d.name.includes('__')) p.push(`${d.name}: not <division>.<domain>.<verb>`);
  if (d.name.split('.')[0] !== d.division) p.push(`${d.name}: first segment must be its division (${d.division})`);
  if (!SEMVER.test(d.version)) p.push(`${d.name}: version must be semver`);
  if (!CLASSES.includes(d.class)) p.push(`${d.name}: class must be one of ${CLASSES.join('|')}`);
  if (!MODES.includes(d.mode)) p.push(`${d.name}: mode must be one of ${MODES.join('|')}`);
  if (!['trusted', 'untrusted'].includes(d.provenance)) p.push(`${d.name}: provenance must be trusted|untrusted`);
  if (!COST_MODELS.includes(d.cost.model)) p.push(`${d.name}: cost.model must be one of ${COST_MODELS.join('|')}`);
  if (!IDEMPOTENCY.includes(d.idempotency.strategy)) p.push(`${d.name}: idempotency.strategy must be one of ${IDEMPOTENCY.join('|')}`);
  if (d.idempotency.strategy === 'key' && !((d.input.properties || {})[d.idempotency.key])) p.push(`${d.name}: idempotency key "${d.idempotency.key}" is not an input property`);
  if (d.idempotency.strategy !== 'key' && !d.idempotency.note) p.push(`${d.name}: idempotency "${d.idempotency.strategy}" needs a note`);
  if (d.class === 'safe' && d.idempotency.strategy === 'none') p.push(`${d.name}: a safe capability is natural, not none`);
  if (typeof d.preview.supported !== 'boolean') p.push(`${d.name}: preview.supported must be a boolean`);
  if (String(d.description).length < 20) p.push(`${d.name}: description too short to choose by`);
  if (d.input.type !== 'object') p.push(`${d.name}: input must be an object schema`);
  if (d.reply.type !== 'object') p.push(`${d.name}: reply must be an object schema`);
  if (!d.bind.category || !d.bind.tool) p.push(`${d.name}: bind needs category and tool`);
  if (!Array.isArray(d.surfaces) || !d.surfaces.length || d.surfaces.some((s) => !SURFACES.includes(s))) p.push(`${d.name}: surfaces must be a non-empty subset of ${SURFACES.join('|')}`);
  if (!WORKSPACE_SCOPES.includes(d.scope)) p.push(`${d.name}: scope must be one of the approved xeno-workspace scopes`);
  if (toWire(d.name).length > 64) p.push(`${d.name}: wire name over 64 chars`);
  if (fromWire(toWire(d.name)) !== d.name) p.push(`${d.name}: wire round trip fails`);
  return p;
}

/** One declaration with its defaults, frozen. Throws on an invalid one, so a bad catalogue cannot load. */
export function defineCapability(d) {
  const full = { mode: 'always', provenance: 'trusted', agentsOnly: false, aliases: [], preview: { supported: false }, surfaces: ['mcp', 'rest'], ...d };
  if (!full.permission) full.permission = full.name;
  if (!full.scope && full.division && full.class) full.scope = scopeFor(DIVISION_AREA[full.division] || full.division, full.class === 'safe' ? 'safe' : 'write');
  const p = problemsOf(full);
  if (p.length) throw new Error(`Invalid capability declaration:\n  ${p.join('\n  ')}`);
  return Object.freeze(full);
}
