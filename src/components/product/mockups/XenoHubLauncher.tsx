import React from 'react';
import {
  Home, Store, Palette, Briefcase, Building2, Wrench, Box, FolderOpen, Activity,
  Search, Coins, Moon, Plus, Image, Film, Music, Play, Square, Download, RefreshCw,
  Settings, ExternalLink, Tag, FileText, ArrowDownToLine,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* High-fidelity XENO Hub launcher mockup — the hero's "representative content"
 * (NN/g: the hero visual must be the real product). Recreates the frameless
 * Electron shell from xeno-hub/src/renderer: the custom title bar (logo + HUB /
 * AGENT / CODE / IDE / CHAT tabs, ⌘K, credits, theme toggle, window controls),
 * the 46px icon rail (Home / Store / Studio / Office / Corpo / Tools / Models /
 * Files / System + account), and the Studio app-install list with per-app
 * Install / Launch / Update states. Landing-v3 language: near-black panels,
 * hairline borders, off-white text; accent flows through rgb(var(--acc)) / .acc-*
 * so the Shift+T theme switch recolors it. App-status colors (running / update =
 * emerald) are fixed product semantics, matching the real UI. */

const V = 'rgb(var(--acc))';

const railTop = [
  { id: 'home', icon: Home },
  { id: 'store', icon: Store },
  { id: 'studio', icon: Palette, active: true },
  { id: 'office', icon: Briefcase },
  { id: 'corpo', icon: Building2 },
  { id: 'tools', icon: Wrench },
  { id: 'models', icon: Box },
  { id: 'files', icon: FolderOpen },
  { id: 'system', icon: Activity },
];

const tabs = [
  { label: 'HUB', active: true },
  { label: 'AGENT' },
  { label: 'CODE' },
  { label: 'IDE' },
  { label: 'CHAT' },
];

type AppState = 'running' | 'update' | 'installed' | 'not_installed';
const apps: {
  name: string; ver: string; desc: string; icon: typeof Image; state: AppState; note?: string;
}[] = [
  { name: 'XENO Pixel', ver: 'v0.3.1', desc: 'Image & vector editor', icon: Image, state: 'running' },
  { name: 'XENO Motion', ver: 'v0.2.4', desc: 'Video & motion editor', icon: Film, state: 'update', note: 'Timeline nudges, GPU export, 6 fixes.' },
  { name: 'XENO Sound', ver: 'v0.1.9', desc: 'Audio editor & DAW', icon: Music, state: 'installed' },
  { name: 'XENO 3D', ver: 'v0.1.0', desc: '3D modeling & rendering', icon: Box, state: 'not_installed' },
];

function WinBtn({ d }: { d: string }) {
  return (
    <span className="grid h-6 w-7 place-items-center text-[#5d5850]">
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d={d} />
      </svg>
    </span>
  );
}

function AppCard({ app }: { app: (typeof apps)[number] }) {
  const Icon = app.icon;
  return (
    <div className="overflow-hidden rounded-[9px] border border-white/[0.06] bg-white/[0.02]">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] bg-white/[0.05] text-[#807970]">
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium text-[#e7e2d9]">{app.name}</span>
            {app.state === 'update'
              ? <><span className="text-[8px] text-[#4f4a44] line-through">{app.ver}</span><span className="text-[8px] text-emerald-400/70">v0.2.6</span></>
              : <span className="text-[8px] text-[#4f4a44]">{app.ver}</span>}
          </div>
          <p className="truncate text-[10px] text-[#69635b]">{app.desc}</p>
        </div>
        <span className="h-7 w-px shrink-0 bg-white/[0.06]" />
        <div className="flex shrink-0 items-center gap-1">
          {app.state === 'running' && (
            <button className="flex h-7 items-center gap-1.5 rounded-[7px] bg-white/[0.05] px-3 text-[10px] text-[#aaa39a]"><Square className="h-3 w-3" strokeWidth={1.5} />Stop</button>
          )}
          {app.state === 'update' && (
            <button className="flex h-7 items-center gap-1.5 rounded-[7px] border border-emerald-500/25 bg-emerald-500/[0.08] px-3 text-[10px] text-emerald-400/80"><RefreshCw className="h-3 w-3" strokeWidth={1.5} />Update</button>
          )}
          {(app.state === 'installed' || app.state === 'update') && (
            <button className="flex h-7 items-center gap-1.5 rounded-[7px] bg-white/[0.05] px-3 text-[10px] text-[#cdc7be]"><Play className="h-3 w-3" strokeWidth={1.5} />Launch</button>
          )}
          {app.state === 'not_installed'
            ? <button className="flex h-7 items-center gap-1.5 rounded-[7px] px-3 text-[10px] font-medium text-white acc-b"><Download className="h-3 w-3" strokeWidth={1.5} />Install</button>
            : <button className="grid h-7 w-7 place-items-center rounded-[7px] border border-white/[0.06] text-[#5d5850]"><Settings className="h-3.5 w-3.5" strokeWidth={1.5} /></button>}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-white/[0.04] px-3 py-1.5">
        <div className="flex items-center gap-3 text-[9px] text-[#4f4a44]">
          <span className="flex items-center gap-1"><ExternalLink className="h-2.5 w-2.5" strokeWidth={1.5} />Product</span>
          <span className="flex items-center gap-1"><Tag className="h-2.5 w-2.5" strokeWidth={1.5} />Releases</span>
          <span className="flex items-center gap-1"><FileText className="h-2.5 w-2.5" strokeWidth={1.5} />Docs</span>
        </div>
        <div className="flex items-center gap-1.5 text-[8px] uppercase tracking-wider">
          {app.state === 'running' && <><span className="h-1 w-1 rounded-full bg-emerald-400" /><span className="text-emerald-400/60">Running</span></>}
          {app.state === 'update' && <><span className="h-1 w-1 rounded-full bg-emerald-400" /><span className="text-emerald-400/60">Update available</span></>}
          {app.state === 'installed' && <span className="text-[#4f4a44]">Installed</span>}
          {app.state === 'not_installed' && <span className="text-[#3f3b36]">Not installed</span>}
        </div>
      </div>
    </div>
  );
}

const XenoHubLauncher: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* ── custom title bar ── */}
    <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#0a0a0c] pl-2.5 pr-1">
      <div className="flex items-center gap-1">
        {/* logo mark */}
        <span className="grid h-[26px] w-[26px] place-items-center">
          <span className="h-3 w-3 rotate-45 rounded-[3px] border" style={{ borderColor: V }} />
        </span>
        <span className="mx-1 h-3.5 w-px bg-white/[0.08]" />
        <div className="flex items-center gap-0.5 py-2">
          {tabs.map((t) => (
            <span key={t.label} className={`rounded px-2.5 py-1 text-[10px] font-medium tracking-[0.12em] ${t.active ? 'acc-b10 text-[#f3efe8]' : 'text-[#69635b]'}`}>{t.label}</span>
          ))}
          <span className="grid h-6 w-6 place-items-center text-[#5d5850]"><Plus className="h-3.5 w-3.5" strokeWidth={2} /></span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <span className="hidden items-center gap-1.5 rounded border border-white/[0.07] bg-white/[0.02] px-2 py-1 sm:flex">
          <Search className="h-3 w-3 text-[#5d5850]" strokeWidth={1.5} />
          <span className="font-mono text-[9px] text-[#5d5850]">Ctrl+K</span>
        </span>
        <span className="flex items-center gap-1.5 rounded border border-white/[0.07] bg-white/[0.02] px-2 py-1">
          <Coins className="h-3 w-3 text-[#807970]" strokeWidth={1.5} />
          <span className="text-[10px] font-medium tabular-nums text-[#aaa39a]">2,480</span>
        </span>
        <span className="mx-0.5 grid h-5 w-6 place-items-center rounded border border-white/[0.07] bg-white/[0.02] text-[#807970]"><Moon className="h-3 w-3" strokeWidth={1.8} /></span>
        <WinBtn d="M20 12H4" />
        <span className="grid h-6 w-7 place-items-center text-[#5d5850]"><span className="h-2.5 w-2.5 rounded-[2px] border border-current" /></span>
        <WinBtn d="M6 18L18 6M6 6l12 12" />
      </div>
    </div>

    <div className="flex h-[clamp(392px,52vh,452px)] text-left">
      {/* ── icon rail ── */}
      <aside className="flex w-[46px] shrink-0 flex-col items-center border-r border-white/[0.06] bg-[#0a0a0c] py-2">
        <div className="flex flex-col items-center gap-1">
          {railTop.map(({ id, icon: Icon, active }) => (
            <span key={id} className={`grid h-9 w-9 place-items-center rounded-lg ${active ? 'acc-b10 acc-fg' : 'text-[#5d5850]'}`}>
              <Icon className="h-4 w-4" strokeWidth={1.5} />
            </span>
          ))}
        </div>
        <div className="flex-1" />
        <span className="relative mb-1 grid h-9 w-9 place-items-center rounded-lg text-emerald-400/70">
          <ArrowDownToLine className="h-4 w-4" strokeWidth={1.5} />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        <span className="h-7 w-7 rounded-[4px]" style={{ background: 'linear-gradient(135deg,#8a7fb0,#473f6b)' }} />
      </aside>

      {/* ── content: Studio app list ── */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#0d0d0f] px-4 pt-3.5">
        <div className="mb-3 flex items-center">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#69635b]">Studio · Creative apps</span>
          <span className="mx-3 h-px flex-1 bg-white/[0.05]" />
          <span className="text-[10px] text-[#4f4a44]">4 apps</span>
        </div>
        <div className="flex flex-col gap-2">
          {apps.map((a, i) => (
            <Reveal key={a.name} y={8} delay={i * 55}><AppCard app={a} /></Reveal>
          ))}
        </div>
      </section>
    </div>
  </div>
);

export default XenoHubLauncher;
