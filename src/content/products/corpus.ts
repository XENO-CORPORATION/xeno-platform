import type { ProductContent } from './_types';

/* XENO Corpus desktop — sourced from ../xeno-corpus at the 0.1.0 desktop release: desktop/main.cjs (the
 * door, the engine child process, .xcorpus), desktop/lib/updater.cjs (the in-app updater), the engine
 * (corpus.mjs: init, pulse, serve, context, ingest) and the interface (app/src/views: Shape, Document,
 * Tenets, Verdicts, Insights, Integrations).
 *
 * HONESTY CONTRACT for this page:
 *  · Windows x64 only. Unsigned and experimental.
 *  · Corpus runs on this PC: the corpus is files inside the project (.xeno/corpus/). Signing in is for the
 *    app's door; nothing about the corpus is uploaded.
 *  · Checks are commands the project already has. Corpus RUNS them when you run a pulse — say so.
 *    A command found in a document is never run (D211).
 *  · No team sharing, no hosted corpus yet (Aethera is a direction, not a feature). Do not imply either. */
const corpus: ProductContent = {
  slug: 'corpus',
  hero: {
    headline: 'Know which of your project’s claims are still true.',
    sub: 'XENO Corpus keeps the facts your project depends on — “tests pass”, “ports stay in range”, “every package is proprietary” — each tied to the check that can prove it false. Run a pulse and see what holds, what broke, and what nobody has checked.',
    media: { type: 'mockup', src: 'corpus-shape', alt: 'The XENO Corpus Shape canvas: a project corpus with claims marked held, lapsed and unknown, filtered to “False now”' },
    badges: ['Windows', 'Experimental', 'Unsigned build', 'XENO account'],
    note: 'Experimental · v0.2.1 · Windows x64 only. Updates itself.',
  },
  trust: [
    'Your corpus is files in your project, under .xeno/corpus/ — it stays on your PC',
    'A claim that was not checked says UNKNOWN, never HELD',
    'Commands found in documents are never run',
  ],
  highlights: [
    { value: 'Claims', label: 'Each bound to the check that can disprove it' },
    { value: 'Verdicts', label: 'Append-only history, committed with the project' },
    { value: 'Shape', label: 'A canvas that answers “what is false right now?”' },
    { value: 'Windows', label: '10 and 11, x64' },
  ],
  features: [
    {
      eyebrow: 'Shape',
      icon: 'Network',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,200,210,0.14), transparent 60%), linear-gradient(165deg,#15161a,#070707 74%)',
      title: 'Ask the canvas a question',
      desc: 'Open on Everything, False now or Unchecked. The canvas hides what does not answer, fits the view to what does, and says plainly when the answer is “nothing”. Focus 1–3 links around any card; zoomed out, cards stay readable.',
      bullets: ['Layout comes from the data, so nothing moves between visits', 'Your question and focus are remembered', 'Pulse history: view the corpus as it was at any past pulse'],
    },
    {
      eyebrow: 'Pulse',
      icon: 'Gauge',
      accent: 'radial-gradient(ellipse at 28% 30%, rgba(200,200,210,0.12), transparent 60%), linear-gradient(165deg,#141417,#070707 74%)',
      title: 'A pulse runs every check and records what it saw',
      desc: 'Each verdict is appended, never rewritten, so you can see when a claim stopped holding. A check that could not finish is recorded as unknown rather than guessed.',
      bullets: ['Held, lapsed, unknown and attested are four different states', 'History lives in the project and goes into git with it'],
    },
    {
      eyebrow: 'Start',
      icon: 'Layers',
      accent: 'radial-gradient(ellipse at 50% 20%, rgba(200,200,210,0.10), transparent 60%), linear-gradient(165deg,#131316,#070707 74%)',
      title: 'Open a folder; Corpus finds the first claims',
      desc: 'Point it at a project. If there is no corpus yet, XENO Corpus offers to create one: it reads the project, derives its first checks from what is already there, and runs the first pulse. Save a .xcorpus file to reopen the project with a double-click.',
    },
  ],
  howItWorks: [
    { step: '1', title: 'Install', desc: 'Run the installer. It installs for your user, with no administrator rights.' },
    { step: '2', title: 'Sign in', desc: 'Sign in with your XENO account in the browser.' },
    { step: '3', title: 'Open a project', desc: 'Choose a project folder. Create its corpus, run a pulse, and ask what is false right now.' },
  ],
  specs: [
    { label: 'Platform', value: 'Windows 10/11, x64' },
    { label: 'Installs to', value: 'Your user profile (no administrator rights)' },
    { label: 'Where the corpus lives', value: '<project>/.xeno/corpus/ — plain files you can commit' },
    { label: 'Project file', value: '.xcorpus (opens the project in XENO Corpus)' },
    { label: 'Updates', value: 'In the app: it downloads the new version and asks before restarting' },
  ],
  faq: [
    { q: 'Does Corpus upload my project?', a: 'No. The corpus is files inside your project, and checks run on this PC. Signing in only lets the app open; it does not send your corpus anywhere.' },
    { q: 'What does a pulse run?', a: 'The checks in your corpus, on this PC. A new corpus starts with checks Corpus derives from the project itself — for example whether a licence is declared, or whether the tree contains junctions — and you add your own, such as your tests. You can read every check before you run a pulse. Commands written in documents are never run.' },
    { q: 'Why does Windows warn when I install it?', a: 'The installer is not code-signed yet, so SmartScreen may show “Windows protected your PC”. Choose More info → Run anyway. The app says the same: an UNSIGNED BUILD badge sits in its window.' },
    { q: 'macOS or Linux?', a: 'Not yet. This release is Windows x64 only.' },
  ],
  autoUpdates: true,
};

export default corpus;
