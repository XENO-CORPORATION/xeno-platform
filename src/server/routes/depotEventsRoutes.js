/**
 * POST /api/depot/events — XENO Depot's signed event feed (services/depotEvents.js; xeno-depot decision 0001 §7).
 * Mounted with express.raw BEFORE the global JSON parser, so the signature is checked over the exact bytes Depot sent.
 * No authMiddleware: the HMAC signature (DEPOT_EVENTS_SECRET) is the authentication. Answers:
 * The delivery shape is Depot decision 0002 §1 (headers x-xeno-event, x-xeno-delivery, x-xeno-signature).
 *   200 { ok, id, type, consumers }   verified and recorded (a repeat delivery is recorded once)
 *   202 { ok, ... }                   verified; a type no consumer here records (Depot does not retry it)
 *   400 invalid_event · 401 bad_signature · 422 unsupported_event_version · 503 events_not_configured
 */
import express from 'express';
import { DepotEventError, receiveDepotEvent } from '../services/depotEvents.js';

export function createDepotEventsRouter({ env = process.env } = {}) {
  const router = express.Router();
  router.post('/', async (req, res) => {
    res.set('cache-control', 'no-store');
    try {
      const out = await receiveDepotEvent(req.db, { raw: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), signature: req.get('x-xeno-signature'), env });
      // Depot decision 0002 §1: 2xx accepts; 202 says "a type this receiver ignores", so Depot need not retry it.
      const ignored = Object.values(out.consumers).every((c) => c && c.ignored);
      return res.status(ignored ? 202 : 200).json({ ok: true, ...out });
    } catch (e) {
      // DepotEventError carries `status`; the Index's ReleaseError carries `statusCode` (a refused envelope, never a crash)
      const status = e instanceof DepotEventError ? e.status : (e && e.name === 'ReleaseError' ? e.statusCode : null);
      if (status && e.code) return res.status(status).json({ ok: false, error: e.code, message: e.message });
      console.error('[depot-events]', e && e.message);
      return res.status(500).json({ ok: false, error: 'event_not_recorded' });
    }
  });
  return router;
}

export default createDepotEventsRouter();
