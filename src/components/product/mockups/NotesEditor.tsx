import React from 'react';
import {
  Search, Plus, ChevronDown, ChevronRight, Star, CalendarDays, Network, LayoutGrid,
  Bold, Italic, Underline, Strikethrough, Code, Heading1, Heading2, List, ListOrdered,
  CheckSquare, Quote, Sparkles, Link2, FileText,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* High-fidelity XENO Notes mockup — the hero's "representative content" (NN/g:
 * the hero visual must show the real product). Recreates the real Electron app
 * from xeno-notes/src/renderer: the frameless titlebar, the 260px page-tree
 * sidebar (section tabs + quick actions + nested pages), the TipTap editor with
 * its formatting toolbar + AI dropdown, and the word-count status bar.
 * The app itself is monochromatic by design; accent (rgb(var(--acc)), via the
 * .acc-* classes) is reserved for the AI-native layer — the ✨AI control, the
 * [[wiki-link]], the active page, and the AI summary callout — so the theme
 * switch recolors exactly the parts that make Notes different. */

function ToolBtn({ icon: Icon, active }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; active?: boolean }) {
  return (
    <span className={`grid h-6 w-6 place-items-center rounded ${active ? 'bg-white/[0.1] text-[#d8d2ca]' : 'text-[#5d5850]'}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
    </span>
  );
}

type Page = { icon: string; title: string; depth: number; active?: boolean; open?: boolean; children?: boolean; fav?: boolean };
const tree: Page[] = [
  { icon: '📓', title: 'Product Research', depth: 0, active: true, open: true, children: true },
  { icon: '🔎', title: 'Competitor Matrix', depth: 1 },
  { icon: '📊', title: 'Market Sizing', depth: 1, fav: true },
  { icon: '🗓️', title: 'Daily Notes', depth: 0, children: true },
  { icon: '📚', title: 'Engineering Wiki', depth: 0, children: true },
  { icon: '🎯', title: 'Q3 Roadmap', depth: 0 },
];

const NotesEditor: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* frameless titlebar */}
    <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#08080a] px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="grid h-4 w-4 place-items-center rounded-[3px] border border-white/40">
          <span className="text-[7px] leading-none text-white/40">≡</span>
        </span>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/45">XENO Notes</span>
      </div>
      <div className="flex items-center gap-3.5 text-white/30">
        <span className="h-[1.5px] w-2.5 bg-current" />
        <span className="h-2.5 w-2.5 rounded-[2px] border border-current" />
        <span className="text-[11px] leading-none">✕</span>
      </div>
    </div>

    <div className="flex h-[clamp(400px,54vh,470px)] text-left">
      {/* ── page-tree sidebar ── */}
      <aside className="hidden w-[clamp(206px,32%,238px)] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0c] sm:flex">
        <div className="flex items-center justify-between border-b border-white/[0.04] px-3 py-2.5">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.12em] text-white/40">Pages</span>
          <span className="flex items-center gap-0.5 text-white/40">
            <Search className="h-3.5 w-3.5" strokeWidth={1.5} />
            <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
          </span>
        </div>

        {/* section tabs */}
        <div className="flex items-center gap-0.5 border-b border-white/[0.04] px-2 py-1.5">
          {[['All', true], ['Favorites'], ['Recent'], ['Trash']].map(([l, on]) => (
            <span key={l as string} className={`flex items-center gap-1 rounded px-2 py-1 text-[10.5px] ${on ? 'bg-white/[0.06] text-white/70' : 'text-white/35'}`}>
              {l === 'Favorites' && <Star className="h-2.5 w-2.5" strokeWidth={1.5} />}
              {l}
            </span>
          ))}
        </div>

        {/* quick actions */}
        <div className="space-y-1 px-2 pb-1 pt-2">
          <div className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[11.5px] text-white/50">
            <CalendarDays className="h-3.5 w-3.5" strokeWidth={1.5} />Today&rsquo;s Note
          </div>
          <div className="flex gap-1">
            <div className="flex flex-1 items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[10.5px] text-white/40"><Network className="h-3 w-3" strokeWidth={1.5} />Graph</div>
            <div className="flex flex-1 items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5 text-[10.5px] text-white/40"><LayoutGrid className="h-3 w-3" strokeWidth={1.5} />Canvas</div>
          </div>
        </div>

        {/* tree */}
        <div className="mt-1 flex-1 space-y-px overflow-hidden px-1 py-1">
          {tree.map((p) => (
            <div
              key={p.title}
              className={`flex items-center gap-1 rounded-md py-[5px] pr-2 text-[12.5px] ${p.active ? 'acc-b10 text-[#f3efe8]' : 'text-white/60'}`}
              style={{ paddingLeft: `${8 + p.depth * 16}px` }}
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center text-white/40">
                {p.children ? (p.open ? <ChevronDown className="h-3 w-3" strokeWidth={1.5} /> : <ChevronRight className="h-3 w-3" strokeWidth={1.5} />) : null}
              </span>
              <span className="shrink-0 text-[13px] leading-none">{p.icon}</span>
              <span className={`min-w-0 flex-1 truncate ${p.active ? 'font-medium' : ''}`}>{p.title}</span>
              {p.fav && <Star className="h-3 w-3 shrink-0 fill-white/25 text-white/25" strokeWidth={0} />}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-white/[0.05] px-3 py-2.5 text-[11px] text-white/35">
          <Link2 className="h-3.5 w-3.5" strokeWidth={1.5} />24 pages · 61 links
        </div>
      </aside>

      {/* ── editor ── */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#0d0d0f]">
        {/* formatting toolbar */}
        <div className="flex items-center gap-0.5 border-b border-white/[0.04] px-3 py-1.5">
          <ToolBtn icon={Bold} /><ToolBtn icon={Italic} active /><ToolBtn icon={Underline} /><ToolBtn icon={Strikethrough} /><ToolBtn icon={Code} />
          <span className="mx-1 h-4 w-px bg-white/[0.06]" />
          <ToolBtn icon={Heading1} /><ToolBtn icon={Heading2} active /><ToolBtn icon={List} /><ToolBtn icon={ListOrdered} /><ToolBtn icon={CheckSquare} />
          <span className="hidden md:inline"><span className="mx-1 inline-block h-4 w-px bg-white/[0.06] align-middle" /></span>
          <span className="hidden md:flex"><ToolBtn icon={Quote} /></span>
          <span className="mx-1 h-4 w-px bg-white/[0.06]" />
          <span className="flex items-center gap-1 rounded px-2 py-1 acc-b10 acc-fg-hi">
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
            <span className="text-[11px] font-medium">AI</span>
            <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
          </span>
        </div>

        {/* page body */}
        <div className="flex-1 overflow-hidden px-[clamp(20px,4vw,48px)] py-6">
          <div className="mx-auto max-w-[440px]">
            <Reveal y={8}><div className="mb-2 text-[30px] leading-none">📓</div></Reveal>
            <Reveal y={8} delay={40}><h1 className="mb-4 text-[26px] font-bold leading-tight text-[#f4f0ea]">Product Research</h1></Reveal>

            <Reveal y={8} delay={80}>
              <div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-[#5d5850]">
                <FileText className="h-3 w-3" strokeWidth={1.5} />
                <span className="rounded-[3px] bg-white/[0.05] px-1.5 py-0.5 text-white/45">#research</span>
                <span className="rounded-[3px] bg-white/[0.05] px-1.5 py-0.5 text-white/45">Status: In progress</span>
              </div>
            </Reveal>

            <Reveal y={8} delay={110}>
              <h2 className="mb-2 mt-4 text-[15px] font-semibold text-[#e7e2d9]">Q3 Findings</h2>
            </Reveal>
            <Reveal y={8} delay={130}>
              <p className="text-[13px] leading-[1.7] text-[#aaa39a]">
                The mid-market segment is underserved — see{' '}
                <span className="rounded-[3px] acc-b15 px-1 font-medium acc-fg-hi">[[Competitor Matrix]]</span>{' '}
                for the full teardown. Demand for a local-first workspace keeps surfacing in interviews.
              </p>
            </Reveal>

            {/* task list */}
            <Reveal y={8} delay={160}>
              <div className="mt-3.5 space-y-1.5 text-[13px]">
                {[['Interview 5 more design teams', true], ['Draft positioning brief', true], ['Size the SMB opportunity', false]].map(([t, done]) => (
                  <div key={t as string} className="flex items-center gap-2.5">
                    <span className={`grid h-[15px] w-[15px] shrink-0 place-items-center rounded-[4px] border ${done ? 'acc-b acc-bd' : 'border-white/20'}`}>
                      {done ? <span className="text-[9px] font-bold leading-none text-white">✓</span> : null}
                    </span>
                    <span className={done ? 'text-[#69635b] line-through' : 'text-[#cdc7be]'}>{t}</span>
                  </div>
                ))}
              </div>
            </Reveal>

            {/* AI summary callout */}
            <Reveal y={8} delay={200}>
              <div className="mt-4 rounded-[10px] border acc-bd30 acc-b06 px-3.5 py-3">
                <div className="mb-1 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 acc-fg-hi" strokeWidth={1.6} />
                  <span className="text-[11px] font-semibold acc-fg-hi">AI summary</span>
                </div>
                <p className="text-[12px] leading-[1.6] text-[#b3aca2]">
                  Three interviews point to the same gap: teams want structured databases without giving up an offline, file-based vault. Recommend leading with local-first + linking.
                </p>
              </div>
            </Reveal>
          </div>
        </div>

        {/* status bar */}
        <div className="flex items-center justify-between border-t border-white/[0.04] px-4 py-2 text-[10.5px] text-white/30">
          <span className="truncate">Product Research</span>
          <span className="flex shrink-0 items-center gap-3">
            <span>342 words · 2 min read</span>
            <span>Edited 9:41 AM</span>
          </span>
        </div>
      </section>
    </div>
  </div>
);

export default NotesEditor;
