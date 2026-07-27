import type { ProductContent } from './_types';

/* XENO Post — sourced from ../xeno-post (README.md + SPEC.md + the real
 * apps/web composer/preview/dashboard source).
 *
 * CORRECTED 2026-07-26. This file previously carried coming-soon framing
 * ("scaffolded v0.0.1", waitlist CTA, "We do NOT claim it ships"). That was
 * FALSE, and it stayed false because an earlier check probed `/auth/login`
 * — a path this app does not use — got a 404, and concluded "landing page,
 * not a running app". The real route is `/login`.
 *
 * Verified live on the host: `/`, `/login` (a real email+password sign-in
 * form), `/dashboard`, `/settings`, `/privacy`, `/terms` and `/data-deletion`
 * all return 200 through the tunnel, and all five containers on xeno-post-001
 * (web:4300, api:4301, worker:4302, postgres, redis) report healthy. The repo
 * is ~88.7k LOC with 30 connectors and 119 test files.
 *
 * LESSON: probe a route the app actually declares before concluding it is not
 * running. A single 404 on a guessed path is not evidence of absence.
 *
 * CORRECTED AGAIN 2026-07-27 — the opposite error. Four claims here were false:
 *   1. "GraphQL" — there is NO GraphQL in the codebase. No schema, no resolver,
 *      no server. Removed. (The product's own docs page already said GraphQL was
 *      roadmap-only; this landing page contradicted it.)
 *   2. "Surfaces: Web · Desktop · Mobile · CLI · MCP" — apps/desktop and
 *      apps/mobile contain ZERO files. Corrected to the surfaces that exist.
 *   3. "PDF reports" — there is no PDF library anywhere in the repo.
 *   4. "npm install @xeno-post/connector-<platform>" — those packages 404 on
 *      npm, and 0 of 28 connectors carry a `publishConfig`. The plugin SDK is
 *      real as an in-repo contract; it is NOT a published npm channel yet.
 *
 * ⚠ STILL OUTSTANDING, NOT FIXABLE FROM THIS REPO: the live post.xenostudio.ai
 * app serves "GraphQL" ~22× on its own homepage, 7× on /login, and in its OG
 * image. That copy lives in the xeno-post repo (apps/web) and needs a xeno-post
 * build + deploy. Fixing this file does not fix that surface.
 *
 * Locked facts: AGPL-3.0, self-host free forever, 25+ connectors targeted,
 * MCP-native, 7 roles incl. AGENT, per-channel (no seat) pricing, Nostr NIP-46
 * bunker signing (first in OSS). Beta: sign-up is open, connectors vary. */
