import type { ProductContent } from './_types';

/* XENO Photo — sourced from ../xeno-photo (README / CLAUDE / CHANGELOG).
 *
 * READ THIS BEFORE ADDING ANY CAPABILITY CLAIM. Measured 2026-07-27:
 *   the repo is 412 lines of markdown, ONE commit, and ZERO product source
 *   files. Its own README says: "This repository is a **scaffold**. The product
 *   surface and architecture are being defined — nothing here ships yet."
 *   (xeno-layout is byte-for-byte the same scaffold, and has no content module
 *   at all — it renders from the catalog entry alone. Keep it that way.)
 *
 * The status was already right (coming-soon / waitlist). What was wrong was the
 * REGISTER: six feature blocks with four specific bullets each read as a
 * specified product with a designed feature set. There is no spec and no code —
 * only an intent. So the page now states the ambition plainly and says, in the
 * hero and the FAQ, that this is a direction and not a design.
 *
 * Rule: no roadmap dates, no version numbers, and nothing phrased as though a
 * decision has been made, until real code exists in that repo. */
const photo: ProductContent = {
  slug: 'photo',
  hero: {
    headline: 'Every frame, culled and developed — without overwriting a pixel.',
    sub: 'The plan is a photographer-first RAW workspace: import and cull thousands of shots, keyword and organize a real catalog, then develop non-destructively with masks and local adjustments — with AI culling, subject masking and denoise running on-device. This page describes what we intend to build.',
    media: { type: 'mockup', src: 'photo-hero', alt: 'XENO Photo — a concept mockup of the Develop module: catalog and presets, a RAW landscape with an AI sky mask, Basic develop sliders, and a culling filmstrip' },
    badges: ['Planned', 'RAW develop', 'Non-destructive', 'Local-first', 'On-device AI'],
    note: 'Not started. XENO Photo is currently a stated direction, not a product in development: the repository holds documentation only — no application code, and no technical design yet. There is nothing to install, and no date to give you. Join the waitlist and we will tell you when that changes.',
  },
  trust: [
    'No code yet — this is the intent, written down honestly',
    'Planned as local-first: your catalog would live on your disk',
    'Planned to reuse xeno-lib for RAW decode and xeno-rt for on-device AI',
  ],
  highlights: [
    { value: 'Not started', label: 'Docs only — no code yet' },
    { value: 'Non-destructive', label: 'The core commitment' },
    { value: 'On-device AI', label: 'Cull · mask · denoise · upscale' },
    { value: '.xphoto', label: 'Reserved catalog format' },
  ],
  features: [
    {
      eyebrow: 'Planned · Library',
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
      eyebrow: 'Planned · Develop',
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
      eyebrow: 'Planned · AI',
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
      eyebrow: 'Planned · Private',
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
      eyebrow: 'Planned · Output',
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
      { feature: 'Available to use today', xeno: false, them: true },
      { feature: 'Non-destructive RAW develop', xeno: 'Planned', them: true },
      { feature: 'On-device AI culling & masking', xeno: 'Planned', them: 'Add-ons' },
      { feature: 'Local-first, open catalog format', xeno: 'Planned', them: false },
      { feature: 'Mature presets, plugins & ecosystem', xeno: 'Far off', them: true },
      { feature: 'Cloud library & mobile sync', xeno: 'Planned', them: true },
      { feature: 'Price', xeno: 'TBA', them: 'Subscription' },
    ],
  },
  specs: [
    { label: 'Status', value: 'Not started — documentation scaffold only' },
    { label: 'Aims to replace', value: 'Adobe Lightroom' },
    { label: 'Project format', value: '.xphoto (reserved)' },
    { label: 'Inference', value: 'Planned on-device · xeno-rt' },
    { label: 'Availability', value: 'No build, no date' },
  ],
  faq: [
    { q: 'Is XENO Photo available yet?', a: 'No — and to be straight with you, it has not been started. The repository contains documentation and nothing else: no application code, and no technical design. Everything on this page is intent, not implementation, and we would rather you knew that than infer from a polished page that a build is close. Join the waitlist and we will tell you the moment there is something real.' },
    { q: 'Will it read my RAW files?', a: 'That is the intent — RAW decode through the shared xeno-lib native library, with every develop edit non-destructive so your original file is never overwritten. Nothing is implemented yet, so treat this as the commitment we are designing toward rather than a capability you can check.' },
    { q: 'Will my photos leave my machine?', a: 'The plan is local-first: your catalog and originals on your disk, with AI culling, masking, denoise and upscale running on-device through the xeno-rt runtime, and platform sync as an option rather than a requirement. That is a design principle we have committed to, not a shipped behaviour.' },
    { q: 'What is the AI meant to do?', a: 'Suggest which frames to keep (sharp, eyes-open), paint subject and sky masks in one click, and denoise or upscale high-ISO shots — locally, with you approving every pick and every mask. None of it is built yet.' },
    { q: 'Will it replace Adobe Lightroom?', a: 'That is the goal for the non-destructive RAW workflow and library. It is a large goal and we have not written a line of it yet, so please weigh it accordingly. A mature preset and plugin ecosystem, plus cloud/mobile sync, are areas where established tools lead by years.' },
    { q: 'When does it launch, and what will it cost?', a: 'We do not know, and we would rather say so than invent a quarter. No development has started, so there is no schedule to share and no pricing. The waitlist is the way to hear first.' },
  ],
  seo: {
    title: 'XENO Photo — planned RAW workflow & library',
    description: 'A planned photographer-first RAW workspace: cull thousands of frames, keyword a real catalog, and develop non-destructively with on-device AI culling, masking and denoise. Local-first, .xphoto format. Not started — documentation only. Join the waitlist.',
  },
};

export default photo;
