/**
 * The remote control relay: sealed frames between a person's PC and their other devices. Decision 0006 in
 * xeno-agent-interface (docs/decisions/0006-remote-control-end-to-end.md).
 *
 * ── WHAT THIS MODULE MAY KNOW ───────────────────────────────────────────
 *
 * Which device of which person is sending to which other device, and how many bytes. Never what. A frame is
 * sealed by Noise before it reaches us, the keys never do, and this module has no way to open one.
 *
 * 🔴 A FRAME IS NOT A ROW, AND THAT IS THE DIFFERENCE FROM THE BROWSER RELAY. A browser call is a row because
 * a click must survive a socket. A sealed frame is a passing message: it is held only in memory, for the moment
 * of delivery, and an absent device catches up from the host's own log when it comes back. So Redis pub/sub
 * rather than Postgres: it carries a frame between replicas, stores nothing, and its publish reports how many
 * subscribers received it, which is how a sender learns the other side is away. NOTIFY could not carry these
 * at all: its payload stops at 8 KB.
 *
 * ── WHAT THIS MODULE IS NOT ─────────────────────────────────────────────
 *
 * It is not the security boundary. It routes only between one person's own devices, which keeps strangers out
 * and keeps a misrouted frame from existing, but a linked device is decided by the keys on the PC. An account
 * taken over here can reach the PC's socket and still cannot open a channel with it.
 */
import Redis from 'ioredis';

export const MAX_FRAMES_PER_SECOND = 2_000;
export const MAX_BYTES_PER_SECOND = 32 * 1024 * 1024;
/** How long a device's right to reach a peer is trusted. Removing a device also closes its socket at once. */
const PEER_CACHE_MS = 30_000;

const channel = (installationId) => `remote:frames:${installationId}`;

/** One process. Tests use it, and so does a composition with no Redis, where a replica can only reach itself. */
export function localBus() {
  const handlers = new Map();
  return {
    async publish(installationId, message) {
      const handler = handlers.get(String(installationId));
      if (!handler) return 0;
      handler(message);
      return 1;
    },
    async subscribe(installationId, handler) { handlers.set(String(installationId), handler); },
    async unsubscribe(installationId) { handlers.delete(String(installationId)); },
  };
}

export function redisBus(url) {
  const publisher = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: true });
  const subscriber = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
  const handlers = new Map();
  subscriber.on('message', (name, message) => handlers.get(name)?.(message));
  // ioredis reports a lost connection here. Without a listener it would take the process down.
  publisher.on('error', () => {});
  subscriber.on('error', () => {});
  return {
    async publish(installationId, message) { return publisher.publish(channel(installationId), message); },
    async subscribe(installationId, handler) {
      handlers.set(channel(installationId), handler);
      await subscriber.subscribe(channel(installationId));
    },
    async unsubscribe(installationId) {
      handlers.delete(channel(installationId));
      await subscriber.unsubscribe(channel(installationId));
    },
    async close() { publisher.disconnect(); subscriber.disconnect(); },
  };
}

let bus = null;
export function setRemoteBus(value) { bus = value; }
function currentBus() {
  if (!bus) bus = process.env.REDIS_URL ? redisBus(process.env.REDIS_URL) : localBus();
  return bus;
}

/** Off unless the deployment says on, in the same shape as every other switch here. */
export const remoteRelayEnabled = () => process.env.REMOTE_CONTROL_RELAY === 'on';

/** Whether `from` may send to `to`: one person's devices, a host and a device, both live. */
export async function peerAllowed(db, { userId, fromRole, to }) {
  const row = (await db.query(
    `SELECT remote_role FROM browser_installations
      WHERE id = $1 AND user_id = $2 AND surface = 'remote' AND enabled AND revoked_at IS NULL`, [to, userId])).rows[0];
  return Boolean(row) && row.remote_role !== fromRole;
}

/**
 * One socket's half of the relay. The socket layer has already proved who this is. `from` is ours, never the
 * sender's, so a device cannot claim to be another one.
 */
export function openRemoteSession({ db, installationId, userId, role, deliver, onOverload, now = Date.now }) {
  const peers = new Map();
  let windowStart = 0;
  let frames = 0;
  let bytes = 0;
  const open = Promise.resolve(currentBus().subscribe(installationId, (message) => {
    try { deliver(JSON.parse(message)); } catch { /* a frame that will not parse was never ours */ }
  }));

  const mayReach = async (to) => {
    const known = peers.get(to);
    if (known && now() - known.at < PEER_CACHE_MS) return known.allowed;
    const allowed = await peerAllowed(db, { userId, fromRole: role, to });
    peers.set(to, { allowed, at: now() });
    return allowed;
  };

  return {
    ready: open,
    /** @returns {'delivered'|'away'|'refused'} */
    async send({ to, data }) {
      const at = now();
      if (at - windowStart >= 1000) { windowStart = at; frames = 0; bytes = 0; }
      frames += 1;
      bytes += data.length;
      if (frames > MAX_FRAMES_PER_SECOND || bytes > MAX_BYTES_PER_SECOND) { onOverload(); return 'refused'; }
      if (!(await mayReach(to))) return 'refused';
      const received = await currentBus().publish(to, JSON.stringify({ from: installationId, data }));
      return received > 0 ? 'delivered' : 'away';
    },
    async close() { await currentBus().unsubscribe(installationId); },
  };
}
