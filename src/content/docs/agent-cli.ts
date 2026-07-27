import type { ProductDocs } from './_types';

/* XENO Agent CLI documentation.
 * Authored from ../xeno-agent-cli: README.md, CLAUDE.md, docs/INSTALL.md,
 * docs/GOVERNANCE.md, and apps/xeno-agent-cli/src/commands/*.
 * Accuracy guardrails: model catalog is dynamic (don't hardcode a stale list);
 * the real tool set is wider than "six"; Homebrew/WinGet are not available;
 * hosted CI is currently blocked; the product is proprietary. */

const agentCli: ProductDocs = {
  slug: 'agent-cli',
  productName: 'XENO Agent CLI',
  tagline: 'The terminal AI coding agent — read, edit, and run with your permission, any model, fully auditable.',
  seo: {
    title: 'XENO Agent CLI documentation',
    description:
      'Install, configure, and drive XENO Agent CLI — the terminal coding agent with delegation, hierarchical memory, an audit ledger, MCP, and local models.',
  },
  sections: [
    {
      title: 'Getting started',
      pages: [
        {
          slug: 'introduction',
          title: 'Introduction',
          description: 'What XENO Agent CLI is, and where it fits in the XENO ecosystem.',
          body: `# Introduction

**XENO Agent CLI** is a production terminal AI agent from XENO Corporation. It reads your repository, proposes edits as diffs you approve, and runs commands — all from your shell — with hierarchical memory, built‑in delegation, local‑model support, MCP integration, and a full audit trail of every action.

It is the reference command‑line client for the XENO agent runtime, and installs as the \`xeno\` command (with \`xeno-agent\` and \`xeno-code\` as aliases).

## What it does

- **A real agent loop** — explores the repo, edits with diffs, and runs commands, with permission modes that keep you in control.
- **Delegation** — hand a task to a built‑in *planner → executor → reviewer* and let a deterministic reducer merge the results.
- **Hierarchical memory** — four levels (global, project, role, session) so it remembers how you work across sessions.
- **Auditable by default** — every tool call, permission decision, and delegation is appended to a JSONL ledger.
- **Any model** — cloud models through the XENO API or your own key, or fully local via Ollama and the xeno‑rt runtime.
- **Extensible** — MCP servers, skills, hooks, and plugins, plus background and remote runs and a JSON‑RPC app‑server.

## Where it fits

The CLI is **Layer 3 (Agent & Automation)** of the XENO ecosystem. It consumes the published \`@xenosystem/agent-sdk\` and routes model calls through the XENO API (\`api.xenostudio.ai\`) or a local runtime. It hands off to XENO Hub and editor bridges through its app‑server.

## Next steps

- [Install XENO Agent CLI](/docs/agent-cli/installation)
- [Quickstart](/docs/agent-cli/quickstart) — your first chat and your first \`run\`
- [Authentication & API keys](/docs/agent-cli/authentication)

> XENO Agent CLI is proprietary software, © 2026 XENO Corporation. It is currently in beta (v0.4.x).`,
        },
        {
          slug: 'installation',
          title: 'Installation',
          description: 'Install XENO Agent CLI with npm, the install scripts, or from source.',
          body: `# Installation

XENO Agent CLI requires **Node.js 20 or newer**. npm is the only distribution channel.

## npm

\`\`\`bash
npm install -g @xenosystem/agent-cli
\`\`\`

This installs three equivalent binaries: \`xeno\` (primary), \`xeno-agent\`, and \`xeno-code\` (legacy alias).

Verify the install:

\`\`\`bash
xeno --version
\`\`\`

> **Scope change.** The CLI publishes as \`@xenosystem/agent-cli\` (currently 0.5.x). The older \`@xeno-corporation/xeno-agent-cli\` still resolves but is frozen at 0.4.45, so installing it gets you a materially older build. If you installed the old specifier, \`npm uninstall -g @xeno-corporation/xeno-agent-cli\` first — both packages provide the same \`xeno\` binary.

> **Experimental, unsigned build.** The interactive native terminal is opt-in behind \`XENO_ALLOW_UNSIGNED_NATIVE=1\`; the CLI otherwise runs without it, and \`win32-arm64\` is pipe-mode only.

## Install scripts

There are none, and an earlier version of this page said otherwise.

It documented \`curl -fsSL https://xenostudio.ai/install.sh | sh\` and \`irm https://xenostudio.ai/install.ps1 | iex\`. Neither file is served: both paths fall through to the single-page app and return \`index.html\` with \`content-type: text/html\` — so the command piped a web page into your shell. Use npm above. When a real script channel ships, it will be documented here with a checksum.

The same applies to the standalone native channel, which was documented as \`XENO_INSTALL_CHANNEL=native\` on top of that same non-existent script.

## From source

\`\`\`bash
git clone https://github.com/XENO-CORPORATION/xeno-agent-cli
cd xeno-agent-cli
npm install
npm run build
npm link -w apps/xeno-agent-cli
\`\`\`

## Updating

For npm/global installs, update in place:

\`\`\`bash
xeno update
\`\`\`

\`xeno update\` reports the resolved install command, how to roll back, the active release channel, and the native checksum URL.

> **Not yet available:** Homebrew and WinGet packages are planned but not shipping today — use npm or the install scripts.

Next: [Quickstart →](/docs/agent-cli/quickstart)`,
        },
        {
          slug: 'quickstart',
          title: 'Quickstart',
          description: 'Start an interactive chat and run a one-shot task from the terminal.',
          body: `# Quickstart

Once [installed](/docs/agent-cli/installation) and [authenticated](/docs/agent-cli/authentication), you can start working immediately.

## Interactive chat

\`chat\` is the default command — running \`xeno\` with no arguments opens an interactive session in the current directory:

\`\`\`bash
xeno
# or explicitly
xeno chat
\`\`\`

Type a request and the agent explores the repo, proposes edits as diffs, and asks before writing files or running commands. Use slash commands like \`/model\`, \`/memory\`, and \`/audit\` inside the session — see the [slash command reference](/docs/agent-cli/slash-commands).

## One‑shot runs

\`run\` executes a single task and exits — ideal for scripts and automation:

\`\`\`bash
xeno run "fix the failing auth test and add a token-bucket rate limiter"
\`\`\`

Add \`--json\` for a machine‑readable result with a typed status, the audit file path, token usage, and a tool summary:

\`\`\`bash
xeno run --json "summarize the changes in the last commit"
\`\`\`

See the [\`run\` contract](/docs/agent-cli/cli-reference) for the full JSON schema and exit codes.

## Useful flags

\`\`\`bash
xeno chat --model claude-sonnet-4-6      # pick a model
xeno chat --permission-mode acceptEdits  # auto-accept edits, still ask for commands
xeno run --bg "run the full test suite"  # background run
xeno run --delegate "refactor the payments module"  # planner→executor→reviewer
\`\`\`

## Next steps

- [The agent loop & tools](/docs/agent-cli/agent-loop) — how it reads, edits, and runs
- [Permission modes](/docs/agent-cli/permissions) — control what runs automatically
- [Models](/docs/agent-cli/models) — cloud and local`,
        },
        {
          slug: 'authentication',
          title: 'Authentication & API keys',
          description: 'Sign in, or bring your own API key, and point the CLI at a base URL.',
          body: `# Authentication & API keys

XENO Agent CLI routes model calls through the **XENO API** (\`api.xenostudio.ai\`) by default. You can sign in interactively or supply an API key directly.

## Sign in

\`\`\`bash
xeno login     # interactive sign-in
xeno auth      # inspect the current auth state
xeno logout    # clear stored credentials
\`\`\`

## Bring your own key

Set your key in the environment (recommended) or pass it per‑invocation:

\`\`\`bash
export XENO_API_KEY="xeno_..."
xeno chat

# or per run
xeno chat --api-key "xeno_..."
\`\`\`

Create and rotate keys from your account at [xenostudio.ai](https://xenostudio.ai/account/api-keys).

## Pointing at a different endpoint

\`\`\`bash
export XENO_BASE_URL="https://api.xenostudio.ai/v1"
# or per run
xeno chat --base-url "https://api.xenostudio.ai/v1"
\`\`\`

The XENO API and local runtimes are OpenAI‑compatible, so \`--base-url\` also lets you target a self‑hosted gateway or the local xeno‑rt / Ollama endpoints (see [Local & offline models](/docs/agent-cli/local-models)).

## Precedence

Configuration resolves in this order (highest wins): **CLI flags → environment variables → config file → built‑in defaults**. See [Configuration](/docs/agent-cli/configuration) for the full picture.`,
        },
      ],
    },
    {
      title: 'Core concepts',
      pages: [
        {
          slug: 'agent-loop',
          title: 'The agent loop & tools',
          description: 'How the agent reads, edits, and runs — and the tools it has.',
          body: `# The agent loop & tools

XENO Agent CLI runs a real agent loop: it reads context, calls tools, observes results, and iterates until the task is done or it needs your approval.

## Built‑in tools

| Tool | Default | Purpose |
|------|---------|---------|
| \`Read\` | Allow | Read a file |
| \`Write\` | Ask | Create/overwrite a file |
| \`Edit\` | Ask | Modify a file (diff) |
| \`Glob\` | Allow | Find files by pattern |
| \`Grep\` | Allow | Search file contents |
| \`Bash\` | Ask | Run a shell command |
| \`WebSearch\` | Allow | Search the web |
| \`WebFetch\` | Allow | Fetch a URL |
| \`ReadImage\` | Allow | Read an image file |

Tools that modify your machine (\`Write\`, \`Edit\`, \`Bash\`) ask for approval by default; read‑only tools run automatically. Any tools contributed by connected [MCP servers](/docs/agent-cli/mcp) are available to the agent too.

## Modes

The \`--mode\` flag controls the loop's behaviour:

- \`agent\` (default) — full tool‑using loop.
- \`chat\` — conversational only, no tools.

Bound the loop with \`--max-iterations\` (default 50) and \`--max-tokens\` (default 8192).

## Streaming & interruption

Output streams as the agent works. You can interrupt a turn, or send a long‑running task to the background with \`--bg\` (see [Background & remote runs](/docs/agent-cli/background-remote)).

Related: [Permission modes & approvals](/docs/agent-cli/permissions) · [Audit ledger](/docs/agent-cli/audit).`,
        },
        {
          slug: 'permissions',
          title: 'Permission modes & approvals',
          description: 'Control what the agent can do without asking.',
          body: `# Permission modes & approvals

You stay in control of what runs. Every tool that can change your machine is gated by the permission engine.

## Modes

Set with \`--permission-mode\`:

- \`default\` — ask before writes, edits, and shell commands.
- \`acceptEdits\` — auto‑accept file writes and edits; still ask before shell commands.
- \`bypassPermissions\` — run everything without prompting. Use only in trusted, sandboxed environments.

\`\`\`bash
xeno chat --permission-mode acceptEdits
\`\`\`

## Remembering approvals

Approvals you grant during a session can be remembered so you are not asked again for the same action. Inspect and manage what is approved:

\`\`\`bash
xeno approved-tools        # list remembered approvals
# inside a session:
/approvals
/permissions
\`\`\`

## Safety

The permission engine is backed by real guards: path‑traversal protection, command‑injection blocking, environment sanitization, and ReDoS‑safe pattern validation. In non‑interactive contexts (no TTY) the agent auto‑denies prompts by default rather than assuming yes — override deliberately with \`XENO_FORCE_AUTO_DENY_PROMPTS\` / \`--permission-mode\` where appropriate.

Every decision is recorded — see the [Audit ledger](/docs/agent-cli/audit).`,
        },
        {
          slug: 'delegation',
          title: 'Delegation',
          description: 'Split larger tasks across a built-in planner, executor, and reviewer.',
          body: `# Delegation

For larger tasks, XENO Agent CLI can split the work across a built-in team of sub-agents instead of running everything in one pass.

## Planner → Executor → Reviewer

- **Planner** breaks the task into steps.
- **Executor** carries out each step with the full tool set.
- **Reviewer** checks the result.
- A deterministic **reducer** merges everything back together by role precedence, so the same inputs produce the same merge.

## Running a delegated task

\`\`\`bash
xeno run --delegate "refactor the payments module and add tests"
\`\`\`

Tune the delegation with these flags:

| Flag | Purpose |
|------|---------|
| \`--delegate-max-total-tokens\` | Cap total tokens across all branches |
| \`--delegate-timeout-ms\` | Per-branch timeout |
| \`--delegate-role-precedence\` | Order the reducer uses to merge results |

Inside an interactive session, use \`/delegate\` to hand off the current task.

Delegated runs are recorded in the [audit ledger](/docs/agent-cli/audit) with parent/child attribution, and \`--json\` output includes a \`delegation\` summary — see the [CLI reference](/docs/agent-cli/cli-reference).`,
        },
        {
          slug: 'memory-identity',
          title: 'Memory & identity',
          description: 'How the agent remembers across sessions and adapts through identity files.',
          body: `# Memory & identity

XENO Agent CLI remembers how you work across sessions through a layered memory system, and adapts its behaviour through a layered identity system.

## Memory (4 levels)

| Level | Location |
|-------|----------|
| Global | \`~/.xeno-agent/memory/\` |
| Project | \`./.xeno/memory/\` |
| Role | per-role store |
| Session | current run |

Memory is written automatically when meaningful things happen — the auto-memory triggers are \`error_correction\`, \`pattern_learned\`, \`preference_stated\`, and \`task_completed\` — and you can add to it explicitly:

\`\`\`text
/remember always run the linter before committing
/memory            # inspect what is remembered
/memory context    # show what will be injected into the next turn
\`\`\`

Control how much prior context is injected with \`--memory-context-sessions\`, \`--memory-context-tokens\`, and \`--memory-context-chars\`.

## Identity (4 layers)

Identity files are markdown with YAML frontmatter, resolved highest-to-lowest:

| Layer | Location |
|-------|----------|
| Global | \`~/.xeno-agent/xeno-main.md\` |
| Project | \`./.xenocode\` or \`./xeno-main.md\` |
| Role | \`./roles/<name>/identity.md\` |
| Session | runtime |

Select a role for a run with \`--role\`:

\`\`\`bash
xeno chat --role reviewer
\`\`\``,
        },
        {
          slug: 'sessions',
          title: 'Sessions & checkpoints',
          description: 'Durable, resumable sessions with checkpoints and rewind.',
          body: `# Sessions & checkpoints

Every conversation is a durable session you can leave and come back to.

## Where sessions live

Sessions are stored under \`~/.xeno-agent/sessions/<id>/\` with a JSONL transcript, a checkpoint history, and a PID lock so two processes never write the same session. The agent auto-checkpoints every 10 messages.

## Resuming and checkpointing

\`\`\`bash
xeno sessions              # list sessions
xeno chat --resume         # resume the most recent session
xeno chat --checkpoint     # start from a checkpoint
\`\`\`

Inside a session:

\`\`\`text
/sessions      # list and switch
/save          # save the current session
/resume        # resume a session
/checkpoint    # create a checkpoint
/rewind        # restore an earlier point (the abandoned branch is saved first)
/export        # export the transcript
\`\`\``,
        },
        {
          slug: 'audit',
          title: 'Audit ledger',
          description: 'Every action is appended to a JSONL ledger you can inspect, replay, or export.',
          body: `# Audit ledger

Every action the agent takes is written to an append-only JSONL ledger, so any run can be inspected, replayed, or exported.

## The ledger

Each run appends to \`./.xeno/audit/run-*.jsonl\` — one line per tool call, permission decision, and delegation, each tagged with attribution: run, session, agent, parent, workspace, model, and provider.

## Inspecting it

\`\`\`text
/audit tail 50          # last 50 entries
/audit stats            # summary
/audit trace <trace-id> # a single trace (add --replay to re-run)
/audit export ./out.jsonl
\`\`\`

For automation, \`xeno run --json\` returns the \`audit_file\` path alongside the result (see the [CLI reference](/docs/agent-cli/cli-reference)). Governance controls — managed config, budgets, and attribution — are covered under [Configuration](/docs/agent-cli/configuration).`,
        },
      ],
    },
    {
      title: 'Models',
      pages: [
        {
          slug: 'models',
          title: 'Models & the model picker',
          description: 'Choose a model, set defaults and fallbacks, and use the live catalog.',
          body: `# Models & the model picker

XENO Agent CLI is model-agnostic. It ships with a live model catalog fetched from the XENO API, so the available models and the default stay current without upgrading the CLI.

## Choosing a model

\`\`\`bash
xeno chat --model <model-id>     # per run
xeno models                      # list available models
xeno models --json               # machine-readable
\`\`\`

Inside a session:

\`\`\`text
/model      # open the model picker
/effort     # set reasoning effort (where supported)
/fast       # toggle fast mode
\`\`\`

## Defaults and fallbacks

Set your preferred model and fallbacks via environment variables:

\`\`\`bash
export XENO_MODEL="<model-id>"
export XENO_FALLBACK_MODELS="<id-1>,<id-2>"
export XENO_EFFORT="high"
\`\`\`

> The catalog is dynamic — run \`xeno models\` to see exactly what is available to your account rather than relying on a static list.

For private, offline work, see [Local & offline models](/docs/agent-cli/local-models).`,
        },
        {
          slug: 'local-models',
          title: 'Local & offline models',
          description: 'Run fully local with Ollama or the xeno-rt runtime — nothing leaves your machine.',
          body: `# Local & offline models

Run entirely on your own hardware — your code and prompts never leave the machine — using Ollama or the xeno-rt runtime. Both expose an OpenAI-compatible endpoint.

## Ollama

Prefix a model with \`ollama:\` and the CLI preflights the local server (reachable, model installed, chat endpoint working) before the run:

\`\`\`bash
export OLLAMA_BASE_URL="http://localhost:11434"   # default
xeno chat --model "ollama:llama3.1"
\`\`\`

## xeno-rt

The xeno-rt runtime serves GGUF and task models locally:

\`\`\`bash
export XENO_RT_DEFAULT_URL="http://localhost:8080/v1"
xeno chat --base-url "$XENO_RT_DEFAULT_URL" --model "<local-model>"
\`\`\`

Because both runtimes are OpenAI-compatible, the same \`--base-url\` mechanism from [Authentication](/docs/agent-cli/authentication) points the CLI at them.`,
        },
      ],
    },
    {
      title: 'Reference',
      pages: [
        {
          slug: 'cli-reference',
          title: 'CLI command reference',
          description: 'The common commands, xeno chat options, and the run --json contract.',
          body: `# CLI command reference

Run \`xeno --help\` for the full, version-accurate list. The most common commands:

| Command | Purpose |
|---------|---------|
| \`xeno chat\` | Interactive session (default) |
| \`xeno run <prompt>\` | One-shot task |
| \`xeno login\` / \`logout\` / \`auth\` | Authentication |
| \`xeno update\` | Update the CLI |
| \`xeno models\` | List models |
| \`xeno mcp\` | Manage MCP servers |
| \`xeno hooks\` / \`skills\` / \`plugin\` | Extensibility |
| \`xeno agents\` | Manage background/remote runs |
| \`xeno remote\` | Remote execution |
| \`xeno app-server\` | JSON-RPC / HTTP bridge |
| \`xeno sessions\` | Session management |
| \`xeno doctor\` / \`bug-report\` | Diagnostics |
| \`xeno config\` | Edit configuration |
| \`xeno usage\` / \`cost\` | Usage and cost |
| \`xeno completions <shell>\` | Shell completions |

## \`xeno chat\` options

| Option | Default | Meaning |
|--------|---------|---------|
| \`-m, --model\` | catalog default | Model id |
| \`-k, --api-key\` | \`$XENO_API_KEY\` | API key |
| \`--base-url\` | XENO API | OpenAI-compatible endpoint |
| \`--max-tokens\` | 8192 | Max output tokens |
| \`--max-iterations\` | 50 | Loop cap |
| \`--mode\` | agent | \`agent\` or \`chat\` |
| \`--permission-mode\` | default | \`default\` / \`acceptEdits\` / \`bypassPermissions\` |
| \`--delegate\` | off | Delegate to planner/executor/reviewer |
| \`--resume\` / \`--checkpoint\` / \`--role\` | — | Session controls |

## \`xeno run --json\` contract

\`xeno run --json "…"\` prints a single JSON object:

\`\`\`json
{
  "status": "ok",
  "answer": "…",
  "trace_id": "…",
  "audit_file": ".xeno/audit/run-….jsonl",
  "token_usage": { "input": 0, "output": 0 },
  "tool_summary": { "Read": 3, "Edit": 1, "Bash": 1 },
  "delegation": null
}
\`\`\`

\`status\` is one of \`ok\`, \`permission_denied\`, \`error\`, or \`interrupted\`. Exit codes: \`0\` success, \`1\` error, \`2\` permission denied, \`130\` interrupted.`,
        },
        {
          slug: 'slash-commands',
          title: 'Slash command reference',
          description: 'Commands you can type inside an interactive xeno chat session.',
          body: `# Slash command reference

Slash commands work inside an interactive \`xeno chat\` session. Type \`/help\` for the live list.

## Session & context
\`/help\` · \`/clear\` · \`/tokens\` · \`/cost\` · \`/compact\` · \`/ctx-viz\` · \`/export\` · \`/copy\`

## Model & mode
\`/model\` · \`/effort\` · \`/fast\` · \`/mode\` · \`/provider\` · \`/color\` (alias \`/theme\`) · \`/vim\`

## Memory
\`/memory\` · \`/memory context\` · \`/remember\`

## Sessions
\`/sessions\` · \`/save\` · \`/resume\` · \`/open\` · \`/checkpoint\` · \`/rewind\`

## Tools & governance
\`/audit\` · \`/approvals\` · \`/approved-tools\` · \`/permissions\`

## Extensibility
\`/mcp\` · \`/skills\` · \`/plugins\` · \`/agents\` · \`/delegate\` · \`/goal\` · \`/workflow\`

## Utilities
\`/doctor\` · \`/bug-report\` · \`/config\` · \`/init\` · \`/review\` · \`/release-notes\` · \`/terminal-setup\` · \`/login\` · \`/logout\`

Many take sub-arguments, e.g. \`/audit tail 50\`, \`/mcp add\`, \`/memory context --tokens 4000\`.`,
        },
        {
          slug: 'configuration',
          title: 'Configuration',
          description: 'Config files, precedence, and managed configuration.',
          body: `# Configuration

## Precedence

Settings resolve highest-to-lowest: **CLI flags → environment variables → config file → built-in defaults**.

## Config files

| Scope | File |
|-------|------|
| Global | \`~/.xeno-agent/config.json\` |
| Project | \`./.xenocode\` or \`./.xenocode.json\` |

Edit configuration with:

\`\`\`bash
xeno config          # open the config editor
\`\`\`

…or \`/config\` inside a session. A global \`config.json\` sets defaults like the model, permission mode, and memory-context limits; project config overrides global for that repo.

## Managed configuration

Organizations can enforce settings with a managed config that loads *above* user and project config and is never written back — point at it with \`XENO_MANAGED_CONFIG_PATH\`. See [Environment variables](/docs/agent-cli/environment-variables).`,
        },
        {
          slug: 'environment-variables',
          title: 'Environment variables',
          description: 'The user-facing environment variables you are most likely to set.',
          body: `# Environment variables

The most useful user-facing variables. The CLI reads many more for internal tuning — these are the ones you are likely to set.

## Auth & endpoint
| Variable | Purpose |
|----------|---------|
| \`XENO_API_KEY\` | Your API key |
| \`XENO_BASE_URL\` | OpenAI-compatible endpoint |
| \`XENO_AUTH_BASE\` | Auth service base URL |

## Models
| Variable | Purpose |
|----------|---------|
| \`XENO_MODEL\` | Default model id |
| \`XENO_FALLBACK_MODELS\` | Comma-separated fallbacks |
| \`XENO_EFFORT\` | Reasoning effort |
| \`OLLAMA_BASE_URL\` | Ollama endpoint (default \`http://localhost:11434\`) |
| \`XENO_RT_DEFAULT_URL\` | xeno-rt endpoint |

## Behaviour & governance
| Variable | Purpose |
|----------|---------|
| \`XENO_FORCE_AUTO_DENY_PROMPTS\` | Auto-deny prompts (non-TTY safety) |
| \`XENO_MANAGED_CONFIG_PATH\` | Enforced managed config |
| \`XENO_BUDGET_MAX_USD\` | Per-run spend guardrail |
| \`XENO_STATUS_LINE_COMMAND\` | Custom status line command |
| \`XENO_PLUGIN_DIR\` | Extra plugin directory |
| \`XENO_INSTALL_CHANNEL\` | \`native\` for standalone installs |

Network proxies use the standard \`HTTPS_PROXY\` / \`HTTP_PROXY\` / \`NO_PROXY\` / \`NODE_EXTRA_CA_CERTS\` variables.`,
        },
      ],
    },
    {
      title: 'Extending & integrating',
      pages: [
        {
          slug: 'mcp',
          title: 'MCP servers',
          description: 'Connect Model Context Protocol servers to give the agent new tools.',
          body: `# MCP servers

XENO Agent CLI is a Model Context Protocol (MCP) client — connect MCP servers to give the agent new tools, prompts, and resources.

## Managing servers

\`\`\`bash
xeno mcp list       # connected servers
xeno mcp add        # add a server
xeno mcp remove     # remove a server
xeno mcp reload     # reconnect and re-sync tools
\`\`\`

Inside a session, \`/mcp\` exposes the same actions plus \`prompts\`, \`resources\`, \`approve\` / \`deny\`, and \`reset-mcprc-choices\`.

## Configuration

MCP servers are declared in \`.xeno/mcp.json\` (project), \`./.mcprc\`, or \`~/.xeno-agent/mcp.json\` (global). Tools contributed by a connected server appear to the agent alongside the [built-in tools](/docs/agent-cli/agent-loop) and are subject to the same [permission engine](/docs/agent-cli/permissions).`,
        },
        {
          slug: 'skills-hooks-plugins',
          title: 'Skills, hooks & plugins',
          description: 'Three complementary ways to extend the agent.',
          body: `# Skills, hooks & plugins

Three complementary ways to extend the agent.

## Skills

Skills are markdown capability files enabled per workspace. Create and manage them:

\`\`\`bash
xeno skills create <name>
xeno skills                       # list
\`\`\`

Inside a session: \`/skills list | inspect | enable | disable\`.

## Hooks

Hooks run your commands (or HTTP calls) at lifecycle events: \`SessionStart\`, \`UserPromptSubmit\`, \`PermissionRequest\`, \`PreToolUse\`, \`PostToolUse\`, \`PreCompact\`, \`PostCompact\`, \`Stop\`, \`StopFailure\`, \`SubagentStart\`, \`SubagentStop\`. Each hook has a trust state (trusted / review-required / disabled / managed):

\`\`\`bash
xeno hooks            # list and inspect (with hashes)
\`\`\`

## Plugins

Plugins bundle tools, skills, and hooks:

\`\`\`bash
xeno plugin           # manage plugins
export XENO_PLUGIN_DIR="/path/to/plugins"
\`\`\``,
        },
        {
          slug: 'app-server',
          title: 'App server, IDE & GitHub',
          description: 'Drive the agent over HTTP + JSON-RPC from editors, the browser, and Hub.',
          body: `# App server, IDE & GitHub

The app-server exposes the agent over HTTP + JSON-RPC so other clients — editors, the browser, XENO Hub — can drive it.

## Running it

\`\`\`bash
xeno app-server --http --json
\`\`\`

It is token-protected (Bearer auth is required) and serves:

- \`POST /rpc\` — JSON-RPC 2.0
- \`GET /manifest\`, \`GET /openapi.json\`, \`GET /health\`
- \`GET /app\` — a browser client shell

### JSON-RPC methods

\`exec.start\`, \`exec.output\`, \`exec.write\`, \`exec.terminate\`, \`exec.list\`, \`thread.run\`, and \`server.stop\`.

## IDE & GitHub

The manifest advertises editor bridges (XENO Hub and a VS Code extension), and the CLI includes GitHub helpers:

\`\`\`bash
xeno review           # review changes
xeno pr-comments      # work with PR comments
\`\`\`

> The Hub, VS Code extension, and ACP integrations live in separate XENO repositories — this page covers the CLI side that drives them.`,
        },
      ],
    },
    {
      title: 'Automation & help',
      pages: [
        {
          slug: 'background-remote',
          title: 'Background & remote runs',
          description: 'Run long tasks in the background, on worktrees, or on remote runners.',
          body: `# Background & remote runs

Long tasks do not have to block your terminal.

## Background runs

\`\`\`bash
xeno run --bg "run the full test suite and fix failures"
xeno run --bg --worktree "…"   # isolate in a git worktree
\`\`\`

Background agents appear as footer sessions in an interactive chat — open one to watch its transcript, attach, give follow-ups, then detach.

## Managing running agents

\`\`\`bash
xeno agents              # list
xeno agents --watch      # live view
xeno attach <id>         # attach to a run
xeno logs <id>
xeno pause | resume | respawn | stop | rm <id>
\`\`\`

## Remote execution

\`\`\`bash
xeno remote serve        # run a remote endpoint
xeno remote validate     # check connectivity
xeno run --remote "…"    # execute on a remote runner
xeno remote get | events | attach --follow | stop
\`\`\``,
        },
        {
          slug: 'ci-scripting',
          title: 'CI & scripting',
          description: 'Run headless with --json, exit codes, budgets, and CI scaffolding.',
          body: `# CI & scripting

XENO Agent CLI is built to run headless.

## Scripting with \`--json\`

\`\`\`bash
result=$(xeno run --json "generate release notes for the last tag")
echo "$result" | jq -r '.answer'
\`\`\`

The typed result (status, \`answer\`, \`audit_file\`, \`token_usage\`, \`tool_summary\`) plus meaningful exit codes (\`0\` / \`1\` / \`2\` / \`130\`) make it safe to gate a pipeline on. See the [run contract](/docs/agent-cli/cli-reference).

## Guardrails

Bound cost and behaviour in automation:

\`\`\`bash
export XENO_BUDGET_MAX_USD="1.00"
xeno run --json --permission-mode acceptEdits "…"
\`\`\`

## Scaffolding CI

\`\`\`bash
xeno ci init      # scaffold workflow files
\`\`\`

> Local gates are the authoritative check today. Hosted GitHub Actions integration is scaffolded but temporarily blocked upstream — treat \`xeno ci init\` as a starting point and rely on local runs in the meantime.`,
        },
        {
          slug: 'troubleshooting',
          title: 'Troubleshooting & FAQ',
          description: 'Diagnostics and answers to common questions.',
          body: `# Troubleshooting & FAQ

## Diagnostics

\`\`\`bash
xeno doctor        # environment and config checks
xeno bug-report    # collect a shareable report
\`\`\`

In a session, \`/doctor\` and \`/bug-report\` do the same, and \`/ctx-viz\` visualizes what is in context (use \`/compact\` to shrink it).

## Common questions

**The agent won't run a command.** Check your [permission mode](/docs/agent-cli/permissions) — writes and shell commands ask by default, and in non-interactive contexts prompts auto-deny unless you opt in.

**It picked the wrong model.** The catalog is dynamic; run \`xeno models\` and set \`--model\` or \`XENO_MODEL\`. See [Models](/docs/agent-cli/models).

**I want it fully offline.** Point it at Ollama or xeno-rt — see [Local & offline models](/docs/agent-cli/local-models).

**Where's the record of what it did?** Every run writes an [audit ledger](/docs/agent-cli/audit); \`xeno run --json\` returns the file path.`,
        },
        {
          slug: 'release-notes',
          title: 'Release notes',
          description: 'Where to find the changelog and how to update.',
          body: `# Release notes

XENO Agent CLI follows semantic versioning and ships frequent updates.

- See the full changelog on the [XENO Agent CLI releases page](/product/agent-cli/releases).
- View what changed in your installed version any time:

\`\`\`bash
xeno release-notes
\`\`\`

Update to the latest with \`xeno update\` (see [Installation](/docs/agent-cli/installation)).`,
        },
      ],
    },
  ],
};

export default agentCli;
