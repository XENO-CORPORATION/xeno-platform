import type { ProductContent } from './_types';

/* XENO Research — sourced from ../xeno-research (SPEC.md, src/run.mjs, src/sign.mjs, src/box.mjs) and the platform
 * service that runs it (src/server/services/xenoResearch.js).
 *
 * HONESTY CONTRACT for this page:
 *  · EARLY ACCESS. Notebooks run only in XENO Box, and until Box's host safety is qualified the platform refuses runs
 *    for every workspace except XENO's own — the page says so instead of promising a run.
 *  · Python notebooks only (.ipynb, nbformat 4). Notebooks that declare input files cannot run here yet.
 *  · A signature proves WHO vouched for a record, not that the science is right; a re-run is what checks the result.
 *  · No desktop app, no CLI on this page: it lives in the xenosystem.ai workspace. */
const research: ProductContent = {
  slug: 'research',
  statusLabel: 'Early access',
  hero: {
    headline: 'Results that reproduce — and say so.',
    sub: 'XENO Research runs your Jupyter notebook in an isolated sandbox with no network, rebuilds its environment from a pinned, hashed lock, and signs a record of exactly what ran. Re-run it later and it tells you whether the result reproduced, changed because something it depends on moved, or failed to reproduce.',
    media: { type: 'mockup', src: 'research-hero', alt: 'A notebook in the XENO workspace: two cells with their outputs, a re-run marked Reproduced with a valid signature, and a claim about cell 2 marked Held' },
    badges: ['Early access', 'Jupyter .ipynb', 'XENO account'],
    note: 'Early access. Runs happen only in XENO Box; until its host safety is qualified they are open to the XENO workspace only, and anyone else sees the run refused with that reason.',
  },
  trust: [
    'Cells run in XENO Box with no network — never on a shared host',
    'Every finished run is signed with Ed25519 and checked again when you open it',
    'The notebook stays a standard .ipynb; the export carries W3C PROV provenance',
  ],
  highlights: [
    { value: '0', label: 'Network access while cells run' },
    { value: '3', label: 'Verdicts: reproduced · changed · not reproduced' },
    { value: '1', label: 'Lock per notebook, every package hashed' },
    { value: 'Signed', label: 'Every run record' },
  ],
  features: [
    {
      eyebrow: 'Reproduce',
      icon: 'Sigma',
      title: 'Re-run it, and know why it differs',
      desc: 'Verify re-runs a recorded run in a fresh sandbox and compares every cell. Different code, different data and a different environment are reported as what moved; the same everything with a different answer is the one real failure, and it is called that.',
      bullets: ['Reproduced, changed (with what moved) or not reproduced', 'The environment is rebuilt from the lock, not described after the fact', 'Object addresses are the only output normalised, and the record says so'],
    },
    {
      eyebrow: 'Claims',
      icon: 'ShieldCheck',
      title: 'A figure you publish stays checked',
      desc: 'Claim a cell of a finished run and its result becomes a tenet in the project’s Corpus. Re-checking it re-runs the notebook and records a signed verdict: held, lapsed, or unobserved when it could not be checked — never shown as passing.',
      bullets: ['One claim per cell, kept with the project', 'Each verdict is signed and kept, never edited', 'Lapsed claims and failed runs are on your Research home'],
    },
  ],
  howItWorks: [
    { step: '1', title: 'Add a notebook', desc: 'Open a project in your workspace and add a Jupyter notebook (.ipynb).' },
    { step: '2', title: 'Lock and run', desc: 'Lock resolves every package to one version and hash; Run executes the notebook in XENO Box and signs the record.' },
    { step: '3', title: 'Claim and verify', desc: 'Claim the results you publish, verify a run any time, and export the notebook with its provenance.' },
  ],
  specs: [
    { label: 'Format', value: 'Jupyter notebooks (nbformat 4), Python' },
    { label: 'Runs in', value: 'XENO Box — no network while cells run' },
    { label: 'Signature', value: 'Ed25519 over the canonical record' },
    { label: 'Export', value: 'Notebook, lock, provenance (JSON + W3C PROV), SHA256SUMS' },
  ],
  faq: [
    { q: 'Can I use it today?', a: 'It is in early access. Notebooks can be added and read; runs are refused for workspaces other than XENO’s until XENO Box is qualified, and the refusal says so.' },
    { q: 'Does it run my notebook on your servers?', a: 'In XENO Box, an isolated sandbox with no network while your cells run. There is no fallback that runs it anywhere else.' },
    { q: 'What does a signature prove?', a: 'That the record has not changed since it was signed, and who signed it. Whether the result holds is what a re-run checks.' },
  ],
};

export default research;
