import React from 'react';

/* Hero mockup — a faithful XENO Anima CLI session, recreated in the landing-v3
 * language (near-black panels, hairline borders, off-white text; no AI imagery).
 * Reproduces the real `anima` CLI from apps/cli/src: a Mind header (name · role ·
 * signed · model · Soul stats), an `anima mind run` invocation, the "recalled
 * from Soul" block (a learned skill + a past episode), the Mind's reply, and the
 * "recorded episode / learned skill" confirmations — then a swarm rail of
 * coordinating Minds. All accent color flows through rgb(var(--acc)) / .acc-*
 * so the theme switch recolors it; status colors (success = green) are fixed. */

const V = 'rgb(var(--acc))';
const C = { green: '#5fd08a', dim: '#5d5850', dimmer: '#403c36', text: '#a7a099', bright: '#d3cdc3', faint: '#6f695f' };

/** a small pill chip */
function Chip({ children, accent, style }: { children: React.ReactNode; accent?: boolean; style?: React.CSSProperties }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-[1px] text-[9.5px] font-medium ${accent ? 'acc-b10 acc-bd20' : 'border-white/[0.10] bg-white/[0.03]'}`}
      style={{ color: accent ? V : C.faint, ...style }}
    >
      {children}
    </span>
  );
}

/** ⎿ result / sub line */
function Res({ children }: { children: React.ReactNode }) {
  return <div className="pl-3.5" style={{ color: C.dim }}><span className="mr-1.5">⎿</span>{children}</div>;
}

const AnimaMind: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#0a0a0c] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* window chrome */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0d0d0f] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 font-mono text-[10.5px] text-[#5d5850]">anima — always-on</span>
    </div>

    {/* Mind identity header */}
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-white/[0.06] bg-[#0c0c0e] px-4 py-3">
      <span className="grid h-6 w-6 place-items-center rounded-full acc-b15 acc-bd30 border text-[11px] font-bold" style={{ color: V }}>M</span>
      <span className="text-[12.5px] font-semibold text-[#e8e3db]">Mira</span>
      <span className="text-[11px]" style={{ color: C.dim }}>research-analyst</span>
      <span className="mx-0.5 h-3 w-px bg-white/10" />
      <Chip accent>◈ Ed25519 signed</Chip>
      <Chip>xeno-rt · local</Chip>
      <span className="ml-auto font-mono text-[10.5px]" style={{ color: C.faint }}>
        Soul <span style={{ color: C.text }}>24</span> episodes · <span style={{ color: C.text }}>6</span> skills
      </span>
    </div>

    {/* session body */}
    <div className="flex h-[clamp(376px,50vh,452px)] flex-col justify-between px-4 py-3.5 font-mono text-[11.5px] leading-[1.7]">
      <div className="space-y-[3px]">
        {/* invocation */}
        <div className="flex flex-wrap gap-x-1.5" style={{ color: C.text }}>
          <span style={{ color: V }}>›</span>
          <span style={{ color: C.bright }}>anima mind run</span>
          <span style={{ color: C.dim }}>mira.mind.xeno</span>
          <span style={{ color: C.dim }}>--task</span>
          <span style={{ color: C.text }}>&quot;cross-check the Q3 figures&quot;</span>
          <span style={{ color: C.dim }}>--rt</span>
        </div>

        {/* recall from Soul */}
        <div className="mt-2 rounded-[6px] border acc-bd20 acc-b06 px-2.5 py-2">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: V }}>— recalled from Soul —</div>
          <div className="mt-1.5 space-y-1" style={{ color: C.text }}>
            <div className="flex items-start gap-1.5">
              <span style={{ color: V }}>◆</span>
              <span><span style={{ color: C.bright }}>skill</span> cross-check-sources <span style={{ color: C.dim }}>(v2)</span> — <span style={{ color: C.dim }}>use when reconciling numbers across reports</span></span>
            </div>
            <div className="flex items-start gap-1.5">
              <span style={{ color: C.faint }}>◷</span>
              <span style={{ color: C.dim }}>episode ep_3a9 [success] — flagged a rounding mismatch in the Q2 deck</span>
            </div>
          </div>
        </div>

        {/* Mind reply */}
        <div className="flex gap-1.5 pt-2.5" style={{ color: C.bright }}>
          <span style={{ color: V }}>●</span>
          <span>
            Reconciled the Q3 figures against source. Revenue ties out; <span style={{ color: C.bright }}>opex line 14</span> is
            off by <span style={{ color: C.green }}>1.2%</span> vs the ledger — a rounding carry, not a data error. Draft with the corrected note is in <span style={{ color: V }}>xeno-docs</span>.
          </span>
        </div>

        {/* outcome confirmations */}
        <div className="pt-2 space-y-[3px]" style={{ color: C.text }}>
          <Res><span style={{ color: C.green }}>✓</span> recorded episode <span style={{ color: C.dim }}>ep_8f2</span> [<span style={{ color: C.green }}>success</span>]</Res>
          <Res><span style={{ color: C.green }}>✓</span> learned skill <span style={{ color: C.bright }}>reconcile-opex-lines</span> <span style={{ color: C.dim }}>(v1)</span> — use when a total drifts from its ledger</Res>
        </div>
      </div>

      {/* swarm rail */}
      <div className="space-y-2">
        <div className="rounded-[6px] border border-white/[0.06] bg-white/[0.015] px-2.5 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: C.faint }}>Swarm</span>
            <span className="text-[9.5px]" style={{ color: C.dim }}>3 minds · orchestrating</span>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px]">
            <span className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-[1px] acc-b10" style={{ color: V }}><span className="h-1.5 w-1.5 rounded-full acc-b" />Mira <span style={{ color: C.faint }}>lead</span></span>
            <span style={{ color: C.dimmer }}>→</span>
            <span className="inline-flex items-center gap-1 rounded-[4px] border border-white/[0.08] px-1.5 py-[1px]" style={{ color: C.text }}><span className="h-1.5 w-1.5 rounded-full bg-white/25" />Atlas</span>
            <span style={{ color: C.dimmer }}>·</span>
            <span className="inline-flex items-center gap-1 rounded-[4px] border border-white/[0.08] px-1.5 py-[1px]" style={{ color: C.text }}><span className="h-1.5 w-1.5 rounded-full bg-white/25" />Sol</span>
            <span className="ml-auto" style={{ color: C.dim }}>handoff ⇄ broadcast</span>
          </div>
        </div>

        {/* input line */}
        <div className="border-t border-white/[0.06] pt-2 font-mono text-[11px]">
          <span style={{ color: V }}>›</span> <span style={{ color: C.dim }}>anima swarm orchestrate --task …</span>
        </div>
      </div>
    </div>
  </div>
);

export default AnimaMind;
