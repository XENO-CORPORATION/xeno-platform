import type { ProductContent } from './_types';

/* XENO Apps — sourced from ../xeno-apps @ branch feat/phase-a (package.json
 * 0.1.0, src/renderer/src/engine/**, src/main/data/**, electron-builder.yml),
 * verified against the tree on 2026-08-08. Catalog: Build, status coming-soon /
 * delivery soon — see the RELEASE-DAY FLIP note at the bottom of this comment.
 *
 * ⚠️ DO NOT SOURCE THIS PAGE FROM xeno-apps' OWN DOCS. Measured 2026-08-08, all
 * three top-level docs in that repo are STALE and contradict the code:
 *   · CHANGELOG.md still says "Still scaffold only — no application code yet"
 *     and "Blocked on upstream: Phase A cannot start". There are ~110 source
 *     files, 428 passing tests and a built 87 MB installer.
 *   · README.md status badge says "Scaffolded v0.0.1". package.json is 0.1.0.
 *   · SPEC.md line 10 says "app code not yet started".
 * Everything below traces to SOURCE, not to those files.
 *
 * HONESTY CONTRACT — five claims the SPEC/README make that the build does NOT
 * back up. Do not "improve" this page back into any of them:
 *
 *  1. THERE IS NO AI IN THIS BUILD. The product's category name is "no-code AI
 *     app builder", and xeno-rt / xeno-lib / xeno-workflow / xeno-agent-sdk are
 *     none of them dependencies, none of them wired, and no model is called
 *     anywhere in the repo. SPEC §7's services table is architecture, not
 *     capability. The `.xapp` `bindings` key is never written. Never put "AI"
 *     in a capability sentence on this page — the category framing is allowed,
 *     a feature claim is not.
 *  2. BACK does NOT embed the xeno-workflow node engine (SPEC §4 says it does).
 *     engine/graph/nodeTypes.ts states plainly that xeno-workflow "is NOT
 *     importable today" and that this is a local, shape-compatible catalog of 8
 *     logic nodes with local evaluators. Its `code` node is a RESTRICTED
 *     EXPRESSION GRAMMAR over `$` — not sandboxed JS. There are also NO exec
 *     wires (data wires only), so no retry, no checkpointing, no determinism
 *     guarantee. Never repeat those three words on this page.
 *  3. The Panel Studio sandbox is a PLAIN opaque-origin iframe, explicitly NOT
 *     `iframe-quickjs` (IframeSandbox.ts:12–18) — a runaway loop hangs that
 *     frame. Only ONE capability is grantable (`storage.local`); net/fs/gpu are
 *     refused at load. An authored panel publishes to THIS INSTALL's local
 *     catalog. There is no marketplace and no preflightTrust.
 *  4. The Terminal panel is backed by createFakeEmulator() — a scripted PTY.
 *     Never call it a working shell. (xeno-shell has the real one; that is a
 *     different product and a different page.)
 *  5. There is NO web export, NO mobile, NO sharing or publishing a built app to
 *     anyone else, and NO marketplace. `File → Save` writes a local .xapp. That
 *     is the whole distribution story for a user-built app today.
 *
 * Two more precision points that are easy to get subtly wrong:
 *   · Undo is AUTHORING undo — wires, logic nodes, placement, instances, panel
 *     config. It does not undo a panel's own content (a Table cell edit).
 *   · Drag-to-connect is a BACK-canvas gesture. FRONT wires through the WIRING
 *     panel. Never write "drag panels together in FRONT to wire them".
 *   · The Panel Library lists 24 tiles: the 21 canonical panels plus 3 demo/
 *     example tiles. "21 panels" is the right number to advertise; do not also
 *     claim the library shows exactly 21.
 *
 * RELEASE-DAY FLIP (nothing here goes live until the installer is on R2):
 *   1. productCatalog.ts `apps` → status 'beta', delivery 'desktop',
 *      operatingSystem 'Windows'.
 *   2. scripts/experimental-notice.test.mjs — MOVE 'apps' out of the
 *      "products with no published build say nothing" list (it will fail
 *      otherwise) and into the shipped-unsigned-installer test. That gate is
 *      the thing standing between this page and a dead download button.
 *   3. Publish with scripts/xeno-release.mjs --app apps --version 0.1.0, notes
 *      from scripts/release-notes/apps.json.
 * Until then delivery:'soon' means /product/apps/download redirects to this
 * page (ProductDownload.tsx:45) and the CTA reads "Get notified" — which is the
 * truth, because nothing is downloadable yet. */
