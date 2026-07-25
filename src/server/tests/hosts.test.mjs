/**
 * hosts.test.mjs — proves the hostname seam is a RUNTIME NO-OP.
 *
 * This is the whole point of `src/server/config/hosts.js`: it centralises ~13
 * scattered hostname literals so a future domain migration is a config change,
 * WITHOUT changing a single byte of today's behaviour.
 *
 * Two halves, both asserted here:
 *   1. NO-OP  — with no env set, every accessor returns exactly the literal it
 *               replaced at the call site.
 *   2. SEAM   — with env set, every accessor moves, and the pre-existing
 *               call-site-specific env vars still take precedence over the new
 *               generic ones.
 *
 * Pure unit test. No network, no DB — it must run anywhere, unlike the
 * `.test.js` suites in this directory which smoke a live host.
 *
 * Run: node src/server/tests/hosts.test.mjs
 */

import assert from 'node:assert/strict';
import test from 'node:test';

const MODULE_URL = new URL('../config/hosts.js', import.meta.url).href;

/**
 * Import a FRESH copy of the module with a given env applied. The module reads
 * process.env inside accessor functions rather than at module scope, but we
 * cache-bust anyway so the test cannot be fooled by evaluation order.
 */
async function withEnv(env, fn) {
  const saved = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    const mod = await import(`${MODULE_URL}?t=${Math.random()}`);
    await fn(mod);
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

/** Every host env var this module or its call sites can read. */
const CLEARED = {
  XENO_SITE_ORIGIN: undefined,
  XENO_API_ORIGIN: undefined,
  XENO_UPDATES_ORIGIN: undefined,
  XENO_ALIAS_SITE_ORIGINS: undefined,
  XENO_API_ORIGINS_EXTRA: undefined,
  MAIL_PRIMARY_DOMAIN: undefined,
  OIDC_ISSUER: undefined,
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. NO-OP: the frozen defaults ARE the literals that used to be hardcoded.
// ─────────────────────────────────────────────────────────────────────────────

test('with no env set, every host resolves to its pre-seam literal', async () => {
  await withEnv(CLEARED, (h) => {
    // src/server/utils/oidcProvider.js:26 — `process.env.OIDC_ISSUER || 'https://xenostudio.ai'`
    assert.equal(h.issuer(), 'https://xenostudio.ai');
    // src/server/index.js CORS default; authRoutes FRONTEND_URL/APP_URL;
    // cliAuthRoutes WEB_BASE_URL; workspaceRoutes; billingService.
    assert.equal(h.siteOrigin(), 'https://xenostudio.ai');
    assert.equal(h.siteHost(), 'xenostudio.ai');
    // src/server/index.js xenoImageClient; routes/xenoRoutes.js:66; utils/xenoChat.js:9
    assert.equal(h.apiOrigin(), 'https://api.xenostudio.ai');
    // middleware/cdnOptimization.js:120; routes/productDownloadRoutes.js:19;
    // routes/healthRoutes.js:127; services/extensionReleaseService.js
    assert.equal(h.updatesOrigin(), 'https://updates.xenostudio.ai');
    // routes/authRoutes.js, handleRoutes.js, v2MeRoutes.js, oidcProvider.js
    assert.equal(h.mailDomain(), 'xenostudio.ai');
  });
});

test('derived URLs reproduce the exact strings they replaced', async () => {
  await withEnv(CLEARED, (h) => {
    // authRoutes.js OAuth callbacks
    assert.equal(h.siteUrl('/api/auth/google/callback'), 'https://xenostudio.ai/api/auth/google/callback');
    assert.equal(h.siteUrl('/api/auth/github/callback'), 'https://xenostudio.ai/api/auth/github/callback');
    assert.equal(h.siteUrl('/api/auth/twitter/callback'), 'https://xenostudio.ai/api/auth/twitter/callback');
    // marketplace-seed.js
    assert.equal(h.siteUrl('/products/pixel/icon.png'), 'https://xenostudio.ai/products/pixel/icon.png');
    assert.equal(
      h.updatesUrl('/apps/pixel/version.json'),
      'https://updates.xenostudio.ai/apps/pixel/version.json',
    );
    // extensionReleaseService.js
    assert.equal(
      h.updatesUrl('/apps/extension/releases.json'),
      'https://updates.xenostudio.ai/apps/extension/releases.json',
    );
    // index.js xenoImageClient / xenoRoutes.js / xenoChat.js
    assert.equal(`${h.apiOrigin()}/v1`, 'https://api.xenostudio.ai/v1');
  });
});

test('the CORS default array is byte-identical to the pre-seam literal', async () => {
  await withEnv(CLEARED, (h) => {
    // src/server/index.js used to hardcode exactly this array.
    assert.deepEqual(
      [...h.acceptedSiteOrigins(), 'http://localhost:5173', 'http://localhost:4040'],
      [
        'https://xenostudio.ai',
        'https://www.xenostudio.ai',
        'http://localhost:5173',
        'http://localhost:4040',
      ],
    );
  });
});

test('the OIDC redirect allowlist is a SINGLE entry by default (no implicit www)', async () => {
  await withEnv(CLEARED, (h) => {
    // migrate-oidc-clients.js:38 used to hardcode exactly one redirect URI.
    // Synthesising a www. twin would silently widen an OAuth allowlist.
    assert.deepEqual(h.siteUrlVariants('/auth/callback'), ['https://xenostudio.ai/auth/callback']);
    assert.deepEqual(h.aliasSiteOrigins(), []);
    assert.deepEqual(h.aliasApiOrigins(), []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SEAM: the override works, and legacy per-call-site vars still win.
// ─────────────────────────────────────────────────────────────────────────────

test('generic overrides move every derived host', async () => {
  await withEnv(
    {
      ...CLEARED,
      XENO_SITE_ORIGIN: 'https://example.test',
      XENO_API_ORIGIN: 'https://api.example.test',
      XENO_UPDATES_ORIGIN: 'https://updates.example.test',
    },
    (h) => {
      assert.equal(h.siteOrigin(), 'https://example.test');
      assert.equal(h.siteHost(), 'example.test');
      assert.equal(h.apiOrigin(), 'https://api.example.test');
      assert.equal(h.updatesOrigin(), 'https://updates.example.test');
      // The issuer follows the site origin when OIDC_ISSUER is unset.
      assert.equal(h.issuer(), 'https://example.test');
      assert.equal(h.siteUrl('/auth/callback'), 'https://example.test/auth/callback');
      assert.equal(h.updatesUrl('/apps/pixel/version.json'), 'https://updates.example.test/apps/pixel/version.json');
    },
  );
});

test('OIDC_ISSUER still overrides the site origin (legacy var wins)', async () => {
  await withEnv(
    { ...CLEARED, XENO_SITE_ORIGIN: 'https://example.test', OIDC_ISSUER: 'https://pinned.test/' },
    (h) => {
      assert.equal(h.issuer(), 'https://pinned.test'); // trailing slash stripped, as before
      assert.equal(h.siteOrigin(), 'https://example.test');
    },
  );
});

test('MAIL_PRIMARY_DOMAIN is pinned independently of the site origin', async () => {
  // Q8 of the rebrand plan: handle@domain is persisted into users.email and the
  // gateway resolves users by email. Moving it is a data migration, so it must
  // NOT ride along when the site origin moves.
  await withEnv({ ...CLEARED, XENO_SITE_ORIGIN: 'https://example.test' }, (h) => {
    assert.equal(h.mailDomain(), 'xenostudio.ai');
  });
  await withEnv({ ...CLEARED, MAIL_PRIMARY_DOMAIN: 'Example.TEST' }, (h) => {
    assert.equal(h.mailDomain(), 'example.test');
  });
});

test('alias origins ADD to the accepted set without moving the canonical one', async () => {
  await withEnv(
    {
      ...CLEARED,
      XENO_ALIAS_SITE_ORIGINS: 'https://xenosystem.ai, https://www.xenosystem.ai',
      XENO_API_ORIGINS_EXTRA: 'https://api.xenosystem.ai',
    },
    (h) => {
      // Canonical identity is unchanged — this is the dual-home shape.
      assert.equal(h.siteOrigin(), 'https://xenostudio.ai');
      assert.equal(h.issuer(), 'https://xenostudio.ai');
      assert.equal(h.apiOrigin(), 'https://api.xenostudio.ai');
      // ...but both hosts are now accepted.
      assert.deepEqual(h.acceptedSiteOrigins(), [
        'https://xenostudio.ai',
        'https://www.xenostudio.ai',
        'https://xenosystem.ai',
        'https://www.xenosystem.ai',
      ]);
      assert.deepEqual(h.acceptedApiOrigins(), [
        'https://api.xenostudio.ai',
        'https://api.xenosystem.ai',
      ]);
      assert.deepEqual(h.siteUrlVariants('/auth/callback'), [
        'https://xenostudio.ai/auth/callback',
        'https://xenosystem.ai/auth/callback',
        'https://www.xenosystem.ai/auth/callback',
      ]);
    },
  );
});

test('trailing slashes and whitespace are normalised away', async () => {
  await withEnv({ ...CLEARED, XENO_SITE_ORIGIN: '  https://example.test///  ' }, (h) => {
    assert.equal(h.siteOrigin(), 'https://example.test');
  });
});

test('an empty-string override falls through to the default, it does not blank the host', async () => {
  await withEnv({ ...CLEARED, XENO_SITE_ORIGIN: '' }, (h) => {
    assert.equal(h.siteOrigin(), 'https://xenostudio.ai');
  });
});
