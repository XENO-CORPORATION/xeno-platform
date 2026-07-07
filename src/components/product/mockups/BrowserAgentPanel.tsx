import React from 'react';
import {
  History, ChevronDown, Settings, Sparkles, Plus, Mic, SendHorizontal, Paperclip,
  Check, MousePointer2, RotateCw, ArrowLeft, ArrowRight, Lock,
} from 'lucide-react';
import { Reveal } from '../../landing-v3/primitives';

/* High-fidelity XENO Extension mockup — the hero's "representative content"
 * (NN/g: a hero visual must show the real product). Recreates the real Chromium
 * side-panel agent from xeno-extension/sidepanel (index.html + styles.css): the
 * floating history + model-dropdown toolbars, the live-steps widget (■ tool
 * calls), the permission approval banner, quick actions, and the composer with
 * the AGENT mode dropdown. Docked in a browser window whose page the agent is
 * acting on. Built in the landing-v3 language — near-black panels, hairline
 * borders, off-white text — with all accent color routed through rgb(var(--acc))
 * so the theme switcher recolors it (the real app's accent is white). */

const V = 'rgb(var(--acc))';

/* the XENO hexagon glyph (matches the extension's welcome/popup mark) */
function Hex({ cls = 'h-3.5 w-3.5' }: { cls?: string }) {
  return (
    <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
      <line x1="12" y1="22" x2="12" y2="15.5" />
      <polyline points="22 8.5 12 15.5 2 8.5" />
    </svg>
  );
}

/* ■ live-step row — square icon, pulsing when active (mirrors .live-step) */
function Step({ label, state }: { label: string; state: 'done' | 'active' }) {
  return (
    <div className="flex items-center gap-2.5 py-[3px] text-[11.5px]">
      <span className="grid h-3 w-3 shrink-0 place-items-center">
        {state === 'done'
          ? <Check className="h-3 w-3" style={{ color: '#5fbf8f' }} />
          : <span className="h-[7px] w-[7px] rounded-[1.5px] motion-safe:animate-pulse" style={{ background: V }} />}
      </span>
      <span className={state === 'active' ? 'text-[#cdc7be]' : 'text-[#69635b]'}>{label}</span>
    </div>
  );
}

