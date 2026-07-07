import React from 'react';
import {
  ArrowLeft, ArrowRight, RotateCw, Lock, Plus, Sparkles, Settings, ChevronDown,
  Paperclip, ImageIcon, Smile, Calendar, Check, SendHorizontal, Play, X, ShieldCheck,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* Hero mockup — XENO Browser doing the one thing no other web agent can:
 * attaching a file to a web composer BY PATH, with the native OS file dialog
 * swallowed and a scoped-consent prompt (SPEC §2.3 / §7). Recreated in the
 * landing-v3 language: near-black panels, hairline borders, off-white text.
 * All accent color routes through rgb(var(--acc)) / .acc-* so the theme
 * switcher recolors it. Layout: Spaces rail · the live page (X-style composer
 * with the agent-injected attachment) · native agent sidebar. */

const V = 'rgb(var(--acc))';

const GR = {
  you: 'linear-gradient(135deg,#8a7fb0,#473f6b)',
  launch: 'linear-gradient(135deg,#b0935b,#6b552f)',
  research: 'linear-gradient(135deg,#5b7fb0,#33486b)',
};

/* ▸ agent action-log row (mirrors the sidebar's live steps) */
function Step({ verb, arg, state }: { verb: string; arg: string; state: 'done' | 'active' }) {
  return (
    <div className="flex items-center gap-2.5 py-[3px] font-mono text-[11px]">
      <span className="grid h-3 w-3 shrink-0 place-items-center">
        {state === 'done'
          ? <Check className="h-3 w-3" style={{ color: '#5fbf8f' }} />
          : <span className="h-[7px] w-[7px] rounded-[1.5px] motion-safe:animate-pulse" style={{ background: V }} />}
      </span>
      <span className={state === 'active' ? 'acc-fg-hi' : 'text-[#807970]'}>{verb}</span>
      <span className="truncate text-[#5d5850]">{arg}</span>
    </div>
  );
}

const BrowserFileIO: React.FC = () => (
  <div className="mx-auto w-full max-w-[900px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* ── titlebar ── */}
    <div className="flex items-center gap-3 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      </div>
      <span className="font-mono text-[10.5px] text-[#5d5850]">XENO Browser — Launch</span>
      <div className="ml-auto hidden items-end gap-1 sm:flex">
        <div className="flex items-center gap-2 rounded-t-[7px] border border-b-0 border-white/[0.07] bg-[#0d0d0f] px-3 py-1.5 text-[11px] text-[#cdc7be]">
          <span className="grid h-3 w-3 place-items-center rounded-full bg-white/10 text-[7px] font-bold">𝕏</span> Compose
        </div>
        <div className="px-2 py-1.5 text-[11px] text-[#5d5850]">Studio</div>
        <Plus className="mb-1 h-3.5 w-3.5 text-[#5d5850]" />
      </div>
    </div>

    {/* ── omnibox ── */}
    <div className="flex items-center gap-2.5 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2">
      <div className="flex items-center gap-1.5 text-[#5d5850]">
        <ArrowLeft className="h-3.5 w-3.5" /><ArrowRight className="h-3.5 w-3.5 opacity-40" /><RotateCw className="h-3 w-3" />
      </div>
      <div className="flex flex-1 items-center gap-2 rounded-[7px] border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
        <Lock className="h-3 w-3 text-[#5fbf8f]/70" />
        <span className="text-[11px] text-[#807970]">x.com/compose/post</span>
      </div>
      <span className="grid h-6 w-6 place-items-center rounded-[6px] border acc-bd30 acc-b12 acc-fg-hi"><Sparkles className="h-3.5 w-3.5" /></span>
    </div>

    <div className="flex h-[clamp(452px,64vh,564px)] text-left">
      {/* ── Spaces rail ── */}
      <aside className="hidden w-[132px] shrink-0 flex-col border-r border-white/[0.06] bg-[#08080a] px-2 py-3 lg:flex">
        <span className="px-1.5 pb-2 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[#5d5850]">Spaces</span>
        {[
          { name: 'Launch', grad: GR.launch, active: true },
          { name: 'Research', grad: GR.research },
          { name: 'Personal', grad: GR.you },
        ].map((s) => (
          <div key={s.name} className={`flex items-center gap-2 rounded-[7px] px-1.5 py-1.5 ${s.active ? 'acc-b10' : ''}`}>
            <span className="h-4 w-4 shrink-0 rounded-[5px]" style={{ background: s.grad }} />
            <span className={`text-[11.5px] ${s.active ? 'text-[#f3efe8]' : 'text-[#807970]'}`}>{s.name}</span>
          </div>
        ))}
        <div className="my-2.5 h-px bg-white/[0.06]" />
        <span className="px-1.5 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[#5d5850]">Pinned</span>
        <div className="grid grid-cols-4 gap-1.5 px-1">
          {['#b8688f', '#5b7fb0', '#5fa088', '#a08a5f', '#8a7fb0', '#b0935b'].map((c, i) => (
            <span key={i} className="aspect-square rounded-[5px] border border-white/[0.06]" style={{ background: `${c}33` }} />
          ))}
        </div>
        <div className="mt-auto flex items-center gap-1.5 px-1.5 pt-3 text-[10.5px] text-[#5d5850]">
          <span className="grid h-4 w-4 place-items-center rounded-[4px] border border-white/[0.08]"><Plus className="h-2.5 w-2.5" /></span> New Space
        </div>
      </aside>

      {/* ── the live page: an X-style composer ── */}
      <div className="relative hidden min-w-0 flex-1 flex-col bg-[#0b0b0d] px-5 py-5 sm:flex">
        <div className="mx-auto w-full max-w-[420px] rounded-[14px] border border-white/[0.07] bg-[#0d0d10] p-4">
          <div className="flex items-center justify-between pb-3">
            <span className="text-[12px] text-[#69635b]">Drafts</span>
            <X className="h-3.5 w-3.5 text-[#5d5850]" />
          </div>
          <div className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white/90" style={{ background: GR.you }}>XN</span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] leading-[1.5] text-[#e7e2d9]">
                We rebuilt the browser so your agent has hands, not just eyes. Ship day.
                <span className="acc-fg-hi"> #XENOBrowser</span>
              </p>

              {/* the agent-injected attachment — accent ring = just placed */}
              <div className="relative mt-3 overflow-hidden rounded-[12px] border acc-bd30">
                <div className="relative grid h-[132px] place-items-center bg-[linear-gradient(135deg,#141020,#0b0b0d)]">
                  <span className="grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/40 backdrop-blur-sm">
                    <Play className="h-4 w-4 translate-x-[1px] fill-white text-white" />
                  </span>
                  <span className="absolute bottom-2 left-2 rounded-[4px] bg-black/70 px-1.5 py-0.5 font-mono text-[9.5px] text-[#cdc7be]">0:24</span>
                  <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-black/60"><X className="h-3 w-3 text-white/80" /></span>
                </div>
                <div className="flex items-center justify-between border-t acc-bd20 acc-b06 px-2.5 py-1.5 font-mono text-[10px]">
                  <span className="acc-fg-hi">launch-cut.mp4</span>
                  <span className="text-[#69635b]">12.4 MB · uploaded</span>
                </div>
              </div>

              {/* composer toolbar — Attach is the target (accent ring) */}
              <div className="mt-3 flex items-center justify-between">
                <div className="flex items-center gap-3 text-[#5d5850]">
                  <span className="relative grid h-7 w-7 place-items-center rounded-full acc-b12 acc-fg-hi ring-2 acc-bd40">
                    <Paperclip className="h-3.5 w-3.5" />
                  </span>
                  <ImageIcon className="h-4 w-4" /><Smile className="h-4 w-4" /><Calendar className="h-4 w-4" />
                </div>
                <span className="rounded-full px-4 py-1.5 text-[12px] font-semibold text-white" style={{ background: V }}>Post</span>
              </div>
            </div>
          </div>
        </div>

        {/* the swallowed native dialog — the whole point */}
        <div className="mx-auto mt-4 flex w-full max-w-[420px] items-center gap-2 rounded-[8px] border border-dashed border-white/[0.12] bg-white/[0.02] px-3 py-2 text-[11px]">
          <span className="text-[#5d5850] line-through">Open · native file picker</span>
          <span className="ml-auto flex items-center gap-1.5 acc-fg-hi"><Check className="h-3.5 w-3.5" /> injected by path</span>
        </div>
      </div>

      {/* ── agent sidebar ── */}
      <aside className="flex w-full shrink-0 flex-col border-l border-white/[0.06] bg-[#08080a] sm:w-[clamp(288px,42%,340px)]">
        <div className="flex items-center justify-between border-b border-white/[0.05] px-3 py-2.5">
          <div className="flex items-center gap-1.5 rounded-[6px] border border-white/[0.08] px-2 py-1 text-[11px] text-[#cdc7be]">
            <Sparkles className="h-3 w-3 acc-fg-hi" /> xeno-rt · Sonnet 4.6 <ChevronDown className="h-2.5 w-2.5 text-[#5d5850]" />
          </div>
          <Settings className="h-3.5 w-3.5 text-[#5d5850]" />
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-hidden px-3 py-3.5">
          {/* user task */}
          <Reveal y={8}>
            <div className="flex justify-end">
              <div className="max-w-[86%] rounded-[8px] border border-white/[0.06] bg-white/[0.06] px-2.5 py-1.5 text-[12px] leading-snug text-[#e7e2d9]">
                Post the Motion render to X with the launch caption.
              </div>
            </div>
          </Reveal>

          {/* action log */}
          <Reveal y={8} delay={70}>
            <div className="border-l-[1.5px] border-white/[0.08] pl-3">
              <Step verb="navigate" arg="x.com/compose" state="done" />
              <Step verb="type" arg="caption" state="done" />
              <Step verb="attach_file" arg="launch-cut.mp4" state="active" />
            </div>
          </Reveal>

          {/* scoped-consent card */}
          <Reveal y={8} delay={110}>
            <div className="rounded-[9px] border acc-bd30 acc-b06 p-2.5">
              <div className="flex items-center gap-2 text-[11.5px] font-medium text-[#e7e2d9]">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 acc-fg-hi" /> Attach this file to x.com?
              </div>
              <div className="mt-2 rounded-[6px] border border-white/[0.06] bg-black/30 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-[#aaa39a]">
                ~/.xeno/motion/exports/<span className="acc-fg-hi">launch-cut.mp4</span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[9.5px] text-[#69635b]">
                <span className="rounded-[3px] border border-white/[0.08] px-1 py-px">mount: motion-exports</span>
                <span>· within scope</span>
              </div>
              <div className="mt-2.5 flex justify-end gap-1.5">
                <button className="rounded-[5px] border border-white/[0.08] px-3 py-1 text-[11px] font-semibold text-[#827b71]">Deny</button>
                <button className="rounded-[5px] border acc-bd30 acc-b15 px-3 py-1 text-[11px] font-semibold acc-fg-hi">Allow</button>
              </div>
            </div>
          </Reveal>
        </div>

        {/* composer */}
        <div className="px-3 pb-3 pt-1">
          <div className="flex items-center gap-2 rounded-[8px] border border-white/[0.07] bg-white/[0.03] px-3 py-2">
            <span className="flex-1 text-[12px] text-[#5d5850]">Ask XENO to browse or act…</span>
            <button className="grid h-6 w-6 place-items-center rounded-[6px] text-white" style={{ background: V }}><SendHorizontal className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </aside>
    </div>
  </div>
);

export default BrowserFileIO;
