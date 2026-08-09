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
 *
 * MATURITY + SIGNING are the honesty fields (see `experimentalNotice` below).
 * They are DATA, not page copy, precisely so a product cannot silently lose the
 * notice — and so the notice disappears everywhere the day signing lands.
 * ────────────────────────────────────────────────────────────────────── */

import { UPDATES_ORIGIN } from '../config/hosts';

export const R2_BASE = UPDATES_ORIGIN;

export type Delivery = 'web' | 'desktop' | 'cli' | 'soon';
export type Status = 'shipping' | 'beta' | 'coming-soon';

/** How mature the CODE is — orthogonal to `status`, which says how public it is.
 *  Company posture (2026-07): every XENO product ships as a full release marked
 *  EXPERIMENTAL until it has been through a code-signed, supported release.
 *  Omitting the field means 'experimental' — graduating is a deliberate edit
 *  somebody has to make, never something a product drifts into. */
export type Maturity = 'experimental' | 'stable';

/** Code-signing posture of the artifact a visitor actually receives.
 *   'unsigned' → real, downloadable, and NOT code-signed. Windows will warn.
 *   'signed'   → a certificate is in place; the warning language disappears.
 *   'none'     → this channel has nothing to code-sign (an npm package, a
 *                hosted web app). Showing a SmartScreen warning here would be
 *                its own inaccuracy, so we never do.
 *  Omitted resolves via `artifactSigning()`, which fails SAFE: anything that
 *  hands a visitor an executable is treated as unsigned until stated otherwise. */
export type Signing = 'unsigned' | 'signed' | 'none';

