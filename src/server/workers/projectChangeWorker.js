/**
 * Tells open canvases that something in their project changed. The `project_changed` NOTIFY triggers
 * (20261122090000) say when; this hands that to XENO Multiplayer, whose notice reaches everyone on the canvas, and each
 * screen then reads the platform as it always does. Leader only: one notice per change, however many replicas run.
 * A burst (a task moved, its comment, its folder) becomes one notice per project.
 */
import { notify } from '../services/liveTickets.js';

export function startProjectChangeWorker(pool, { delayMs = 300, retryMs = 5000, fetchImpl } = {}) {
  const waiting = new Set();
  let client = null, flushing = null, stopped = false;

  async function flush() {
    flushing = null;
    const ids = [...waiting]; waiting.clear();
    try {
      const { rows } = await pool.query('SELECT id FROM canvases WHERE project_id = ANY($1::uuid[]) AND deleted_at IS NULL', [ids]);
      await Promise.all(rows.map((c) => notify(pool, `workspace.canvas/${c.id}`, { changed: 'project' }, fetchImpl ? { fetchImpl } : {})));
    } catch (e) { console.error('[ProjectChange] notice failed:', e.message); }
  }
  async function listen() {
    if (stopped) return;
    try {
      const c = await pool.connect();
      const drop = () => { if (client !== c) return; client = null; try { c.release(true); } catch {} if (!stopped) setTimeout(listen, retryMs).unref?.(); };
      client = c; c.on('error', drop); c.on('end', drop);
      c.on('notification', (m) => {
        if (m.channel !== 'project_changed' || !m.payload) return;
        waiting.add(m.payload);
        if (!flushing) flushing = setTimeout(flush, delayMs);
      });
      await c.query('LISTEN project_changed');
    } catch (e) { console.error('[ProjectChange] listen failed:', e.message); setTimeout(listen, retryMs).unref?.(); }
  }
  listen();
  return () => { stopped = true; clearTimeout(flushing); const c = client; client = null; if (c) { try { c.release(true); } catch {} } };
}
