import type { ProductContent } from './_types';

/* XENO Slides — sourced from ../xeno-slides (Toolbar, FileMenu, SlideCanvas,
 * PropertiesPanel, SlideShowView) and verified against the PACKAGED 0.2.0 asar
 * AND against the installed application, driven end to end.
 *
 * RELEASED 2026-07-28 as an EXPERIMENTAL, UNSIGNED 0.2.0 build (Windows x64 only).
 *
 * The 0.1.0 installer previously on R2 has been withdrawn. It was worse than the
 * sheets/notes scaffolds: not only did nothing call its export engines (so Rollup
 * tree-shook all four out of the bundle), a zustand selector returned a fresh
 * array on every call, which made React abort the mount with error #185 — so the
 * window opened, the titlebar said "XENO Slides", and the app rendered NOTHING.
 * Both defects were invisible to its 789 passing tests and to a clean build; both
 * surfaced within ninety seconds of launching the packaged artifact.
 *
 * ── WHAT IS CLAIMED HERE IS WHAT IS WIRED ────────────────────────────────────
 * Verified by launching the INSTALLED build and driving its real UI (only the OS
 * file picker was scripted; engines, bridge, IPC and disk writes were the shipped
 * path — see xeno-slides/scripts/packaged-smoke.mjs, which is now in the repo):
 *   · save     → 2,672-byte .xslides, valid JSON, slides + objects intact
 *   · pptx     → 45,932 bytes, PK\x03\x04, 39 zip entries, and
 *                ppt/slides/slide1.xml carries the actual deck text
 *   · html     → 4,878 bytes, <!DOCTYPE html>, xslides-* markup, arrow-key nav
 *   · pdf      → %PDF-1.4, /Count 1, MediaBox [0 0 720 404.88] = 10 x 5.62in,
 *                the same geometry the PPTX engine uses
 *   · png      → 89 50 4e 47, one file per visible slide
 *   · open     → round-trips a saved deck back into the editor
 *   · reachable from a titlebar File menu, toolbar buttons, and Ctrl+O/S/Shift+S
 *     (a native menu bar is not drawn: the window is frameless)
 *
 * DELIBERATELY NOT CLAIMED — engine code exists and is tested, but nothing in the
 * app reaches it, so it is absent from the shipped renderer bundle or has no UI:
 *   · PPTX IMPORT — there is no importer at all. pptx is write-only, and the Open
 *     dialog deliberately does not offer it.
 *   · video export (WebM/MP4) — Mp4ExportEngine/encodeFramesToWebM have no menu
 *     command; the rasteriser they share is used for PDF/PNG, the encoders are not
 *   · recording, rehearsal/timing, remote control, captions, morph transition,
 *     snapping, animation timeline, AI deck generation — all have engines and
 *     tests, none has a caller in the app
 *   · PPTX export covers text, shapes, images and tables ONLY. Charts, code
 *     blocks, mermaid diagrams and 3D objects render in the editor and survive
 *     HTML/PDF/PNG export, but are not translated into native PowerPoint objects.
 * If you wire any of these up, verify in the asar and by launching, THEN edit this.
 *
 * ⚠ autoUpdates is FALSE and is not a placeholder. Stronger than sheets/notes:
 * `electron-updater` is not even a declared dependency of xeno-slides, and there
 * are zero autoUpdater references in src/. latest.yml IS published to R2 and the
 * chain resolves, but nothing in the app polls it. Do not flip this to true until
 * something actually calls autoUpdater. */
