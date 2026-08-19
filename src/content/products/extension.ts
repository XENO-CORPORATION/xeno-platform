import type { ProductContent } from './_types';

/* XENO Extension — sourced from ../xeno-extension (manifest.json, the sidepanel
 * renderer, background/agent-orchestrator.js tool set, background/api-client.js
 * model list, and docs/RELEASE.md channels). A Manifest V3 Chromium extension:
 * a side-panel browser agent that reads pages and acts on them (click / type /
 * navigate / forms), gated by a permission mode.
 *
 * AVAILABILITY — updated 2026-08-08. The earlier note said nothing was
 * installable and to restore install copy only once "a Chrome Web Store listing
 * is live OR a new package channel is published". The second condition is now
 * MET: 1.1.0 is published to R2 (apps/extension/, feed at releases.json) after
 * the 1.0.0 artifacts were withdrawn for embedding a since-rotated shared key.
 *
 * But this is a TESTER channel, not general availability, and the copy must say
 * so: **Chrome has blocked installing extensions from outside the Web Store on
 * Windows since Chrome 33.** A downloaded ZIP cannot be installed the normal
 * way — it must be loaded via Developer Mode → Load unpacked, Chrome nags about
 * developer-mode extensions on every start, and it does not auto-update. So:
 * describe how to load it and who it is for, and do NOT claim general
 * availability or add a "Free · available" note until a Web Store listing is
 * live.
 *
 * The catalog entry DOES carry an `externalUrl` (the published ZIP) so the page
 * renders a real Download button — without it the CTA was only "Get notified",
 * and this copy would have promised a build the page refused to hand over.
 * ⚠️ That is safe ONLY because the entry also sets `signing: 'none'`:
 * externalUrl makes installChannel() resolve to 'archive', which DEFAULTS to
 * unsigned and would assert smartScreen:true — "More info → Run anyway" for a
 * dialog a ZIP of JavaScript can never trigger. Do not remove that field.
 * Both directions are pinned by scripts/experimental-notice.test.mjs.
 *
 * CORRECTED 2026-07-27 — seven lines claimed Claude and GPT models. The shipped
 * build's catalog is xAI GROK ONLY. Verified in dist/stable/extension/background/
 * api-client.js: DEFAULT_MODEL = 'grok-4.3', and FALLBACK_MODELS is four entries,
 * every one provider:'xai' (grok-4.3, grok-3-mini, grok-3-mini-fast,
 * grok-4.20-0309-non-reasoning). Same four hard-coded in options/options.html;
 * sidepanel/index.html ships a single <option value="grok-4.3">. ZERO Claude and
 * ZERO GPT entries anywhere in the shipped build.
 * Nuance worth keeping honest in BOTH directions: api-client.js does replace the
 * built-in list with whatever /v1/models returns, plus locally discovered Ollama
 * models — so the live list can be wider than the four. What we may NOT do is
 * name specific Claude/GPT versions as if they were the shipped catalog.
 * (When that correction was made the page was coming-soon, so nobody had been
 * misled; it now offers a real download, which is exactly why it had to be
 * right before this point.) */
