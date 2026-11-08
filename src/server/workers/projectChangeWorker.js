/**
 * Tells open canvases that something in their project changed. The `project_changed` NOTIFY triggers
 * (20261122090000) say when; this hands that to XENO Multiplayer, whose notice reaches everyone on the canvas, and each
 * screen then reads the platform as it always does. Leader only: one notice per change, however many replicas run.
 * A burst (a task moved, its comment, its folder) becomes one notice per project.
 *
 * And it ends live seats when access ends: the `project_access_changed` NOTIFY (20261123090000) names a relationship
 * tuple that went away; services/canvases.js liveSeatsToEnd re-checks those people on the project's canvases, and
 * whoever may no longer edit one is closed by the service (liveTickets.revoke → 4403). A ticket only gates joining, so
 * without this a person removed from a project kept editing its open canvas until they left.
 */
import { notify, revoke as revokeLive } from '../services/liveTickets.js';
import { liveSeatsToEnd } from '../services/canvases.js';

export function startProjectChangeWorker(pool, { delayMs = 300, retryMs = 5000, fetchImpl } = {}) {
  const waiting = new Set(), lost = [];
  let client = null, flushing = null, ending = null, stopped = false;
  const opts = fetchImpl ? { fetchImpl } : {};

  async function flush() {
    flushing = null;
    const ids = [...waiting]; waiting.clear();
    try {
      const { rows } = await pool.query('SELECT id FROM canvases WHERE project_id = ANY($1::uuid[]) AND deleted_at IS NULL', [ids]);
      await Promise.all(rows.map((c) => notify(pool, `workspace.canvas/${c.id}`, { changed: 'project' }, opts)));
    } catch (e) { console.error('[ProjectChange] notice failed:', e.message); }
  }
  async function endSeats() {
    ending = null;
    const changes = lost.splice(0), done = new Set();
    for (const change of changes) {
      try {
        for (const { canvas, sub } of await liveSeatsToEnd(pool, change)) {
          const k = `${canvas}:${sub}`; if (done.has(k)) continue; done.add(k);
          const r = await revokeLive(pool, `workspace.canvas/${canvas}`, sub, opts);
          if (!r.ok) console.error('[ProjectChange] live seat not ended:', canvas, r.status, r.error || '');
        }
      } catch (e) { console.error('[ProjectChange] access re-check failed:', e.message); }
    }
  }
  async function listen() {
    if (stopped) return;
    try {
      const c = await pool.connect();
      const drop = () => { if (client !== c) return; client = null; try { c.release(true); } catch {} if (!stopped) setTimeout(listen, retryMs).unref?.(); };
      client = c; c.on('error', drop); c.on('end', drop);
      c.on('notification', (m) => {
        if (!m.payload) return;
        if (m.channel === 'project_changed') {
          waiting.add(m.payload);
          if (!flushing) flushing = setTimeout(flush, delayMs);
        } else if (m.channel === 'project_access_changed') {
          try { lost.push(JSON.parse(m.payload)); } catch { return; }
          if (!ending) ending = setTimeout(endSeats, delayMs);
        }
      });
      await c.query('LISTEN project_changed');
      await c.query('LISTEN project_access_changed');
    } catch (e) { console.error('[ProjectChange] listen failed:', e.message); setTimeout(listen, retryMs).unref?.(); }
  }
  listen();
  return () => { stopped = true; clearTimeout(flushing); clearTimeout(ending); const c = client; client = null; if (c) { try { c.release(true); } catch {} } };
}