const slides: ProductContent = {
  slug: 'slides',
  hero: {
    headline: 'Presentations you can actually get out of the app.',
    sub: 'A real slide editor — layouts, shapes, tables, charts, speaker notes, transitions and a presenter view — that exports to PowerPoint, PDF, a standalone HTML deck, or a folder of PNGs. Your file, in a format the person you are sending it to can open.',
    media: { type: 'mockup', src: 'slides-hero', alt: 'XENO Slides — the slide canvas with the filmstrip on the left, properties on the right, and the File menu open on Export' },
    badges: ['Windows only', 'PPTX · PDF · HTML · PNG', 'Presenter view', 'Your files stay local'],
    note: 'Free to download. Windows is the only build we have produced — macOS and Linux are intended but have never been built. This build does not update itself, and the .xslides format is not frozen yet.',
  },
  trust: ['Part of the XENO platform — one sign-in', 'Your decks stay on your machine', 'Exports to PowerPoint, PDF and HTML'],
  highlights: [
    { value: '4 formats', label: 'PPTX, PDF, HTML, PNG' },
    { value: 'Real .pptx', label: 'Opens in PowerPoint' },
    { value: 'Presenter view', label: 'Notes while you present' },
    { value: 'AI beside it', label: 'Draft and improve slides' },
  ],
  features: [
    {
      eyebrow: 'Get it out',
      icon: 'Upload',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(255,170,120,0.16), transparent 60%), linear-gradient(165deg,#1d160f,#070707 74%)',
      title: 'Export that produces a real file',
      desc: 'This is the thing 0.1.0 did not have. The export engines existed and were tested — nothing in the application ever called them, so they were stripped out of the build entirely. Now they are wired to the File menu, the toolbar and the keyboard.',
      bullets: [
        'PowerPoint .pptx — genuine OOXML that opens in PowerPoint, Keynote and Google Slides',
        'PDF — one slide per page at true slide dimensions',
        'Standalone HTML — a single self-contained file that presents in any browser',
        'PNG — every visible slide as a numbered image',
      ],
    },
    {
      eyebrow: 'Build the deck',
      icon: 'LayoutTemplate',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Slides, layouts and objects that behave',
      desc: 'Start from a layout or a blank slide, then place what you need. Objects can be moved, resized, rotated, aligned, grouped and reordered, with undo behind all of it.',
      bullets: [
        'Layout picker, plus duplicate, delete and reorder in the filmstrip',
        'Text boxes, shapes, arrows, stars, images and tables',
        'Group and ungroup, bring forward and send back, align and distribute',
        'Undo and redo across every edit, including drags and resizes',
      ],
    },
    {
      eyebrow: 'Present it',
      icon: 'Monitor',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.18), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'A presenter view, and transitions that actually play',
      desc: 'F5 starts the show. Speaker notes sit with the slide rather than in a separate document, and the presenter view keeps them in front of you while the audience sees the deck.',
      bullets: [
        'Full-screen slideshow with keyboard navigation',
        'Presenter view with speaker notes',
        'Per-slide transitions and object animations',
        'Hide a slide to keep it in the file but out of the run',
      ],
    },
    {
      eyebrow: 'Content beyond bullets',
      icon: 'BarChart3',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.15), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'Charts, code and diagrams on the slide',
      desc: 'Technical decks usually die in the gap between the slide tool and the thing you are explaining. These are first-class objects on the canvas.',
      bullets: [
        'Charts, code blocks with syntax highlighting, and diagrams',
        'Tables with editable cells',
        'These survive HTML, PDF and PNG export',
        'In .pptx they are not yet native PowerPoint objects — see the FAQ',
      ],
    },
    {
      eyebrow: 'Keep your work',
      icon: 'Save',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Open, save, and an autosave underneath',
      desc: 'A File menu in the titlebar with Open, Save and Save As, the same commands on the toolbar, and the usual keyboard shortcuts. A background autosave keeps a copy in your XENO folder as you work.',
      bullets: [
        '.xslides — the native XENO Slides document',
        'Ctrl+O, Ctrl+S and Ctrl+Shift+S, which keep working while you edit text',
        'Autosave to ~/.xeno/slides as you go',
        'Every action reports what happened, with a shortcut to the file it wrote',
      ],
    },
    {
      eyebrow: 'Ask',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.15), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'An AI that works on the deck in front of you',
      desc: 'Draft an outline or improve the slide you are on, without leaving the editor. It runs on the XENO agent runtime, against your account.',
      bullets: [
        'Draft a presentation outline from a topic',
        'Suggest improvements to the current slide',
        'Runs locally against xeno-rt when it is available, otherwise in the cloud',
        'Requires a XENO account and draws on credits',
      ],
    },
  ],
  useCases: [
    { title: 'The deck you have to send on', icon: 'Send', desc: 'Build it here, export a real .pptx or a PDF, and hand it to somebody who has never heard of XENO. Nothing is trapped in a format only we can read.' },
    { title: 'Technical talks', icon: 'Code', desc: 'Code blocks, diagrams and charts live on the canvas instead of being pasted in as screenshots, and speaker notes travel with the slide.' },
    { title: 'A deck on the web', icon: 'Globe', desc: 'Export one standalone HTML file and it presents in any browser — no runtime, no upload, no account for whoever opens it.' },
  ],
  howItWorks: [
    { step: '1', title: 'Download & install', desc: 'Grab the experimental Windows build. It is unsigned, so SmartScreen will warn once — choose “More info → Run anyway”.' },
    { step: '2', title: 'Build the deck', desc: 'Start from a layout, add text, shapes, tables, charts and code, and write speaker notes as you go. Save as .xslides.' },
    { step: '3', title: 'Present it or send it', desc: 'Press F5 for the slideshow and presenter view, or use File → Export for PowerPoint, PDF, standalone HTML or slide images.' },
  ],
  comparison: {
    competitor: 'PowerPoint & Google Slides',
    rows: [
      { feature: 'Slide editor with layouts, shapes and tables', xeno: true, them: true },
      { feature: 'Export to .pptx', xeno: true, them: true },
      { feature: 'Export to PDF and images', xeno: true, them: true },
      { feature: 'Standalone HTML deck in one file', xeno: true, them: 'Publish to web' },
      { feature: 'Speaker notes & presenter view', xeno: true, them: true },
      { feature: 'Code blocks & diagrams as slide objects', xeno: true, them: 'Add-ons' },
      { feature: 'AI in the editor, on your account', xeno: true, them: 'Paid tier' },
      { feature: 'Open .pptx files', xeno: 'Not yet', them: true },
      { feature: 'Video export', xeno: 'Not yet', them: true },
      { feature: 'Real-time collaboration', xeno: 'Not yet', them: true },
      { feature: 'Signed installer', xeno: 'Not yet', them: true },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows x64 only (no macOS or Linux build)' },
    { label: 'Formats out', value: '.xslides · .pptx · PDF · HTML · PNG' },
    { label: 'Formats in', value: '.xslides only — there is no .pptx importer yet' },
    { label: 'Status', value: 'Experimental 0.2.0 · unsigned' },
    { label: 'Updates', value: 'Manual — this build does not self-update' },
  ],
  faq: [
    { q: 'What was wrong with the earlier build?', a: 'Two things, and the second is worse than the first. Its export engines were written and tested but nothing in the application ever called them, so the build tool stripped all four out — you could edit a deck and autosave it, and that was all. And a state-management bug made the interface abort while mounting, so the window opened with the right title and then rendered nothing at all. Neither showed up in its 789 passing tests or in a clean build; both were obvious within a minute of actually launching the installer. 0.1.0 has been withdrawn, and the repo now has a smoke test that launches the packaged app and exports a file before we publish anything.' },
    { q: 'What does “experimental” actually mean here?', a: 'It means this is an early build we are publishing openly rather than sitting on. The editor and the four exports work and are covered by 805 automated tests plus a launch-and-export check against the packaged application, but it has not had a wide user shake-down: expect rough edges, and keep a copy of anything important. The .xslides format is not frozen, so a future version may not read decks written by this one.' },
    { q: 'Can it open PowerPoint files?', a: 'No. It writes .pptx but cannot read it — there is no importer yet, which is why the Open dialog offers .xslides only rather than letting you pick a file it would fail on. If you need to work from an existing deck, this build is not ready for you.' },
    { q: 'How good is the .pptx it produces?', a: 'It is a genuine OOXML file — we check the packaged app writes one whose slide XML contains the real deck text, not a stub. Text, shapes, images and tables translate into native PowerPoint objects. Charts, code blocks, diagrams and 3D objects do not yet; they render correctly in the editor and in the PDF, HTML and PNG exports, but they are not converted into PowerPoint equivalents. Use PDF or HTML if a deck leans on those.' },
    { q: 'Why does Windows warn me about the installer?', a: 'Because it is not code-signed yet. Windows SmartScreen shows “Windows protected your PC” for any installer without a signing certificate, regardless of what it contains. Choose “More info”, then “Run anyway”. Code signing is planned; until then we would rather tell you the warning is coming than pretend it is not.' },
    { q: 'Will it update itself?', a: 'No. There is no in-app updater — the updater library is not even bundled, so this build will never prompt you and never upgrade on its own. When a newer version is published you will need to come back here and install it over the top. XENO Hub, which polls for new versions, can tell you when one is out.' },
    { q: 'Can it export video?', a: 'Not from the interface in this build. The rendering code that turns slides into frames is there — it is what produces the PDF and PNG exports — but the video encoders have no menu command yet, so we are not claiming it.' },
    { q: 'What does it cost?', a: 'The experimental build is free to download. AI features require a XENO account and draw on credits. Pricing for the finished product will be announced closer to a stable release.' },
  ],
  seo: {
    title: 'XENO Slides — the AI-native presentation editor',
    description: 'Build presentations and export real PowerPoint, PDF, standalone HTML or PNG slides. Layouts, tables, charts, code blocks, speaker notes and a presenter view. Experimental unsigned build for Windows.',
  },
  // Product-specific caveats ONLY — the experimental/unsigned/SmartScreen posture is
  // derived from the catalog by experimentalNotice() and already rendered above this
  // block. See the contract on `downloadNotice` in _types.ts.
  downloadNotice:
    'This build does NOT update itself. XENO Slides 0.2.0 ships without an in-app updater — the updater library is not even bundled — so it will never prompt you and never upgrade; when a newer version is published you will need to come back here and install it over the top. Windows x64 is the only build we have produced; there is no macOS or Linux installer. It cannot open .pptx files (export only), video export has no interface yet, and charts, code blocks and diagrams do not become native PowerPoint objects in a .pptx — they do export correctly to PDF, HTML and PNG. The .xslides format is not frozen yet, so keep a copy of anything important. AI features require a XENO account and draw on credits.',
  autoUpdates: false,
};

export default slides;
