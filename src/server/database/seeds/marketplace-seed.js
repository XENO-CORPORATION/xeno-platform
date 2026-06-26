/**
 * XENO Marketplace seed — first-party `official` listings (SPEC §1, D2).
 *
 * Idempotent: keyed on listing.slug. Re-running upserts rows, never duplicates.
 * Seeds two shelves of `official` content:
 *   1. The 15 first-party creative/office/corpo apps as `app-native` listings
 *      (ids/names/categories/versions copied from xeno-hub CREATIVE_APPS). These
 *      are openly distributed — artifact_url points at R2 directly (not gated).
 *   2. The local-model catalog (data/localModelCatalog.json) as `model` listings,
 *      reusing each model's installSpec (R2 key + sha256 + license). Free.
 *
 * Run:  node src/server/database/seeds/marketplace-seed.js
 * (Uses the same DATABASE_URL / DB_* env vars as the rest of the server.)
 */

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MODEL_CATALOG_PATH = path.resolve(__dirname, '../../data/localModelCatalog.json');

// ── First-party apps (mirrors xeno-hub/src/main/ipc/apps.ts CREATIVE_APPS) ──
// version.json on R2 keeps these current at runtime; these are seed/fallback rows.
const CREATIVE_APPS = [
  { id: 'pixel',     name: 'XENO Pixel',     category: 'studio',     version: '0.2.0', description: 'Professional image editor — layers, brushes, filters, and AI-powered editing tools' },
  { id: 'motion',    name: 'XENO Motion',    category: 'studio',     version: '0.2.0', description: 'Video editor and motion graphics — timeline, compositing, effects, and AI assistance' },
  { id: 'sound',     name: 'XENO Sound',     category: 'studio',     version: '0.2.0', description: 'Digital audio workstation — multitrack recording, mixing, mastering, and AI enhancement' },
  { id: 'architect', name: 'XENO Architect', category: 'studio',     version: '0.2.0', description: 'Architecture & CAD — BIM, parametric design, 2D drafting, and AI-powered architecture tools' },
  { id: '3d',        name: 'XENO 3D',        category: 'studio',     version: '0.2.0', description: '3D modeling, sculpting, animation & rendering — polygon editing, path tracing, and procedural tools' },
  { id: 'engine',    name: 'XENO Engine',    category: 'studio',     version: '0.2.0', description: 'Game engine — ECS, real-time rendering, physics, scripting, and cross-platform export' },
  { id: 'workflow',  name: 'XENO Workflow',  category: 'automation', version: '0.2.0', description: 'Visual workflow automation — AI-native pipelines connecting all XENO apps and external services' },
  { id: 'docs',      name: 'XENO Docs',      category: 'office',     version: '0.2.0', description: 'Document editor — rich text, DOCX import/export, collaboration, templates, and AI writing assistance' },
  { id: 'sheets',    name: 'XENO Sheets',    category: 'office',     version: '0.2.0', description: 'Spreadsheet — formulas, charts, pivot tables, virtual grid, and AI-powered data analysis' },
  { id: 'slides',    name: 'XENO Slides',    category: 'office',     version: '0.2.0', description: 'Presentations — slide engine, transitions, presenter mode, templates, and AI slide generation' },
  { id: 'notes',     name: 'XENO Notes',     category: 'office',     version: '0.2.0', description: 'Knowledge base — markdown, bi-directional linking, graph view, daily notes, and AI search' },
  { id: 'mail',      name: 'XENO Mail',      category: 'corpo',      version: '0.2.0', description: 'Email client — IMAP/SMTP, unified inbox, smart filters, encryption, and AI-powered email composition' },
  { id: 'calendar',  name: 'XENO Calendar',  category: 'corpo',      version: '0.2.0', description: 'Calendar & scheduling — CalDAV sync, recurring events, shared calendars, and AI scheduling assistant' },
  { id: 'chat',      name: 'XENO Chat',      category: 'corpo',      version: '0.2.0', description: 'Team messaging — channels, threads, file sharing, voice messages, and AI-powered conversation search' },
  { id: 'meet',      name: 'XENO Meet',      category: 'corpo',      version: '0.2.0', description: 'Video conferencing — HD video calls, screen sharing, recording, transcription, and AI meeting notes' },
];

function appInstallerFilename(name, version) {
  return `${name} Setup ${version}.exe`;
}
function appDownloadUrl(id, name, version) {
  const file = encodeURIComponent(appInstallerFilename(name, version));
  return `https://updates.xenostudio.ai/apps/${id}/v${version}/${file}`;
}

/**
 * Upsert one official listing + (optionally) a version + a free pricing row.
 * @returns {Promise<string>} listing id
 */
