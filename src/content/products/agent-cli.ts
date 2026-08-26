import type { ProductContent } from './_types';

/* XENO Agent CLI — sourced from ../xeno-agent-cli (README/CLAUDE.md + the TUI in
 * apps/xeno-agent-cli/src/ui). A `delivery: cli` product: CTA is the install
 * command + release feed. Honest beta framing (proprietary).
 * Keep versions as an x.y.x LINE — npm publishes patches faster than this page
 * is edited, so an exact patch number here is wrong within days.
 *
 * CORRECTED 2026-07-27, verified against the npm registry:
 *  · SCOPE. The CLI moved to @xenosystem. npm `latest`:
 *      @xenosystem/agent-cli            0.5.17   ← the live product
 *      @xeno-corporation/xeno-agent-cli 0.4.45   ← frozen, 13 patches behind
 *    Both still resolve, so this was not a dead command — it was a command that
 *    silently installed an older build. Same defect class as XENO ACP. The
 *    binaries are unchanged (`xeno`, `xeno-agent`, `xeno-code`), and 0.5.17
 *    depends on @xenosystem/agent-sdk@0.8.12.
 *  · THE curl / PowerShell ONE-LINER DOES NOT WORK. This page and the docs
 *    advertised `curl -fsSL https://xenostudio.ai/install.sh | sh` and
 *    `irm https://xenostudio.ai/install.ps1 | iex`. Neither file exists: there
 *    is no install.sh or install.ps1 in public/, so both paths fall through to
 *    the SPA and return index.html — 200 OK, content-type text/html, the same
 *    4,311 bytes as the homepage (verified against the live site 2026-07-27).
 *    Following our own instructions therefore piped an HTML document into `sh`.
 *    npm is the only working channel; do not restore a one-liner until the
 *    scripts are actually served AND fetched to confirm it.
 *  · The published build is EXPERIMENTAL and unsigned, and its own npm
 *    description says the interactive native terminal is opt-in behind
 *    XENO_ALLOW_UNSIGNED_NATIVE=1 (win32-arm64 is pipe-mode only). Say so —
 *    unsigned is the accepted posture, silently surprising people is not. */
