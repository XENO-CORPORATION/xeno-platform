import type { ProductContent } from './_types';

/* XENO Pixel — sourced from ../xeno-pixel (README + the real renderer under
 * src/renderer/src: App.tsx layout, ToolsSidebar, LayersPanel, AgentPanel).
 * A `delivery: desktop` product: CTA is the download deep-link + releases.
 * Honest beta framing — the editor runs on Windows today; some AI features
 * route to the cloud (credits). Raster + vector in one app, GPU-accelerated,
 * on-device AI, non-destructive parametric editing. */
const pixel: ProductContent = {
  slug: 'pixel',
  hero: {
    headline: 'Photoshop and Illustrator, rebuilt around AI.',
    sub: 'One editor for raster and vector — GPU-accelerated, non-destructive, and AI-native. Select a subject in one click, remove backgrounds and upscale on-device, and hand whole jobs to an agent. Now in beta on Windows.',
    media: { type: 'mockup', src: 'pixel-hero', alt: 'XENO Pixel editor — a portrait with an AI subject selection, the Layers panel, and an agent removing the background and upscaling' },
    badges: ['Windows desktop', 'GPU-accelerated', 'On-device AI', 'Raster + vector'],
    note: 'Free beta · on-device AI runs locally; generative fill and cloud models use credits.',
  },
  trust: ['Part of the XENO platform — one sign-in', 'Open standards: ACES 2.0 color · OKLCH · WASM plugins', 'On-device AI — your images stay on your machine'],
  highlights: [
    { value: 'Raster + vector', label: 'One unified app' },
    { value: '1-click subject', label: 'SAM2 select, on-device' },
    { value: 'Non-destructive', label: 'Parametric edit graph' },
    { value: '< 800ms', label: 'Cold-start to editing' },
  ],
  features: [
    {
      eyebrow: 'AI-native', icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'AI where you edit, not in a separate tool',
      desc: 'Segment, clean up, and enlarge with models that run on your GPU — no upload, no wait for a round-trip. Reach for the cloud only when you want generative fill.',
      bullets: [
        'Select Subject in one click (SAM2, ~50ms per click)',
        'Remove Background (RMBG-2.0) and Object Removal (LaMa)',
        'Upscale 4× (Real-ESRGAN) and denoise (NAFNet) on-device',
        'Generative fill via the cloud when you need it (SDXL / FLUX.2)',
      ],
    },
    {
      eyebrow: 'One canvas', icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Raster and vector in the same document',
      desc: 'Paint, retouch, draw bézier paths, set OpenType text, and build shapes side by side — no jumping between two apps to finish one design.',
      bullets: [
        'Stamp-based brush engine with < 4ms latency and tablet pressure/tilt',
        'Pen tool, boolean shape ops, and smart snapping',
        'Full OpenType text with variable fonts and text-on-path',
        'Import PSD, AVIF/HEIF/WebP, EXR and SVG',
      ],
    },
    {
      eyebrow: 'Non-destructive', icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'Every edit stays re-editable',
      desc: 'Adjustment layers, smart objects, masks and filters are a parametric operation graph — change any step later without starting over.',
      bullets: [
        'Curves, Levels, Hue/Sat as live 1D/3D-LUT adjustment layers',
        'Smart objects re-rasterize from the original on every change',
        'Layer, vector and clipping masks; 27 blend modes',
        'Full undo history and serializable parameter snapshots',
      ],
    },
    {
      eyebrow: 'Performance', icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'A WebGPU engine, not a web page',
      desc: 'Compositing, filters and brush stamps run as WebGPU compute shaders, with the heavy pixel math in Rust/WASM + SIMD. It opens fast and stays fast.',
      bullets: [
        'All 27 blend modes composited on the GPU',
        'Separable blur, sharpen and color as compute shaders',
        'Rust/WASM pixel core — 4K blur in ~15ms',
        'Under 800ms from launch to a live canvas',
      ],
    },
    {
      eyebrow: 'Agent', icon: 'Bot',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.15), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'Hand whole jobs to an agent',
      desc: 'Describe the outcome and let the built-in agent drive the tools — select, filter, export — across one image or a whole folder.',
      bullets: [
        '“Remove the background and upscale to 4K”',
        '“Apply brand colors to this design using the style guide”',
        'Batch the same edit across 50 images',
        'Part of the cross-app XENO agent workflows',
      ],
    },
    {
      eyebrow: 'Open by design', icon: 'Globe',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Open standards and an open plugin model',
      desc: 'A modern, standards-based color pipeline and a plugin system any language can target — no proprietary lock-in on your files or your extensions.',
      bullets: [
        'ACES 2.0 + OKLCH color, ICC v4 via lcms, HDR output',
        'Soft-proofing with CMYK simulation on the GPU',
        'WASM-sandboxed plugins (write them in any language)',
        'The .xpixel project format is documented and open',
      ],
    },
  ],
  useCases: [
    { title: 'Photographers & retouchers', icon: 'Sparkles', desc: 'Cut out a subject in a click, remove distractions, upscale, and grade — non-destructively, with the originals untouched on your machine.' },
    { title: 'Designers', icon: 'Boxes', desc: 'Composite raster art, vector shapes and OpenType text in one document instead of bouncing a file between a photo editor and an illustrator.' },
    { title: 'Batch & agent workflows', icon: 'Bot', desc: 'Point the agent at a folder and let it run the same edit across every image — background removed, resized and exported per format.' },
    { title: 'Private & on-device', icon: 'Lock', desc: 'Segmentation, background removal and upscaling run locally on your GPU — nothing leaves the machine unless you choose a cloud model.' },
  ],
  howItWorks: [
    { step: '1', title: 'Download & sign in', desc: 'Get the Windows app and sign in with your XENO account for credits and cloud models.' },
    { step: '2', title: 'Open or create', desc: 'Drag in a PSD, PNG or RAW, or start a new document — GPU canvas ready in under a second.' },
    { step: '3', title: 'Edit or delegate', desc: 'Use the tools yourself, or ask the agent to select, clean up, upscale and export for you.' },
  ],
  comparison: {
    competitor: 'most image editors',
    rows: [
      { feature: 'Raster + vector in one app', xeno: true, them: 'Two apps' },
      { feature: 'One-click AI subject select, on-device', xeno: true, them: 'Cloud / add-on' },
      { feature: 'GPU-accelerated (WebGPU compute)', xeno: true, them: 'Partial' },
      { feature: 'Non-destructive parametric edit graph', xeno: true, them: 'Smart objects' },
      { feature: 'Open color pipeline (ACES 2.0 · OKLCH)', xeno: true, them: false },
      { feature: 'Mature ecosystem, plugins & tutorials', xeno: 'Growing', them: true },
      { feature: 'Price', xeno: 'Free beta + credits', them: 'Subscription' },
    ],
  },
  specs: [
    { label: 'Platform', value: 'Windows (x64)' },
    { label: 'Engine', value: 'Electron 34 · WebGPU · Rust/WASM' },
    { label: 'On-device AI', value: 'SAM2 · RMBG-2.0 · Real-ESRGAN · LaMa' },
    { label: 'Status', value: 'Beta' },
  ],
  faq: [
    { q: 'Is XENO Pixel ready for production?', a: 'It’s a beta. The core editor — raster + vector tools, layers, masks, adjustments, 27 blend modes, PSD/AVIF/EXR/SVG import and the on-device AI features — works on Windows today. Expect rough edges as we harden it toward 1.0.' },
    { q: 'Which AI features run on my machine vs the cloud?', a: 'Subject selection (SAM2), background removal (RMBG-2.0), upscaling (Real-ESRGAN), denoise (NAFNet) and object removal (LaMa) run on-device on your GPU. Generative fill and advanced inpainting use the cloud (SDXL / FLUX.2) and consume credits.' },
    { q: 'Can it open my Photoshop files?', a: 'Yes — Pixel imports PSD (via ag-psd) along with AVIF/HEIF/WebP, EXR and SVG. Its own project format is .xpixel (earlier v0.3.0 builds wrote .xeno-pixel, still readable).' },
    { q: 'Does it really do both raster and vector?', a: 'Yes. A stamp-based brush engine and pixel layers sit in the same document as bézier pen paths, boolean shape ops and full OpenType text — no separate illustration app.' },
    { q: 'What does the agent do?', a: 'It can drive Pixel’s tools programmatically — select, apply filters, remove backgrounds, upscale and export — for a single image or a whole folder, and it plugs into cross-app XENO workflows (e.g. Pixel → Motion → Sound).' },
    { q: 'How much does it cost?', a: 'The beta is free to use. On-device AI is free; cloud generative features and other XENO cloud models draw from platform credits. General-release pricing will be announced later.' },
  ],
  seo: {
    title: 'XENO Pixel — AI-native image & vector editor',
    description: 'A GPU-accelerated image and vector editor with on-device AI: one-click subject select, background removal and upscaling, non-destructive parametric layers, and an agent that edits for you. Free beta on Windows.',
  },
};

export default pixel;