async function upsertOfficialListing(client, {
  slug, kind, title, summary, description, category, iconUrl,
  version, artifactUrl, artifactR2Key, sha256, license, installMeta = {},
}) {
  const { rows } = await client.query(
    `INSERT INTO marketplace_listings
       (slug, kind, developer_id, title, summary, description, category, trust_tier,
        icon_url, screenshots, license, status, current_version, is_first_party, install_meta, published_at)
     VALUES ($1,$2,NULL,$3,$4,$5,$6,'official',$7,'[]'::jsonb,$8,'published',$9,true,$10::jsonb, NOW())
     ON CONFLICT (slug) DO UPDATE SET
       kind = EXCLUDED.kind, title = EXCLUDED.title, summary = EXCLUDED.summary,
       description = EXCLUDED.description, category = EXCLUDED.category,
       trust_tier = 'official', icon_url = EXCLUDED.icon_url, license = EXCLUDED.license,
       status = 'published', current_version = EXCLUDED.current_version,
       is_first_party = true, install_meta = EXCLUDED.install_meta, updated_at = NOW()
     RETURNING id`,
    [slug, kind, title, summary, description, category, iconUrl, license, version || null, JSON.stringify(installMeta)],
  );
  const listingId = rows[0].id;

  // Free pricing (official first-party content is free to install).
  await client.query(
    `INSERT INTO marketplace_listing_pricing (listing_id, model, price_credits)
     VALUES ($1, 'free', 0)
     ON CONFLICT (listing_id, model) DO UPDATE SET is_active = true`,
    [listingId],
  );

  // Version row (open distribution: artifact_url set, so not entitlement-gated).
  if (version) {
    await client.query(
      `INSERT INTO marketplace_listing_versions
         (listing_id, version, artifact_r2_key, artifact_url, artifact_sha256, declared_capabilities, manifest, published_at)
       VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,$6::jsonb, NOW())
       ON CONFLICT (listing_id, version) DO UPDATE SET
         artifact_r2_key = EXCLUDED.artifact_r2_key, artifact_url = EXCLUDED.artifact_url,
         artifact_sha256 = EXCLUDED.artifact_sha256, manifest = EXCLUDED.manifest`,
      [listingId, version, artifactR2Key || null, artifactUrl || null, sha256 || null,
       JSON.stringify({ kind, official: true })],
    );
  }
  return listingId;
}

export async function seedMarketplace(pool) {
  const client = await pool.connect();
  let apps = 0, models = 0;
  try {
    await client.query('BEGIN');

    // 1. First-party apps → app-native official listings.
    for (const app of CREATIVE_APPS) {
      await upsertOfficialListing(client, {
        slug: `app-${app.id}`,
        kind: 'app-native',
        title: app.name,
        summary: app.description.slice(0, 500),
        description: app.description,
        category: app.category,
        iconUrl: `https://xenostudio.ai/products/${app.id}/icon.png`,
        version: app.version,
        artifactUrl: appDownloadUrl(app.id, app.name, app.version),
        artifactR2Key: `apps/${app.id}/v${app.version}/${appInstallerFilename(app.name, app.version)}`,
        sha256: null, // native installer hashes live in R2 latest.yml; not duplicated here
        license: 'Proprietary — XENO Corporation',
        installMeta: {
          executableName: `${app.name}.exe`,
          installDirName: app.name,
          versionUrl: `https://updates.xenostudio.ai/apps/${app.id}/version.json`,
        },
      });
      apps++;
    }

    // 2. Local model catalog → model official listings.
    if (fs.existsSync(MODEL_CATALOG_PATH)) {
      const catalog = JSON.parse(fs.readFileSync(MODEL_CATALOG_PATH, 'utf-8'));
      for (const m of (catalog.models || [])) {
        const spec = m.installSpec || null;
        await upsertOfficialListing(client, {
          slug: `model-${m.id}`,
          kind: 'model',
          title: m.name,
          summary: (m.description || '').slice(0, 500),
          description: m.description || null,
          category: m.category || 'model',
          iconUrl: null,
          version: catalog.catalogVersion || '1.0.0',
          // Models are gated by license but distributed via the existing signed-URL
          // path: store the R2 key (no public artifact_url) so download/:id signs it.
          artifactUrl: null,
          artifactR2Key: spec?.artifactKey || null,
          sha256: spec?.sha256 || null,
          license: m.license || null,
          installMeta: {
            provider: m.provider || null,
            runtime: m.runtime || null,
            size: m.size || null,
            parameters: m.parameters || null,
            filename: spec?.filename || null,
          },
        });
        models++;
      }
    } else {
      console.warn('[Seed] localModelCatalog.json not found, skipping model listings');
    }

    await client.query('COMMIT');
    console.warn(`[Seed] Marketplace seeded: ${apps} apps, ${models} models (official).`);
    return { apps, models };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Seed] Marketplace seed failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

// Allow running standalone: `node marketplace-seed.js`
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (invokedDirectly) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5433,
    database: process.env.DB_NAME || 'xenostudio',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'xenostudio_password',
  });
  seedMarketplace(pool)
    .then((r) => { console.warn('[Seed] Done:', r); return pool.end(); })
    .then(() => process.exit(0))
    .catch((err) => { console.error('[Seed] Error:', err.message); process.exit(1); });
}

export default seedMarketplace;
