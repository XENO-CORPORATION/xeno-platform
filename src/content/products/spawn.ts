import type { ProductContent } from './_types';

/* XENO Spawn — sourced from ../xeno-spawn (README.md, server/src/agentCli.js, agentBinding.js, profilesCli.js,
 * scripts/user-installer/spawn.ps1) and the published 0.1.0-rc.42 release notes on R2 (apps/spawn/releases.json).
 *
 * HONESTY CONTRACT for this page:
 *  · Windows x64 only. No macOS or Linux build exists; do not name them until an artifact does.
 *  · Beta channel, unsigned build, NO in-app updater yet: a newer version is installed by running the command again.
 *  · Terminals run as the person's own OS user. The managed sandbox (Box) is not qualified on Windows, so this page
 *    never claims sandboxed execution.
 *  · `spawn claude --agent` binds a XENO platform agent to a profile; it does not touch the person's own
 *    ~/.claude or ~/.codex settings (agentBinding.js writes only into the managed profile). */
const spawn: ProductContent = {
  slug: 'spawn',
  hero: {
    headline: 'Every coding agent in one place — and your XENO agents, one line away.',
    sub: 'XENO Spawn runs Claude Code, Codex, agy, opencode and the XENO agent side by side on a canvas that keeps every session. Start any agent you made on xenosystem.ai in a terminal with one line: it signs in as that agent, gets a fresh short-lived credential for that run only, and your own CLI settings stay untouched.',
    media: { type: 'mockup', src: 'spawn-hero', alt: 'A PowerShell window running spawn claude --agent: Spawn binds the XENO agent Release Bot to a profile, issues a one-hour credential, and starts Claude Code connected to XENO' },
    badges: ['Windows', 'Beta', 'Unsigned build', 'XENO account'],
    note: 'Beta · v0.1.0-rc.42 · Windows x64 only. No in-app updater yet — run the install command again for a newer version.',
  },
  trust: [
    'The install script refuses the download unless its SHA-256 matches the published value',
    'Each launch gets its own one-hour credential, revoked when the session ends',
    'Your own ~/.claude and ~/.codex settings are never read or changed',
  ],
  highlights: [
    { value: '1 line', label: 'Install, and start an agent' },
    { value: '5 agents', label: 'Claude Code · Codex · agy · opencode · XENO' },
    { value: '1 hour', label: 'Credential per launch' },
    { value: 'Per profile', label: 'Settings kept apart' },
  ],
  features: [
    {
      eyebrow: 'Your XENO agents',
      icon: 'Terminal',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,200,210,0.14), transparent 60%), linear-gradient(165deg,#15161a,#070707 74%)',
      title: 'Run an agent you made on xenosystem.ai, from your own terminal',
      desc: 'Open the agent in your workspace, choose Claude Code or Codex, copy the line and run it in the folder you want it to work in. The first time, Spawn asks you to confirm and makes a profile for that agent; after that it reuses it.',
      bullets: [
        'spawn claude --agent <id> or spawn codex --agent <id>',
        'Everything it does in XENO — tasks, comments, files — shows as that agent',
        'Or click Open in Spawn on the agent’s page',
      ],
    },
    {
      eyebrow: 'One canvas',
      icon: 'Layers',
      accent: 'radial-gradient(ellipse at 28% 30%, rgba(200,200,210,0.12), transparent 60%), linear-gradient(165deg,#141417,#070707 74%)',
      title: 'Every agent, its own session, kept',
      desc: 'Put agents side by side on a canvas, each with its own session and context window. Saved sessions reopen where they were; spawn open <project> opens a whole canvas in one Windows Terminal window, a tab per agent.',
      bullets: [
        'Claude Code, Codex, agy, opencode and the XENO agent',
        'Profiles keep each agent’s configuration apart',
        'Sessions survive closing the window',
      ],
    },
  ],
  howItWorks: [
    { step: '1', title: 'Install', desc: 'Run the one-line command in PowerShell. It downloads the published build, checks its checksum and installs it.' },
    { step: '2', title: 'Sign in', desc: 'Run spawn and sign in with your XENO account in the browser.' },
    { step: '3', title: 'Start an agent', desc: 'Copy the line from an agent’s page on xenosystem.ai and run it in your project folder.' },
  ],
  specs: [
    { label: 'Platform', value: 'Windows 10/11, x64' },
    { label: 'Installs to', value: '%LOCALAPPDATA%\\XENO\\Spawn, with spawn on your PATH and a Start Menu entry' },
    { label: 'Needs first', value: 'Nothing — the runtime is bundled' },
    { label: 'Updates', value: 'Run the install command again (no in-app updater yet)' },
  ],
  faq: [
    { q: 'Is there a version without the terminal?', a: 'The install also adds XENO Spawn to the Start Menu: the canvas app that holds your agent sessions. The one-line install is the same for both.' },
    { q: 'macOS or Linux?', a: 'Not yet. This release is Windows x64 only.' },
    { q: 'Can I install without running a script?', a: 'Yes: download the release zip from the release notes, extract it and run Install XENO Spawn.cmd. Windows may warn because the build is unsigned.' },
  ],
  downloadNotice: 'No in-app updater yet: to update, run the install command again.',
  autoUpdates: false,
};

export default spawn;