const agentCli: ProductContent = {
  slug: 'agent-cli',
  hero: {
    headline: 'A terminal agent that remembers, delegates, and audits.',
    sub: 'XENO Agent CLI reads your repo, edits with diffs you approve, and runs commands — right in your shell. Bring any model (Claude, GPT, Gemini, or fully local), hand work to a built-in planner→executor→reviewer, and keep every action in an audit ledger.',
    media: { type: 'mockup', src: 'agent-cli-terminal', alt: 'XENO Agent CLI in a terminal — reading files, editing with a diff, running tests' },
    badges: ['npm · one command', 'BYO model / local', 'MCP', 'Auditable'],
    note: 'Beta (v0.5.x) · proprietary · install with npm install -g @xenosystem/agent-cli. The build is experimental and unsigned: the interactive native terminal is opt-in behind XENO_ALLOW_UNSIGNED_NATIVE=1, and everything else runs without it. Model calls route through the XENO API or your own key.',
  },
  trust: ['Node ≥ 20 · macOS · Linux · Windows', 'Bring your own key, or run fully local', 'Every action in a JSONL audit ledger'],
  highlights: [
    { value: 'Any model', label: 'Claude · GPT · Gemini · local' },
    { value: 'Plan → Do → Review', label: 'Built-in delegation' },
    { value: '4-level memory', label: 'Carries across sessions' },
    { value: 'Every action', label: 'Logged & auditable' },
  ],
  features: [
    {
      eyebrow: 'Agentic loop', icon: 'Terminal',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'It reads, edits, and runs — with your permission',
      desc: 'A real agent loop: it explores the repo, proposes edits as diffs, and runs commands. Permission modes keep you in control.',
      bullets: ['Read · Write · Edit · Grep · Glob · Bash tools', 'Ask · auto-accept-edits · full-access modes', 'Streaming output — interrupt or send to background', 'Web search & fetch built in'],
    },
    {
      eyebrow: 'Delegation', icon: 'GitBranch',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'A team of agents, not one',
      desc: 'Hand a task to a built-in Planner → Executor → Reviewer; a deterministic reducer merges the results by role precedence.',
      bullets: ['planner / executor / reviewer sub-agents', 'Per-branch token budgets & timeouts', 'xeno run --delegate "…"', 'Deterministic, reproducible merges'],
    },
    {
      eyebrow: 'Memory & identity', icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.18), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'It remembers how you work',
      desc: 'Four-level hierarchical memory (global → project → role → session) with cross-session context, plus a layered identity system.',
      bullets: ['Auto-memory on errors, patterns & preferences', 'Persistent sessions, checkpoints, --resume', 'Open the same session in XENO Agent with --interface', 'Project & role identity files'],
    },
    {
      eyebrow: 'Governance', icon: 'ShieldCheck',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'Auditable by default',
      desc: 'Every tool call, permission decision and delegation is appended to a JSONL ledger — inspect, tail, or export it.',
      bullets: ['.xeno/audit/run-*.jsonl per run', '/audit tail · stats · export', 'Path-traversal & command-injection guards', 'xeno run --json for CI (typed result + exit codes)'],
    },
    {
      eyebrow: 'Your models', icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Bring any model — or none of theirs',
      desc: 'Cloud Claude, GPT, Gemini, Kimi and Composer, or fully local via Ollama and the xeno-rt runtime — one OpenAI-compatible surface.',
      bullets: ['BYO key (XENO_API_KEY) or built-in', 'Local & offline: Ollama + xeno-rt', 'Switch models mid-session (/model)', 'Thinking variants + effort control'],
    },
    {
      eyebrow: 'Extensible', icon: 'Blocks',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.14), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'MCP, skills, hooks & plugins',
      desc: 'Extend it with MCP servers, custom skills, lifecycle hooks and plugins — plus background and remote runs and a JSON-RPC app-server.',
      bullets: ['MCP servers (xeno mcp)', 'Custom agents, skills & hooks', 'Background (--bg) & remote runs', 'app-server --http browser/mobile handoff'],
    },
  ],
  useCases: [
    { title: 'Ship from the terminal', icon: 'Terminal', desc: 'Describe the change; it reads the repo, edits with diffs you approve, and runs the tests — without leaving your shell.' },
    { title: 'Automate & CI', icon: 'Zap', desc: 'xeno run --json "…" returns a typed result with exit codes and a token/audit summary — drop it into scripts and pipelines.' },
    { title: 'Private & offline', icon: 'Lock', desc: 'Point it at Ollama or xeno-rt and run fully local — your code and prompts never leave the machine.' },
  ],
  howItWorks: [
    { step: '1', title: 'Install', desc: 'npm install -g @xenosystem/agent-cli (Node ≥ 20). npm is the install channel.' },
    { step: '2', title: 'Pick a model', desc: 'Use the built-in XENO API, your own key, or a local Ollama / xeno-rt model.' },
    { step: '3', title: 'Work in either surface', desc: 'Stay in the terminal, or run xeno --interface to open the latest session for this workspace in XENO Agent.' },
  ],
  comparison: {
    competitor: 'most AI coding CLIs',
    rows: [
      { feature: 'Terminal agent (read / edit / run)', xeno: true, them: true },
      { feature: 'Built-in planner/executor/reviewer delegation', xeno: true, them: 'Subagents' },
      { feature: 'JSONL audit ledger of every action', xeno: true, them: false },
      { feature: 'Local / offline models', xeno: 'Ollama + xeno-rt', them: false },
      { feature: 'Multi-provider (Claude · GPT · Gemini · Kimi)', xeno: true, them: 'One provider' },
      { feature: 'MCP support', xeno: true, them: true },
      { feature: 'Maturity & ecosystem', xeno: 'Beta', them: true },
    ],
  },
  specs: [
    { label: 'Install', value: 'npm install -g @xenosystem/agent-cli' },
    { label: 'Runtime', value: 'Node ≥ 20' },
    { label: 'Platforms', value: 'macOS · Linux · Windows' },
    { label: 'Version', value: '0.5.x · beta · unsigned' },
  ],
  faq: [
    { q: 'How do I install it?', a: 'npm install -g @xenosystem/agent-cli (Node ≥ 20), then run `xeno`. That is the only install channel — earlier copy here offered a curl / PowerShell one-liner, but those scripts are not served, so the command fetched a web page instead of an installer. It is fixed by removal rather than by a link we cannot back. The package installs three equivalent binaries: xeno, xeno-agent and xeno-code. Note the CLI moved scope: @xeno-corporation/xeno-agent-cli still resolves but is frozen at 0.4.45, so install the @xenosystem one.' },
    { q: 'Which models can it use?', a: 'Cloud Claude, GPT, Gemini, Kimi and Composer via the XENO API or your own key — or run fully local with Ollama or the xeno-rt runtime. Switch models mid-session with /model.' },
    { q: 'Is it safe to let it run commands?', a: 'You stay in control: it asks before writes, edits and shell commands by default. Switch to auto-accept-edits or full-access when you want, and every action is written to an audit ledger.' },
    { q: 'Can I use it in CI / scripts?', a: 'Yes — xeno run --json "…" returns a typed result (status, answer, audit file, token usage, tool summary) with meaningful exit codes.' },
    { q: 'Can I continue a CLI session in the desktop app?', a: 'Yes. Run `xeno --interface` from the workspace to open its most recent durable session in XENO Agent, or combine it with `--resume <session-id>` to open an exact session. The handoff reuses the session instead of copying its transcript into a new conversation.' },
    { q: 'Is it open source?', a: 'Not currently — it’s proprietary, in beta (v0.5.x). It’s the reference CLI for the XENO agent SDK, and it ships on top of @xenosystem/agent-sdk.' },
    { q: 'Is it free?', a: 'The CLI is free to install; model calls route through the XENO API (or your own key / local model). Hosted-usage pricing is announced separately.' },
  ],
  seo: {
    title: 'XENO Agent CLI — the terminal AI coding agent',
    description: 'A terminal coding agent that reads, edits and runs with your permission — multi-agent delegation, hierarchical memory, an audit ledger, and any model (cloud or fully local). npm install and go.',
  },
};

export default agentCli;
