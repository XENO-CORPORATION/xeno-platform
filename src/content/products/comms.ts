import type { ProductContent } from './_types';

/* XENO Comms — claims corrected 2026-07-26 against the live deployment and the
 * shipped 0.1.0 artifact. Ground truth, all verified:
 *   - The published installer (R2 apps/comms/v0.1.0, sha 51f0b78f…, built 2026-06-25)
 *     is real and points at the live endpoints. API /v1/* answers; the Phoenix
 *     gateway accepts an authenticated socket. Messaging genuinely works.
 *   - It is an INTERNAL ALPHA, not a public beta: unsigned installer, alpha auth
 *     (server refuses alpha auth in production — the deployment runs as
 *     `environment: development`), push + auto-update off in this package.
 *   - Sign-in is an auto-created alpha test account, NOT a XENO platform account.
 *   - E2EE is the alpha sealed-message path, not Signal-protocol; message sends
 *     are gated and the server hard-blocks alpha E2EE in production.
 *   - The agent-member exists in the codebase but needs platform auth, so it is
 *     OFF in the shipped build.
 *   - Reactions do not exist in the codebase. Channels can't be created (DM +
 *     group only). Mobile is paused. Backend is PROPRIETARY, not self-hostable.
 * Do not restore a larger claim without re-verifying it against a shipped build.
 */