/** What a visitor receives — derived, not authored (see `installChannel`). */
export type InstallChannel = 'installer' | 'archive' | 'npm' | 'hosted' | 'none';

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
  /** Defaults to 'experimental' — see the Maturity type. Set 'stable' ONLY once
   *  the product has had a signed, supported release. */
  maturity?: Maturity;
  /** Defaults via `artifactSigning()`. Set 'signed' the day a certificate lands
   *  and every unsigned notice for this product disappears site-wide. */
  signing?: Signing;
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
  // Slides 0.2.0 (2026-07-28) clears the bar this entry used to hold it back for.
  // The precondition was "ship it when the export engines and the file dialogs are
  // wired to real UI" — that is now true and was verified in the PACKAGED artifact,
  // not the source tree:
  //   · the renderer bundle went 732K → 1345K because actions/fileActions.ts is a
  //     real caller: PptxGenJS appears 44x in the shipped asar (0 before), along
  //     with the HTML and canvas exporters that Rollup used to tree-shake away;
  //   · the installed app was launched and driven — Save wrote a 2.6 KB .xslides,
  //     Export produced a 45 KB PK\x03\x04 pptx whose ppt/slides/slide1.xml carries
  //     the deck text, a %PDF-1.4 at /Count 1, a standalone .html and a PNG, and
  //     Open round-tripped the saved file back into the editor;
  //   · commands are reachable from a titlebar File menu, toolbar buttons and
  //     Ctrl+O/S/Shift+S — not shortcut-only.
  // Launching it also caught a defect no test could see: a zustand selector
  // returned a fresh array each call, so React aborted the mount with error #185
  // and EVERY production build had rendered a blank window since 2026-03-18. The
  // 0.1.0 installer never drew its own UI. Fixed, guarded by a test, and the repo
  // now carries scripts/packaged-smoke.mjs so the next release must launch too.
  // Windows only, experimental + unsigned, and NO in-app updater — electron-updater
  // is not even a dependency. Framing lives in src/content/products/slides.ts.
  { slug: 'slides', name: 'XENO Slides', tagline: 'Presentations with AI built in.', category: 'Office', status: 'beta', delivery: 'desktop', operatingSystem: 'Windows', repo: 'xeno-slides' },
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
  // Extension: 1.1.0 IS published (R2 apps/extension/), so the page links the real
  // download. It stays delivery:'soon' + status:'coming-soon' because there is no
  // Chrome Web Store listing and Chrome has refused off-store installs on Windows
  // since Chrome 33 — this is a load-unpacked tester build, not availability.
  //
  // 🔴 `signing: 'none'` is REQUIRED and is not decoration. externalUrl makes
  // installChannel() resolve to 'archive', and 'archive' defaults to 'unsigned',
  // whose notice asserts smartScreen:true and tells the visitor to click through
  // "More info → Run anyway". What ships here is a ZIP of JavaScript: Windows never
  // executes it, no dialog can ever appear, and there is no signature to be missing.
  // 'none' means "nothing to sign", which drops the warning while KEEPING the
  // experimental framing. Removing it fabricates a warning for a dialog that cannot
  // exist — the reassuring-direction lie the playbook forbids. Pinned by
  // scripts/experimental-notice.test.mjs.
  //
  // ⚠️ externalUrl is VERSION-PINNED: bump it on every extension release, or the
  // download button serves a stale build. Step in xeno-extension/docs/RELEASE.md.
  { slug: 'extension', name: 'XENO Extension', tagline: 'Bring the XENO agent to Chrome and Edge.', category: 'Connect', status: 'coming-soon', delivery: 'soon', operatingSystem: 'Chrome, Edge, Brave (Chromium)', r2: 'extension', repo: 'xeno-extension', signing: 'none', externalUrl: 'https://updates.xenostudio.ai/apps/extension/extension-stable-v1.1.0/xeno-browser-agent-stable-1.1.0.zip', externalLabel: 'Download 1.1.0 — load unpacked' },

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
  // Migrated 2026-08-09, in ONE pass as the previous note here required: this
  // install command, every sample in src/content/docs/sdk.ts, and the product
  // page all name @xenosystem/agent-sdk together. npm `latest` is 0.9.0;
  // @xeno-corporation/xeno-agent-sdk is frozen at 0.7.0.
  // The /ui samples were REWRITTEN, not renamed — that subpath no longer ships
  // React (`AgentChatPanel`/`AgentStatusBar`/`useAgent` exist nowhere in the
  // package). It is now a framework-free controller: createAgentUiController,
  // mountAgentUi, createAgentUiView, dispatchAgentUiAction. The SDK declares
  // NO peer dependencies, so any "React is an optional peer" claim is false.
  { slug: 'sdk', name: 'XENO SDK', tagline: 'Embed XENO agents into any app.', category: 'Develop', status: 'beta', delivery: 'cli', install: 'npm install @xenosystem/agent-sdk', repo: 'xeno-agent-sdk' },
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
  // Because it is 'soon' + externalUrl, installChannel() resolves to 'archive'
  // (not 'none') — so RT still carries the unsigned notice, framed as binaries
  // you run rather than an installer you click. That is the whole reason the
  // channel is derived from delivery AND externalUrl instead of delivery alone.
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
 * EXPERIMENTAL / UNSIGNED notice — derived once, rendered everywhere a
 * download or install starts (product page, download page, release feed).
 *
 * Why it lives here and not in page copy: an unsigned installer that arrives
 * with no warning feels like malware; one that says "unsigned, here's why,
 * here's what you'll see" is trustworthy. That statement has to be impossible
 * to lose. Fourteen hand-written copies would rot the first time somebody adds
 * a product; one derived field cannot. It also means the day a signing
 * certificate is configured, `signing: 'signed'` removes the warning from every
 * surface at once — no copy hunt.
 *
 * Precision matters as much as presence. An npm package is not SmartScreen-
 * affected and a hosted web app has no artifact at all, so a blanket "Windows
 * will warn you" on either would be its own inaccuracy. The channel decides the
 * framing; only 'installer' and 'archive' ever mention SmartScreen.
 * ────────────────────────────────────────────────────────────────────── */

/** What a visitor actually receives from this product's CTA. */
export function installChannel(p: Product): InstallChannel {
  if (p.delivery === 'web') return 'hosted';
  if (p.delivery === 'cli') return 'npm';
  if (p.delivery === 'desktop') return 'installer';
  // 'soon' publishes nothing through the R2 feed — unless it is distributed
  // off-site, which is how xeno-rt ships (public GitHub release archives).
  return p.externalUrl ? 'archive' : 'none';
}

