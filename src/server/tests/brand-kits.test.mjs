/**
 * XENO Assets, brand kits (services/brandKits.js + brandKitsMcp.js) on real Postgres.
 *
 *   - a kit belongs to its workspace: a stranger is refused, a viewer reads, an editor writes, an admin deletes
 *   - an agent reads and proposes, marked as its own; it never publishes, removes or deletes (service AND database)
 *   - values are validated, so nothing typed can reach CSS or a config file
 *   - aliases must resolve, and a name can't be both a token and a group
 *   - a published version never changes, editing the draft doesn't touch it, and "latest" is never the draft
 *   - exports: DTCG, CSS, Tailwind and Canvas, from a frozen version; a DTCG file round-trips through import
 *   - a logo must be an image in this workspace's Library
 *
 * Run: DATABASE_URL=postgresql://… node src/server/tests/brand-kits.test.mjs
 */
import assert from 'node:assert/strict';
import pg from 'pg';
import { runAllMigrations } from '../services/migrationRunner.js';
import { writeTuples } from '../utils/authzReBAC.js';
import * as K from '../services/brandKits.js';
import * as Mcp from '../services/brandKitsMcp.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const tag = `bk${process.pid}`; let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed += 1; console.log('  ok ', m); };
const user = async (s) => (await pool.query(`INSERT INTO users (username, email, display_name, email_verified, is_active, password_hash) VALUES ($1,$2,$1,true,true,'x') RETURNING id`, [`${tag}${s}`, `${tag}${s}@example.test`])).rows[0].id;
const code = async (p) => { try { await p; return null; } catch (e) { return e.code || e.message; } };
const team = async (owner, name) => (await pool.query(`INSERT INTO workspaces (owner_user_id, workspace_type, name, slug) VALUES ($1,'team',$2,$3) RETURNING id`, [owner, name, `${tag}-${name.toLowerCase()}`])).rows[0].id;

