/* ──────────────────────────────────────────────────────────────────────
 * XENO product catalog — the single source of truth for the product pages.
 *
 * Every product the marketing site links to lives here. The product-page
 * template (`/product/:slug`) is fully driven by this registry, so adding a
 * product = one entry here (+ its releases.json on R2 once it ships).
 *
 * STATUS / DELIVERY decide which CTA + page variant a product shows. They MUST
 * match what a visitor can actually get today — a 'desktop' product with no
 * assets in its R2 feed renders a dead "Builds coming soon" button, and a
 * 'soon' product whose installer is already public tells a live user to wait.
 *   delivery 'web'     → runs inside xenostudio.ai → CTA "Open"
 *   delivery 'desktop' → downloadable installer     → CTA "Download" + releases
 *   delivery 'cli'     → npm / terminal install      → CTA "Install" + releases
 *   delivery 'soon'    → not shipping yet            → CTA "Get notified"
 *
 * `externalUrl` overrides the CTA with a plain external link — for products
 * distributed somewhere other than the R2 feed (e.g. a public GitHub release).
 * `repoPublic` gates the "View on GitHub" / "Follow development" links: every
 * XENO repo except xeno-rt is private, and linking one 404s for the public.
 * ────────────────────────────────────────────────────────────────────── */

import { UPDATES_ORIGIN } from '../config/hosts';

export const R2_BASE = UPDATES_ORIGIN;

export type Delivery = 'web' | 'desktop' | 'cli' | 'soon';
export type Status = 'shipping' | 'beta' | 'coming-soon';

export interface Product {
  slug: string;            // url + R2 app id (kebab). e.g. 'pixel'
  name: string;            // 'XENO Pixel'
  tagline: string;         // one line under the title
  category: string;        // matches the Products mega-menu group
  status: Status;
  delivery: Delivery;
  /** R2 app folder for version.json / releases.json (defaults to slug) */
  r2?: string;
  /** web apps: in-app destination for the "Open" CTA */
  launchPath?: string;
  /** cli: the install command shown on the page */
  install?: string;
  /** Optional schema.org override when a product supports fewer platforms than its delivery class. */
  operatingSystem?: string;
  repo?: string;
  /** True only when github.com/XENO-CORPORATION/<repo> is publicly readable. */
  repoPublic?: boolean;
  /** Distributed off-site (public GitHub release, hosted app): overrides the CTA. */
  externalUrl?: string;
  externalLabel?: string;
}

