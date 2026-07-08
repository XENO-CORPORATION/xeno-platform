import React from 'react';

/* Gallery mockup — the XENO Anima swarm, from apps/cli/src/commands/swarm.ts
 * (`anima swarm orchestrate`): a coordinator Mind decomposes a task across
 * specialist Minds, they hand off with context, and it integrates the result.
 * Landing-v3 language; all accent color via rgb(var(--acc)) / .acc-* classes. */

const V = 'rgb(var(--acc))';
const C = { green: '#5fd08a', dim: '#5d5850', dimmer: '#403c36', text: '#a7a099', bright: '#d3cdc3', faint: '#6f695f' };

function Step({ name, role, task, lead }: { name: string; role: string; task: string; lead?: boolean }) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[9.5px] font-bold ${lead ? 'acc-b15 acc-bd30' : 'border-white/[0.12] bg-white/[0.03]'}`}
        style={{ color: lead ? V : C.text }}
      >
        {name[0]}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11.5px] font-semibold text-[#e8e3db]">{name}</span>
          <span className="text-[9.5px]" style={{ color: lead ? V : C.faint }}>{role}</span>
        </div>
        <div className="mt-0.5 text-[11px] leading-[1.5]" style={{ color: C.text }}>{task}</div>
      </div>
    </div>
  );
}

const AnimaSwarm: React.FC = () => (
  <div className="mx-auto w-full overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#0a0a0c] shadow-[0_40px_100px_-40px_rgba(0,0,0,0.85)]">
    {/* chrome */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0d0d0f] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 font-mono text-[10.5px] text-[#5d5850]">anima swarm orchestrate</span>
    </div>

    <div className="px-4 py-4 font-mono text-[11.5px] leading-[1.7]">
      {/* the overall task */}
      <div className="flex flex-wrap gap-x-1.5">
        <span style={{ color: V }}>›</span>
        <span style={{ color: C.dim }}>--task</span>
        <span style={{ color: C.bright }}>&quot;Ship the Q3 investor update&quot;</span>
      </div>

      {/* plan */}
      <div className="mt-3 text-[9.5px] font-semibold uppercase tracking-[0.16em]" style={{ color: C.faint }}>— plan —</div>
      <div className="mt-2 space-y-2.5 border-l border-white/[0.07] pl-3">
        <Step name="Atlas" role="specialist" task="Pull the Q3 metrics from the ledger and last quarter’s deck." />
        <Step name="Sol" role="specialist" task="Draft the narrative — highlights, risks, next-quarter guidance." />
        <Step name="Mira" role="specialist" task="Fact-check every figure against source; flag drift." />
      </div>

      {/* handoff hint */}
      <div className="mt-2.5 flex items-center gap-2 text-[10px]" style={{ color: C.dim }}>
        <span className="inline-flex items-center gap-1 rounded-[4px] acc-b10 acc-bd20 border px-1.5 py-[1px]" style={{ color: V }}>Mira ⇄ Sol</span>
        <span>handoff — corrected opex note carried with context</span>
      </div>

      {/* orchestrator integrates */}
      <div className="mt-3.5 rounded-[6px] border acc-bd20 acc-b06 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="grid h-5 w-5 place-items-center rounded-full acc-b15 acc-bd30 border text-[9.5px] font-bold" style={{ color: V }}>O</span>
          <span className="text-[11px] font-semibold" style={{ color: V }}>Orchestrator</span>
          <span className="text-[9.5px]" style={{ color: C.faint }}>integrates</span>
          <span className="ml-auto text-[9.5px]" style={{ color: C.dim }}>3 subtasks · <span style={{ color: C.green }}>done</span></span>
        </div>
        <div className="mt-1.5 text-[11px] leading-[1.55]" style={{ color: C.text }}>
          Merged the metrics, narrative and fact-check into one update. Every specialist recorded the run to its Soul; the coordination is logged.
        </div>
      </div>

      {/* event log */}
      <div className="mt-2.5 space-y-[3px] text-[10.5px]" style={{ color: C.dim }}>
        <div><span style={{ color: C.green }}>✓</span> broadcast → 3 replies · <span style={{ color: C.faint }}>1 handoff</span> · integrated</div>
        <div><span style={{ color: C.green }}>✓</span> Sol learned skill <span style={{ color: C.bright }}>investor-narrative</span> <span style={{ color: C.dim }}>(v1)</span></div>
      </div>
    </div>
  </div>
);

export default AnimaSwarm;
