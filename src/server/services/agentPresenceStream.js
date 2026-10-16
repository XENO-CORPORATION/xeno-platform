/**
 * Agent presence, pushed live to the screens (Server-Sent Events). Pairs with agentPresence.js (what the status IS)
 * and the `agent_presence` NOTIFY triggers (20261016140000) that say WHEN one of its facts changed.
 *
 * One LISTEN connection per replica, shared by every open stream on it. A NOTIFY names an agent; each stream that
 * watches that agent recomputes its presence AS THAT VIEWER (rights decide whether "cloud" applies) and sends it
 * only if it changed. Time also changes presence with no write at all (working → online after 2 minutes of quiet,
 * online → offline after 15), so every stream also re-checks its agents every 20 s; that is the only polling, and it
 * runs on the server, against one query per agent.
 */
import * as agents from './platformAgents.js';
import { presenceOf } from './agentPresence.js';

const streams = new Set();
let listener = null, connecting = null;

/** One LISTEN connection, taken from the pool the requests use (`db` must be a pg Pool: it has `connect`). */
async function listen(db) {
  if (listener) return listener;
  if (connecting) return connecting;
  if (!db || typeof db.connect !== 'function') throw new Error('no pool to listen on');
  connecting = (async () => {
    const client = await db.connect();
    client.on('notification', (msg) => { if (msg.channel === 'agent_presence' && msg.payload) for (const s of streams) s.changed(msg.payload); });
    const drop = () => { if (listener === client) listener = null; try { client.release(true); } catch {} if (streams.size) setTimeout(() => listen(db).catch(() => {}), 2000); };
    client.on('error', drop); client.on('end', drop);
    await client.query('LISTEN agent_presence');
    listener = client; connecting = null;
    return client;
  })().catch((e) => { connecting = null; throw e; });
  return connecting;
}

const sig = (p) => `${p.state}|${p.label}|${p.canTakeWork}|${p.run ? p.run.state : ''}|${p.doing ? p.doing.task + p.doing.note : ''}`;

/** Serve one stream to `me`: an initial snapshot, then every change, until the client goes. */
export async function serve(req, res) {
  const me = req.me, db = req.db;
  const mine = new Map();       // agent user id -> { id (public), rights, sig }
  const load = async () => { for (const a of await agents.list(db, me)) if (!mine.has(String(a.userId))) mine.set(String(a.userId), { id: a.id, name: a.name, rights: a.rights, sig: '' }); };
  await load();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch {} };
  const push = async (userId, force = false) => {
    const a = mine.get(userId); if (!a) return;
    const p = await presenceOf(db, userId, a.rights).catch(() => null); if (!p) return;
    const k = sig(p); if (!force && k === a.sig) return;
    a.sig = k; send('presence', { id: a.id, name: a.name, ...p });
  };
  for (const userId of mine.keys()) await push(userId, true);
  send('ready', { at: new Date().toISOString() });
  const stream = { changed: (userId) => { if (mine.has(userId)) push(userId).catch(() => {}); } };
  streams.add(stream);
  await listen(db).catch(() => send('degraded', { reason: 'live updates unavailable; checking every 20 s' }));
  // time moves presence too; and an agent made or shared since the stream opened joins it
  const tick = setInterval(async () => { await load().catch(() => {}); for (const userId of mine.keys()) await push(userId).catch(() => {}); }, 20_000);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25_000);
  req.on('close', () => { clearInterval(tick); clearInterval(ping); streams.delete(stream); });
}

/** Stop listening (tests, shutdown): releases the shared LISTEN connection. */
export function stopListening() { const c = listener; listener = null; if (c) { c.removeAllListeners('end'); c.removeAllListeners('error'); try { c.release(true); } catch {} } }
export const _internals = { streams, sig };
