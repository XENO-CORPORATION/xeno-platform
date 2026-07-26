import type { ProductContent } from './_types';

/* XENO RT — sourced from ../xeno-rt (README + crates/xrt-server, xrt-cli,
 * xrt-runtime). A from-scratch Rust inference runtime (`xrt`): load a GGUF
 * model and serve it over an OpenAI-compatible API on CPU or CUDA, or
 * generate/chat from the CLI. Honest beta framing (v0.2.0, Apache-2.0). Real,
 * verified surface: /v1/chat/completions + /v1/completions (+SSE), /v1/models,
 * runtime load/unload/status, agent-adaptive paged KV cache, GGUF K-quants,
 * HuggingFace download, plus vision (mmproj) + task-model endpoints and
 * Python/C bindings that exist in-tree. Nothing here is invented. */
const rt: ProductContent = {
  slug: 'rt',
  hero: {
    headline: 'A local model server that speaks OpenAI.',
    sub: 'xeno-rt is a from-scratch Rust inference runtime. Load a GGUF model and serve it over an OpenAI-compatible API — on CPU or CUDA — or generate and chat straight from the terminal. Fast, memory-safe, fully offline, and the same engine that powers inference across the XENO platform.',
    media: { type: 'mockup', src: 'rt-hero', alt: 'XENO RT — the xrt-server booting a local GGUF model and streaming an OpenAI-compatible /v1/chat/completions response' },
    badges: ['Windows + Linux x64', 'CPU + CUDA', 'GGUF', 'OpenAI-compatible', 'Apache-2.0'],
    note: 'Beta (v0.2) · Apache-2.0. Released on GitHub — signed Windows and Linux archives with checksums and SBOMs. CPU runs everywhere; the CUDA backend needs Toolkit 12.x.',
  },
  trust: ['Pure Rust — no C/C++ in the hot path', 'GGUF native · mmap zero-copy loading', 'One OpenAI-compatible API for every XENO app'],
  highlights: [
    { value: 'OpenAI-compatible', label: 'Drop-in /v1 API' },
    { value: '100% local', label: 'Your weights, your machine' },
    { value: 'CPU + CUDA', label: 'Backend auto-resolves' },
    { value: 'Pure Rust', label: 'Memory-safe by default' },
  ],
  features: [
    {
      eyebrow: 'Drop-in API', icon: 'Globe',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,170,255,0.16), transparent 60%), linear-gradient(165deg,#0e1320,#070707 74%)',
      title: 'The OpenAI API, served from localhost',
      desc: 'Point your existing OpenAI SDK or app at the local server and change one line — the base URL. Streaming and all.',
      bullets: [
        '/v1/chat/completions & /v1/completions with SSE streaming',
        '/v1/models plus runtime load / unload / status endpoints',
        'Function / tool-calling support in chat completions',
        'Set the base URL to http://127.0.0.1:3000 — no other changes',
      ],
    },
    {
      eyebrow: 'Private by default', icon: 'Lock',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(120,200,150,0.15), transparent 60%), linear-gradient(165deg,#0e1a14,#070707 74%)',
      title: 'Runs fully offline, on your hardware',
      desc: 'Weights and prompts stay on the machine. No accounts, no telemetry, no round-trip to someone else’s server.',
      bullets: [
        'Local GGUF inference — nothing leaves the box',
        'Memory-safe Rust with no C/C++ in the hot path',
        'mmap zero-copy model loading — no eager weight copies',
        'Self-host it, embed it, or run it behind your own gateway',
      ],
    },
    {
      eyebrow: 'Models & formats', icon: 'Boxes',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(220,200,160,0.14), transparent 60%), linear-gradient(165deg,#181614,#070707 74%)',
      title: 'GGUF native, K-quants included',
      desc: 'First-class GGUF with ggml-compatible dequantization across the quant ladder — and one-command downloads from HuggingFace.',
      bullets: [
        'Llama, Mistral and Qwen family models',
        'F32 · F16 · BF16 · Q8_0 · Q4_0 · Q4_K · Q5_K · Q6_K',
        'xrt download --hf-repo … --hf-file … (cached in ~/.cache/xrt)',
        'Model aliases resolve to local paths automatically',
      ],
    },
    {
      eyebrow: 'Backends', icon: 'Cpu',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(170,140,255,0.18), transparent 60%), linear-gradient(165deg,#141020,#070707 74%)',
      title: 'Tuned CPU kernels, optional CUDA',
      desc: 'Hand-written CPU kernels run everywhere; a feature-gated CUDA backend takes over on GPU. Pick one, or let it resolve automatically.',
      bullets: [
        'Tiled matmul, RMSNorm, RoPE, softmax, SiLU — hand-tuned',
        'Rayon row-parallelism + AVX2/NEON-friendly loops',
        'Feature-gated CUDA (PTX kernels) → cuda-resident backend',
        '--backend auto | cpu | cuda, or the XRT_BACKEND env var',
      ],
    },
    {
      eyebrow: 'KV cache', icon: 'Layers',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(150,200,200,0.14), transparent 60%), linear-gradient(165deg,#10171a,#070707 74%)',
      title: 'Paged KV cache, agent-aware',
      desc: 'A block-paged key-value cache from day one, with selectable cache modes — including an agent-adaptive policy for long, tool-heavy sessions.',
      bullets: [
        'Block-level paging keeps memory bounded',
        'Cache modes: f32 · q8 · agent_adaptive',
        'Prompt-span aware policies (system / user / tool spans)',
        'Quantized KV to fit longer context on the same VRAM',
      ],
    },
    {
      eyebrow: 'More than text', icon: 'Blocks',
      accent: 'radial-gradient(ellipse at 72% 26%, rgba(200,150,220,0.14), transparent 60%), linear-gradient(165deg,#170f18,#070707 74%)',
      title: 'Vision, task models & bindings',
      desc: 'The same server handles multimodal inputs and task-model endpoints — and you can embed the runtime from Python or C.',
      bullets: [
        'Multimodal vision inputs via an mmproj projector',
        'Task endpoints, e.g. /v1/images/remove-background (ONNX)',
        'Python bindings (PyO3) and a C API for FFI consumers',
        'One runtime for LLM + task inference across XENO tools',
      ],
    },
  ],
  useCases: [
    { title: 'Local & private inference', icon: 'Lock', desc: 'Run open models fully offline for sensitive code, docs, and data — prompts and weights never leave your machine.' },
    { title: 'Drop-in OpenAI backend', icon: 'Globe', desc: 'Swap the base URL in any OpenAI SDK or agent framework to a local xrt-server — same requests, no vendor, no bill.' },
    { title: 'The engine behind XENO', icon: 'Boxes', desc: 'The shared runtime for local LLM and task-model inference across XENO apps — embeddable via Python or C bindings.' },
  ],
  howItWorks: [
    { step: '1', title: 'Get the build', desc: 'Grab the v0.2.0 Windows .zip or Linux .tar.gz from the public GitHub release, or build from source — cargo build --release (add --features cuda for GPU).' },
    { step: '2', title: 'Grab a model', desc: 'xrt download --hf-repo … --hf-file … pulls a GGUF from HuggingFace, or point --model at any local file.' },
    { step: '3', title: 'Serve or generate', desc: 'xrt-server --model … --port 3000 exposes the /v1 API; or xrt generate / xrt chat right in the terminal.' },
  ],
  comparison: {
    competitor: 'most local runtimes',
    rows: [
      { feature: 'OpenAI-compatible /v1 server', xeno: true, them: true },
      { feature: 'Pure Rust, memory-safe hot path', xeno: true, them: false },
      { feature: 'GGUF + K-quant support', xeno: true, them: true },
      { feature: 'Selectable KV cache modes', xeno: 'f32 · q8 · agent-adaptive', them: 'Fixed' },
      { feature: 'CUDA GPU backend', xeno: 'Feature-gated', them: true },
      { feature: 'Task-model endpoints in the same server', xeno: true, them: false },
      { feature: 'Model breadth & ecosystem maturity', xeno: 'Growing', them: true },
      { feature: 'Price', xeno: 'Free · Apache-2.0', them: 'Free / OSS' },
    ],
  },
  specs: [
    { label: 'Backends', value: 'CPU (AVX2/NEON) · CUDA 12.x' },
    { label: 'Model format', value: 'GGUF · Q4_K/Q5_K/Q6_K/Q8_0/F16' },
    { label: 'API', value: 'OpenAI /v1 · SSE streaming' },
    { label: 'Version', value: '0.2.0 · beta · Apache-2.0' },
  ],
  faq: [
    { q: 'What is xeno-rt?', a: 'A from-scratch Rust inference runtime (CLI name `xrt`). Load a GGUF model and serve it over an OpenAI-compatible API, or generate and chat from the terminal — on CPU or, optionally, CUDA.' },
    { q: 'Is it really a drop-in for the OpenAI API?', a: 'It implements /v1/chat/completions and /v1/completions (both with SSE streaming) plus /v1/models. Point your existing OpenAI SDK at the local base URL. It also adds runtime load/unload/status endpoints and function-calling support.' },
    { q: 'Do I need a GPU?', a: 'No. Hand-tuned CPU kernels (tiled matmul, rayon parallelism, AVX2/NEON-friendly loops) run everywhere. Enable the feature-gated CUDA backend (Toolkit 12.x) for GPU acceleration; the backend auto-resolves, or force it with --backend.' },
    { q: 'Which models and quantizations are supported?', a: 'Llama, Mistral and Qwen family GGUF models, with F32/F16/BF16/Q8_0/Q4_0/Q4_K/Q5_K/Q6_K. Download straight from HuggingFace with xrt download, or load any local GGUF file.' },
    { q: 'Does it only do text?', a: 'LLMs are the core, but the same server also handles multimodal vision inputs (via an mmproj projector) and task-model endpoints such as image background removal — and you can embed the runtime from Python (PyO3) or C.' },
    { q: 'How do I get it?', a: 'From the public GitHub release — v0.2.0 ships a Windows x86_64 .zip and a Linux x86_64 .tar.gz, each with a SHA-256 checksum and an SPDX SBOM. It is not distributed through the XENO Hub update feed, so the button here takes you to GitHub. macOS builds are not published yet; build from source in the meantime.' },
    { q: 'Is it open source and free?', a: 'Yes — Apache-2.0, and free. It’s in beta (v0.2). Contributions require signing the CLA, and XENO retains the right to use them in both open-source and commercial products.' },
  ],
  seo: {
    title: 'XENO RT — local model inference runtime',
    description: 'A from-scratch Rust inference runtime: load a GGUF model and serve it over an OpenAI-compatible API on CPU or CUDA, or generate from the CLI. Fast, memory-safe, fully offline. Apache-2.0, beta.',
  },
};

export default rt;
