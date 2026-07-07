import React from 'react';
import { Sparkles, Settings2, Check, X, CornerDownLeft, ShieldQuestion } from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* Hero mockup — XENO SDK embedded in a host app (the README's end-to-end
 * example: Pixel's agent sidebar driven by a tool registry). Left: the real
 * `createXenoAgent()` call with a tool registry (confirm:true). Right: the
 * SDK's own `/ui` components — AgentChatPanel with a ToolCallMessage, an inline
 * PermissionDialog, and the AgentStatusBar — reacting to that exact tool.
 * Built in the landing-v3 language: near-black panels, hairline borders,
 * off-white text. All accent color flows through rgb(var(--acc)) / .acc-* so the
 * Shift+T theme switch recolors it. Code syntax colors are fixed semantics
 * (like the terminal mockup's tool colors), deliberately non-violet so the accent
 * stays exclusive to the agent UI. Mirrors src/ui + create-agent.ts in xeno-agent-sdk. */

const V = 'rgb(var(--acc))';
// fixed syntax palette — semantic, never the accent
const S = { kw: '#8fb3d9', fn: '#e6c07a', str: '#9fc59a', prop: '#cdc7be', punct: '#5d5850', comment: '#544f48', plain: '#a7a099' };

function AgentAvatar({ size = 'h-6 w-6' }: { size?: string }) {
  return <span className={`grid ${size} shrink-0 place-items-center rounded-[7px] border acc-bd40 acc-b12 acc-fg-hi`}><Sparkles className="h-3.5 w-3.5" /></span>;
}

/* one line of the code pane */
function L({ children, indent = 0 }: { children: React.ReactNode; indent?: number }) {
  return <div style={{ paddingLeft: indent * 12 }}>{children}</div>;
}

const SdkEmbed: React.FC = () => (
  <div className="mx-auto w-full max-w-[820px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* titlebar */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 font-mono text-[10.5px] text-[#5d5850]">xeno-pixel — agent.ts</span>
    </div>

    <div className="flex h-[clamp(400px,54vh,476px)] text-left">
      {/* ── code pane: the SDK you write ── */}
      <div className="hidden min-w-0 flex-1 flex-col border-r border-white/[0.06] bg-[#08080a] sm:flex">
        <div className="flex items-center justify-between border-b border-white/[0.05] px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5d5850]">
          <span>Your app</span><span className="rounded-[3px] border border-white/[0.08] px-1.5 py-0.5 font-mono text-[8.5px] normal-case tracking-normal">agent-sdk</span>
        </div>
        <div className="flex-1 overflow-hidden px-4 py-3.5 font-mono text-[11px] leading-[1.72]">
          <L><span style={{ color: S.kw }}>import</span> <span style={{ color: S.punct }}>{'{ '}</span><span style={{ color: S.fn }}>createXenoAgent</span><span style={{ color: S.punct }}>{' }'}</span></L>
          <L indent={1}><span style={{ color: S.kw }}>from</span> <span style={{ color: S.str }}>'@xeno/agent-sdk'</span></L>
          <L><span>&nbsp;</span></L>
          <L><span style={{ color: S.comment }}>// your app's actions → agent tools</span></L>
          <L><span style={{ color: S.kw }}>const</span> <span style={{ color: S.prop }}>agent</span> <span style={{ color: S.punct }}>=</span> <span style={{ color: S.kw }}>await</span> <span style={{ color: S.fn }}>createXenoAgent</span><span style={{ color: S.punct }}>({'{'}</span></L>
          <L indent={1}><span style={{ color: S.prop }}>toolRegistry</span><span style={{ color: S.punct }}>: {'{'}</span></L>
          <L indent={2}><span style={{ color: S.str }}>'layer.remove-bg'</span><span style={{ color: S.punct }}>: {'{'}</span></L>
          <L indent={3}><span style={{ color: S.prop }}>execute</span><span style={{ color: S.punct }}>: (p) {'=>'}</span> <span style={{ color: S.plain }}>pixel.</span><span style={{ color: S.fn }}>rmbg</span><span style={{ color: S.punct }}>(p.layerId),</span></L>
          <L indent={3}><span style={{ color: S.prop }}>confirm</span><span style={{ color: S.punct }}>:</span> <span style={{ color: S.kw }}>true</span><span style={{ color: S.punct }}>,</span> <span style={{ color: S.comment }}>// ask first</span></L>
          <L indent={2}><span style={{ color: S.punct }}>{'}'},</span></L>
          <L indent={1}><span style={{ color: S.punct }}>{'}'},</span></L>
          <L indent={1}><span style={{ color: S.prop }}>model</span><span style={{ color: S.punct }}>:</span> <span style={{ color: S.str }}>'claude-sonnet-4-6'</span><span style={{ color: S.punct }}>,</span></L>
          <L indent={1}><span style={{ color: S.prop }}>permissionConfig</span><span style={{ color: S.punct }}>: {'{'} </span><span style={{ color: S.prop }}>mode</span><span style={{ color: S.punct }}>: </span><span style={{ color: S.str }}>'default'</span><span style={{ color: S.punct }}> {'}'},</span></L>
          <L><span style={{ color: S.punct }}>{'}'})</span></L>
        </div>
        <div className="border-t border-white/[0.05] px-4 py-2 font-mono text-[10px] text-[#5d5850]">
          <span style={{ color: V }}>›</span> agent ready · <span className="text-[#7a746b]">6 tools</span> · audit on
        </div>
      </div>

      {/* ── embedded agent panel: what your users get (SDK /ui) ── */}
      <section className="flex w-[clamp(248px,46%,320px)] shrink-0 flex-col bg-[#0d0d0f]">
        <header className="flex items-center justify-between border-b border-white/[0.06] px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <AgentAvatar />
            <div className="leading-tight">
              <div className="text-[12.5px] font-semibold text-[#f3efe8]">Pixel Agent</div>
              <div className="text-[9.5px] text-[#69635b]">powered by XENO SDK</div>
            </div>
          </div>
          <Settings2 className="h-3.5 w-3.5 text-[#5d5850]" />
        </header>

        <div className="flex flex-1 flex-col justify-end gap-3 overflow-hidden px-3.5 py-3.5">
          {/* user */}
          <Reveal y={8}>
            <div className="ml-auto max-w-[86%] rounded-[10px] rounded-tr-[3px] border border-white/[0.07] bg-white/[0.03] px-3 py-2 text-[11.5px] leading-snug text-[#d8d2ca]">
              Remove the background from Layer 3
            </div>
          </Reveal>

          {/* tool call */}
          <Reveal y={8} delay={70}>
            <div className="flex items-start gap-2">
              <AgentAvatar />
              <div className="min-w-0 flex-1">
                <div className="rounded-[9px] rounded-tl-[3px] border border-white/[0.07] bg-[#0a0a0c] px-2.5 py-2 font-mono text-[10.5px]">
                  <div className="flex items-center gap-1.5">
                    <span style={{ color: V }}>■</span>
                    <span className="text-[#d3cdc3]">layer.remove-bg</span>
                    <span className="text-[#5d5850]">({'{'} layerId: <span className="text-[#9fc59a]">'layer-3'</span> {'}'})</span>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

          {/* permission dialog (confirm:true) */}
          <Reveal y={8} delay={120}>
            <div className="ml-8 rounded-[10px] border acc-bd30 acc-b06 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#e7e2d9]">
                <ShieldQuestion className="h-3.5 w-3.5 acc-fg-hi" /> Allow this action?
              </div>
              <p className="mt-1 text-[10.5px] leading-snug text-[#aaa39a]">
                <span className="font-mono acc-fg-hi">layer.remove-bg</span> will modify Layer 3.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <button className="inline-flex items-center gap-1 rounded-[6px] px-2.5 py-1 text-[10.5px] font-semibold text-white" style={{ background: V }}>
                  <Check className="h-3 w-3" /> Approve
                </button>
                <button className="inline-flex items-center gap-1 rounded-[6px] border border-white/[0.12] px-2.5 py-1 text-[10.5px] font-medium text-[#aaa39a]">
                  <X className="h-3 w-3" /> Deny
                </button>
                <span className="ml-auto text-[9px] text-[#5d5850]">low risk</span>
              </div>
            </div>
          </Reveal>

          {/* result + answer */}
          <Reveal y={8} delay={160}>
            <div className="flex items-start gap-2">
              <AgentAvatar />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 pl-0.5 text-[10px] text-[#69635b]">
                  <Check className="h-3 w-3 text-[#5fd08a]" /> mask applied · logged to audit ledger
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-[#aaa39a]">
                  Done — background removed from <span className="acc-fg-hi">Layer&nbsp;3</span>.
                </p>
              </div>
            </div>
          </Reveal>
        </div>

        {/* composer */}
        <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-2.5">
          <div className="flex flex-1 items-center justify-between rounded-[9px] border border-white/[0.07] bg-white/[0.02] px-2.5 py-1.5">
            <span className="text-[11px] text-[#5d5850]">Ask the agent…</span>
            <CornerDownLeft className="h-3.5 w-3.5 text-[#5d5850]" />
          </div>
        </div>

        {/* status bar (AgentStatusBar) */}
        <div className="flex items-center justify-between border-t border-white/[0.05] px-3 py-2 font-mono text-[9.5px] text-[#5d5850]">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: V }} /> ready · claude-sonnet-4-6
          </span>
          <span>2.1K tok · $0.01</span>
        </div>
      </section>
    </div>
  </div>
);

export default SdkEmbed;
