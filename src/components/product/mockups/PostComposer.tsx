import React from 'react';
import {
  LayoutGrid, PenSquare, FileText, CalendarDays, Inbox, Radar, BarChart3, Plug, Bot,
  Sparkles, Send, ImagePlus, Library, Heart, MessageCircle, Repeat2, Check,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* High-fidelity XENO Post mockup — the hero's "representative content" (NN/g:
 * a hero visual must show the real product). Recreates the flagship multi-channel
 * composer from apps/web/src/components/composer + the (dashboard) layout: the
 * icon rail, channel chips, the compose textarea with a live char counter, the
 * schedule row, and the per-platform live preview pane. Built in the landing-v3
 * language — near-black panels, hairline borders, off-white text — with ALL
 * accent routed through rgb(var(--acc)) / .acc-* so the theme switch recolors it.
 * "One composer — every audience, everywhere." */

const V = 'rgb(var(--acc))';

/* left icon rail — mirrors the collapsed dashboard sidebar (Workspace / Engage / Manage) */
const NAV = [
  { icon: LayoutGrid, on: false },
  { icon: PenSquare, on: true },
  { icon: FileText, on: false },
  { icon: CalendarDays, on: false },
  { icon: Inbox, on: false },
  { icon: Radar, on: false },
  { icon: BarChart3, on: false },
  { icon: Plug, on: false },
  { icon: Bot, on: false },
];

/* channel chips — PLATFORM_LABEL + account handle, from the real ChannelSelector */
const CHANNELS = [
  { tag: 'X', name: '@acmehq', on: true },
  { tag: 'Instagram', name: 'acme', on: true },
  { tag: 'LinkedIn', name: 'Acme Inc', on: true },
  { tag: 'Threads', name: '@acme', on: false },
  { tag: 'Bluesky', name: 'acme.bsky', on: false },
  { tag: 'Mastodon', name: '@acme', on: false },
];

function Chip({ tag, name, on }: { tag: string; name: string; on: boolean }) {
  return (
    <span
      className={`flex h-7 items-center gap-1.5 rounded-[5px] px-2.5 text-[11.5px] ${
        on ? 'acc-b12 acc-bd30 border acc-fg-hi' : 'border border-white/[0.07] bg-white/[0.02] text-[#aaa39a]'
      }`}
    >
      <span className={`text-[9px] font-semibold uppercase tracking-wide ${on ? 'opacity-70' : 'text-[#69635b]'}`}>{tag}</span>
      {name}
    </span>
  );
}

