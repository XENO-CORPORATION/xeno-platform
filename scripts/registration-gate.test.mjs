/**
 * Pins the registration gate (src/server/middleware/registrationGate.js).
 *
 * This is a security control, so the tests assert the FAIL-SAFE direction
 * explicitly: the interesting case is not "closed when told to be closed", it is
 * "closed when told nothing at all". A gate that only works when configured
 * correctly is the gate that broke open in this ecosystem before.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRegistrationOpen,
  registrationDecision,
  assertRegistrationAllowed,
  assertAccountUsable,
  requireRegistrationOpen,
  AccountCreationBlockedError,
  AccountSuspendedError,
} from '../src/server/middleware/registrationGate.js';

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// --- the fail-safe default -------------------------------------------------

test('registration is CLOSED when REGISTRATION_OPEN is unset', () => {
  withEnv({ REGISTRATION_OPEN: undefined, REGISTRATION_ALLOWLIST: undefined }, () => {
    assert.equal(isRegistrationOpen(), false);
    assert.equal(registrationDecision('someone@gmail.com').allowed, false);
  });
});

test('registration is CLOSED for every near-miss value', () => {
  // A typo, a bare "1", or a leftover empty string must not open signups.
  // NB: 'TRUE ' is NOT here — surrounding whitespace and case are tolerated on
  // the explicit opt-in (see the next test), so it legitimately opens.
  for (const value of ['', ' ', '1', 'yes', 'true1', 'truthy', 'open', 'false', 'null', 'undefined']) {
    withEnv({ REGISTRATION_OPEN: value, REGISTRATION_ALLOWLIST: undefined }, () => {
      assert.equal(isRegistrationOpen(), false, `"${value}" must not open registration`);
    });
  }
});

test("registration opens ONLY on the exact string 'true' (case/space tolerant)", () => {
  for (const value of ['true', 'TRUE', ' true ', 'True']) {
    withEnv({ REGISTRATION_OPEN: value }, () => {
      assert.equal(isRegistrationOpen(), true, `"${value}" should open registration`);
    });
  }
});

// --- allowlist -------------------------------------------------------------

test('allowlist admits a specific email while closed', () => {
  withEnv({ REGISTRATION_OPEN: undefined, REGISTRATION_ALLOWLIST: 'me@bnkrsys.com' }, () => {
    assert.equal(registrationDecision('me@bnkrsys.com').allowed, true);
    assert.equal(registrationDecision('ME@BNKRSYS.COM').allowed, true, 'must be case-insensitive');
    assert.equal(registrationDecision('other@gmail.com').allowed, false);
  });
});

test('allowlist admits a whole domain with the @ prefix', () => {
  withEnv({ REGISTRATION_OPEN: undefined, REGISTRATION_ALLOWLIST: '@bnkrsys.com' }, () => {
    assert.equal(registrationDecision('anyone@bnkrsys.com').allowed, true);
    assert.equal(registrationDecision('anyone@gmail.com').allowed, false);
  });
});

test('a bare domain without @ does NOT admit the whole domain', () => {
  // 'bnkrsys.com' is an exact-email entry, not a domain rule. If this ever
  // silently became a domain match, one malformed entry would open a provider.
  withEnv({ REGISTRATION_OPEN: undefined, REGISTRATION_ALLOWLIST: 'gmail.com' }, () => {
    assert.equal(registrationDecision('anyone@gmail.com').allowed, false);
  });
});

test('missing/empty email is refused while closed', () => {
  withEnv({ REGISTRATION_OPEN: undefined, REGISTRATION_ALLOWLIST: '@bnkrsys.com' }, () => {
    assert.equal(registrationDecision(undefined).allowed, false);
    assert.equal(registrationDecision('').allowed, false);
    assert.equal(registrationDecision(null).allowed, false);
  });
});

// --- throwing form (the OAuth auto-create path) ----------------------------

test('assertRegistrationAllowed throws AccountCreationBlockedError when closed', () => {
  withEnv({ REGISTRATION_OPEN: undefined, REGISTRATION_ALLOWLIST: undefined }, () => {
    assert.throws(() => assertRegistrationAllowed('new@gmail.com'), AccountCreationBlockedError);
    assert.throws(() => assertRegistrationAllowed('new@gmail.com'), (e) => e.code === 'registration_closed' && e.statusCode === 403);
  });
});

test('assertRegistrationAllowed passes when open', () => {
  withEnv({ REGISTRATION_OPEN: 'true' }, () => {
    assert.doesNotThrow(() => assertRegistrationAllowed('new@gmail.com'));
  });
});

// --- suspension, enforced on EVERY sign-in path ----------------------------

test('assertAccountUsable refuses a suspended account', () => {
  assert.throws(() => assertAccountUsable({ is_active: false, status: 'active' }), AccountSuspendedError);
  assert.throws(() => assertAccountUsable({ is_active: true, status: 'suspended' }), AccountSuspendedError);
  assert.throws(() => assertAccountUsable({ is_active: true, status: 'SUSPENDED' }), AccountSuspendedError);
  assert.throws(() => assertAccountUsable({ is_active: true, deleted_at: '2026-01-01' }), AccountSuspendedError);
});

test('assertAccountUsable allows a normal account', () => {
  assert.doesNotThrow(() => assertAccountUsable({ is_active: true, status: 'active' }));
  assert.doesNotThrow(() => assertAccountUsable(null));
  assert.doesNotThrow(() => assertAccountUsable(undefined));
});

test('suspension is independent of the registration flag', () => {
  // Reopening signups must not resurrect suspended accounts.
  withEnv({ REGISTRATION_OPEN: 'true' }, () => {
    assert.throws(() => assertAccountUsable({ is_active: false }), AccountSuspendedError);
  });
});

// --- express middleware ----------------------------------------------------

function runMiddleware(body) {
  let statusCode = null; let payload = null; let nextCalled = false;
  const res = {
    status(c) { statusCode = c; return this; },
    json(p) { payload = p; return this; },
  };
  requireRegistrationOpen({ body }, res, () => { nextCalled = true; });
  return { statusCode, payload, nextCalled };
}

test('middleware 403s with a machine-readable code when closed', () => {
  withEnv({ REGISTRATION_OPEN: undefined, REGISTRATION_ALLOWLIST: undefined }, () => {
    const r = runMiddleware({ email: 'x@gmail.com' });
    assert.equal(r.nextCalled, false, 'must not fall through to the handler');
    assert.equal(r.statusCode, 403);
    assert.equal(r.payload.code, 'registration_closed');
    assert.equal(r.payload.success, false);
  });
});

test('middleware calls next() when open', () => {
  withEnv({ REGISTRATION_OPEN: 'true' }, () => {
    assert.equal(runMiddleware({ email: 'x@gmail.com' }).nextCalled, true);
  });
});

test('middleware survives a missing body (no email supplied)', () => {
  withEnv({ REGISTRATION_OPEN: undefined }, () => {
    const r = runMiddleware(undefined);
    assert.equal(r.statusCode, 403);
    assert.equal(r.nextCalled, false);
  });
});
