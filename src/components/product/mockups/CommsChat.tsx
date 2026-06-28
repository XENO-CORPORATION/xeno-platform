import React from 'react';
import { Search, Hash, Sparkles, Lock, CheckCheck, Smile, Paperclip, SendHorizontal, Users } from 'lucide-react';

/* A faithful XENO Comms client mockup in the landing-v3 visual language —
 * monochrome #0f0f0f/#151515 panels, hairline white/[0.07] borders, off-white
 * text, an AI agent shown as a Sparkles-avatar member. Pure JSX/Tailwind so it
 * stays crisp and weightless. Mirrors apps/desktop/src/renderer in xeno-comms. */

function Avatar({ label, agent = false, dim = false }: { label?: string; agent?: boolean; dim?: boolean }) {
  if (agent) {
    return <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] border border-white/15 bg-white/[0.05] text-[#cdc7be]"><Sparkles className="h-3.5 w-3.5" /></span>;
  }
  return (
    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-[10px] font-semibold ${dim ? 'bg-white/[0.05] text-[#9b948a]' : 'bg-white/[0.10] text-[#cdc7be]'}`}>{label}</span>
  );
}

const convos = [
  { name: 'product-team', sub: 'Ava: ship the launch plan Friday?', kind: 'channel', unread: 3, active: true },
  { name: 'Ava Restrepo', sub: 'typing…', kind: 'dm', online: true, init: 'AV' },
  { name: 'Launch Agent', sub: 'drafted 3 posts + timeline', kind: 'agent' },
  { name: 'design-review', sub: 'new hero is up', kind: 'channel' },
];

const CommsChat: React.FC = () => (
  <div className="mx-auto w-full max-w-[680px] overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#0f0f0f] shadow-[0_40px_100px_-40px_rgba(0,0,0,0.85)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#151515] px-4 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
      <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
      <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
      <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#756f66]">XENO Comms</span>
    </div>

    <div className="flex h-[348px] text-left">
      {/* ── conversation rail ── */}
      <aside className="hidden w-[196px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0c0c0c] sm:flex">
        <div className="px-3 py-3">
          <div className="flex items-center gap-1.5 rounded-[7px] border border-white/[0.07] bg-white/[0.02] px-2 py-1.5">
            <Search className="h-3 w-3 text-[#5d5850]" />
            <span className="text-[11px] text-[#5d5850]">Search</span>
          </div>
        </div>
        <div className="flex-1 space-y-0.5 overflow-hidden px-1.5">
          {convos.map((c) => (
            <div key={c.name} className={`flex items-center gap-2.5 rounded-[8px] px-2 py-2 ${c.active ? 'bg-white/[0.06]' : ''}`}>
              <div className="relative">
                {c.kind === 'agent' ? <Avatar agent /> : c.kind === 'channel'
                  ? <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-white/[0.05] text-[#807970]"><Hash className="h-3.5 w-3.5" /></span>
                  : <Avatar label={c.init} />}
                {c.online && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0c0c0c] bg-[#cdc7be]" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium text-[#d8d2ca]">{c.kind === 'channel' ? `# ${c.name}` : c.name}</span>
                  {c.kind === 'agent' && <span className="rounded-[3px] border border-white/[0.12] bg-black/30 px-1 text-[8.5px] font-semibold uppercase tracking-wide text-[#9b948a]">agent</span>}
                </div>
                <span className={`truncate text-[10.5px] ${c.sub === 'typing…' ? 'text-[#cdc7be]' : 'text-[#69635b]'}`}>{c.sub}</span>
              </div>
              {c.unread ? <span className="grid h-4 min-w-[16px] place-items-center rounded-[4px] bg-white/[0.10] px-1 text-[9px] font-bold text-[#e3ded5]">{c.unread}</span> : null}
            </div>
          ))}
        </div>
      </aside>

      {/* ── thread ── */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#0f0f0f]">
        <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-[7px] bg-white/[0.05] text-[#807970]"><Hash className="h-3.5 w-3.5" /></span>
            <div className="leading-tight">
              <div className="text-[12.5px] font-semibold text-[#e7e2d9]"># product-team</div>
              <div className="flex items-center gap-1.5 text-[10px] text-[#69635b]"><Lock className="h-2.5 w-2.5" /> end-to-end ready · 5 online</div>
            </div>
          </div>
          <Users className="h-3.5 w-3.5 text-[#5d5850]" />
        </header>

        <div className="flex flex-1 flex-col justify-end gap-2.5 overflow-hidden px-4 py-3.5">
          <div className="flex items-end gap-2">
            <Avatar label="AV" dim />
            <div className="max-w-[80%] rounded-[10px] rounded-bl-[2px] bg-white/[0.05] px-3 py-2">
              <div className="text-[8.5px] font-semibold uppercase tracking-wide text-[#807970]">Ava Restrepo</div>
              <p className="mt-0.5 text-[12px] leading-snug text-[#aaa39a]">Roadmap looks great — ship the launch plan Friday?</p>
            </div>
          </div>
          <div className="flex items-end justify-end gap-2">
            <div className="max-w-[80%] rounded-[10px] rounded-br-[2px] border border-white/[0.10] bg-white/[0.03] px-3 py-2">
              <p className="text-[12px] leading-snug text-[#cdc7be]">On it — drafting the timeline now.</p>
              <div className="mt-0.5 flex items-center justify-end gap-1 text-[9px] text-[#69635b]">9:41 <CheckCheck className="h-3 w-3 text-[#aaa39a]" /></div>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Avatar agent />
            <div className="max-w-[82%] rounded-[10px] rounded-tl-[2px] border border-white/[0.08] bg-white/[0.02] px-3 py-2">
              <div className="flex items-center gap-1.5 text-[8.5px] font-semibold uppercase tracking-wide text-[#807970]">Launch Agent <span className="rounded-[3px] border border-white/[0.12] px-1 text-[8px] text-[#9b948a]">agent</span></div>
              <p className="mt-0.5 text-[12px] leading-snug text-[#aaa39a]">Drafted 3 posts and the launch timeline. 2 items need your call ✓</p>
            </div>
          </div>
          <div className="flex items-center gap-2 pl-9">
            <span className="flex items-center gap-1 rounded-full bg-white/[0.04] px-2.5 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#69635b]" style={{ animation: 'xenoTypingDot 1.1s ease-in-out 0s infinite' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-[#69635b]" style={{ animation: 'xenoTypingDot 1.1s ease-in-out 0.16s infinite' }} />
              <span className="h-1.5 w-1.5 rounded-full bg-[#69635b]" style={{ animation: 'xenoTypingDot 1.1s ease-in-out 0.32s infinite' }} />
            </span>
            <span className="text-[10px] text-[#69635b]">Ava is typing…</span>
          </div>
        </div>

        {/* composer */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-3">
          <Paperclip className="h-4 w-4 text-[#69635b]" />
          <div className="flex flex-1 items-center justify-between rounded-[8px] border border-white/[0.07] bg-white/[0.02] px-3 py-2">
            <span className="text-[11.5px] text-[#5d5850]">Message # product-team</span>
            <Smile className="h-3.5 w-3.5 text-[#5d5850]" />
          </div>
          <button className="grid h-8 w-8 place-items-center rounded-[7px] bg-white/[0.10] text-[#cdc7be]"><SendHorizontal className="h-4 w-4" /></button>
        </div>
      </section>
    </div>
  </div>
);

export default CommsChat;
