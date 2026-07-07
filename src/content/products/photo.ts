import type { ProductContent } from './_types';

/* XENO Photo — sourced from ../xeno-photo (README / CLAUDE / CHANGELOG).
 * The repo is a scaffold (v0.0.1, 2026-06-05): non-destructive RAW workflow &
 * library, the XENO answer to Adobe Lightroom. CREATE layer, format .xphoto,
 * local-first, RAW decode via xeno-lib, all AI inference on-device via xeno-rt.
 * Status is coming-soon → honest waitlist framing: nothing ships yet, every
 * "AI/develop" capability is described as the intended surface, not a shipped one. */
const photo: ProductContent = {
  slug: 'photo',
  hero: {
    headline: 'Every frame, culled and developed — without overwriting a pixel.',
    sub: 'XENO Photo is a photographer-first RAW workspace: import and cull thousands of shots, keyword and organize a real catalog, then develop non-destructively with masks and local adjustments — with AI culling, subject masking and denoise running on-device. In development now.',
    media: { type: 'mockup', src: 'photo-hero', alt: 'XENO Photo — the Develop module: catalog and presets, a RAW landscape with an AI sky mask, Basic develop sliders, and a culling filmstrip' },
    badges: ['RAW develop', 'Non-destructive', 'Local-first', 'On-device AI', 'Coming soon'],
    note: 'In development — no build ships yet. Join the waitlist to get the first release.',
  },
  trust: [
    'Part of the XENO platform — one sign-in',
    'Local-first: your catalog lives on your disk',
    'RAW decode via xeno-lib · AI on-device via xeno-rt',
  ],
  highlights: [
    { value: 'Non-destructive', label: 'Every edit stays reversible' },
    { value: 'RAW-native', label: 'Decoded through xeno-lib' },
    { value: 'On-device AI', label: 'Cull · mask · denoise · upscale' },
    { value: '.xphoto', label: 'Your catalog, an open format' },
  ],
  features: [
    {
      eyebrow: 'Library',
      icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'A real catalog, built for thousands of frames',
      desc: 'Import, stack, keyword and rate — a proper library that treats a full shoot as one workspace, not a folder of files.',
      bullets: [
        'Import RAW + JPEG and build a browsable catalog',
        'Folders, collections and a keyword library',
        'Flags, star ratings and color labels',
        'Filmstrip culling with a loupe and compare view',
      ],
    },
    {
      eyebrow: 'Develop',
      icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Develop RAW without ever overwriting the original',
      desc: 'Every adjustment is an instruction stacked on top of the RAW — exposure, color, tone curves and local masks you can dial back at any time.',
      bullets: [
        'White balance, exposure, contrast and tone',
        'Masks and local adjustments (subject, sky, brush)',
        'Crop, straighten and lens corrections',
        'Full edit history you can step back through',
      ],
    },
    {
      eyebrow: 'AI',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'AI that culls the set and masks the subject',
      desc: 'Let it flag the sharp, eyes-open keepers and paint a subject or sky mask in one click — then you make the final calls.',
      bullets: [
        'Auto-cull suggestions across a shoot',
        'One-click subject and sky masking',
        'Denoise and upscale for high-ISO frames',
        'Runs locally via xeno-rt — you approve every pick',
      ],
    },
    {
      eyebrow: 'Private',
      icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.14), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'Your photos never have to leave your machine',
      desc: 'RAW decode and AI inference run locally through the shared XENO runtime — no upload required to develop, mask or denoise.',
      bullets: [
        'Local-first catalog and originals',
        'On-device inference through xeno-rt',
        'Color-managed develop pipeline',
        'Optional platform sync (planned)',
      ],
    },
    {
      eyebrow: 'Output',
      icon: 'Zap',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'Develop one, apply it to the whole set',
      desc: 'Copy a develop recipe across a selection and export a color-managed batch in a single pass.',
      bullets: [
        'Sync settings across selected frames',
        'Reusable develop presets',
        'Batch export to JPEG, TIFF and PNG',
        'Color-managed output, resize and watermark',
      ],
    },
  ],
  useCases: [
    { title: 'Wedding & event shooters', icon: 'Zap', desc: 'Cull a thousand-frame day down to the keepers fast, then batch-develop the whole set in one consistent pass.' },
    { title: 'Portrait & studio retouchers', icon: 'Sparkles', desc: 'One-click subject masks and non-destructive local adjustments — dial skin, eyes and background separately, and reversibly.' },
    { title: 'Landscape & travel', icon: 'Globe', desc: 'Sky masks, color-managed RAW develop and on-device denoise for high-ISO frames — all without uploading a thing.' },
  ],
  howItWorks: [
    { step: '1', title: 'Import your shoot', desc: 'Point XENO Photo at a card or folder; it decodes the RAW and builds a catalog.' },
    { step: '2', title: 'Cull & develop', desc: 'Flag the keepers with AI suggestions, then develop non-destructively with masks and local adjustments.' },
    { step: '3', title: 'Sync & export', desc: 'Copy the develop recipe across the set and export a color-managed batch.' },
  ],
  comparison: {
    competitor: 'most photo catalogs',
    rows: [
      { feature: 'Non-destructive RAW develop', xeno: true, them: true },
      { feature: 'On-device AI culling & masking', xeno: 'Built in', them: 'Add-ons' },
      { feature: 'Local-first, open catalog format', xeno: true, them: false },
      { feature: 'Runs fully offline', xeno: 'On-device', them: false },
      { feature: 'Mature presets, plugins & ecosystem', xeno: 'Coming', them: true },
      { feature: 'Cloud library & mobile sync', xeno: 'Planned', them: true },
      { feature: 'Price', xeno: 'TBA', them: 'Subscription' },
    ],
  },
  specs: [
    { label: 'Replaces', value: 'Adobe Lightroom' },
    { label: 'Project format', value: '.xphoto' },
    { label: 'Inference', value: 'On-device · xeno-rt' },
    { label: 'Status', value: 'In development' },
  ],
  faq: [
    { q: 'Is XENO Photo available yet?', a: 'Not yet. The repository is an early scaffold (v0.0.1) and no build ships today. This page describes the product we’re building — join the waitlist and you’ll get the first release.' },
    { q: 'Will it read my RAW files?', a: 'Yes — RAW decode runs through the shared xeno-lib native library, and every develop edit is non-destructive: your original file is never overwritten.' },
    { q: 'Do my photos leave my machine?', a: 'No. XENO Photo is local-first: your catalog and originals stay on your disk, and AI culling, masking, denoise and upscale run on-device through the xeno-rt runtime. Platform sync is planned as an option, not a requirement.' },
    { q: 'What does the AI actually do?', a: 'It suggests which frames to keep (sharp, eyes-open), paints subject and sky masks in one click, and denoises or upscales high-ISO shots — all locally. You approve every pick and every mask.' },
    { q: 'Will it replace Adobe Lightroom?', a: 'That’s the goal for the non-destructive RAW workflow and library. A mature preset and plugin ecosystem, plus cloud/mobile sync, are areas where established tools still lead — we’re honest that those come later.' },
    { q: 'When does it launch, and what will it cost?', a: 'Timing and pricing will be announced later. The waitlist is the way to hear first.' },
  ],
  seo: {
    title: 'XENO Photo — non-destructive RAW workflow & library',
    description: 'A photographer-first RAW workspace: cull thousands of frames, keyword a real catalog, and develop non-destructively with on-device AI culling, masking and denoise. Local-first, .xphoto format. In development — join the waitlist.',
  },
};

export default photo;