const PostComposer: React.FC = () => (
  <div className="mx-auto w-full max-w-[840px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 text-[10.5px] text-[#5d5850]">xeno-post — Compose</span>
    </div>

    <div className="flex h-[clamp(408px,54vh,480px)] text-left">
      {/* ── icon rail ── */}
      <aside className="hidden w-[46px] shrink-0 flex-col items-center gap-1 border-r border-white/[0.06] bg-[#0a0a0c] py-2.5 sm:flex">
        <span className="mb-2 grid h-[18px] w-[18px] place-items-center rounded-[4px] text-[10px] font-bold text-white" style={{ background: V }}>x</span>
        {NAV.map((n, i) => {
          const Icon = n.icon;
          return (
            <span key={i} className={`grid h-8 w-8 place-items-center rounded-[7px] ${n.on ? 'acc-b12 acc-fg-hi' : 'text-[#5d5850]'}`}>
              <Icon size={15} strokeWidth={1.6} />
            </span>
          );
        })}
      </aside>

      {/* ── main ── */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#0d0d0f]">
        {/* app header strip */}
        <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#827b71]">Compose</span>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-[5px] border border-white/[0.08] px-2 py-1 text-[11px] text-[#cdc7be] md:inline-flex">
              <Sparkles size={12} strokeWidth={1.6} className="acc-fg-hi" /> Ask AI
            </span>
            <span className="rounded-[5px] bg-white px-2.5 py-1 text-[11px] font-semibold text-black">New post</span>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3.5 lg:grid-cols-[minmax(0,1fr)_262px]">
          {/* composer column */}
          <div className="flex min-w-0 flex-col gap-2.5">
            {/* channels */}
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#69635b]">Channels</div>
              <div className="flex flex-wrap gap-1.5">
                {CHANNELS.map((c) => <Chip key={c.tag + c.name} {...c} />)}
              </div>
            </div>

            {/* compose card */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#69635b]">Compose</span>
                <span className="text-[10.5px] text-[#69635b]">231 / 280</span>
              </div>
              <div className="rounded-[9px] border acc-bd25 bg-white/[0.02] p-3">
                <p className="text-[12.5px] leading-relaxed text-[#e7e2d9]">
                  Ship day one on every channel. Acme v2 is live — the same composer, one preview per platform, scheduled or published now.
                  <span className="acc-fg-hi"> #launch</span> <span className="acc-fg-hi">#buildinpublic</span>
                  <span className="ml-0.5 inline-block h-3.5 w-px translate-y-[3px]" style={{ background: V }} />
                </p>
                {/* media thumbs */}
                <div className="mt-2.5 flex gap-1.5">
                  <span className="grid h-11 w-11 place-items-center rounded-[5px] border border-white/[0.07]" style={{ background: 'linear-gradient(135deg,#3a3350,#171528)' }}><Sparkles size={13} className="text-white/40" /></span>
                  <span className="grid h-11 w-11 place-items-center rounded-[5px] border border-white/[0.07]" style={{ background: 'linear-gradient(135deg,#2f4a4a,#14201f)' }}><ImagePlus size={13} className="text-white/40" /></span>
                </div>
                <div className="mt-2.5 flex items-center gap-2 border-t border-white/[0.06] pt-2 text-[11px] text-[#69635b]">
                  <span className="flex items-center gap-1"><ImagePlus size={12} strokeWidth={1.6} /> Upload</span>
                  <span className="flex items-center gap-1"><Library size={12} strokeWidth={1.6} /> Library</span>
                </div>
              </div>
            </div>

            {/* schedule + publish */}
            <div className="flex flex-wrap items-center gap-2.5 rounded-[8px] border border-white/[0.06] bg-white/[0.01] px-3 py-2.5 text-[11.5px] text-[#aaa39a]">
              <span className="flex items-center gap-1.5"><span className="grid h-3 w-3 place-items-center rounded-full border-[3px]" style={{ borderColor: V }} /> Publish now</span>
              <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border border-white/20" /> Schedule</span>
              <span className="ml-auto text-[10.5px] text-[#5d5850]">Saved just now</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-1.5 rounded-[6px] bg-white px-3.5 py-2 text-[12px] font-semibold text-black"><Send size={13} strokeWidth={1.7} /> Publish now</button>
              <button className="flex items-center gap-1.5 rounded-[6px] border border-white/[0.08] px-3 py-2 text-[12px] text-[#cdc7be]"><Sparkles size={13} strokeWidth={1.6} className="acc-fg-hi" /> AI</button>
            </div>
          </div>

          {/* preview column — live per-platform preview */}
          <div className="hidden min-w-0 flex-col gap-1.5 lg:flex">
            <div className="flex gap-1">
              {['X', 'Instagram', 'LinkedIn'].map((p, i) => (
                <span key={p} className={`rounded-[4px] px-2 py-1 text-[9.5px] uppercase tracking-wide ${i === 0 ? 'acc-b15 acc-fg-hi' : 'bg-white/[0.03] text-[#69635b]'}`}>{p}</span>
              ))}
            </div>
            <Reveal y={8}>
              <div className="overflow-hidden rounded-[10px] border border-white/[0.07] bg-[#0a0a0c] p-3">
                {/* header */}
                <div className="flex items-center gap-2">
                  <span className="h-8 w-8 shrink-0 rounded-[6px]" style={{ background: 'linear-gradient(135deg,#5b7fb0,#33486b)' }} />
                  <div className="min-w-0">
                    <div className="truncate text-[11.5px] font-semibold text-[#f3efe8]">Acme HQ</div>
                    <div className="truncate text-[9.5px] text-[#69635b]">@acmehq</div>
                  </div>
                </div>
                {/* body */}
                <p className="mt-2 text-[11.5px] leading-snug text-[#cdc7be]">
                  Ship day one on every channel. Acme v2 is live — the same composer, one preview per platform.
                  <span className="text-[#f3efe8] underline decoration-white/20 underline-offset-2"> #launch</span>
                </p>
                {/* media */}
                <div className="mt-2.5 aspect-[16/10] overflow-hidden rounded-[6px] border border-white/[0.06]" style={{ background: 'radial-gradient(ellipse at 30% 20%, rgb(var(--acc) / 0.28), transparent 60%), linear-gradient(150deg,#181528,#0b0b0d)' }} />
                {/* actions */}
                <div className="mt-2.5 flex gap-4 border-t border-white/[0.06] pt-2 text-[10px] text-[#69635b]">
                  <span className="flex items-center gap-1"><MessageCircle size={11} strokeWidth={1.6} />0</span>
                  <span className="flex items-center gap-1"><Repeat2 size={11} strokeWidth={1.6} />0</span>
                  <span className="flex items-center gap-1"><Heart size={11} strokeWidth={1.6} />0</span>
                </div>
              </div>
            </Reveal>
            {/* capability badges */}
            <div className="flex flex-wrap gap-1">
              {['Text 231/280', 'Img 1/4', 'Threads', 'Native schedule'].map((b, i) => (
                <span key={b} className={`flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[9.5px] ${i < 3 ? 'border-white/[0.07] text-[#827b71]' : 'acc-bd25 acc-fg-hi'}`}>
                  {i === 0 && <Check size={9} strokeWidth={2} className="text-[#5fd08a]" />}{b}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
);

export default PostComposer;