const post: ProductContent = {
  slug: 'post',
  hero: {
    headline: 'One composer. Every audience. Everywhere.',
    sub: 'The open-source, AI-native social media command center. Schedule, publish, listen and reply across 25+ platforms — self-hosted, agent-driven, and free of seat tax and feature paywalls. Available now in beta.',
    media: { type: 'mockup', src: 'post-hero', alt: 'XENO Post composer — writing one post, previewing it per platform, publishing across X, Instagram and LinkedIn at once' },
    badges: ['AGPL-3.0', 'Self-host free forever', '25+ platforms', 'MCP-native'],
    note: 'Public beta at post.xenostudio.ai — sign-up is open. Self-hosting is free forever, no paywalled features.',
  },
  trust: ['Open source · AGPL-3.0', 'Self-host on Postgres + Redis — no seat tax', 'Part of the XENO platform, and runnable standalone'],
  highlights: [
    { value: '25+', label: 'Platforms, one composer' },
    { value: '7 roles', label: 'Agents are first-class members' },
    { value: 'Per-channel', label: 'Pricing — never per seat' },
    { value: 'MCP + REST', label: 'Native developer surface' },
  ],
  features: [
    {
      eyebrow: 'Publishing',
      icon: 'Globe',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Write once, tailor everywhere',
      desc: 'A multi-channel composer with a pixel-accurate preview per platform, character counts and capability checks — so a post is right before it ever leaves.',
      bullets: [
        'Per-platform preview, live character counters & capability validation',
        'Thread builder for X · Bluesky · Threads with auto-splitting',
        'Drag-and-drop calendar, categories, recurring & evergreen recycling',
        'Native scheduling where platforms allow it; client-side everywhere else',
      ],
    },
    {
      eyebrow: 'AI',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'AI that’s built in, not bolted on',
      desc: 'Generate captions in your brand voice, repurpose one idea into every platform’s format, and draft replies — with the provider you choose.',
      bullets: [
        'Captions, hashtags & hooks with per-workspace brand voice',
        'One source → platform-specific variations, carousels & clips',
        'BYOK: OpenAI, Anthropic, Google, Ollama — or fully local via xeno-rt',
        'xeno-rt is auto-detected and used by default to keep inference local',
      ],
    },
    {
      eyebrow: 'Agents',
      icon: 'Bot',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'Agents get a seat, not a sidebar',
      desc: 'AGENT is a real workspace role with attribution, scoped permissions and audit entries. A native MCP server lets any agent plan, draft and schedule a campaign.',
      bullets: [
        'Built-in MCP server — plug into Claude, ChatGPT, Cursor or xeno-agent-cli',
        'Plan → execute → observe → iterate campaign loop',
        'Every agent action is logged to an immutable, hash-chained audit trail',
        'Powered by xeno-agent-sdk when present; lightweight runtime when standalone',
      ],
    },
    {
      eyebrow: 'Engage',
      icon: 'MessageSquare',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Inbox, approvals & listening — together',
      desc: 'A unified inbox of DMs, comments, mentions and reviews; multi-step approvals with an external client portal; and free, federated social listening.',
      bullets: [
        'One inbox across every channel, sentiment-tagged with AI reply suggestions',
        'Multi-step approval chains + an external client sign-off portal',
        'Listening over X, Reddit, Mastodon, Bluesky, Nostr, Lemmy, HN & the web',
        'Per-post, per-channel and cross-channel analytics in the dashboard',
      ],
    },
    {
      eyebrow: 'Yours to run',
      icon: 'Blocks',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.14), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'Open, self-hostable, extensible',
      desc: 'AGPL-3.0 with every feature in the open-source build. A two-container floor, a real connector plugin SDK, and encrypted, self-owned credentials.',
      bullets: [
        'Postgres + Redis floor — one-click Coolify · Railway · Render · CapRover · K8s',
        'A real connector contract (PostConnector) — write one in-tree today; npm publishing is next',
        'Nostr NIP-46 bunker signing — the first federated scheduler of its kind',
        'Envelope-encrypted tokens (AES-256-GCM) with KMS-style rotation',
      ],
    },
  ],
  useCases: [
    { title: 'Solo creators', icon: 'Zap', desc: 'Cross-post once and schedule everywhere with a Buffer-class composer — free forever if you self-host, with native mobile apps on the roadmap.' },
    { title: 'Agencies', icon: 'Users', desc: 'White-label dashboards, client approval portals and multi-workspace tenancy — with per-channel pricing and no seat tax.' },
    { title: 'Developers & agents', icon: 'Boxes', desc: 'A versioned REST API plus a native MCP server and a connector contract — the only stack where an AI agent is a first-class workspace member.' },
    { title: 'Fediverse & Nostr natives', icon: 'Lock', desc: 'Schedule federated posts without handing over your keys — the only scheduler with NIP-46 bunker signing.' },
  ],
  howItWorks: [
    { step: '1', title: 'Self-host in minutes', desc: 'One command with Docker Compose (Postgres + Redis), or a one-click deploy on Coolify, Railway, Render or CapRover.' },
    { step: '2', title: 'Connect your channels', desc: 'Link accounts across 25+ platforms and bring your own AI key — or point it at a local xeno-rt for fully-local inference.' },
    { step: '3', title: 'Compose, schedule, listen', desc: 'Write once with a per-platform preview, schedule or publish now, then triage the inbox and track mentions — solo or with an agent.' },
  ],
  comparison: {
    competitor: 'most social tools',
    rows: [
      { feature: 'Publish & schedule across 25+ platforms', xeno: true, them: true },
      { feature: 'Self-host, every feature, no paywall', xeno: 'AGPL-3.0', them: false },
      { feature: 'Agents as first-class members (MCP-native)', xeno: true, them: 'Add-ons' },
      { feature: 'Out-of-tree connector plugin SDK', xeno: true, them: false },
      { feature: 'Nostr NIP-46 bunker signing', xeno: 'First in OSS', them: false },
      { feature: 'Pricing model', xeno: 'Per-channel', them: 'Per seat' },
      { feature: 'Mature ecosystem & polish today', xeno: 'In development', them: true },
    ],
  },
  specs: [
    { label: 'License', value: 'AGPL-3.0 (self-host free)' },
    { label: 'Deploy', value: 'Docker · Postgres + Redis' },
    { label: 'Surfaces', value: 'Web · CLI · REST · MCP' },
    { label: 'Status', value: 'Public beta' },
  ],
  faq: [
    { q: 'Is XENO Post available yet?', a: 'Yes — it’s in public beta at post.xenostudio.ai and sign-up is open. You can also self-host it: AGPL-3.0, Postgres + Redis, every feature in the open-source build. Connector coverage is still filling in toward the 25+ target, so check the one you need before you rely on it.' },
    { q: 'What will it cost?', a: 'Self-hosting is free forever under AGPL-3.0, with no paywalled or “Enterprise-only” features. The optional cloud is priced per channel — never per seat — with a free tier for a few channels.' },
    { q: 'Which platforms will it support?', a: 'The v0.1 target is 17 connectors (X, Facebook, Instagram, LinkedIn, TikTok, YouTube, Threads, Bluesky, Mastodon, Pinterest, Reddit, Discord, Telegram, WhatsApp, Slack, Lemmy, Nostr…), growing past 25. Anyone can ship more via the connector plugin SDK.' },
    { q: 'How is it “AI-native” and “agent-driven”?', a: 'AI is first-class: caption generation, brand voice, repurposing and reply drafting, with your choice of provider (or a fully-local xeno-rt). AGENT is a real workspace role, and a native MCP server lets agents plan and run campaigns end-to-end — every action audit-logged.' },
    { q: 'Do I need the rest of the XENO ecosystem?', a: 'No. XENO Post runs fully standalone on just Postgres + Redis. When xeno-rt, xeno-pixel, xeno-motion, xeno-sound, xeno-canvas or xeno-comms are reachable, it auto-detects them and unlocks local inference, in-composer media editing and real-time multiplayer.' },
    { q: 'What’s the Nostr NIP-46 bit?', a: 'XENO Post is the first social scheduler with NIP-46 “bunker” signing — you can schedule federated Nostr posts without ever exposing your signing key to the server.' },
  ],
  seo: {
    title: 'XENO Post — the open-source social media command center',
    description: 'Schedule, publish, listen and reply across 25+ platforms from one AI-native, agent-driven composer. Self-hostable and AGPL-3.0, with a connector plugin SDK, native MCP server and per-channel (never per-seat) pricing. Free public beta — sign-up is open.',
  },
};

export default post;
