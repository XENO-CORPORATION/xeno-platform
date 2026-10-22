import type { ProductDocs } from './_types';

/* XENO Spawn documentation — reconciled against 0.1.0-rc.45 (fusion e0a6a01, published
 * 2026-10-22). Claims trace to server/src/cli.js (pair, --workspace), server/src/hostedPairing.js
 * (scope, code lifetime, session caps), hosted/pair.js (the page) and
 * docs/specs/2026-10-22-hosted-workspace.md. Windows x64 only; beta, unsigned, no in-app updater.
 * Cloud execution is not available; the page says so rather than hiding the choice. */
const spawn: ProductDocs = {
  slug: 'spawn',
  productName: 'XENO Spawn',
  tagline: 'Every coding agent in one place — and the workspace in your browser, running on your own computer.',
  version: '0.1.0-rc.45',
  updated: '2026-10-22',
  seo: {
    title: 'XENO Spawn documentation',
    description:
      'Install XENO Spawn on Windows, run Claude Code, Codex, agy, opencode and XENO agents on one canvas, and open that workspace in your browser with spawn pair --workspace.',
  },
  sections: [
    {
      title: 'Getting started',
      pages: [
        {
          slug: 'introduction',
          title: 'Introduction',
          description: 'What XENO Spawn is today, and what it deliberately does not do yet.',
          body: "## Introduction\n\nXENO Spawn runs your coding agents — Claude Code, Codex, agy, opencode and XENO agents — side by side on a canvas. Each agent keeps its own terminal, its own session and its own profile, and saved sessions reopen where they were.\n\nSince **0.1.0-rc.45** the same workspace also opens in the browser at [spawn.xenosystem.ai](https://spawn.xenosystem.ai), connected to Spawn running on your computer.\n\n## What it is today\n\n- **Windows 10/11, x64.** There is no macOS or Linux build.\n- **Beta channel, unsigned.** Windows may warn before the installer runs. There is no in-app updater; a newer version is installed by running the install command again.\n- **A XENO account is required.** Spawn signs in through your browser and the platform confirms the account may use it.\n- **Your computer does the work.** Agents, folders and terminals run locally. Cloud execution is not available.\n\n## What it does not do yet\n\n- No cloud runtime, so the browser workspace needs an engine on your machine.\n- No macOS or Linux build.\n- Managed sandboxed execution (XENO Box) is not qualified on Windows; terminals run as your own user.\n\n## Next steps\n\n- [Installation](/docs/spawn/installation)\n- [The workspace in your browser](/docs/spawn/hosted-workspace)\n- [Agents and sessions](/docs/spawn/agents-and-sessions)",
        },
        {
          slug: 'installation',
          title: 'Installation',
          description: 'Install or update XENO Spawn on Windows, and where its files live.',
          body: "## Installation\n\nXENO Spawn 0.1.0-rc.45 is available for **Windows 10/11 (x64)**.\n\n1. In PowerShell, run:\n\n   ```powershell\n   irm https://xenosystem.ai/install/spawn.ps1 | iex\n   ```\n\n   The script reads the release feed, downloads the newest Windows build, refuses it unless its SHA-256 matches the published value, and runs that build's own installer.\n2. Or download the release zip from [the product page](/product/spawn), extract it and double-click **Install XENO Spawn.cmd**.\n3. The installer needs nothing on your PC first — Node, npm and build tools are bundled. It installs to `%LOCALAPPDATA%\\XENO\\Spawn`, puts `spawn` on your PATH, adds a Start Menu entry and registers `xeno-spawn://` links.\n\n## Updating\n\nRun the install command again. The new version is installed beside the old one and selected only after it is qualified. There is no in-app updater.\n\n## Where your data lives\n\n| What | Where |\n|---|---|\n| The program | `%LOCALAPPDATA%\\XENO\\Spawn\\releases\\<version>` |\n| The selected version | `%LOCALAPPDATA%\\XENO\\Spawn\\active.json` |\n| Your sign-in | Windows secure storage (DPAPI) |\n| Canvases and settings | inside each project's `.xeno\\spawn\\` folder |\n\n## Signing in\n\nStart Spawn and choose **Sign in to XENO**. Your browser opens; Spawn never sees your password. The sign-in is kept in Windows' secure storage, so the next launch goes straight to the workspace.",
        },
      ],
    },
    {
      title: 'The workspace',
      pages: [
        {
          slug: 'hosted-workspace',
          title: 'The workspace in your browser',
          description: 'Open the normal Spawn workspace at spawn.xenosystem.ai, running on your own computer.',
          body: "## The workspace in your browser\n\n[spawn.xenosystem.ai](https://spawn.xenosystem.ai) opens the normal Spawn workspace — canvas, file tree, transcripts, terminals and agent controls — in a browser tab. The engine stays on your computer.\n\nAt the door the page offers **Local** or **Cloud**. Cloud execution is currently unavailable and the page says so; choosing Local is the supported path.\n\n## Pairing the page with your engine\n\n1. Install Spawn and start it on this computer.\n2. In a terminal, run:\n\n   ```\n   spawn pair --workspace\n   ```\n\n   It prints the local address and a single-use code, and restates what the page will be able to do.\n3. On the page, enter the address and the code, tick the authorization box and choose **Pair**.\n4. Allow local network access if your browser asks. Sign in to XENO when the workspace opens.\n\n## What the two kinds of pairing grant\n\n| Command | The paired page can |\n|---|---|\n| `spawn pair` | read the project list only — names and folder paths |\n| `spawn pair --workspace` | the workspace controls you already have locally: files and transcripts, canvases, folders, terminals and agents |\n\nWorkspace pairing is an explicit grant, not a password. It does not bypass sign-in, the account gate or the product's licence check, and it does not enable any permission mode.\n\n## Lifetime and revocation\n\n- The code is single use and expires after **5 minutes**.\n- A session lasts at most **8 hours** and at most **5 pages**.\n- `spawn pair list` shows the sessions; `spawn pair revoke <session-id>` ends one immediately.\n- When a pairing expires or is revoked, the open workspace page closes. The terminals and agents on your computer keep running.\n\n## What the page holds\n\nThe pairing credential stays in the page's memory: it is sent in the first message on the socket and never written to a URL or to browser storage. Shared project links return through the connection screen and reopen the project after pairing.\n\n## Older engines\n\nIf `spawn pair` says `--workspace` is not recognized, the installed engine predates rc.45. Update Spawn, then pair again.",
        },
        {
          slug: 'agents-and-sessions',
          title: 'Agents and sessions',
          description: 'Start agents, keep their sessions, and bring existing work onto a canvas.',
          body: "## Agents\n\nSpawn starts Claude Code, Codex, agy, opencode and XENO agents in real terminals on a canvas. Each terminal keeps its own session, and a canvas can hold as many as you need.\n\n## Starting an agent you made on the platform\n\nOpen the agent in your workspace, choose Claude Code or Codex, and copy the line:\n\n```\nspawn claude --agent agt_…\nspawn codex --agent agt_…\n```\n\nThe run signs in as that agent and gets a short-lived credential for that launch. Your own `~/.claude` and `~/.codex` settings are not read or changed.\n\n## Sessions\n\n- A saved session reopens where it was, with its previous output above a divider.\n- **Sessions** (Ctrl+Shift+K) searches every Claude Code, Codex, agy, opencode and XENO agent session on the machine.\n- A session found there can be opened in its own agent, or added to the canvas as a session node.\n- Bringing a session to a different agent shows the conversion plan first; the original is never written.\n\n## Profiles\n\nA profile keeps one agent's configuration apart from another's. Profiles are managed by Spawn; the page and the terminal use the same registry.\n\n## Existing work\n\n`spawn import launchers <folder>` prints the canvases it proposes before anything is placed. For a reviewed plan, use `spawn import propose --out plan.json`, edit it, then `import check` and `import apply`.",
        },
      ],
    },
    {
      title: 'Reference',
      pages: [
        {
          slug: 'troubleshooting',
          title: 'Troubleshooting',
          description: 'The errors people actually hit, and what each one means.',
          body: "## The browser workspace\n\n| Symptom | What it means | What to do |\n|---|---|---|\n| `--workspace` is not recognized | The installed engine is older than rc.45 | Update Spawn, then run `spawn pair --workspace` again |\n| The code is refused | It expired (5 minutes), was already used, or was typed wrong | Run `spawn pair --workspace` again for a new code |\n| The page cannot reach the address | Spawn is not running, or the browser blocks the loopback request | Start Spawn on this computer; allow local network access when the browser asks |\n| The workspace asks you to sign in | The page needs a signed-in XENO account and an allowed licence | Sign in; the workspace opens when the platform confirms the account |\n| The workspace closed by itself | The pairing expired or was revoked | Pair again with a new code |\n\n## Installation\n\n| Symptom | What it means | What to do |\n|---|---|---|\n| Windows SmartScreen warns | The build is unsigned | Choose **More info → Run anyway** |\n| `spawn` is not recognized | PATH was not refreshed after install | Open a new terminal, or run `%LOCALAPPDATA%\\XENO\\Spawn\\Spawn.cmd` |\n| The install refuses the download | Its SHA-256 did not match the published value | Run the install command again; do not install the file by hand |\n\n## Logs\n\n`spawn logs` shows Spawn's logs. Every agent started from a terminal is recorded; credentials never are.\n\n## A canvas will not open\n\nA journal is owned by one server at a time. If a second server tries to open the same canvas it is refused by name; close the other Spawn or use a different folder. `spawn status` shows the running instance.",
        },
        {
          slug: 'cli-reference',
          title: 'Command reference',
          description: 'The commands this release documents.',
          body: "## Everyday\n\n| Command | What it does |\n|---|---|\n| `spawn` | start Spawn and open the workspace |\n| `spawn claude --agent agt_…` | start Claude Code as a XENO agent |\n| `spawn codex --agent agt_…` | start Codex as a XENO agent |\n| `spawn agents standby on <agt_id> --folder <project|none>=<path>` | start an agent when a task is delegated to it |\n| `spawn agents status` | list what is on standby |\n| `spawn logs` | show Spawn's logs |\n| `spawn status` | show the running instance |\n\n## Pairing the hosted page\n\n| Command | What it does |\n|---|---|\n| `spawn pair` | issue a read-only project-list pairing code |\n| `spawn pair --workspace` | issue a code that grants the workspace controls |\n| `spawn pair list` | list pairing sessions |\n| `spawn pair revoke <session-id>` | end a pairing immediately |\n\n## Moving work in\n\n| Command | What it does |\n|---|---|\n| `spawn import launchers <folder>` | print the canvases a folder would become |\n| `spawn import propose --out plan.json` | write an editable plan |\n| `spawn import check plan.json --stamp` | validate a plan |\n| `spawn import apply plan.json` | place the canvases |\n\n## Installed entry point\n\nAfter installation the same commands are available as `%LOCALAPPDATA%\\XENO\\Spawn\\Spawn.cmd <command>`.",
        },
      ],
    },
  ],
};

export default spawn;