const extension: ProductContent = {
  slug: 'extension',
  hero: {
    headline: 'An agent that uses your browser like you do.',
    sub: 'XENO Extension is an AI agent in a Chromium side panel. It reads the page, then clicks, types, fills forms and navigates across tabs to finish the task — in Plan, Agent, or Chat mode, and it asks before it acts. It ships with xAI Grok models, and can use whatever your XENO account offers or a local model via Ollama.',
    media: { type: 'mockup', src: 'extension-hero', alt: 'XENO Extension — the side-panel browser agent reading a pricing page and extracting the tiers, with a permission approval prompt' },
    badges: ['Chrome · Edge · Brave', 'Manifest V3', 'BYO model / local', 'Tester build · load unpacked'],
    note: 'A 1.1.0 tester build is available to download, but it is not on the Chrome Web Store yet — and Chrome refuses to install extensions from outside the store, so you have to load it yourself via Developer Mode → Load unpacked. That means no auto-update and a developer-mode reminder from Chrome each time it starts. Get notified and we’ll tell you the day the store listing goes live.',
  },
  trust: ['Built for Chromium — Chrome, Edge & Brave (not Firefox)', 'Ships with Grok; local models via Ollama', 'Permission-gated — it asks before it acts', 'Ships no API key — you pick the provider'],
  highlights: [
    { value: 'In your browser', label: 'Side panel, any tab' },
    { value: 'Plan · Agent · Chat', label: 'Three working modes' },
    { value: 'Grok built in', label: 'Plus local via Ollama' },
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
      title: 'Grok in the box — or run local',
      desc: 'Pick a model from the toolbar. The build ships with xAI Grok models selected by default; the list is then refreshed from whatever your XENO account exposes, and any Ollama models it finds running locally are added to it.',
      bullets: [
        'Ships with Grok 4.3 (default), Grok 4.20, Grok 3 Mini and Grok 3 Mini Fast',
        'The live list comes from your XENO account — it can be wider than the built-in four',
        'Local & private via Ollama, auto-discovered',
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
    { step: '1', title: 'Load the tester build', desc: 'Download and unzip 1.1.0, open chrome://extensions, turn on Developer mode, then choose “Load unpacked”. Chrome blocks off-store installs, so this is the only route until the Web Store listing is live.' },
    { step: '2', title: 'Pick where the AI runs', desc: 'Sign in to XENO, point it at a local Ollama model, or paste your own key. It ships with no key of its own, so this step is not optional.' },
    { step: '3', title: 'Open the side panel', desc: 'Press Ctrl+Shift+X (⌘+Shift+X on macOS), choose a model and a mode, and describe the task — it plans, acts with your approval, and works across your tabs.' },
  ],
  comparison: {
    competitor: 'most browser AI extensions',
    rows: [
      { feature: 'Reads & summarizes the page', xeno: true, them: true },
      { feature: 'Clicks, types & fills forms for you', xeno: true, them: 'Some' },
      { feature: 'Plan / Agent / Chat modes', xeno: true, them: false },
      { feature: 'Your account or fully local', xeno: 'XENO account · Ollama', them: 'One provider' },
      { feature: 'Permission prompts + site blocklist', xeno: true, them: 'Varies' },
      { feature: 'Multi-tab context (@-mention tabs)', xeno: true, them: false },
      { feature: 'Established web-store presence & reviews', xeno: 'Not listed yet', them: true },
      { feature: 'One-click install from the Web Store', xeno: 'Not yet', them: true },
      { feature: 'Download a build and load it yourself today', xeno: '1.1.0', them: 'Rarely' },
    ],
  },
  specs: [
    { label: 'Browsers', value: 'Chrome · Edge · Brave (Chromium)' },
    { label: 'Manifest', value: 'Manifest V3 · side panel' },
    { label: 'Models', value: 'xAI Grok · local (Ollama)' },
    { label: 'Status', value: '1.1.0 tester build · not on the Web Store' },
  ],
  faq: [
    { q: 'Can I install it right now?', a: 'You can run it, but not the easy way. The 1.1.0 build is published and you can download it — however it is not on the Chrome Web Store yet, and since Chrome 33 Chrome refuses to install extensions from anywhere else on Windows. So the only route is the developer one: unzip it, open chrome://extensions, turn on Developer mode, and choose “Load unpacked”. Chrome will remind you about developer-mode extensions every time it starts, and the build will not auto-update. If that sounds like more than you want, use “Get notified” and we’ll tell you the day the store listing is live.' },
    { q: 'Why isn’t it on the Chrome Web Store yet?', a: 'It hasn’t been submitted. The build itself is ready — it ships no API key, the safety gates are enforced in code, and a browser test suite loads the packaged build into a real Chrome on every change. What’s outstanding is the store developer account and the review submission, which is paperwork on our side, not engineering.' },
    { q: 'What happened to the earlier 1.0.0 download?', a: 'It was withdrawn. Those builds bundled a shared XENO API key so that cloud inference worked with no account, which meant every install was using one key belonging to us. That key has been retired and rotated, the affected downloads were removed, and 1.1.0 ships no key at all — you choose a provider instead. If you still have 1.0.0 installed, upgrading deletes any stored copy of the old key automatically.' },
    { q: 'Which browsers will it support?', a: 'Any Chromium browser — Chrome, Edge, and Brave. It’s a Manifest V3 extension that opens in the browser’s side panel (Ctrl+Shift+X, or ⌘+Shift+X on macOS). A Safari track is planned.' },
    { q: 'Is there anything I can use in the meantime?', a: 'XENO Browser — it’s in public beta on Windows and puts the same kind of agent inside our own Chromium browser, with capabilities an extension can’t reach.' },
    { q: 'Can it act without asking me?', a: 'By default it’s in Ask mode: it shows an Allow / Deny prompt before each action. You can switch to act-without-asking, and add a site blocklist (say, your bank) — or an allowlist — to bound where it runs.' },
    { q: 'Which models can it use?', a: 'The build ships with xAI Grok models — Grok 4.3 as the default, plus Grok 4.20, Grok 3 Mini and Grok 3 Mini Fast. On connecting it refreshes that list from your XENO account, so what you actually see may be wider, and it adds any Ollama models it finds running locally for fully private use. Pick from the toolbar dropdown. (An earlier version of this page listed specific Claude and GPT models as the shipped catalog — that was wrong.)' },
    { q: 'What can it actually do on a page?', a: 'Read and extract page content, copy it as Markdown, take screenshots, click elements, type text, fill and submit forms, navigate, scroll, select options, press keys, open and switch tabs, search the web, read other URLs, check console logs, and run JavaScript.' },
    { q: 'How much will it cost?', a: 'The extension will be free. Model calls route through the XENO API, your own key, or a local Ollama model — so you only pay for the model usage you choose.' },
  ],
  /* `description` is the ONE piece of this page that is server-rendered (it is
   * the meta/og/twitter description in the prerendered <head>); everything else
   * is client-rendered from the bundle. So it has to be updated in the same pass
   * as the body copy or the page contradicts itself exactly where crawlers and
   * social cards read it — which is what happened on 2026-08-08 when the body
   * started offering a tester build while this line still said "Not yet
   * available to install". */
  seo: {
    title: 'XENO Extension — the AI browser agent for Chrome & Edge',
    description: 'A Manifest V3 side-panel agent that reads the page and acts on it — clicks, types, fills forms and navigates across tabs, in Plan / Agent / Chat mode, gated by a permission prompt. Inference runs on your XENO account or a local Ollama. A 1.2.0 tester build is available to load unpacked; the Chrome Web Store listing is not live yet.',
  },
  /* Mirrors ../../../xeno-extension/PRIVACY.md — that file is what a web-store
   * reviewer reads, this is the public URL the listing points at. Keep the two in
   * sync and keep `updated` equal to the date in that file: the policy text last
   * changed 2026-07-17, and publishing it later does not make it newer. */
  privacy: {
    updated: '2026-07-17',
    intro: 'XENO Extension is an AI agent that acts on web pages on your behalf. This policy explains what data it processes, where that data goes, and what it never does.',
    sections: [
      {
        heading: 'What the extension processes',
        bullets: [
          { term: 'Page content you direct it to work with.', text: 'To answer questions or perform actions, the extension reads the content, structure and accessibility tree of the active tab, and of any tab you explicitly tag. This happens only for tasks you start.' },
          { term: 'Your instructions.', text: 'The messages you type into the side panel.' },
          { term: 'Screenshots.', text: 'Captured only when you explicitly ask for one.' },
        ],
      },
      {
        heading: 'Where that data goes',
        body: 'Page content and instructions are sent to the AI provider you choose, and to nobody else:',
        bullets: [
          { term: 'XENO Cloud.', text: 'Routed through the XENO platform at xenostudio.ai using your signed-in account, which meters usage. Governed by the XENO platform privacy policy.' },
          { term: 'XENO Direct API.', text: 'Sent to the XENO inference API at api.xenostudio.ai using a XENO API key that you enter yourself.' },
          { term: 'Ollama (local).', text: 'Stays on your machine. Nothing leaves your computer.' },
          { term: 'Custom endpoint.', text: 'Sent to the OpenAI-compatible URL you configure, using your own key.' },
        ],
        footnote: 'You choose which provider is active in Settings → AI Provider, and the local and bring-your-own options need no XENO account. For the research tools (web search and read-web-page) only the search query or the public URL is sent to the configured provider, and the extension blocks and redacts outbound queries that contain secret-shaped tokens.',
      },
      {
        heading: 'What is stored, and where',
        bullets: [
          { term: 'Locally on your device.', text: 'In chrome.storage.local: your settings, provider configuration, any custom endpoint key you enter, and your chat history. Chat history is truncated and never includes image attachments.' },
          { term: 'Your XENO session token.', text: 'Stored locally and used only to authenticate cloud requests. It is never exposed to web pages.' },
          { term: 'No server of our own.', text: 'The extension runs no server and keeps no server-side copy of your page content or chats beyond what your chosen AI provider processes to fulfil a request.' },
        ],
      },
      {
        heading: 'What the extension never does',
        bullets: [
          { text: 'It ships no shared API key, and never bills usage to anyone but the account or endpoint you configure.' },
          { text: 'It does not collect your browsing history, and runs no analytics and no advertising.' },
          { text: 'It does not sell or share your data with third parties.' },
          { text: 'It does not transmit page content anywhere except the AI or research provider you selected for that task.' },
          { text: 'It does not enter passwords or submit sensitive forms without your explicit confirmation.' },
        ],
      },
      {
        heading: 'Permissions',
        body: 'Every permission the extension requests maps to a capability you can see: reading the page in order to act on it, performing trusted input, and reaching a local model you are running. Broad host access exists because an agent has to work on whichever site you point it at. The per-permission justification is published with the web-store listing.',
      },
      {
        heading: 'Your controls',
        bullets: [
          { text: 'Sign out at any time (Settings → Sign out) to stop all cloud requests.' },
          { text: 'Use Ollama or a custom endpoint to keep your data local or on your own provider.' },
          { text: 'Clear chat history from the side panel.' },
          { text: 'Configure site allow and block lists to bound where the agent may act.' },
        ],
      },
    ],
    contact: 'privacy@xenostudio.ai',
  },
};

export default extension;
