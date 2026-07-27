import type { ProductContent } from './_types';

/* XENO Docs — sourced from ../xeno-docs (README + the real renderer: Toolbar,
 * OutlineSidebar, AIWritingPanel, StatusBar, DocumentEditor). A `delivery:
 * desktop` product: 0.2.0 is published and downloadable, so the CTA is a real
 * download. Only a Windows installer exists; do NOT re-add macOS/Linux.
 *
 * CORRECTED 2026-07-27, verified against the repo:
 *  · NO AUTO-UPDATE. `electron-updater` is absent from the only package.json
 *    and has zero hits in src/ or the built output. electron-builder emits a
 *    release/latest.yml, but nothing in the app ever reads it. Every 0.2.0
 *    install is permanently stranded and must be upgraded by hand.
 *    → autoUpdates: false below, and the download page says so.
 *    → The R2 release notes for 0.2.0 claimed "In-app auto-update is now wired
 *      to the XENO update channel." That is corrected on R2 separately; the
 *      feed is not part of this file.
 *  · "50+ languages" for code blocks was wrong. The editor imports lowlight's
 *    `common` bundle (DocumentEditor.tsx), which registers exactly 37.
 *  · RETRACTED 2026-07-27 — "AI runs local via xeno-rt or in the cloud" was
 *    marked wrong here on the basis of `shared/xeno-ai.ts`. **xeno-docs does
 *    not import that file.** Verified: zero hits for `shared/xeno-ai` across
 *    xeno-docs/src. It uses `DualLLMProvider` from the agent SDK
 *    (src/main/index.ts:3, src/preload/index.ts:1), whose own doc comment reads
 *    "Local xeno-rt at localhost:3338 (free, private, fast)" with an `auto` mode
 *    that "check[s] if local is available, use[s] it if so, otherwise fall[s]
 *    back to cloud", plus explicit `local` and `cloud` modes. `localhost:3338`
 *    appears 18x in the shipped app.asar.
 *
 *    So the local path is REAL and the original claim was TRUE. A truthfulness
 *    pass measured the wrong file and deleted an accurate claim — the same
 *    instrument error as the overstatements it was correcting, pointing the
 *    other way. Understating a product is a defect too: it costs a user a
 *    feature they actually have.
 *
 *    Copy below restored to describe local-first with cloud fallback. Do not
 *    re-soften it without checking what xeno-docs ACTUALLY imports. */
