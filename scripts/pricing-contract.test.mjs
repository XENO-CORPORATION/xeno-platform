import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'pricing-contract-test';

const read = (path) => readFileSync(path, 'utf8');
const onboarding = read('src/pages/Onboarding.tsx');
const pricing = read('src/pages/Pricing.tsx');
const billingPage = read('src/components/account/BillingPage.tsx');
const billingClient = read('src/services/billingService.ts');
const billingServer = read('src/server/services/billingService.js');
const workspaceRoutes = read('src/server/routes/workspaceRoutes.js');
const agentRoutes = read('src/server/routes/agentRoutes.js');
const canvasRoutes = read('src/server/routes/officeCanvasRoutes.js');
const publicDownload = read('public/download/index.html');
const landingHeader = read('src/components/landing-v3/Header.tsx');
const marketingPage = read('src/components/marketing/MarketingPage.tsx');
const publicPlatformMarketing = [
  'src/pages/Pricing.tsx',
  'src/pages/Features.tsx',
  'src/pages/About.tsx',
  'src/pages/DocsHome.tsx',
  'src/pages/Docs.tsx',
  'src/pages/Press.tsx',
  'src/pages/Partners.tsx',
  'src/pages/Careers.tsx',
  'src/pages/Roadmap.tsx',
  'src/components/landing-v3/HeroSection.tsx',
  'src/components/landing-v3/CreateWithoutLimitsSection.tsx',
  'src/components/landing-v3/PrivacyPricingSection.tsx',
  'src/components/landing-v3/Header.tsx',
];

test('every interactive purchase producer records and forwards consent', () => {
  for (const [name, source] of [['onboarding', onboarding], ['pricing', pricing], ['billing page', billingPage]]) {
    assert.match(source, /CheckoutConsent/, `${name} bypasses the checkout consent UI`);
    assert.match(source, /consentId/, `${name} does not forward the recorded consent`);
  }
});

test('public pricing shares the onboarding decision-card design', () => {
  assert.match(pricing, /import \{ PlanCard \} from '\.\.\/components\/onboarding\/OnboardingPieces'/,
    'public pricing has drifted back to its own card implementation');
  assert.match(pricing, /aria-label="Billing interval"/,
    'public pricing is missing the onboarding monthly/yearly control');
  assert.match(pricing, /contentMaxWidth=\{1240\}/,
    'the public decision surface is still constrained to the prose measure');
  assert.match(pricing, /primaryPlans[\s\S]*plan\.id !== 'studio'/,
    'the onboarding-style three-plan decision row is not explicit');
  assert.match(pricing, /studioPlan[\s\S]*highest shipped plan|studioPlan\.line/,
    'Studio disappeared while matching the onboarding three-card row');
});