/** XENO X → 'pixel', 'XENO 3D Gen' → '3d-gen', 'XENO Agent CLI' → 'agent-cli' */
export function slugify(label: string): string {
  return label
    .replace(/^XENO\s+/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const PRODUCTS: Product[] = [
  // ── Flagship ──────────────────────────────────────────────
  { slug: 'hub', name: 'XENO Hub', tagline: 'The all-in-one launcher for every XENO app, agent and credit.', category: 'Platform', status: 'shipping', delivery: 'desktop', operatingSystem: 'Windows', repo: 'xeno-hub' },

  // ── Generate (web, in-app) ────────────────────────────────
  { slug: 'image', name: 'XENO Image', tagline: 'Generate images from a prompt with 20+ frontier models.', category: 'Generate', status: 'shipping', delivery: 'web', launchPath: '/auth' },
  { slug: 'video', name: 'XENO Video', tagline: 'Generate and edit video with AI pipelines.', category: 'Generate', status: 'shipping', delivery: 'web', launchPath: '/auth' },
  { slug: 'audio', name: 'XENO Audio', tagline: 'Generate voice, music and sound effects.', category: 'Generate', status: 'shipping', delivery: 'web', launchPath: '/auth' },
  { slug: '3d-gen', name: 'XENO 3D Gen', tagline: 'Generate 3D models and scenes from a prompt.', category: 'Generate', status: 'beta', delivery: 'web', launchPath: '/auth' },

  // ── Create ────────────────────────────────────────────────
  { slug: 'pixel', name: 'XENO Pixel', tagline: 'AI-native image editing, design and upscaling.', category: 'Create', status: 'beta', delivery: 'desktop', operatingSystem: 'Windows', repo: 'xeno-pixel' },
  // photo + layout (Design, below) are DOCUMENTATION SCAFFOLDS: 412 lines of
  // markdown and one commit each, zero product source. Both READMEs say
  // "nothing here ships yet". coming-soon/soon is correct — but do not let the
  // page copy imply a designed product. See src/content/products/photo.ts.
  { slug: 'photo', name: 'XENO Photo', tagline: 'RAW import, organize, retouch and cloud sync.', category: 'Create', status: 'coming-soon', delivery: 'soon', repo: 'xeno-photo' },
  { slug: 'motion', name: 'XENO Motion', tagline: 'Video editing, motion graphics and AI pipelines.', category: 'Create', status: 'beta', delivery: 'desktop', operatingSystem: 'Windows', repo: 'xeno-motion' },
  { slug: 'sound', name: 'XENO Sound', tagline: 'Audio editing, music and voice production.', category: 'Create', status: 'beta', delivery: 'desktop', operatingSystem: 'Windows', repo: 'xeno-sound' },

  // ── Design ────────────────────────────────────────────────
  { slug: 'canvas', name: 'XENO Canvas', tagline: 'Multiplayer UI & product design with components.', category: 'Design', status: 'beta', delivery: 'desktop', operatingSystem: 'Windows', repo: 'xeno-canvas' },
  { slug: 'layout', name: 'XENO Layout', tagline: 'Multi-page layouts for print and digital.', category: 'Design', status: 'coming-soon', delivery: 'soon', repo: 'xeno-layout' },
  { slug: '3d', name: 'XENO 3D', tagline: '3D modeling, rendering and asset creation.', category: 'Design', status: 'coming-soon', delivery: 'soon', repo: 'xeno-3d' },
  { slug: 'architect', name: 'XENO Architect', tagline: 'Architecture, CAD, BIM and interior design.', category: 'Design', status: 'coming-soon', delivery: 'soon', repo: 'xeno-architect' },

  // ── Office ────────────────────────────────────────────────
  { slug: 'docs', name: 'XENO Docs', tagline: 'AI-native document editing.', category: 'Office', status: 'beta', delivery: 'desktop', operatingSystem: 'Windows', repo: 'xeno-docs' },
  // Sheets 0.2.0 (2026-07-27) is the first build that actually carries the formula
  // engine — the withdrawn 0.1.0 scaffold was packaged ~70 min BEFORE the engine
  // commit landed. Verified in the packaged asar, not just the build log: the
  // HyperFormula wrapper config is in the renderer bundle, file:open/file:save are
  // in the main bundle and Toolbar.tsx really calls them, and the app launches.
  // Experimental + unsigned; the precise framing lives in src/content/products/sheets.ts.
  { slug: 'sheets', name: 'XENO Sheets', tagline: 'Spreadsheets with AI built in.', category: 'Office', status: 'beta', delivery: 'desktop', operatingSystem: 'Windows', repo: 'xeno-sheets' },
  // 🔴 Slides stays coming-soon DELIBERATELY — do not promote it without re-checking.
  // Its engines are real and 789 tests pass, but NOTHING IN THE APP CALLS THEM:
  //   · all four export engines (PptxExportEngine/HtmlExportEngine/VideoExportEngine/
  //     Mp4ExportEngine) have zero references outside engine/export/ and tests/, so
  //     Rollup tree-shakes them out — verified 0 export literals in the shipped bundle;
  //   · the preload exposes openFile/saveFileDialog/exportImagesDialog/saveBatch and the
  //     renderer never calls any of them; there is no application menu and the toolbar's
  //     only action is "Present".
  // So a user cannot open, save-as, or export anything — only edit and autosave to
  // ~/.xeno/slides/{id}.json. Publishing it would repeat the 0.1.0 scaffold mistake.
  // Ship it when the export engines and the file dialogs are wired to real UI.
  { slug: 'slides', name: 'XENO Slides', tagline: 'Presentations with AI built in.', category: 'Office', status: 'coming-soon', delivery: 'soon', repo: 'xeno-slides' },
  { slug: 'pdf', name: 'XENO PDF', tagline: 'Edit, convert, sign and chat with PDFs.', category: 'Office', status: 'coming-soon', delivery: 'soon', repo: 'xeno-pdf' },

  // ── Library ───────────────────────────────────────────────
  { slug: 'stock', name: 'XENO Stock', tagline: 'Royalty-free and AI-generated media.', category: 'Library', status: 'coming-soon', delivery: 'soon', repo: 'xeno-stock' },
  { slug: 'fonts', name: 'XENO Fonts', tagline: 'Browse and sync fonts for any project.', category: 'Library', status: 'coming-soon', delivery: 'soon', repo: 'xeno-fonts' },
  { slug: 'assets', name: 'XENO Assets', tagline: 'Central DAM with versions and review.', category: 'Library', status: 'coming-soon', delivery: 'soon', repo: 'xeno-assets' },
  // Notes 0.2.0 (2026-07-27) is the first build that actually carries links + graph —
  // the withdrawn 0.1.0 scaffold was packaged ~60 min BEFORE the engine commit landed.
  // Verified in the packaged asar: the wikiLink TipTap mark and Backlinks UI are in the
  // renderer bundle, d3's force-simulation internals (__zoom/velocityDecay/alphaTarget)
  // are compiled in and GraphView is rendered from App.tsx, notes:findBacklinks is in the
  // main bundle, and the app launches. Windows only. Experimental + unsigned; search is
  // MiniSearch (lexical), NOT semantic — see src/content/products/notes.ts.
  { slug: 'notes', name: 'XENO Notes', tagline: 'Notes and knowledge base with AI.', category: 'Library', status: 'beta', delivery: 'desktop', operatingSystem: 'Windows', repo: 'xeno-notes' },

  // ── Connect ───────────────────────────────────────────────
  // Internal alpha, not a beta: unsigned installer, alpha test accounts, agents + E2EE
  // not enabled in the shipped build. 'beta' is the coarsest honest Status we have;
  // the precise framing lives in src/content/products/comms.ts. See that file's header.
  { slug: 'comms', name: 'XENO Comms', tagline: 'Messaging for humans and agents — internal alpha.', category: 'Connect', status: 'beta', delivery: 'desktop', operatingSystem: 'Windows', repo: 'xeno-comms' },
  // Post runs on its OWN host (post.xenostudio.ai), not a path under xenostudio.ai,
  // so it uses `externalUrl` like xeno-rt rather than `launchPath`. Verified live
  // 2026-07-26: /, /login (real email+password form), /dashboard, /settings, /privacy,
  // /terms and /data-deletion all return 200, and all five containers (web, api,
  // worker, postgres, redis) report healthy on xeno-post-001.
  { slug: 'post', name: 'XENO Post', tagline: '25+ platform social media command center.', category: 'Connect', status: 'beta', delivery: 'web', repo: 'xeno-post', externalUrl: 'https://post.xenostudio.ai', externalLabel: 'Open XENO Post' },
  { slug: 'browser', name: 'XENO Browser', tagline: 'The agent-native browser that works the web for you.', category: 'Connect', status: 'beta', delivery: 'desktop', operatingSystem: 'Windows', repo: 'xeno-browser' },
  // Extension: the public R2 channel was withdrawn and there is no web-store
  // listing yet, so there is nothing to download — 'soon' keeps the CTA honest.
  { slug: 'extension', name: 'XENO Extension', tagline: 'Bring the XENO agent to Chrome and Edge.', category: 'Connect', status: 'coming-soon', delivery: 'soon', operatingSystem: 'Chrome, Edge, Brave (Chromium)', r2: 'extension', repo: 'xeno-extension' },

  // ── Build ─────────────────────────────────────────────────
  { slug: 'engine', name: 'XENO Engine', tagline: 'ECS game engine, physics and multiplayer.', category: 'Build', status: 'coming-soon', delivery: 'soon', repo: 'xeno-engine' },
  { slug: 'workflow', name: 'XENO Workflow', tagline: 'Visual node-based automation pipelines.', category: 'Build', status: 'beta', delivery: 'desktop', operatingSystem: 'Windows', repo: 'xeno-workflow' },
  { slug: 'use', name: 'XENO Use', tagline: "The agent's hands across every device.", category: 'Build', status: 'coming-soon', delivery: 'soon', repo: 'xeno-use' },
  { slug: 'apps', name: 'XENO Apps', tagline: 'No-code custom apps and internal tools.', category: 'Build', status: 'coming-soon', delivery: 'soon', repo: 'xeno-apps' },

  // ── Develop ───────────────────────────────────────────────
  // The CLI moved to the @xenosystem scope too: npm `latest` is
  // @xenosystem/agent-cli@0.5.17, while @xeno-corporation/xeno-agent-cli is
  // frozen at 0.4.45. Both resolve — which is exactly why the stale command was
  // dangerous rather than obviously broken: it silently installed an older CLI.
  { slug: 'agent-cli', name: 'XENO Agent CLI', tagline: 'Code, automate and control your workspace from the terminal.', category: 'Develop', status: 'beta', delivery: 'cli', install: 'npm install -g @xenosystem/agent-cli', repo: 'xeno-agent-cli' },
  // NOT migrated on purpose. @xenosystem/agent-sdk@0.8.12 is ahead of
  // @xeno-corporation/xeno-agent-sdk@0.7.0, but the SDK docs (src/content/docs/
  // sdk.ts) carry ~25 code samples that `import` the legacy specifier. Changing
  // this line alone would tell a reader to install one package and import
  // another. Migrate the install command and every sample in one pass, or not
  // at all — a half-migrated SDK doc is worse than a version-behind one.
  { slug: 'sdk', name: 'XENO SDK', tagline: 'Embed XENO agents into any app.', category: 'Develop', status: 'beta', delivery: 'cli', install: 'npm install @xeno-corporation/xeno-agent-sdk', repo: 'xeno-agent-sdk' },
  // ACP moved to the @xenosystem npm scope. npm `latest` is @xenosystem/acp@0.1.1;
  // @xeno-corporation/xeno-acp is frozen at 0.1.0. The page, this install command
  // and the R2 feed must all name the SAME identity — @xenosystem — or a visitor
  // installs the older scope by following our own instructions.
  { slug: 'acp', name: 'XENO ACP', tagline: 'Drive approved ACP coding agents through one API.', category: 'Develop', status: 'beta', delivery: 'cli', install: 'npm install -g @xenosystem/acp', operatingSystem: 'Windows, Linux', repo: 'xeno-acp' },
  // RT ships as a public GitHub release, not through the R2 feed — so the CTA
  // links there instead of rendering a dead download. The archives are
  // checksummed, SBOM'd and provenance-attested but NOT code-signed; this
  // comment previously said "signed binaries", which was false. Unsigned is the
  // accepted posture; claiming signed is not.
  // Keep delivery 'soon': the branch this merged from still had 'desktop', which
  // would re-render the dead R2 download button this line exists to remove.
  { slug: 'rt', name: 'XENO RT', tagline: 'Run frontier models locally — private and fast.', category: 'Develop', status: 'beta', delivery: 'soon', operatingSystem: 'Windows, Linux', repo: 'xeno-rt', repoPublic: true, externalUrl: 'https://github.com/XENO-CORPORATION/xeno-rt/releases/latest', externalLabel: 'Get the latest release on GitHub' },
  // Shell ships a PUBLIC unsigned Windows beta (apps/shell/v0.1.0-beta.1, beta
  // channel) — so it is beta/desktop, not coming-soon/soon. Tagline stays scoped
  // to what the build does: it is a host layer; no XENO app runs inside it yet.
  { slug: 'shell', name: 'XENO Shell', tagline: 'A desktop shell with a real terminal and folder-level permissions.', category: 'Develop', status: 'beta', delivery: 'desktop', operatingSystem: 'Windows', repo: 'xeno-shell' },
  // Anima SHIPS. All 8 packages are live on npm at 0.0.2 (verified against the
  // registry 2026-07-27), so 'coming-soon'/'soon' was telling visitors a product
  // they can install does not exist. It also suppressed an upgrade signal that
  // MATTERS: 0.0.1 is published and DEPRECATED for a security defect (missing
  // SDK dispatch_agent permission gate). Anyone who found 0.0.1 from search got
  // no warning from this site. The 0.0.1 → 0.0.2 notice is carried explicitly in
  // src/content/products/anima.ts — do not drop it while 0.0.1 remains installable.
  // NOTE: https://get.xenostudio.ai/anima (in the repo README) is NXDOMAIN.
  // npm is the only real install path — never put that host on the page.
  { slug: 'anima', name: 'XENO Anima', tagline: 'Your personal, always-on agent — it remembers you and gets better.', category: 'Develop', status: 'beta', delivery: 'cli', install: 'npm install -g @xenosystem/anima', repo: 'xeno-anima' },
];

const BY_SLUG = new Map(PRODUCTS.map((p) => [p.slug, p]));
export function getProduct(slug?: string): Product | undefined {
  return slug ? BY_SLUG.get(slug) : undefined;
}

/* ──────────────────────────────────────────────────────────────────────
 * Release feed — per product, read from R2 (matches the existing pipeline:
 * updates.xenostudio.ai/apps/{app}/releases.json). Tolerant of an empty/
 * missing feed (returns []), so a pre-launch product never errors.
 * ────────────────────────────────────────────────────────────────────── */

export type ReleaseType = 'release' | 'patch' | 'hotfix';
export type ReleaseChannel = 'stable' | 'beta';

export interface ReleaseAsset { label: string; file: string; size?: number; sha256?: string }
export interface Release {
  version: string;
  date: string;
  latest?: boolean;
  type?: ReleaseType;
  channel?: ReleaseChannel;
  severity?: 'normal' | 'critical';
  title?: string;
  notes: string;                 // markdown / plain text
  assets?: { windows?: ReleaseAsset[]; mac?: ReleaseAsset[]; linux?: ReleaseAsset[] };
}

export async function fetchReleases(p: Product): Promise<Release[]> {
  const app = p.r2 ?? p.slug;
  try {
    const res = await fetch(`${R2_BASE}/apps/${app}/releases.json`, { cache: 'no-cache' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : Array.isArray(data?.releases) ? data.releases : [];
  } catch {
    return [];
  }
}

export function latestRelease(releases: Release[]): Release | undefined {
  return releases.find((r) => r.latest) ?? releases[0];
}

/* ──────────────────────────────────────────────────────────────────────
 * Asset URL helpers (PRODUCT-PAGES-SPEC.md §5.3 / §4). One place builds the
 * R2 URL so every page agrees on the format.
 * ────────────────────────────────────────────────────────────────────── */

/** Absolute R2 URL for a release asset. `file` is RELATIVE to apps/:app/
 *  (e.g. "v0.4.1/Setup.exe"). Encode each path segment (spaces → %20) while
 *  keeping the "/" separators. Accepts a Product or a bare app/slug string. */
export function assetUrl(p: Product | string, file: string): string {
  const app = typeof p === 'string' ? p : (p.r2 ?? p.slug);
  const path = file.split('/').map(encodeURIComponent).join('/');
  return `${R2_BASE}/apps/${app}/${path}`;
}

/** Stable backend download deep-link — 302s to the current installer and never
 *  changes as versions bump (SPEC §4). Use for "download the latest" CTAs. */
export function downloadLink(p: Product, os: 'windows' | 'mac' | 'linux', version?: string): string {
  const o = os === 'windows' ? 'win' : os;
  return `/product/${p.slug}/download/${o}${version ? `/${encodeURIComponent(version)}` : ''}`;
}
