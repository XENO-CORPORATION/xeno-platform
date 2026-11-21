/**
 * XENO Depot's event feed, received here (xeno-depot/docs/decisions/0001-depot-foundation.md §7).
 *
 * Depot POSTs each event to /api/depot/events, signed the way XENO Tasks signs its own webhooks, so one verifier shape
 * serves the ecosystem:
 *   X-Xeno-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 *   X-Xeno-Delivery:  <the event's id>            (optional; the envelope's own `id` is what de-duplicates)
 * The secret is DEPOT_EVENTS_SECRET, shared with Depot. It may hold several secrets separated by commas, so the secret
 * can be rotated without dropping events: add the new one here, switch Depot, then remove the old one. Unset → every
 * delivery is refused (fail closed).
 *
 * The signature is checked over the RAW bytes before anything is parsed. A verified envelope goes to the consumers
 * this platform hosts — today the Index release record (recordDepotEvent, vendored from xeno-index) — and nothing in
 * the envelope is trusted beyond its shape. An envelope version this build does not know answers 422 (§7: a breaking
 * change ships as v: 2 beside v: 1).
 */
import crypto from 'node:crypto';
import { recordDepotEvent } from './releaseRecord.js';

export const SIGNATURE_TOLERANCE_SECONDS = 300;

export class DepotEventError extends Error {
  constructor(code, status, message) { super(message || code); this.code = code; this.status = status; }
}

export function eventSecrets(env = process.env) {
  return String(env.DEPOT_EVENTS_SECRET || '').split(',').map((s) => s.trim()).filter((s) => s.length >= 32);
}

/** What Depot sends. Exported for Depot's own tests and for ours. */
export function signDepotEvent(secret, raw, t = Math.floor(Date.now() / 1000)) {
  const body = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'utf8');
  return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.`).update(body).digest('hex')}`;
}

/** True when `header` is a valid signature of `raw` by one of `secrets`, made within the tolerance window. */
export function verifyDepotSignature({ header, raw, secrets, now = Date.now() }) {
  const parts = Object.fromEntries(String(header || '').split(',').map((p) => p.trim().split('=')).filter((kv) => kv.length === 2));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(String(parts.v1 || ''))) return false;
  if (Math.abs(now / 1000 - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const got = Buffer.from(parts.v1, 'hex');
  return secrets.some((s) => {
    const want = Buffer.from(signDepotEvent(s, raw, t).split('v1=')[1], 'hex');
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  });
}

/** Verify, parse, and hand the envelope to the consumers. Returns what each consumer did. */
export async function receiveDepotEvent(db, { raw, signature, env = process.env, now = Date.now() }) {
  const secrets = eventSecrets(env);
  if (!secrets.length) throw new DepotEventError('events_not_configured', 503, 'Depot events are not configured on this platform');
  const body = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw ?? ''), 'utf8');
  if (!verifyDepotSignature({ header: signature, raw: body, secrets, now })) throw new DepotEventError('bad_signature', 401, 'Signature does not verify');
  let evt;
  try { evt = JSON.parse(body.toString('utf8')); } catch { throw new DepotEventError('invalid_event', 400, 'The body is not JSON'); }
  if (!evt || typeof evt !== 'object' || Array.isArray(evt)) throw new DepotEventError('invalid_event', 400, 'An event is a JSON object');
  if (evt.v !== 1) throw new DepotEventError('unsupported_event_version', 422, `Depot event version ${evt.v} is not supported`);
  const index = await recordDepotEvent(db, evt);
  return { id: typeof evt.id === 'string' ? evt.id : null, type: evt.type, consumers: { index } };
}
