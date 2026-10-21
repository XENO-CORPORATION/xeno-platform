import type { ProductDocs } from './_types';

/* XENO Storage desktop documentation — reconciled against xeno-storage 0.1.0 (Windows). Every claim
 * traces to that release: apps/desktop/src/main/account.ts (sign-in door), mount.ts + mountBroker.ts
 * (drive letters, XENO Connect), crates/storage-mount/src/letter_volume.rs (the letter as its own
 * volume), build/installer.nsh (Dokany), the engine log in storage.log, SPEC §10.3 (measurements).
 * Windows x64 only; no in-app updater in 0.1.0. */
const storage: ProductDocs = {
  slug: 'storage',
  productName: 'XENO Storage',
  tagline: 'Your XENO Storage and your Google Drive accounts as drives on this PC.',
  version: '0.1.0',
  updated: '2026-10-21',
  seo: {
    title: 'XENO Storage documentation',
    description: 'Install XENO Storage on Windows, sign in, mount XENO Storage or a Google Drive account as a drive letter, keep files on this PC, and fix a drive that will not mount.',
  },
  sections: [
    {
      title: 'Getting started',
      pages: [
        {
          slug: 'introduction',
          title: 'Introduction',
          description: 'What XENO Storage does today, and what it does not yet.',
          body: "## Introduction\n\nXENO Storage puts your **XENO Storage** files and each connected **Google Drive** account in File Explorer, each under its own drive letter. Files appear straight away and download when you open them. Folders you choose stay on this PC.\n\n## What it is not yet\n\n- **Windows x64 only.** No macOS or Linux build exists.\n- **Google Drive is the only connected cloud.** OneDrive and Dropbox are not supported yet.\n- **No in-app updater.** Download newer versions from the [product page](/product/storage).\n- **Builds, package installs and games** run much slower from a drive shown with its own name and size (see [Drive letters](/docs/storage/drive-letters)). Keep that kind of work on a local disk.\n\n## Next steps\n\n- [Installation](/docs/storage/installation)\n- [Signing in](/docs/storage/signing-in)\n- [Drive letters](/docs/storage/drive-letters)",
        },
        {
          slug: 'installation',
          title: 'Installation',
          description: 'Download and install XENO Storage 0.1.0 on Windows.',
          body: "## Installation\n\nXENO Storage 0.1.0 is available for **Windows 10 and 11 (x64)**.\n\n1. On the [product page](/product/storage), choose **Download for Windows**.\n2. Run `XENO Storage Setup 0.1.0.exe`. It installs for your user only.\n3. The installer is **not code-signed yet**, so Windows SmartScreen may show *Windows protected your PC*. Choose **More info → Run anyway**. The app says so too: an **Unsigned build** badge sits in its window.\n4. If **Dokany** is not on this PC, the installer offers to install it, and Windows asks once for administrator rights. Dokany is a signed open-source file-system driver; with it, each drive shows its own account's name and space. You can decline: your drives still work and show the name and size of the disk they are on.\n\n## Updates\n\nThere is no in-app updater in 0.1.0. To update, download the new version from the product page and run it.\n\n## Uninstalling\n\nUse **Settings → Apps → XENO Storage → Uninstall**. Your files are not deleted. Dokany stays installed because other software may use it; remove it separately from **Apps** if you no longer need it.",
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
          body: "## Drive letters\n\nEach mounted account gets its own letter in File Explorer's **This PC**, such as **BUNKER CAMP - Google Drive (Z:)**.\n\n1. In XENO Storage, open the account (XENO Storage, or a Google account under **Connected clouds**).\n2. Choose a free **Drive letter** and mount it.\n3. The drive appears in File Explorer. Files show at once and download when you open them.\n\n## Name and size\n\nWith Dokany installed, the drive is its own volume: This PC shows the **account's name** and the **account's total and free space**. Without Dokany, the drive is a plain letter that shows the name and size of the disk its folder is on.\n\n## Speed\n\nWhen a drive shows its own name and size, every file request passes through XENO Storage's drive engine. Measured on Windows 11: large files are 2–6x slower than a local disk (still well over 1 GB/s on a fast SSD), and work on thousands of small files is **5–40x slower**. Opening documents, photos and video is limited by the download, so you will not notice it there. **Do not run builds, `npm install` or games from the drive.**\n\n## Keeping files on this PC\n\nRight-click a file or folder in File Explorer:\n\n- **Always keep on this device** downloads it and keeps it.\n- **Free up space** removes the local copy; the file stays in the cloud.",
        },
        {
          slug: 'connected-clouds',
          title: 'Connected clouds',
          description: 'Connect a Google account and mount it.',
          body: "## Connected clouds\n\n1. Open **Connected clouds** and choose **Add a Google account**.\n2. Your browser opens. Sign in to Google and approve access for **XENO Connect**.\n3. Back in XENO Storage, the account appears with My Drive and your shared drives. Mount it as a [drive letter](/docs/storage/drive-letters).\n\nYour Google tokens are held by **XENO Connect**, not by the app on your PC. XENO Storage asks Connect for each operation and never stores a Google credential.\n\nYou can connect several Google accounts; each becomes its own drive.",
        },
        {
          slug: 'your-data',
          title: 'Your data and privacy',
          description: 'What is uploaded, what stays on this PC, and where it lives.',
          body: "## Your data\n\n- **Changes upload in the background.** Anything still waiting to upload is kept on disk and resumes the next time the drive mounts; closing the app never throws it away.\n- **Local copies** of files you opened or kept are stored on this PC, on the disk you choose in the app.\n- **App data** (settings, the drive engine's index and cache, and the log) lives under `%LOCALAPPDATA%\\XENO\\`.\n- **Google credentials** stay in XENO Connect, never on this PC.\n\n## Removing a drive\n\nUnmounting a drive removes its letter. Files in the cloud are untouched. Local copies stay until you free up space or remove the drive from this PC in the app.",
        },
      ],
    },
    {
      title: 'Help',
      pages: [
        {
          slug: 'troubleshooting',
          title: 'Troubleshooting',
          description: 'A drive that shows the wrong name or size, a letter in use, or an empty drive.',
          body: "## Troubleshooting\n\n### The drive shows my disk's name and size, not the account's\n\nDokany is not installed, or was declined during setup. Run the XENO Storage installer again and accept Dokany, then quit and reopen XENO Storage.\n\n### \"Letter in use\"\n\nAnother drive or a network share already uses that letter. Choose a different free letter.\n\n### The drive is empty\n\nCheck the account in the app first. If the account itself shows no files, the drive is correct. If the app shows files but the drive does not, quit and reopen XENO Storage.\n\n### Sending diagnostics\n\nXENO Storage writes a log of the drive engine to `storage.log` in `%LOCALAPPDATA%\\XENO\\state\\apps\\storage\\electron\\logs\\`. It contains no passwords or tokens. Include it when you contact XENO support.",
        },
      ],
    },
  ],
};

export default storage;
