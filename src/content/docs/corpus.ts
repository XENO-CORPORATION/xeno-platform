import type { ProductDocs } from './_types';

/* XENO Corpus desktop documentation — reconciled against xeno-corpus desktop 0.1.2 (Windows), 2026-10-27.
 * Every claim traces to that release: desktop/main.cjs (door, project opening, .xcorpus, menus),
 * desktop/lib/engine.cjs (the engine as a child process, `corpus init` on a folder with no corpus),
 * desktop/lib/updater.cjs (in-app updater, apps/corpus/ feed), desktop/lib/authLog.cjs (auth.log),
 * desktop/lib/project.cjs (the .xcorpus format), and the engine's own init (derived checks, first pulse)
 * and Shape view (app/src/views/Shape.tsx, docs/design/SHAPE-CANVAS.md). Windows x64 only. */
const corpus: ProductDocs = {
  slug: 'corpus',
  productName: 'XENO Corpus',
  tagline: 'Your project’s claims, each bound to the check that can prove it false.',
  version: '0.1.2',
  updated: '2026-10-27',
  seo: {
    title: 'XENO Corpus documentation',
    description: 'Install XENO Corpus on Windows, sign in, open a project, create its corpus, run a pulse, read the Shape canvas, and save a .xcorpus project file.',
  },
  sections: [
    {
      title: 'Getting started',
      pages: [
        {
          slug: 'introduction',
          title: 'Introduction',
          description: 'What XENO Corpus does, and what it does not do yet.',
          body: "## Introduction\n\nA project depends on facts that quietly stop being true: a licence field, a port range, a rule in a README. XENO Corpus keeps each of those facts as a **tenet** — a claim bound to the check that can prove it false — and records a **verdict** every time the check runs.\n\n| State | Meaning |\n|---|---|\n| **Held** | The last check ran and the claim was true |\n| **Lapsed** | The last check ran and the claim was false |\n| **Unknown** | The check has never run, or could not finish. Corpus never guesses here |\n| **Attested** | A person vouched for it; no automatic check exists |\n\nThe corpus is plain files inside your project, under `.xeno/corpus/`, so it goes into git with the code.\n\n## What it is not yet\n\n- **Windows x64 only.** No macOS or Linux build exists.\n- **One person, one PC.** There is no team sharing or hosted corpus yet.\n\n## Next steps\n\n- [Installation](/docs/corpus/installation)\n- [Opening a project](/docs/corpus/opening-a-project)\n- [The Shape canvas](/docs/corpus/shape)",
        },
        {
          slug: 'installation',
          title: 'Installation',
          description: 'Download and install XENO Corpus 0.1.2 on Windows.',
          body: "## Installation\n\nXENO Corpus 0.1.2 is available for **Windows 10 and 11 (x64)**.\n\n1. On the [product page](/product/corpus), choose **Download for Windows**.\n2. Run `XENO-Corpus-Setup-0.1.2.exe`. It installs for your user; no administrator rights are needed.\n3. The installer is **not code-signed yet**, so Windows SmartScreen may show *Windows protected your PC*. Choose **More info → Run anyway**. The app says so too: an **UNSIGNED BUILD** badge sits in its window.\n\n## Updates\n\nXENO Corpus checks for a new version when it starts and every few hours. It downloads it in the background and asks before restarting; if you choose **Later**, it installs the next time you quit.\n\n## Uninstalling\n\nUse **Settings → Apps → XENO Corpus → Uninstall**. Your projects and their corpora are not touched.",
        },
        {
          slug: 'signing-in',
          title: 'Signing in',
          description: 'XENO Corpus opens for a signed-in XENO account the platform allows.',
          body: "## Signing in\n\nXENO Corpus opens on a sign-in screen. Choose **Sign in to XENO**; your browser opens to finish signing in with your XENO account. XENO Corpus never sees your password.\n\nSigning in only opens the app. Your corpus is local files; it is not sent to XENO.\n\n## What the sign-in screen can say\n\n| Screen | What it means | What to do |\n|---|---|---|\n| **Welcome back** | No account is signed in on this PC | Sign in |\n| **XENO Corpus needs a plan** | The platform has not granted this account access to XENO Corpus | Check your account |\n| **Update XENO Corpus to continue** | This version is too old for the platform | Download the latest version from the product page |\n| **Your plan couldn’t be confirmed** | XENO could not be reached for too long | Check your connection and try again |\n\nIf XENO cannot be reached, a confirmed account keeps working for 14 days.\n\n## Signing out\n\n**File → Sign Out**.",
        },
      ],
    },
    {
      title: 'Using XENO Corpus',
      pages: [
        {
          slug: 'opening-a-project',
          title: 'Opening a project',
          description: 'Open a folder, create its corpus, and save a .xcorpus file.',
          body: "## Opening a project\n\n**File → Open Project…** (`Ctrl+O`) and choose a project folder or a `.xcorpus` file. XENO Corpus reopens the last project the next time it starts.\n\n## A folder with no corpus\n\nIf the folder has no corpus yet, XENO Corpus asks before doing anything. **Create corpus** reads the project, writes `.xeno/corpus/` inside it, derives its first checks from what is already there — for example whether a licence is declared, whether the package is marked private, whether the tree contains junctions — and runs the first pulse. Nothing outside the folder is changed.\n\n## The .xcorpus file\n\n**File → Save Project File (.xcorpus)** writes a small file in the project folder. Double-click it to open that project in XENO Corpus. It holds no corpus data — only where the project is — so it is safe to commit:\n\n```json\n{ \"format\": \"xeno-corpus/project\", \"version\": 1, \"project\": \".\" }\n```",
        },
        {
          slug: 'pulse',
          title: 'Running a pulse',
          description: 'Run every check, and read what changed.',
          body: "## Running a pulse\n\n**Run pulse** runs every check in the corpus on this PC and appends a verdict for each. Verdicts are never rewritten, so **Verdicts** shows when a claim stopped holding.\n\nA check that could not finish — a missing tool, a timeout — is recorded as **Unknown**, never as held.\n\nChecks are commands, and a pulse runs them with your permissions. Read a check in the inspector before you run it. A command found inside a document is never run.\n\n## Adding a claim\n\n**New tenet** (`N`) opens the form: the claim in words, the command that checks it, and the output that means it holds. It can only be saved after the exact draft has been tested once.",
        },
        {
          slug: 'shape',
          title: 'The Shape canvas',
          description: 'Ask the canvas a question instead of reading the whole graph.',
          body: "## The Shape canvas\n\n**Shape** draws the corpus as lanes of cards. The layout comes from the data, so nothing moves between visits.\n\n## Ask a question\n\nAt the top left, choose what to show:\n\n- **Everything** — the whole corpus.\n- **False now** — claims whose last check failed.\n- **Unchecked** — claims never checked, or with no conclusive result, plus gaps.\n\nThe canvas hides what does not answer and fits the view to what does. When the answer is nothing, it says so.\n\n## Focus around a card\n\nSelect a card and choose **Around selection 1, 2 or 3** to show only what is that many links away, in both directions. The selected card always stays visible.\n\nYour question and focus are remembered. Zoomed out below half size, cards switch to a large label coloured by state so they stay readable. Drag to pan, scroll to zoom, `F` to fit.",
        },
      ],
    },
    {
      title: 'Help',
      pages: [
        {
          slug: 'troubleshooting',
          title: 'Troubleshooting',
          description: 'The app will not open a project, sign-in fails, or a check stays unknown.',
          body: "## Troubleshooting\n\n## Sign-in does not finish\n\nThe browser must reach `xenosystem.ai` and return to the app on this PC. **Help → Show Sign-in Log** opens the folder with `auth.log`, which records each sign-in step without any password, token or email.\n\n## The project does not open\n\n- **Ports in use**: XENO Corpus serves the project on this PC at port 30625, or 30626 or 30627 if that one is taken. Close other `corpus serve` windows and try again.\n- **The installed interface is damaged**: reinstall from the product page.\n\n## A check stays Unknown\n\nThe check never finished. Open it in the inspector and run its command yourself in a terminal in the project folder; a missing tool or a wrong path is the usual cause.",
        },
      ],
    },
  ],
};

export default corpus;
