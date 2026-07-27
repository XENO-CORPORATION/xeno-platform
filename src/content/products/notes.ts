import type { ProductContent } from './_types';

/* XENO Notes — sourced from ../xeno-notes (README + the real renderer: TitleBar,
 * Sidebar/PageTree, NoteEditor/EditorToolbar, RightPanel).
 *
 * RELEASED 2026-07-27 as an EXPERIMENTAL, UNSIGNED 0.2.0 build (Windows x64 only).
 *
 * The 0.1.0 installer previously on R2 was a SCAFFOLD — packaged ~60 minutes before
 * the engine commit landed, so it had no linking and no graph. It has been withdrawn.
 * 0.2.0 is built from current source and the engine work is verified present in the
 * packaged asar (wikiLink mark + Backlinks UI in the renderer bundle, d3 force-sim
 * internals compiled in with GraphView rendered from App.tsx, notes:findBacklinks in
 * the main bundle, and the packaged app launches).
 *
 * Honest framing: the app is a local-first, block-based knowledge base with linking,
 * databases and an AI layer (writing assistant, auto-tagging) that ship in the renderer.
 * Features still on the roadmap — real-time collaboration, cloud sync, AI Q&A/page-gen —
 * are NOT claimed as available. Desktop only; no mobile.
 *
 * ⚠ autoUpdates is FALSE and that is not a placeholder: `electron-updater` is a declared
 * dependency but is NEVER imported anywhere in src/. latest.yml IS published to R2 and
 * resolves, but nothing in the app polls it, so an install can only be moved forward by
 * reinstalling (or via XENO Hub, which polls version.json). Do not flip this to true
 * until something actually calls autoUpdater.
 *
 * CORRECTED 2026-07-27, verified against the repo:
 *  · "Windows · macOS · Linux" was FALSE. electron-builder declares win/mac/
 *    linux targets, but dist/ has only ever contained a Windows build
 *    (`XENO Notes Setup 0.1.0.exe`). No .dmg or .AppImage has ever been
 *    produced. A declared build target is not a platform you support.
 *  · "AI semantic search over vector embeddings" was FALSE. Search is
 *    MiniSearch (engine/search.ts) — lexical BM25 with prefix + fuzzy 0.2 and
 *    title/tag boosting. Zero hits for embedding / vector / hnsw / faiss
 *    anywhere in the repo. It is good keyword search; it is not semantic. */
