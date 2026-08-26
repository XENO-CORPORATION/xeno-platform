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

test('every interactive purchase producer records and forwards consent', () => {
  for (const [name, source] of [['onboarding', onboarding], ['pricing', pricing], ['billing page', billingPage]]) {
    assert.match(source, /CheckoutConsent/, `${name} bypasses the checkout consent UI`);
    assert.match(source, /consentId/, `${name} does not forward the recorded consent`);
  }
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
