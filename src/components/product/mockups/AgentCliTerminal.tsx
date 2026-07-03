import React from 'react';

/* Hero mockup — a faithful XENO Agent CLI terminal session, recreated in the
 * landing-v3 language (no AI-generated imagery). Reproduces the real TUI from
 * apps/xeno-agent-cli/src/ui: the banner box, the `›` prompt, `■ Tool(args)`
 * calls with `⎿` results + a diff, the thinking spinner, and the status bar.
 * Accent elements use rgb(var(--acc)) so the theme switch recolors them;
 * tool colors (Write=green / Edit=yellow / Bash=red) are fixed semantics. */

const V = 'rgb(var(--acc))';
const C = { green: '#5fd08a', yellow: '#e6c07a', red: '#e88a8a', cyan: '#7ac0c0', dim: '#5d5850', dimmer: '#403c36', text: '#a7a099', bright: '#d3cdc3' };

/** ■ Tool(args) call line */
function Tool({ color, name, args }: { color: string; name: string; args: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span style={{ color }}>■</span>
      <span style={{ color: C.bright }}>{name}</span>
      <span style={{ color: C.dim }}>({args})</span>
    </div>
  );
}
/** ⎿ result line */
function Res({ children }: { children: React.ReactNode }) {
  return <div className="pl-3.5" style={{ color: C.dim }}><span className="mr-1.5">⎿</span>{children}</div>;
}

const AgentCliTerminal: React.FC = () => (
  <div className="mx-auto w-full max-w-[760px] overflow-hidden rounded-[12px] border border-white/[0.08] bg-[#08080a] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.9)]">
    {/* window chrome */}
    <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0d0d10] px-3.5 py-2.5">
      <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
      <span className="ml-2 font-mono text-[10.5px] text-[#5d5850]">xeno — ~/acme-api</span>
    </div>

    {/* terminal body */}
    <div className="flex h-[clamp(392px,52vh,468px)] flex-col justify-between px-4 py-3.5 font-mono text-[11.5px] leading-[1.7]">
      <div className="space-y-[3px]">
        {/* banner */}
        <div className="mb-2 inline-block rounded-[6px] border border-white/[0.09] px-3 py-1.5">
          <div><span className="font-bold" style={{ color: V }}>XENO AGENT</span> <span style={{ color: C.dim }}>v0.4.42</span></div>
          <div style={{ color: C.dim }}>claude-sonnet-4-6 · ~/acme-api · 3 skills · memory on</div>
        </div>

        {/* user prompt */}
        <div className="flex gap-1.5">
          <span style={{ color: V }}>›</span>
          <span style={{ color: C.bright }}>fix the failing auth test and add a token-bucket rate limiter</span>
        </div>

        {/* work */}
        <div className="pt-0.5" style={{ color: C.text }}>
          <Tool color={V} name="Read" args="src/auth/session.ts" />
          <Res>Read session.ts (128 lines)</Res>
          <Tool color={V} name="Grep" args="rateLimit" />
          <Res>No matches</Res>
          <Tool color={C.yellow} name="Edit" args="src/auth/session.ts" />
          <Res>
            <span>Updated session.ts (</span><span style={{ color: C.red }}>-1</span> / <span style={{ color: C.green }}>+7</span><span>)</span>
            <div className="mt-0.5 space-y-px pl-1">
              <div style={{ color: C.red, background: 'rgba(120,30,30,0.28)' }} className="rounded-[2px] px-1">- export async function login(req) {'{'}</div>
              <div style={{ color: C.green, background: 'rgba(24,70,32,0.30)' }} className="rounded-[2px] px-1">+ const limiter = tokenBucket({'{'} rate: 100, per: '1m' {'}'});</div>
              <div style={{ color: C.green, background: 'rgba(24,70,32,0.30)' }} className="rounded-[2px] px-1">+ export async function login(req) {'{'}</div>
              <div style={{ color: C.green, background: 'rgba(24,70,32,0.30)' }} className="rounded-[2px] px-1">+   if (!limiter.take(req.ip)) return tooMany();</div>
              <div style={{ color: C.dim }} className="px-1">… +3 lines</div>
            </div>
          </Res>
          <Tool color={C.red} name="Bash" args="npm test -- auth" />
          <Res><span style={{ color: C.green }}>✓</span> 24 passed <span style={{ color: C.dim }}>(1.8s)</span></Res>
        </div>

        {/* agent answer */}
        <div className="flex gap-1.5 pt-1.5" style={{ color: C.bright }}>
          <span style={{ color: V }}>●</span>
          <span>Done. The auth suite passes and a 100&nbsp;req/min token-bucket now guards <span style={{ color: C.cyan }}>/login</span>. Every edit &amp; command is in the run’s audit ledger.</span>
        </div>
      </div>

      <div className="space-y-2">
        {/* input line */}
        <div className="border-t border-white/[0.06] pt-2">
          <span style={{ color: V }}>›</span> <span style={{ color: C.dim }}>Message or /command…</span>
        </div>
        {/* status bar */}
        <div className="flex items-center justify-between text-[10px]" style={{ color: C.dim }}>
          <span className="flex items-center gap-1.5">
            <span>agent</span> <span style={{ color: C.yellow }}>●</span> <span>|</span> claude-sonnet-4-6 <span>|</span> ctx <span style={{ color: C.text }}>12.3K/200K</span> · $0.04
          </span>
          <span>/help</span>
        </div>
      </div>
    </div>
  </div>
);

export default AgentCliTerminal;
