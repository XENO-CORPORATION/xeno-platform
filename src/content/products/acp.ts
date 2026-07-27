import type { ProductContent } from './_types';

/* XENO ACP.
 *
 * CORRECTED 2026-07-27 — IDENTITY. This page (and the R2 release feed) named
 * `@xeno-corporation/xeno-acp@0.1.0`, while npm `latest` is
 * `@xenosystem/acp@0.1.1`. Following our own install command therefore got you
 * the older scope. The @xenosystem scope is now the single published identity;
 * verified on the registry, all four packages at 0.1.1:
 *   @xenosystem/acp · acp-core · acp-agent · acp-provider-manager
 * The legacy @xeno-corporation/xeno-acp* packages still resolve at 0.1.0 and are
 * deliberately not linked from here.
 * The R2 feed (apps/acp/releases.json) is corrected separately — page and feed
 * MUST name the same scope and the same version. If you bump one, bump both. */
const acp: ProductContent = {
  slug: 'acp',
  hero: {
    headline: 'Every approved coding agent, behind one API.',
    sub: 'XENO ACP 0.1.1 drives configured Agent Client Protocol agents in-process or through an OpenAI-compatible local gateway. Install it from npm, consume structured tool and plan events, or use the tested integration inside the XENO Hub agent interface.',
    media: {
      type: 'mockup',
      src: 'acp-hero',
      alt: 'XENO ACP gateway console projecting an ACP turn into structured message, tool, plan and diff events',
    },
    badges: ['Public beta 0.1.1', 'npm · Node 20+', 'Windows + Linux', 'Apache-2.0'],
    note: 'Product-ready for the documented trusted-local Windows/Linux scope. macOS, official provider-owned ACP wrappers, and hostile-process containment are not claimed.',
  },
  trust: [
    'Release-tested standalone and in XENO Hub',
    'Fail-closed provider policy and approvals',
    'Your installed CLIs and your provider accounts',
  ],
  highlights: [
    { value: '4 packages', label: 'Gateway · core · agent · provider manager' },
    { value: '2 surfaces', label: 'Structured embed + OpenAI HTTP' },
    { value: 'Windows + Linux', label: 'Clean-candidate gates passed' },
    { value: 'XENO Hub', label: 'Packaged agent-interface integration' },
  ],
  features: [
    {
      eyebrow: 'One protocol', icon: 'GitBranch',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Configure an ACP agent once',
      desc: 'The framework-free client engine speaks ACP v1 over stdio and treats agent definitions as data. A configured agent can then be consumed by the gateway, an embedder, or XENO Hub.',
      bullets: [
        'Built-in client definitions for Claude Code, Codex, OpenCode, Gemini, Kimi and GLM',
        'Custom conforming ACP agents are added through configuration',
        'Protocol version is negotiated during initialize',
        'Provider installation and authentication stay with the local operator',
      ],
    },
    {
      eyebrow: 'Two surfaces', icon: 'Blocks',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Embed it, or call it over HTTP',
      desc: 'The same ACP client engine powers a typed in-process event stream and a local OpenAI-compatible gateway.',
      bullets: [
        '@xenosystem/acp-core — structured events with no HTTP or OpenAI types',
        '@xenosystem/acp — /v1/models and /v1/chat/completions',
        'Text and SSE for existing OpenAI-compatible clients',
        'Per-app bearer keys and configured agent allowlists',
      ],
    },
    {
      eyebrow: 'Provider operations', icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'One provider policy boundary',
      desc: 'The agent endpoint and provider-manager package keep catalog, lifecycle, approval, certification and diagnostics decisions in XENO ACP instead of duplicating them in every host.',
      bullets: [
        '@xenosystem/acp-agent — ACP stdio endpoint and adapter runtime',
        '@xenosystem/acp-provider-manager — catalog and lifecycle policy',
        'Definition + policy + hash-pinned approval must all pass',
        'Unimplemented or stale provider approvals fail closed',
      ],
    },
    {
      eyebrow: 'Honest boundary', icon: 'ShieldCheck',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'Contained callbacks, supervised processes',
      desc: 'ACP client filesystem and terminal callbacks are workspace-contained. Local adapter processes receive a no-shell, clean-environment lifecycle supervisor with bounded output and timeouts.',
      bullets: [
        'Path traversal and workspace escape are rejected',
        'Provider capability policy is deny-by-default and audited',
        'Separate provider processes are trusted local processes',
        'Network and hostile-process filesystem containment are not enforced',
      ],
    },
    {
      eyebrow: 'XENO Hub', icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.14), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'Built into the agent interface',
      desc: 'XENO Hub consumes the published core and provider-manager contracts for registry-backed setup, model discovery, approvals, diagnostics, certification and live session UX.',
      bullets: [
        'Provider catalog and model discovery in the Hub UI',
        'Approval and revocation flows preserve fail-closed policy',
        'Redacted diagnostics and support bundles',
        'Packaged Electron launch and isolated-profile smoke tested',
      ],
    },
    {
      eyebrow: 'Release evidence', icon: 'Lock',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'A reproducible public-beta candidate',
      desc: 'The 0.1.1 package set is verified as a clean install, as imported libraries, as runnable CLIs, and as a downstream Hub dependency on both validated platforms.',
      bullets: [
        'Hermetic fixture-backed automated suite; no real provider CLI in CI',
        'Clean package contents, dependency ranges and CLI version checks',
        'Reproducible tarballs with recorded SHA-256 checksums',
        'Windows and Ubuntu/Linux product-ready gates',
      ],
    },
  ],
  useCases: [
    { title: 'Local OpenAI-compatible gateway', icon: 'Globe', desc: 'Point an existing OpenAI client at localhost, list configured ACP agents as models, and stream a complete agent turn.' },
    { title: 'Structured application embedding', icon: 'Blocks', desc: 'Import the core when your app needs typed messages, tool calls, plans, usage and lifecycle events instead of flattened text.' },
    { title: 'XENO Hub agent workflows', icon: 'Boxes', desc: 'Manage providers and drive ACP sessions through the Hub agent interface with policy, approval and diagnostics visible to the operator.' },
  ],
  howItWorks: [
    { step: '1', title: 'Install', desc: 'Run npm install --global @xenosystem/acp on Windows or Linux with Node.js 20 or newer.' },
    { step: '2', title: 'Initialize and configure', desc: 'Run xeno-acp init, then edit xeno-acp.config.jsonc with the agents and local bearer keys you want.' },
    { step: '3', title: 'Start or embed', desc: 'Run xeno-acp --config ./xeno-acp.config.jsonc, or install @xenosystem/acp-core and consume AcpManager in-process.' },
  ],
  comparison: {
    competitor: 'per-provider integrations',
    rows: [
      { feature: 'Config-driven ACP client agents', xeno: true, them: 'Often custom code' },
      { feature: 'Structured tool / plan / usage events', xeno: true, them: 'Varies' },
      { feature: 'OpenAI-compatible local gateway', xeno: true, them: 'Varies' },
      { feature: 'Fail-closed provider approvals', xeno: true, them: 'Varies' },
      { feature: 'Packaged XENO Hub integration', xeno: true, them: false },
      { feature: 'Hostile-process OS sandbox', xeno: false, them: 'Varies' },
    ],
  },
  specs: [
    { label: 'Version', value: '0.1.1 · public beta' },
    { label: 'Platforms', value: 'Windows · Linux' },
    { label: 'Runtime', value: 'Node.js 20+ · ESM' },
    { label: 'Protocol', value: 'ACP v1 · JSON-RPC over stdio' },
    { label: 'Gateway', value: 'OpenAI-compatible · Fastify' },
    { label: 'License', value: 'Apache-2.0' },
  ],
  faq: [
    { q: 'How do I install XENO ACP?', a: 'Install the gateway with npm install --global @xenosystem/acp, run xeno-acp init, edit the generated local config, then start xeno-acp. Node.js 20 or newer is required.' },
    { q: 'Can I embed it instead of running HTTP?', a: 'Yes. Install @xenosystem/acp-core and consume AcpManager for the full structured event stream. The core has no HTTP framework and no OpenAI types.' },
    { q: 'Which platforms are supported?', a: 'Version 0.1.1 is release-tested on Windows and Ubuntu/Linux. macOS is not claimed for this release.' },
    { q: 'Which provider paths are official?', a: 'XENO ACP ships configured client definitions plus XENO-owned and XENO-authored local adapter paths. The claude-local and codex-local adapters wrap operator-installed third-party CLIs; they are not official Anthropic or OpenAI ACP implementations.' },
    { q: 'Is a provider process fully sandboxed?', a: 'No. Client-side file and terminal callbacks are workspace-contained, and cooperative adapters are policy-gated. The separate-process supervisor enforces lifecycle controls but does not enforce network or filesystem containment against a hostile child process.' },
    { q: 'Does XENO proxy provider credentials?', a: 'No. Providers use the operator’s own installed and authenticated CLI. XENO ACP does not pool, extract, proxy or resell provider credentials.' },
  ],
  seo: {
    title: 'XENO ACP 0.1.1 — ACP client, gateway and Hub integration',
    description: 'Install XENO ACP from npm: an embeddable ACP client engine, OpenAI-compatible local gateway, provider policy runtime, and tested XENO Hub agent-interface integration for Windows and Linux.',
  },
};

export default acp;
