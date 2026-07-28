import React from 'react';
import {
  FolderOpen, Save, Upload, Undo2, Redo2, Plus, Layout, Type, Square,
  Circle, Table2, BarChart3, Code, Play, Monitor, Sparkles, ChevronRight,
} from 'lucide-react';

/* High-fidelity XENO Slides mockup — the hero's "representative content" (NN/g:
 * the hero visual must show the real product). Recreates the real Electron app
 * from xeno-slides/src/renderer: the frameless titlebar with its File menu, the
 * toolbar, the slide filmstrip, the 16:9 canvas with a selected object, the
 * properties panel, and the speaker-notes strip.
 *
 * Deliberately shows the File > Export submenu open. 0.2.0 is the first build
 * whose export engines have a caller at all — in 0.1.0 all four were tree-shaken
 * out of the bundle because nothing in the app referenced them, so a user could
 * edit a deck and nothing else. The hero should show the thing that changed.
 *
 * The app is monochromatic by design; accent (rgb(var(--acc)) via .acc-fg/.acc-b*) is
 * reserved for the AI-native layer and the live selection, so the theme switch
 * recolors exactly what makes Slides different. */

function TBtn({ icon: Icon, active }: { icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; active?: boolean }) {
  return (
    <span className={`grid h-6 w-6 place-items-center rounded ${active ? 'bg-white/[0.1] text-[#d8d2ca]' : 'text-[#5d5850]'}`}>
      <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
    </span>
  );
}

const EXPORTS = ['PowerPoint (.pptx)…', 'Standalone HTML…', 'PDF…', 'Slide Images (PNG)…'];

