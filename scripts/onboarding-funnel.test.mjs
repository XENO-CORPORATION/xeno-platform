/**
 * Pins the account funnel: every NEW website account reaches /onboarding
 * once, the page talks to the same session the rest of the site uses, and
 * privileged handoffs (Hub/CLI) are not stolen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ONBOARDING_PATH,
  ONBOARDING_WELCOME_PATH,
  resolveOAuthLandingPath,
  isAllowedOnboardingNext,
  resolveActivationContinue,
  isPrivilegedReturnUrl,
  welcomePathForDestination,
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
const welcome = readFileSync('src/components/modals/WelcomeCreditBonusModal.tsx', 'utf8');
const welcomeCss = readFileSync('src/components/modals/welcome-credit-bonus.css', 'utf8');
const overview = readFileSync('src/pages/Overview.tsx', 'utf8');
const welcomeMigration = readFileSync(
  'src/server/database/migrations/20260903120000-onboarding-welcome-handoff.sql',
  'utf8',
);

test('onboarding uses the cookie-session bridge and never reads a persisted bearer', () => {
  assert.match(page, /getAccessToken\(\)/);
  assert.doesNotMatch(page, /localStorage\.(?:getItem|setItem)\([^)]*(?:xenoos_auth_token|['"]token['"])/);
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
  assert.doesNotMatch(gate, /import\.meta\.env\.DEV\s*\|\|\s*!isAuthenticated/,
    'development auth remains in the checking state forever');
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

test('the plan step FINISHES without a purchase — otherwise the gate is a trap', () => {
  // Skip was removed by request (scripts/keyboard-flow.test.mjs holds that
  // line). Continue is the only way forward, so the anti-trap property moved:
  // the LAST step's Continue must call finish() — which writes completed and
  // leaves — and must never be disabled. No plan is purchasable while Stripe
  // is unconfigured, so a plan step that demanded one would strand everybody.
  // Scoped to finish(). `completed: true` also appears in startCheckout(), so
  // a file-wide match would stay green with finish() gutted. Bounded by the
  // next declaration rather than a multi-line regex — that pattern is one
  // escape away from silently matching nothing.
  const fStart = page.indexOf('const finish = async');
  assert.ok(fStart > -1, 'finish() is gone — re-verify the flow still completes');
  const fEnd = page.indexOf('const back', fStart);
  assert.ok(fEnd > fStart, 'cannot bound finish() — re-verify it records completion');
  const finishBody = page.slice(fStart, fEnd);
  assert.match(finishBody, /completed:\s*true/, 'finish() no longer records completion');

  const planNav = page.match(/<Nav onBack=\{\(\) => back\(2\)\}[^/]*\/>/);
  assert.ok(planNav, 'the plan step Nav changed shape — re-verify it still finishes');
  assert.match(planNav[0], /onNext=\{\(\) => finish\(\)\}/, 'the last step no longer finishes');
  assert.doesNotMatch(planNav[0], /nextDisabled/, 'the plan step Continue can be disabled — that is the trap');
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

test('completed onboarding hands internal destinations to a dedicated welcome route', () => {
  assert.equal(welcomePathForDestination('/overview/projects'),
    `${ONBOARDING_WELCOME_PATH}?next=%2Foverview%2Fprojects`);
  assert.equal(welcomePathForDestination('https://evil.example'),
    `${ONBOARDING_WELCOME_PATH}?next=%2Foverview`);
  assert.match(page, /navigate\(welcomePathForDestination\(to\), \{ replace: true \}\)/);
  assert.match(overview, /<Route path="welcome" element=\{<WelcomeCreditBonusModal \/>\}/);
  assert.doesNotMatch(overview, /isWelcomeModalOpen|user\.credits === 0/);
});

test('the routed welcome automatically provisions the real ledger grant', () => {
  assert.match(welcome, /className="xeno-welcome"/);
  assert.match(welcome, /authService\.claimBonusCredits\(\)/);
  assert.match(welcome, /xeno:credits-updated/);
  assert.match(welcome, /\/api\/auth\/onboarding\/welcome\/acknowledge/);
  assert.match(welcome, /Enter workspace/);
  assert.doesNotMatch(welcome, /role="dialog"|aria-modal|Activate welcome balance/);
});

test('the welcome surface does not revive stale subscription prices or unlimited-credit claims', () => {
  assert.doesNotMatch(welcome, /\$19|\$99|Unlimited credits|Premium models|or upgrade for more/);
  assert.doesNotMatch(welcome, /Review plan and billing/);
});

test('the welcome surface shares the canonical dark auth and onboarding visual grammar', () => {
  assert.doesNotMatch(welcome, /<AuthMark \/>|xeno-welcome-header|Workspace ready/);
  assert.match(welcome, /from '\.\.\/\.\.\/lib\/icons'/);
  assert.doesNotMatch(welcome, /from 'lucide-react'/);
  assert.match(welcomeCss, /--welcome-ground:\s*var\(--xeno-theme-canvas\)/);
  assert.match(welcomeCss, /grid-template-rows:\s*minmax\(0, 1fr\)/);
  assert.match(welcomeCss, /grid-template-columns:\s*minmax\(0, 1fr\) clamp\(400px, 34vw, 520px\)/);
  assert.doesNotMatch(welcomeCss, /grid-template-columns:\s*minmax\(0,\s*1\.36fr\)\s+minmax\(350px,\s*0\.64fr\)/);
  assert.doesNotMatch(welcomeCss, /xeno-welcome-header|welcome-shell-row/);
  assert.match(welcomeCss, /--welcome-recessed:\s*var\(--xeno-theme-surface\)/);
  assert.match(welcomeCss, /--welcome-dialog:\s*var\(--xeno-theme-surface-raised\)/);
  assert.match(welcomeCss, /\.xeno-welcome-access\s*\{[\s\S]*?background:\s*var\(--welcome-ground\)/);
  assert.match(welcome, /className="xeno-welcome-launch-shell"/);
  assert.match(welcome, /className="xeno-welcome-access-shell"/);
  assert.match(welcomeCss, /\.xeno-welcome-launch-shell\s*\{[\s\S]*?gap:\s*2px;[\s\S]*?padding:\s*4px;[\s\S]*?border:\s*1px solid var\(--welcome-border\)/);
  assert.match(welcomeCss, /\.xeno-welcome-starts\s*\{[\s\S]*?gap:\s*1px;[\s\S]*?background:\s*var\(--welcome-border\)/);
  assert.match(welcomeCss, /\.xeno-welcome-starts > button:hover\s*\{[\s\S]*?background:\s*var\(--welcome-dialog\)/);
  assert.match(welcomeCss, /\.xeno-welcome-starts > button:focus-visible\s*\{[\s\S]*?background:\s*var\(--welcome-dialog\);[\s\S]*?outline:\s*2px solid var\(--welcome-border-strong\)/);
  assert.doesNotMatch(welcomeCss, /\.xeno-welcome-starts > button:(?:hover|focus-visible)[^\{]*\{[^\}]*?(?:border|box-shadow|transform)\s*:/);
  assert.match(welcomeCss, /\.xeno-welcome-access-shell\s*\{[\s\S]*?gap:\s*2px;[\s\S]*?padding:\s*4px;[\s\S]*?border:\s*1px solid var\(--welcome-border\)/);
  assert.doesNotMatch(welcomeCss, /rgba\(17,\s*17,\s*21|radial-gradient/);
  assert.match(welcomeCss, /border-radius:\s*6px/);
  assert.doesNotMatch(welcomeCss, /#f7f7f8|#fafafa|box-shadow/);
});

test('the welcome preview is development-only and cannot mutate account state', () => {
  assert.match(welcome, /isPreview = import\.meta\.env\.DEV/);
  assert.match(welcome, /if \(isPreview\)/);
  assert.match(overview, /legacyWelcomePreview = import\.meta\.env\.DEV/);
});

test('welcome state is server-owned, idempotent, and preserves established users', () => {
  assert.match(oauth, /welcomeAcknowledged: Boolean\(row\?\.welcome_acknowledged_at\)/);
  assert.match(oauth, /router\.post\('\/onboarding\/welcome\/acknowledge'/);
  assert.match(oauth, /already_claimed: true/);
  assert.match(oauth, /addGrantTx\(client, user\.id/);
  assert.match(welcomeMigration, /ADD COLUMN IF NOT EXISTS welcome_acknowledged_at/);
  assert.match(welcomeMigration, /WHERE welcome_acknowledged_at IS NULL/);
});
