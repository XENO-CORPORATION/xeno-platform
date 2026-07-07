import React from 'react';
import { Cpu, Zap, Server } from 'lucide-react';

/* Hero mockup — a faithful XENO RT (xeno-rt / `xrt`) session, recreated in the
 * landing-v3 language (no AI-generated imagery). It reproduces the real product
 * surface: the `xrt-server` boot logs (mmap GGUF load, BPE vocab, backend
 * resolution, KV-cache mode, `listening on …`) from crates/xrt-server, then a
 * live OpenAI-compatible `/v1/chat/completions` request streaming SSE chunks,
 * closed by the real telemetry line (`prefill … tok/s`) the CLI/server emit.
 * Accent goes through rgb(var(--acc)) so the theme switch recolors it; the log
 * semantics (INFO=green, crate=cyan, dim paths) are fixed terminal colors. */

const V = 'rgb(var(--acc))';
const C = {
  green: '#5fd08a',
  cyan: '#7ac0c0',
  yellow: '#e6c07a',
  dim: '#5d5850',
  dimmer: '#403c36',
  text: '#a7a099',
  bright: '#d3cdc3',
};

/** A tracing-style log line: `HH:MM:SS  INFO  crate   message` */
function Log({ t, crate, children }: { t: string; crate: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 whitespace-pre">
      <span style={{ color: C.dimmer }}>{t}</span>
      <span style={{ color: C.green }}>INFO</span>
      <span style={{ color: C.cyan }}>{crate.padEnd(13)}</span>
      <span style={{ color: C.text }} className="min-w-0">{children}</span>
    </div>
  );
}

const RtRuntime: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#08080a] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* window chrome */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0d0d10] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 font-mono text-[10.5px] text-[#5d5850]">xrt — serve · ~/.cache/xrt/models</span>
    </div>

    {/* terminal body */}
    <div className="flex h-[clamp(392px,52vh,470px)] flex-col justify-between px-4 py-3.5 font-mono text-[11px] leading-[1.65]">
      <div className="space-y-[3px]">
        {/* launch command */}
        <div className="flex gap-1.5 whitespace-pre-wrap break-words">
          <span style={{ color: V }}>$</span>
          <span style={{ color: C.bright }}>
            xrt-server <span style={{ color: C.text }}>--model</span> qwen2.5-7b-instruct-q4_k_m.gguf <span style={{ color: C.text }}>--backend</span> auto <span style={{ color: C.text }}>--port</span> 3000
          </span>
        </div>

        {/* boot logs — real xrt-server startup path */}
        <div className="space-y-[2px] pt-1 text-[10.5px]">
          <Log t="09:41:02" crate="xrt_gguf">
            mapped <span style={{ color: C.bright }}>qwen2.5-7b-instruct-q4_k_m.gguf</span> · <span style={{ color: C.bright }}>4.37 GiB</span> <span style={{ color: C.dim }}>(mmap, zero-copy)</span>
          </Log>
          <Log t="09:41:02" crate="xrt_tokenizer">
            loaded BPE vocab · <span style={{ color: C.bright }}>151,646</span> tokens
          </Log>
          <Log t="09:41:03" crate="xrt_runtime">
            backend → <span style={{ color: V }}>cuda-resident</span> · KV cache <span style={{ color: V }}>agent_adaptive</span> <span style={{ color: C.dim }}>· paged</span>
          </Log>
          <Log t="09:41:03" crate="xrt_server">
            listening on <span style={{ color: C.bright }}>http://127.0.0.1:3000</span>
          </Log>
        </div>

        {/* OpenAI-compatible request */}
        <div className="flex gap-1.5 whitespace-pre-wrap break-words pt-2">
          <span style={{ color: V }}>$</span>
          <span style={{ color: C.bright }}>
            curl <span style={{ color: C.text }}>-N</span> localhost:3000<span style={{ color: C.cyan }}>/v1/chat/completions</span> <span style={{ color: C.text }}>-d</span> <span style={{ color: C.yellow }}>{"'{\"model\":\"qwen2.5-7b\",\"stream\":true,…}'"}</span>
          </span>
        </div>

        {/* one raw SSE chunk, then the decoded assistant reply streaming */}
        <div className="pt-1 text-[10px]" style={{ color: C.dim }}>
          <div className="truncate">data: {'{'}"object":"chat.completion.chunk","choices":[{'{'}"delta":{'{'}"content":"Local"{'}'}{'}'}]{'}'}</div>
        </div>
        <div className="flex gap-1.5 pt-1" style={{ color: C.bright }}>
          <span className="mt-px" style={{ color: V }}>●</span>
          <span>
            Local inference is live. The model is served over the OpenAI-compatible{' '}
            <span style={{ color: C.cyan }}>/v1</span> API — point any OpenAI SDK at{' '}
            <span style={{ color: C.cyan }}>http://127.0.0.1:3000</span>, set the base URL, and stream.
            Weights and prompts never leave the machine.
            <span className="ml-0.5 inline-block h-[13px] w-[7px] translate-y-[2px] motion-safe:animate-pulse" style={{ background: V }} />
          </span>
        </div>
        <div className="text-[10px]" style={{ color: C.dimmer }}>data: [DONE]</div>
      </div>

      {/* telemetry footer — the real run stats the runtime prints */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 border-t border-white/[0.06] pt-2 text-[10px]" style={{ color: C.dim }}>
          <span className="flex items-center gap-1" style={{ color: C.green }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: C.green }} /> ready
          </span>
          <span style={{ color: C.dimmer }}>|</span>
          <span className="flex items-center gap-1"><Server className="h-3 w-3" /> qwen2.5-7b · <span style={{ color: C.text }}>Q4_K_M</span></span>
          <span style={{ color: C.dimmer }}>|</span>
          <span className="flex items-center gap-1"><Cpu className="h-3 w-3" /> <span style={{ color: V }}>cuda-resident</span></span>
          <span className="hidden sm:inline" style={{ color: C.dimmer }}>|</span>
          <span className="hidden items-center gap-1 sm:flex"><Zap className="h-3 w-3" /> prefill <span style={{ color: C.text }}>82ms</span> · <span style={{ color: V }}>102.6</span> tok/s</span>
          {/* tiny throughput sparkline */}
          <span className="ml-auto flex items-end gap-[2px]">
            {[5, 8, 6, 11, 9, 13, 10, 14].map((h, i) => (
              <span key={i} className="w-[3px] rounded-[1px]" style={{ height: h, background: V, opacity: 0.35 + i * 0.08 }} />
            ))}
          </span>
        </div>
      </div>
    </div>
  </div>
);

export default RtRuntime;
