import React from 'react';
import { Monitor, TerminalSquare, FolderOpen, Settings, Info } from 'lucide-react';

/* Gallery mockup — the host wrapper: one borderless-fullscreen root PER display
 * (not kiosk), each with its own dock and workspace set, and live hotplug —
 * when a display vanishes its windows migrate to the primary with a toast.
 * Sourced from ../xeno-shell CHANGELOG Phase 1.5-A. Equal height with
 * ShellMounts. */

function Dock({ active }: { active: string }) {
  return (
    <div className="flex items-center justify-center gap-1 border-t border-white/[0.06] bg-[#08080a] px-2 py-1.5">
      {[
        { id: 'fabric', icon: <TerminalSquare className="h-3 w-3" /> },
        { id: 'files', icon: <FolderOpen className="h-3 w-3" /> },
        { id: 'settings', icon: <Settings className="h-3 w-3" /> },
      ].map((a) => (
        <span key={a.id} className={`grid h-5 w-5 place-items-center rounded-[5px] border ${a.id === active ? 'acc-bd30 acc-b12 acc-fg-hi' : 'border-white/[0.07] text-[#5d5850]'}`}>
          {a.icon}
        </span>
      ))}
    </div>
  );
}

function Screen({ label, primary, workspaces, active, windows, dim }: {
  label: string; primary?: boolean; workspaces: string[]; active: string; windows: string[]; dim?: boolean;
}) {
  return (
    <div className={`flex min-w-0 flex-1 flex-col overflow-hidden rounded-[9px] border ${dim ? 'border-dashed border-white/[0.10] opacity-55' : 'border-white/[0.08]'} bg-[#0b0b0d]`}>
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] bg-[#0a0a0c] px-2 py-1.5">
        <Monitor className="h-3 w-3 text-[#807970]" />
        <span className="truncate text-[10px] text-[#cdc7be]">{label}</span>
        {primary && <span className="rounded-[3px] border border-white/[0.08] px-1 font-mono text-[8.5px] text-[#5d5850]">primary</span>}
        <div className="ml-auto flex items-center gap-1">
          {workspaces.map((w) => (
            <span key={w} className={`rounded-[3px] px-1 text-[9px] ${w === active ? 'acc-b12 acc-fg-hi' : 'text-[#5d5850]'}`}>{w}</span>
          ))}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 bg-[linear-gradient(160deg,#0b0b0e,#08080a_70%)] p-2">
        {windows.map((w) => (
          <div key={w} className="flex items-center gap-1.5 rounded-[6px] border border-white/[0.07] bg-[#0d0d10] px-2 py-1.5 text-[10px] text-[#aaa39a]">
            <span className="h-1.5 w-1.5 rounded-[1px] bg-white/20" />{w}
          </div>
        ))}
      </div>
      <Dock active={windows.length ? 'fabric' : 'files'} />
    </div>
  );
}

const ShellDisplays: React.FC = () => (
  <div className="flex h-full w-full flex-col overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#0d0d0f] text-left">
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <Monitor className="h-3.5 w-3.5 acc-fg-hi" />
      <span className="text-[11.5px] text-[#cdc7be]">Full-OS mode — one root per display</span>
      <span className="ml-auto font-mono text-[9.5px] text-[#5d5850]">F11 · borderless, not kiosk</span>
    </div>

    <div className="flex h-[clamp(304px,40vh,372px)] flex-col gap-3 px-3.5 py-3">
      <div className="flex min-h-0 flex-1 gap-3">
        <Screen label="Display 1 · 3840×2160" primary workspaces={['Work', 'Studio', '3']} active="Work"
          windows={['Fabric — ssh://build@…', 'Files — xmount://projects', 'Settings']} />
        <Screen label="Display 2 · 2560×1440" workspaces={['Ops', '2']} active="Ops"
          windows={['Fabric — local://shell']} dim />
      </div>

      {/* hotplug toast */}
      <div className="flex items-center gap-2 rounded-[8px] border acc-bd25 acc-b06 px-2.5 py-2">
        <Info className="h-3.5 w-3.5 shrink-0 acc-fg-hi" />
        <span className="text-[11px] leading-snug text-[#cdc7be]">
          Display 2 disconnected — <span className="text-[#aaa39a]">1 window moved to the primary display.</span>
        </span>
        <span className="ml-auto hidden font-mono text-[9.5px] text-[#5d5850] sm:inline">state.json</span>
      </div>
    </div>
  </div>
);

export default ShellDisplays;
