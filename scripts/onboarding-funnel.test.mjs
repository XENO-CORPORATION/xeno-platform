/**
 * Pins the account funnel: every NEW website account reaches /onboarding
 * once, the page talks to the same session the rest of the site uses, and
 * privileged handoffs (Hub/CLI) are not stolen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AUTH_TOKEN_KEY,
  ONBOARDING_PATH,
  resolveOAuthLandingPath,
  isAllowedOnboardingNext,
  resolveActivationContinue,
  isPrivilegedReturnUrl,
} from '../src/lib/onboardingHandoff.js';
import {
  resolveOAuthLandingPath as resolveOAuthLandingPathServer,
} from '../src/server/lib/onboardingHandoff.js';

const page = readFileSync('src/pages/Onboarding.tsx', 'utf8');
const onboardingSql = readFileSync(
  'src/server/database/migrations/20260817120000-user-onboarding.sql',
  'utf8',
);
const authCtx = readFileSync('src/contexts/AuthContext.tsx', 'utf8');
const gate = readFileSync('src/components/auth/ProtectedRoute.tsx', 'utf8');
const activate = readFileSync('src/pages/ActivateAccount.tsx', 'utf8');
const oauth = readFileSync('src/server/routes/authRoutes.js', 'utf8');

test('the session key is the real one — getItem("token") would 401 every save', () => {
  assert.equal(AUTH_TOKEN_KEY, 'xenoos_auth_token');
  assert.match(page, /AUTH_TOKEN_KEY/);
  assert.equal(page.includes("getItem('token')"), false,
    'Onboarding still reads localStorage.token — that key is never written');
});

test('a new website OAuth lands on onboarding; a returning one does not', () => {
  assert.equal(resolveOAuthLandingPath('/overview', true), ONBOARDING_PATH);
  assert.equal(resolveOAuthLandingPath('/', true), ONBOARDING_PATH);
  assert.equal(resolveOAuthLandingPath(undefined, true), ONBOARDING_PATH);
  assert.equal(resolveOAuthLandingPath('/overview', false), '/overview');
});

test('Hub/CLI/OIDC handoffs are not intercepted even for a new account', () => {
  assert.equal(resolveOAuthLandingPath('xeno://auth/callback', true), 'xeno://auth/callback');
  assert.equal(resolveOAuthLandingPath('/cli-auth?session=abc', true), '/cli-auth?session=abc');
  assert.equal(resolveOAuthLandingPath('/api/oauth2/authorize?client_id=x', true),
    '/api/oauth2/authorize?client_id=x');
});

test('the OAuth builder actually calls the resolver — a copy that is never used is not a door', () => {
  assert.match(oauth, /resolveOAuthLandingPath\(returnUrl, isNew\)/);
  assert.match(oauth, /from '\.\.\/lib\/onboardingHandoff\.js'/);
  assert.equal(oauth.includes('../../lib/'), false,
    'authRoutes imported outside src/server — Dockerfile.backend cannot see that file');
});

test('the server resolver matches the website one — two copies, one rule', () => {
  assert.equal(resolveOAuthLandingPath('/overview', true), ONBOARDING_PATH);
  assert.equal(
    resolveOAuthLandingPathServer('xeno://auth/callback', true),
    resolveOAuthLandingPath('xeno://auth/callback', true),
  );
  assert.equal(
    resolveOAuthLandingPathServer('/overview', true),
    resolveOAuthLandingPath('/overview', true),
  );
});

test('activation Continue resumes a privileged grant and otherwise enters onboarding', () => {
  assert.equal(isPrivilegedReturnUrl('/api/oauth2/authorize?client_id=xeno-api-portal'), true);
  assert.equal(isPrivilegedReturnUrl('/cli-auth?session=abc'), true);
  assert.equal(isPrivilegedReturnUrl('xeno://auth/callback'), true);
  assert.equal(isPrivilegedReturnUrl('/overview'), false);
  assert.equal(isPrivilegedReturnUrl('https://evil.example/'), false);
  assert.equal(
    resolveActivationContinue('/api/oauth2/authorize?client_id=xeno-api-portal'),
    '/api/oauth2/authorize?client_id=xeno-api-portal',
  );
  assert.equal(resolveActivationContinue('/overview'), ONBOARDING_PATH);
  assert.equal(resolveActivationContinue(null), ONBOARDING_PATH);
  assert.match(activate, /destinationAfterActivation\(\)/);
  assert.equal(activate.includes("navigate('/onboarding')"), false,
    'Activate Continue is hardcoded to /onboarding — a portal signup cannot resume OIDC');
});

test('password signup does not jump to returnUrl before activate', () => {
  const authPage = readFileSync('src/pages/AuthContent.tsx', 'utf8');
  const start = authPage.indexOf("if (activeTab === 'signup')");
  assert.ok(start >= 0, 'signup branch missing');
  const signupBlock = authPage.slice(start, authPage.indexOf('return;', start) + 8);
  assert.match(signupBlock, /stashReturnUrl\(returnUrl\)/);
  assert.match(signupBlock, /navigate\('\/auth\/activate'/);
  assert.equal(signupBlock.includes('window.location.href'), false,
    'signup still jumps to returnUrl and will consume the OIDC grant before activate');
});

test('AuthContext does not consume xeno_return_url until the account is activated', () => {
  assert.match(authCtx, /\/api\/auth\/activation-status/);
  assert.match(authCtx, /if \(cancelled \|\| !d\?\.activated\) return/);
  assert.match(authCtx, /consumeReturnUrl\(\)/);
});

test('OAuth isNew without a pending returnUrl goes to onboarding, not a console.log', () => {
  assert.match(authCtx, /window\.location\.replace\(ONBOARDING_PATH\)/);
  assert.equal(authCtx.includes("Welcome to XenoStudio"), false);
});

test('protected routes ask GET /onboarding — otherwise OAuth still skips the UI', () => {
  assert.match(gate, /\/api\/auth\/onboarding/);
  assert.match(gate, /Navigate to=\{ONBOARDING_PATH\}/);
});

test('next= is allowlisted — an open redirect is refused', () => {
  assert.equal(isAllowedOnboardingNext('/dashboard'), true);
  assert.equal(isAllowedOnboardingNext('https://api.xenostudio.ai/dashboard'), true);
  assert.equal(isAllowedOnboardingNext('http://localhost:3002/dashboard'), true);
  assert.equal(isAllowedOnboardingNext('https://evil.example/phish'), false);
  assert.equal(isAllowedOnboardingNext('//evil.example'), false);
  assert.equal(isAllowedOnboardingNext('https://api.xenostudio.ai.evil.com/'), false);
  assert.equal(isAllowedOnboardingNext('javascript:alert(1)'), false);
});

test('Skip for now writes skipped — otherwise the gate is a trap', () => {
  assert.match(page, /skipped:\s*true/);
  assert.match(page, /Skip for now/);
});

test('an https next leaves the document — navigate() cannot open the portal', () => {
  assert.match(page, /window\.location\.replace\(to\)/);
});

test('a non-OK onboarding read fails OPEN — a 401 must not wall the product', () => {
  assert.match(gate, /if \(!res\.ok\)/);
});

test('user_onboarding.user_id is UUID — INTEGER cannot FK to users.id and the boot dies', () => {
  assert.match(onboardingSql, /user_id\s+UUID\s+PRIMARY KEY REFERENCES users\(id\)/);
  assert.equal(onboardingSql.includes('INTEGER PRIMARY KEY REFERENCES users'), false);
});