const SlidesEditor: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* frameless titlebar with the File menu */}
    <div className="relative flex items-center justify-between border-b border-white/[0.06] bg-[#08080a] px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="grid h-4 w-4 place-items-center rounded-[3px] border border-white/40">
          <span className="text-[7px] leading-none text-white/40">▤</span>
        </span>
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/45">XENO Slides</span>
        <span className="ml-1 rounded bg-white/[0.1] px-2 py-0.5 text-[10.5px] text-white/70">File</span>
      </div>
      <span className="absolute left-1/2 -translate-x-1/2 text-[10.5px] text-white/30">Q3-review.xslides</span>
      <div className="flex items-center gap-3.5 text-white/30">
        <span className="h-[1.5px] w-2.5 bg-current" />
        <span className="h-2.5 w-2.5 rounded-[2px] border border-current" />
        <span className="text-[11px] leading-none">✕</span>
      </div>
    </div>

    {/* toolbar — file actions first, then insert tools */}
    <div className="flex items-center gap-1 border-b border-white/[0.06] bg-[#0a0a0c] px-2.5 py-1.5">
      <TBtn icon={FolderOpen} /><TBtn icon={Save} active /><TBtn icon={Upload} />
      <span className="mx-1 h-4 w-px bg-white/[0.07]" />
      <TBtn icon={Undo2} /><TBtn icon={Redo2} />
      <span className="mx-1 h-4 w-px bg-white/[0.07]" />
      <TBtn icon={Plus} /><TBtn icon={Layout} />
      <span className="mx-1 h-4 w-px bg-white/[0.07]" />
      <TBtn icon={Type} /><TBtn icon={Square} /><TBtn icon={Circle} />
      <TBtn icon={Table2} /><TBtn icon={BarChart3} /><TBtn icon={Code} />
      <span className="ml-auto flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded text-[#5d5850]"><Monitor className="h-3.5 w-3.5" strokeWidth={1.5} /></span>
        <span className="flex items-center gap-1.5 rounded bg-white/[0.08] px-2.5 py-1 text-[10.5px] text-white/70">
          <Play className="h-3 w-3" strokeWidth={1.5} fill="currentColor" />Present
        </span>
      </span>
    </div>

    <div className="relative flex h-[clamp(300px,42vh,360px)] text-left">
      {/* ── filmstrip ── */}
      <aside className="hidden w-[86px] shrink-0 flex-col gap-1.5 border-r border-white/[0.06] bg-[#0a0a0c] p-2 sm:flex">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="flex items-start gap-1.5">
            <span className="pt-1 text-[9px] tabular-nums text-white/25">{n}</span>
            <span
              className={`aspect-video flex-1 rounded-[3px] border bg-[#0e0e11] ${
                n === 2 ? 'acc-bd30 ring-1 ring-inset acc-b06' : 'border-white/[0.07]'
              }`}
            />
          </div>
        ))}
      </aside>

      {/* ── canvas ── */}
      <div className="grid min-w-0 flex-1 place-items-center bg-[#0b0b0d] p-4">
        <div className="relative aspect-video w-full max-w-[380px] overflow-hidden rounded-[4px] border border-white/[0.09] bg-[#0e0e11]">
          <div className="flex h-full flex-col justify-center gap-2.5 px-6">
            {/* selected title object, with handles */}
            <div className="relative self-start">
              <span className="text-[15px] font-semibold leading-tight text-white/85">Q3 Revenue Review</span>
              <span className="pointer-events-none absolute -inset-1.5 rounded-[2px] ring-1 acc-bd30" />
              {['-left-1.5 -top-1.5', '-right-1.5 -top-1.5', '-left-1.5 -bottom-1.5', '-right-1.5 -bottom-1.5'].map((p) => (
                <span key={p} className={`absolute ${p} h-1.5 w-1.5 rounded-[1px] acc-bg`} />
              ))}
            </div>
            <span className="text-[10px] text-white/40">East leads at 34.2% of revenue</span>
            {/* a chart object on the slide */}
            <div className="mt-1 flex items-end gap-1.5">
              {[38, 62, 88, 26].map((h, i) => (
                <span
                  key={i}
                  className={`w-5 rounded-[1px] ${i === 2 ? 'acc-bg' : 'bg-white/[0.16]'}`}
                  style={{ height: `${h * 0.42}px` }}
                />
              ))}
            </div>
          </div>
          <span className="absolute bottom-1.5 right-2 text-[8.5px] tabular-nums text-white/20">2 / 4</span>
        </div>
      </div>

      {/* ── properties panel ── */}
      <aside className="hidden w-[clamp(150px,23%,176px)] shrink-0 flex-col border-l border-white/[0.06] bg-[#0a0a0c] sm:flex">
        <div className="flex items-center gap-0.5 border-b border-white/[0.04] px-2 py-1.5">
          {[['Properties', true], ['Animate'], ['AI']].map(([l, on]) => (
            <span key={l as string} className={`rounded px-1.5 py-1 text-[10px] ${on ? 'acc-fg-hi acc-b10' : 'text-white/35'}`}>{l}</span>
          ))}
        </div>
        <div className="space-y-2 p-2.5">
          {[['Font', 'Inter · 44'], ['Fill', '#d8d2ca'], ['Align', 'Left'], ['Transition', 'Fade · 0.4s']].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between text-[10px]">
              <span className="text-white/30">{k}</span>
              <span className="text-white/55">{v}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[10px] acc-fg-hi">
            <Sparkles className="h-3 w-3" strokeWidth={1.6} />Improve this slide
          </div>
        </div>
      </aside>

      {/* ── the File > Export submenu, open ── */}
      <div className="absolute left-2 top-0 z-10 w-[188px] rounded-md border border-white/[0.08] bg-[#141417] py-1 shadow-2xl shadow-black/60">
        {[['New Presentation', 'Ctrl+N'], ['Open…', 'Ctrl+O'], ['Save', 'Ctrl+S'], ['Save As…', 'Ctrl+Shift+S']].map(([l, k]) => (
          <span key={l} className="flex items-center justify-between gap-4 px-2.5 py-1 text-[10px] text-white/55">
            <span>{l}</span><span className="text-white/20">{k}</span>
          </span>
        ))}
        <span className="my-1 block h-px bg-white/[0.06]" />
        <span className="flex items-center justify-between bg-white/[0.07] px-2.5 py-1 text-[10px] text-white/80">
          Export<ChevronRight className="h-2.5 w-2.5" strokeWidth={1.5} />
        </span>
        {/* submenu */}
        <div className="absolute left-full top-[74px] w-[164px] rounded-md border border-white/[0.08] bg-[#141417] py-1 shadow-2xl shadow-black/60">
          {EXPORTS.map((l, i) => (
            <span key={l} className={`block px-2.5 py-1 text-[10px] ${i === 0 ? 'acc-fg-hi acc-b10' : 'text-white/55'}`}>{l}</span>
          ))}
        </div>
      </div>
    </div>

    {/* speaker notes */}
    <div className="flex items-center gap-2 border-t border-white/[0.06] bg-[#0a0a0c] px-3 py-2">
      <span className="text-[9.5px] uppercase tracking-[0.1em] text-white/25">Speaker notes</span>
      <span className="truncate text-[10.5px] text-white/45">
        Open on the East number — it is the surprise. Hold the pricing question until slide 3.
      </span>
    </div>
  </div>
);

export default SlidesEditor;
