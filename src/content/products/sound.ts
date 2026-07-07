import type { ProductContent } from './_types';

/* XENO Sound — sourced from ../xeno-sound (README + the real renderer under
 * src/renderer/src: App, TransportBar, Timeline, Mixer, EffectsRack, SessionView,
 * PatternEditor, plus the engine dirs synth/instruments/dsp/ai/analysis/spatial).
 * Honest beta framing: v0.2.0 desktop, proprietary. Claims are drawn from code
 * that actually ships — subtractive synth + sampler + drum machine, Parametric
 * EQ / Compressor / Reverb / Delay, RNNoise denoise, HTDemucs stems, Whisper
 * transcription, auto-master, EBU R128 metering — not from the roadmap wishlist. */
const sound: ProductContent = {
  slug: 'sound',
  hero: {
    headline: 'From first beat to final master.',
    sub: 'A full-spectrum audio workstation — beat-making, recording, mixing, sound design and broadcast mastering in one desktop app. Linear Arrangement and clip-grid Session in the same project, built-in synths and samplers, a Rust→WASM DSP engine, and AI that denoises, splits stems, transcribes and masters. Now in public beta.',
    media: { type: 'mockup', src: 'sound-hero', alt: 'XENO Sound DAW — transport, multi-track timeline with waveform clips, effects rack and mixer' },
    badges: ['Windows · macOS · Linux', 'Arrangement + Session', 'AI-native', 'Free public beta'],
    note: 'Public beta (v0.2.0) · desktop. The core DAW works today; some instruments and effects are still landing and the .xsound format may still change.',
  },
  trust: ['Part of the XENO platform — one sign-in', 'Rust→WASM DSP — native speed, no GC pauses', 'AI runs locally or in the cloud — your choice'],
  highlights: [
    { value: 'Two modes', label: 'Arrangement + Session' },
    { value: 'Native-speed DSP', label: 'Rust → WASM engine' },
    { value: 'AI-native', label: 'Denoise · stems · transcribe' },
    { value: 'EBU R128', label: 'True-peak mastering' },
  ],
  features: [
    {
      eyebrow: 'Two modes',
      icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.16), transparent 60%), linear-gradient(165deg,#0f1719,#070707 74%)',
      title: 'Arrangement and Session — one project, one engine',
      desc: 'A linear timeline for recording, editing and mixing, and an Ableton-style clip grid for beats and live sets. Switch views without switching apps.',
      bullets: [
        'Multi-track timeline with waveform clips + automation lanes',
        'Session clip grid with scenes, launch quantization & follow actions',
        'FL-style pattern clips and a 16/32/64-step sequencer',
        'Live looping, MIDI mapping and a full-screen performance mode',
      ],
    },
    {
      eyebrow: 'Make music',
      icon: 'Music',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.20), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Instruments and sequencers built in',
      desc: 'A subtractive synth, a multi-layer sampler and a drum machine — driven by a piano roll and step sequencer. Start writing without hunting for third-party plugins.',
      bullets: [
        'Subtractive synth: oscillators, filter, envelopes and LFO',
        'Multi-layer sampler with velocity zones + one-shot drum pads',
        'Piano roll, step sequencer, arpeggiator and chord tools',
        'Sample & preset browser with preview',
      ],
    },
    {
      eyebrow: 'Edit & mix',
      icon: 'SlidersHorizontal',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'Editing and mixing that hold up in a studio',
      desc: 'Waveform and spectral editing, a channel-strip mixer with sends, and a Rust DSP effect rack — Parametric EQ, Compressor, Reverb and Delay, with sidechain and automation.',
      bullets: [
        'Waveform + spectral editing, comping, time-stretch & warp',
        'Channel-strip mixer: faders, pan, sends, stereo metering',
        'Parametric EQ · Compressor · Convolution/Algorithmic Reverb · Stereo Delay',
        'Sidechain routing, group tracks and recallable mixer scenes',
      ],
    },
    {
      eyebrow: 'AI-native',
      icon: 'Sparkles',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.16), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'AI that does the tedious audio work',
      desc: 'Clean up a recording, pull a song apart, get a transcript, or hand the master to an assistant — from the AI menu or the built-in agent panel.',
      bullets: [
        'Noise reduction (RNNoise real-time; deeper cleanup offline)',
        'Stem separation into vocals, drums, bass and other (HTDemucs)',
        'Speech-to-text transcription with timestamps (Whisper)',
        'Auto-master to a target LUFS, plus chord & pitch detection',
      ],
    },
    {
      eyebrow: 'Master & measure',
      icon: 'Gauge',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'Finish loud, legal and level',
      desc: 'Full EBU R128 loudness metering and true-peak limiting so your mix hits the right target for streaming, broadcast or podcast — with the numbers to prove it.',
      bullets: [
        'EBU R128 / ITU-R BS.1770 integrated, short-term & momentary LUFS',
        'True-peak limiting and correlation metering',
        'Binaural (HRTF) spatial rendering for headphones',
        'Bounce/export to WAV, with offline (faster-than-real-time) render',
      ],
    },
  ],
  gallery: [
    { type: 'mockup', src: 'sound-hero', alt: 'XENO Sound — Arrangement timeline with track headers, waveform clips, effects rack and mixer' },
  ],
  useCases: [
    { title: 'Bedroom producer', icon: 'Music', desc: 'Sketch a beat with the step sequencer and drum pads, add synth and sampler parts in the piano roll, then arrange the full track — all in one window.' },
    { title: 'Podcast & voice editor', icon: 'Mic', desc: 'Record multi-track, clean up rooms and hiss with AI denoise, and normalize to a broadcast LUFS target with real EBU R128 metering.' },
    { title: 'Mixing engineer', icon: 'SlidersHorizontal', desc: 'A proper channel-strip mixer with sends, sidechain, group tracks and automation — plus recallable mixer scenes to A/B a balance.' },
    { title: 'Mastering engineer', icon: 'Gauge', desc: 'Integrated, short-term and momentary loudness, true-peak limiting and correlation metering to finish to spec with confidence.' },
    { title: 'Remixer & sound designer', icon: 'Boxes', desc: 'Split a track into stems, warp and time-stretch, and rebuild it in Session view with spectral edits and creative effects.' },
    { title: 'Content creator', icon: 'Sparkles', desc: 'Drop in audio, hit AI cleanup, and export a clean, level track for video without learning a full studio first.' },
  ],
  howItWorks: [
    { step: '1', title: 'Download & open', desc: 'Install the desktop app, sign in with your XENO account, and start a new .xsound project.' },
    { step: '2', title: 'Record, program or import', desc: 'Track audio, program beats in the sequencer, or drop in WAV / FLAC / MP3 / AAC / OGG / AIFF.' },
    { step: '3', title: 'Mix, master, export', desc: 'Shape it with the mixer and effects, let AI denoise, split or master, then bounce to your target loudness.' },
  ],
  comparison: {
    competitor: 'most audio tools',
    rows: [
      { feature: 'Beat-making + linear editing in one app', xeno: true, them: 'Usually one or the other' },
      { feature: 'Built-in synths, sampler & drum machine', xeno: true, them: 'Extra purchase' },
      { feature: 'AI denoise, stem split, transcribe & master', xeno: 'Built in', them: 'Add-ons / none' },
      { feature: 'Full EBU R128 loudness + true-peak metering', xeno: true, them: 'Basic' },
      { feature: 'Runs on Windows, macOS and Linux', xeno: true, them: 'Windows/Mac' },
      { feature: 'Mature VST/AU plugin ecosystem', xeno: 'WASM native; VST bridge planned', them: true },
      { feature: 'Years of studio-proven stability', xeno: 'Public beta', them: true },
    ],
  },
  specs: [
    { label: 'Platforms', value: 'Windows · macOS · Linux' },
    { label: 'Engine', value: 'Web Audio + Rust→WASM DSP' },
    { label: 'Import formats', value: 'WAV · FLAC · MP3 · AAC · OGG · AIFF' },
    { label: 'Status', value: 'v0.2.0 · public beta' },
  ],
  faq: [
    { q: 'Is XENO Sound ready for real projects?', a: 'It’s a public beta (v0.2.0). The core DAW — Arrangement and Session views, transport, timeline, mixer, the built-in instruments and the EQ/compressor/reverb/delay effect rack, plus the AI tools — works on desktop today. Some advanced instruments and effects are still being built, and the .xsound project format may still change.' },
    { q: 'What can I actually make with it?', a: 'Beats and full songs (step sequencer, piano roll, synth, sampler, drum machine), recordings and podcasts (multi-track recording, waveform/spectral editing, comping), and finished masters (mixer, effects, EBU R128 metering and true-peak limiting).' },
    { q: 'How does the AI work — and is it private?', a: 'Real-time noise reduction runs locally in the audio engine (RNNoise as WASM). Heavier jobs — stem separation (HTDemucs), transcription (Whisper), deeper denoise and auto-mastering — run either on your machine or via the XENO cloud, so you can keep audio fully local when you want to.' },
    { q: 'Can it separate a song into stems?', a: 'Yes — stem separation splits a track into vocals, drums, bass and other as four new tracks you can remix, using an HTDemucs model.' },
    { q: 'Which platforms and formats are supported?', a: 'The desktop app targets Windows, macOS and Linux (built on Electron). It imports WAV, FLAC, MP3, AAC, OGG and AIFF via the symphonia decoder, and bounces/exports your mix from the export dialog.' },
    { q: 'Does it load VST/AU plugins?', a: 'Not yet. Effects and instruments today are native (Rust→WASM), which is what keeps latency low and avoids GC pauses. A VST bridge is planned; for now the built-in effect rack and instruments are the toolkit.' },
    { q: 'How much does it cost?', a: 'The public beta is free. There’s a free tier plus credits for cloud AI; full pricing for the general release is announced later.' },
  ],
  seo: {
    title: 'XENO Sound — the AI-native audio workstation & DAW',
    description: 'Beat-making, recording, mixing and broadcast mastering in one desktop app. Arrangement + Session views, built-in synths and samplers, a Rust→WASM DSP engine, and AI denoise, stem separation, transcription and mastering. Free public beta on Windows, macOS and Linux.',
  },
};

export default sound;