const BrowserAgentPanel: React.FC = () => (
  <div className="mx-auto w-full max-w-[880px] overflow-hidden rounded-[14px] border border-white/[0.08] bg-[#0d0d0f] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* ── browser titlebar + tab strip ── */}
    <div className="flex items-center gap-3 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      </div>
      <div className="hidden items-end gap-1 sm:flex">
        <div className="flex items-center gap-2 rounded-t-[7px] border border-b-0 border-white/[0.07] bg-[#0d0d0f] px-3 py-1.5 text-[11px] text-[#cdc7be]">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" /> Acme — Pricing
        </div>
        <div className="px-2 py-1.5 text-[11px] text-[#5d5850]">Docs</div>
        <Plus className="mb-1 h-3.5 w-3.5 text-[#5d5850]" />
      </div>
    </div>

    {/* ── omnibox / toolbar ── */}
    <div className="flex items-center gap-2.5 border-b border-white/[0.06] bg-[#0a0a0c] px-3.5 py-2">
      <div className="flex items-center gap-1.5 text-[#5d5850]">
        <ArrowLeft className="h-3.5 w-3.5" /><ArrowRight className="h-3.5 w-3.5 opacity-40" /><RotateCw className="h-3 w-3" />
      </div>
      <div className="flex flex-1 items-center gap-2 rounded-[7px] border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
        <Lock className="h-3 w-3 text-[#5fbf8f]/70" />
        <span className="text-[11px] text-[#807970]">acme.com/pricing</span>
      </div>
      {/* pinned XENO extension — active */}
      <span className="grid h-6 w-6 place-items-center rounded-[6px] border acc-bd30 acc-b12 acc-fg-hi"><Hex cls="h-3.5 w-3.5" /></span>
    </div>

    <div className="flex h-[clamp(440px,62vh,556px)] text-left">
      {/* ── the page the agent is working on (dimmed context) ── */}
      <div className="relative hidden min-w-0 flex-1 flex-col gap-4 overflow-hidden bg-[#0b0b0d] p-6 sm:flex">
        <div className="h-3 w-28 rounded-full bg-white/[0.07]" />
        <div className="h-6 w-2/3 rounded-[5px] bg-white/[0.06]" />
        <div className="grid grid-cols-3 gap-3 pt-2">
          {['Starter', 'Pro', 'Team'].map((t, i) => (
            <div key={t} className={`rounded-[10px] border p-3.5 ${i === 1 ? 'acc-bd30 acc-b06' : 'border-white/[0.06] bg-white/[0.02]'}`}>
              <div className="text-[11px] text-[#69635b]">{t}</div>
              <div className="mt-1.5 text-[15px] font-semibold text-[#cdc7be]">{['$0', '$24', '$80'][i]}</div>
              <div className="mt-3 space-y-1.5">
                {[0, 1, 2].map((r) => <div key={r} className="h-1.5 w-full rounded-full bg-white/[0.05]" />)}
              </div>
              <div className={`mt-3 h-6 rounded-[6px] ${i === 1 ? 'acc-b20' : 'bg-white/[0.05]'}`} />
            </div>
          ))}
        </div>
        <div className="space-y-2 pt-2">
          <div className="h-2 w-full rounded-full bg-white/[0.04]" />
          <div className="h-2 w-11/12 rounded-full bg-white/[0.04]" />
          <div className="h-2 w-4/5 rounded-full bg-white/[0.04]" />
        </div>
        {/* the element the agent is about to click — accent ring + cursor */}
        <div className="absolute bottom-[86px] left-6 flex items-center gap-2 rounded-[7px] border-2 border-dashed px-3 py-1.5 text-[11px] font-medium" style={{ borderColor: V, color: 'var(--acc-fg,#cdc7be)' }}>
          <span className="text-[#cdc7be]">Compare plans</span>
          <MousePointer2 className="absolute -bottom-3 -right-3 h-4 w-4 fill-white text-black drop-shadow" />
        </div>
      </div>

      {/* ── XENO side panel ── */}
      <aside className="relative flex w-full shrink-0 flex-col border-l border-white/[0.06] bg-[#08080a] sm:w-[clamp(300px,44%,346px)]">
        {/* floating toolbars (history left · model + settings right) */}
        <div className="flex items-center justify-between border-b border-white/[0.05] px-2.5 py-2">
          <button className="grid h-6 w-6 place-items-center rounded-[5px] text-[#69635b]"><History className="h-3.5 w-3.5" /></button>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 rounded-[6px] border border-white/[0.08] px-2 py-1 text-[11px] text-[#cdc7be]">
              <Sparkles className="h-3 w-3 acc-fg-hi" /> Sonnet 4.6 <ChevronDown className="h-2.5 w-2.5 text-[#5d5850]" />
            </div>
            <button className="grid h-6 w-6 place-items-center rounded-[5px] text-[#5d5850]"><Settings className="h-3.5 w-3.5" /></button>
          </div>
        </div>

        {/* conversation */}
        <div className="flex flex-1 flex-col gap-3 overflow-hidden px-3 py-3.5">
          {/* user */}
          <Reveal y={8}>
            <div className="flex justify-end">
              <div className="max-w-[86%] rounded-[8px] border border-white/[0.06] bg-white/[0.06] px-2.5 py-1.5 text-[12px] leading-snug text-[#e7e2d9]">
                Grab the 3 pricing tiers from this page and give me a comparison table.
              </div>
            </div>
          </Reveal>

          {/* live-steps widget */}
          <Reveal y={8} delay={70}>
            <div className="border-l-[1.5px] border-white/[0.08] pl-3">
              <Step label="Read the page" state="done" />
              <Step label="Navigate → /pricing" state="done" />
              <Step label="Take screenshot" state="done" />
              <Step label="Extract pricing tiers" state="active" />
            </div>
          </Reveal>

          {/* assistant answer + mini table */}
          <Reveal y={8} delay={110}>
            <div className="max-w-[92%] text-[12px] leading-relaxed text-[#aaa39a]">
              <p>Here are the three tiers on the page:</p>
              <div className="mt-2 overflow-hidden rounded-[7px] border border-white/[0.07]">
                <div className="grid grid-cols-[1fr_auto] bg-white/[0.03] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#756f66]">
                  <span>Plan</span><span>Price</span>
                </div>
                {[['Starter', '$0'], ['Pro', '$24/mo'], ['Team', '$80/mo']].map(([p, pr]) => (
                  <div key={p} className="grid grid-cols-[1fr_auto] border-t border-white/[0.05] px-2.5 py-1.5 text-[11.5px] text-[#cdc7be]">
                    <span>{p}</span><span className="text-[#aaa39a]">{pr}</span>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>

        {/* ── approval banner (permission mode: ask) ── */}
        <div className="px-2.5">
          <div className="rounded-[8px] border border-white/[0.08] bg-[#111114] px-2.5 py-2">
            <div className="flex items-center gap-2 text-[11.5px] text-[#cdc7be]">
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke={V} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
              <span className="flex-1">Click “Compare plans” to expand all tiers?</span>
            </div>
            <div className="mt-1 pl-5 font-mono text-[10px] text-[#69635b]">click · a.compare-plans</div>
            <div className="mt-2 flex justify-end gap-1.5">
              <button className="rounded-[4px] border border-white/[0.08] px-3 py-1 text-[11px] font-semibold text-[#827b71]">Deny</button>
              <button className="rounded-[4px] border acc-bd30 acc-b15 px-3 py-1 text-[11px] font-semibold acc-fg-hi">Allow</button>
            </div>
          </div>
        </div>

        {/* quick actions */}
        <div className="flex gap-1.5 px-2.5 pt-2.5">
          {['Screenshot', 'Read Page', 'Summarize'].map((q) => (
            <span key={q} className="rounded-[6px] border border-white/[0.06] bg-white/[0.03] px-2.5 py-1 text-[10.5px] text-[#69635b]">{q}</span>
          ))}
        </div>

        {/* composer */}
        <div className="px-2.5 pb-3 pt-2">
          <div className="rounded-[8px] border border-white/[0.07] bg-white/[0.03]">
            <div className="px-3 py-2.5 text-[12px] text-[#5d5850]">Ask Xeno anything… (/ for commands)</div>
            <div className="flex items-center justify-between px-2 pb-2">
              <div className="flex items-center gap-1.5">
                <span className="grid h-6 w-6 place-items-center rounded-[6px] border border-white/[0.08] text-[#69635b]"><Paperclip className="h-3.5 w-3.5" /></span>
                <span className="flex items-center gap-1 rounded-[6px] border acc-bd30 acc-b10 px-2 py-1 text-[10px] font-semibold tracking-[0.08em] acc-fg-hi">AGENT <ChevronDown className="h-2.5 w-2.5" /></span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="grid h-6 w-6 place-items-center rounded-[6px] border border-white/[0.08] text-[#69635b]"><Mic className="h-3.5 w-3.5" /></span>
                <button className="grid h-6 w-6 place-items-center rounded-[6px] text-white" style={{ background: V }}><SendHorizontal className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
);

export default BrowserAgentPanel;
