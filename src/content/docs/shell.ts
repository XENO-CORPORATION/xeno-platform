import type { ProductDocs } from './_types';

/* XENO Shell documentation — reconciled against xeno-shell v0.1.0-beta.4 (tag v0.1.0-beta.4,
 * 1655d54). Every claim traces to that tag: apps/desktop/src/main/door.ts + authGate.ts (the
 * sign-in door), account.ts (Sign in with XENO), remoteSession.ts + sessionServer.ts (sessions
 * between two PCs), sessionFiles.ts (shared folders), sessionTerminals.ts (shared terminals),
 * sessionLog.ts (the activity log) and authLog.ts (diagnostics).
 * Windows only for 0.1.0-beta.4: the Linux AppImage in the feed is the older beta.2, so no other
 * platform is named for this version. */
const shell: ProductDocs = {
  slug: 'shell',
  productName: 'XENO Shell',
  tagline: 'A desktop environment you can share: another person joins your PC with their own cursor, on files and terminals you choose.',
  version: '0.1.0-beta.4',
  updated: '2026-09-26',
  seo: {
    title: 'XENO Shell documentation',
    description: 'Install XENO Shell, sign in with your XENO account, share your desktop with someone on another PC, give them a folder or a terminal, and troubleshoot a connection.',
  },
  sections: [
    {
      title: 'Getting started',
      pages: [
        {
          slug: 'introduction',
          title: 'Introduction',
          description: 'What XENO Shell is today, and what it is not yet.',
          body: "## Introduction\n\nXENO Shell is a desktop that runs on top of Windows. It has its own dock, windows, file manager, desktop, trash and terminals, all working on your real PC.\n\nIts main feature is **shared sessions**: another person, on another PC, can join your shell with their own cursor. You decide which windows they see, which folders they can open or change, and whether they can type in a terminal.\n\n## What it is not yet\n\n- **Comms, Agents, Tasks and Hub** inside the shell still show sample content. They are not connected to your account yet.\n- A guest sees your shared windows as frames, not their live contents.\n- A guest cannot copy files from a shared folder to their own PC, and files over 8 MB are refused.\n\n## Next steps\n\n- [Installation](/docs/shell/installation)\n- [Signing in](/docs/shell/signing-in)\n- [Sharing your shell](/docs/shell/sharing)",
        },
        {
          slug: 'installation',
          title: 'Installation',
          description: 'Download and install XENO Shell on Windows.',
          body: "## Installation\n\nXENO Shell 0.1.0-beta.4 is available for **Windows (x64)**.\n\n1. Sign in on [xenostudio.ai](/product/shell) and choose **Download for Windows**. Downloading needs a signed-in account with an active plan.\n2. Run `XENO Shell Setup 0.1.0-beta.4.exe`. It installs for your user only; no administrator rights are needed.\n3. The installer is **not code-signed yet**, so Windows SmartScreen shows *Windows protected your PC*. Choose **More info → Run anyway**. The app says so too: an **Unsigned build** badge sits on the sign-in screen and in the shell.\n4. Open XENO Shell and [sign in](/docs/shell/signing-in).\n\n## Updates\n\nXENO Shell checks for updates on the beta channel and downloads them in the background. A copy on an earlier beta updates to 0.1.0-beta.4 by itself.\n\n## Where your data lives\n\nSettings, your sign-in and the diagnostics log live in `%APPDATA%\\@xeno-corporation\\xeno-shell-desktop\\`. Desktop layout and window positions are in `%USERPROFILE%\\.xeno\\shell\\state.json`.",
        },
        {
          slug: 'signing-in',
          title: 'Signing in',
          description: 'XENO Shell opens only for a signed-in XENO account the platform allows.',
          body: "## Signing in\n\nSince **0.1.0-beta.4**, XENO Shell opens on a sign-in screen. The desktop starts only after you sign in with your XENO account and the platform confirms the account may use XENO Shell.\n\n1. Choose **Sign in to XENO**. Your browser opens at xenostudio.ai.\n2. Continue with Google, GitHub or email. XENO Shell never sees your password.\n3. The browser tab says *You're signed in to XENO*. Close it and return to XENO Shell.\n\nYour sign-in is kept in Windows' secure storage, so the next launch goes straight to your desktop.\n\n## What the sign-in screen can say\n\n| Screen | What it means | What to do |\n|---|---|---|\n| **Sign in** | No account is signed in on this PC | Sign in |\n| **No active plan** | Your account is signed in but is not allowed to use XENO Shell | Choose **Choose a plan** |\n| **Update required** | This version is too old for the platform | Choose **Download the latest XENO Shell** and install it |\n| **Offline too long** | The platform has not been reachable for 14 days | Connect to the internet and choose **Check again** |\n\nIf you are offline, XENO Shell keeps working for **14 days** after it last confirmed your plan.\n\n## Signing out\n\nSigning out covers the desktop and returns to the sign-in screen. Your windows stay as they were and come back when you sign in again.",
        },
      ],
    },
    {
      title: 'Working together',
      pages: [
        {
          slug: 'sharing',
          title: 'Sharing your shell',
          description: 'Let someone on another PC join your shell with their own cursor.',
          body: "## Sharing your shell\n\nBoth people need XENO Shell and a XENO account. The person sharing is the **host**; the person joining is the **guest**.\n\n### Host\n\n1. Open the share panel and choose **Start sharing**.\n2. A code appears, such as `ABCD-2345`. Give it to the guest.\n3. When the guest asks to join, their XENO account name appears with a **XENO** tag, which means the platform confirmed who they are. Choose **Let in** or **No**.\n\n### Guest\n\n1. Open the share panel and choose **Join someone instead**.\n2. Enter the code and choose **Join**.\n3. Wait for the host to let you in.\n\n## What the guest can do\n\n- Each person has **their own cursor**, labelled with their name.\n- New windows stay **private** until the host shares them.\n- The host can **lock** a window, hand it to the guest, take it back, or remove the guest from the session at any time.\n\n## How the connection works\n\nThe two PCs connect **directly** to each other. When a network blocks a direct connection, the connection goes through a XENO relay instead. The platform only introduces the two PCs; it never sees what you do in the session. The guest's PC checks the host's encryption key against the one XENO vouched for, and refuses to connect if they differ.",
        },
        {
          slug: 'shared-folders-and-terminals',
          title: 'Shared folders and terminals',
          description: 'Give a guest one folder or one terminal on your PC, and nothing else.',
          body: "## Shared folders\n\nA guest can work on files on **your** PC, only in a folder you choose.\n\n1. In the share panel, under **Shared folders**, choose **Share a folder…** and pick it.\n2. Choose who it is for and the level: **View** (open and read) or **Edit** (also create, rename, save and delete).\n3. The guest sees it in their Files app under *Shared from* your name.\n\nEverything the guest does happens on your disk, inside that folder. Paths outside it — including `..` — are refused. Change the level or choose **Stop sharing** at any time; access ends immediately.\n\nLimits in this version: files over **8 MB** are refused, and a guest cannot copy a file out to their own PC.\n\n## Shared terminals\n\n1. Open a terminal, then in the share panel under **Shared terminals** choose it and **Share terminal**.\n2. The guest watches it live. They can type only after you give them the keyboard.\n3. When the guest chooses **Ask to type**, you see the request. Choose **Let them type** (or **No**). You can also give the keyboard without being asked: **Give keyboard**.\n4. While the guest types, your own typing in that terminal is held. Choose **Take back** at any time; the guest can choose **Hand back**.\n\nCommands the guest types run **on your PC**, as you. Only give the keyboard to someone you trust.\n\n## The session activity log\n\nThe host's share panel shows **Session activity**: who joined and left, which files were opened or changed, and keyboard hand-offs. File names are shown relative to the shared folder. What anyone types in a terminal is **not** recorded. Choose **Save log…** to keep it as a text file.",
        },
      ],
    },
    {
      title: 'Help',
      pages: [
        {
          slug: 'troubleshooting',
          title: 'Troubleshooting',
          description: 'Sign-in problems, a guest who cannot connect, and how to send diagnostics.',
          body: "## Troubleshooting\n\n### The browser says I'm signed in, but XENO Shell still shows the sign-in screen\n\nChoose **Check again**. If the screen then says **No active plan**, your account is signed in but not allowed to use XENO Shell.\n\n### The guest cannot connect\n\n- Both people must be signed in to XENO Shell.\n- Codes expire. On the host, choose **New code** and give the guest the new one.\n- Some company and school networks block the connection. It usually goes through the XENO relay; if it still fails, try another network on either side.\n\n### Sending diagnostics\n\nEach PC keeps a log of its sign-in and connection steps. It never contains passwords, tokens, file names or what anyone types.\n\n1. Open the share panel and expand **Having trouble connecting?**\n2. Choose **Copy diagnostics**.\n3. Paste it into your message to XENO support.\n\nWhen two PCs cannot connect, send the diagnostics from **both** PCs — each one records only its own side. The log file itself is `auth.log` in `%APPDATA%\\@xeno-corporation\\xeno-shell-desktop\\`.",
        },
      ],
    },
  ],
};

export default shell;
