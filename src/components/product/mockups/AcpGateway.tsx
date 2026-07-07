import React from 'react';
import { Reveal } from '../../landing-v3/primitives';

/* Hero mockup — the XENO ACP gateway console, recreated in the landing-v3
 * language (no screenshot asset). xeno-acp has no GUI: its real surface is the
 * OpenAI-compatible ACP gateway (@xeno-acp/server) and the in-process engine
 * (@xeno-acp/core). This mirrors that — a left rail of data-driven ACP agents
 * (claude-code / codex / opencode / gemini / kimi / glm) and a live session
 * where one OpenAI request is driven through an ACP agent and the ACP
 * session/update stream is projected into structured events (tool_call, diff,
 * plan, message) plus the flattened OpenAI finish/usage. Every accent goes
 * through the accent system (V / .acc-*); tool colors (Read=accent, Edit=yellow,
 * Bash=red, chunk=cyan) are fixed semantics, matching the terminal mockup. */

const V = 'rgb(var(--acc))';
const C = { green: '#5fd08a', yellow: '#e6c07a', red: '#e88a8a', cyan: '#7ac0c0', dim: '#5d5850', text: '#a7a099', bright: '#d3cdc3' };

const AGENTS = [
  { id: 'claude-code', kind: 'ACP adapter', active: true },
  { id: 'codex', kind: 'ACP adapter', active: false },
  { id: 'opencode', kind: 'ACP native', active: false },
  { id: 'gemini', kind: 'ACP native', active: false },
  { id: 'kimi', kind: 'ACP native', active: false },
  { id: 'glm', kind: 'ACP native', active: false },
];

/** One projected ACP session/update, with a small event-kind tag. */
function Ev({ tag, color, delay, children }: { tag: string; color: string; delay?: number; children: React.ReactNode }) {
  return (
    <Reveal y={7} delay={delay}>
      <div className="flex gap-2">
        <span className="mt-[2px] shrink-0 rounded-[3px] bg-white/[0.04] px-1 text-[8.5px] font-semibold uppercase tracking-[0.06em]" style={{ color }}>{tag}</span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </Reveal>
  );
}
function ToolLine({ color, name, args }: { color: string; name: string; args: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span style={{ color }}>■</span>
      <span style={{ color: C.bright }}>{name}</span>
      <span style={{ color: C.dim }}>({args})</span>
    </div>
  );
}

