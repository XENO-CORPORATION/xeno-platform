import type { ProductContent } from './_types';

/* XENO View desktop: sourced from ../xeno-view at the 0.2.1 release. src/main/index.ts (door, file dialog, clipboard),
 * src/main/fileScanner.ts (the 24 extensions, natural sibling order), src/main/escalation.ts (Pixel, Motion, Sound,
 * Form), src/main/aiEdit.ts (AI Restyle through the door), src/main/updater.ts (gated in-app updates), the renderer
 * components (ImageViewer, VideoPlayer, AudioPlayer, ModelViewer, Inspector) and electron-builder.yml (associations).
 *
 * HONESTY CONTRACT for this page:
 *  · Windows x64 only. Unsigned and experimental.
 *  · Viewing happens on this PC. Only AI Restyle sends anything, and only the image being restyled.
 *  · Video plays what the built-in Chromium engine decodes. It is not a codec pack: a MOV, MKV or AVI with another codec
 *    will not play. Do not imply otherwise.
 *  · The installer registers the file types; Windows keeps the person's default until they change it. */
const view: ProductContent = {
  slug: 'view',
  hero: {
    headline: 'Double-click anything. It just opens.',
    sub: 'XENO View is one Windows app for your images, video, audio and 3D models. Arrow keys walk the folder, and one click sends a file to the XENO app that can change it.',
    media: { type: 'image', src: '/product-icons/svg/xeno-view.svg', alt: 'The XENO View app icon' },
    badges: ['Windows', 'Experimental', 'Unsigned build', 'XENO account'],
    note: 'Experimental · v0.2.1 · Windows x64 only. Updates itself.',
  },
  trust: [
    'Viewing happens on this PC: your files stay where they are',
    'AI Restyle never touches the original until you save',
    'An UNSIGNED BUILD badge sits in the window until the installer is signed',
  ],
  highlights: [
    { value: '24', label: 'File types, across four kinds' },
    { value: 'Arrows', label: 'Walk every file in the folder, in natural order' },
    { value: 'Details', label: 'Dimensions, format and a live RGB histogram' },
    { value: 'Windows', label: '10 and 11, x64' },
  ],
  features: [
    {
      eyebrow: 'Open',
      icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(223,215,70,0.14), transparent 60%), linear-gradient(165deg,#15161a,#070707 74%)',
      title: 'One window for all of it',
      desc: 'Images with pan, zoom, fit and rotate. Video with a timeline, speed from 0.5x to 2x and single-frame steps. Audio with a frequency view. 3D models you can orbit, spin and shade, with live polygon counts.',
      bullets: ['PNG, JPG, WEBP, GIF, SVG, BMP, ICO, AVIF', 'MP4, WEBM, MOV, MKV, AVI', 'MP3, WAV, OGG, FLAC, M4A, AAC', 'GLB, GLTF, OBJ, STL'],
    },
    {
      eyebrow: 'Walk',
      icon: 'Gauge',
      accent: 'radial-gradient(ellipse at 28% 30%, rgba(223,215,70,0.12), transparent 60%), linear-gradient(165deg,#141417,#070707 74%)',
      title: 'The whole folder, one key at a time',
      desc: 'The left and right arrows move through every viewable file beside the one you opened, in the order you would expect: img1, img2, img10. The filmstrip shows where you are.',
    },
    {
      eyebrow: 'Hand off',
      icon: 'Network',
      accent: 'radial-gradient(ellipse at 50% 20%, rgba(223,215,70,0.10), transparent 60%), linear-gradient(165deg,#131316,#070707 74%)',
      title: 'Open it where it can be changed',
      desc: 'One click sends the file to XENO Pixel, Motion, Sound or Form when that app is installed. Or restyle an image with AI: each result is a new version beside the original, and your file is untouched until you save a copy or replace it. AI Restyle runs on your XENO account and uses credits.',
    },
  ],
  howItWorks: [
    { step: '1', title: 'Install', desc: 'Run the installer. Choose where it goes; it can install for your user, with no administrator rights.' },
    { step: '2', title: 'Sign in', desc: 'Sign in with your XENO account in the browser.' },
    { step: '3', title: 'Open a file', desc: 'Choose XENO View in Open with, or drop a file on the window. Then use the arrow keys.' },
  ],
  specs: [
    { label: 'Platform', value: 'Windows 10/11, x64' },
    { label: 'File types', value: '24, across images, video, audio and 3D models' },
    { label: 'Default apps', value: 'Registered as an option. Windows keeps your default until you change it' },
    { label: 'Project file', value: 'None: View opens your files and keeps no format of its own' },
    { label: 'Updates', value: 'In the app: it downloads the new version and asks before restarting' },
  ],
  faq: [
    { q: 'Do I need a XENO account?', a: 'Yes. View opens behind your XENO account like every XENO desktop app, and the account decides whether this copy may run.' },
    { q: 'Does View upload my files?', a: 'No. Viewing happens on this PC. The one exception is AI Restyle, which sends the image you are restyling to XENO when you press the button, because that is where the model runs.' },
    { q: 'Why does Windows warn when I install it?', a: 'The installer is not code-signed yet, so SmartScreen may show “Windows protected your PC”. Choose More info → Run anyway. The app says the same: an UNSIGNED BUILD badge sits in its window.' },
    { q: 'Which videos will it play?', a: 'Whatever the built-in Chromium engine decodes. MP4 and WebM with common codecs work. A MOV, MKV or AVI file using a codec the engine does not know will not play; View is not a codec pack.' },
    { q: 'macOS or Linux?', a: 'Not yet. This release is Windows x64 only.' },
  ],
  autoUpdates: true,
};

export default view;