const comms: ProductContent = {
  slug: 'comms',
  hero: {
    headline: 'Messaging built for humans and agents.',
    sub: 'Direct and group conversations with live presence, typing, read receipts, and media — running against real XENO servers. This is an early internal alpha on Windows: agent members and end-to-end encryption are built but not switched on yet.',
    media: { type: 'mockup', src: 'comms-chat', alt: 'XENO Comms desktop client — a group conversation with presence and read receipts' },
    badges: ['Windows desktop', 'Internal alpha', 'Unsigned installer', 'Free test build'],
    note: 'Internal alpha. The installer is unsigned, so Windows will warn you. It creates a temporary alpha test account — not your XENO account.',
  },
  trust: [
    'Messaging, presence, receipts and media work against live servers',
    'Backend: Elixir gateway · Rust API · Go workers',
    'Alpha test accounts — no production identity, no production guarantees',
  ],
  highlights: [
    { value: 'Windows', label: 'Internal alpha only' },
    { value: 'Messaging works', label: 'Presence, receipts, media' },
    { value: 'Agents next', label: 'Not enabled in this build' },
    { value: 'E2EE in progress', label: 'Alpha path, not Signal-grade' },
  ],
  features: [
    {
      eyebrow: 'Conversations',
      icon: 'MessageSquare',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.16), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'The messaging core, working today',
      desc: 'This is the part that is real. Direct and group conversations over a live realtime gateway, with the fundamentals wired end to end.',
      bullets: [
        'Direct and group conversations (channels and threads come later)',
        'Live presence, typing indicators, delivered & read receipts',
        'Replies, edits, deletes, and disappearing messages',
        'Image, file, and voice-note attachments with server-side scanning',
      ],
    },
    {
      eyebrow: 'Agents',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Agents as members — built, not yet switched on',
      desc: 'The design goal is an agent that holds a seat in the conversation like anyone else, on the same member model as a human. The code path exists and runs, but it needs XENO platform sign-in, which this alpha build does not use.',
      bullets: [
        'Not available in the current download',
        'Agent members reuse the ordinary member and message model — no separate bot API',
        'Runs on the hosted XENO agent runtime; replies meter account credits',
        'Ships once this build moves from alpha accounts to platform sign-in',
      ],
    },
    {
      eyebrow: 'Privacy',
      icon: 'ShieldCheck',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Encryption is unfinished — treat this alpha as untrusted',
      desc: 'Per-device key material, prekeys, and encrypted attachments are implemented, but the message path is an alpha sealed-message scheme, not production Signal-protocol sessions. It has not had a security review.',
      bullets: [
        'Not end-to-end encrypted in any sense you should rely on',
        'Encrypted message sends are gated off in this build',
        'Group sender keys and full double-ratchet state are still missing',
        'Independently reviewed device verification is still to come',
      ],
    },
    {
      eyebrow: 'Platforms',
      icon: 'MonitorSmartphone',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Windows only, for now',
      desc: 'One Windows desktop build, distributed outside any store. Mobile is paused until the Windows client is proven, and the backend is XENO-operated, not something you can run yourself.',
      bullets: [
        'Windows (x64) desktop only — macOS, Linux, and web are later phases',
        'iOS and Android are paused until Windows is proven',
        'No push notifications and no auto-update in this package',
        'Backend is proprietary and XENO-hosted',
      ],
    },
  ],
  gallery: [
    { type: 'mockup', src: 'comms-agent-actions', alt: 'Concept: an AI agent posting a thread summary and next-step actions — not enabled in the current alpha build' },
  ],
  useCases: [
    { title: 'Small-group testing', icon: 'Users', desc: 'Install it on a few Windows machines, swap user IDs, and stress the DM, group, media, and reconnect paths.' },
    { title: 'Feedback on the core', icon: 'MessageSquare', desc: 'Tell us where messaging, presence, receipts, or attachments break before the agent and encryption layers land on top.' },
    { title: 'Following the build', icon: 'Bot', desc: 'See where agent-native messaging is heading while it is still being assembled in the open.' },
  ],
  howItWorks: [
    { step: '1', title: 'Download & install', desc: 'Get the Windows alpha. The installer is unsigned, so you will need to click through the SmartScreen warning.' },
    { step: '2', title: 'Open the app', desc: 'It creates a temporary alpha test account for you automatically. There is no XENO sign-in in this build.' },
    { step: '3', title: 'Share your ID and talk', desc: 'Swap user IDs with another tester to start a DM or a group, then send text, files, and voice notes.' },
  ],
  comparison: {
    competitor: 'most team chat apps',
    rows: [
      { feature: 'Direct & group messaging, presence, receipts', xeno: true, them: true },
      { feature: 'Channels, threads, and workspaces', xeno: 'Later phase', them: true },
      { feature: 'AI agents as first-class members', xeno: 'Built, not enabled', them: 'Add-ons' },
      { feature: 'End-to-end encryption', xeno: 'Not yet', them: 'Varies' },
      { feature: 'Production-ready', xeno: 'No — internal alpha', them: true },
      { feature: 'Price', xeno: 'Free alpha', them: 'Freemium' },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows (x64)' },
    { label: 'Account', value: 'Auto-created alpha test account' },
    { label: 'Backend', value: 'Elixir gateway · Rust API · Go workers' },
    { label: 'Status', value: 'Internal alpha — not for production use' },
  ],
  faq: [
    { q: 'Is XENO Comms ready for production?', a: 'No. It is an internal alpha. The messaging core — direct and group conversations, presence, typing, receipts, and media — genuinely works against live servers, but the installer is unsigned, there is no auto-update or push, and none of it carries production guarantees. Do not put anything important in it.' },
    { q: 'Is it end-to-end encrypted?', a: 'Not in a way you should rely on. Per-device keys, prekeys, and encrypted attachments are implemented, but the message path is an alpha sealed-message scheme rather than production Signal-protocol sessions, and encrypted sends are gated off in this build. It has not been through a security review.' },
    { q: 'Can I use AI agents in it?', a: 'Not in this download. Agent membership is built — an agent joins on the same member model as a human, with no separate bot API — but it needs XENO platform sign-in, and this alpha uses temporary local test accounts instead.' },
    { q: 'Do I sign in with my XENO account?', a: 'No. This build creates a throwaway alpha test account on first launch. Unified XENO sign-in arrives when the client moves off alpha auth.' },
    { q: 'Which platforms are supported?', a: 'Windows only. macOS, Linux, and web are later phases, and iOS/Android are paused until the Windows client is proven.' },
    { q: 'Can I run the backend myself?', a: 'No. The backend is proprietary and XENO-hosted. The stack is Elixir, Rust, and Go, but it is not open source or self-hostable.' },
    { q: 'How much does it cost?', a: 'The alpha is free. Pricing for a general release will be announced later.' },
  ],
  seo: {
    title: 'XENO Comms — messaging for humans and agents (internal alpha)',
    description: 'An early internal-alpha messenger for Windows. Direct and group conversations with presence, receipts, and media against live servers. Agent members and end-to-end encryption are built but not yet enabled.',
  },
  statusLabel: 'Internal alpha',
  downloadNotice:
    'This is an internal alpha, not a public release. The installer is unsigned, so Windows SmartScreen will warn you. The app signs you into a temporary alpha test account rather than your XENO account, it is not meaningfully encrypted, and it will not update itself — you will need to reinstall for a newer build. Please do not use it for anything sensitive.',
  autoUpdates: false,
};

export default comms;
