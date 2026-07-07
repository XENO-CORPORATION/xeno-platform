import type { ProductContent } from './_types';

/* XENO Extension — sourced from ../xeno-extension (manifest.json, the sidepanel
 * renderer, background/agent-orchestrator.js tool set, background/api-client.js
 * model list, and docs/RELEASE.md channels). It's a shipping Manifest V3
 * Chromium extension (v1.0.0): a side-panel browser agent that reads pages and
 * acts on them (click / type / navigate / forms), gated by a permission mode.
 * Honest framing: distributed as a packaged build for Chromium browsers today. */
const extension: ProductContent = {
  slug: 'extension',
  hero: {
    headline: 'An agent that uses your browser like you do.',
    sub: 'XENO Extension is an AI agent in a Chromium side panel. It reads the page, then clicks, types, fills forms and navigates across tabs to finish the task — in Plan, Agent, or Chat mode, and it asks before it acts. Bring your own model, or run local.',
    media: { type: 'mockup', src: 'extension-hero', alt: 'XENO Extension — the side-panel browser agent reading a pricing page and extracting the tiers, with a permission approval prompt' },
    badges: ['Chrome · Edge · Brave', 'Manifest V3', 'BYO model / local', 'Free'],
    note: 'Free · a Manifest V3 extension for Chromium browsers (v1.0.0). Model calls route through the XENO API, your own key, or a local Ollama model.',
  },
  trust: ['Chromium extension — Chrome, Edge & Brave', 'Bring your own key, or run local via Ollama', 'Permission-gated — it asks before it acts'],
  highlights: [
    { value: 'In your browser', label: 'Side panel, any tab' },
    { value: 'Plan · Agent · Chat', label: 'Three working modes' },
    { value: 'Any model', label: 'Claude · GPT · local' },
    { value: 'You approve', label: 'Ask or act-on-its-own' },
  ],
  features: [
    {
      eyebrow: 'Browser control', icon: 'Bot',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.18), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'It clicks, types, and navigates for you',
      desc: 'A real browser agent, not a chat box. It drives the page through the debugger — the same actions you would take, done for you.',
      bullets: [
        'Click elements, type text, and fill & submit forms',
        'Navigate, scroll, select options, press keys, and wait',
        'Find elements and evaluate JavaScript on the page',
        'Take screenshots to see what it just did',
      ],
    },
    {
      eyebrow: 'Three modes', icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Plan it, run it, or just chat',
      desc: 'Switch modes right in the composer. Plan drafts the steps, Agent executes them with a live plan tracker, and Chat answers about the page without touching it.',
      bullets: [
        'PLAN — draft the steps before anything runs',
        'AGENT — execute end-to-end with a live step tracker',
        'CHAT — ask about the page, read-only',
        'Slash commands: /summarize, /markdown, /screenshot, /extract',
      ],
    },
    {
      eyebrow: 'Permissions', icon: 'ShieldCheck',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'It asks before it acts',
      desc: 'You choose how much rope it gets. Ask mode surfaces an approval prompt before each action; a site blocklist keeps it off the pages that matter.',
      bullets: [
        'Ask-before-acting or act-without-asking modes',
        'Per-action Allow / Deny approval prompts',
        'Site blocklist (e.g. your bank) and optional allowlist',
        'Runs on the active tab — nothing happens off-screen',
      ],
    },
    {
      eyebrow: 'Understands the page', icon: 'Globe',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'Reads any page — and the wider web',
      desc: 'It extracts clean, readable content from the page, copies it as Markdown, reads the console, and can search the web and open other pages to finish the job.',
      bullets: [
        'Readable page extraction and page info',
        'Copy the page as Markdown in one command',
        'Read another URL or search the web mid-task',
        'Inspect console logs when something breaks',
      ],
    },
    {
      eyebrow: 'Works across tabs', icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Your tabs are its context',
      desc: 'Open new tabs, list and switch between them, and @-mention any open tab to pull it into the conversation — so a task can span your whole session.',
      bullets: [
        'Open, list, and switch tabs on its own',
        '@-mention open tabs to add them as context',
        'History panel to revisit past sessions',
        'Attach images and files to a message',
      ],
    },
    {
      eyebrow: 'Any model', icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.14), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'Bring your own model — or run local',
      desc: 'Pick a model from the toolbar: cloud Claude and GPT through the XENO API or your own key, or a fully local model served by Ollama.',
      bullets: [
        'Claude Sonnet 4.6 / Opus 4.6 / Sonnet 4.5',
        'GPT-5.3 Codex and GPT-5.2',
        'Local & private via Ollama',
        'Your key or the XENO API — your choice',
      ],
    },
  ],
  useCases: [
    { title: 'Research & summarize', icon: 'Globe', desc: 'Point it at a page and get a clean summary, a Markdown copy, or the key facts — with web search when it needs more.' },
    { title: 'Fill forms & automate', icon: 'Zap', desc: 'Hand it the repetitive browser work — filling forms, clicking through flows, pulling data across tabs — and approve each step if you like.' },
    { title: 'Private & local', icon: 'Lock', desc: 'Run a local model through Ollama and blocklist sensitive sites, so your browsing and prompts stay on your machine.' },
  ],
  howItWorks: [
    { step: '1', title: 'Add the extension', desc: 'Load the packaged build into Chrome, Edge, or Brave and pin XENO to the toolbar.' },
    { step: '2', title: 'Open the side panel', desc: 'Press Ctrl+Shift+X (⌘+Shift+X on macOS), then pick a model and a mode.' },
    { step: '3', title: 'Ask it to do something', desc: 'Describe the task — it plans, acts with your approval, and works across your tabs.' },
  ],
  comparison: {
    competitor: 'most browser AI extensions',
    rows: [
      { feature: 'Reads & summarizes the page', xeno: true, them: true },
      { feature: 'Clicks, types & fills forms for you', xeno: true, them: 'Some' },
      { feature: 'Plan / Agent / Chat modes', xeno: true, them: false },
      { feature: 'Bring your own model / run local', xeno: 'Claude · GPT · Ollama', them: 'One provider' },
      { feature: 'Permission prompts + site blocklist', xeno: true, them: 'Varies' },
      { feature: 'Multi-tab context (@-mention tabs)', xeno: true, them: false },
      { feature: 'Established web-store presence & reviews', xeno: 'New', them: true },
    ],
  },
  specs: [
    { label: 'Browsers', value: 'Chrome · Edge · Brave (Chromium)' },
    { label: 'Manifest', value: 'Manifest V3 · side panel' },
    { label: 'Models', value: 'Claude · GPT · local (Ollama)' },
    { label: 'Version', value: '1.0.0 · stable' },
  ],
  faq: [
    { q: 'Which browsers does it support?', a: 'Any Chromium browser — Chrome, Edge, and Brave. It’s a Manifest V3 extension that opens in the browser’s side panel (Ctrl+Shift+X, or ⌘+Shift+X on macOS). A Safari track is planned.' },
    { q: 'How do I install it?', a: 'It ships as a packaged build for Chromium browsers. Load the extension, pin XENO to the toolbar, and open the side panel to start. Stable, beta, and preview channels are built separately.' },
    { q: 'Can it act without asking me?', a: 'By default it’s in Ask mode: it shows an Allow / Deny prompt before each action. You can switch to act-without-asking, and add a site blocklist (say, your bank) — or an allowlist — to bound where it runs.' },
    { q: 'Which models can it use?', a: 'Cloud Claude (Sonnet 4.6, Opus 4.6, Sonnet 4.5) and GPT (5.3 Codex, 5.2) via the XENO API or your own key — or a fully local model served by Ollama. Pick the model from the toolbar dropdown.' },
    { q: 'What can it actually do on a page?', a: 'Read and extract page content, copy it as Markdown, take screenshots, click elements, type text, fill and submit forms, navigate, scroll, select options, press keys, open and switch tabs, search the web, read other URLs, check console logs, and run JavaScript.' },
    { q: 'How much does it cost?', a: 'The extension is free. Model calls route through the XENO API, your own key, or a local Ollama model — so you only pay for the model usage you choose.' },
  ],
  seo: {
    title: 'XENO Extension — the AI browser agent for Chrome & Edge',
    description: 'A Manifest V3 side-panel agent that reads the page and acts on it — clicks, types, fills forms and navigates across tabs, in Plan / Agent / Chat mode, gated by a permission prompt. Bring your own model or run local. Free for Chromium browsers.',
  },
};

export default extension;
