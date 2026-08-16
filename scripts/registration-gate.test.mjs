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
import { readFileSync } from 'node:fs';
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

// --- the time-boxed window (REGISTRATION_OPEN_UNTIL) ------------------------
//
// This is the "reopen it until the 28th" mechanism. The whole point is that it
// closes ITSELF, so these tests care most about the expiry and the malformed
// cases resolving CLOSED rather than open-forever.

test('window OPEN before the deadline', () => {
  withEnv({ REGISTRATION_OPEN: undefined, REGISTRATION_OPEN_UNTIL: '2026-08-28' }, () => {
    assert.equal(isRegistrationOpen(new Date('2026-08-11T12:00:00Z')), true);
  });
});

test('a bare date is INCLUSIVE of that whole day (UTC)', () => {
  withEnv({ REGISTRATION_OPEN: undefined, REGISTRATION_OPEN_UNTIL: '2026-08-28' }, () => {
    assert.equal(isRegistrationOpen(new Date('2026-08-28T23:59:00Z')), true, 'still open on the day itself');
    assert.equal(isRegistrationOpen(new Date('2026-08-29T00:00:01Z')), false, 'closed the next day');
  });
});

test('window CLOSES ITSELF after the deadline — no human action required', () => {
  withEnv({ REGISTRATION_OPEN: undefined, REGISTRATION_OPEN_UNTIL: '2026-08-28' }, () => {
    assert.equal(isRegistrationOpen(new Date('2026-09-01T00:00:00Z')), false);
    assert.equal(isRegistrationOpen(new Date('2027-01-01T00:00:00Z')), false);
  });
});

test('a MALFORMED deadline is CLOSED, never open-forever', () => {
  for (const bad of ['soon', '28-08-2026', 'August 28', '2026-13-45', '', '   ']) {
    withEnv({ REGISTRATION_OPEN: undefined, REGISTRATION_OPEN_UNTIL: bad }, () => {
      assert.equal(isRegistrationOpen(new Date('2026-08-11T12:00:00Z')), false,
        `"${bad}" must not open registration`);
    });
  }
});

test('the window still respects an explicit REGISTRATION_OPEN=true', () => {
  withEnv({ REGISTRATION_OPEN: 'true', REGISTRATION_OPEN_UNTIL: '2020-01-01' }, () => {
    assert.equal(isRegistrationOpen(new Date('2026-08-11T12:00:00Z')), true,
      'an explicit true wins over an expired window');
  });
});

test('an expired window refuses account creation through the throwing path too', () => {
  withEnv({ REGISTRATION_OPEN: undefined, REGISTRATION_OPEN_UNTIL: '2020-01-01', REGISTRATION_ALLOWLIST: undefined }, () => {
    assert.throws(() => assertRegistrationAllowed('late@gmail.com'), AccountCreationBlockedError);
  });
});

// ── /handle-available must report ELIGIBILITY, not just availability ────────
//
// 🔴 This exists because the two were conflated, and the consequence was DATED.
//
// `/register-with-handle` carries requireRegistrationOpen. `/handle-available`
// did not — it reported only whether the handle was free. So with signups
// closed, XENO Mail's signup page shows a green "Available" and a
// "Create you@xenostudio.ai" button, and the click fails. Recorded as
// xeno-mail/STATUS.md §5.8.
//
// What makes it worth a gate rather than a fix: the box sets
// REGISTRATION_OPEN_UNTIL=2026-08-28 for the YC window, so this turns from
// working to broken on the 29th with nobody touching the code. A defect on a
// timer is the kind nothing catches until a user hits it.
//
// Asserted against SOURCE because exercising the route needs an express app and
// a database; what must never regress is that the handler consults the gate at
// all, and that it does not collapse the two answers into one boolean.

test('/handle-available consults the registration gate', () => {
  const src = readFileSync(
    new URL('../src/server/routes/authRoutes.js', import.meta.url), 'utf8');
  const start = src.indexOf("router.get('/handle-available'");
  assert.ok(start > -1, 'the /handle-available route still exists');
  const handler = src.slice(start, src.indexOf('router.', start + 10));

  assert.match(handler, /isRegistrationOpen\s*\(/,
    'the handler does not consult isRegistrationOpen — with signups closed it will '
    + 'report a claimable handle that /register-with-handle then refuses');
  assert.match(handler, /signupOpen/,
    'the response does not carry signupOpen, so no client can tell "free" from "claimable"');
});

test('availability and eligibility stay SEPARATE fields', () => {
  // Collapsing them into `ok` would make a closed signup indistinguishable from
  // a taken handle — telling someone their name is taken when it is free is a
  // worse lie than the one being fixed.
  const src = readFileSync(
    new URL('../src/server/routes/authRoutes.js', import.meta.url), 'utf8');
  const start = src.indexOf("router.get('/handle-available'");
  const handler = src.slice(start, src.indexOf('router.', start + 10));

  assert.match(handler, /ok:\s*true/,
    'the free-handle branch must still report ok:true — ok means "the handle is free"');
  assert.ok(!/ok:\s*signupOpen|ok:\s*.*&&\s*signupOpen/.test(handler),
    'ok has been made dependent on signupOpen — that conflates "taken" with "closed"');
});
