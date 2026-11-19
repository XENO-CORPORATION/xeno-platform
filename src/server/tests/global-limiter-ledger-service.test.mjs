/**
 * The global /api/ limiter must not count the gateway's authenticated service-ledger calls, and must still count
 * everything else on that path (2026-11-20: one service token for every API user shared 300 requests a minute,
 * so holds, settles and voids were refused with 429).
 *
 * Run: node tests/global-limiter-ledger-service.test.mjs   (offline; no database, no host)
 */
import assert from 'node:assert/strict';
import { globalLimiterSkips, isAuthenticatedLedgerServiceCall } from '../utils/globalLimiterSkip.js';

const TOKEN = 'service-token-for-tests-0123456789';
const call = (path, authorization) => ({ baseUrl: '/api', path, headers: authorization ? { authorization } : {} });

// The gateway's calls, with the right token, are not counted.
for (const path of ['/v2/ledger/service/holds', '/v2/ledger/service/holds/abc/settle', '/v2/ledger/service/holds/abc/void', '/v2/ledger/service/balance']) {
  assert.equal(isAuthenticatedLedgerServiceCall(call(path, `Bearer ${TOKEN}`), TOKEN), true, path);
}
// Wrong, missing or malformed tokens still count, so the path is no bypass.
assert.equal(isAuthenticatedLedgerServiceCall(call('/v2/ledger/service/holds', 'Bearer wrong'), TOKEN), false);
assert.equal(isAuthenticatedLedgerServiceCall(call('/v2/ledger/service/holds', `Bearer ${TOKEN}x`), TOKEN), false);
assert.equal(isAuthenticatedLedgerServiceCall(call('/v2/ledger/service/holds'), TOKEN), false);
assert.equal(isAuthenticatedLedgerServiceCall(call('/v2/ledger/service/holds', TOKEN), TOKEN), false);
// Fail closed when the service token is unset, as the router does.
assert.equal(isAuthenticatedLedgerServiceCall(call('/v2/ledger/service/holds', 'Bearer '), ''), false);
assert.equal(isAuthenticatedLedgerServiceCall(call('/v2/ledger/service/holds', `Bearer ${TOKEN}`), undefined), false);
// Other paths are untouched: the user ledger, look-alike prefixes and the rest of /api.
assert.equal(isAuthenticatedLedgerServiceCall(call('/v2/ledger/balance', `Bearer ${TOKEN}`), TOKEN), false);
assert.equal(isAuthenticatedLedgerServiceCall(call('/v2/ledger/serviceX/holds', `Bearer ${TOKEN}`), TOKEN), false);
assert.equal(isAuthenticatedLedgerServiceCall(call('/chat', `Bearer ${TOKEN}`), TOKEN), false);
// The existing skip list is unchanged.
assert.equal(globalLimiterSkips('/api/v2/ledger/service/holds'), false);
assert.equal(globalLimiterSkips('/api/status'), true);

console.log('global-limiter-ledger-service: all assertions passed');
