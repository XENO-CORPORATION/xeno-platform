/* ──────────────────────────────────────────────────────────────────────
 * XENO product catalog — the single source of truth for the product pages.
 *
 * Every product the marketing site links to lives here. The product-page
 * template (`/product/:slug`) is fully driven by this registry, so adding a
 * product = one entry here (+ its releases.json on R2 once it ships).
 *
 * STATUS / DELIVERY are my best guess — correct them freely; they only change
 * which CTA + page variant a product shows, nothing structural.
 *   delivery 'web'     → runs inside xenostudio.ai → CTA "Open"
 *   delivery 'desktop' → downloadable installer     → CTA "Download" + releases
 *   delivery 'cli'     → npm / terminal install      → CTA "Install" + releases
 *   delivery 'soon'    → not shipping yet            → CTA "Join the waitlist"
 * ────────────────────────────────────────────────────────────────────── */

export const R2_BASE = 'https://updates.xenostudio.ai';

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
  repo?: string;
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
  { slug: 'hub', name: 'XENO Hub', tagline: 'The all-in-one launcher for every XENO app, agent and credit.', category: 'Platform', status: 'shipping', delivery: 'desktop', repo: 'xeno-hub' },

  // ── Generate (web, in-app) ────────────────────────────────
  { slug: 'image', name: 'XENO Image', tagline: 'Generate images from a prompt with 20+ frontier models.', category: 'Generate', status: 'shipping', delivery: 'web', launchPath: '/auth' },
  { slug: 'video', name: 'XENO Video', tagline: 'Generate and edit video with AI pipelines.', category: 'Generate', status: 'shipping', delivery: 'web', launchPath: '/auth' },
  { slug: 'audio', name: 'XENO Audio', tagline: 'Generate voice, music and sound effects.', category: 'Generate', status: 'shipping', delivery: 'web', launchPath: '/auth' },
  { slug: '3d-gen', name: 'XENO 3D Gen', tagline: 'Generate 3D models and scenes from a prompt.', category: 'Generate', status: 'beta', delivery: 'web', launchPath: '/auth' },

  // ── Create ────────────────────────────────────────────────
  { slug: 'pixel', name: 'XENO Pixel', tagline: 'AI-native image editing, design and upscaling.', category: 'Create', status: 'beta', delivery: 'desktop', repo: 'xeno-pixel' },
  { slug: 'photo', name: 'XENO Photo', tagline: 'RAW import, organize, retouch and cloud sync.', category: 'Create', status: 'coming-soon', delivery: 'soon', repo: 'xeno-photo' },
  { slug: 'motion', name: 'XENO Motion', tagline: 'Video editing, motion graphics and AI pipelines.', category: 'Create', status: 'beta', delivery: 'desktop', repo: 'xeno-motion' },
  { slug: 'sound', name: 'XENO Sound', tagline: 'Audio editing, music and voice production.', category: 'Create', status: 'beta', delivery: 'desktop', repo: 'xeno-sound' },

  // ── Design ────────────────────────────────────────────────
  { slug: 'canvas', name: 'XENO Canvas', tagline: 'Multiplayer UI & product design with components.', category: 'Design', status: 'coming-soon', delivery: 'soon', repo: 'xeno-canvas' },
  { slug: 'layout', name: 'XENO Layout', tagline: 'Multi-page layouts for print and digital.', category: 'Design', status: 'coming-soon', delivery: 'soon', repo: 'xeno-layout' },
  { slug: '3d', name: 'XENO 3D', tagline: '3D modeling, rendering and asset creation.', category: 'Design', status: 'coming-soon', delivery: 'soon', repo: 'xeno-3d' },
  { slug: 'architect', name: 'XENO Architect', tagline: 'Architecture, CAD, BIM and interior design.', category: 'Design', status: 'coming-soon', delivery: 'soon', repo: 'xeno-architect' },

  // ── Office ────────────────────────────────────────────────
  { slug: 'docs', name: 'XENO Docs', tagline: 'AI-native document editing.', category: 'Office', status: 'coming-soon', delivery: 'soon', repo: 'xeno-docs' },
  { slug: 'sheets', name: 'XENO Sheets', tagline: 'Spreadsheets with AI built in.', category: 'Office', status: 'coming-soon', delivery: 'soon', repo: 'xeno-sheets' },
  { slug: 'slides', name: 'XENO Slides', tagline: 'Presentations with AI built in.', category: 'Office', status: 'coming-soon', delivery: 'soon', repo: 'xeno-slides' },
  { slug: 'pdf', name: 'XENO PDF', tagline: 'Edit, convert, sign and chat with PDFs.', category: 'Office', status: 'coming-soon', delivery: 'soon', repo: 'xeno-pdf' },

  // ── Library ───────────────────────────────────────────────
  { slug: 'stock', name: 'XENO Stock', tagline: 'Royalty-free and AI-generated media.', category: 'Library', status: 'coming-soon', delivery: 'soon', repo: 'xeno-stock' },
  { slug: 'fonts', name: 'XENO Fonts', tagline: 'Browse and sync fonts for any project.', category: 'Library', status: 'coming-soon', delivery: 'soon', repo: 'xeno-fonts' },
  { slug: 'assets', name: 'XENO Assets', tagline: 'Central DAM with versions and review.', category: 'Library', status: 'coming-soon', delivery: 'soon', repo: 'xeno-assets' },
  { slug: 'notes', name: 'XENO Notes', tagline: 'Notes and knowledge base with AI.', category: 'Library', status: 'coming-soon', delivery: 'soon', repo: 'xeno-notes' },

  // ── Connect ───────────────────────────────────────────────
  { slug: 'comms', name: 'XENO Comms', tagline: 'Human and agent communication for teams.', category: 'Connect', status: 'beta', delivery: 'desktop', repo: 'xeno-comms' },
  { slug: 'post', name: 'XENO Post', tagline: '25+ platform social media command center.', category: 'Connect', status: 'coming-soon', delivery: 'soon', repo: 'xeno-post' },
  { slug: 'browser', name: 'XENO Browser', tagline: 'The agent-native browser that works the web for you.', category: 'Connect', status: 'coming-soon', delivery: 'soon', repo: 'xeno-browser' },
  { slug: 'extension', name: 'XENO Extension', tagline: 'Bring the XENO agent to Chrome and Edge.', category: 'Connect', status: 'shipping', delivery: 'desktop', r2: 'extension', repo: 'xeno-extension' },

  // ── Build ─────────────────────────────────────────────────
  { slug: 'engine', name: 'XENO Engine', tagline: 'ECS game engine, physics and multiplayer.', category: 'Build', status: 'coming-soon', delivery: 'soon', repo: 'xeno-engine' },
  { slug: 'workflow', name: 'XENO Workflow', tagline: 'Visual node-based automation pipelines.', category: 'Build', status: 'coming-soon', delivery: 'soon', repo: 'xeno-workflow' },
  { slug: 'use', name: 'XENO Use', tagline: "The agent's hands across every device.", category: 'Build', status: 'coming-soon', delivery: 'soon', repo: 'xeno-use' },
  { slug: 'apps', name: 'XENO Apps', tagline: 'No-code custom apps and internal tools.', category: 'Build', status: 'coming-soon', delivery: 'soon', repo: 'xeno-apps' },

  // ── Develop ───────────────────────────────────────────────
  { slug: 'agent-cli', name: 'XENO Agent CLI', tagline: 'Code, automate and control your workspace from the terminal.', category: 'Develop', status: 'beta', delivery: 'cli', install: 'npm install -g @xeno-corporation/xeno-agent-cli', repo: 'xeno-agent-cli' },
  { slug: 'sdk', name: 'XENO SDK', tagline: 'Embed XENO agents into any app.', category: 'Develop', status: 'beta', delivery: 'cli', install: 'npm install @xeno-corporation/xeno-agent-sdk', repo: 'xeno-agent-sdk' },
  { slug: 'acp', name: 'XENO ACP', tagline: 'Drive any ACP coding agent through one API.', category: 'Develop', status: 'coming-soon', delivery: 'soon', repo: 'xeno-acp' },
  { slug: 'rt', name: 'XENO RT', tagline: 'Run frontier models locally — private and fast.', category: 'Develop', status: 'beta', delivery: 'desktop', repo: 'xeno-rt' },
  { slug: 'shell', name: 'XENO Shell', tagline: 'The XENO desktop environment for every app.', category: 'Develop', status: 'coming-soon', delivery: 'soon', repo: 'xeno-shell' },
  { slug: 'anima', name: 'XENO Anima', tagline: 'Your personal, always-on agent — it remembers you and gets better.', category: 'Develop', status: 'coming-soon', delivery: 'soon', repo: 'xeno-anima' },
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
