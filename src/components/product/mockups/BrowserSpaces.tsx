import React from 'react';
import {
  Plus, Search, Bookmark, FolderDown, Check, MoreHorizontal, ChevronDown,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* Gallery mockup — XENO Browser's Spaces switcher (SPEC §6): saved .xbrowser
 * Spaces, each carrying its own tabs, pins, profile and agent context; plus a
 * download-to-path confirmation showing the reverse of the hero's upload (files
 * written straight to a bounded path, no Save dialog). Same landing-v3 language;
 * accent through rgb(var(--acc)) / .acc-*. */

const V = 'rgb(var(--acc))';

const SPACES = [
  { name: 'Launch', grad: 'linear-gradient(135deg,#b0935b,#6b552f)', tabs: 8, pins: ['#b8688f', '#5b7fb0', '#5fa088'], note: 'Post render → X, YouTube, LinkedIn', active: true },
  { name: 'Research', grad: 'linear-gradient(135deg,#5b7fb0,#33486b)', tabs: 12, pins: ['#8a7fb0', '#a08a5f'], note: 'Collect sources → notes' },
  { name: 'Client · Acme', grad: 'linear-gradient(135deg,#5fa088,#2f5d4c)', tabs: 5, pins: ['#b0935b', '#5b7fb0', '#b8688f'], note: 'Isolated profile' },
  { name: 'Personal', grad: 'linear-gradient(135deg,#8a7fb0,#473f6b)', tabs: 3, pins: ['#5fa088'], note: '' },
];

const BrowserSpaces: React.FC = () => (
  <div className="mx-auto w-full max-w-[560px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* titlebar */}
    <div className="flex items-center gap-3 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      </div>
      <span className="font-mono text-[10.5px] text-[#5d5850]">XENO Browser — Spaces</span>
    </div>

    <div className="flex h-[clamp(392px,52vh,452px)] flex-col px-4 py-4">
      {/* header + search */}
      <div className="flex items-center justify-between pb-3">
        <span className="text-[14px] font-semibold text-[#f3efe8]">Spaces</span>
        <div className="flex items-center gap-2 rounded-[7px] border border-white/[0.06] bg-white/[0.02] px-2 py-1">
          <Search className="h-3 w-3 text-[#5d5850]" />
          <span className="text-[11px] text-[#5d5850]">Find a Space</span>
        </div>
      </div>

      {/* space grid */}
      <div className="grid flex-1 grid-cols-2 content-start gap-2.5">
        {SPACES.map((s, i) => (
          <Reveal key={s.name} y={8} delay={i * 55}>
            <div className={`h-full rounded-[11px] border p-3 ${s.active ? 'acc-bd30 acc-b06' : 'border-white/[0.07] bg-[#0a0a0c]'}`}>
              <div className="flex items-center gap-2">
                <span className="h-6 w-6 shrink-0 rounded-[7px]" style={{ background: s.grad }} />
                <span className="truncate text-[12.5px] font-medium text-[#e7e2d9]">{s.name}</span>
                <MoreHorizontal className="ml-auto h-3.5 w-3.5 shrink-0 text-[#5d5850]" />
              </div>
              <div className="mt-2.5 flex items-center gap-1">
                {s.pins.map((c, k) => (
                  <span key={k} className="h-4 w-4 rounded-[4px] border border-white/[0.06]" style={{ background: `${c}40` }} />
                ))}
                <span className="ml-1 text-[10px] text-[#69635b]">{s.tabs} tabs</span>
              </div>
              {s.note
                ? <div className="mt-2.5 flex items-start gap-1.5 rounded-[6px] border border-white/[0.05] bg-black/20 px-2 py-1.5 text-[10px] leading-snug text-[#807970]">
                    <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: V }} />{s.note}
                  </div>
                : <div className="mt-2.5 h-[30px]" />}
              <div className="mt-2 flex items-center gap-1 font-mono text-[9px] text-[#5d5850]">
                <Bookmark className="h-2.5 w-2.5" /> {s.name.toLowerCase().replace(/[^a-z]/g, '-')}.xbrowser
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      {/* new space + download-to-path toast */}
      <div className="mt-3 flex items-center gap-2.5">
        <button className="flex items-center gap-1.5 rounded-[8px] border border-white/[0.08] px-3 py-2 text-[11.5px] text-[#cdc7be]">
          <Plus className="h-3.5 w-3.5" /> New Space
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[8px] border acc-bd30 acc-b06 px-3 py-2">
          <FolderDown className="h-3.5 w-3.5 shrink-0 acc-fg-hi" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[11px] text-[#e7e2d9]">
              Downloaded 4 files <Check className="h-3 w-3" style={{ color: '#5fbf8f' }} />
            </div>
            <div className="truncate font-mono text-[9.5px] text-[#69635b]">→ ~/.xeno/downloads/invoices/ · no Save dialog</div>
          </div>
          <ChevronDown className="h-3 w-3 shrink-0 text-[#5d5850]" />
        </div>
      </div>
    </div>
  </div>
);

export default BrowserSpaces;
