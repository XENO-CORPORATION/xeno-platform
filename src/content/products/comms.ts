import type { ProductContent } from './_types';

/* XENO Comms — sourced from ../xeno-comms (README/PLAN + the desktop renderer).
 * Honest beta framing: the messenger core works on Windows today; E2EE message
 * sends + mobile are still rolling out. */
const comms: ProductContent = {
  slug: 'comms',
  hero: {
    headline: 'AI that’s part of the team.',
    sub: 'Real-time messaging where human teammates and AI agents share the same conversations — presence, threads, receipts and media, end-to-end-ready. Now in public test on Windows.',
    media: { type: 'mockup', src: 'comms-chat', alt: 'XENO Comms desktop client — conversations with people and an AI agent' },
    badges: ['Windows desktop', 'Agents as members', 'End-to-end ready', 'Free public test'],
    note: 'Free public test · E2EE message sends are gated while we harden them.',
  },
  trust: ['Part of the XENO platform — one sign-in', 'Open backend: Elixir · Rust · Go · ScyllaDB', 'Your messages, your keys'],
  highlights: [
    { value: 'Humans + agents', label: 'One shared inbox' },
    { value: 'Desktop now', label: 'Mobile & web next' },
    { value: 'End-to-end ready', label: 'Encryption built in' },
    { value: 'Open backend', label: 'Elixir · Rust · Go' },
  ],
  features: [
    {
      eyebrow: 'Conversations',
      icon: 'MessageSquare',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.16), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'Real-time messaging, the way you expect',
      desc: 'Direct messages, groups, and channels with the fundamentals done right — so it feels instant, not like a prototype.',
      bullets: [
        'Direct, group, and channel conversations',
        'Live presence, typing indicators, delivered & read receipts',
        'Replies, reactions, edits, and disappearing messages',
        'Drag-and-drop images, files, and voice notes',
      ],
    },
    {
      eyebrow: 'Agents',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'AI agents are first-class members',
      desc: 'Add an agent to any conversation and it participates with the full context — alongside people, not in a separate window.',
      bullets: [
        'Agents join conversations like teammates',
        'Summarize threads, draft replies, and take actions in-line',
        'Powered by the XENO agent runtime',
        'Opt-in per conversation — you stay in control',
      ],
    },
    {
      eyebrow: 'Privacy',
      icon: 'ShieldCheck',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'End-to-end ready, by design',
      desc: 'Device-based encryption is built into the protocol, not bolted on — with verifiable trust between devices.',
      bullets: [
        'Per-device key material and prekeys',
        'Safety-number verification of trusted devices',
        'Encrypted media attachments',
        'E2EE message sends are gated while hardened in the public test',
      ],
    },
    {
      eyebrow: 'Everywhere',
      icon: 'MonitorSmartphone',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Yours across every device',
      desc: 'One identity across the XENO platform, with multi-device sync and a real, open backend you could run yourself.',
      bullets: [
        'Windows desktop today; macOS, Linux, iOS & Android next',
        'Multi-device message sync',
        'One sign-in shared with the XENO platform',
        'Open backend: Elixir gateway, Rust API, Go workers',
      ],
    },
  ],
  gallery: [
    { type: 'image', src: '/product-assets/comms/gallery-1.webp', alt: 'XENO Comms desktop — a team channel where an AI agent posts a daily summary alongside teammates, with reactions and read receipts' },
    { type: 'image', src: '/product-assets/comms/gallery-2.webp', alt: 'XENO Comms — an AI agent summarizes an onboarding thread and offers next-step actions like assign, draft reply and schedule' },
  ],
  useCases: [
    { title: 'Product teams', icon: 'Users', desc: 'Run standups, reviews, and launches in channels — with an agent that summarizes the thread and tracks the follow-ups.' },
    { title: 'Human + agent workflows', icon: 'Bot', desc: 'Give an agent a seat in the room so it works from the full conversation, not a copy-pasted snippet.' },
    { title: 'Privacy-first groups', icon: 'Lock', desc: 'End-to-end-ready conversations for the messages that shouldn’t sit in plaintext on someone else’s server.' },
  ],
  howItWorks: [
    { step: '1', title: 'Download & sign in', desc: 'Get the Windows app and sign in with your XENO account.' },
    { step: '2', title: 'Start a conversation', desc: 'DM a teammate, spin up a group or channel, and share files.' },
    { step: '3', title: 'Add an agent', desc: 'Invite an AI agent into the conversation to summarize, draft, and act.' },
  ],
  comparison: {
    competitor: 'Slack',
    rows: [
      { feature: 'Real-time messaging, presence, receipts', xeno: true, them: true },
      { feature: 'AI agents as first-class members', xeno: true, them: 'Add-ons' },
      { feature: 'End-to-end encryption', xeno: 'Built in (ready)', them: false },
      { feature: 'Open, self-hostable backend', xeno: true, them: false },
      { feature: 'Mature ecosystem & integrations', xeno: 'Growing', them: true },
      { feature: 'Price', xeno: 'Free public test', them: 'Freemium' },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows (x64)' },
    { label: 'Account', value: 'XENO platform sign-in' },
    { label: 'Backend', value: 'Elixir gateway · Rust API · Go workers' },
    { label: 'Status', value: 'Public test (beta)' },
  ],
  faq: [
    { q: 'Is XENO Comms ready for production?', a: 'It’s a public test build. The core messenger — conversations, presence, receipts, media, and agents — works on Windows today. Some capabilities (E2EE message sends, mobile apps) are still rolling out.' },
    { q: 'What does “agents as members” mean?', a: 'You can add an AI agent to a conversation and it participates with the full context — summarizing threads, drafting replies, and taking actions — instead of living in a separate chat window.' },
    { q: 'Is it really end-to-end encrypted?', a: 'The encryption system — per-device keys, prekeys, safety-number verification, and encrypted media — is built in. During the public test, E2EE message sends are gated while it’s hardened.' },
    { q: 'Which platforms are supported?', a: 'Windows desktop is available now. macOS, Linux, and mobile (iOS/Android) are next.' },
    { q: 'How much does it cost?', a: 'The public test is free. Pricing for the general release will be announced later.' },
  ],
  seo: {
    title: 'XENO Comms — messaging for humans and agents',
    description: 'A real-time messenger where your team and your AI agents share the same conversations. End-to-end-ready, multi-device, open backend. Free public test on Windows.',
  },
};

export default comms;