const AcpGateway: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 truncate font-mono text-[10.5px] text-[#69635b]">
        <span className="font-semibold" style={{ color: V }}>xeno-acp</span> · OpenAI-compatible ACP gateway · :8787
      </span>
    </div>

    <div className="flex h-[clamp(400px,54vh,472px)] text-left">
      {/* ── agents rail ── */}
      <aside className="hidden w-[clamp(180px,29%,212px)] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0c] sm:flex">
        <div className="flex items-center justify-between px-3.5 pb-2 pt-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5d5850]">Agents</span>
          <span className="rounded-[3px] border border-white/[0.08] px-1 text-[9px] text-[#5d5850]">6</span>
        </div>
        <div className="flex-1 space-y-0.5 overflow-hidden px-1.5">
          {AGENTS.map((a) => (
            <div key={a.id} className={`flex items-center gap-2.5 rounded-[8px] px-2 py-[7px] ${a.active ? 'acc-b10' : ''}`}>
              <span className="relative grid h-6 w-6 shrink-0 place-items-center">
                <span className="h-2 w-2 rounded-full" style={a.active ? { background: V, boxShadow: `0 0 0 3px rgb(var(--acc) / 0.18)` } : { background: '#33302b' }} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={`truncate font-mono text-[11.5px] ${a.active ? 'text-[#f3efe8]' : 'text-[#cdc7be]'}`}>{a.id}</span>
                  {a.active && <span className="ml-auto rounded-[3px] acc-b20 px-1 text-[8px] font-bold uppercase acc-fg-hi">live</span>}
                </div>
                <div className="text-[9.5px] text-[#5d5850]">{a.kind}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-white/[0.05] px-3.5 py-2.5 font-mono text-[10px] text-[#69635b]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#3fbf7f]" />
          <span>GET /healthz · <span className="text-[#8a847b]">healthy</span></span>
        </div>
      </aside>

      {/* ── session ── */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#0d0d0f]">
        <header className="flex items-center justify-between border-b border-white/[0.06] px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 rounded-[5px] border acc-bd30 acc-b12 px-1.5 py-0.5 font-mono text-[11px] acc-fg-hi">claude-code</span>
            <span className="truncate font-mono text-[11px] text-[#69635b]"><span style={{ color: V }}>POST</span> /v1/chat/completions</span>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-[10px] text-[#5d5850]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: V }} /> stream
          </span>
        </header>

        <div className="flex flex-1 flex-col gap-2.5 overflow-hidden px-4 py-3.5 font-mono text-[11px] leading-[1.55]">
          <Ev tag="user" color={V} delay={0}>
            <span className="text-[#cdc7be]">Add a refresh-token guard to the session and run the auth tests</span>
          </Ev>

          <Ev tag="plan" color={V} delay={60}>
            <div className="space-y-0.5" style={{ color: C.text }}>
              <div><span style={{ color: C.green }}>✓</span> Read the session handler</div>
              <div><span style={{ color: C.green }}>✓</span> Add refresh-token guard</div>
              <div><span style={{ color: C.dim }}>○</span> Run the auth suite</div>
            </div>
          </Ev>

          <Ev tag="tool_call" color={V} delay={100}>
            <ToolLine color={V} name="Read" args="src/auth/session.ts" />
            <div className="pl-3.5" style={{ color: C.dim }}>⎿ 128 lines</div>
          </Ev>

          <Ev tag="diff" color={C.yellow} delay={140}>
            <ToolLine color={C.yellow} name="Edit" args="src/auth/session.ts" />
            <div className="mt-0.5 space-y-px pl-3.5">
              <div style={{ color: C.red, background: 'rgba(120,30,30,0.28)' }} className="rounded-[2px] px-1">- return issue(user);</div>
              <div style={{ color: C.green, background: 'rgba(24,70,32,0.30)' }} className="rounded-[2px] px-1">+ if (!refresh.take(user.id)) return tooMany();</div>
              <div style={{ color: C.green, background: 'rgba(24,70,32,0.30)' }} className="rounded-[2px] px-1">+ return issue(user, refresh.next());</div>
            </div>
          </Ev>

          <Ev tag="tool_call" color={C.red} delay={175}>
            <ToolLine color={C.red} name="Bash" args="pnpm test -- auth" />
            <div className="pl-3.5" style={{ color: C.dim }}>⎿ <span style={{ color: C.green }}>✓</span> 24 passed <span style={{ color: C.dim }}>(1.8s)</span></div>
          </Ev>

          <Ev tag="message" color={V} delay={210}>
            <div className="flex gap-1.5" style={{ color: C.bright }}>
              <span style={{ color: V }}>●</span>
              <span>Refresh guard is in and the auth suite passes — streamed back as <span style={{ color: C.cyan }}>chat.completion.chunk</span> deltas.</span>
            </div>
          </Ev>
        </div>

        {/* flattened OpenAI result */}
        <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-2.5 font-mono text-[10px] text-[#5d5850]">
          <span className="flex items-center gap-2 truncate">
            <span>finish_reason <span style={{ color: C.text }}>stop</span></span><span>·</span>
            <span>ACP v1</span><span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">12 updates</span><span>·</span>
            <span>usage <span style={{ color: C.text }}>3.1K→812</span></span>
          </span>
          <span className="shrink-0" style={{ color: V }}>data: [DONE]</span>
        </div>
      </section>
    </div>
  </div>
);

export default AcpGateway;
