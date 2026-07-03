import React from 'react';
import {
  Search, Hash, Sparkles, CheckCheck, Smile, Plus, SendHorizontal, Video, Phone, Info,
  AtSign, PenSquare, UserPlus, ChevronDown,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* High-fidelity XENO Comms client mockup — the hero's "representative content"
 * (NN/g: every hero visual must serve a purpose, show the real product). Built in
 * the landing-v3 language: near-black panels, hairline borders, off-white text,
 * violet only for the AI agent / unread / send accents. Pure JSX/Tailwind so it
 * stays crisp and weightless. Mirrors apps/desktop/src/renderer in xeno-comms. */

const V = 'rgb(var(--acc))';

function Avatar({ init, grad, size = 'h-7 w-7', online }: { init: string; grad: string; size?: string; online?: boolean }) {
  return (
    <span className="relative shrink-0">
      <span className={`grid ${size} place-items-center rounded-full text-[10px] font-semibold text-white/90`} style={{ background: grad }}>{init}</span>
      {online && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#0d0d0f] bg-[#3fbf7f]" />}
    </span>
  );
}
function AgentAvatar({ size = 'h-7 w-7' }: { size?: string }) {
  return <span className={`grid ${size} shrink-0 place-items-center rounded-[8px] border acc-bd40 acc-b12 acc-fg-hi`}><Sparkles className="h-3.5 w-3.5" /></span>;
}

const GR = {
  amanda: 'linear-gradient(135deg,#b8688f,#6d3f63)',
  marcus: 'linear-gradient(135deg,#5b7fb0,#33486b)',
  dev: 'linear-gradient(135deg,#5fa088,#2f5d4c)',
  design: 'linear-gradient(135deg,#a08a5f,#5d4c2f)',
  logan: 'linear-gradient(135deg,#8a7fb0,#473f6b)',
  mkt: 'linear-gradient(135deg,#b0935b,#6b552f)',
};

const rail = [
  { kind: 'channel', name: 'product-launch', preview: 'AI Analyst: The market opportunity…', time: '', unread: 2, active: true },
  { kind: 'dm', name: 'Amanda Lee', preview: 'Sounds good, let’s move forward.', time: '9:41', init: 'AL', grad: GR.amanda, online: true },
  { kind: 'agent', name: 'AI Analyst', preview: 'Here’s the latest analysis…', time: '9:34' },
  { kind: 'dm', name: 'Dev Team', preview: 'Alex: Pushed the latest changes.', time: '9:15', init: 'DT', grad: GR.dev },
  { kind: 'dm', name: 'Design System', preview: 'Jamie: Updated the components…', time: 'Tue', init: 'DS', grad: GR.design },
  { kind: 'channel', name: 'incident-ops', preview: 'AI Ops: Monitoring the issue…', time: 'Tue', unread: 1 },
  { kind: 'dm', name: 'Logan Park', preview: 'Can you review this PR?', time: 'Mon', init: 'LP', grad: GR.logan },
];

const CommsChat: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
    </div>

    <div className="flex h-[clamp(392px,52vh,460px)] text-left">
      {/* ── conversation rail ── */}
      <aside className="hidden w-[clamp(196px,30%,232px)] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0c] sm:flex">
        <div className="flex items-center justify-between px-3.5 pb-2 pt-3">
          <span className="text-[12.5px] font-semibold text-[#e7e2d9]">XENO Comms</span>
          <PenSquare className="h-3.5 w-3.5 text-[#69635b]" />
        </div>
        <div className="px-2.5 pb-2">
          <div className="flex items-center gap-1.5 rounded-[7px] border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
            <Search className="h-3 w-3 text-[#5d5850]" />
            <span className="flex-1 text-[11px] text-[#5d5850]">Search</span>
            <span className="rounded-[3px] border border-white/[0.08] px-1 text-[8.5px] text-[#5d5850]">⌘K</span>
          </div>
        </div>
        <div className="flex items-center justify-between px-3.5 pb-1 pt-1.5">
          <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5d5850]">Threads <ChevronDown className="h-2.5 w-2.5" /></span>
          <Plus className="h-3 w-3 text-[#5d5850]" />
        </div>
        <div className="flex-1 space-y-0.5 overflow-hidden px-1.5">
          {rail.map((c) => (
            <div key={c.name} className={`flex items-center gap-2.5 rounded-[8px] px-2 py-[7px] ${c.active ? 'acc-b10' : ''}`}>
              {c.kind === 'agent' ? <AgentAvatar />
                : c.kind === 'channel'
                  ? <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[7px] ${c.active ? 'acc-b16 acc-fg-hi' : 'bg-white/[0.05] text-[#807970]'}`}><Hash className="h-3.5 w-3.5" /></span>
                  : <Avatar init={c.init!} grad={c.grad!} online={c.online} />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`truncate text-[12px] font-medium ${c.active ? 'text-[#f3efe8]' : 'text-[#d8d2ca]'}`}>{c.kind === 'channel' ? `# ${c.name}` : c.name}</span>
                  {c.kind === 'agent' && <span className="rounded-[3px] acc-b20 px-1 text-[8px] font-bold uppercase acc-fg-hi">AI</span>}
                  {c.time && <span className="ml-auto shrink-0 text-[9px] text-[#5d5850]">{c.time}</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[10.5px] text-[#69635b]">{c.preview}</span>
                  {c.unread ? <span className="ml-auto grid h-4 min-w-[16px] shrink-0 place-items-center rounded-full acc-b px-1 text-[9px] font-bold text-white">{c.unread}</span> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-white/[0.05] px-3.5 py-2.5 text-[11px] text-[#69635b]"><UserPlus className="h-3.5 w-3.5" />Invite people</div>
      </aside>

      {/* ── thread ── */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#0d0d0f]">
        <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Hash className="h-3.5 w-3.5 text-[#807970]" />
            <span className="text-[13px] font-semibold text-[#f3efe8]">product-launch</span>
            <span className="hidden text-[10.5px] text-[#69635b] md:inline">· 12 members</span>
          </div>
          <div className="flex items-center gap-3 text-[#5d5850]">
            <Video className="h-3.5 w-3.5" /><Phone className="h-3.5 w-3.5" /><Info className="h-3.5 w-3.5" />
          </div>
        </header>

        <div className="flex flex-1 flex-col justify-end gap-3.5 overflow-hidden px-4 py-4">
          {/* human */}
          <Reveal y={8}>
            <Msg avatar={<Avatar init="AL" grad={GR.amanda} online size="h-6 w-6" />} name="Amanda Lee" time="9:41 AM">
              Morning team! How’s the launch plan shaping up?
            </Msg>
          </Reveal>
          {/* agent summary card */}
          <Reveal y={8} delay={70}>
            <div className="flex items-start gap-2.5">
              <AgentAvatar size="h-6 w-6" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5"><span className="text-[11px] font-semibold text-[#cdc7be]">AI Analyst</span><span className="rounded-[3px] acc-b20 px-1 text-[8px] font-bold uppercase acc-fg-hi">AI</span><span className="text-[9.5px] text-[#5d5850]">9:42 AM</span></div>
                <div className="mt-1 max-w-[400px] rounded-[10px] rounded-tl-[3px] border acc-bd30 acc-b06 px-3 py-2.5">
                  <p className="text-[12px] leading-snug text-[#d8d2ca]">The launch is on track. Quick summary:</p>
                  <ul className="mt-1.5 space-y-1 text-[11.5px] text-[#aaa39a]">
                    <li className="flex gap-1.5"><span style={{ color: V }}>•</span> Market opportunity: $12.4B (28% YoY)</li>
                    <li className="flex gap-1.5"><span style={{ color: V }}>•</span> Top segment: mid-market SaaS</li>
                    <li className="flex gap-1.5"><span style={{ color: V }}>•</span> Recommended focus: messaging automation</li>
                  </ul>
                  <div className="mt-2 flex items-center gap-1 text-[10.5px] text-[#827b71]">See the full analysis in the thread <ChevronDown className="h-3 w-3" /></div>
                </div>
              </div>
            </div>
          </Reveal>
          {/* human */}
          <Reveal y={8} delay={110}>
            <Msg avatar={<Avatar init="MJ" grad={GR.marcus} online size="h-6 w-6" />} name="Marcus Johnson" time="9:43 AM">
              Thanks! What about risks we should watch?
            </Msg>
          </Reveal>
          {/* agent reply */}
          <Reveal y={8} delay={140}>
            <div className="flex items-start gap-2.5">
              <AgentAvatar size="h-6 w-6" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5"><span className="text-[11px] font-semibold text-[#cdc7be]">AI Analyst</span><span className="text-[9.5px] text-[#5d5850]">9:43 AM</span></div>
                <p className="mt-1 max-w-[400px] text-[12px] leading-snug text-[#aaa39a]">Top risks: competitor pricing pressure and integration complexity. I’ve added mitigation plans to the launch doc.</p>
              </div>
            </div>
          </Reveal>
          {/* human with mention + receipt */}
          <Reveal y={8} delay={140}>
            <div className="flex items-start gap-2.5">
              <Avatar init="AL" grad={GR.amanda} online size="h-6 w-6" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5"><span className="text-[11px] font-semibold text-[#cdc7be]">Amanda Lee</span><span className="text-[9.5px] text-[#5d5850]">9:44 AM</span><CheckCheck className="h-3 w-3 text-[#69635b]" /></div>
                <p className="mt-1 text-[12px] leading-snug text-[#aaa39a]">Perfect. Let’s sync with <span className="rounded-[3px] acc-b15 px-1 font-medium acc-fg-hi">@Dev&nbsp;Team</span> on the timeline.</p>
              </div>
            </div>
          </Reveal>
        </div>

        {/* composer */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-3">
          <Plus className="h-4 w-4 text-[#69635b]" />
          <div className="flex flex-1 items-center justify-between rounded-[9px] border border-white/[0.07] bg-white/[0.02] px-3 py-2">
            <span className="text-[11.5px] text-[#5d5850]">Message #product-launch</span>
            <span className="flex items-center gap-2.5 text-[#5d5850]"><Smile className="h-3.5 w-3.5" /><AtSign className="h-3.5 w-3.5" /></span>
          </div>
          <button className="grid h-8 w-8 place-items-center rounded-[8px] text-white" style={{ background: V }}><SendHorizontal className="h-4 w-4" /></button>
        </div>
      </section>
    </div>
  </div>
);

function Msg({ avatar, name, time, children }: { avatar: React.ReactNode; name: string; time: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      {avatar}
      <div className="min-w-0">
        <div className="flex items-center gap-1.5"><span className="text-[11px] font-semibold text-[#cdc7be]">{name}</span><span className="text-[9.5px] text-[#5d5850]">{time}</span></div>
        <p className="mt-1 max-w-[400px] text-[12px] leading-snug text-[#aaa39a]">{children}</p>
      </div>
    </div>
  );
}

export default CommsChat;
