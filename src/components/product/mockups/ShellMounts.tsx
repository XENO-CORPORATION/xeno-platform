import React from 'react';
import { ShieldCheck, FolderOpen, Ban, ScrollText } from 'lucide-react';

/* Gallery mockup — Settings → Privacy: the Mount + per-app ACL broker that is
 * XENO Shell's real security surface. Grants are per-app × per-mount, live-
 * revocable (open handles die with a typed XENO-FS error), and every call lands
 * in the audit ring — including the rejected escapes. Sourced from
 * ../xeno-shell CHANGELOG Phase 1.5-B. Equal height with ShellDisplays. */

const ShellMounts: React.FC = () => (
  <div className="flex h-full w-full flex-col overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#0d0d0f] text-left">
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <ShieldCheck className="h-3.5 w-3.5 acc-fg-hi" />
      <span className="text-[11.5px] text-[#cdc7be]">Settings — Privacy &amp; access</span>
      <span className="ml-auto font-mono text-[9.5px] text-[#5d5850]">mounts.json · acl.json</span>
    </div>

    <div className="flex h-[clamp(304px,40vh,372px)] flex-col gap-3 overflow-hidden px-3.5 py-3">
      {/* mounts + their per-app grants */}
      <div>
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[#5d5850]">Mounts</span>
        <div className="mt-2 space-y-1.5">
          {[
            { name: 'projects', path: 'C:\\Users\\you\\Projects', grants: [{ app: 'Fabric', scope: 'read-write' }, { app: 'Files', scope: 'read-write' }] },
            { name: 'renders', path: 'D:\\Media\\Renders', grants: [{ app: 'Files', scope: 'read-only' }] },
          ].map((m) => (
            <div key={m.name} className="rounded-[8px] border border-white/[0.07] bg-white/[0.02] px-2.5 py-2">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-3 w-3 shrink-0 text-[#807970]" />
                <span className="font-mono text-[10.5px] acc-fg-hi">xmount://mount/{m.name}</span>
                <span className="ml-auto truncate font-mono text-[9.5px] text-[#5d5850]">{m.path}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {m.grants.map((g) => (
                  <span key={g.app} className="flex items-center gap-1.5 rounded-[5px] border border-white/[0.08] bg-black/30 px-1.5 py-0.5 font-mono text-[9.5px] text-[#aaa39a]">
                    {g.app}<span className="text-[#5d5850]">· {g.scope}</span>
                    <span className="text-[#69635b] underline decoration-dotted">revoke</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* audit ring */}
      <div className="flex min-h-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[#5d5850]">
          <ScrollText className="h-3 w-3" /> Audit
        </span>
        <div className="mt-2 min-h-0 flex-1 overflow-hidden rounded-[8px] border border-white/[0.06] bg-black/30 px-2.5 py-2 font-mono text-[9.5px] leading-[1.75]">
          <div className="text-[#807970]">14:01:58 <span className="text-[#5fbf8f]">grant</span> projects → Fabric · read-write · session</div>
          <div className="text-[#807970]">14:02:11 <span className="text-[#5fbf8f]">allow</span> Fabric read projects/deploy.log</div>
          <div className="text-[#807970]">14:02:44 <span className="text-[#5fbf8f]">allow</span> Files write renders/poster-final.png</div>
          <div className="flex items-center gap-1.5 text-[#aaa39a]">
            <span>14:03:02</span>
            <Ban className="h-2.5 w-2.5 shrink-0 text-[#d98b7a]" />
            <span className="text-[#d98b7a]">deny</span>
            <span className="truncate">demo-embed ../../Windows → XENO-FS[PathEscape]</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#aaa39a]">
            <span>14:03:07</span>
            <Ban className="h-2.5 w-2.5 shrink-0 text-[#d98b7a]" />
            <span className="text-[#d98b7a]">deny</span>
            <span className="truncate">demo-embed junction → XENO-FS[PathEscape]</span>
          </div>
          <div className="text-[#807970]">14:03:19 <span className="text-[#d98b7a]">revoked</span> demo-embed × renders — 2 handles closed</div>
          <div className="text-[#807970]">14:03:19 <span className="text-[#d98b7a]">error</span> demo-embed read → XENO-FS[PermissionRevoked]</div>
        </div>
      </div>
    </div>
  </div>
);

export default ShellMounts;
