import React from 'react';

/* Hero mockup — starting a XENO platform agent from a terminal with XENO Spawn (0.1.0-rc.42), recreated in the
 * landing-v3 language (no AI-generated imagery). The commands are Spawn's real CLI (`spawn claude --agent agt_…`,
 * server/src/agentCli.js + agentBinding.js); the status lines paraphrase what that path does — bind once after a
 * confirmation, mint a one-hour credential for this launch only, hand Claude Code the XENO MCP server, revoke on
 * exit — rather than quoting its exact output. */

const V = 'rgb(var(--acc))';
const C = { green: '#5fd08a', dim: '#5d5850', text: '#a7a099', bright: '#d3cdc3' };

function Line({ mark = '·', color = C.dim, children }: { mark?: string; color?: string; children: React.ReactNode }) {
  return <div className="flex gap-2"><span style={{ color }}>{mark}</span><span style={{ color: C.text }}>{children}</span></div>;
}

const SpawnTerminal: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#08080a] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0d0d10] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 font-mono text-[10.5px] text-[#5d5850]">PowerShell — C:\work\acme-site</span>
    </div>
    <div className="h-[clamp(360px,48vh,430px)] space-y-[5px] px-4 py-3.5 font-mono text-[11.5px] leading-[1.7]">
      <div><span style={{ color: C.dim }}>PS C:\work\acme-site&gt;</span> <span style={{ color: C.bright }}>spawn claude --agent agt_3f9c…e21a</span></div>
      <Line mark="?" color={V}>Bind XENO agent <span style={{ color: C.bright }}>Release Bot</span> (Acme · Web) as a Claude Code profile? <span style={{ color: C.bright }}>yes</span></Line>
      <Line mark="✓" color={C.green}>Profile <span style={{ color: C.bright }}>claude/Release Bot</span> created — your own Claude settings are untouched</Line>
      <Line mark="✓" color={C.green}>Fresh credential for this launch only · expires in 1 h · revoked when you exit</Line>
      <Line mark="✓" color={C.green}>XENO connected: tasks, library, canvases, chat</Line>
      <div className="pt-2" style={{ color: C.dim }}>Starting Claude Code as Release Bot…</div>
      <div className="mt-2 inline-block rounded-[6px] border border-white/[0.09] px-3 py-1.5">
        <div style={{ color: C.bright }}>Claude Code</div>
        <div style={{ color: C.dim }}>C:\work\acme-site · MCP: xeno</div>
      </div>
      <div className="flex gap-1.5 pt-1"><span style={{ color: V }}>›</span><span style={{ color: C.bright }}>take my next XENO task and ship it</span></div>
      <Line mark="■" color={V}>xeno · list_my_tasks → <span style={{ color: C.bright }}>T-42 Fix the pricing page footer</span></Line>
      <Line mark="■" color={V}>xeno · claim_task(T-42)</Line>
    </div>
  </div>
);

export default SpawnTerminal;
