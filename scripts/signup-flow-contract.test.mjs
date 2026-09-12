import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const ONBOARDING = read('../src/pages/Onboarding.tsx');
const EMAIL = read('../src/server/services/emailService.js');
const AUTH = read('../src/server/routes/authRoutes.js');
const HEADER = read('../src/components/landing-v3/Header.tsx');

/*
 * Four things a brand-new user hits in the first two minutes, each found by
 * WALKING the signup in a browser rather than by reading the code. None of them
 * failed a test, because none of them is a crash — they are a confusing email, a
 * consent default, a placeholder and a stale brand. That is exactly the class a
 * suite misses and a person notices immediately.
 */

test('marketing consent is NEVER pre-ticked', () => {
  /*
   * 🔴 GDPR Art. 4(11) requires a clear affirmative action, and the CJEU settled
   * pre-ticked boxes in Planet49 (C-673/17). For a German seller § 7 UWG applies
   * to the email on top. This defaulted to TRUE, so every account created before
   * 2026-09-12 opted in by not noticing.
   */
  assert.match(ONBOARDING, /marketingOptIn: false/,
    'the onboarding consent default must be false');
  assert.ok(!/marketingOptIn:\s*true/.test(ONBOARDING),
    'nothing may default marketing consent to true');
});

test('the six-digit code reaches the mail the product tells people to open', () => {
  /*
   * The activation screen says "We sent a six-digit code … enter it below".
   * The code used to exist ONLY in the welcome mail, while the message actually
   * titled "Verify your XENO email" carried a link and nothing else — so the
   * on-screen instruction could not be followed with the email it pointed at.
   */
  const tpl = EMAIL.slice(EMAIL.indexOf('email_verification: ('));
  const body = tpl.slice(0, tpl.indexOf('receipt: ('));
  assert.match(body, /activationCode/,
    'the verification template must accept an activation code');
  assert.match(body, /codeBlock\(activationCode/,
    'and must render it');
});

test('the code is minted ONCE and shared, never minted per mail', () => {
  /*
   * Each mint invalidates the previous code, so minting separately for the two
   * mails would mean whichever arrived first stopped working — worse than the
   * bug it would be fixing.
   */
  /* Assert the CALL, not a window of text around it. Slicing N characters after
   * the call and grepping for "activationCode" passes vacuously — the
   * verification send a few lines below mentions it, so removing the argument
   * from the welcome call left this green. Verified by mutation. */
  assert.match(AUTH, /sendWelcomeEmail\(req\.db, user, \{ activationCode \}\)/,
    'registration must pass the pre-minted code to the welcome mail');
  assert.ok(
    (AUTH.match(/mintActivationCode\(req\.db, user\.id/g) || []).length === 1,
    'registration must mint the activation code exactly once',
  );
  assert.match(EMAIL, /activationCode\s*\n?\s*\?\s*Promise\.resolve\(activationCode\)/,
    'sendWelcomeEmail must reuse a supplied code rather than minting its own',
  );
});

test('customer-facing mail carries the current brand, not the pre-rebrand one', () => {
  // The first thing a customer ever receives should not be signed with the name
  // the company stopped using.
  assert.ok(!/XENO Studio/.test(EMAIL),
    'email templates must not say "XENO Studio"');
});

test('no placeholder puts a real person\'s name in front of a stranger', () => {
  // The name field suggested "Emilian" — the founder — to every new signup.
  assert.ok(!/placeholder="Emilian"/.test(ONBOARDING),
    'the onboarding name placeholder must be a generic example');
});

test('the marketing header reflects whether you are signed in', () => {
  /*
   * 🔴 It rendered "Sign in" unconditionally, so a signed-in user landing on the
   * homepage — the most likely first surface of a RETURN visit — was told to
   * sign in. Reported from real use, not caught by any test, because nothing
   * crashes: the page is simply wrong about who you are.
   */
  assert.match(HEADER, /useAuth\(\)/, 'the header must read auth state');
  assert.match(HEADER, /isAuthenticated \?/, 'and branch on it');
  assert.match(HEADER, /to="\/overview"/, 'a signed-in visitor gets a way into the workspace');

  /*
   * isLoading is not optional polish. The session resolves asynchronously, so
   * without it a returning user sees "Sign in", then watches it change — which
   * reads as a bug even though the end state is right.
   */
  assert.match(HEADER, /isLoading \?/, 'the header must not render a signed-out CTA while auth is unresolved');

  // Both breakpoints. A desktop-only fix leaves the phone wrong, and the mobile
  // menu is a separate render tree that is easy to miss.
  assert.ok((HEADER.match(/Open workspace/g) || []).length >= 2,
    'desktop AND mobile menus must both reflect the signed-in state');
});