test('public pricing uses a centered decision hero instead of the editorial breadcrumb layout', () => {
  assert.match(pricing, /heroAlign="center"/,
    'pricing fell back to the left-aligned prose-page hero');
  assert.match(pricing, /showHomeLink=\{false\}/,
    'the redundant Home breadcrumb returned above the pricing decision');
  assert.match(pricing, /heroActions=\{\([\s\S]*aria-label="Billing interval"[\s\S]*aria-label="Purchase assurances"/,
    'billing controls are no longer composed into the pricing hero');
  assert.doesNotMatch(pricing, /updated="[^"]+"/,
    'the pricing hero is again leading with an editorial update stamp');
  assert.match(marketingPage, /data-hero-align=\{heroAlign\}/,
    'the shared shell no longer exposes the selected hero layout for rendered verification');
  assert.match(marketingPage, /centeredHero \? 'mx-auto mt-6 max-w-\[700px\]'/,
    'the centered hero description no longer shares the headline axis');
});

test('public pricing explains access and API boundaries as decision support, not a prose appendix', () => {
  assert.match(pricing, /The access boundary/,
    'the account-to-platform boundary lost its visual introduction');
  assert.match(pricing, /aria-label="Free account assurances"/,
    'the durable Free assurances are no longer scannable');
  assert.match(pricing, /One clear commercial boundary/,
    'the platform-versus-API distinction lost its dedicated comparison surface');
  assert.match(pricing, /<details key=\{item\.q\}/,
    'pricing questions fell back to an always-expanded prose wall');
  assert.match(pricing, /<summary[\s\S]*?group-open:rotate-45/,
    'the FAQ rows are no longer visibly interactive');
  assert.doesNotMatch(pricing, /<Prose/,
    'the pricing decision support regressed to the generic editorial prose component');
});

test('public platform marketing is subscription-led, never credit-led', () => {
  const retiredCreditMarketing = /free credits|starter credit|buy credits|credits-based|shared credit balance|powered by credits|credit-based funnel|credit packs/i;
  for (const path of publicPlatformMarketing) {
    assert.doesNotMatch(read(path), retiredCreditMarketing,
      `${path} markets the API usage currency as a main-platform product`);
  }
  assert.match(pricing, /Platform subscriptions and API usage are separate/,
    'the public pricing page no longer states the platform/API commercial boundary');
  assert.match(read('src/pages/ApiReference.tsx'), /Credits & rate limits/,
    'usage billing disappeared instead of remaining on the dedicated developer surface');
  assert.match(billingPage, /Buy credits/,
    'point-of-use account billing disappeared instead of remaining available to signed-in users');
});

test('Team checkout is workspace-bound from UI through server authority', () => {
  assert.match(billingClient, /startTeamCheckout/, 'the client has no workspace Team purchase path');
  assert.match(billingClient, /\/billing\/subscribe/, 'Team does not use the workspace billing route');
  assert.match(workspaceRoutes, /itemId.*consentId|consentId.*itemId/s,
    'workspace checkout loses its exact price or consent');
  assert.match(billingServer, /if \(item\.perSeat\)[\s\S]*workspace_required/,
    'generic checkout can still sell a personal Team subscription');
  assert.match(billingServer, /createWorkspaceSeatCheckout[\s\S]*!isOffered\(item\)/,
    'workspace checkout can sell a closed Team price');
});

test('priced platform capabilities have reachable server gates', () => {
  assert.match(agentRoutes, /post\('\/', authMiddleware, requireEntitlement\('agents'\)/,
    'agent creation is not protected by the agents entitlement');
  assert.match(canvasRoutes, /put\('\/canvases\/:canvasId', requireEntitlement\('cloudSync'\)/,
    'cloud writes are not protected by the cloudSync entitlement');
  assert.match(canvasRoutes, /share', requireEntitlement\('collaboration'\)/,
    'collaboration is advertised without a reachable gate');
});

test('the agent route module loads with its entitlement middleware', async () => {
  // Source assertions cannot detect importing the right symbol from the wrong
  // module. That defect passes every regex gate and crashes the entire backend
  // at ESM instantiation, before readiness can open.
  const route = await import('../src/server/routes/agentRoutes.js');
  assert.ok(route.default, 'agent route has no default router export');
});

test('the public download directory does not publish raw CDN installer links', () => {
  assert.doesNotMatch(publicDownload, /updates\.xenostudio\.ai|\.exe|\.dmg|\.AppImage/i);
  assert.match(publicDownload, /\/product\/hub\/download/,
    'the compatibility URL no longer enters the authenticated download funnel');
});

test('global marketing navigation uses real routes and backed landing anchors', () => {
  assert.match(landingHeader, /label: 'Pricing', href: '\/pricing'/);
  assert.match(landingHeader, /to="\/product\/hub\/download"/);
  assert.doesNotMatch(landingHeader, /href="#(?:explore|create|innovate|pricing)"/);
  for (const [anchor, source] of [
    ['explore', read('src/components/landing-v3/ProductsShowcase.tsx')],
    ['create', read('src/components/landing-v3/FlowSection.tsx')],
    ['innovate', read('src/components/landing-v3/UseCasesSection.tsx')],
    ['pricing', read('src/components/landing-v3/PrivacyPricingSection.tsx')],
  ]) {
    assert.match(source, new RegExp(`id=["']${anchor}["']`), `missing landing anchor: ${anchor}`);
  }
});

test('the shared public header gains a readable surface only after scrolling', () => {
  assert.match(landingHeader, /window\.scrollY > 16/,
    'the shared header no longer has an explicit top-versus-scrolled threshold');
  assert.match(landingHeader, /addEventListener\('scroll', syncScrolledState, \{ passive: true \}\)/,
    'the header scroll listener is missing or no longer passive');
  assert.match(landingHeader, /data-scrolled=\{hasScrolled \? 'true' : 'false'\}/,
    'the rendered header no longer exposes its scroll state for verification');
  assert.match(landingHeader, /border-white\/\[0\.08\].*bg-\[rgba\(6,6,6,0\.92\)\].*backdrop-blur-xl/,
    'the scrolled state no longer supplies the dark surface, divider, and blur');
  assert.match(landingHeader, /border-transparent bg-transparent shadow-none backdrop-blur-none/,
    'the top-of-page header is no longer transparent');
  assert.doesNotMatch(landingHeader, /<header[^>]*backdrop-blur-xl/,
    'backdrop blur moved onto the header ancestor and can break its fixed mega-menus');
});

test('retired public pricing claims cannot silently return', () => {
  const surfaces = [onboarding, pricing, billingPage, read('src/config/pricing.ts'), read('src/components/common/UpgradePrompt.tsx')].join('\n');
  for (const stale of [/€30/, /No per-app pricing ever/i, /Every app installs/i, /Upgrade to Pro/i]) {
    assert.doesNotMatch(surfaces, stale);
  }
});

test('Studio owner entitlement actually raises the workspace seat limit', async () => {
  const { workspaceSeatInfo } = await import('../src/server/utils/workspaceContext.js');
  const db = {
    async query(sql) {
      if (/SELECT owner_user_id, metadata FROM workspaces/.test(sql)) {
        return { rows: [{ owner_user_id: 'owner-1', metadata: {} }] };
      }
      if (/CREATE TABLE IF NOT EXISTS billing_customers/.test(sql)) return { rows: [] };
      if (/SELECT plan, status, current_period_end FROM xeno_account_plans/.test(sql)) {
        return { rows: [{ plan: 'studio', status: 'active', current_period_end: null }] };
      }
      if (/workspace_invites/.test(sql)) return { rows: [{ c: 2 }] };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  const info = await workspaceSeatInfo(db, 'workspace-1', 3);
  assert.deepEqual(info, { limit: 25, used: 5, plan: 'studio', seat_limit: 25 });
});
