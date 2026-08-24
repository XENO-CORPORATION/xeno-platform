import type { ProductContent } from './_types';

/* XENO Sheets — sourced from ../xeno-sheets (the real renderer: Toolbar, Grid,
 * FormulaBar, Sidebar, StatusBar) and verified against the PACKAGED 0.2.0 asar.
 *
 * RELEASED 2026-07-27 as an EXPERIMENTAL, UNSIGNED 0.2.0 build (Windows x64 only).
 *
 * The 0.1.0 installer previously on R2 was a SCAFFOLD — packaged ~70 minutes before
 * the engine commit landed, so it shipped a grid that could not evaluate a formula.
 * It has been withdrawn. 0.2.0 is built from current source.
 *
 * ── WHAT IS CLAIMED HERE IS WHAT IS WIRED ────────────────────────────────────
 * Every claim below was checked in the shipped bundle, not in the source tree —
 * this repo has already been burned by "the engine exists" meaning "the engine is
 * reachable". Verified present AND reachable from the UI:
 *   · formula evaluation — our HyperFormula wrapper config (gpl-v3, smartRounding,
 *     useColumnIndex) is in the renderer bundle and Grid.tsx evaluates through it
 *   · open/save — Toolbar.tsx really calls xenoAPI.file.open()/file.save(); the main
 *     bundle carries file:open, file:save, file:exportPDF and the .xsheet extension
 *   · charts — ChartView.tsx imports chart.js AND the engine, and renders from a range
 *   · data validation — Grid.tsx blocks an invalid commit and surfaces the error
 *   · conditional formatting — Grid.tsx:305 calls engine.evaluateConditionalFormat()
 *
 * DELIBERATELY NOT CLAIMED (engine code exists and is tested, but NOTHING IN THE
 * APP CALLS IT — these are absent from the shipped renderer bundle):
 *   · pivot tables — the sidebar PivotPanel is a static mockup: an uncontrolled
 *     input and drop zones with no handlers and no engine call
 *   · sparklines, goal seek, solver, flash fill, scenario manager, SQL mode,
 *     Python cells, external database connections, ODS import — all measured at
 *     ZERO occurrences in the packaged bundle
 *   · sorting/filtering — the engine implements it; there is no UI entry point
 * If you wire any of these up, verify in the asar and THEN edit this file.
 *
 * ⚠ autoUpdates is FALSE and that is not a placeholder: `electron-updater` is a
 * declared dependency but is NEVER imported anywhere in src/. latest.yml IS
 * published to R2 and resolves, but nothing in the app polls it, so an install can
 * only move forward by reinstalling (or via XENO Hub, which polls version.json).
 * Do not flip this to true until something actually calls autoUpdater. */
