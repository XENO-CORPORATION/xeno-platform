/**
 * Canvases — /api/canvases against a real Postgres and the REAL routers.
 *
 *   node src/server/tests/canvases.test.mjs   (DATABASE_URL = a disposable database)
 */
import http from 'node:http';
import express from 'express';
import pg from 'pg';
import chatRoutes from '../routes/chatRoutes.js';
import canvasRoutes from '../routes/canvasRoutes.js';
import xenoTasksRoutes, { taskTokenAuth } from '../routes/xenoTasksRoutes.js';
import { runAllMigrations } from '../services/migrationRunner.js';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let passed = 0;
const check = (ok, label) => { if (!ok) throw new Error(`FAIL: ${label}`); passed += 1; console.log(`  ok  ${label}`); };

async function main() {
  await runAllMigrations(pool);
  const mk = async (name) => { const m = `${name}-${Date.now()}`; return (await pool.query(
    `INSERT INTO users(username,email,password_hash,display_name,email_verified,workspace_activated_at) VALUES($1,$2,'x',$1,TRUE,NOW()) RETURNING id`, [m, `${m}@example.test`])).rows[0].id; };
  const ids = { ada: await mk('cv-ada'), bob: await mk('cv-bob'), cyd: await mk('cv-cyd'), eve: await mk('cv-eve') };
  let actor = ids.ada;
  const app = express(); app.use(express.json({ limit: '2mb' }));
  app.use((req, _res, next) => { req.db = pool; req.user = { id: actor }; next(); });
  app.use('/api/chat', chatRoutes); app.use('/api/tasks', taskTokenAuth, xenoTasksRoutes); app.use('/api/canvases', canvasRoutes);
  const server = http.createServer(app); await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const as = (who) => async (method, path, body) => { actor = ids[who]; const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const ada = as('ada'), bob = as('bob'), cyd = as('cyd'), eve = as('eve');
  try {
    const proj = (await ada('POST', '/chat/projects', { name: 'Launch', area: 'dev' })).j.project;
    const email = async (id) => (await pool.query('SELECT email FROM users WHERE id = $1', [id])).rows[0].email;
    for (const [id, relation] of [[ids.bob, 'editor'], [ids.cyd, 'viewer']]) await ada('PUT', `/chat/projects/${proj.id}/access/user/by-email`, { email: await email(id), relation });
    const t1 = (await ada('POST', '/tasks', { title: 'Design the onboarding', projectId: proj.id })).j.task;
    const t2 = (await ada('POST', '/tasks', { title: 'Write the copy', projectId: proj.id })).j.task;
    const secret = (await eve('POST', '/tasks', { title: 'Eve private' })).j.task;

    // create
    check((await cyd('POST', '/canvases', { name: 'Plan', projectId: proj.id })).s === 403, 'a project viewer cannot add a canvas to it');
    check((await eve('POST', '/canvases', { name: 'Plan', projectId: proj.id })).s === 404, 'someone outside the project is told it does not exist');
    const made = await bob('POST', '/canvases', { name: 'Launch plan', projectId: proj.id });
    const cv = made.j.canvas;
    check(made.s === 201 && cv.revision === '1' && cv.content.nodes.length === 0 && cv.project.id === proj.id && cv.can.edit, 'an editor makes a project canvas; it starts empty at revision 1');

    // tasks are REFERENCES: title and status are read live, never stored
    const content = { nodes: [
      { id: 'a', type: 'xeno-ref', ref: { kind: 'task', id: t1.key }, x: 0, y: 0, width: 260, height: 120, title: 'STALE COPY' },
      { id: 'b', type: 'xeno-ref', ref: { kind: 'task', id: t2.key.toLowerCase() }, x: 400, y: 0, width: 260, height: 120 },
      { id: 'n', type: 'text', text: '## Notes\nShip by Friday', x: 0, y: 200, width: 300, height: 140, color: '4' },
      { id: 'g', type: 'group', label: 'Week 1', x: -40, y: -40, width: 800, height: 420 },
      { id: 'l', type: 'link', url: 'https://jsoncanvas.org/spec/1.0/', x: 400, y: 200, width: 260, height: 80 },
    ], edges: [{ id: 'e1', fromNode: 'a', toNode: 'b', toEnd: 'arrow', xeno: { link: 'blocks' } }, { id: 'e2', fromNode: 'n', toNode: 'a' }] };
    const refused = await bob('PUT', `/canvases/${cv.id}`, { content, revision: cv.revision });
    check(refused.s === 403 && refused.j.code === 'not_allowed', 'a wire that would link tasks follows the TASK rules: an editor who neither made nor works on them cannot link them');
    check((await pool.query('SELECT revision FROM canvases WHERE id = $1', [cv.id])).rows[0].revision === '1', 'and the refused save wrote nothing');
    const saved = await ada('PUT', `/canvases/${cv.id}`, { content, revision: cv.revision });
    check(saved.s === 200 && saved.j.canvas.revision === '2', `saving bumps the revision (${saved.s} ${JSON.stringify(saved.j).slice(0,300)})`);
    const stored = (await pool.query('SELECT content FROM canvases WHERE id = $1', [cv.id])).rows[0].content;
    check(!JSON.stringify(stored).includes('STALE COPY') && stored.nodes[1].ref.id === t2.key, 'a task node stores only its reference (no title copy), with the key normalised');
    await ada('PATCH', `/tasks/${t1.key}`, { title: 'Design the onboarding v2' });
    const read = (await cyd('GET', `/canvases/${cv.id}`)).j.canvas;
    check(read.records.tasks[t1.key].title === 'Design the onboarding v2' && read.records.tasks[t1.key].status === 'raised', 'a rename on the task shows on the canvas at once — no stale copy');
    check(read.can.edit === false && (await cyd('PUT', `/canvases/${cv.id}`, { content, revision: read.revision })).s === 403, 'a viewer reads the canvas but cannot change it');

    // a wire marked as a task link IS a real task link
    const linked = (await ada('GET', `/tasks/${t1.key}`)).j.task;
    check(linked.links.some((l) => l.kind === 'blocks' && l.task.key === t2.key), 'a wire marked "blocks" became a real link on the task page');

    // concurrency: a stale save is refused, not merged over
    check((await bob('PUT', `/canvases/${cv.id}`, { content, revision: '1' })).j.code === 'canvas_changed', 'a save from an old revision is refused (409), never written over a newer one');

    // what the reader cannot see stays hidden
    const withSecret = { nodes: [...content.nodes, { id: 's', type: 'xeno-ref', ref: { kind: 'task', id: secret.key }, x: 0, y: 500, width: 260, height: 120 }], edges: content.edges };
    const s3 = await bob('PUT', `/canvases/${cv.id}`, { content: withSecret, revision: '2' });
    check(s3.s === 200 && s3.j.canvas.records.tasks[secret.key].missing === true && !s3.j.canvas.records.tasks[secret.key].title, 'a task the reader cannot see shows as missing, never its title');

    // validation
    check((await bob('PUT', `/canvases/${cv.id}`, { content: { nodes: [content.nodes[0], { ...content.nodes[0], id: 'a2' }], edges: [] }, revision: '3' })).j.code === 'duplicate_ref', 'the same task twice on one canvas is refused');
    check((await bob('PUT', `/canvases/${cv.id}`, { content: { nodes: [{ id: 'x', type: 'script', x: 0, y: 0, width: 1, height: 1 }], edges: [] }, revision: '3' })).j.code === 'invalid_content', 'an unknown item type is refused');
    check((await bob('PUT', `/canvases/${cv.id}`, { content: { nodes: [{ id: 'x', type: 'link', url: 'javascript:alert(1)', x: 0, y: 0, width: 100, height: 50 }], edges: [] }, revision: '3' })).j.code === 'invalid_content', 'a javascript: link is refused');
    check((await bob('PUT', `/canvases/${cv.id}`, { content: { nodes: [content.nodes[2], content.nodes[3]], edges: [{ id: 'z', fromNode: 'n', toNode: 'g', xeno: { link: 'blocks' } }] }, revision: '3' })).j.code === 'invalid_link', 'only a wire between two tasks can be a task link');

    // list, personal canvas, delete
    check((await cyd('GET', `/canvases?projectId=${proj.id}`)).j.canvases.some((c) => c.id === cv.id), 'project members see its canvases');
    check(!(await eve('GET', '/canvases')).j.canvases.some((c) => c.id === cv.id) && (await eve('GET', `/canvases/${cv.id}`)).s === 404, 'an outsider neither lists nor opens it');
    const mine = (await eve('POST', '/canvases', { name: 'Ideas', area: 'dev' })).j.canvas;
    check(mine.project === null && (await ada('GET', `/canvases/${mine.id}`)).s === 404, 'a personal canvas is its owner\'s alone');
    check((await cyd('DELETE', `/canvases/${cv.id}`)).s === 404 || (await cyd('DELETE', `/canvases/${cv.id}`)).s === 403, 'a viewer cannot delete it');
    check((await bob('DELETE', `/canvases/${cv.id}`)).s === 200 && (await bob('GET', `/canvases/${cv.id}`)).s === 404, 'whoever made it deletes it, and it is gone');
    console.log(`\n${passed} passed`);
  } finally { server.close(); await pool.end(); }
}
main().catch((error) => { console.error(error.message || error); process.exit(1); });