const apps: ProductContent = {
  slug: 'apps',
  statusLabel: 'Release pending',
  hero: {
    headline: 'Build an internal tool out of the panels our creative apps are made of.',
    sub: 'XENO Apps is a builder for the tools you would otherwise ask an engineer for. Drop a table, a chart and a set of KPI tiles onto a workbench, point them at a real endpoint or a CSV, wire the table’s selection into the chart, and save the whole thing as one file. The 21 panels you compose with are the same ones that make up the rest of the XENO stack.',
    media: { type: 'mockup', src: 'apps-hero', alt: 'XENO Apps — the FRONT workbench with a Connectors panel, a Table of live rows, a Chart and Metrics tiles, beside the BACK node canvas showing the same panels as wired nodes' },
    badges: ['Windows', 'v0.1.0', '21 panels', 'One graph, two views'],
    note: 'Not released yet. The Windows 0.1.0 build is finished and in release prep — there is nothing to download from this page today, and no date to give you. It will be an unsigned, experimental first release when it lands.',
  },
  trust: [
    'Every remote origin is approved by you before a socket is ever opened',
    'Credentials go to the OS keystore — never into your .xapp file',
    'No AI, no telemetry and no account needed to build and run an app',
  ],
  highlights: [
    { value: '21 panels', label: 'The same ones the XENO apps use' },
    { value: 'One graph', label: 'FRONT and BACK never diverge' },
    { value: '.xapp', label: 'One readable JSON file' },
    { value: '428 tests', label: 'Plus a 36-gate packaged-build harness' },
  ],
  features: [
    {
      eyebrow: 'Read this first',
      icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,200,210,0.14), transparent 60%), linear-gradient(165deg,#15161a,#070707 74%)',
      title: 'What it is today — and what it isn’t',
      desc: 'This is a first release of a builder, published early because the core loop is genuinely complete: place, configure, wire, run, save, reopen, undo — all by mouse. What is missing is missing on purpose, and we would rather list it here than let you discover it after an 87 MB download.',
      bullets: [
        'Real today: the workbench, all 21 panels, live data, wiring, templates, .xapp save/open',
        'No AI. Despite the category name, no model is called anywhere in this build',
        'An app you build stays on your machine — there is no publishing, sharing or web export',
        'Windows only. macOS and Linux targets are configured but not built',
      ],
    },
    {
      eyebrow: 'The model',
      icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'FRONT and BACK are two views of one graph',
      desc: 'FRONT is the app as your user sees it — real panels, docked and live. BACK is the same app as a node canvas, where you can drop a transform between two panels. They are not two documents that sync. BACK is an overlay and FRONT stays mounted underneath it, so there is no version of this app where the two can disagree.',
      bullets: [
        'Switch views from the menu bar — the graph underneath is one object',
        'A panel in FRONT is a node in BACK, with the ports it declares in its manifest',
        'Drag from a pin to wire, in either direction — it snaps to the nearest compatible port',
        'Wires are type-checked by the same rule the canvas uses to snap them',
      ],
    },
    {
      eyebrow: 'Real data',
      icon: 'Globe',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.16), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'Point it at a real endpoint and see real rows',
      desc: 'Five kinds of source: paste rows in, an HTTP endpoint, a GraphQL endpoint, a CSV file or a JSON file. Requests are made from the app’s own main process rather than a browser context, so CORS is not something you have to fight.',
      bullets: [
        'HTTP and GraphQL, plus CSV and JSON files picked from disk',
        'GraphQL handles the awkward case properly — a 200 that carries an errors array',
        'Wire a query result into a Table, then the Table’s selection into a Chart',
        'No SQL sources in this build, and the GraphQL dialog does not expose variables or paging yet',
      ],
    },
    {
      eyebrow: 'Consent',
      icon: 'Lock',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.18), transparent 60%), linear-gradient(165deg,#15111f,#070707 74%)',
      title: 'A host it hasn’t been allowed to reach is unreachable',
      desc: 'Approval is per origin, and it is checked in the main process before a socket opens — not filtered afterwards. A corrupt consent file fails closed rather than open. Credentials are a separate story again: they go to the OS keystore, and the app deliberately ships no channel that can read one back out.',
      bullets: [
        'Per-origin grants you review in File → Permissions, revocable at any time',
        'The consent sheet shows the origin verbatim; plain http to a non-loopback host is flagged',
        'Secrets live in the OS keystore via Electron safeStorage — a panel only ever holds a reference',
        'If the OS keystore is unavailable it refuses to store rather than faking protection',
      ],
    },
    {
      eyebrow: 'Authoring',
      icon: 'GitBranch',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Two of the same panel, each with its own configuration',
      desc: 'A builder whose second gesture can’t be “put another table next to that one” isn’t a builder. Place a panel as many times as you need; each instance carries its own config and its own state, and Ctrl+Z walks back through the authoring you did to get there.',
      bullets: [
        'Multiple instances of any panel, each independently configured',
        'Undo/redo across wires, logic nodes, placement, instances and config',
        'Run-on-open triggers, so a saved app shows data the moment it opens',
        'Five starter templates, built through the same API you drive by hand',
      ],
    },
    {
      eyebrow: 'The file',
      icon: 'Save',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'One .xapp file you can actually read',
      desc: 'An app saves as a single indented JSON document — the composition only. Panels are referenced by manifest id and resolved at open, never embedded, so the file stays small enough to read and diff in a pull request.',
      bullets: [
        'Seven top-level keys: format, version, app, panels, wires, logicNodes, onOpen',
        'Panel implementations are referenced, never copied into the file',
        'No absolute paths and no credentials are ever written into it',
        'A file from a newer format version is refused rather than half-read',
      ],
    },
    {
      eyebrow: 'Panel Studio',
      icon: 'Code',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.14), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'Write your own panel, and run it walled off',
      desc: 'When the 21 aren’t enough, write one. It loads in an opaque-origin iframe over a custom scheme with no network, no filesystem and no GPU — it reaches the app only through the same declared contract every first-party panel uses.',
      bullets: [
        'Sandboxed with allow-scripts and no same-origin, under a default-src none policy',
        'One grantable capability today: local storage. Network, file and GPU are refused at load',
        'It is a plain iframe, not a JS isolate — a runaway loop hangs that frame',
        'An authored panel is added to this install’s catalog; there is nowhere to publish it',
      ],
    },
  ],
  useCases: [
    { title: 'An internal dashboard', icon: 'Boxes', desc: 'A support-desk view over your own API: a table of tickets, KPI tiles above it, and a chart that follows whatever row you select.' },
    { title: 'A one-off view of a CSV', icon: 'Globe', desc: 'Drop in an export, get a real grid instead of a spreadsheet, and keep the layout as a file you can open again next month.' },
    { title: 'A harness for a panel you’re building', icon: 'Code', desc: 'Every canonical panel is seen here first. If you’re writing one, this is where you place it, configure it, wire it and watch it behave.' },
  ],
  howItWorks: [
    { step: '1', title: 'Start from a template', desc: 'Open one of five starters — or a blank app — and you already have a workbench with panels in it.' },
    { step: '2', title: 'Add a source and approve it', desc: 'Point at an endpoint or pick a CSV. The first request asks you to approve the origin; nothing is contacted before you do.' },
    { step: '3', title: 'Wire it and save', desc: 'Connect the result into a table and a chart, add a run-on-open trigger, then save one .xapp and reopen it whenever.' },
  ],
  comparison: {
    competitor: 'hosted low-code builders',
    rows: [
      { feature: 'Runs on your desktop, not in a hosted account', xeno: true, them: false },
      { feature: 'Your app is one plain file you own', xeno: true, them: 'Their database' },
      { feature: 'Per-origin approval before any request', xeno: true, them: false },
      { feature: 'Credentials in the OS keystore', xeno: true, them: 'Their vault' },
      { feature: 'Publish an app for other people to use', xeno: false, them: true },
      { feature: 'Database / SQL sources', xeno: false, them: true },
      { feature: 'AI features', xeno: false, them: 'Varies' },
      { feature: 'Availability', xeno: 'Not released yet', them: 'Available now' },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows (x64) · Electron' },
    { label: 'Panels', value: '21 first-party, from xeno-core' },
    { label: 'Data sources', value: 'HTTP · GraphQL · CSV · JSON · paste-in' },
    { label: 'Project format', value: '.xapp (single-file JSON)' },
    { label: 'Status', value: 'v0.1.0 · release pending' },
  ],
  faq: [
    { q: 'Can I download it yet?', a: 'Not yet. The Windows 0.1.0 build is finished and going through release prep, and this page exists ahead of it so there is something accurate to read when it lands. We are not going to invent a date. When it ships it will be an experimental, unsigned first release, and this page will say so.' },
    { q: 'It is called an AI app builder. Where is the AI?', a: 'Not in this build — and we would rather be blunt about that than let the category name do the talking. Nothing here calls a model: the local inference runtime, the media library, the workflow engine and the agent SDK are none of them wired in. The architecture is designed for it, which is a different sentence from the app doing it. Everything else on this page is real and running.' },
    { q: 'What actually is a panel?', a: 'A self-contained piece of interface with a declared contract — the ports it reads and writes, the commands it accepts, the settings it exposes. Because that contract is declared rather than assumed, the builder can wire two panels together without either knowing about the other. The 21 that ship here are the same components the rest of the XENO stack is built from, which is why they are more finished than a builder’s first release would normally have any right to be.' },
    { q: 'Are FRONT and BACK two separate things I have to keep in sync?', a: 'No, and that is the point of the design. There is one graph. FRONT is it rendered as a working app, BACK is it rendered as nodes. BACK draws over the top while FRONT stays mounted underneath, so there is no sync step to get wrong and no way for the two to disagree.' },
    { q: 'Can I share an app I build with my team?', a: 'Not from inside the app. You save a .xapp file, and anyone else with XENO Apps installed can open it — that is the whole distribution story today. There is no publishing flow, no share link, no web export and no marketplace. If they need the same data, they will approve the same origins on their own machine and supply their own credentials, because neither travels in the file.' },
    { q: 'What happens to my API keys?', a: 'They go into the OS keystore through Electron’s safeStorage — DPAPI on Windows — and what your app holds is a reference to one, not the value. There is deliberately no message the interface can send that returns a secret, and nothing is written into the .xapp. If the operating system’s keystore is not available, the app refuses to store the credential rather than writing something that only looks protected.' },
    { q: 'Can it reach anything on my network without me knowing?', a: 'No. Every origin has to be approved by you first, and the check happens in the main process before a connection is opened rather than by filtering results afterwards. If the file holding those grants is damaged, it fails closed. You can review and revoke grants in File → Permissions.' },
    { q: 'Can I write my own panel?', a: 'Yes, in the Panel Studio, and it runs walled off from the rest of the app: an opaque-origin iframe with scripts allowed but no same-origin access, no network, no filesystem and no GPU. Local storage is the one capability you can grant it. It is a plain iframe rather than a JavaScript isolate, so an infinite loop will hang that frame — worth knowing before you write one. The panel is added to your own install; there is nowhere to publish it to.' },
    { q: 'macOS and Linux?', a: 'Not built. The build configuration has targets for both, but the only artifact that exists is the Windows installer, and the packaged end-to-end evidence is Windows only. We would rather ship one platform we have actually tested.' },
    { q: 'How much of this is tested?', a: '428 unit tests, plus a 36-gate harness that drives the real application in a real window — and can be pointed at the installed build rather than a development server. Those gates are unusually literal: one proves an un-approved origin is genuinely never contacted, one stores a secret in the real OS keystore and proves it cannot be read back out, and one writes an .xapp to disk and asserts it contains no absolute path and no bearer token.' },
  ],
  seo: {
    title: 'XENO Apps — build internal tools from the panels XENO is made of',
    description: 'A Windows desktop builder for internal tools and dashboards: compose 21 first-party panels, wire them in a FRONT workbench or a BACK node canvas that share one graph, connect HTTP, GraphQL, CSV or JSON data behind per-origin approval, and save it all as one .xapp file. v0.1.0, release pending. No AI in this build.',
  },
  autoUpdates: false,
  downloadNotice: 'This build does not update itself — there is no updater in the app, so a new version means downloading it from this page again. An app you build is saved as a local .xapp file: there is no publishing, no sharing flow and no web export. macOS and Linux are not built.',
};

export default apps;