async function main() {
  await runAllMigrations(pool);
  const owner = await user('owner'), editor = await user('editor'), viewer = await user('viewer'), stranger = await user('stranger'), agentU = await user('agent');
  await pool.query('INSERT INTO agent_identities (user_id, owner_user_id) VALUES ($1,$2)', [agentU, editor]);
  const ws = await team(owner, 'Brand'), other = await team(stranger, 'Other');
  await writeTuples(pool, { writes: [['owner', owner], ['editor', editor], ['viewer', viewer]].map(([relation, u]) => ({ object: `workspace:${ws}`, subject: `user:${u}`, relation }))
    .concat([{ object: `workspace:${other}`, subject: `user:${stranger}`, relation: 'owner' }]) });
  const O = { id: owner, kind: 'human' }, E = { id: editor, kind: 'human' }, V = { id: viewer, kind: 'human' }, S = { id: stranger, kind: 'human' }, AG = { id: agentU, kind: 'agent' };
  const w = { workspace: ws };

  // ── who
  ok(await code(K.listKits(pool, S, w)) === 'not_a_member', 'a stranger can’t see a workspace’s kits');
  ok(await code(K.createKit(pool, V, { ...w, name: 'No' })) === 'editor_required', 'a viewer can’t make a kit');
  const kit = (await K.createKit(pool, E, { ...w, name: 'Acme', voice: 'Plain and warm.', modes: ['dark'] })).kit;
  ok((await K.listKits(pool, V, w)).kits.some((k) => k.id === kit.id), 'a viewer reads them');
  ok(await code(K.getKit(pool, S, { workspace: other, id: kit.id })) === 'kit_not_found', 'another workspace can’t reach it by id');
  const put = (path, value, extra = {}) => K.putToken(pool, E, { ...w, id: kit.id, path, value, ...extra });

  // ── what can be stored
  for (const [value, want, why] of [
    [{ kind: 'color', value: 'red; background:url(x)' }, 'invalid_color', 'CSS in a color'],
    [{ kind: 'color', value: 'javascript:alert(1)' }, 'invalid_color', 'a script in a color'],
    [{ kind: 'string', value: 'a;}body{display:none' }, 'invalid_value', 'CSS in text'],
    [{ kind: 'string', value: '</style><script>' }, 'invalid_value', 'a tag in text'],
    [{ kind: 'typography', value: { fontFamily: 'x}*{', fontSize: 16 } }, 'invalid_value', 'CSS in a font'],
    [{ kind: 'number', value: 'wide' }, 'invalid_value', 'a word as a number'],
    [{ kind: 'number', value: 4, unit: 'vh;x' }, 'invalid_value', 'a made-up unit'],
    [{ kind: 'logo', fileId: 'x' }, 'invalid_kind', 'a logo through the token door'],
  ]) ok(await code(put('color.test', value)) === want, `refused: ${why}`);
  ok(await code(put('Color Brand', { kind: 'color', value: '#112233' })) === 'invalid_path', 'a name is lowercase words joined by dots');
  ok((await put('color.brand.primary', { kind: 'color', value: '#1A2B3C' }, { valuesByMode: { dark: { kind: 'color', value: '#aabbcc' } } })).item.value.value === '#1a2b3c', 'a color is stored in one form');
  ok(await code(put('color.x', { kind: 'color', value: '#000000' }, { valuesByMode: { sepia: { kind: 'color', value: '#111111' } } })) === 'unknown_mode', 'a value for a mode the kit doesn’t have is refused');
  ok(await code(put('color.brand', { kind: 'color', value: '#000000' })) === 'path_conflict' && await code(put('color.brand.primary.dark', { kind: 'color', value: '#000000' })) === 'path_conflict', 'a name can’t be both a token and a group');
  await put('space.md', { kind: 'number', value: 16, unit: 'px' });
  await put('radius.md', { kind: 'number', value: 0.5, unit: 'rem' });
  await put('color.link', { kind: 'alias', path: 'color.brand.primary' });
  await put('shadow.card', { kind: 'shadow', value: { offsetX: 0, offsetY: 2, blur: 8, spread: 0, color: '#00000033' } });
  await put('type.body', { kind: 'typography', value: { fontFamily: 'Inter Tight', fontSize: 16, fontWeight: 400, lineHeight: 1.5 } });

  // ── an agent proposes and never publishes
  const prop = (await Mcp.callTool(pool, AG, 'propose_token', { ...w, kit: kit.id, path: 'color.accent', value: { kind: 'color', value: '#ff0066' } })).structuredContent.item;
  ok(prop.agentDrafted === true, 'an agent’s token is marked as its own');
  ok(await code(K.publish(pool, AG, { ...w, id: kit.id })) === 'human_only', 'an agent can’t publish');
  ok(await code(K.removeItem(pool, AG, { ...w, id: kit.id, path: 'color.accent' })) === 'human_only' && await code(K.deleteKit(pool, AG, { ...w, id: kit.id })) === 'human_only', 'or remove or delete');
  await assert.rejects(pool.query(`INSERT INTO brand_kit_versions (kit_id, version, snapshot, digest, published_by) VALUES ($1, 99, '{}'::jsonb, $2, $3)`, [kit.id, 'a'.repeat(64), agentU]), /only a person can publish/);
  await assert.rejects(pool.query(`INSERT INTO brand_kit_versions (kit_id, version, snapshot, digest) VALUES ($1, 99, '{}'::jsonb, $2)`, [kit.id, 'a'.repeat(64)]), /only a person can publish/);
  ok(true, 'and the database refuses it too');
  ok(!(await Mcp.TOOLS).some((t) => /publish|delete|remove|import/.test(t.name)), 'there is no agent tool to publish, delete, remove or import');

  // ── problems stop a publish
  ok(await code(K.readVersion(pool, V, { ...w, id: kit.id })) === 'not_published', 'nothing published means nothing to read: never the draft');
  await put('color.broken', { kind: 'alias', path: 'color.missing' });
  await put('color.a', { kind: 'alias', path: 'color.b' }); await put('color.b', { kind: 'alias', path: 'color.a' });
  const bad = await K.getKit(pool, V, { ...w, id: kit.id });
  ok(bad.kit.problems.length === 3, `the draft lists what’s wrong (${bad.kit.problems.length})`);
  ok(await code(K.publish(pool, E, { ...w, id: kit.id })) === 'kit_has_problems', 'a dangling or circular alias stops a publish');
  for (const p of ['color.broken', 'color.a', 'color.b']) await K.removeItem(pool, E, { ...w, id: kit.id, path: p });

  // ── versions
  const v1 = (await K.publish(pool, E, { ...w, id: kit.id, note: 'First' })).version;
  ok(v1.version === 1 && /^[0-9a-f]{64}$/.test(v1.digest), 'publishing makes version 1 with a digest');
  ok(await code(K.publish(pool, E, { ...w, id: kit.id })) === 'nothing_to_publish', 'publishing again with no change is refused');
  ok((await K.getKit(pool, V, { ...w, id: kit.id })).kit.items.find((i) => i.path === 'color.accent').agentDrafted === false, 'publishing a person’s yes clears the agent’s mark');
  await put('color.brand.primary', { kind: 'color', value: '#000000' });
  ok((await K.getKit(pool, V, { ...w, id: kit.id })).kit.unpublished === true, 'a change shows as unpublished');
  const frozen = await K.readVersion(pool, V, { ...w, id: kit.id });
  ok(frozen.version === 1 && frozen.snapshot.items.find((i) => i.path === 'color.brand.primary').value.value === '#1a2b3c', '"latest" is still the published value, not the draft');
  await assert.rejects(pool.query(`UPDATE brand_kit_versions SET note = 'changed' WHERE kit_id = $1`, [kit.id]), /never changes/);
  await assert.rejects(pool.query(`UPDATE brand_kit_versions SET snapshot = '{}'::jsonb WHERE kit_id = $1`, [kit.id]), /never changes/);
  ok(true, 'the database refuses to change a published version');
  const v2 = (await K.publish(pool, O, { ...w, id: kit.id, note: 'Black' })).version;
  ok(v2.version === 2 && v2.digest !== v1.digest, 'a new version gets the next number');
  ok((await K.readVersion(pool, V, { ...w, id: kit.id, version: 1 })).digest === v1.digest, 'an old version can still be read, unchanged');
  ok((await K.listVersions(pool, V, { ...w, id: kit.id })).versions.map((x) => x.version).join() === '2,1', 'versions list newest first');
  ok(await code(K.readVersion(pool, V, { ...w, id: kit.id, version: 9 })) === 'version_not_found', 'a version that doesn’t exist says so');
  const race = (await K.createKit(pool, E, { ...w, name: 'Race' })).kit;
  await K.putToken(pool, E, { ...w, id: race.id, path: 'color.a', value: { kind: 'color', value: '#111111' } });
  await Promise.all(Array.from({ length: 8 }, () => pool.query('SELECT pg_sleep(0.1)')));
  const both = await Promise.allSettled([1, 2, 3].map(() => K.publish(pool, E, { ...w, id: race.id })));
  ok(both.filter((x) => x.status === 'fulfilled').length === 1 && both.filter((x) => x.status === 'rejected').every((x) => x.reason.code === 'nothing_to_publish'), 'publishing the same draft at once makes one version');

  // ── exports, from a frozen version
  const dtcg = JSON.parse((await K.exportKit(pool, V, { ...w, id: kit.id, version: 1, format: 'dtcg' })).body);
  ok(dtcg.color.brand.primary.$type === 'color' && dtcg.color.brand.primary.$value === '#1a2b3c', 'DTCG: a color, from the version asked for');
  ok(dtcg.color.brand.primary.$extensions['ai.xenosystem.modes'].dark === '#aabbcc', 'DTCG: modes are carried');
  ok(dtcg.color.link.$value === '{color.brand.primary}', 'DTCG: an alias is a reference');
  ok(dtcg.space.md.$type === 'dimension' && dtcg.space.md.$value.value === 16 && dtcg.space.md.$value.unit === 'px', 'DTCG: a dimension');
  ok(dtcg.type.body.$type === 'typography' && dtcg.type.body.$value.fontFamily === 'Inter Tight', 'DTCG: type');
  const css = (await K.exportKit(pool, V, { ...w, id: kit.id, version: 1, format: 'css' })).body;
  ok(css.includes('--color-brand-primary: #1a2b3c;') && css.includes('--color-link: var(--color-brand-primary);') && css.includes('--radius-md: 0.5rem;') && css.includes('--type-body-font-family: "Inter Tight";'), 'CSS: variables, aliases as var(), a spaced font quoted');
  ok(/\[data-theme="dark"\] \{\s+--color-brand-primary: #aabbcc;/.test(css), 'CSS: a mode is its own block');
  ok(css.split('{').length === css.split('}').length && !/[<]|;;/.test(css), 'CSS: it’s balanced, with nothing that could break out');
  const tw = (await K.exportKit(pool, V, { ...w, id: kit.id, version: 1, format: 'tailwind' })).body;
  const mod = { exports: {} }; new Function('module', tw)(mod);
  ok(mod.exports.extend.colors.brand.primary === 'var(--color-brand-primary)' && mod.exports.extend.spacing.md === 'var(--space-md)' && mod.exports.extend.borderRadius.md === 'var(--radius-md)' && mod.exports.extend.colors.link === 'var(--color-link)', 'Tailwind: a real module whose theme reads the variables');
  const cv = JSON.parse((await K.exportKit(pool, V, { ...w, id: kit.id, version: 1, format: 'canvas' })).body);
  const link = Object.values(cv.tokens).find((t) => t.name === 'color/link');
  ok(cv.modes[0] === 'dark' && link.value.kind === 'alias' && cv.tokens[link.value.tokenId].name === 'color/brand/primary' && cv.tokens[link.value.tokenId].valuesByMode.dark.value === '#aabbcc', 'Canvas: its own token shape, aliases by id, modes kept');
  ok(await code(K.exportKit(pool, V, { ...w, id: kit.id, format: 'pdf' })) === 'invalid_format', 'an unknown format is refused');
  const ag = await Mcp.callTool(pool, AG, 'get_brand', { ...w, kit: kit.id });
  ok(ag.structuredContent.version === 2 && ag.structuredContent.snapshot.voice === 'Plain and warm.', 'an agent reads the brand and its voice');

  // ── import
  const imp = (await K.createKit(pool, E, { ...w, name: 'Imported' })).kit;
  await K.putToken(pool, E, { ...w, id: imp.id, path: 'keep.me', value: { kind: 'number', value: 1 } });
  const file = JSON.stringify(dtcg);
  const dry = await K.importDtcg(pool, E, { ...w, id: imp.id, tokens: file });
  ok(dry.dryRun && dry.add.includes('color.brand.primary') && (await K.getKit(pool, V, { ...w, id: imp.id })).kit.items.length === 1, 'importing shows what it would do, and changes nothing');
  await K.importDtcg(pool, E, { ...w, id: imp.id, tokens: file, confirm: true });
  const back = (await K.getKit(pool, V, { ...w, id: imp.id })).kit;
  ok(back.items.some((i) => i.path === 'keep.me') && back.items.find((i) => i.path === 'type.body').value.value.fontFamily === 'Inter Tight' && back.items.find((i) => i.path === 'color.link').value.path === 'color.brand.primary', 'confirming brings tokens in and leaves the rest');
  ok((await K.importDtcg(pool, E, { ...w, id: imp.id, tokens: file })).same >= 5, 'importing the same file again changes nothing');
  ok(await code(K.importDtcg(pool, E, { ...w, id: imp.id, tokens: 'not json' })) === 'invalid_json' && await code(K.importDtcg(pool, AG, { ...w, id: imp.id, tokens: file })) === 'human_only', 'a bad file and an agent are refused');
  const evil = await K.importDtcg(pool, E, { ...w, id: imp.id, tokens: JSON.stringify({ a: { $type: 'color', $value: 'red;}*{display:none' } }), confirm: true });
  ok(evil.refused.length === 1 && !(await K.getKit(pool, V, { ...w, id: imp.id })).kit.items.some((i) => i.path === 'a'), 'an import can’t bring in what the screen would refuse');

  // ── logos
  const file2 = async (mime, wsId, ownerId) => {
    const id = (await pool.query(`INSERT INTO user_files (user_id, owner_user_id, workspace_id, created_by_user_id, filename, original_name, file_type, mime_type, file_size, storage_path, storage_type)
      VALUES ($1,NULL,$2,$1,'l.png','logo.png',$3,$3,10,'x','platform-upload') RETURNING id`, [ownerId, wsId, mime])).rows[0].id;
    await writeTuples(pool, { writes: [{ object: `library_asset:${id}`, subject: `user:${ownerId}`, relation: 'owner' }] });
    return id;
  };
  const mine = await file2('image/png', ws, editor), pdf = await file2('application/pdf', ws, editor), theirs = await file2('image/png', other, stranger), elsewhere = await file2('image/png', other, editor);
  ok(await code(K.addLogo(pool, E, { ...w, id: kit.id, name: 'x', fileId: pdf })) === 'logo_not_image', 'a logo must be an image');
  ok(await code(K.addLogo(pool, E, { ...w, id: kit.id, name: 'x', fileId: theirs })) === 'logo_not_found', 'a file you can’t see can’t be a logo');
  ok(await code(K.addLogo(pool, E, { ...w, id: kit.id, name: 'x', fileId: elsewhere })) === 'logo_not_in_workspace', 'a file outside this workspace can’t be a logo');
  ok(await code(K.addLogo(pool, AG, { ...w, id: kit.id, name: 'x', fileId: mine })) === 'human_only', 'an agent can’t add one');
  const lg = (await K.addLogo(pool, E, { ...w, id: kit.id, name: 'primary', fileId: mine })).item;
  ok(lg.path === 'logo.primary' && lg.value.fileId === mine, 'a logo points at the file');
  await K.publish(pool, E, { ...w, id: kit.id });
  ok(!(await K.exportKit(pool, V, { ...w, id: kit.id, format: 'css' })).body.includes('logo'), 'a logo isn’t a token in an export');
  ok((await K.readVersion(pool, V, { ...w, id: kit.id })).snapshot.items.some((i) => i.path === 'logo.primary'), 'but it is part of the brand an agent reads');

  // ── deleting
  ok(await code(K.deleteKit(pool, E, { ...w, id: kit.id })) === 'admin_required', 'an editor can’t delete a kit');
  await K.deleteKit(pool, O, { ...w, id: kit.id });
  ok(await code(K.getKit(pool, V, { ...w, id: kit.id })) === 'kit_not_found' && await code(K.exportKit(pool, V, { ...w, id: kit.id })) === 'kit_not_found', 'a deleted kit is gone from every door');
  await K.restoreKit(pool, O, { ...w, id: kit.id });
  ok((await K.readVersion(pool, V, { ...w, id: kit.id })).version === 3, 'and undo brings it back, versions and all');

  console.log(`\nbrand-kits: ${passed} passed`);
}
main().then(() => pool.end()).catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