const docs: ProductContent = {
  slug: 'docs',
  hero: {
    headline: 'Every document tool — and an AI that writes with you.',
    sub: 'XENO Docs pairs a full word processor with Notion-style block editing and a built-in AI writer. Import your DOCX with fidelity, write with slash commands, and let AI rewrite, translate, and generate — right in the page. Now in beta on Windows.',
    media: { type: 'mockup', src: 'docs-hero', alt: 'XENO Docs — the editor with an outline sidebar, formatting toolbar, and the floating AI writing assistant' },
    badges: ['Windows desktop', 'DOCX import & export', 'AI writing built in', 'Free beta'],
    note: 'Free beta (v0.2) · Windows. macOS and Linux builds follow. Two things to know before installing: AI uses a local xeno-rt at localhost:3338 when one is running and falls back to the XENO cloud otherwise (cloud calls draw on credits; local ones do not), and this build does NOT auto-update — watch this page for 0.3 and install it over the top.',
  },
  trust: ['Part of the XENO platform — one sign-in', 'Windows desktop (Electron) — macOS & Linux next', 'Your documents in an open .xdoc format', 'No auto-update in this build — upgrades are manual'],
  highlights: [
    { value: 'DOCX in, PDF out', label: 'Full-fidelity import & export' },
    { value: 'AI in the page', label: 'Rewrite · translate · generate' },
    { value: 'Word + Notion', label: 'Formatting meets blocks' },
    { value: '.xdoc', label: 'Open, native format' },
  ],
  features: [
    {
      eyebrow: 'Writing', icon: 'Blocks',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.18), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'A word processor, built in blocks',
      desc: 'The full formatting power you expect, plus a "/" menu that drops in any block — so a memo, a spec, and a wiki page all live in the same editor.',
      bullets: [
        'Headings, lists, checklists, tables, blockquotes, columns',
        'Slash commands, callouts, toggles, footnotes',
        'Code blocks with 37 languages, LaTeX math, Mermaid diagrams',
        'Page layout: A4/Letter/Legal, margins, orientation, page breaks',
      ],
    },
    {
      eyebrow: 'AI assistant', icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.16), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'An AI writer that lives in the document',
      desc: 'Select text and act on it, or generate from a prompt — no copy-pasting into a chat window. Results replace the selection or drop in below.',
      bullets: [
        'Rewrite with tone: professional, casual, academic, creative, concise, friendly',
        'Summarize, expand, and fix grammar in place',
        'Translate to 16+ languages',
        'Right-click quick actions · local xeno-rt when available, XENO cloud otherwise (cloud is metered)',
      ],
    },
    {
      eyebrow: 'Professional docs', icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'The tools long documents actually need',
      desc: 'The serious features other editors make you leave for a plugin — citations, mail merge, comparison, and history — are built in.',
      bullets: [
        'Citations & bibliography: APA, MLA, Chicago, IEEE, Harvard',
        'Mail merge from CSV/JSON, headers & footers, style gallery',
        'Word-level document compare, macros, inline comments',
        'Version history with named snapshots and word-level diff',
      ],
    },
    {
      eyebrow: 'Zero-migration formats', icon: 'Globe',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Open your DOCX. Export anywhere.',
      desc: 'Bring your existing work with you and take it wherever you need — no lock-in, no format anxiety.',
      bullets: [
        'DOCX import & export with full fidelity as the target',
        'Export to PDF, Markdown, HTML, and plain text',
        'Native .xdoc format — plain, inspectable JSON',
        'Print with page setup',
      ],
    },
    {
      eyebrow: 'Ecosystem', icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.14), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'Live embeds from the whole XENO suite',
      desc: 'Drop a Pixel canvas, a Motion timeline, or a Sound waveform straight into a document — one workspace, one account.',
      bullets: [
        'Embed blocks for the XENO apps you have installed — Pixel, Motion and Sound today',
        '"Open in App" jumps to the source project',
        'One XENO sign-in shared across every app',
        'More app embeds land as each app ships',
      ],
    },
  ],
  useCases: [
    { title: 'Students & researchers', icon: 'Users', desc: 'Cite as you write in APA, MLA, Chicago or IEEE, auto-build the bibliography, add footnotes, and draft in distraction-free focus mode.' },
    { title: 'Business & operations', icon: 'Zap', desc: 'Open a DOCX with fidelity, run mail merge from a CSV, manage headers/footers and styles, and compare two drafts word by word.' },
    { title: 'Writers & knowledge teams', icon: 'Sparkles', desc: 'Block-based pages with slash commands, AI rewrite/expand/translate in the margin, and version history for every draft.' },
  ],
  howItWorks: [
    { step: '1', title: 'Download & open', desc: 'Get the Windows build. Run a local xeno-rt for private, free AI, or sign in with your XENO account to use the cloud.' },
    { step: '2', title: 'Import or start fresh', desc: 'Open an existing DOCX with fidelity, or start a blank .xdoc and write with "/" slash blocks.' },
    { step: '3', title: 'Write with AI', desc: 'Select text for AI rewrite, translate or summarize — then export to PDF, DOCX, Markdown or HTML.' },
  ],
  comparison: {
    competitor: 'most word processors',
    rows: [
      { feature: 'Word processor + block editor in one', xeno: true, them: 'One or the other' },
      { feature: 'AI writing built into the page', xeno: true, them: 'Add-ons' },
      { feature: 'Local / private AI option', xeno: 'Not in this build', them: false },
      { feature: 'Citations, mail merge, compare, macros', xeno: true, them: true },
      { feature: 'DOCX import/export fidelity', xeno: 'Target', them: true },
      { feature: 'Mature ecosystem, templates & add-ons', xeno: 'Growing', them: true },
      { feature: 'Price', xeno: 'Free beta', them: 'Subscription' },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows (x64) · Electron' },
    { label: 'Editor engine', value: 'TipTap · ProseMirror' },
    { label: 'Formats', value: '.xdoc · DOCX · PDF · MD · HTML' },
    { label: 'AI', value: 'Local xeno-rt when running · XENO cloud otherwise' },
    { label: 'Updates', value: 'Manual — no in-app auto-update' },
    { label: 'Status', value: 'v0.2 · beta' },
  ],
  faq: [
    { q: 'Can I use XENO Docs yet?', a: 'Yes — the 0.2 beta is available now for Windows. It opens and saves .xdoc, .docx, .md, .html and .txt, exports to PDF, and ships the outline, comments, citations, mail merge and AI writing assistant. It’s an honest beta: expect rough edges, and macOS and Linux builds are still to come.' },
    { q: 'Can I import my Word documents?', a: 'Yes — DOCX import and export is a core goal, with full fidelity as the target. You can also export to PDF, Markdown, HTML and plain text, and everything saves natively as an open .xdoc (plain JSON).' },
    { q: 'What can the AI do?', a: 'Rewrite with a tone (professional, casual, academic, creative, concise, friendly), summarize, expand, fix grammar, translate to 16+ languages, and generate from a prompt — right in the document. Results can replace your selection or insert below.' },
    { q: 'Is it a Word replacement or a Notion replacement?', a: 'Both. You get a full word processor — headings, tables, page layout, citations, mail merge — and Notion-style block editing with slash commands, callouts, toggles and columns, in the same editor.' },
    { q: 'Does the AI work offline or privately?', a: 'Yes, if you run a local xeno-rt. XENO Docs uses the agent SDK’s dual provider: in its default auto mode it checks for a local xeno-rt on localhost:3338 and uses it when present — free, private, and never leaving your machine — falling back to the XENO cloud otherwise, where calls are authenticated and metered on credits. The editor itself works fully offline regardless; only cloud AI needs the network. (An earlier version of this page said there was no local option and called the original claim an error. That retraction was itself wrong — it was based on a file this app does not import.)' },
    { q: 'Does it update itself?', a: 'No. XENO Docs 0.2 has no in-app updater, so an installed copy will never notify you or upgrade itself. When 0.3 ships you will need to download it from this page and install it over the top. We would rather tell you that than let you sit on an old build believing it is current.' },
    { q: 'Which platforms can I install it on?', a: 'Windows today — that’s the only build we publish. macOS and Linux are planned; the download page will list them the moment they exist.' },
    { q: 'How much does it cost?', a: 'The beta is free. AI actions draw on XENO platform credits, since they run through the platform. General-release pricing is announced later.' },
  ],
  seo: {
    title: 'XENO Docs — the AI-native document editor',
    description: 'A professional document editor that unites a full word processor, Notion-style block editing, and a built-in AI writer. Import DOCX with fidelity; rewrite, translate and generate in the page. Free beta on Windows.',
  },
  // Product-specific caveats ONLY. The unsigned installer / SmartScreen warning
  // is no longer written here — it is derived from the catalog and rendered
  // above this block on the download page (see productCatalog experimentalNotice).
  // Repeating it made the page say the same thing twice.
  downloadNotice:
    'This build does NOT update itself. XENO Docs 0.2 ships without an in-app updater, so it will never prompt you and never upgrade — when a newer version is published you will need to come back here and install it over the top. AI uses a local xeno-rt on localhost:3338 when one is running — private and free — and falls back to the XENO cloud otherwise, which needs an account and draws on credits.',
  autoUpdates: false,
};

export default docs;
