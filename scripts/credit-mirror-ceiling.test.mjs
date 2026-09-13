import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  legacyMirrorCredits, LEGACY_CREDITS_MAX, LEGACY_CREDITS_MIN, MICRO_PER_CREDIT,
} from '../src/server/utils/creditLedgerV2.js';

const micro = (credits) => BigInt(credits) * BigInt(MICRO_PER_CREDIT);

/*
 * users.credits is a Postgres `integer`. Before this, a balance above 2,147,483,647
 * credits made the mirror UPDATE throw 22003 inside the money transaction — the grant
 * or spend itself failed. Reproduced on the live image on 2026-09-13.
 */

test('ordinary balances mirror exactly', () => {
  assert.equal(legacyMirrorCredits(micro(0)), 0n);
  assert.equal(legacyMirrorCredits(micro(2148)), 2148n, 'the int4mul line on .224 is not a line here');
  assert.equal(legacyMirrorCredits(micro(999_999_999)), 999_999_999n);
  assert.equal(legacyMirrorCredits(1_500_000n), 1n, 'fractional credits truncate, as before');
});

test('the int4 ceiling saturates instead of throwing', () => {
  assert.equal(legacyMirrorCredits(micro(2_147_483_647)), LEGACY_CREDITS_MAX, 'exactly at the ceiling');
  assert.equal(legacyMirrorCredits(micro(2_147_483_648)), LEGACY_CREDITS_MAX, 'one credit past it');
  assert.equal(legacyMirrorCredits(micro(2_999_999_999)), LEGACY_CREDITS_MAX, 'the reproduced case');
  assert.equal(legacyMirrorCredits(9_000_000_000_000_000_000n), LEGACY_CREDITS_MAX, 'near the bigint ledger ceiling');
});

test('the floor saturates too', () => {
  assert.equal(legacyMirrorCredits(-micro(3_000_000_000)), LEGACY_CREDITS_MIN);
});

test('every value it returns fits a Postgres integer', () => {
  for (const c of [0n, 1n, 2_147_483_647n, 2_147_483_648n, 10n ** 12n, -(10n ** 12n)]) {
    const v = legacyMirrorCredits(c * BigInt(MICRO_PER_CREDIT));
    assert.ok(v <= 2_147_483_647n && v >= -2_147_483_648n, `${c} credits mirrored to ${v}`);
  }
});

test('the mirror write actually goes through the saturating helper', () => {
  // Built, tested and unreachable is the shape this estate keeps shipping.
  const src = readFileSync(new URL('../src/server/utils/creditLedgerV2.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('async function mirrorLegacy('), src.indexOf('async function mirrorLegacy(') + 400);
  assert.match(body, /const whole = legacyMirrorCredits\(balanceMicro\);/);
  assert.match(body, /UPDATE users SET credits = \$1/);
});
