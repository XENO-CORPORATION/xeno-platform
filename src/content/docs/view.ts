import type { ProductDocs } from './_types';

/* XENO View desktop documentation: reconciled against xeno-view 0.2.1 (Windows), 2026-10-31. Every claim traces to that
 * release: src/main/index.ts (door, open dialog, clipboard, window), fileScanner.ts (extensions, natural order),
 * escalation.ts (Pixel, Motion, Sound, Form), aiEdit.ts (AI Restyle through the door, .bak on replace), updater.ts
 * (gated updates, 30-minute check), src/renderer/src/App.tsx (the keyboard table), electron-builder.yml (installer and
 * associations) and logger.ts. Windows x64 only. */
const view: ProductDocs = {
  slug: 'view',
  productName: 'XENO View',
  tagline: 'One Windows app for your images, video, audio and 3D models.',
  version: '0.2.1',
  updated: '2026-10-31',
  seo: {
    title: 'XENO View documentation',
    description: 'Install XENO View on Windows, sign in, make it your viewer, walk a folder with the keyboard, inspect a file, restyle an image with AI, and fix a file that will not open.',
  },
  sections: [
    {
      title: 'Getting started',
      pages: [
        {
          slug: 'introduction',
          title: 'Introduction',
          description: 'What XENO View does today, and what it does not yet.',
          body: "## Introduction\n\nXENO View opens your images, video, audio and 3D models in one window. It works on your files where they are: it keeps no library and saves no format of its own.\n\n| Kind | File types | What you can do |\n|---|---|---|\n| **Images** | PNG, JPG, JPEG, WEBP, GIF, SVG, BMP, ICO, AVIF | Pan, zoom, fit, actual pixels, rotate, see a live RGB histogram |\n| **Video** | MP4, WEBM, MOV, MKV, AVI | Scrub, change speed from 0.5x to 2x, step one frame at a time |\n| **Audio** | MP3, WAV, OGG, FLAC, M4A, AAC | Play with a frequency view, a timeline and volume |\n| **3D models** | GLB, GLTF, OBJ, STL | Orbit, pan, spin, shade, show a ground grid, see polygon counts |\n\n## What it is not yet\n\n- **Windows x64 only.** No macOS or Linux build exists.\n- **Not an editor.** To change a file, send it to XENO Pixel, Motion, Sound or Form. See [Opening in other apps](/docs/view/opening-in-other-apps).\n- **Not a codec pack.** Video plays what the built-in Chromium engine decodes. See [Troubleshooting](/docs/view/troubleshooting).\n\n## Next steps\n\n- [Installation](/docs/view/installation)\n- [Signing in](/docs/view/signing-in)\n- [Viewing files](/docs/view/viewing-files)",
        },
        {
          slug: 'installation',
          title: 'Installation',
          description: 'Download and install XENO View 0.2.1 on Windows, and make it your viewer.',
          body: "## Installation\n\nXENO View 0.2.1 is available for **Windows 10 and 11 (x64)**.\n\n1. On the [product page](/product/view), choose **Download for Windows**.\n2. Run `XENO View Setup 0.2.1.exe` and choose where to install it.\n3. The installer is **not code-signed yet**, so Windows SmartScreen may show *Windows protected your PC*. Choose **More info → Run anyway**. The app says so too: an **UNSIGNED BUILD** badge sits in its window.\n\n## Make it your viewer\n\nThe installer registers XENO View for all 24 file types, but Windows keeps your current default until you change it.\n\n- For one file type: right-click a file, choose **Open with → Choose another app**, pick **XENO View** and choose **Always**.\n- For many: **Settings → Apps → Default apps → XENO View**.\n\n## Updates\n\nFrom 0.2.1, XENO View keeps itself up to date while you are signed in with a plan that includes updates. It checks shortly after it starts and every 30 minutes, downloads a new version in the background and checks it against the published fingerprint. When it is ready it asks whether to restart now; if you choose **Later**, it installs the next time you quit. It never installs an older version.\n\nCopies of 0.1.0 cannot update themselves: install 0.2.1 once from the product page, over the top.\n\n## Uninstalling\n\nUse **Settings → Apps → XENO View → Uninstall**. Your files are not touched.",
        },
        {
          slug: 'signing-in',
          title: 'Signing in',
          description: 'XENO View opens only for a signed-in XENO account the platform allows.',
          body: "## Signing in\n\nXENO View opens on a sign-in screen. Choose **Sign in**; your browser opens to finish signing in with your XENO account. XENO View never sees your password, and it asks again only when the session ends.\n\nIf you double-clicked a file, it opens as soon as you are through.\n\n## What the sign-in screen can say\n\n| Screen | What it means | What to do |\n|---|---|---|\n| **Sign in** | No account is signed in on this PC | Sign in |\n| **No access** | The platform has not granted this account access to XENO View | Check your plan in your XENO account |\n| **Update required** | This version is too old for the platform | Download the latest version from the product page |\n| **Unavailable** | This PC has no secure place to keep the session, or the service could not be reached | Check your connection and try again |\n\nIf you lose your connection, a session that was already approved keeps working for a limited time.",
        },
      ],
    },
    {
      title: 'Using it',
      pages: [
        {
          slug: 'viewing-files',
          title: 'Viewing files',
          description: 'Open files, walk a folder, inspect a file and copy it.',
          body: "## Opening a file\n\nDouble-click a file XENO View is the default for, use **Open with**, press `Ctrl O`, or drop a file on the window.\n\n## Walking the folder\n\nThe left and right arrow keys, the toolbar arrows and the filmstrip move through every file XENO View can open in the same folder. The order is natural: `img1`, `img2`, `img10`.\n\n## Details\n\nPress `I` for the Details panel: dimensions, megapixels and aspect ratio for an image, then format, size, date changed and folder. For an image it also shows a live RGB histogram worked out from the picture itself.\n\n## Copying\n\n- `Ctrl C` copies the image itself, ready to paste into a chat, a document or an editor.\n- `Ctrl Shift C` copies the file's full path.\n\nWhen an AI version is on screen, that version is what is copied. For WebP, AVIF and SVG, the copy is decoded at up to 4096 pixels.\n\n## Light and dark\n\nXENO View follows the Windows light or dark setting.",
        },
        {
          slug: 'keyboard',
          title: 'Keyboard',
          description: 'Every key XENO View responds to.',
          body: "## Keyboard\n\n| Key | Does |\n|---|---|\n| `←` `→` | Previous or next file in the folder |\n| `Ctrl O` | Open a file |\n| `I` | Details panel |\n| `Ctrl C` | Copy the image |\n| `Ctrl Shift C` | Copy the file's path |\n| `Ctrl E` | Open or close AI Restyle on an image |\n| `Ctrl R` | Rotate an image |\n| `0` | Fit an image to the window |\n| `1` | Show an image at actual pixels |\n| `+` `-` | Zoom an image in or out |\n| `F` | Show or hide the filmstrip |\n| `F11` | Full screen |\n| `Space` | Play or pause; spin a 3D model |\n| `\\` | Hold to compare an AI version with the original |\n| `Esc` | Close the open panel first, then leave full screen |",
        },
        {
          slug: 'opening-in-other-apps',
          title: 'Opening in other apps',
          description: 'Send a file to XENO Pixel, Motion, Sound or Form.',
          body: "## Opening in other apps\n\nThe toolbar and the Details panel offer the XENO app for the kind of file you are looking at:\n\n| File | Opens in |\n|---|---|\n| Images | XENO Pixel |\n| Video | XENO Motion |\n| Audio | XENO Sound |\n| 3D models | XENO Form |\n\nThe app has to be installed on this PC. You can also show the file in its folder.",
        },
        {
          slug: 'ai-restyle',
          title: 'AI Restyle',
          description: 'Restyle an image with AI, compare, and keep or discard the result.',
          body: "## AI Restyle\n\nOpen an image and choose **AI Restyle**. Describe the look you want, or start from one of the suggestions, and each result arrives as a new version beside the original.\n\n- **Your file is untouched** until you choose **Save as copy** or **Replace original**.\n- **Save as copy** writes `name_edit_1.png` beside the original.\n- **Replace original** first keeps the old file as `name.png.bak`, once, and then replaces it.\n- **Hold to compare** shows the original while you hold it down.\n\n## What it costs and what it sends\n\nAI Restyle runs on your XENO account and **uses credits**. A result usually takes about 45 seconds.\n\nThis is the one thing in XENO View that sends a file anywhere: the image you are restyling goes to XENO when you press the button, because that is where the model runs. Versions you have not saved stay in a cache on this PC.",
        },
      ],
    },
    {
      title: 'Help',
      pages: [
        {
          slug: 'your-data',
          title: 'Your data and privacy',
          description: 'What stays on this PC, and what leaves it.',
          body: "## Your data\n\n- **Your files** stay where they are. XENO View reads them to show them.\n- **Thumbnails and AI versions** are kept in a cache under `%APPDATA%\\xeno-view\\`.\n- **Your session** is kept encrypted by Windows. The sign-in log, `auth.log`, records the steps of signing in and never a token, code, password or email.\n- **AI Restyle** sends the image you are restyling to XENO when you press the button. Nothing else in the app sends a file.\n- **Each request to XENO names this version of the app**, so the platform can tell you when an update is required.",
        },
        {
          slug: 'troubleshooting',
          title: 'Troubleshooting',
          description: 'A video that will not play, a file that does not open in View, a refused sign-in and more.',
          body: "## Troubleshooting\n\n### A video will not play\n\nVideo plays through the built-in Chromium engine. MP4 and WebM with common codecs work. A MOV, MKV or AVI file using a codec the engine does not know will not play. Open it in XENO Motion or convert it.\n\n### Double-clicking a file opens another app\n\nWindows keeps your default until you change it. See [Make it your viewer](/docs/view/installation).\n\n### Windows protected your PC\n\nThe installer is not code-signed yet. Choose **More info → Run anyway**.\n\n### The sign-in page does not come back to the app\n\nThe browser returns to XENO View on this PC through a local address. Keep the app open, finish signing in, and allow the local connection if your security software asks. If it fails, choose **Sign in** again.\n\n### It says Update required\n\nThis version is too old for the platform. Download the latest from the [product page](/product/view).\n\n### AI Restyle says to sign in, or fails\n\nThe session may have ended: quit and reopen XENO View. If your account is out of credits, the message says so.\n\n### Open in Pixel does nothing\n\nThat app has to be installed on this PC.\n\n### Something else went wrong\n\nA log is kept at `%APPDATA%\\xeno-view\\logs\\`. Include it when you [contact support](/workspace/support/new).",
        },
        {
          slug: 'release-history',
          title: 'Release history',
          description: 'Where to find every version of XENO View.',
          body: "## Release history\n\nEvery published version, its date and its notes are on the [releases page](/product/view/releases).",
        },
      ],
    },
  ],
};

export default view;
