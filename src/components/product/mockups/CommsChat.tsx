import React from 'react';
import { Search, Hash, Bot, Lock, CheckCheck, Smile, Plus, Send, Users } from 'lucide-react';

/* A faithful, static mockup of the XENO Comms desktop client — conversation rail
 * + message thread (bubbles with read receipts, an agent member, presence) +
 * composer with the end-to-end-encrypted hint. Pure JSX/Tailwind, no images, so
 * it stays crisp at any scale and weighs nothing. Mirrors the real renderer
 * (apps/desktop/src/renderer) in xeno-comms. */

const VIOLET = '#9f6fff';

function Avatar({ label, color, agent }: { label: string; color: string; agent?: boolean }) {
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
      style={{ background: agent ? 'linear-gradient(135deg,#9f6fff,#6d4bd6)' : color }}
    >
      {agent ? <Bot className="h-3.5 w-3.5" /> : label}
    </span>
  );
}

const convos = [
  { name: 'Design Guild', sub: 'Ava: Pushed the new hero —', kind: 'group', unread: 3, active: true, color: '#3b6fd4' },
  { name: 'Ava Restrepo', sub: 'Typing…', kind: 'dm', online: true, color: '#c0497a' },
  { name: 'Anima', sub: 'Summarized 4 threads', kind: 'agent' },
  { name: 'release-room', sub: 'v0.1.0 is live 🎉', kind: 'channel', color: '#2f9e74' },
];

const CommsChat: React.FC = () => (
  <div className="mx-auto w-full max-w-[720px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0b0b0d] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0d0d10] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
      <span className="ml-2 text-[11px] font-medium text-[#6b6660]">XENO Comms</span>
    </div>

    <div className="flex h-[340px] text-left">
      {/* ── conversation rail ── */}
      <aside className="hidden w-[200px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0c] sm:flex">
        <div className="flex items-center gap-2 px-3 py-2.5">
          <div className="flex flex-1 items-center gap-1.5 rounded-[7px] border border-white/[0.07] bg-white/[0.03] px-2 py-1.5">
            <Search className="h-3 w-3 text-[#5f5a53]" />
            <span className="text-[11px] text-[#5f5a53]">Search</span>
          </div>
        </div>
        <div className="flex-1 space-y-0.5 overflow-hidden px-1.5">
          {convos.map((c) => (
            <div
              key={c.name}
              className={`flex items-center gap-2.5 rounded-[8px] px-2 py-2 ${c.active ? 'bg-white/[0.06]' : ''}`}
            >
              <div className="relative">
                {c.kind === 'agent' ? (
                  <Avatar label="" color="" agent />
                ) : c.kind === 'channel' ? (
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-white/[0.06] text-[#827b71]"><Hash className="h-3.5 w-3.5" /></span>
                ) : c.kind === 'group' ? (
                  <span className="grid h-7 w-7 place-items-center rounded-full text-white" style={{ background: c.color }}><Users className="h-3.5 w-3.5" /></span>
                ) : (
                  <Avatar label={c.name.slice(0, 2).toUpperCase()} color={c.color!} />
                )}
                {c.online && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0a0a0c] bg-[#28c840]" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <span className="truncate text-[12px] font-medium text-[#d8d2c8]">{c.name}</span>
                  {c.kind === 'agent' && <span className="rounded-[3px] bg-[#9f6fff]/15 px-1 text-[8.5px] font-semibold uppercase tracking-wide text-[#b69dff]">agent</span>}
                </div>
                <span className={`truncate text-[10.5px] ${c.sub === 'Typing…' ? 'text-[#b69dff]' : 'text-[#69635b]'}`}>{c.sub}</span>
              </div>
              {c.unread ? <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[#9f6fff] px-1 text-[9px] font-bold text-white">{c.unread}</span> : null}
            </div>
          ))}
        </div>
      </aside>

      {/* ── thread ── */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#0b0b0d]">
        <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full text-white" style={{ background: '#3b6fd4' }}><Users className="h-3 w-3" /></span>
            <div className="leading-tight">
              <div className="text-[12.5px] font-semibold text-[#e7e2d9]">Design Guild</div>
              <div className="flex items-center gap-1 text-[10px] text-[#69635b]"><Lock className="h-2.5 w-2.5" /> 5 members · end-to-end ready</div>
            </div>
          </div>
        </header>

        <div className="flex flex-1 flex-col justify-end gap-3 overflow-hidden px-4 py-3">
          {/* incoming */}
          <div className="flex items-end gap-2">
            <Avatar label="AV" color="#c0497a" />
            <div className="max-w-[78%] rounded-[12px] rounded-bl-[3px] bg-white/[0.06] px-3 py-2">
              <div className="text-[8.5px] font-semibold text-[#c0497a]">Ava Restrepo</div>
              <p className="text-[12px] leading-snug text-[#d8d2c8]">Pushed the new hero — can you review before standup?</p>
            </div>
          </div>
          {/* outgoing with read receipt */}
          <div className="flex items-end justify-end gap-2">
            <div className="max-w-[78%] rounded-[12px] rounded-br-[3px] px-3 py-2" style={{ background: 'rgba(159,111,255,0.16)' }}>
              <p className="text-[12px] leading-snug text-[#ece7df]">On it — adding the motion pass now.</p>
              <div className="mt-0.5 flex items-center justify-end gap-1 text-[9px] text-[#b69dff]">9:41 <CheckCheck className="h-3 w-3" /></div>
            </div>
          </div>
          {/* agent message */}
          <div className="flex items-end gap-2">
            <Avatar label="" color="" agent />
            <div className="max-w-[78%] rounded-[12px] rounded-bl-[3px] border border-[#9f6fff]/20 bg-[#9f6fff]/[0.07] px-3 py-2">
              <div className="flex items-center gap-1 text-[8.5px] font-semibold text-[#b69dff]">Anima <span className="rounded-[3px] bg-[#9f6fff]/15 px-1 text-[8px] uppercase">agent</span></div>
              <p className="text-[12px] leading-snug text-[#d8d2c8]">I summarized the 4 review threads and opened a checklist. 2 need your call.</p>
            </div>
          </div>
          {/* typing */}
          <div className="flex items-center gap-2 pl-9">
            <span className="flex items-center gap-1 rounded-full bg-white/[0.05] px-2.5 py-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#827b71]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#827b71] [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#827b71] [animation-delay:300ms]" />
            </span>
            <span className="text-[10px] text-[#69635b]">Ava is typing…</span>
          </div>
        </div>

        {/* composer */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-2.5">
          <Plus className="h-4 w-4 text-[#69635b]" />
          <div className="flex flex-1 items-center justify-between rounded-[9px] border border-white/[0.07] bg-white/[0.03] px-3 py-2">
            <span className="text-[11.5px] text-[#5f5a53]">Message Design Guild</span>
            <Smile className="h-3.5 w-3.5 text-[#5f5a53]" />
          </div>
          <button className="grid h-8 w-8 place-items-center rounded-[9px] text-white" style={{ background: VIOLET }}>
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>
    </div>
  </div>
);

export default CommsChat;
