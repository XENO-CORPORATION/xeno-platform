import type { ProductContent } from './_types';

/* XENO Notes — sourced from ../xeno-notes (README + the real renderer: TitleBar,
 * Sidebar/PageTree, NoteEditor/EditorToolbar, RightPanel). Honest coming-soon
 * framing: the app is a local-first, block-based knowledge base with linking,
 * databases and an AI layer (semantic search, writing assistant, auto-tagging)
 * that already ship in the renderer. Features still on the roadmap — real-time
 * collaboration, cloud sync, database formulas/relations, AI Q&A/page-gen — are
 * NOT claimed as available. Desktop only; no mobile. */
const notes: ProductContent = {
  slug: 'notes',
  hero: {
    headline: 'Your second brain — local, linked, and AI-native.',
    sub: 'A block-based knowledge base that keeps your notes as plain files on your own machine. Bi-directional links and a graph view connect everything; databases give it structure; and an AI layer searches by meaning, writes with you, and tags as you go.',
    media: { type: 'mockup', src: 'notes-hero', alt: 'XENO Notes — the page-tree sidebar, block editor with a wiki-link and an AI summary, and the formatting toolbar' },
    badges: ['Windows · macOS · Linux', 'Local-first · your files', 'Bi-directional links', 'AI writing & search'],
    note: 'Coming soon · join the waitlist to be notified when the beta opens. Desktop first — mobile & real-time collaboration are on the roadmap.',
  },
  trust: ['Part of the XENO platform — one sign-in', 'Your notes live in ~/.xeno/notes as plain files', 'Works fully offline · git-backed page history'],
  highlights: [
    { value: 'Local-first', label: 'Plain files, works offline' },
    { value: 'Bi-directional', label: 'Links, backlinks & graph' },
    { value: 'AI-native', label: 'Semantic search & writing' },
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
      eyebrow: 'AI-native',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.16), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'AI that understands your whole vault',
      desc: 'Semantic search finds notes by meaning, not just keywords. The editor’s AI dropdown summarizes, expands, rewrites, fixes grammar and translates — and it tags pages for you.',
      bullets: [
        'Semantic search over vector embeddings (xeno-agent-sdk RAG)',
        'Summarize · expand · rewrite · fix grammar · translate',
        'AI auto-tagging with keyword-extraction fallback',
        'Runs on the XENO agent runtime',
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
    { step: '1', title: 'Open your vault', desc: 'Launch from XENO Hub. Your notes are created as plain files in ~/.xeno/notes — no account required to write.' },
    { step: '2', title: 'Write & link', desc: 'Type “/” for any block or “[[” to link a page. Import your existing Markdown, Notion or Evernote notes to start fast.' },
    { step: '3', title: 'Let AI help', desc: 'Search by meaning, ask the AI to summarize or rewrite, and let it tag pages — all without leaving the editor.' },
  ],
  comparison: {
    competitor: 'most note apps',
    rows: [
      { feature: 'Block editor, slash commands, Markdown', xeno: true, them: true },
      { feature: 'Bi-directional links + graph view', xeno: true, them: 'Some' },
      { feature: 'Local-first plain-file vault (offline)', xeno: true, them: 'Cloud-first' },
      { feature: 'Built-in semantic (AI) search', xeno: true, them: 'Add-ons' },
      { feature: 'Git-backed version history', xeno: true, them: false },
      { feature: 'Real-time collaboration & cloud sync', xeno: 'On the roadmap', them: true },
      { feature: 'Mobile apps', xeno: 'Desktop first', them: true },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows · macOS · Linux' },
    { label: 'Storage', value: 'Local files · ~/.xeno/notes' },
    { label: 'Editor', value: 'TipTap / ProseMirror' },
    { label: 'Status', value: 'Coming soon' },
  ],
  faq: [
    { q: 'Where are my notes stored?', a: 'On your own machine, in ~/.xeno/notes, as plain files — pages, databases, assets and a vector index for search. There’s no cloud dependency and no subscription lock-in; you can back the folder up or move it like any other files.' },
    { q: 'Does it work offline?', a: 'Yes. XENO Notes is local-first and fully functional without an internet connection. AI features call the XENO agent runtime, but writing, linking, databases and search over your vault work offline.' },
    { q: 'What can the AI actually do today?', a: 'Semantic search (find notes by meaning via embeddings), an in-editor writing assistant (summarize, expand, rewrite, fix grammar, translate), and AI auto-tagging. Deeper features like whole-vault Q&A and full page generation are on the roadmap.' },
    { q: 'Can I import my existing notes?', a: 'Yes — import from Markdown files, Notion export ZIPs, Evernote .enex files and OneNote exports. You can export back out to Markdown, PDF or HTML at any time.' },
    { q: 'Is there mobile or real-time collaboration?', a: 'Not yet. XENO Notes is desktop-first (Windows, macOS, Linux). Real-time multi-user editing (CRDT) and multi-device cloud sync are planned, not shipping.' },
    { q: 'When can I use it, and what does it cost?', a: 'It’s coming soon — join the waitlist to be notified when the beta opens. Pricing will be announced closer to release.' },
  ],
  seo: {
    title: 'XENO Notes — the local-first, AI-native knowledge base',
    description: 'A block-based notes and knowledge base with bi-directional links, a graph view, databases, and built-in AI search and writing. Local-first, offline, git-backed. Coming soon.',
  },
};

export default notes;