const notes: ProductContent = {
  slug: 'notes',
  hero: {
    headline: 'Your second brain — local, linked, and AI-native.',
    sub: 'A block-based knowledge base that keeps your notes as plain files on your own machine. Bi-directional links and a graph view connect everything; databases give it structure; instant full-text search finds anything; and an AI layer writes with you and tags as you go.',
    media: { type: 'mockup', src: 'notes-hero', alt: 'XENO Notes — the page-tree sidebar, block editor with a wiki-link and an AI summary, and the formatting toolbar' },
    badges: ['Windows only', 'Local-first · your files', 'Bi-directional links', 'Works offline'],
    note: 'Free to download. Windows is the only build we have produced — macOS and Linux are intended but have never been built. This build does not update itself. Mobile and real-time collaboration are on the roadmap.',
  },
  trust: ['Part of the XENO platform — one sign-in', 'Your notes live in ~/.xeno/notes as plain files', 'Works fully offline · git-backed page history'],
  highlights: [
    { value: 'Local-first', label: 'Plain files, works offline' },
    { value: 'Bi-directional', label: 'Links, backlinks & graph' },
    { value: 'Fast search', label: 'Full-text over your vault' },
    { value: '5 database views', label: 'Table · board · calendar…' },
  ],
  features: [
    {
      eyebrow: 'Write',
      icon: 'Blocks',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.15), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'A block editor that gets out of the way',
      desc: 'Everything is a block. Type “/” for any block type, or write Markdown and watch it render live — no mode-switching, no friction.',
      bullets: [
        'Slash commands, Markdown shortcuts, drag-and-drop blocks',
        'Headings, lists, checkboxes, quotes, callouts, toggles, columns',
        'Code blocks (100+ languages), math (KaTeX) & Mermaid diagrams',
        'Cover images, page icons, templates & daily notes',
      ],
    },
    {
      eyebrow: 'Connect',
      icon: 'Network',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Link your thinking, then see the map',
      desc: 'Type [[ to link any page. Every link is two-way, so backlinks build themselves — and the graph view shows how your knowledge connects.',
      bullets: [
        'Bi-directional [[wiki-links]] with auto-complete',
        'Backlinks panel on every page',
        'Interactive, force-directed graph view',
        'Tags, properties & synced blocks that mirror everywhere',
      ],
    },
    {
      eyebrow: 'Organize',
      icon: 'Table2',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Databases with five ways to look at them',
      desc: 'Turn a collection of pages into a structured database with typed properties, then view the same data as a table, board, calendar, timeline or gallery.',
      bullets: [
        'Typed properties: text, select, multi-select, date & more',
        'Table, board (Kanban), timeline, calendar & gallery views',
        'Filter, sort and group by any property',
        'Database templates for fast, consistent entry',
      ],
    },
    {
      eyebrow: 'Search & AI',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.16), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'Fast search over everything, and AI in the editor',
      desc: 'Full-text search covers your whole vault instantly, weighted so a title match beats a body match and tolerant of typos. Separately, the editor’s AI dropdown summarizes, expands, rewrites, fixes grammar and translates — and it tags pages for you.',
      bullets: [
        'Instant full-text search over titles, tags and content, with typo tolerance',
        'Ranked results — title and tag matches outrank body matches',
        'Summarize · expand · rewrite · fix grammar · translate',
        'AI auto-tagging with keyword-extraction fallback, on the XENO agent runtime',
      ],
    },
    {
      eyebrow: 'Yours',
      icon: 'Lock',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'Local-first — your files, no lock-in',
      desc: 'Everything lives in ~/.xeno/notes as plain files. It works with no internet, keeps a git-backed history of every save, and exports to open formats.',
      bullets: [
        'Plain-file vault on your machine · full offline support',
        'Git-backed version history — browse & restore any save',
        'Import from Markdown, Notion, Evernote & OneNote',
        'Export to Markdown, PDF & HTML',
      ],
    },
    {
      eyebrow: 'Connected',
      icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Part of the XENO ecosystem',
      desc: 'Embed live XENO content in your notes and extend the app with the same plugin system that powers the rest of the platform.',
      bullets: [
        'Live-linked Pixel canvases, Motion timelines & Sound tracks',
        'Launch from XENO Hub with shared sign-in & credits',
        'Extend with agent-SDK plugins',
        'Canvas view — an infinite whiteboard of connected cards',
      ],
    },
  ],
  useCases: [
    { title: 'A personal second brain', icon: 'Layers', desc: 'Capture everything, link it as you go, and let backlinks and the graph surface connections you’d have forgotten.' },
    { title: 'Team wikis & docs', icon: 'Users', desc: 'Structure knowledge with nested pages and databases, keep a table of contents, and track it all with git-backed history.' },
    { title: 'Private, offline research', icon: 'Lock', desc: 'Clip the web, take daily notes, and study with spaced-repetition flashcards — all in a local vault that never has to touch the cloud.' },
  ],
  howItWorks: [
    { step: '1', title: 'Download & install', desc: 'Grab the experimental Windows build. It is unsigned, so SmartScreen will warn once — choose “More info → Run anyway”.' },
    { step: '2', title: 'Write & link', desc: 'Type “/” for any block or “[[” to link a page. Import your existing Markdown, Notion or Evernote notes to start fast.' },
    { step: '3', title: 'Let AI help', desc: 'Search your whole vault instantly, ask the AI to summarize or rewrite, and let it tag pages — all without leaving the editor.' },
  ],
  comparison: {
    competitor: 'most note apps',
    rows: [
      { feature: 'Block editor, slash commands, Markdown', xeno: true, them: true },
      { feature: 'Bi-directional links + graph view', xeno: true, them: 'Some' },
      { feature: 'Local-first plain-file vault (offline)', xeno: true, them: 'Cloud-first' },
      { feature: 'Built-in full-text search', xeno: true, them: true },
      { feature: 'Semantic / embedding search', xeno: 'Not yet', them: 'Add-ons' },
      { feature: 'Git-backed version history', xeno: true, them: false },
      { feature: 'Real-time collaboration & cloud sync', xeno: 'On the roadmap', them: true },
      { feature: 'Mobile apps', xeno: 'Desktop first', them: true },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows (macOS & Linux intended, never built)' },
    { label: 'Storage', value: 'Local files · ~/.xeno/notes' },
    { label: 'Search', value: 'Full-text (MiniSearch) — not embeddings' },
    { label: 'Editor', value: 'TipTap / ProseMirror' },
    { label: 'Status', value: 'Experimental 0.2.0 · unsigned' },
    { label: 'Updates', value: 'Manual — this build does not self-update' },
  ],
  faq: [
    { q: 'Where are my notes stored?', a: 'On your own machine, in ~/.xeno/notes, as plain files — pages, databases, assets and a search index. There’s no cloud dependency and no subscription lock-in; you can back the folder up or move it like any other files.' },
    { q: 'Does it work offline?', a: 'Yes. XENO Notes is local-first and fully functional without an internet connection. AI features call the XENO agent runtime, but writing, linking, databases and search over your vault work offline.' },
    { q: 'What will the AI do at launch?', a: 'An in-editor writing assistant (summarize, expand, rewrite, fix grammar, translate) and AI auto-tagging — those are built. Search is fast full-text search, not semantic: it matches words, with typo tolerance and title/tag weighting, rather than meaning. Earlier copy on this page described embedding-based semantic search; that was wrong, and finding notes by meaning is on the roadmap alongside whole-vault Q&A and page generation.' },
    { q: 'Can I import my existing notes?', a: 'Yes — import from Markdown files, Notion export ZIPs, Evernote .enex files and OneNote exports. You can export back out to Markdown, PDF or HTML at any time.' },
    { q: 'Which desktop platforms will it run on?', a: 'Windows is the only build that has ever been produced. macOS and Linux are intended and the build configuration targets them, but no .dmg or .AppImage has been made yet — so treat them as planned, not supported. Mobile, real-time multi-user editing (CRDT) and multi-device cloud sync are all planned, not shipping.' },
    { q: 'What does “experimental” actually mean here?', a: 'It means this is an early build we are publishing openly rather than sitting on. The engine works and 681 automated tests cover it, but it has not been through a wide user shake-down: expect rough edges and keep a backup of your vault. Your notes are plain files in ~/.xeno/notes, so nothing is trapped in a proprietary store if you walk away.' },
    { q: 'Why does Windows warn me about the installer?', a: 'Because it is not code-signed yet. Windows SmartScreen shows “Windows protected your PC” for any installer without a signing certificate, regardless of what it contains. Choose “More info”, then “Run anyway”. Code signing is planned; until then we would rather tell you the warning is coming than pretend it is not.' },
    { q: 'Will it update itself?', a: 'No. This build has no in-app updater — it will never prompt you and never upgrade on its own. When a newer version is published you will need to come back here and install it over the top. XENO Hub, which polls for new versions, can tell you when one is out.' },
    { q: 'What does it cost?', a: 'The experimental build is free to download. AI features require a XENO account and draw on credits. Pricing for the finished product will be announced closer to a stable release.' },
  ],
  seo: {
    title: 'XENO Notes — the local-first, AI-native knowledge base',
    description: 'A block-based notes and knowledge base with bi-directional links, a graph view, databases, instant full-text search and a built-in AI writing assistant. Local-first, offline, git-backed. Experimental unsigned build for Windows.',
  },
  // Product-specific caveats ONLY — the experimental/unsigned/SmartScreen posture is
  // derived from the catalog by experimentalNotice() and already rendered above this
  // block. See the contract on `downloadNotice` in _types.ts.
  downloadNotice:
    'This build does NOT update itself. XENO Notes 0.2.0 ships without an in-app updater, so it will never prompt you and never upgrade — when a newer version is published you will need to come back here and install it over the top. Windows x64 is the only build we have produced; there is no macOS or Linux installer. Search is keyword-based, not semantic — it matches words, not meaning. Your notes are plain files in ~/.xeno/notes, but keep a backup of the folder anyway. AI features require a XENO account and draw on credits.',
  autoUpdates: false,
};

export default notes;
