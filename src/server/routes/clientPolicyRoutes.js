/**
 * GET /api/client-policy — "am I still supported?"
 *
 * Deliberately exempt from the version gate itself, and unauthenticated. A
 * client that has just been refused needs to be able to ask WHY and WHAT TO DO,
 * and requiring a valid session to read a deprecation notice would hide the
 * answer from exactly the builds that need it — including ones whose auth broke
 * because they are too old.
 *
 * It reveals nothing sensitive: a version floor is a published policy, not a
 * secret. Anyone can already discover it by making one request and reading the
 * 426.
 */
import express from 'express';
import { identifyClient, loadPolicies, evaluateClient } from '../services/clientVersion.js';

const router = express.Router();

router.get('/', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const identity = identifyClient(req);
  let policies = new Map();
  try {
    policies = await loadPolicies(req.db);
  } catch { /* fails open — see clientVersion.js */ }

  const verdict = evaluateClient(identity, policies);
  const p = identity ? policies.get(identity.product) : null;

  return res.json({
    identified: Boolean(identity),
    product: identity?.product || null,
    version: identity?.version || null,
    /* How we recognised them. A client that reports 'user-agent' has not adopted
     * the explicit header yet — which is exactly the signal a product team needs
     * to know their build predates the contract. */
    via: identity?.source || null,
    supported: verdict.ok,
    outdated: Boolean(verdict.outdated),
    minSupported: p?.min_supported || null,
    minRecommended: p?.min_recommended || null,
    message: p?.message || null,
    update: identity ? `/product/${identity.product}/download` : null,
  });
});

export default router;