/** Resolved signing posture. Fails SAFE: an unset field on a channel that hands
 *  over an executable resolves to 'unsigned', never to silence. */
export function artifactSigning(p: Product): Signing {
  if (p.signing) return p.signing;
  const ch = installChannel(p);
  return ch === 'installer' || ch === 'archive' ? 'unsigned' : 'none';
}

export function productMaturity(p: Product): Maturity {
  return p.maturity ?? 'experimental';
}

export interface ExperimentalNotice {
  channel: InstallChannel;
  signing: Signing;
  /** True only where Windows SmartScreen is genuinely in play. */
  smartScreen: boolean;
  /** Micro-label. Always carries the maturity word, so `short` never repeats it. */
  label: string;
  /** The clause that follows the label in tight spots (hero, a release row).
   *  Carries the "what you'll see / how to proceed" half — a visitor who only
   *  ever reads the one-liner still knows what to do. */
  short: string;
  /** The paragraph, for the download page. */
  detail: string;
  /** How to get past the warning — present only when there is a warning. */
  steps?: string[];
}

/**
 * The one place this is written. Returns null when there is nothing honest to
 * say: a hosted app, a product with no build yet, or a mature signed release.
 */
export function experimentalNotice(p: Product): ExperimentalNotice | null {
  const channel = installChannel(p);
  // No artifact, no notice. A hosted app installs nothing, and a pre-launch
  // product has no build to warn about.
  if (channel === 'hosted' || channel === 'none') return null;

  const signing = artifactSigning(p);
  const maturity = productMaturity(p);
  if (maturity === 'stable' && signing !== 'unsigned') return null;

  const experimental = maturity === 'experimental';
  const lead = experimental
    ? `${p.name} is an experimental release — real software you can install and use, not a finished product.`
    : '';

  if (signing === 'unsigned' && channel === 'installer') {
    return {
      channel, signing, smartScreen: true,
      label: experimental ? 'Experimental · unsigned installer' : 'Unsigned installer',
      short: 'Windows SmartScreen warns you once before it runs — choose More info → Run anyway. Code signing is on the way.',
      detail: `${lead} The installer isn’t code-signed yet, so Windows SmartScreen shows “Windows protected your PC” the first time you run it. That warning is about the missing certificate, not about the file. Code signing is coming — when it lands, this notice goes away.`.trim(),
      steps: [
        'Click More info on the SmartScreen dialog.',
        'Choose Run anyway.',
        'Install as normal. Windows warns again for each new unsigned version.',
      ],
    };
  }

  if (signing === 'unsigned' && channel === 'archive') {
    return {
      channel, signing, smartScreen: true,
      label: experimental ? 'Experimental · unsigned binaries' : 'Unsigned binaries',
      short: 'Windows can warn the first time you run one — choose More info → Run anyway. Code signing is on the way.',
      detail: `${lead} The published binaries aren’t code-signed, so Windows can warn the first time you run one. Code signing is coming — when it lands, this notice goes away.`.trim(),
      steps: [
        'If Windows warns, choose More info → Run anyway.',
        'Verify the checksum published alongside the download if you want to check the file yourself.',
      ],
    };
  }

  if (channel === 'npm') {
    // Deliberately says NOTHING about SmartScreen warning THIS package: an npm
    // install is not an installer and never triggers it. Claiming otherwise
    // would be a lie in the reassuring direction, which is still a lie — and it
    // would train people to click through warnings that do not exist.
    return {
      channel, signing, smartScreen: false,
      label: 'Experimental release',
      short: 'Commands and APIs can still change between versions. It installs from npm — there’s no installer, and nothing for Windows to warn about.',
      detail: `${lead} Commands, flags and APIs can still change between versions. It installs from npm, so there’s no installer to code-sign and no SmartScreen warning.`.trim(),
    };
  }

  // Experimental but signed (or nothing to sign): drop the warning language,
  // keep the maturity statement.
  return {
    channel, signing, smartScreen: false,
    label: 'Experimental release',
    short: 'Expect rough edges and changes between versions.',
    detail: `${lead} Expect rough edges and changes between versions.`.trim(),
  };
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