const sheets: ProductContent = {
  slug: 'sheets',
  hero: {
    headline: 'A spreadsheet that actually computes — and explains itself.',
    sub: 'A real formula engine, multi-sheet workbooks, and Excel and CSV in both directions. Charts read straight from your ranges, validation stops bad data at the cell, and an AI panel sits beside the grid to write formulas and explain results.',
    media: { type: 'mockup', src: 'sheets-hero', alt: 'XENO Sheets — the grid with a SUMPRODUCT formula in the formula bar, its computed total selected, and the AI panel explaining the result' },
    badges: ['Windows only', 'Real formula engine', 'XLSX & CSV', 'Your files stay local'],
    note: 'Free to download. Windows is the only build we have produced — macOS and Linux are intended but have never been built. This build does not update itself, and the .xsheet format is not frozen yet.',
  },
  trust: ['Part of the XENO platform — one sign-in', 'Your workbooks stay on your machine', 'Opens and writes real .xlsx and .csv'],
  highlights: [
    { value: 'Real engine', label: 'Formulas that evaluate' },
    { value: 'XLSX · CSV', label: 'In and out, both ways' },
    { value: 'Multi-sheet', label: 'Workbooks, not one grid' },
    { value: 'AI beside it', label: 'Write and explain formulas' },
  ],
  features: [
    {
      eyebrow: 'Compute',
      icon: 'Sigma',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.15), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'A formula engine, not a formula-shaped text box',
      desc: 'This is the thing 0.1.0 did not have. Type a formula and it evaluates — with dependency tracking, so changing one cell recalculates everything that leans on it.',
      bullets: [
        'The standard function library — lookups, maths, statistics, text, dates and logic',
        'Cross-sheet references across a multi-sheet workbook',
        'Dependency-ordered recalculation when a precedent changes',
        'Error values propagate the way you expect (#DIV/0!, #REF! and friends)',
      ],
    },
    {
      eyebrow: 'Structure',
      icon: 'Table2',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Workbooks that behave like workbooks',
      desc: 'Several sheets in one file, cells you can actually format, merged ranges, and number formats that render currency, percentages and dates properly.',
      bullets: [
        'Multiple sheets with tabs, in one document',
        'Cell formatting — fonts, weights, alignment and fills',
        'Merged ranges and frozen headers',
        'Number formats: currency, percentage, date and custom',
      ],
    },
    {
      eyebrow: 'Exchange',
      icon: 'ArrowLeftRight',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Excel and CSV, both directions',
      desc: 'Open the spreadsheet somebody actually sent you, work on it, and send it back in a format they can open. XENO Sheets also has its own .xsheet document format.',
      bullets: [
        'Import and export .xlsx',
        'Import and export .csv',
        '.xsheet — the native XENO Sheets document',
        'Export the sheet to PDF',
      ],
    },
    {
      eyebrow: 'Trust the data',
      icon: 'ShieldCheck',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.16), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'Catch bad input at the cell, and see the shape of the data',
      desc: 'Data validation rejects an entry that breaks the rule and tells the user why, rather than silently accepting nonsense. Conditional formatting colours the grid as values change.',
      bullets: [
        'Validation rules enforced at the moment of entry, with an explanatory message',
        'Dropdown lists for constrained columns',
        'Conditional formatting evaluated live as the grid renders',
        'Selection aggregate — sum, average and count — always in the status bar',
      ],
    },
    {
      eyebrow: 'See it',
      icon: 'BarChart3',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Charts straight off the range',
      desc: 'Select a range, pick a chart type, and it renders from the live data — no separate chart document, no copy-paste of values.',
      bullets: [
        'Bar, line, pie and the rest of the common set',
        'Bound to the range, so it follows the numbers',
        'Lives in the sidebar next to the grid',
      ],
    },
    {
      eyebrow: 'Ask',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.15), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'An AI panel that reads the sheet you are actually looking at',
      desc: 'Ask for a formula in plain language, or ask what a result means, without leaving the grid. It runs on the XENO agent runtime.',
      bullets: [
        'Write a formula from a description',
        'Explain what an existing formula or result is doing',
        'Analyze the selected range',
        'Requires a XENO account and draws on credits',
      ],
    },
  ],
  useCases: [
    { title: 'Models and forecasts', icon: 'TrendingUp', desc: 'Build a multi-sheet model with real cross-sheet formulas, and let recalculation keep the totals honest as assumptions move.' },
    { title: 'The file somebody emailed you', icon: 'FileSpreadsheet', desc: 'Open the .xlsx, fix it, export it back. The exchange formats are the point — nothing is trapped in a format only we can read.' },
    { title: 'Clean data collection', icon: 'ShieldCheck', desc: 'Constrain columns with validation rules and dropdowns so the sheet rejects bad entries instead of quietly absorbing them.' },
  ],
  howItWorks: [
    { step: '1', title: 'Download & install', desc: 'Grab the experimental Windows build. It is unsigned, so SmartScreen will warn once — choose “More info → Run anyway”.' },
    { step: '2', title: 'Open or start a workbook', desc: 'Open an existing .xlsx or .csv, or start fresh and save as .xsheet. Add sheets as you need them.' },
    { step: '3', title: 'Compute, chart, ask', desc: 'Write formulas that evaluate, chart a range, and use the AI panel when you would rather describe the formula than remember it.' },
  ],
  comparison: {
    competitor: 'Excel & Google Sheets',
    rows: [
      { feature: 'Formula engine with dependency recalculation', xeno: true, them: true },
      { feature: 'Multi-sheet workbooks', xeno: true, them: true },
      { feature: 'XLSX & CSV import/export', xeno: true, them: true },
      { feature: 'Charts from a range', xeno: true, them: true },
      { feature: 'Data validation & conditional formatting', xeno: true, them: true },
      { feature: 'AI in the sheet, on your account', xeno: true, them: 'Add-ons / paid tier' },
      { feature: 'Pivot tables', xeno: 'Not yet', them: true },
      { feature: 'Sorting & filtering UI', xeno: 'Not yet', them: true },
      { feature: 'Real-time collaboration', xeno: 'Not yet', them: true },
      { feature: 'Signed installer', xeno: 'Not yet', them: true },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows x64 only (no macOS or Linux build)' },
    { label: 'Formula engine', value: 'HyperFormula' },
    { label: 'Formats', value: '.xsheet · .xlsx · .csv · PDF export' },
    { label: 'Status', value: 'Experimental 0.2.0 · unsigned' },
    { label: 'Updates', value: 'Manual — this build does not self-update' },
  ],
  faq: [
    { q: 'What was wrong with the earlier build?', a: 'The 0.1.0 installer was a scaffold. It was packaged about seventy minutes before the formula engine was committed, so it looked like a spreadsheet but could not evaluate a formula. It should never have been downloadable and has been withdrawn. 0.2.0 is built from current source, and we verified the evaluator is present in the packaged application rather than trusting that the build succeeded.' },
    { q: 'What does “experimental” actually mean here?', a: 'It means this is an early build we are publishing openly rather than sitting on. The engine works and 598 automated tests cover it, but it has not been through a wide user shake-down: expect rough edges, and keep a copy of anything important. The document format is not frozen yet, so a future version may not read workbooks written by this one.' },
    { q: 'Why does Windows warn me about the installer?', a: 'Because it is not code-signed yet. Windows SmartScreen shows “Windows protected your PC” for any installer without a signing certificate, regardless of what it contains. Choose “More info”, then “Run anyway”. Code signing is planned; until then we would rather tell you the warning is coming than pretend it is not.' },
    { q: 'Will it update itself?', a: 'No. This build has no in-app updater — it will never prompt you and never upgrade on its own. When a newer version is published you will need to come back here and install it over the top. XENO Hub, which polls for new versions, can tell you when one is out.' },
    { q: 'Does it do pivot tables, sorting or filtering?', a: 'Not in this build. There is a pivot panel in the sidebar, but it is a static mockup with nothing behind it, and sorting and filtering exist in the engine with no way to reach them from the interface. We would rather name that plainly than let a panel imply a feature. They are on the list.' },
    { q: 'Can it open my existing spreadsheets?', a: 'Yes — .xlsx and .csv, both directions. You can also save in the native .xsheet format and export the sheet to PDF. Very complex Excel workbooks (macros, exotic chart types, unusual formats) will not survive a round trip intact; this is an early build.' },
    { q: 'What does it cost?', a: 'Downloading the experimental build requires a XENO account with an active plan. AI features draw on credits. Pricing for the finished product will be announced closer to a stable release.' },
  ],
  seo: {
    title: 'XENO Sheets — the AI-native spreadsheet',
    description: 'A spreadsheet with a real formula engine, multi-sheet workbooks, XLSX and CSV in both directions, charts from your ranges and an AI panel beside the grid. Experimental unsigned build for Windows.',
  },
  // Product-specific caveats ONLY — the experimental/unsigned/SmartScreen posture is
  // derived from the catalog by experimentalNotice() and already rendered above this
  // block. See the contract on `downloadNotice` in _types.ts.
  downloadNotice:
    'This build does NOT update itself. XENO Sheets 0.2.0 ships without an in-app updater, so it will never prompt you and never upgrade — when a newer version is published you will need to come back here and install it over the top. Windows x64 is the only build we have produced; there is no macOS or Linux installer. Pivot tables, sorting and filtering are not wired up in this build, and the .xsheet document format is not frozen yet, so keep a copy of anything important. AI features require a XENO account and draw on credits.',
  autoUpdates: false,
};

export default sheets;
