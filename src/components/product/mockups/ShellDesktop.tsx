import React from 'react';
import {
  TerminalSquare, FolderOpen, Settings, Boxes, ShieldCheck, Minus, Square, X, Monitor, ChevronRight,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* Hero mockup — XENO Shell v0.1.0-beta.1 as it ACTUALLY ships: a per-display
 * borderless-fullscreen desktop wrapper hosting the two surfaces that are real
 * today — Fabric (a node-pty terminal with ssh:// targets) and Files (a
 * mount-scoped browser over xmount:// handles) — plus the per-app ACL consent
 * sheet in shell chrome and the honest UNSIGNED BETA watermark the build shows.
 * Deliberately does NOT depict XENO apps running inside: nothing does yet.
 * Sourced from ../xeno-shell (README, CHANGELOG v0.1.0-beta.1, packages/ui).
 * landing-v3 language; every accent goes through rgb(var(--acc)) / .acc-*. */

const V = 'rgb(var(--acc))';

function WinChrome({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-2.5 py-1.5">
      <span className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border border-white/[0.08] text-[#aaa39a]">{icon}</span>
      <span className="truncate text-[11px] text-[#cdc7be]">{title}</span>
      {sub && <span className="hidden truncate font-mono text-[9.5px] text-[#5d5850] md:inline">{sub}</span>}
      <div className="ml-auto flex items-center gap-1.5 text-[#5d5850]">
        <Minus className="h-2.5 w-2.5" /><Square className="h-2 w-2" /><X className="h-2.5 w-2.5" />
      </div>
    </div>
  );
}

const ShellDesktop: React.FC = () => (
  <div className="mx-auto w-full max-w-[900px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* ── shell status strip (borderless-fullscreen root, not kiosk) ── */}
    <div className="flex items-center gap-2.5 border-b border-white/[0.06] bg-[#08080a] px-3.5 py-2">
      <span className="grid h-4 w-4 place-items-center rounded-[4px]" style={{ background: V }}>
        <Boxes className="h-2.5 w-2.5 text-black" />
      </span>
      <span className="font-mono text-[10.5px] text-[#807970]">XENO Shell</span>
      <span className="hidden items-center gap-1 rounded-[4px] border border-white/[0.07] px-1.5 py-0.5 font-mono text-[9.5px] text-[#5d5850] sm:flex">
        <Monitor className="h-2.5 w-2.5" /> Display 1 of 2
      </span>
      <div className="ml-1 hidden items-center gap-1 lg:flex">
        {['Work', 'Studio', '3'].map((w, i) => (
          <span key={w} className={`rounded-[4px] px-1.5 py-0.5 text-[10px] ${i === 0 ? 'acc-b12 acc-fg-hi' : 'text-[#5d5850]'}`}>{w}</span>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="rounded-[4px] border border-white/[0.14] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[#948d83]">
          Unsigned beta
        </span>
        <span className="hidden font-mono text-[9.5px] text-[#5d5850] sm:inline">F11</span>
      </div>
    </div>

    {/* ── the desktop ── */}
    <div className="relative h-[clamp(452px,64vh,564px)] bg-[linear-gradient(160deg,#0b0b0e,#08080a_70%)] px-3 py-3 text-left">
      <div className="grid h-full grid-cols-1 gap-3 md:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)]">
        {/* ▸ Fabric — a real node-pty terminal, ssh:// target */}
        <Reveal y={10} className="min-h-0">
          <div className="flex h-full flex-col overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#0b0b0d]">
            <WinChrome icon={<TerminalSquare className="h-2.5 w-2.5" />} title="Fabric" sub="ssh://build@xeno-platform-001" />
            <pre className="flex-1 overflow-hidden p-2.5 font-mono text-[10.5px] leading-[1.65] text-[#aaa39a]">
<span className="text-[#5d5850]">{'fabric ▸ ssh://build@xeno-platform-001 — connected (ConPTY ⇄ xterm.js)'}</span>{`
build@xeno-platform-001:~$ uname -sr
Linux 6.8.0-51-generic
build@xeno-platform-001:~$ systemctl is-active nginx
`}<span className="text-[#5fbf8f]">active</span>{`
build@xeno-platform-001:~$ docker compose ps
NAME        STATUS
frontend    `}<span className="text-[#5fbf8f]">Up 6 days</span>{`
api         `}<span className="text-[#5fbf8f]">Up 6 days</span>{`
postgres    `}<span className="text-[#5fbf8f]">Up 6 days (healthy)</span>{`
build@xeno-platform-001:~$ tail -n2 deploy.log
`}<span className="text-[#807970]">frontend rebuilt · 4.2s
container swapped · rollback image kept</span>{`
build@xeno-platform-001:~$ `}<span className="inline-block h-[11px] w-[6px] translate-y-[1px] motion-safe:animate-pulse" style={{ background: V }} />
            </pre>
            <div className="flex items-center gap-1.5 border-t border-white/[0.05] px-2.5 py-1.5 font-mono text-[9.5px] text-[#5d5850]">
              <span className="rounded-[3px] border border-white/[0.08] px-1 py-px">ConPTY</span>
              <span className="rounded-[3px] border border-white/[0.08] px-1 py-px">local://shell</span>
              <span className="ml-auto">Fabric → New window</span>
            </div>
          </div>
        </Reveal>

        <div className="flex min-h-0 flex-col gap-3">
          {/* ▸ Files — everything addressed by an opaque xmount:// handle */}
          <Reveal y={10} delay={70} className="min-h-0 flex-1">
            <div className="flex h-full flex-col overflow-hidden rounded-[10px] border border-white/[0.08] bg-[#0b0b0d]">
              <WinChrome icon={<FolderOpen className="h-2.5 w-2.5" />} title="Files" />
              <div className="flex items-center gap-1.5 border-b border-white/[0.05] px-2.5 py-1.5 font-mono text-[10px]">
                <span className="acc-fg-hi">xmount://mount/projects/</span>
                <ChevronRight className="h-2.5 w-2.5 text-[#5d5850]" />
                <span className="text-[#69635b]">renders</span>
              </div>
              <div className="flex-1 overflow-hidden px-1.5 py-1.5">
                {[
                  { n: 'launch-cut.mp4', m: '12.4 MB' },
                  { n: 'poster-final.png', m: '2.1 MB' },
                  { n: 'board-v3.xcanvas', m: '860 KB' },
                  { n: 'grade-pass.xmotion', m: '318 KB' },
                  { n: 'stills/', m: '24 items' },
                  { n: 'notes.md', m: '4 KB' },
                ].map((f, i) => (
                  <div key={f.n} className={`flex items-center gap-2 rounded-[6px] px-2 py-[5px] text-[11px] ${i === 0 ? 'acc-b10 text-[#e7e2d9]' : 'text-[#807970]'}`}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] border border-white/[0.12]" />
                    <span className="truncate">{f.n}</span>
                    <span className="ml-auto font-mono text-[9.5px] text-[#5d5850]">{f.m}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 border-t border-white/[0.05] px-2.5 py-1.5 font-mono text-[9.5px] text-[#5d5850]">
                <span className="rounded-[3px] border border-white/[0.08] px-1 py-px">mount: projects</span>
                <span>· readwrite · host path never leaves the broker</span>
              </div>
            </div>
          </Reveal>

          {/* ▸ the consent sheet — rendered by shell chrome, not by the app */}
          <Reveal y={10} delay={120}>
            <div className="rounded-[10px] border acc-bd30 acc-b06 p-2.5">
              <div className="flex items-center gap-2 text-[11.5px] font-medium text-[#e7e2d9]">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 acc-fg-hi" /> Give Fabric access to a folder?
              </div>
              <div className="mt-2 rounded-[6px] border border-white/[0.06] bg-black/30 px-2 py-1.5 font-mono text-[10px] text-[#aaa39a]">
                C:\Users\you\Projects → <span className="acc-fg-hi">xmount://mount/projects</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-mono text-[9.5px] text-[#69635b]">
                <span className="rounded-[3px] border border-white/[0.08] px-1 py-px">read-only</span>
                <span className="rounded-[3px] border acc-bd30 acc-b12 px-1 py-px acc-fg-hi">read-write</span>
                <span className="rounded-[3px] border border-white/[0.08] px-1 py-px">this session</span>
                <span>· revocable any time</span>
              </div>
              <div className="mt-2.5 flex justify-end gap-1.5">
                <button className="rounded-[5px] border border-white/[0.08] px-3 py-1 text-[11px] font-semibold text-[#827b71]">Deny</button>
                <button className="rounded-[5px] border acc-bd30 acc-b15 px-3 py-1 text-[11px] font-semibold acc-fg-hi">Allow</button>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </div>

    {/* ── per-display dock ── */}
    <div className="flex items-center justify-center gap-2 border-t border-white/[0.06] bg-[#08080a] px-3.5 py-2.5">
      {[
        { label: 'Fabric', icon: <TerminalSquare className="h-3.5 w-3.5" />, on: true },
        { label: 'Files', icon: <FolderOpen className="h-3.5 w-3.5" />, on: true },
        { label: 'Settings', icon: <Settings className="h-3.5 w-3.5" />, on: false },
      ].map((a) => (
        <span key={a.label} className={`flex items-center gap-1.5 rounded-[7px] border px-2 py-1 text-[10.5px] ${a.on ? 'acc-bd30 acc-b10 text-[#e7e2d9]' : 'border-white/[0.07] text-[#69635b]'}`}>
          {a.icon}<span className="hidden sm:inline">{a.label}</span>
        </span>
      ))}
      <span className="ml-1 rounded-[7px] border border-dashed border-white/[0.10] px-2 py-1 font-mono text-[10px] text-[#5d5850]">
        + embed app
      </span>
    </div>
  </div>
);

export default ShellDesktop;
