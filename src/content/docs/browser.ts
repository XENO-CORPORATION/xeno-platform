import type { ProductDocs } from './_types';

/* XENO Browser documentation — reconciled against xeno-browser v0.5.8 (tag v0.5.8, c2c9200).
 * Every claim here traces to the code in that tag: src/main/auth/ (the sign-in door),
 * src/main/licence/ (the licence check), src/main/TabManager.ts (tabs, groups, split,
 * workspaces, sleep), src/main/AgentControlPlane.ts + capabilityHost.ts (the agent surface),
 * and src/renderer/src/CommandBar.tsx (the shortcut list). Windows only — no other artifact
 * exists in the R2 feed, so no other platform is named. */
const browser: ProductDocs = {
  slug: 'browser',
  productName: 'XENO Browser',
  tagline: 'The agent-native web browser — real Chromium, with an agent that can attach and download files by path.',
  version: '0.5.8',
  updated: '2026-09-26',
  seo: {
    title: 'XENO Browser documentation',
    description: 'Install XENO Browser, sign in, and use workspaces, tab groups, split view, translate, print preview and developer tools — and drive the browser from an agent over its local API.',
  },
  sections: [
    {
      title: 'Getting started',
      pages: [
        {
          slug: 'introduction',
          title: 'Introduction',
          description: 'What XENO Browser is, and what it is not.',
          body: "## Introduction\n\nXENO Browser is a desktop web browser built on real Chromium (Electron). Sites behave exactly as they do in Chrome. What makes it different is that an AI agent can drive it — from its own sidebar, from a terminal, or from another program — including the one thing web agents usually cannot do: **attach and download files by path**, without the operating system's file dialog in the way.\n\nIt is also a complete everyday browser: workspaces, tab groups, split view, vertical tabs, a reading list, page translation, print preview, docked developer tools, private windows and isolated profiles.\n\n## Your XENO account\n\nSince **0.5.0**, XENO Browser opens only for a signed-in XENO account that the platform allows. See [Signing in](/docs/browser/signing-in).\n\n## What it is not\n\n- **Not a model runtime.** The browser embeds no AI model. The agent's reasoning runs on a XENO endpoint, not on your machine.\n- **Not a CAPTCHA solver.** There is no CAPTCHA-bypass capability, and there never will be — it is refused at the control plane.\n- **Not the browser extension.** [XENO Extension](/product/extension) puts an agent inside Chrome, Edge or Brave. XENO Browser is our own browser, where the agent has full control.\n\n## Next steps\n\n- [Installation](/docs/browser/installation)\n- [Signing in](/docs/browser/signing-in)\n- [Tabs, workspaces and windows](/docs/browser/tabs-and-workspaces)",
        },
        {
          slug: 'installation',
          title: 'Installation',
          description: 'Download and install the Windows build.',
          body: "## Installation\n\nXENO Browser is available for **Windows (x64)**. Other platforms have not been released.\n\n1. Sign in on [xenostudio.ai](/product/browser) and choose **Download for Windows**. Downloading needs a signed-in account with an active plan.\n2. Run `XENO Browser Setup <version>.exe`.\n3. The installer is **not code-signed yet**, so Windows SmartScreen shows *Windows protected your PC*. Choose **More info → Run anyway**. The app says so too: an **Unsigned** badge sits in its title bar and on the sign-in screen.\n4. Finish the installer, then open XENO Browser and [sign in](/docs/browser/signing-in).\n\n## Updates\n\nFrom **0.5.5** the browser updates itself: a new version downloads in the background and installs when you close the browser. When one is ready, the sign-in screen, the profile window and the toolbar offer **Restart to update**. The version you are on is shown at the bottom of the sign-in screen and the profile window.\n\n**If you have 0.5.4 or earlier, install 0.5.5 by hand once.** Those versions could not update themselves. Download it from the [product page](/product/browser) and run it over your current copy — it replaces the old version (one copy stays installed) and your profiles, tabs and settings are kept.\n\n## Where your data lives\n\nProfiles, history, bookmarks, the reading list, settings and your saved session live in `%APPDATA%\\xeno-browser\\`. The sign-in trace (see [Troubleshooting](/docs/browser/troubleshooting)) is `auth.log` in the same folder.",
        },
        {
          slug: 'signing-in',
          title: 'Signing in',
          description: 'The sign-in screen, what each message means, and staying signed in.',
          body: "## Signing in\n\nWhen XENO Browser starts, it shows a sign-in screen first. **Nothing of the browser runs behind it** — no tab opens, no page loads, no earlier session is restored, and the local agent API does not listen — until you are signed in and the platform says your account may use XENO Browser.\n\n## How to sign in\n\n1. Choose **Sign in to XENO**.\n2. Your usual web browser opens at xenostudio.ai. Sign in there (Google, GitHub or email).\n3. Return to XENO Browser. It opens.\n\nXENO Browser never sees your password: sign-in happens in your web browser, and the app receives a token. Your session is kept in the Windows credential store, so you stay signed in between launches.\n\n## What the screen can say\n\n| Message | What it means | What to do |\n|---|---|---|\n| **Welcome back** | You are not signed in, or your session ended. | Sign in. |\n| **XENO Browser needs a plan** | You are signed in, but your account does not include XENO Browser. | Choose a plan, then **Check again**. |\n| **Update XENO Browser to continue** | This version is older than the oldest one still supported. It is not a problem with your plan. | Download the latest version. |\n| **Your plan couldn't be confirmed** | The browser could not reach XENO for 14 days. Your plan may be fine. | Connect to the internet and choose **Check again**. |\n\n## Offline\n\nA network problem never locks you out straight away. The last confirmed answer is kept for **14 days**, so the browser opens normally offline during that time.\n\n## While you browse\n\nIf you sign out, or your plan changes, the sign-in screen covers the window again. **Your tabs are kept** — sign back in and they are where you left them.",
        },
      ],
    },
    {
      title: 'Using the browser',
      pages: [
        {
          slug: 'tabs-and-workspaces',
          title: 'Tabs, workspaces and windows',
          description: 'Workspaces, tab groups, split view, vertical tabs, sleeping tabs and private windows.',
          body: "## Tabs, workspaces and windows\n\n## Workspaces\n\nA workspace is a separate set of tabs in the same window — for example *Personal* and *Work*. The switcher sits beside the XENO mark (and at the top of the tab rail when you use vertical tabs).\n\n- **Switch** by choosing a workspace in the switcher. Switching hides the other workspace's pages rather than reloading them, so nothing you typed is lost.\n- **New workspace** creates an empty one with a single tab and opens its editor, where you name it and pick a colour.\n- **Move a tab** to another workspace from the tab's right-click menu.\n- **Delete** a workspace from its editor: you choose whether its tabs close or move to another workspace. The last workspace cannot be deleted.\n\nAll workspaces, their names and their tabs are restored the next time you open the browser. Workspaces are not profiles: cookies and sign-ins belong to the profile, so two workspaces in the same profile share them.\n\n## Tab groups\n\nRight-click a tab and choose **Add to new group** to start a named, coloured group; add more tabs from the same menu. Click a group's label to rename it, change its colour, collapse it, or close it.\n\n## Split view\n\nRight-click a tab and choose **Open in split view** to show it beside the current tab. Drag the divider to resize. Clicking into a pane makes it the active tab.\n\n## Vertical tabs and compact mode\n\nIn **Settings → Appearance** turn on vertical tabs (a rail on the left, narrow or wide) or compact mode (a slimmer tab strip).\n\n## Sleeping tabs\n\nTabs you have not used for a while fall asleep: the page is released to free memory, but the tab keeps its place, title and history, and loads again when you click it. A tab never sleeps if it is playing audio, is pinned, or has text you have typed but not sent. Choose the delay (or turn it off) in **Settings**, or put a tab to sleep yourself from its right-click menu.\n\n## Private windows\n\n**Ctrl+Shift+N** opens a private window. It keeps no history, cookies or tabs after you close it.\n\n## Profiles\n\n**Ctrl+Shift+P** opens the Profile Manager. Each profile is a separate identity with its own cookies, storage, proxy and fingerprint settings.",
        },
        {
          slug: 'reading-translate-print',
          title: 'Reading, translating and printing',
          description: 'The side panel, page translation, print preview, view source and developer tools.',
          body: "## Reading, translating and printing\n\n## Side panel\n\nThe side panel holds your **reading list**, **history** and **bookmarks**. Open the reading list with **Ctrl+Shift+L**, and save the current page to it from the command bar.\n\n## Translate\n\nWhen a page is in another language, a bar offers to translate it into yours, in place. You can choose to always or never translate a language. Translation uses the XENO model through your account; manage languages in **Settings → Languages**.\n\n## Print preview\n\n**Ctrl+P** opens a preview of the real document with destination, pages, layout, paper size, margins, scale and headers/footers. Save as PDF, or print.\n\n## View source\n\n**Ctrl+U** opens the page's source in a new tab as a numbered listing.\n\n## Developer tools\n\n**F12** docks developer tools under the page. They follow the active tab when you switch tabs.\n\n## Selecting text\n\nHighlight any text on a page and a small bar appears with **Copy**, **Search** (opens a web search for the selection) and **Ask agent** (opens the agent sidebar with the text ready). Click anywhere else to dismiss it.\n\n## Rewrite\n\nIn a **text box** — a comment field, an editor, a form — select some text, right-click and choose **Rewrite**. A panel shows another way of writing it: **Replace** puts it back in the field, **Adjust** offers shorter / longer / more formal / more casual, and the round button rewrites again. Rewrite uses XENO through your signed-in account, so it needs you signed in and counts against your credits.",
        },
        {
          slug: 'keyboard-shortcuts',
          title: 'Keyboard shortcuts',
          description: 'The shortcuts XENO Browser ships with.',
          body: "## Keyboard shortcuts\n\nPress **Ctrl+/** in the browser for the full list, and **Ctrl+K** for the command bar, which can run nearly anything by name.\n\n| Action | Shortcut |\n|---|---|\n| New tab | Ctrl+T |\n| Close tab | Ctrl+W |\n| Reopen closed tab | Ctrl+Shift+T |\n| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |\n| Tab 1–8 / last tab | Ctrl+1–8 / Ctrl+9 |\n| Search tabs | Ctrl+Shift+A |\n| Command bar | Ctrl+K |\n| Find in page | Ctrl+F |\n| Bookmark this tab | Ctrl+D |\n| Bookmarks bar | Ctrl+Shift+B |\n| History | Ctrl+H |\n| Downloads | Ctrl+J |\n| Bookmarks manager | Ctrl+Shift+O |\n| Reading list | Ctrl+Shift+L |\n| Print | Ctrl+P |\n| View source | Ctrl+U |\n| Developer tools | F12 |\n| Reload / hard reload | Ctrl+R / Ctrl+Shift+R |\n| Zoom in / out / reset | Ctrl++ / Ctrl+− / Ctrl+0 |\n| Full screen | F11 |\n| New private window | Ctrl+Shift+N |\n| Profile Manager | Ctrl+Shift+P |\n| Settings | Ctrl+, |",
        },
      ],
    },
    {
      title: 'Agents',
      pages: [
        {
          slug: 'agent-api',
          title: 'Driving the browser from an agent',
          description: 'The local agent API, file I/O by path, and the capability server.',
          body: "## Driving the browser from an agent\n\nXENO Browser exposes a local API that an agent, a script or a terminal tool can drive. It listens on **127.0.0.1 only**, and every request needs the per-launch token.\n\nThe API starts only after the browser has opened — that is, after you have [signed in](/docs/browser/signing-in) and your account is allowed. An agent cannot use it to get past the sign-in screen.\n\n## Connecting\n\nWhen the API is ready the browser writes `session.json` (`{ port, token }`) to its data folder:\n\n```bash\ncurl -s http://127.0.0.1:$PORT/v1/browser/health -H \"authorization: Bearer $TOKEN\"\ncurl -s http://127.0.0.1:$PORT/v1/browser/navigate -H \"authorization: Bearer $TOKEN\" \\\n  -H 'content-type: application/json' -d '{\"url\":\"https://example.com\"}'\n```\n\nThe full API is described in OpenAPI 3.1 and served live at `GET /v1/openapi.json`. It covers navigation, reading and finding on the page, clicking, typing and keys, forms, tabs, tab groups, split view, workspaces, sleeping tabs, the reading list, translation, profiles, and the licence status.\n\n## Files by path\n\n`attach_file` puts files straight into a page's file input — including drag-and-drop-only upload areas — and `download` saves to an exact path. No operating-system dialog opens. File access is limited to the folders you allow with `XENO_BROWSER_MOUNTS` (separated by `;` or `,`); with none set, every file operation is refused.\n\n## The capability server\n\nStart the browser with `--capability-server` (or `--agent`) to publish the same actions to the XENO agent stack as `browser.<domain>.<verb>` capabilities, on loopback port 30614.\n\n## What an agent cannot do\n\nThere is no CAPTCHA-solving or anti-detection capability, and none will be added. Only the web pages and local folders you allow are reachable.",
        },
      ],
    },
    {
      title: 'Help',
      pages: [
        {
          slug: 'troubleshooting',
          title: 'Troubleshooting',
          description: 'Sign-in problems, SmartScreen, and where to look when something goes wrong.',
          body: "## Troubleshooting\n\n## I see two windows, or it asks me to sign in again\n\nThose were bugs in 0.5.0–0.5.4, fixed by **0.5.5**. Install it from the [product page](/product/browser) over your current copy (those versions cannot update themselves).\n\n## Google says \"Couldn't sign you in — this browser or app may not be secure\"\n\nFixed in **0.5.8**. On a profile, the browser had reported a slightly inconsistent version of itself, which Google's sign-in refuses. Update to 0.5.8 or later, then sign in to Google again.\n\n## Windows warns when I install\n\nThe installer is not code-signed yet, so SmartScreen shows *Windows protected your PC*. Choose **More info → Run anyway**. This is expected for this release.\n\n## I signed in, and it still asks me to sign in\n\n- Make sure you finished signing in in your web browser, then return to XENO Browser.\n- If the sign-in page was closed early, choose **Cancel** on the sign-in screen and start again.\n- `auth.log` in `%APPDATA%\\xeno-browser\\` records each step (sign-in started and finished, the verdict from XENO, every change of the screen's state). It never contains your password or tokens. Include it when you ask for help.\n\n## It says my browser needs a plan\n\nYour account is signed in but does not include XENO Browser. Choose a plan on xenostudio.ai, then choose **Check again**.\n\n## It says to update\n\nThis version is below the oldest one still supported. Download the latest version from the [product page](/product/browser).\n\n## It says my plan couldn't be confirmed\n\nThe browser could not reach XENO for 14 days. Connect to the internet and choose **Check again**. Your plan is not affected.\n\n## Starting over\n\nTo reset the browser completely, close it and rename `%APPDATA%\\xeno-browser\\`. The browser starts fresh the next time, and your old data stays in the renamed folder.",
        },
      ],
    },
  ],
};

export default browser;
