import type { ProductContent } from './_types';

/* XENO Agent CLI — sourced from ../xeno-agent-cli (README/CLAUDE.md + the TUI in
 * apps/xeno-agent-cli/src/ui). A `delivery: cli` product: CTA is the install
 * command + release feed. Honest beta framing (v0.4.x, proprietary). */
const agentCli: ProductContent = {
  slug: 'agent-cli',
  hero: {
    headline: 'A terminal agent that remembers, delegates, and audits.',
    sub: 'XENO Agent CLI reads your repo, edits with diffs you approve, and runs commands — right in your shell. Bring any model (Claude, GPT, Gemini, or fully local), hand work to a built-in planner→executor→reviewer, and keep every action in an audit ledger.',
    media: { type: 'mockup', src: 'agent-cli-terminal', alt: 'XENO Agent CLI in a terminal — reading files, editing with a diff, running tests' },
    badges: ['npm · one command', 'BYO model / local', 'MCP', 'Auditable'],
    note: 'Beta (v0.4.x) · proprietary. Model calls route through the XENO API or your own key.',
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
      bullets: ['Auto-memory on errors, patterns & preferences', 'Persistent sessions, checkpoints, --resume', 'Project & role identity files', 'Token-budgeted context injection'],
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
    { step: '1', title: 'Install', desc: 'npm install -g @xeno-corporation/xeno-agent-cli (or the curl / PowerShell one-liner).' },
    { step: '2', title: 'Pick a model', desc: 'Use the built-in XENO API, your own key, or a local Ollama / xeno-rt model.' },
    { step: '3', title: 'Run xeno', desc: 'Chat, or xeno run "…" to let it plan, edit and execute — every step audited.' },
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
    { label: 'Install', value: 'npm -g / curl' },
    { label: 'Runtime', value: 'Node ≥ 20' },
    { label: 'Platforms', value: 'macOS · Linux · Windows' },
    { label: 'Version', value: '0.4.43 · beta' },
  ],
  faq: [
    { q: 'How do I install it?', a: 'npm install -g @xeno-corporation/xeno-agent-cli, or the curl / PowerShell one-liner. Then run `xeno`.' },
    { q: 'Which models can it use?', a: 'Cloud Claude, GPT, Gemini, Kimi and Composer via the XENO API or your own key — or run fully local with Ollama or the xeno-rt runtime. Switch models mid-session with /model.' },
    { q: 'Is it safe to let it run commands?', a: 'You stay in control: it asks before writes, edits and shell commands by default. Switch to auto-accept-edits or full-access when you want, and every action is written to an audit ledger.' },
    { q: 'Can I use it in CI / scripts?', a: 'Yes — xeno run --json "…" returns a typed result (status, answer, audit file, token usage, tool summary) with meaningful exit codes.' },
    { q: 'Is it open source?', a: 'Not currently — it’s proprietary, in beta (v0.4.x). It’s the reference CLI for the XENO agent SDK.' },
    { q: 'Is it free?', a: 'The CLI is free to install; model calls route through the XENO API (or your own key / local model). Hosted-usage pricing is announced separately.' },
  ],
  seo: {
    title: 'XENO Agent CLI — the terminal AI coding agent',
    description: 'A terminal coding agent that reads, edits and runs with your permission — multi-agent delegation, hierarchical memory, an audit ledger, and any model (cloud or fully local). npm install and go.',
  },
};

export default agentCli;
