import type { ProductDocs } from './_types';

/* XENO Storage desktop documentation — reconciled against xeno-storage 0.1.2 (Windows), 2026-10-26. Every claim
 * traces to that release: apps/desktop/src/main/account.ts (sign-in door), index.ts (tray, single instance, start
 * with Windows), mount.ts + mountBroker.ts (drive letters, XENO Connect), crates/storage-mount/src/google.rs (the
 * Google drive's root IS My Drive; "Shared drives" only for accounts that have them) + layout.rs (drives set up
 * before 0.1.2 move over on their first start), crates/cloud-vfs-cfapi (refused drops, "only on this PC", last
 * check with Google), renderer/components (Projects, links, trash, filters), letter_volume.rs, build/installer.nsh
 * (Dokany), storage.log. Several XENO accounts on one Google account: xeno-connect PR #4, live 2026-10-26.
 * Windows x64 only; no in-app updater in 0.1.2. */
const storage: ProductDocs = {
  slug: 'storage',
  productName: 'XENO Storage',
  tagline: 'Your XENO Storage and your Google Drive accounts as drives on this PC.',
  version: '0.1.4',
  updated: '2026-10-27',
  seo: {
    title: 'XENO Storage documentation',
    description: 'Install XENO Storage on Windows, sign in, mount XENO Storage or a Google Drive account as a drive letter, share a Google Drive between several people, share files and folders by link, and fix a drive that does not sync.',
  },
  sections: [
    {
      title: 'Getting started',
      pages: [
        {
          slug: 'introduction',
          title: 'Introduction',
          description: 'What XENO Storage does today, and what it does not yet.',
          body: "## Introduction\n\nXENO Storage puts your **XENO Storage** files and each connected **Google Drive** account in File Explorer, each under its own drive letter. Files appear straight away and download when you open them. Folders you choose stay on this PC.\n\nThe app also shows everything your XENO account keeps: your files, your workspaces' files, your projects, what others shared with you, and the trash. See [Files and sharing](/docs/storage/files-and-sharing).\n\nXENO Storage keeps running in the taskbar corner when you close its window, so your drives keep syncing. Quit it from the icon there.\n\n## Updates\n\nFrom 0.1.4, XENO Storage keeps itself up to date. It checks shortly after it starts and every six hours, downloads a new version in the background and checks it against the published fingerprint. When it is ready, the window and the taskbar icon offer **Restart to update**; otherwise it installs the next time you quit. It never installs an older version.\n\nVersions before 0.1.4 cannot update themselves: install 0.1.4 once from the [product page](/product/storage).\n\n## What it is not yet\n\n- **Windows x64 only.** No macOS or Linux build exists.\n- **Google Drive is the only connected cloud.** OneDrive and Dropbox are not supported yet.\n- **Builds, package installs and games** run much slower from a drive shown with its own name and size (see [Drive letters](/docs/storage/drive-letters)). Keep that kind of work on a local disk.\n\n## Next steps\n\n- [Installation](/docs/storage/installation)\n- [Signing in](/docs/storage/signing-in)\n- [Drive letters](/docs/storage/drive-letters)",
        },
        {
          slug: 'installation',
          title: 'Installation',
          description: 'Download and install XENO Storage 0.1.2 on Windows.',
          body: "## Installation\n\nXENO Storage 0.1.2 is available for **Windows 10 and 11 (x64)**.\n\n1. On the [product page](/product/storage), choose **Download for Windows**.\n2. Run `XENO Storage Setup 0.1.2.exe`. It installs for your user only.\n3. The installer is **not code-signed yet**, so Windows SmartScreen may show *Windows protected your PC*. Choose **More info → Run anyway**. The app says so too: an **Unsigned build** badge sits in its window.\n4. If **Dokany** is not on this PC, the installer offers to install it, and Windows asks once for administrator rights. Dokany is a signed open-source file-system driver; with it, each drive shows its own account's name and space. You can decline: your drives still work and show the name and size of the disk they are on.\n\nXENO Storage then starts with Windows, in the taskbar corner, so drives you set to mount at sign-in come back on their own.\n\n## Updates\n\nThere is no in-app updater in 0.1.2. To update, download the new version from the product page and run it. Your drives, settings and anything waiting to upload are kept.\n\n## Uninstalling\n\nQuit XENO Storage from its icon in the taskbar corner, then use **Settings → Apps → XENO Storage → Uninstall**. Your files are not deleted. Dokany stays installed because other software may use it; remove it separately from **Apps** if you no longer need it.",
        },
        {
          slug: 'signing-in',
          title: 'Signing in',
          description: 'XENO Storage opens only for a signed-in XENO account the platform allows.',
          body: "## Signing in\n\nXENO Storage opens on a sign-in screen. Choose **Sign in**; your browser opens to finish signing in with your XENO account. XENO Storage never sees your password.\n\n## What the sign-in screen can say\n\n| Screen | What it means | What to do |\n|---|---|---|\n| **Sign in** | No account is signed in on this PC | Sign in |\n| **No access** | The platform has not granted this account access to XENO Storage | Check your plan in your XENO account |\n| **Update required** | This version is too old for the platform | Download the latest version from the product page |\n| **Unavailable** | The XENO account service could not be reached | Check your connection and try again |",
        },
      ],
    },
    {
      title: 'Using your drives',
      pages: [
        {
          slug: 'drive-letters',
          title: 'Drive letters',
          description: 'Mount XENO Storage or a Google account as a drive, and what the drive shows.',
          body: "## Drive letters\n\nEach mounted account gets its own letter in File Explorer's **This PC**, such as **BUNKER CAMP - Google Drive (Z:)**.\n\n1. In XENO Storage, open the account (XENO Storage, or a Google account under **Connected clouds**).\n2. Choose a free **Drive letter** and mount it.\n3. The drive appears in File Explorer. Files show at once and download when you open them.\n\n## Keep XENO Storage running\n\nA drive syncs only while XENO Storage runs. Closing the window keeps it running in the taskbar corner, and it starts with Windows. **Quit XENO Storage** in that icon's menu stops every drive: files you add then wait on this PC and upload the next time it runs.\n\nEach drive's card in the app says when it last checked for changes, for example *Checked with Google 5 seconds ago*. While that is recent, files added on other PCs appear within seconds. If it says it has not heard from the service for minutes, check your connection.\n\n## Name and size\n\nWith Dokany installed, the drive is its own volume: This PC shows the **account's name** and the **account's total and free space**. Without Dokany, the drive is a plain letter that shows the name and size of the disk its folder is on. Either way, files you add are stored in the account, not on that disk.\n\n## Speed\n\nWhen a drive shows its own name and size, every file request passes through XENO Storage's drive engine. Measured on Windows 11: large files are 2–6x slower than a local disk (still well over 1 GB/s on a fast SSD), and work on thousands of small files is **5–40x slower**. Opening documents, photos and video is limited by the download, so you will not notice it there. **Do not run builds, `npm install` or games from the drive.**\n\n## Keeping files on this PC\n\nRight-click a file or folder in File Explorer:\n\n- **Always keep on this device** downloads it and keeps it.\n- **Free up space** removes the local copy; the file stays in the cloud.\n\nOn the drive's card, **Space on this PC** limits how much room downloaded copies may take. Past it, the copies you have not used for longest are removed from this PC only; files you keep offline always stay.",
        },
        {
          slug: 'connected-clouds',
          title: 'Connected clouds',
          description: 'Connect a Google account, mount it, and share one Google Drive between several people.',
          body: "## Connected clouds\n\n1. Open **Connected clouds** and choose **Connect Google Drive**.\n2. Your browser opens. Sign in to Google, tick **See, edit, create and delete all of your Google Drive files**, and continue.\n3. Back in XENO Storage, the account appears. Mount it as a [drive letter](/docs/storage/drive-letters).\n\nYour Google tokens are held by **XENO Connect**, not by the app on your PC. XENO Storage asks Connect for each operation and never stores a Google credential.\n\nYou can connect several Google accounts; each becomes its own drive.\n\n## What the Google drive shows\n\nThe drive **is your My Drive**: open the letter and you see your Google files. Anything you add anywhere on it is stored in Google.\n\nIf the account has **shared drives** (Google Workspace accounts), the drive also has a **Shared drives** folder with one folder per shared drive. Shared drives are made in Google: you can work inside one, but nothing can be saved directly in the **Shared drives** folder itself. A personal Gmail account has no shared drives and shows no such folder.\n\n> A drive set up before 0.1.2 showed **My Drive** and **Shared drives** as two folders at its top. It moves over by itself the first time 0.1.2 starts it: nothing downloads again, and a file that was left beside those two folders uploads into My Drive. If a name was taken, nothing is replaced: the moved item gets *(My Drive)* added to its name.\n\n## One Google Drive for several people\n\nSeveral people can connect the **same** Google account, each from their own XENO account and PC. Everyone then sees the same files, and what one adds, the others see within seconds while their XENO Storage runs.\n\n- Everyone connected has the same full access, including changing and deleting. There is no folder in it that only one of them can see.\n- Keep private files in your own **XENO Storage** drive instead: only you see it.\n- Google shows its consent screen every time an account is connected, including one already connected elsewhere. That is expected: it is how each person gets their own connection.",
        },
        {
          slug: 'files-and-sharing',
          title: 'Files and sharing',
          description: 'Your files, projects, workspaces and shares in the app, links to files and folders, and the trash.',
          body: "## Files and sharing\n\nThe app shows the same files as XENO Storage on the web.\n\n| In the sidebar | What it shows |\n|---|---|\n| **My files** | Your own files and folders |\n| **Projects** | Every project whose files are kept in Storage (for example XENO Workshop projects): yours, your workspaces', and ones shared with you. Opening one opens its folder |\n| **Recent**, **Starred** | What you changed lately, and what you starred |\n| **Shared with me** | Files and folders other people shared with you |\n| A workspace's name | That workspace's files; it has its own **Recent**, **Starred** and **Trash** |\n| **Trash** | Removed files, until you delete them for good |\n\nAbove the list, show **All**, **Images** or **Files**, and sort by **Last changed**, **Name**, **Size** or **Added**.\n\n## Sharing with people\n\nOpen a file's **Sharing** tab, or a folder you are in, and give an account view or edit access. You can see and remove every share.\n\n## Links\n\n- **A file link** lets anyone with it download that file. Open the file's **Sharing** tab and choose **Create link**.\n- **A folder link** lets anyone you give it to open the folder read-only after signing in to XENO. Every open and download is recorded: choose **Activity** on a link to see who, and **Turn off** to stop it at once. A note says who each link is for.\n\nBoth can expire after 7, 30 or 90 days, or never. **A link's address is shown only once**, when you make it: copy it then. XENO keeps only a fingerprint of it.\n\n## Trash\n\n**Move to Trash** can be undone from **Trash**. **Delete forever** removes a file and every earlier version of it, and **Empty trash** does that for everything in your trash. Both ask first and cannot be undone.\n\n## Security check\n\nEvery uploaded file is checked before it can be downloaded. A file's details show the result. If the check failed, **Run the security check again** retries it.",
        },
        {
          slug: 'your-data',
          title: 'Your data and privacy',
          description: 'What is uploaded, what stays on this PC, and where it lives.',
          body: "## Your data\n\n- **Changes upload in the background.** Anything still waiting to upload is kept on disk and resumes the next time the drive runs; quitting the app never throws it away.\n- **Local copies** of files you opened or kept are stored on this PC, on the disk you choose in the app.\n- **App data** (settings, the drive engine's index and cache, and the log) lives under `%LOCALAPPDATA%\\XENO\\`.\n- **Google credentials** stay in XENO Connect, never on this PC.\n- **What counts toward your XENO Storage space:** your files, files in the trash until you delete them, and the saved disk of each stopped XENO Compute machine until you delete the machine. The app's **Storage** page shows your total, and how much of it is machine disk. A full space stops new files from being added; it never stops a machine from saving, and nothing is deleted.\n- **More space:** monthly packs (+100 GB or +2 TB) add to your plan's space. **Get more space** on the app's Storage page opens them on XENO's billing page, where they are priced; cancel them in **Manage billing**. When a pack ends nothing is deleted. Packs go on sale when XENO opens purchases.\n\n## Removing a drive\n\nUnmounting a drive removes its letter. Files in the cloud are untouched. Local copies stay until you free up space or remove the drive from this PC in the app.",
        },
      ],
    },
    {
      title: 'Help',
      pages: [
        {
          slug: 'troubleshooting',
          title: 'Troubleshooting',
          description: 'Files from another PC not showing, a file only on this PC, a refused save, a Google account that will not connect, and more.',
          body: "## Troubleshooting\n\n### Other XENO apps say \"Too many requests\" while XENO Storage runs\n\nXENO Storage 0.1.2 and earlier asked XENO about your licence on every action, about 500 times a minute while open, which used up the request limit for everyone on the same network. Install 0.1.3 or later from the [product page](/product/storage). Until then, quitting XENO Storage from the taskbar corner stops it.\n\n### Files added on another PC do not appear\n\nEach PC syncs only while its XENO Storage runs. Check the taskbar corner on both PCs, and the drive's card: it says when it last checked with Google. If that is minutes ago, check the connection. Files added while a PC's XENO Storage was not running upload the next time it runs.\n\n### \"1 file is only on this PC\"\n\nThe drive's card lists files sitting where they cannot be uploaded, such as directly in a Google account's **Shared drives** folder. Move them anywhere else on the drive and they upload.\n\n### Saving into Shared drives says \"Access is denied\"\n\nNothing can be saved directly in **Shared drives**; shared drives are made in Google. Open one of the shared drives and save there.\n\n### Connecting Google says \"That didn't work\"\n\nStart again and, on Google's screen, tick **See, edit, create and delete all of your Google Drive files** before **Continue**. Without that permission the drive could do nothing, so the connection is not made.\n\n### The drive shows my disk's name and size, not the account's\n\nDokany is not installed, or was declined during setup. Run the XENO Storage installer again and accept Dokany, then quit XENO Storage from its icon in the taskbar corner and open it again.\n\n### \"Letter in use\"\n\nAnother drive or a network share already uses that letter. Choose a different free letter.\n\n### The drive is empty\n\nCheck the account in the app first. If the account itself shows no files, the drive is correct. If the app shows files but the drive does not, quit XENO Storage from its icon in the taskbar corner and open it again.\n\n### Sending diagnostics\n\nXENO Storage writes a log of the drive engine to `storage.log` in `%LOCALAPPDATA%\\XENO\\state\\apps\\storage\\electron\\logs\\`. It contains no passwords or tokens. Choose **Save diagnostics…** on a drive's card for a file to send, and include it when you contact XENO support.",
        },
      ],
    },
  ],
};

export default storage;
